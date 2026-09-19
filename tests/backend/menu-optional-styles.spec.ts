import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import { DRINK_STYLES, normalizeMenuStyles } from "@/lib/menu";
import { ingredientsForOrderLine } from "@/lib/inventory";
import { getFreshStore, upsertMenuItemRecord, deleteMenuItemRecord } from "@/lib/store";

// KAN-127 regression coverage: Hot/Iced type selection is optional.
// Before the fix, normalizeMenuStyles() converted an empty selection into
// ["iced","hot"] on BOTH the write path (stylesFromForm) and the read path
// (readStore), so styles=[] could never persist or display. These specs pin:
//  - explicit [] round-trips as [] through upsert + fresh DB read
//  - single/both styles still persist unchanged
//  - a truly absent styles value (legacy in-memory shape) still defaults to
//    both styles - missing and explicit-empty are not the same state
//  - a style-less order line never triggers a hot/iced cup deduction
// All DB rows use e2e-* ids and are cleaned up regardless of pass/fail.

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

test.describe("KAN-127 optional Hot/Iced type selection", () => {
  test("normalizeMenuStyles keeps an explicit empty selection empty", () => {
    const category = "Classic";
    expect(normalizeMenuStyles({ category, styles: [] })).toEqual([]);
    expect(normalizeMenuStyles({ category, styles: ["iced"] })).toEqual(["iced"]);
    expect(normalizeMenuStyles({ category, styles: ["hot"] })).toEqual(["hot"]);
    expect(normalizeMenuStyles({ category, styles: ["iced", "hot"] })).toEqual(["iced", "hot"]);
    // Food/pastry categories still never carry styles.
    expect(normalizeMenuStyles({ category: "Pastries", styles: ["iced", "hot"] })).toEqual([]);
    // A genuinely absent styles field (legacy in-memory shape) still
    // defaults to both - it must not be conflated with explicit [].
    expect(normalizeMenuStyles({ category, styles: undefined as never })).toEqual([...DRINK_STYLES]);
    expect(normalizeMenuStyles({ category, styles: null as never })).toEqual([...DRINK_STYLES]);
  });

  test("styles=[] persists to menu_items and round-trips through a fresh read", async () => {
    ensureStoreEnv();
    const supabase = supabaseTestClient();
    const id = e2eId("notype-menu");
    const { data: category } = await supabase
      .from("menu_categories")
      .select("id")
      .ilike("name", "Special")
      .limit(1)
      .single();

    try {
      await upsertMenuItemRecord({
        id,
        name: "E2E NoType Item",
        price: 120,
        category: "Special",
        image: "/images/logo.jpg",
        available: true,
        styles: [],
        addons: [],
      });

      const { data: row } = await supabase.from("menu_items").select("styles").eq("id", id).single();
      expect(row?.styles, "explicit empty selection persists as []").toEqual([]);

      const fresh = await getFreshStore();
      const item = fresh.menu.find((entry) => entry.id === id);
      expect(item?.styles, "fresh read does not reinflate [] into both styles").toEqual([]);

      // Edit to a single style, then back to none: both writes must land.
      const current = (await getFreshStore()).menu.find((entry) => entry.id === id)!;
      await upsertMenuItemRecord({ ...current, styles: ["iced"] });
      expect((await supabase.from("menu_items").select("styles").eq("id", id).single()).data?.styles).toEqual(["iced"]);

      const iced = (await getFreshStore()).menu.find((entry) => entry.id === id)!;
      await upsertMenuItemRecord({ ...iced, styles: [] });
      expect((await supabase.from("menu_items").select("styles").eq("id", id).single()).data?.styles).toEqual([]);
      const cleared = (await getFreshStore()).menu.find((entry) => entry.id === id);
      expect(cleared?.styles, "returning to zero styles persists").toEqual([]);
      void category;
    } finally {
      await supabase.from("menu_items").delete().eq("id", id);
    }
  });

  test("a style-less order line produces no hot/iced cup deduction", () => {
    const cupId = e2eId("cup-inv");
    const menuId = e2eId("notype-menu");
    const store = {
      menu: [
        { id: menuId, name: "E2E NoType Item", price: 120, category: "Special", image: "", available: true, styles: [], addons: [] },
      ],
      inventory: [
        { id: cupId, name: "E2E Cups", unit: "pcs", cost: 1, stock: 100 },
      ],
      recipeCostings: [
        {
          id: "rc-1",
          name: "E2E costing",
          menuItems: [menuId],
          ingredients: [],
          icedCupInventoryItemId: cupId,
          hotCupInventoryItemId: cupId,
        },
      ],
    };

    // No style selected -> neither the iced nor the hot cup is deducted.
    const styleLess = ingredientsForOrderLine(store as never, {
      productId: menuId,
      name: "E2E NoType Item",
      qty: 1,
      price: 120,
    });
    expect(styleLess.some((ingredient) => ingredient.inventoryItemId === cupId),
      "no cup deduction when no Hot/Iced type was chosen").toBe(false);

    // Sanity: choosing Iced on the same line still deducts the iced cup.
    const iced = ingredientsForOrderLine(store as never, {
      productId: menuId,
      name: "E2E NoType Item",
      qty: 1,
      price: 120,
      style: "iced",
    });
    expect(iced.some((ingredient) => ingredient.inventoryItemId === cupId),
      "explicit Iced selection still deducts the configured cup").toBe(true);
  });

  test("deleting a style-less item stays permanent (KAN-123 path unaffected)", async () => {
    ensureStoreEnv();
    const supabase = supabaseTestClient();
    const id = e2eId("notype-menu");
    await upsertMenuItemRecord({
      id,
      name: "E2E NoType Delete",
      price: 99,
      category: "Special",
      image: "/images/logo.jpg",
      available: true,
      styles: [],
      addons: [],
    });
    try {
      await deleteMenuItemRecord(id);
      const fresh = await getFreshStore();
      expect(fresh.menu.some((entry) => entry.id === id)).toBe(false);
      const { data } = await supabase.from("menu_items").select("id").eq("id", id);
      expect(data ?? []).toHaveLength(0);
    } finally {
      await supabase.from("menu_items").delete().eq("id", id);
    }
  });
});
