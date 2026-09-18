import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId, pollUntil } from "../e2e/utils";

// delete_restock_atomic must reverse stock from the PERSISTED restock row -
// the caller-supplied inventory id/quantity are ignored (kept only for
// signature compatibility with older deployed builds). All rows use e2e-*
// ids and are cleaned up regardless of pass/fail.

type Supabase = ReturnType<typeof supabaseTestClient>;

async function makeItem(supabase: Supabase, name: string, stock = 0, unit = "ml", pack = 1000) {
  const id = e2eId("restock-del-item");
  const { error } = await supabase.from("inventory_items").insert({
    id, name, unit, cost: 1, stock, max_stock: 1000000, purchase_unit_size: pack,
  });
  expect(error, `item insert failed: ${error?.message}`).toBeNull();
  return id;
}

async function stockOf(supabase: Supabase, itemId: string) {
  const { data } = await supabase.from("inventory_items").select("stock").eq("id", itemId).single();
  return Number(data?.stock);
}

async function createRestock(supabase: Supabase, itemId: string, name: string, qty: number, fk: string | null = itemId) {
  const id = e2eId("restock-del");
  const { error } = await supabase.rpc("create_restock_atomic", {
    p_id: id,
    p_inventory_item_id: fk,
    p_item_name_snapshot: name,
    p_quantity_added: qty,
    p_created_at: new Date().toISOString(),
  });
  expect(error, `create_restock_atomic failed: ${error?.message}`).toBeNull();
  return id;
}

test.describe("restock delete reversal (persisted row is authoritative)", () => {
  test("create adds stock; delete returns stock to the exact baseline", async () => {
    const supabase = supabaseTestClient();
    const itemId = await makeItem(supabase, "E2E RD Baseline Milk", 5000);
    let restockId = "";
    try {
      restockId = await createRestock(supabase, itemId, "E2E RD Baseline Milk", 20000);
      expect(await stockOf(supabase, itemId)).toBe(25000);

      const { data, error } = await supabase.rpc("delete_restock_atomic", {
        p_id: restockId, p_inventory_item_id: itemId, p_quantity_added: 20000,
      });
      expect(error, error?.message).toBeNull();
      expect(data?.reversed).toBe(true);
      expect(await stockOf(supabase, itemId), "stock must return to baseline").toBe(5000);
      const { data: gone } = await supabase.from("restocks").select("id").eq("id", restockId);
      expect(gone ?? []).toHaveLength(0);
      restockId = "";
    } finally {
      if (restockId) await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("caller passes null inventory id: persisted row still reverses", async () => {
    const supabase = supabaseTestClient();
    const itemId = await makeItem(supabase, "E2E RD NullParam Milk");
    let restockId = "";
    try {
      restockId = await createRestock(supabase, itemId, "E2E RD NullParam Milk", 20000);
      const { data, error } = await supabase.rpc("delete_restock_atomic", {
        p_id: restockId, p_inventory_item_id: null, p_quantity_added: null,
      });
      expect(error, error?.message).toBeNull();
      expect(data?.reversed).toBe(true);
      expect(data?.inventoryItemId).toBe(itemId);
      expect(await stockOf(supabase, itemId)).toBe(0);
      restockId = "";
    } finally {
      if (restockId) await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("caller passes a wrong/stale inventory id: persisted row wins", async () => {
    const supabase = supabaseTestClient();
    const itemId = await makeItem(supabase, "E2E RD StaleParam Milk");
    const wrongId = await makeItem(supabase, "E2E RD Wrong Item");
    let restockId = "";
    try {
      restockId = await createRestock(supabase, itemId, "E2E RD StaleParam Milk", 20000);
      // Stale caller claims a different item and a different quantity.
      const { data, error } = await supabase.rpc("delete_restock_atomic", {
        p_id: restockId, p_inventory_item_id: wrongId, p_quantity_added: 5,
      });
      expect(error, error?.message).toBeNull();
      expect(data?.reversed).toBe(true);
      expect(data?.inventoryItemId).toBe(itemId);
      expect(await stockOf(supabase, itemId), "real item reversed by persisted qty").toBe(0);
      expect(await stockOf(supabase, wrongId), "unrelated item untouched").toBe(0);
      restockId = "";
    } finally {
      if (restockId) await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
      await supabase.from("inventory_items").delete().eq("id", wrongId);
    }
  });

  test("concurrent double delete: one succeeds, one not-found, stock restored once", async () => {
    const supabase = supabaseTestClient();
    const itemId = await makeItem(supabase, "E2E RD Race Milk");
    let restockId = "";
    try {
      restockId = await createRestock(supabase, itemId, "E2E RD Race Milk", 20000);
      const [r1, r2] = await Promise.all([
        supabase.rpc("delete_restock_atomic", { p_id: restockId, p_inventory_item_id: null, p_quantity_added: null }),
        supabase.rpc("delete_restock_atomic", { p_id: restockId, p_inventory_item_id: null, p_quantity_added: null }),
      ]);
      const results = [r1, r2];
      const okCount = results.filter((r) => !r.error).length;
      const notFound = results.filter((r) => r.error?.message.includes("not found")).length;
      expect(okCount, "exactly one delete succeeds").toBe(1);
      expect(notFound, "loser gets a clear not-found error").toBe(1);
      await pollUntil(async () => (await stockOf(supabase, itemId)) === 0 ? true : null);
      expect(await stockOf(supabase, itemId), "reversal applied exactly once").toBe(0);
      restockId = "";
    } finally {
      if (restockId) await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("legacy null-FK row: unambiguous exact-name fallback reverses", async () => {
    const supabase = supabaseTestClient();
    const name = "E2E RD Legacy Beans";
    const itemId = await makeItem(supabase, name, 100);
    let restockId = "";
    try {
      // A null-FK restock cannot credit stock at creation (no item to hit),
      // so stock stays at baseline while the ledger row exists - matching
      // how the real legacy rows were written.
      restockId = await createRestock(supabase, itemId, name, 40, null);
      expect(await stockOf(supabase, itemId)).toBe(100);
      const { data, error } = await supabase.rpc("delete_restock_atomic", {
        p_id: restockId, p_inventory_item_id: null, p_quantity_added: null,
      });
      expect(error, error?.message).toBeNull();
      expect(data?.reversed).toBe(true);
      expect(data?.inventoryItemId).toBe(itemId);
      // The unambiguous exact-name fallback reverses the persisted quantity.
      expect(await stockOf(supabase, itemId)).toBe(60);
      restockId = "";
    } finally {
      if (restockId) await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("reversal never drives stock negative (clamped at 0)", async () => {
    const supabase = supabaseTestClient();
    const itemId = await makeItem(supabase, "E2E RD Floor Milk");
    let restockId = "";
    try {
      restockId = await createRestock(supabase, itemId, "E2E RD Floor Milk", 20000);
      // Orders consumed most of the restocked stock before the delete.
      await supabase.from("inventory_items").update({ stock: 3000 }).eq("id", itemId);
      const { data, error } = await supabase.rpc("delete_restock_atomic", {
        p_id: restockId, p_inventory_item_id: null, p_quantity_added: null,
      });
      expect(error, error?.message).toBeNull();
      expect(data?.reversed).toBe(true);
      expect(await stockOf(supabase, itemId), "clamped, never negative").toBe(0);
      restockId = "";
    } finally {
      if (restockId) await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("restock whose inventory item was deleted: ledger removed, reversed=false reported", async () => {
    const supabase = supabaseTestClient();
    const itemId = await makeItem(supabase, "E2E RD Orphan Milk");
    const restockId = await createRestock(supabase, itemId, "E2E RD Orphan Milk", 20000);
    await supabase.from("inventory_items").delete().eq("id", itemId);
    const { data, error } = await supabase.rpc("delete_restock_atomic", {
      p_id: restockId, p_inventory_item_id: null, p_quantity_added: null,
    });
    expect(error, error?.message).toBeNull();
    expect(data?.reversed, "nothing to reverse - reported, not silent").toBe(false);
    const { data: gone } = await supabase.from("restocks").select("id").eq("id", restockId);
    expect(gone ?? []).toHaveLength(0);
  });

  test("deleting a nonexistent restock raises not-found", async () => {
    const supabase = supabaseTestClient();
    const { error } = await supabase.rpc("delete_restock_atomic", {
      p_id: e2eId("restock-missing"), p_inventory_item_id: null, p_quantity_added: null,
    });
    expect(error?.message).toMatch(/not found/);
  });
});
