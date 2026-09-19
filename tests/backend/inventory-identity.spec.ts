import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import { itemNameEquals, matchesInventoryRow, stockLedgerForRange } from "@/lib/inventory";
import { getFreshStore } from "@/lib/store";

// KAN-125: inventory identity must be inventory_item_id first, then exact
// normalized name for legacy rows. Substring containment previously leaked
// Milk's usage/restock aggregates into "Milk Automation - Stock". These
// specs prove isolation for colliding names, correct ledger math, and that
// the readStore mapping surfaces inventory_item_id for identity matching.
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

ensureStoreEnv();

test.describe("inventory identity matching (KAN-125)", () => {
  test("itemNameEquals is exact after normalization, never a substring", () => {
    expect(itemNameEquals("Milk", "milk")).toBe(true);
    expect(itemNameEquals("  Milk  ", "MILK")).toBe(true);
    expect(itemNameEquals("Milk   Powder", "milk powder")).toBe(true);

    expect(itemNameEquals("Milk", "Milk Automation")).toBe(false);
    expect(itemNameEquals("Milk", "Milk X")).toBe(false);
    expect(itemNameEquals("Milk", "Milk Powder")).toBe(false);
    expect(itemNameEquals("MILK AUTOMATION - STOCK", "Milk")).toBe(false);
    expect(itemNameEquals("Milk", "")).toBe(false);
  });

  test("matchesInventoryRow prefers inventory_item_id and falls back to exact name only for id-less rows", () => {
    const item = { name: "Milk", inventoryItemId: "stock-a" };

    expect(matchesInventoryRow({ itemName: "Milk", inventoryItemId: "stock-a" }, item)).toBe(true);
    // Same name, different item id: belongs to a different item entirely.
    expect(matchesInventoryRow({ itemName: "Milk", inventoryItemId: "stock-b" }, item)).toBe(false);
    // Legacy row without an id matches by exact normalized name.
    expect(matchesInventoryRow({ itemName: " milk " }, item)).toBe(true);
    // Id-less row with an overlapping (not equal) name must not match.
    expect(matchesInventoryRow({ itemName: "Milk Automation - Stock" }, item)).toBe(false);
  });

  test("stockLedgerForRange isolates usage/restocks between colliding names", () => {
    const milkId = "stock-milk";
    const automationId = "stock-milk-automation";
    const date = "2026-09-19T10:00:00.000Z";
    const restocks = [
      { itemName: "Milk", inventoryItemId: milkId, quantityAdded: 10000, date },
      { itemName: "Milk Automation - Stock", inventoryItemId: automationId, quantityAdded: 500, date },
    ];
    const usages = [
      { itemName: "Milk", inventoryItemId: milkId, usedAmount: 286.66, date },
      { itemName: "Milk Automation - Stock", inventoryItemId: automationId, usedAmount: 40, date },
    ];

    const milk = stockLedgerForRange({
      itemName: "Milk",
      inventoryItemId: milkId,
      liveStock: 10000,
      from: "2026-09-19",
      to: "2026-09-19",
      restocks,
      usages,
    });
    expect(milk.restocked).toBe(10000);
    expect(milk.used).toBe(286.66);

    const automation = stockLedgerForRange({
      itemName: "Milk Automation - Stock",
      inventoryItemId: automationId,
      liveStock: 0,
      from: "2026-09-19",
      to: "2026-09-19",
      restocks,
      usages,
    });
    // The new item keeps only its own rows - none of Milk's usage leaks in.
    expect(automation.restocked).toBe(500);
    expect(automation.used).toBe(40);
  });

  test("stockLedgerForRange still honours legacy id-less rows by exact name", () => {
    const date = "2026-09-19T10:00:00.000Z";
    const ledger = stockLedgerForRange({
      itemName: "Milk",
      inventoryItemId: "stock-milk",
      liveStock: 10000,
      from: "2026-09-19",
      to: "2026-09-19",
      restocks: [{ itemName: " milk ", quantityAdded: 1000, date }],
      usages: [
        { itemName: "Milk", usedAmount: 50, date },
        { itemName: "Milk Automation", usedAmount: 999, date },
      ],
    });
    expect(ledger.restocked).toBe(1000);
    expect(ledger.used).toBe(50);
  });

  test("readStore surfaces inventory_item_id on restocks and usage_logs", async () => {
    const supabase = supabaseTestClient();
    const itemId = e2eId("identity-item");
    const restockId = e2eId("identity-restock");
    const usageId = e2eId("identity-usage");

    const { error: itemError } = await supabase.from("inventory_items").insert({
      id: itemId,
      name: `E2E Identity ${itemId}`,
      unit: "ml",
      cost: 1,
      stock: 100,
      max_stock: 1000000,
      purchase_unit_size: 1000,
    });
    expect(itemError, `item insert failed: ${itemError?.message}`).toBeNull();

    const { error: restockError } = await supabase.rpc("create_restock_atomic", {
      p_id: restockId,
      p_inventory_item_id: itemId,
      p_item_name_snapshot: `E2E Identity ${itemId}`,
      p_quantity_added: 1000,
      p_created_at: new Date().toISOString(),
    });
    expect(restockError, `restock rpc failed: ${restockError?.message}`).toBeNull();

    const { error: usageError } = await supabase.from("usage_logs").insert({
      id: usageId,
      order_id: null,
      order_item_id: null,
      inventory_item_id: itemId,
      item_name_snapshot: `E2E Identity ${itemId}`,
      used_amount: 5,
      unit: "ml",
      created_at: new Date().toISOString(),
    });
    expect(usageError, `usage insert failed: ${usageError?.message}`).toBeNull();

    try {
      const store = await getFreshStore();

      const restock = store.restocks.find((row) => row.id === restockId);
      expect(restock, "restock row present in store").toBeTruthy();
      expect(restock?.inventoryItemId).toBe(itemId);

      const usage = store.usageLogs.find((row) => row.id === usageId);
      expect(usage, "usage row present in store").toBeTruthy();
      expect(usage?.inventoryItemId).toBe(itemId);

      // A colliding item name must not claim these rows in the ledger.
      const collider = stockLedgerForRange({
        itemName: `${`E2E Identity ${itemId}`} Extra`,
        liveStock: 0,
        from: "2000-01-01",
        to: "2100-01-01",
        restocks: store.restocks,
        usages: store.usageLogs,
      });
      expect(collider.restocked).toBe(0);
      expect(collider.used).toBe(0);
    } finally {
      await supabase.from("usage_logs").delete().eq("id", usageId);
      await supabase.rpc("delete_restock_atomic", {
        p_id: restockId,
        p_inventory_item_id: null,
        p_quantity_added: null,
      });
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });
});
