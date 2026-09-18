import { test, expect } from "@playwright/test";
import { loginAsAdmin, openAdminPanel, supabaseTestClient, pollUntil, e2eId } from "./utils";

// E2E regression coverage for the low-risk `ka` ports:
//  - packed `pcs` items keep purchaseUnitSize semantics (1 piece = pack size)
//  - inline restock submits via Enter (form submit) and stays atomic
//  - transaction delete uses the atomic path: UI row disappears, order +
//    usage_logs are removed, stock is restored exactly once
//  - order lines with option details render title + detail via DrinkLines
// All rows use e2e-* ids/names and are cleaned up regardless of pass/fail.

const phDayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));

test("packed pcs item: inline restock of 1 piece adds the full pack via Enter", async ({ page }) => {
  const supabase = supabaseTestClient();
  const itemId = e2eId("pack-ui-item");
  const itemName = `E2E Pack Cups ${itemId.slice(-6)}`;
  let restockId = "";

  const { error } = await supabase.from("inventory_items").insert({
    id: itemId, name: itemName, unit: "pcs", cost: 1, stock: 0, max_stock: 100000, purchase_unit_size: 200,
  });
  expect(error, error?.message).toBeNull();

  try {
    await loginAsAdmin(page);
    await openAdminPanel(page, "Inventory");
    await page.click('button:has-text("Stock Inventory")');
    await page.waitForSelector("text=Add Stock Item", { timeout: 15000 });

    const stockRow = page.locator("tr", { hasText: itemName }).first();
    await stockRow.locator('input[placeholder="+Qty"]').fill("1");
    // Enter submits the inline restock form.
    await stockRow.locator('input[placeholder="+Qty"]').press("Enter");

    const created = await pollUntil(async () => {
      const { data } = await supabase
        .from("restocks")
        .select("id, quantity_added")
        .eq("item_name_snapshot", itemName)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    });
    expect(created, "restock persisted via Enter submit").toBeTruthy();
    restockId = created!.id as string;
    // 1 purchased pack of a pcs item with purchaseUnitSize=200 adds 200 base
    // pcs - NOT 1 (the rejected ka pieceSize override would have stored 1).
    expect(Number(created!.quantity_added)).toBe(200);
    const { data: stockRow_ } = await supabase.from("inventory_items").select("stock").eq("id", itemId).single();
    expect(Number(stockRow_?.stock)).toBe(200);
  } finally {
    if (restockId) await supabase.from("restocks").delete().eq("id", restockId);
    await supabase.from("inventory_items").delete().eq("id", itemId);
  }
});

test("transaction delete via UI removes the order and restores stock exactly once", async ({ page }) => {
  const supabase = supabaseTestClient();
  const itemId = e2eId("del-item");
  const orderId = e2eId("del-order");
  const itemName = `E2E Del Milk ${itemId.slice(-6)}`;
  const menuItem = (await supabase.from("menu_items").select("id, name, price").limit(1).single()).data!;
  // Unique snapshot name so the transactions row is unambiguous - the delete
  // click can never hit a real order's row.
  const drinkName = `E2E Del Drink ${orderId.slice(-6)}`;

  await supabase.from("inventory_items").insert({
    id: itemId, name: itemName, unit: "pcs", cost: 1, stock: 10, max_stock: 1000,
  });
  const { error } = await supabase.rpc("create_order_atomic", {
    p_order_id: orderId,
    p_created_at: new Date().toISOString(),
    p_barista_name: "E2E",
    p_barista_user_id: null,
    p_items: [{ productId: menuItem.id, name: drinkName, qty: 1, price: menuItem.price }],
    p_subtotal: menuItem.price, p_discount: 0, p_promo_id: null, p_promo_label: null,
    p_total: menuItem.price, p_payment_method: "cash", p_ticket_no: "E2E",
    p_paid: menuItem.price, p_change: 0,
    p_deductions: [{ inventoryItemId: itemId, itemName: itemName, amount: 3, unit: "pcs" }],
  });
  expect(error, error?.message).toBeNull();
  const { data: afterOrder } = await supabase.from("inventory_items").select("stock").eq("id", itemId).single();
  expect(Number(afterOrder?.stock)).toBe(7);

  try {
    await loginAsAdmin(page);
    await openAdminPanel(page, "Inventory");
    await page.click('button:has-text("Transactions")');
    const day = phDayOf(new Date().toISOString());
    await page.locator('input[type="date"]').fill(day);
    const row = page.locator("tr", { hasText: drinkName }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator(`[aria-label^="Delete "]`).click();

    await pollUntil(async () => {
      const { data } = await supabase.from("orders").select("id").eq("id", orderId);
      return (data ?? []).length === 0 ? true : null;
    });
    expect((await supabase.from("usage_logs").select("id").eq("order_id", orderId)).data ?? []).toHaveLength(0);
    const { data: restored } = await supabase.from("inventory_items").select("stock").eq("id", itemId).single();
    expect(Number(restored?.stock), "delete_order_atomic restores stock exactly once").toBe(10);
    await expect(page.locator("tr", { hasText: drinkName })).toHaveCount(0);
  } finally {
    await supabase.from("orders").delete().eq("id", orderId);
    await supabase.from("inventory_items").delete().eq("id", itemId);
  }
});

test("order lines render title + option detail (hydrated snapshot names)", async ({ page }) => {
  const supabase = supabaseTestClient();
  const orderId = e2eId("opt-order");
  const menuItem = (await supabase.from("menu_items").select("id, name, price").limit(1).single()).data!;
  const embeddedName = `E2E Opt Drink ${orderId.slice(-6)} · Iced + Extra Shot ₱30`;

  const { error } = await supabase.rpc("create_order_atomic", {
    p_order_id: orderId,
    p_created_at: new Date().toISOString(),
    p_barista_name: "E2E",
    p_barista_user_id: null,
    p_items: [{ productId: menuItem.id, name: embeddedName, qty: 1, price: menuItem.price }],
    p_subtotal: menuItem.price, p_discount: 0, p_promo_id: null, p_promo_label: null,
    p_total: menuItem.price, p_payment_method: "cash", p_ticket_no: "E2E",
    p_paid: menuItem.price, p_change: 0,
    p_deductions: [],
  });
  expect(error, error?.message).toBeNull();

  try {
    await loginAsAdmin(page);
    await openAdminPanel(page, "Inventory");
    await page.click('button:has-text("Transactions")');
    const day = phDayOf(new Date().toISOString());
    await page.locator('input[type="date"]').fill(day);
    const row = page.locator("tr", { hasText: "E2E Opt Drink" }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    // Hydration splits the embedded snapshot into a clean title + detail line.
    await expect(row.locator("td").nth(1)).toContainText("Iced", { timeout: 15000 });
    await expect(row.locator("td").nth(1)).toContainText("Extra Shot ₱30");
  } finally {
    await supabase.from("orders").delete().eq("id", orderId);
  }
});
