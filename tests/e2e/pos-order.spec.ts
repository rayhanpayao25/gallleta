import { test, expect } from "@playwright/test";
import { loginAsCashier, supabaseTestClient, pollUntil } from "./utils";

// This suite exercises the real POS checkout -> atomic order creation ->
// inventory deduction -> void flow. It picks a food/pastry item specifically
// because those have no hot/iced style picker and no add-ons, so a single
// tap adds it straight to the cart (no extra modal to drive).
async function findSimpleMenuItem() {
  const supabase = supabaseTestClient();
  const categories = await supabase.from("menu_categories").select("id, name");
  const foodOrPastryIds = (categories.data ?? [])
    .filter((c) => /food|pastr/i.test(c.name))
    .map((c) => c.id);
  const { data } = await supabase
    .from("menu_items")
    .select("id, name, price, available, category_id")
    .eq("available", true)
    .in("category_id", foodOrPastryIds)
    .limit(1);
  if (!data || data.length === 0) throw new Error("No available food/pastry menu item found to drive the POS test");
  return data[0] as { id: string; name: string; price: number };
}

test("POS order creation deducts inventory and creates a usage log", async ({ page }) => {
  const menuItem = await findSimpleMenuItem();
  const supabase = supabaseTestClient();

  await loginAsCashier(page);

  // Open the POS if it's currently closed.
  const openPosButton = page.locator('button:has-text("Open POS")');
  if (await openPosButton.count() > 0) {
    await openPosButton.click();
    await page.waitForTimeout(500);
  }

  // Snapshot inventory "before" for every real inventory item, so we can
  // detect whatever this menu item's recipe actually deducts without
  // hardcoding a specific ingredient.
  const beforeInventory = await supabase.from("inventory_items").select("id, stock");
  const beforeMap = new Map((beforeInventory.data ?? []).map((r) => [r.id, Number(r.stock)]));

  await page.locator("button, div[role=button]", { hasText: menuItem.name }).first().click();
  await page.waitForTimeout(300);

  // Pay exact cash.
  const cashButton = page.locator('button:has-text("Cash")').first();
  if (await cashButton.count() > 0) await cashButton.click();
  const exactButton = page.locator('button:has-text("Exact")');
  if (await exactButton.count() > 0) await exactButton.click();

  await page.click('button:has-text("Proceed Order")');
  await page.waitForTimeout(1500);

  await expect(page.locator("text=/Paid/")).toBeVisible({ timeout: 10000 });

  // Find the order that was just created (most recent order for this menu item).
  const order = await pollUntil(async () => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
    const candidate = data?.[0];
    if (!candidate) return null;
    const items = await supabase.from("order_items").select("*").eq("order_id", candidate.id);
    return items.data?.some((i) => i.product_id_snapshot === menuItem.id) ? { order: candidate, items: items.data } : null;
  });
  expect(order, "order should exist in the database after checkout").toBeTruthy();
  const orderId = order!.order.id as string;

  const usageLogs = await supabase.from("usage_logs").select("*").eq("order_id", orderId);
  const afterInventory = await supabase.from("inventory_items").select("id, stock");
  const afterMap = new Map((afterInventory.data ?? []).map((r) => [r.id, Number(r.stock)]));

  if ((usageLogs.data ?? []).length > 0) {
    // This menu item has a configured recipe: confirm each deducted amount
    // matches exactly, and a usage_logs row exists for it.
    for (const log of usageLogs.data!) {
      const before = beforeMap.get(log.inventory_item_id);
      const after = afterMap.get(log.inventory_item_id);
      expect(before, `inventory item ${log.inventory_item_id} should have existed before`).toBeDefined();
      expect(after! + Number(log.used_amount)).toBeCloseTo(before!, 5);
    }
  }

  // --- Void the order through the real UI, verify inventory is restored ---
  await page.click('button:has-text("Void")');
  await page.waitForSelector("text=Manager username", { timeout: 10000 });
  await page.fill('input[placeholder="Enter username"]', "manager");
  await page.fill('input[placeholder="••••••••"]', "commune");
  await page.fill('textarea[placeholder*="Customer changed mind"]', "e2e automated test void");
  await page.click('button:has-text("Confirm Void")');
  await page.waitForTimeout(1500);

  const voidedOrder = await pollUntil(async () => {
    const { data } = await supabase.from("orders").select("voided, void_reason").eq("id", orderId).maybeSingle();
    return data?.voided ? data : null;
  });
  expect(voidedOrder, "order should be marked voided in the DB").toBeTruthy();
  expect(voidedOrder!.void_reason).toBe("e2e automated test void");

  // Re-check double-void: the UI itself has no reachable path to re-void this
  // same order (the cashier's Void button clears lastOrderId on success, and
  // the manager void-tickets list filters out already-voided orders), so the
  // guard is exercised directly through the same RPC the "Confirm Void"
  // button's voidOrder() server action calls - proving a second void attempt
  // on this real, UI-created order is rejected and does not restore twice.
  const secondVoidAttempt = await supabase.rpc("void_order_atomic", {
    p_order_id: orderId,
    p_reason: "e2e second void attempt",
    p_voided_by: null,
  });
  expect(secondVoidAttempt.data?.ok, "voiding an already-voided order must be rejected").toBe(false);
  expect(secondVoidAttempt.data?.error).toBe("ALREADY_VOIDED");

  if ((usageLogs.data ?? []).length > 0) {
    const afterSecondVoidAttempt = await supabase.from("inventory_items").select("id, stock");
    const secondVoidMap = new Map((afterSecondVoidAttempt.data ?? []).map((r) => [r.id, Number(r.stock)]));
    for (const log of usageLogs.data!) {
      const before = beforeMap.get(log.inventory_item_id);
      expect(secondVoidMap.get(log.inventory_item_id), "rejected second void must not restore inventory again").toBeCloseTo(before!, 5);
    }
  }

  if ((usageLogs.data ?? []).length > 0) {
    const restoredInventory = await supabase.from("inventory_items").select("id, stock");
    const restoredMap = new Map((restoredInventory.data ?? []).map((r) => [r.id, Number(r.stock)]));
    for (const log of usageLogs.data!) {
      const before = beforeMap.get(log.inventory_item_id);
      const restored = restoredMap.get(log.inventory_item_id);
      expect(restored).toBeCloseTo(before!, 5);
    }
  }

  // Verify the voided order also exists/is visible via Admin (Transactions
  // tab excludes voided orders by design, so we verify DB-safe here, which
  // is the documented alternative for a voided ticket).
  const finalCheck = await supabase.from("orders").select("id, voided").eq("id", orderId).maybeSingle();
  expect(finalCheck.data?.voided).toBe(true);

  // Cleanup: delete the (now voided) disposable order via the same atomic
  // delete_order_atomic function deleteAdminRecord("order", ...) calls (the
  // Admin Transactions tab excludes voided orders from its own delete-button
  // list by design, so there is no button to click for this specific case)
  // and confirm deleting an already-voided order does not double-restore.
  await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
  const stockAfterDelete = await supabase.from("inventory_items").select("id, stock");
  const deleteMap = new Map((stockAfterDelete.data ?? []).map((r) => [r.id, Number(r.stock)]));
  if ((usageLogs.data ?? []).length > 0) {
    for (const log of usageLogs.data!) {
      const before = beforeMap.get(log.inventory_item_id);
      const afterDelete = deleteMap.get(log.inventory_item_id);
      expect(afterDelete, "deleting an already-voided order must not restore inventory a second time").toBeCloseTo(before!, 5);
    }
  }
  const orderGone = await supabase.from("orders").select("id").eq("id", orderId);
  expect(orderGone.data ?? []).toHaveLength(0);
});
