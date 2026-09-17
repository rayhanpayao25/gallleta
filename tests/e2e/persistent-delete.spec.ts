import { test, expect } from "@playwright/test";
import { loginAsAdmin, openAdminPanel, reloadIntoAdminPanel, supabaseTestClient, pollUntil, e2eId } from "./utils";

test("inventory item: create, delete via UI, reload, stays gone", async ({ page }) => {
  const supabase = supabaseTestClient();
  const itemName = `E2E Inv ${e2eId("item")}`;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Inventory");
  await page.click('button:has-text("Stock Inventory")');
  await page.waitForSelector("text=Add Stock Item", { timeout: 10000 });

  await page.fill('input[placeholder="e.g. Coffee Beans"]', itemName);
  await page.fill('input[placeholder="0"]', "1");
  await page.fill('input[placeholder="grams, ml, pcs"]', "pcs");
  await page.click('button[type="submit"]:has-text("Add")');
  await page.waitForSelector(`text=${itemName}`, { timeout: 10000 });

  const created = await pollUntil(async () => (await supabase.from("inventory_items").select("id").eq("name", itemName).maybeSingle()).data);
  expect(created, "inventory item should exist in DB").toBeTruthy();

  await page.click(`[aria-label="Delete ${itemName}"]`);
  await pollUntil(async () => {
    const rows = await supabase.from("inventory_items").select("id").eq("name", itemName);
    return (rows.data ?? []).length === 0 ? true : null;
  });

  await reloadIntoAdminPanel(page, "Inventory", "stock");
  await page.waitForSelector("text=Add Stock Item", { timeout: 10000 });
  await expect(page.locator(`text=${itemName}`)).toHaveCount(0);

  const stillGone = await supabase.from("inventory_items").select("id").eq("name", itemName);
  expect(stillGone.data ?? []).toHaveLength(0);
});

test("restock: create, delete via UI, reload, stays gone", async ({ page }) => {
  const supabase = supabaseTestClient();
  const realItem = (await supabase.from("inventory_items").select("id, name").limit(1).single()).data!;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Inventory");
  await page.click('button:has-text("Stock Inventory")');
  await page.waitForSelector("text=Add Stock Item", { timeout: 10000 });
  await page.click('button:has-text("Restock")');
  await page.waitForSelector("text=Add Restock Record", { timeout: 10000 });

  await page.fill('input[placeholder="e.g. Coffee Beans"]', realItem.name);
  await page.fill('form input[placeholder="0"]', "1");
  await page.click('button[type="submit"]:has-text("Add")');
  await page.waitForTimeout(1200);

  const created = await pollUntil(async () => {
    const rows = await supabase.from("restocks").select("id").eq("item_name_snapshot", realItem.name).order("created_at", { ascending: false }).limit(1);
    return rows.data?.[0] ?? null;
  });
  expect(created, "restock row should exist in DB").toBeTruthy();
  const restockId = created!.id as string;

  const row = page.locator("tr", { hasText: realItem.name }).first();
  await row.locator('[aria-label^="Delete restock"]').click();
  await pollUntil(async () => {
    const rows = await supabase.from("restocks").select("id").eq("id", restockId);
    return (rows.data ?? []).length === 0 ? true : null;
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  const stillGone = await supabase.from("restocks").select("id").eq("id", restockId);
  expect(stillGone.data ?? []).toHaveLength(0);
});

test("menu item: create, delete via UI, reload, stays gone", async ({ page }) => {
  const supabase = supabaseTestClient();
  const itemName = `E2E Menu ${e2eId("item")}`;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Menu");
  await page.click('button:has-text("Add item")');
  await page.fill('label:has-text("Name") input', itemName);
  await page.fill('label:has-text("Price") input', "99");
  const categorySelect = page.locator('label:has-text("Category") select');
  await categorySelect.selectOption({ index: 1 });
  await page.click('button[type="submit"]:has-text("Add")');
  await page.waitForSelector(`text=${itemName}`, { timeout: 10000 });

  const created = await pollUntil(async () => (await supabase.from("menu_items").select("id").eq("name", itemName).maybeSingle()).data);
  expect(created, "menu item should exist in DB").toBeTruthy();

  await page.click(`[aria-label="Delete ${itemName}"]`);
  await pollUntil(async () => {
    const rows = await supabase.from("menu_items").select("id").eq("name", itemName);
    return (rows.data ?? []).length === 0 ? true : null;
  });

  await reloadIntoAdminPanel(page, "Menu");
  await expect(page.locator(`text=${itemName}`)).toHaveCount(0);

  const stillGone = await supabase.from("menu_items").select("id").eq("name", itemName);
  expect(stillGone.data ?? []).toHaveLength(0);
});
