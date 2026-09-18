import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsCashier, openAdminPanel, supabaseTestClient, pollUntil, e2eId } from "./utils";

// End-to-end coverage for clean option persistence:
//  - Admin creates a menu item with a style restriction + an add-on through
//    the real Menu form; values land in menu_items.styles/addons and survive
//    a full page reload (cold render, no memory carry-over)
//  - the cashier POS picks the style + add-on through the real drink-options
//    modal; create_order_atomic persists them on order_items in the same
//    transaction
//  - the Transactions tab renders the persisted options (title/detail split)
// Every row uses an e2e-addon-* id and is cleaned up regardless of pass/fail.

test("menu add-on config and order-line options persist through the real UI", async ({ page, browser }) => {
  const supabase = supabaseTestClient();
  const itemName = `E2E Addon Drink ${e2eId("ui")}`;
  let orderId: string | null = null;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Menu");
  await page.click('button:has-text("Add item")');

  const form = page.locator("form").filter({ hasText: "New item" });
  await form.locator("input").nth(0).fill(itemName);
  await form.locator('input[type="number"]').fill("150");
  await form.locator("select").selectOption({ label: "Special" });
  // Both styles default to on - turn "Hot" off so the item is iced-only.
  await form.locator('button:has-text("Hot")').click();
  await form.locator('button:has-text("Add option")').click();
  await form.locator('input[placeholder="Oat milk"]').fill("Extra Shot");
  await form.locator('input[aria-label="Add-on extra price"]').fill("30");
  await form.locator('button[type="submit"]').click();

  await expect(page.locator("tr", { hasText: itemName })).toBeVisible({ timeout: 15000 });

  // Full reload = cold render: the add-on detail must come back from the DB
  // columns, not from any in-memory carry-over.
  await page.reload();
  await openAdminPanel(page, "Menu");
  const savedRow = page.locator("tr", { hasText: itemName });
  await expect(savedRow).toBeVisible({ timeout: 15000 });
  await expect(savedRow).toContainText("Extra Shot");
  // The Type column (td index 2) must read exactly "Iced" - checking the cell
  // directly since "Extra Shot" itself contains the substring "hot".
  await expect(savedRow.locator("td").nth(2)).toHaveText("Iced");

  const { data: menuRow } = await supabase
    .from("menu_items")
    .select("id, styles, addons, image")
    .eq("name", itemName)
    .single();
  const menuItemId = menuRow?.id as string;
  expect(menuRow?.styles, "styles column persisted").toEqual(["iced"]);
  expect(menuRow?.addons?.[0]?.name).toBe("Extra Shot");
  expect(menuRow?.addons?.[0]?.price).toBe(30);
  expect(String(menuRow?.image), "no marker ever written to image").not.toContain("#cc-opt=");

  try {
    // Cashier orders through the real POS in a fresh browser context (the
    // cashier gate redirects away if an admin session shares the context).
    const cashierPage = await browser.newPage();
    try {
      await loginAsCashier(cashierPage);
      const openPos = cashierPage.locator('button:has-text("Open POS")');
      if (await openPos.count() > 0) {
        await openPos.click();
        await cashierPage.waitForTimeout(800);
      }

      await cashierPage.locator("button", { hasText: itemName }).first().click();
      // Iced-only item: the options modal goes straight to add-ons.
      await cashierPage.locator("button", { hasText: "Extra Shot" }).click();
      await cashierPage.locator('button:has-text("Add to checkout")').click();

      const cashButton = cashierPage.locator('button:has-text("Cash")').first();
      if (await cashButton.count() > 0) await cashButton.click();
      const exactButton = cashierPage.locator('button:has-text("Exact")');
      if (await exactButton.count() > 0) await exactButton.click();
      await cashierPage.click('button:has-text("Proceed Order")');
      await expect(cashierPage.locator("text=/Paid/")).toBeVisible({ timeout: 15000 });
    } finally {
      await cashierPage.close();
    }

    const found = await pollUntil(async () => {
      const { data } = await supabase
        .from("order_items")
        .select("order_id, name_snapshot, style, addons")
        .eq("name_snapshot", itemName)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    });
    expect(found, "order_items row exists for the POS order").toBeTruthy();
    orderId = found!.order_id as string;
    expect(found!.style, "selected style persisted on order_items").toBe("iced");
    expect(found!.addons, "selected add-ons persisted on order_items").toEqual([
      expect.objectContaining({ name: "Extra Shot", price: 30, qty: 1 }),
    ]);
    expect(found!.name_snapshot, "base name stays clean").toBe(itemName);

    // Transactions tab renders the persisted option detail after a reload.
    await openAdminPanel(page, "Inventory");
    await page.click('button:has-text("Transactions")');
    const txRow = page.locator("tr", { hasText: itemName }).first();
    await expect(txRow).toBeVisible({ timeout: 15000 });
    await expect(txRow).toContainText("Extra Shot");
    await expect(txRow).toContainText("Iced");
  } finally {
    if (orderId) await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
    if (menuItemId) await supabase.from("menu_items").delete().eq("id", menuItemId);
    if (!menuItemId) await supabase.from("menu_items").delete().eq("name", itemName);
  }
});
