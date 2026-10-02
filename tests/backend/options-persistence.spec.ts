import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import { parseMenuImageOptions } from "@/lib/menu";
import { getFreshStore, deleteMenuItemRecord, createOrderAtomic, upsertMenuItemRecord } from "@/lib/store";

// Regression coverage for clean menu/order option persistence:
//  - menu_items.styles / menu_items.addons are the write+read source of truth
//    through the real updateStore()/getFreshStore() path (what the Admin menu
//    actions call)
//  - create_order_atomic persists each line's selected style/add-ons inside
//    the same transaction as the order, its items, and the deductions
//  - a failed order rolls back option rows together with everything else
//  - a legacy "#cc-opt=" marker row still hydrates through the read fallback
// All DB rows use e2e-addon-* ids and are cleaned up regardless of pass/fail.

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

// The exact payloads production rows carried before the marker cleanup
// migration (base64url of {"styles":[...],"addons":[...]}).
const LEGACY_EMPTY_MARKER =
  "/images/logo.jpg#cc-opt=eyJzdHlsZXMiOlsiaWNlZCIsImhvdCJdLCJhZGRvbnMiOltdfQ";
const LEGACY_ADDON_MARKER =
  "/images/logo.jpg#cc-opt=eyJzdHlsZXMiOlsiaWNlZCIsImhvdCJdLCJhZGRvbnMiOlt7ImlkIjoiYWRkb24tMCIsIm5hbWUiOiJPYXQgTWlsayIsInByaWNlIjoyMCwicXR5RW5hYmxlZCI6ZmFsc2UsImludmVudG9yeUl0ZW1JZCI6InN0b2NrLTE3ODk2NDk0MTIzNjgiLCJ1c2FnZUFtb3VudCI6MjAsInVzYWdlVW5pdCI6Im1sIn1dfQ";

test.describe("menu/order option persistence", () => {
  test("parseMenuImageOptions decodes legacy markers and tolerates garbage", () => {
    expect(parseMenuImageOptions("/images/logo.jpg")).toEqual({ styles: [], addons: [] });
    const empty = parseMenuImageOptions(LEGACY_EMPTY_MARKER);
    expect(empty.styles).toEqual(["iced", "hot"]);
    expect(empty.addons).toEqual([]);
    const withAddon = parseMenuImageOptions(LEGACY_ADDON_MARKER);
    expect(withAddon.styles).toEqual(["iced", "hot"]);
    expect(withAddon.addons).toHaveLength(1);
    expect(withAddon.addons[0].name).toBe("Oat Milk");
    expect(withAddon.addons[0].price).toBe(20);
    expect(withAddon.addons[0].inventoryItemId).toBe("stock-1789649412368");
    expect(parseMenuImageOptions("/img.png#cc-opt=!!!not-base64!!!")).toEqual({ styles: [], addons: [] });
    expect(parseMenuImageOptions("/img.png#cc-opt=aGVsbG8")).toEqual({ styles: [], addons: [] });
  });

  test("menu item styles/addons persist through the targeted write path and survive a fresh read", async () => {
    ensureStoreEnv();
    const supabase = supabaseTestClient();
    const id = e2eId("addon-menu");

    try {
      await upsertMenuItemRecord({
        id,
        name: "E2E Addon Drink",
        price: 150,
        category: "Special",
        image: "/images/logo.jpg",
        available: true,
        styles: ["iced"],
        addons: [
          { id: "extra-shot-0", name: "Extra Shot", price: 30, qtyEnabled: true },
        ],
      });

      const { data: row } = await supabase
        .from("menu_items")
        .select("styles, addons, image")
        .eq("id", id)
        .single();
      expect(row?.styles, "styles column persisted").toEqual(["iced"]);
      expect(row?.addons, "addons column persisted").toEqual([
        { id: "extra-shot-0", name: "Extra Shot", price: 30, qtyEnabled: true },
      ]);
      expect(String(row?.image), "no marker ever written to image").not.toContain("#cc-opt=");

      const fresh = await getFreshStore();
      const item = fresh.menu.find((entry) => entry.id === id);
      expect(item?.styles, "fresh read reconstructs styles from DB, not memory").toEqual(["iced"]);
      expect(item?.addons?.map((addon) => addon.name)).toEqual(["Extra Shot"]);
      expect(item?.addons?.[0].price).toBe(30);

      // Edit: change the add-on config and confirm it updates without duplication.
      const current = (await getFreshStore()).menu.find((entry) => entry.id === id)!;
      await upsertMenuItemRecord({
        ...current,
        addons: [
          { id: "extra-shot-0", name: "Extra Shot", price: 30, qtyEnabled: true },
          { id: "oat-milk-1", name: "Oat Milk", price: 20, qtyEnabled: false },
        ],
        styles: ["hot"],
      });
      const afterEdit = await getFreshStore();
      const edited = afterEdit.menu.find((entry) => entry.id === id);
      expect(edited?.styles).toEqual(["hot"]);
      expect(edited?.addons?.map((addon) => addon.name)).toEqual(["Extra Shot", "Oat Milk"]);

      // Delete stays persistent.
      await deleteMenuItemRecord(id);
      const afterDelete = await getFreshStore();
      expect(afterDelete.menu.some((entry) => entry.id === id)).toBe(false);
      const { data: gone } = await supabase.from("menu_items").select("id").eq("id", id);
      expect(gone ?? []).toHaveLength(0);
    } finally {
      await supabase.from("menu_items").delete().eq("id", id);
    }
  });

  test("createOrderAtomic persists style/add-ons on order_items in the same transaction", async () => {
    ensureStoreEnv();
    const supabase = supabaseTestClient();
    const menuId = e2eId("addon-menu");
    const orderId = e2eId("addon-order");
    const { data: category } = await supabase.from("menu_categories").select("id").ilike("name", "Special").limit(1).single();
    await supabase.from("menu_items").insert({
      id: menuId,
      name: "E2E Addon Drink",
      price: 150,
      category_id: category!.id,
      available: true,
      styles: ["iced", "hot"],
      addons: [{ id: "extra-shot-0", name: "Extra Shot", price: 30, qtyEnabled: true }],
    });

    try {
      const result = await createOrderAtomic({
        order: {
          id: orderId,
          createdAt: new Date().toISOString(),
          baristaName: "E2E",
          items: [
            {
              productId: menuId,
              name: "E2E Addon Drink",
              qty: 1,
              price: 180,
              style: "iced",
              addons: [
                { id: "extra-shot-0", name: "Extra Shot", price: 30, qty: 1 },
              ],
            },
          ],
          subtotal: 180,
          total: 180,
          paymentMethod: "cash",
          paid: 180,
          change: 0,
        },
        deductions: [],
      });
      expect(result.ok, "order creation should succeed").toBe(true);

      const { data: line } = await supabase
        .from("order_items")
        .select("name_snapshot, style, addons, menu_item_id")
        .eq("order_id", orderId)
        .single();
      expect(line?.style, "selected style persisted on order_items").toBe("iced");
      expect(line?.addons, "selected add-ons persisted on order_items").toEqual([
        { id: "extra-shot-0", name: "Extra Shot", price: 30, qty: 1 },
      ]);
      expect(line?.name_snapshot, "base name stays clean - options live in columns").toBe("E2E Addon Drink");
      expect(line?.menu_item_id, "menu_item_id resolved from productId").toBe(menuId);
    } finally {
      await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
      await supabase.from("menu_items").delete().eq("id", menuId);
    }
  });

  test("failed order creation leaves no option data behind", async () => {
    const supabase = supabaseTestClient();
    const itemId = e2eId("addon-inv");
    const orderId = e2eId("addon-order");
    await supabase.from("inventory_items").insert({
      id: itemId,
      name: "E2E Addon Stock",
      unit: "ml",
      cost: 1,
      stock: 5,
      max_stock: 1000,
    });

    try {
      const result = await supabase.rpc("create_order_atomic", {
        p_order_id: orderId,
        p_created_at: new Date().toISOString(),
        p_barista_name: "E2E",
        p_barista_user_id: null,
        p_items: [
          {
            productId: "manual-x",
            name: "E2E Addon Drink",
            qty: 1,
            price: 180,
            style: "iced",
            addons: [{ id: "extra-shot-0", name: "Extra Shot", price: 30, qty: 1 }],
          },
        ],
        p_subtotal: 180,
        p_total: 180,
        p_payment_method: "cash",
        p_ticket_no: null,
        p_paid: 180,
        p_change: 0,
        p_deductions: [{ inventoryItemId: itemId, itemName: "E2E Addon Stock", amount: 999, unit: "ml" }],
      });
      expect(result.error?.message).toMatch(/INSUFFICIENT_STOCK/);

      const { data: orders } = await supabase.from("orders").select("id").eq("id", orderId);
      expect(orders ?? [], "no partial parent order").toHaveLength(0);
      const { data: items } = await supabase.from("order_items").select("id").eq("order_id", orderId);
      expect(items ?? [], "no partial order_items/option rows").toHaveLength(0);
      const { data: stock } = await supabase.from("inventory_items").select("stock").eq("id", itemId).single();
      expect(Number(stock?.stock), "inventory unchanged").toBe(5);
    } finally {
      await supabase.from("orders").delete().eq("id", orderId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("a legacy marker row still hydrates through the read fallback", async () => {
    ensureStoreEnv();
    const supabase = supabaseTestClient();
    const id = e2eId("addon-menu");
    const { data: category } = await supabase.from("menu_categories").select("id").ilike("name", "Special").limit(1).single();
    await supabase.from("menu_items").insert({
      id,
      name: "E2E Legacy Marker Drink",
      price: 150,
      category_id: category!.id,
      available: true,
      image: LEGACY_ADDON_MARKER,
      styles: [],
      addons: [],
    });

    try {
      const fresh = await getFreshStore();
      const item = fresh.menu.find((entry) => entry.id === id);
      expect(item, "marker row is readable").toBeTruthy();
      expect(item?.image, "image is stripped of the marker on read").toBe("/images/logo.jpg");
      expect(item?.styles, "styles fall back to the marker payload").toEqual(["iced", "hot"]);
      expect(item?.addons?.map((addon) => addon.name), "add-ons fall back to the marker payload").toEqual(["Oat Milk"]);
    } finally {
      await deleteMenuItemRecord(id);
      await supabase.from("menu_items").delete().eq("id", id);
    }
  });
});
