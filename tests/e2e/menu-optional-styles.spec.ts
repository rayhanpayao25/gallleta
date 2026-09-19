import { test, expect } from "@playwright/test";
import { loginAsAdmin, loginAsCashier, openAdminPanel, reloadIntoAdminPanel, supabaseTestClient, pollUntil, e2eId } from "./utils";

// KAN-127: Hot/Iced type selection is optional. A menu item created or
// edited with no type selected must persist styles=[] and display "-" in
// the Admin TYPE column - before the fix both styles were silently forced
// by normalizeMenuStyles on the write AND read paths.
// All disposable rows use "E2E ..." names and are removed in the test body.

const TYPE_CELL = "td:nth-child(3)";

test("menu item with no type selected persists styles=[] and shows -", async ({ page }) => {
  const supabase = supabaseTestClient();
  const catName = `E2E TypeCat ${e2eId("cat")}`;
  const itemName = `E2E NoType ${e2eId("item")}`;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Menu");

  // Disposable category.
  await page.click('button:has-text("Categories")');
  await page.fill('input[placeholder="e.g. Coffee"]', catName);
  await page.click('button:has-text("Add category")');
  await page.waitForSelector(`text=${catName}`, { timeout: 10000 });

  try {
    // Create the item in a non-food/pastry category without touching Type.
    await page.click('button:has-text("Items")');
    await page.click('button:has-text("Add item")');
    await page.fill('label:has-text("Name") input', itemName);
    await page.fill('label:has-text("Price") input', "120");
    await page.locator('label:has-text("Category") select').selectOption({ label: catName });

    // The Type section renders for this category but must start unselected.
    const icedToggle = page.locator('form button[type="button"]:has-text("Iced")');
    const hotToggle = page.locator('form button[type="button"]:has-text("Hot")');
    await expect(icedToggle).toBeVisible();
    await expect(hotToggle).toBeVisible();

    await page.click('form button[type="submit"]:has-text("Add")');
    await page.waitForSelector(`text=Item added.`, { timeout: 10000 });

    const created = await pollUntil(async () =>
      (await supabase.from("menu_items").select("id, styles").eq("name", itemName).maybeSingle()).data,
    );
    expect(created, "menu item should exist in DB").toBeTruthy();
    expect(created!.styles, "no type selected must persist as []").toEqual([]);

    const row = page.locator("tr", { hasText: itemName }).first();
    await expect(row.locator(TYPE_CELL), "TYPE column shows -").toHaveText("—");

    // Survives TTL expiry + reload (fresh server read).
    await page.waitForTimeout(6000);
    await reloadIntoAdminPanel(page, "Menu");
    const rowAfter = page.locator("tr", { hasText: itemName }).first();
    await expect(rowAfter.locator(TYPE_CELL), "TYPE stays - after TTL/reload").toHaveText("—");

    // Edit -> select Iced only -> persists ["iced"].
    await page.click(`[aria-label="Edit ${itemName}"]`);
    await page.locator('form button[type="button"]:has-text("Iced")').click();
    await page.click('form button[type="submit"]:has-text("Save")');
    await page.waitForSelector("text=Item updated.", { timeout: 10000 });
    const iced = await pollUntil(async () =>
      (await supabase.from("menu_items").select("styles").eq("name", itemName).maybeSingle()).data,
    );
    expect(iced!.styles, "Iced-only selection persists").toEqual(["iced"]);
    await expect(page.locator("tr", { hasText: itemName }).first().locator(TYPE_CELL)).toHaveText("Iced");

    // Edit -> deselect Iced -> back to [].
    await page.click(`[aria-label="Edit ${itemName}"]`);
    await page.locator('form button[type="button"]:has-text("Iced")').click();
    await page.click('form button[type="submit"]:has-text("Save")');
    await page.waitForSelector("text=Item updated.", { timeout: 10000 });
    const cleared = await pollUntil(async () =>
      (await supabase.from("menu_items").select("styles").eq("name", itemName).maybeSingle()).data,
    );
    expect(cleared!.styles, "deselecting again persists []").toEqual([]);
    await expect(page.locator("tr", { hasText: itemName }).first().locator(TYPE_CELL)).toHaveText("—");
  } finally {
    // Cleanup via DB: authoritative delete functions are already covered by
    // other specs; direct deletes keep this test short and always run.
    await supabase.from("menu_items").delete().eq("name", itemName);
    const { data: cat } = await supabase.from("menu_categories").select("id").eq("name", catName).maybeSingle();
    if (cat) await supabase.from("menu_categories").delete().eq("id", cat.id);
  }
});

test("POS: style-less item adds without a type picker and deducts no cup", async ({ page }) => {
  const supabase = supabaseTestClient();
  const itemName = `E2E NoType POS ${e2eId("item")}`;
  const { data: category } = await supabase
    .from("menu_categories")
    .select("id")
    .ilike("name", "Special")
    .limit(1)
    .single();
  const menuId = e2eId("notype-menu");
  const insert = await supabase.from("menu_items").insert({
    id: menuId,
    name: itemName,
    price: 120,
    category_id: category!.id,
    available: true,
    styles: [],
    addons: [],
  });
  expect(insert.error, "disposable menu item insert should succeed").toBeNull();
  await pollUntil(async () =>
    (await supabase.from("menu_items").select("id").eq("id", menuId).maybeSingle()).data,
  );

  const cupIds = new Set(
    (await supabase
      .from("recipe_costings")
      .select("hot_cup_inventory_item_id, iced_cup_inventory_item_id, other_cup_inventory_item_id")).data
      ?.flatMap((row) => [row.hot_cup_inventory_item_id, row.iced_cup_inventory_item_id, row.other_cup_inventory_item_id])
      .filter(Boolean) as string[],
  );

  try {
    await loginAsCashier(page);
    const openPosButton = page.locator('button:has-text("Open POS")');
    if ((await openPosButton.count()) > 0) {
      await openPosButton.click();
      await page.waitForTimeout(500);
    }

    // The server's memoryStore cache refreshes every ~5s; reload until the
    // newly inserted item is visible rather than assuming instant freshness.
    await pollUntil(async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.fill('input[placeholder="Search item..."]', itemName);
      await page.waitForTimeout(300);
      return (await page.getByRole("button", { name: new RegExp(itemName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).count()) > 0 || null;
    }, 20000);
    const itemButton = page.getByRole("button", { name: new RegExp(itemName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(itemButton, "style-less item should appear in the POS grid").toBeVisible();
    await itemButton.click();
    await page.waitForTimeout(400);

    // No forced Hot/Iced picker: the item lands straight in the cart.
    await expect(page.locator("text=Choose Iced or Hot.")).toHaveCount(0);
    await expect(page.locator("li", { hasText: itemName }), "item lands in the cart directly").toBeVisible();

    const cashButton = page.locator('button:has-text("Cash")').first();
    if ((await cashButton.count()) > 0) await cashButton.click();
    const exactButton = page.locator('button:has-text("Exact")');
    if ((await exactButton.count()) > 0) await exactButton.click();
    await page.click('button:has-text("Proceed Order")');
    await page.waitForTimeout(1500);
    await expect(page.locator("text=/Paid/")).toBeVisible({ timeout: 10000 });

    const order = await pollUntil(async () => {
      const { data } = await supabase.from("orders").select("id").order("created_at", { ascending: false }).limit(1);
      const candidate = data?.[0];
      if (!candidate) return null;
      const items = await supabase.from("order_items").select("style, product_id_snapshot").eq("order_id", candidate.id);
      return items.data?.some((i) => i.product_id_snapshot === menuId) ? { order: candidate, items: items.data } : null;
    });
    expect(order, "order should exist").toBeTruthy();

    const line = order!.items!.find((i) => i.product_id_snapshot === menuId)!;
    expect(line.style, "order line stays style-less").toBeNull();

    const usage = await supabase.from("usage_logs").select("inventory_item_id").eq("order_id", order!.order.id);
    const deducted = new Set((usage.data ?? []).map((log) => log.inventory_item_id));
    for (const cupId of cupIds) {
      expect(deducted.has(cupId), "no cup inventory was deducted for a type-less line").toBe(false);
    }

    await supabase.rpc("delete_order_atomic", { p_order_id: order!.order.id });
  } finally {
    await supabase.from("menu_items").delete().eq("id", menuId);
  }
});
