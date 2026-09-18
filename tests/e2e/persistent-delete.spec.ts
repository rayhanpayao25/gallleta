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

  // Restock creation lives on the Stock Inventory tab: the row's inline
  // +Qty input (entered in pieces) + Add button -> create_restock_atomic.
  const stockRow = page.locator("tr", { hasText: realItem.name }).first();
  await stockRow.locator('input[placeholder="+Qty"]').fill("1");
  await stockRow.locator('button:has-text("Add")').click();
  await page.waitForTimeout(1200);

  // The restock row appears on the Restock tab (history table only - the
  // separate Add Restock Record form was removed).
  await page.click('button:has-text("Restock")');
  await page.waitForSelector("text=Added Qty", { timeout: 10000 });

  const created = await pollUntil(async () => {
    const rows = await supabase.from("restocks").select("id, created_at").eq("item_name_snapshot", realItem.name).order("created_at", { ascending: false }).limit(1);
    return rows.data?.[0] ?? null;
  });
  expect(created, "restock row should exist in DB").toBeTruthy();
  const restockId = created!.id as string;

  // The restock table's date filter buckets rows by their created_at
  // converted to the Asia/Manila calendar day (see phDateString() in
  // src/lib/datetime.ts); the default "Today"/"This Year" range options
  // both cap their upper bound at "today" computed the same way, so a row
  // whose PH-calendar-day lands on the far side of a UTC/PH day boundary
  // can be legitimately excluded from every relative range option. Target
  // the exact PH calendar day this row was actually stored under (via the
  // explicit Date: filter) instead of guessing a relative range, so the
  // test tracks whatever the real UI displays rather than assuming no
  // day-boundary skew.
  const phDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(created!.created_at as string));

  // The admin Sales/Transactions/Staff panels auto-refresh every 5s
  // (AdminShell's router.refresh() interval, a legitimate main feature that
  // keeps the dashboard live) - that can detach/re-render this exact table
  // row mid-click. Retry against a freshly-queried row on each attempt, and
  // check our specific restockId by DB id first so a retry after an
  // already-successful click can never land on (and delete) a different,
  // unrelated row.
  await expect(async () => {
    const stillThere = await supabase.from("restocks").select("id").eq("id", restockId).maybeSingle();
    if (!stillThere.data) return;
    const dateInput = page.locator('input[type="date"]');
    if ((await dateInput.inputValue()) !== phDay) {
      await dateInput.fill(phDay);
    }
    const row = page.locator("tr", { hasText: realItem.name }).first();
    await row.locator('[aria-label^="Delete restock"]').click({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
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
