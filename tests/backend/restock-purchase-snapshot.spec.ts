import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import {
  createRestockAtomic,
  editRestockAtomic,
  getFreshStore,
} from "@/lib/store";

// KAN-126: the restocks row persists the purchase-facing entry (purchase
// qty/unit, e.g. "10 pcs") alongside the normalized base-unit
// quantity_added (e.g. 10000 ml). quantity_added semantics are unchanged
// and delete_restock_atomic still reverses from the persisted normalized
// quantity. Legacy rows keep NULL snapshot fields and stay readable.
// All rows use e2e-* ids and are cleaned up regardless of pass/fail.

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

type Supabase = ReturnType<typeof supabaseTestClient>;

async function stockOf(supabase: Supabase, itemId: string) {
  const { data } = await supabase
    .from("inventory_items")
    .select("stock")
    .eq("id", itemId)
    .single();
  return Number(data?.stock);
}

test.describe("restock purchase snapshot (KAN-126)", () => {
  test("create persists purchase qty/unit + normalized quantity atomically; edit and delete stay consistent", async () => {
    const supabase = supabaseTestClient();
    const itemId = e2eId("purchase-item");
    const restockId = e2eId("purchase-restock");
    const name = `E2E Purchase ${itemId}`;

    const { error: itemError } = await supabase.from("inventory_items").insert({
      id: itemId,
      name,
      unit: "ml",
      cost: 1,
      stock: 0,
      max_stock: 1000000,
      purchase_unit_size: 1000,
    });
    expect(itemError, `item insert failed: ${itemError?.message}`).toBeNull();

    try {
      // Admin enters "10 pcs"; the item's purchase_unit_size is 1000 ml/pc.
      await createRestockAtomic({
        id: restockId,
        inventoryItemId: itemId,
        itemNameSnapshot: name,
        quantityAdded: 10000,
        createdAt: new Date().toISOString(),
        purchaseQty: 10,
        purchaseUnit: "pcs",
      });

      const { data: row } = await supabase
        .from("restocks")
        .select("quantity_added, purchase_qty, purchase_unit, inventory_item_id")
        .eq("id", restockId)
        .single();
      expect(Number(row?.quantity_added), "normalized base-unit quantity").toBe(10000);
      expect(Number(row?.purchase_qty), "purchase-facing quantity").toBe(10);
      expect(row?.purchase_unit, "purchase-facing unit").toBe("pcs");
      expect(row?.inventory_item_id).toBe(itemId);
      expect(await stockOf(supabase, itemId), "stock increases by normalized qty").toBe(10000);

      // The persisted snapshot survives later item-config changes.
      await supabase
        .from("inventory_items")
        .update({ purchase_unit_size: 500 })
        .eq("id", itemId);
      const store = await getFreshStore();
      const record = store.restocks.find((entry) => entry.id === restockId);
      expect(record?.purchaseQty, "snapshot is persisted, not recomputed").toBe(10);
      expect(record?.purchaseUnit).toBe("pcs");

      // Edit keeps both representations mutually consistent atomically.
      await editRestockAtomic({
        id: restockId,
        oldInventoryItemId: itemId,
        oldQuantity: 10000,
        newInventoryItemId: itemId,
        newItemNameSnapshot: name,
        newQuantity: 10000,
        newCreatedAt: new Date().toISOString(),
        newPurchaseQty: 20,
        newPurchaseUnit: "pcs",
      });
      const { data: edited } = await supabase
        .from("restocks")
        .select("quantity_added, purchase_qty, purchase_unit")
        .eq("id", restockId)
        .single();
      expect(Number(edited?.quantity_added)).toBe(10000);
      expect(Number(edited?.purchase_qty)).toBe(20);
      expect(edited?.purchase_unit).toBe("pcs");
      expect(await stockOf(supabase, itemId)).toBe(10000);

      // Authoritative delete reverses the persisted normalized quantity.
      const { error: deleteError } = await supabase.rpc("delete_restock_atomic", {
        p_id: restockId,
        p_inventory_item_id: null,
        p_quantity_added: null,
      });
      expect(deleteError, `delete failed: ${deleteError?.message}`).toBeNull();
      expect(await stockOf(supabase, itemId), "stock restored to baseline").toBe(0);
      const { data: gone } = await supabase.from("restocks").select("id").eq("id", restockId);
      expect(gone ?? []).toHaveLength(0);
    } finally {
      const { data: leftover } = await supabase
        .from("restocks")
        .select("id")
        .eq("id", restockId);
      if ((leftover ?? []).length > 0) {
        await supabase.rpc("delete_restock_atomic", {
          p_id: restockId,
          p_inventory_item_id: null,
          p_quantity_added: null,
        });
      }
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("legacy rows without purchase snapshot stay readable", async () => {
    const supabase = supabaseTestClient();
    const restockId = e2eId("legacy-restock");
    const { error } = await supabase.from("restocks").insert({
      id: restockId,
      inventory_item_id: null,
      item_name_snapshot: `E2E Legacy ${restockId}`,
      quantity_added: 500,
      created_at: new Date().toISOString(),
    });
    expect(error, `legacy insert failed: ${error?.message}`).toBeNull();

    try {
      const store = await getFreshStore();
      const record = store.restocks.find((entry) => entry.id === restockId);
      expect(record, "legacy row maps into the store").toBeTruthy();
      expect(record?.quantityAdded).toBe(500);
      expect(record?.purchaseQty, "no fabricated snapshot").toBeUndefined();
      expect(record?.purchaseUnit).toBeUndefined();
    } finally {
      await supabase.from("restocks").delete().eq("id", restockId);
    }
  });
});
