import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import { configuredCupIds, ingredientsForOrderLine, looksLikeCupItem } from "@/lib/inventory";
import { hydrateOrderLine, orderSoldAsParts, parseStoredOrderAddons } from "@/lib/menu";
import { phDateString, phIsoFromDate } from "@/lib/datetime";
import type { InventoryItem, OrderItem, RecipeCosting } from "@/lib/types";

// Regression coverage for the low-risk behaviors ported from `ka`:
//  - cup detection is driven by recipe-costing cup assignments, not hardcoded
//    CUP_SKUS names
//  - inline restocks write PH-correct ISO timestamps (+08:00), so a restock
//    always lands in its intended PH calendar-day bucket
//  - packed `pcs` items keep purchaseUnitSize semantics (1 piece = 200 base)
//  - embedded "Name · Iced + Addon P30" snapshot names hydrate for display
// All DB rows use e2e-* ids and are cleaned up regardless of pass/fail.

const inv = (id: string, name: string, unit = "pcs", stock = 100): InventoryItem => ({
  id,
  name,
  unit,
  cost: 1,
  stock,
  maxStock: 100000,
});

const costing = (over: Partial<RecipeCosting>): RecipeCosting => ({
  id: "costing-1",
  name: "Main",
  menuItems: ["Latte"],
  ingredients: [{ inventoryItemId: "milk", name: "Milk", amount: 150, unit: "ml" }],
  ...over,
});

const line = (over: Partial<OrderItem>): OrderItem => ({
  productId: "latte",
  name: "Latte",
  qty: 1,
  price: 120,
  ...over,
});

test.describe("cup config refactor (configured recipe-costing cups)", () => {
  const inventory = [
    inv("milk", "Milk", "ml"),
    inv("cup-hot", "Hot Cup 12oz"),
    inv("cup-iced", "Peta Cup 16oz"),
    inv("cup-other", "Daba Cup 16oz"),
    inv("peta-legacy", "Legacy Cup 22oz"),
  ];
  const recipeCostings = [
    costing({ hotCupInventoryItemId: "cup-hot", icedCupInventoryItemId: "cup-iced", otherCupInventoryItemId: "cup-other" }),
  ];
  const store = { menu: [], recipes: {}, recipeCostings, inventory };

  test("hot / iced / unspecified styles deduct the configured cup", () => {
    const cupFor = (style?: "hot" | "iced") =>
      ingredientsForOrderLine(store, line({ style })).find((ing) => ing.amount === 1 && ing.unit === "pcs")?.inventoryItemId;
    expect(cupFor("hot")).toBe("cup-hot");
    expect(cupFor("iced")).toBe("cup-iced");
    expect(cupFor(undefined)).toBe("cup-other");
  });

  test("a cup ingredient in the recipe is substituted with the style cup", () => {
    const recipeCostingsWithCup = [
      costing({
        icedCupInventoryItemId: "cup-iced",
        ingredients: [
          { inventoryItemId: "milk", name: "Milk", amount: 150, unit: "ml" },
          { inventoryItemId: "peta-legacy", name: "Legacy Cup 22oz", amount: 1, unit: "pcs" },
        ],
      }),
    ];
    const ingredients = ingredientsForOrderLine(
      { ...store, recipeCostings: recipeCostingsWithCup },
      line({ style: "iced" }),
    );
    const cup = ingredients.find((ing) => ing.unit === "pcs" && ing.amount === 1);
    expect(cup?.inventoryItemId).toBe("cup-iced");
    expect(ingredients.filter((ing) => ing.inventoryItemId === "peta-legacy")).toHaveLength(0);
  });

  test("looksLikeCupItem honors configured ids and cup-like names", () => {
    expect(looksLikeCupItem({ id: "cup-hot", name: "Whatever" }, recipeCostings)).toBe(true);
    expect(looksLikeCupItem({ name: "Daba Cup 16oz" }, [])).toBe(true);
    expect(looksLikeCupItem({ id: "milk", name: "Milk" }, recipeCostings)).toBe(false);
    expect(configuredCupIds(recipeCostings)).toEqual(new Set(["cup-hot", "cup-iced", "cup-other"]));
  });
});

test.describe("order-line hydration (read helpers only)", () => {
  test("embedded snapshot names parse into style/addons for display", () => {
    const hydrated = hydrateOrderLine(
      line({ name: "Latte · Iced + Extra Shot ₱30" }),
    );
    expect(hydrated.name).toBe("Latte");
    expect(hydrated.style).toBe("iced");
    expect(hydrated.addons).toHaveLength(1);
    expect(hydrated.addons?.[0].name).toBe("Extra Shot");

    const parts = orderSoldAsParts([hydrated]);
    expect(parts[0].title).toBe("1x Latte");
    expect(parts[0].detail).toContain("Iced");
    expect(parts[0].detail).toContain("Extra Shot ₱30");
  });

  test("stored addons arrays parse defensively", () => {
    expect(parseStoredOrderAddons([{ name: "Oat Milk", price: 25, qty: 2 }])).toMatchObject([
      { name: "Oat Milk", price: 25, qty: 2 },
    ]);
    expect(parseStoredOrderAddons(undefined)).toEqual([]);
    expect(parseStoredOrderAddons("junk")).toEqual([]);
  });
});

test.describe("PH-correct restock timestamps", () => {
  test("phIsoFromDate emits a +08:00 instant that stays in the PH day", () => {
    // A non-today date takes the fixed noon bucket; a today date takes now.
    const past = phIsoFromDate("2020-01-15");
    expect(past).toBe("2020-01-15T12:00:00+08:00");
    expect(phDateString(past)).toBe("2020-01-15");

    const today = phDateString();
    const now = phIsoFromDate(today);
    expect(now).toMatch(/T\d{2}:\d{2}:\d{2}\+08:00$/);
    expect(phDateString(now)).toBe(today);
  });

  test("a late-evening PH restock persists in the same PH day (RPC)", async () => {
    const supabase = supabaseTestClient();
    const itemId = e2eId("ph-restock-item");
    const restockId = e2eId("ph-restock");
    const name = "E2E PH Restock Milk";
    // Yesterday in PH, 23:50 local. If the offset were dropped and the naive
    // time were stored as UTC, this would land in TODAY's PH bucket instead.
    const day = phDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const createdAt = `${day}T23:50:00+08:00`;

    try {
      const { error: itemError } = await supabase.from("inventory_items").insert({
        id: itemId, name, unit: "ml", cost: 1, stock: 0, max_stock: 100000, purchase_unit_size: 1000,
      });
      expect(itemError, itemError?.message).toBeNull();
      const { error } = await supabase.rpc("create_restock_atomic", {
        p_id: restockId,
        p_inventory_item_id: itemId,
        p_item_name_snapshot: name,
        p_quantity_added: 1000,
        p_created_at: createdAt,
      });
      expect(error, error?.message).toBeNull();

      const { data } = await supabase.from("restocks").select("created_at").eq("id", restockId).single();
      const persistedPhDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(data!.created_at as string));
      expect(persistedPhDay, "restock must land in its intended PH day bucket").toBe(day);
    } finally {
      await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("packed pcs items keep purchaseUnitSize semantics (1 piece = pack size)", async () => {
    const supabase = supabaseTestClient();
    const itemId = e2eId("pack-item");
    const restockId = e2eId("pack-restock");
    try {
      const { error: itemError } = await supabase.from("inventory_items").insert({
        id: itemId, name: "E2E Packed Cups", unit: "pcs", cost: 1, stock: 0, max_stock: 100000, purchase_unit_size: 200,
      });
      expect(itemError, itemError?.message).toBeNull();
      // One purchased pack = 200 base pcs (the rejected ka change would have
      // treated 1 "piece" as 1 base unit for pcs items).
      const { error } = await supabase.rpc("create_restock_atomic", {
        p_id: restockId,
        p_inventory_item_id: itemId,
        p_item_name_snapshot: "E2E Packed Cups",
        p_quantity_added: 200,
        p_created_at: new Date().toISOString(),
      });
      expect(error, error?.message).toBeNull();
      const { data } = await supabase.from("inventory_items").select("stock").eq("id", itemId).single();
      expect(Number(data?.stock)).toBe(200);
    } finally {
      await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });
});
