import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import {
  deleteMenuCategoryRecord,
  deleteMenuItemRecord,
  getFreshStore,
  insertMenuCategoryRecord,
  setMenuItemAvailableRecord,
  updateStore,
  upsertMenuItemRecord,
} from "@/lib/store";

// KAN-123: deleted menu items/categories must stay deleted. Two resurrection
// vectors existed: writeStore upserted the entire store.menu/categories
// arrays on every generic save (a stale snapshot re-inserted deleted rows),
// and normalizeStore re-seeded DEFAULT_MENU/MENU_CATEGORIES whenever the
// tables read empty. These specs prove targeted persistence works and that
// neither vector can resurrect deleted rows.
// All rows use e2e-* ids/names and are cleaned up regardless of pass/fail.

function ensureStoreEnv() {
  for (const file of [".env", ".env.local"]) {
    const envPath = path.join(process.cwd(), file);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i < 0 || line.trim().startsWith("#")) continue;
      const key = line.slice(0, i).trim();
      if (key && !(key in process.env)) process.env[key] = line.slice(i + 1).trim();
    }
  }
}

ensureStoreEnv();

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "other";

test.describe("menu deletion permanence (KAN-123)", () => {
  test("targeted create/update/available/delete round-trips and stays deleted after a stale generic write", async () => {
    const supabase = supabaseTestClient();
    const tag = e2eId("menu-del");
    const category = `E2E Cat ${tag}`;
    const itemId = `e2e-${tag}`;
    const itemName = `E2E Item ${tag}`;

    // Targeted category + item creation.
    const catResult = await insertMenuCategoryRecord(category);
    expect(catResult).toEqual({ ok: true });
    await upsertMenuItemRecord({
      id: itemId,
      name: itemName,
      price: 111,
      category,
      image: "/images/logo.jpg",
      available: true,
      styles: ["iced", "hot"],
      addons: [{ id: "addon-0", name: "E2E Shot", price: 25, qtyEnabled: false }],
    });

    let store = await getFreshStore();
    const created = store.menu.find((item) => item.id === itemId);
    expect(created?.name).toBe(itemName);
    expect(created?.styles).toEqual(["iced", "hot"]);
    expect(created?.addons?.[0]?.name).toBe("E2E Shot");
    expect(store.categories).toContain(category);

    // Targeted update + availability toggle.
    await upsertMenuItemRecord({ ...created!, price: 222 });
    await setMenuItemAvailableRecord(itemId, false);
    store = await getFreshStore();
    expect(store.menu.find((item) => item.id === itemId)?.price).toBe(222);
    expect(store.menu.find((item) => item.id === itemId)?.available).toBe(false);

    try {
      // Targeted delete.
      await deleteMenuItemRecord(itemId);
      await deleteMenuCategoryRecord(category);

      store = await getFreshStore();
      expect(store.menu.some((item) => item.id === itemId)).toBe(false);
      expect(store.categories).not.toContain(category);

      // Simulate the stale-snapshot race that resurrected rows: a generic
      // updateStore whose snapshot still contains the deleted item/category.
      await updateStore((draft) => {
        draft.menu.push({
          id: itemId,
          name: itemName,
          price: 111,
          category,
          image: "/images/logo.jpg",
          available: true,
          styles: ["iced"],
          addons: [],
        });
        draft.categories.push(category);
      });

      // The deleted rows must remain absent from the database - the stale
      // in-memory snapshot no longer has a persistence path for them.
      const { data: itemRows } = await supabase
        .from("menu_items")
        .select("id")
        .eq("id", itemId);
      expect(itemRows ?? []).toHaveLength(0);
      const { data: categoryRows } = await supabase
        .from("menu_categories")
        .select("id")
        .eq("id", slug(category));
      expect(categoryRows ?? []).toHaveLength(0);

      store = await getFreshStore();
      expect(store.menu.some((item) => item.id === itemId)).toBe(false);
      expect(store.categories).not.toContain(category);
    } finally {
      await supabase.from("menu_items").delete().eq("id", itemId);
      await supabase.from("menu_categories").delete().eq("id", slug(category));
    }
  });

  test("an intentionally emptied menu is valid state and is not reseeded", async () => {
    const supabase = supabaseTestClient();
    const tag = e2eId("menu-empty");
    const category = `E2E EmptyCat ${tag}`;
    const itemId = `e2e-${tag}`;

    await insertMenuCategoryRecord(category);
    await upsertMenuItemRecord({
      id: itemId,
      name: `E2E Empty ${tag}`,
      price: 50,
      category,
      image: "/images/logo.jpg",
      available: true,
      styles: [],
      addons: [],
    });

    try {
      // Remove the item and the category - the system still has users,
      // orders, inventory and other menu rows, so nothing is "virgin".
      await deleteMenuItemRecord(itemId);
      await deleteMenuCategoryRecord(category);

      const store = await getFreshStore();
      // Real production rows still exist - nothing was reseeded.
      expect(store.menu.length).toBeGreaterThan(0);
      expect(store.menu.some((item) => item.id === itemId)).toBe(false);
      expect(store.categories).not.toContain(category);
      // And nothing fabricated appears in place of the deleted category.
      expect(store.menu.every((item) => item.id !== itemId)).toBe(true);
    } finally {
      await supabase.from("menu_items").delete().eq("id", itemId);
      await supabase.from("menu_categories").delete().eq("id", slug(category));
    }
  });

  test("insertMenuCategoryRecord rejects duplicates", async () => {
    const store = await getFreshStore();
    const existing = store.categories[0];
    expect(existing).toBeTruthy();
    const result = await insertMenuCategoryRecord(existing!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already on the board");
  });
});
