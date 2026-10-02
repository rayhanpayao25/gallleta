import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";

// These call the Postgres RPCs directly (create_order_atomic,
// delete_order_atomic) against the live, shared Supabase
// project - no browser needed. Every row uses an e2e-* id and is cleaned up
// regardless of pass/fail.

test.describe("order creation atomicity", () => {
  test("failure injection: insufficient stock rolls back the entire order (no partial rows, no partial inventory change)", async () => {
    const supabase = supabaseTestClient();
    const realMenuItem = (await supabase.from("menu_items").select("id, name, price").limit(1).single()).data!;
    const itemId = e2eId("inv");
    await supabase.from("inventory_items").insert({ id: itemId, name: "E2E Rollback Item", unit: "pcs", cost: 1, stock: 2, max_stock: 100 });
    const orderId = e2eId("order");

    try {
      const result = await supabase.rpc("create_order_atomic", {
        p_order_id: orderId,
        p_created_at: new Date().toISOString(),
        p_barista_name: "E2E",
        p_barista_user_id: null,
        p_items: [{ productId: realMenuItem.id, name: realMenuItem.name, qty: 1, price: realMenuItem.price }],
        p_subtotal: realMenuItem.price,
        p_total: realMenuItem.price,
        p_payment_method: "cash",
        p_ticket_no: "E2E",
        p_paid: realMenuItem.price,
        p_change: 0,
        p_deductions: [{ inventoryItemId: itemId, itemName: "E2E Rollback Item", amount: 999, unit: "pcs" }],
      });
      expect(result.error?.message).toMatch(/INSUFFICIENT_STOCK/);

      const order = await supabase.from("orders").select("id").eq("id", orderId);
      expect(order.data ?? [], "no partial parent order row").toHaveLength(0);
      const items = await supabase.from("order_items").select("id").eq("order_id", orderId);
      expect(items.data ?? [], "no partial order_items rows").toHaveLength(0);
      const usage = await supabase.from("usage_logs").select("id").eq("order_id", orderId);
      expect(usage.data ?? [], "no orphan usage_logs rows").toHaveLength(0);
      const stock = await supabase.from("inventory_items").select("stock").eq("id", itemId).maybeSingle();
      expect(Number(stock.data?.stock), "inventory unchanged, never negative").toBe(2);
    } finally {
      await supabase.from("orders").delete().eq("id", orderId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });

  test("concurrency: stock for 2, fire 3 concurrent orders, exactly 2 succeed and stock never goes negative", async () => {
    const supabase = supabaseTestClient();
    const realMenuItem = (await supabase.from("menu_items").select("id, name, price").limit(1).single()).data!;
    const itemId = e2eId("inv");
    await supabase.from("inventory_items").insert({ id: itemId, name: "E2E Concurrency Item", unit: "pcs", cost: 1, stock: 2, max_stock: 100 });
    const orderIds = [e2eId("order"), e2eId("order"), e2eId("order")];

    try {
      const makeOrder = (orderId: string) =>
        supabase.rpc("create_order_atomic", {
          p_order_id: orderId,
          p_created_at: new Date().toISOString(),
          p_barista_name: "E2E",
          p_barista_user_id: null,
          p_items: [{ productId: realMenuItem.id, name: realMenuItem.name, qty: 1, price: realMenuItem.price }],
          p_subtotal: realMenuItem.price,
          p_total: realMenuItem.price,
          p_payment_method: "cash",
          p_ticket_no: orderId,
          p_paid: realMenuItem.price,
          p_change: 0,
          p_deductions: [{ inventoryItemId: itemId, itemName: "E2E Concurrency Item", amount: 1, unit: "pcs" }],
        });

      const results = await Promise.all(orderIds.map(makeOrder));
      const succeeded = results.filter((r) => r.data?.ok === true);
      const failed = results.filter((r) => r.error);

      expect(succeeded).toHaveLength(2);
      expect(failed).toHaveLength(1);
      expect(failed[0].error?.message).toMatch(/INSUFFICIENT_STOCK/);

      const stock = await supabase.from("inventory_items").select("stock").eq("id", itemId).maybeSingle();
      expect(Number(stock.data?.stock)).toBe(0);
      const orders = await supabase.from("orders").select("id").in("id", orderIds);
      expect(orders.data ?? []).toHaveLength(2);
      const usage = await supabase.from("usage_logs").select("id").eq("inventory_item_id", itemId);
      expect(usage.data ?? []).toHaveLength(2);
    } finally {
      await supabase.from("orders").delete().in("id", orderIds);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });
});

test.describe("delete-order restoration", () => {
  test("deleting an order restores inventory", async () => {
    const supabase = supabaseTestClient();
    const realMenuItem = (await supabase.from("menu_items").select("id, name, price").limit(1).single()).data!;
    const itemId = e2eId("inv");
    await supabase.from("inventory_items").insert({ id: itemId, name: "E2E Delete Item", unit: "pcs", cost: 1, stock: 10, max_stock: 100 });
    const orderA = e2eId("order");

    try {
      await supabase.rpc("create_order_atomic", {
        p_order_id: orderA, p_created_at: new Date().toISOString(), p_barista_name: "E2E", p_barista_user_id: null,
        p_items: [{ productId: realMenuItem.id, name: realMenuItem.name, qty: 1, price: realMenuItem.price }],
        p_subtotal: realMenuItem.price, p_total: realMenuItem.price,
        p_payment_method: "cash", p_ticket_no: "A", p_paid: realMenuItem.price, p_change: 0,
        p_deductions: [{ inventoryItemId: itemId, itemName: "E2E Delete Item", amount: 3, unit: "pcs" }],
      });
      await supabase.rpc("delete_order_atomic", { p_order_id: orderA });
      const stockAfterA = await supabase.from("inventory_items").select("stock").eq("id", itemId).maybeSingle();
      expect(Number(stockAfterA.data?.stock), "restored after deleting order").toBe(10);
      expect((await supabase.from("orders").select("id").eq("id", orderA)).data ?? []).toHaveLength(0);
      expect((await supabase.from("usage_logs").select("id").eq("order_id", orderA)).data ?? []).toHaveLength(0);

    } finally {
      await supabase.from("orders").delete().eq("id", orderA);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });
});

test.describe("restock atomicity", () => {
  test("create/edit/delete restock keep the ledger and inventory quantity in lockstep", async () => {
    const supabase = supabaseTestClient();
    const itemId = e2eId("inv");
    await supabase.from("inventory_items").insert({ id: itemId, name: "E2E Restock Item", unit: "pcs", cost: 1, stock: 5, max_stock: 1000 });
    const restockId = e2eId("restock");

    try {
      await supabase.rpc("create_restock_atomic", { p_id: restockId, p_inventory_item_id: itemId, p_item_name_snapshot: "E2E Restock Item", p_quantity_added: 10, p_created_at: new Date().toISOString() });
      expect(Number((await supabase.from("inventory_items").select("stock").eq("id", itemId).maybeSingle()).data?.stock)).toBe(15);

      await supabase.rpc("edit_restock_atomic", { p_id: restockId, p_old_inventory_item_id: itemId, p_old_quantity: 10, p_new_inventory_item_id: itemId, p_new_item_name_snapshot: "E2E Restock Item", p_new_quantity: 20, p_new_created_at: new Date().toISOString() });
      expect(Number((await supabase.from("inventory_items").select("stock").eq("id", itemId).maybeSingle()).data?.stock)).toBe(25);
      expect(Number((await supabase.from("restocks").select("quantity_added").eq("id", restockId).maybeSingle()).data?.quantity_added)).toBe(20);

      await supabase.rpc("delete_restock_atomic", { p_id: restockId, p_inventory_item_id: itemId, p_quantity_added: 20 });
      expect(Number((await supabase.from("inventory_items").select("stock").eq("id", itemId).maybeSingle()).data?.stock)).toBe(5);
      expect((await supabase.from("restocks").select("id").eq("id", restockId)).data ?? []).toHaveLength(0);
    } finally {
      await supabase.from("restocks").delete().eq("id", restockId);
      await supabase.from("inventory_items").delete().eq("id", itemId);
    }
  });
});
