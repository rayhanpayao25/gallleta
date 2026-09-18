import { test, expect } from "@playwright/test";
import {
  loginAsAdmin,
  loginAsCashier,
  openAdminPanel,
  openPosMenu,
  supabaseTestClient,
  pollUntil,
  e2eId,
} from "./utils";

// Jira restock UI change:
//  - the Restock tab is history-only (no ADD/EDIT RESTOCK RECORD form, no
//    per-row Edit action; Delete stays)
//  - restock quantity_added is stored in the item's base unit (ml/g/pcs) but
//    history displays the purchased piece count: a 20-piece restock of a
//    1000 ml-per-piece item stores 20000 and must render "+20 | pcs"
//  - the shared component renders identically for Admin -> Inventory ->
//    Restock and cashier POS -> Restock
// All rows use e2e-* ids/names and are cleaned up.

const ITEM_NAME = "E2E Restock Milk";

test("restock tab: no form, no edit action, piece-quantity display, delete works", async ({
  page,
  browser,
}) => {
  const supabase = supabaseTestClient();
  const itemId = e2eId("restock-item");
  let restockId = "";

  const { error: itemError } = await supabase.from("inventory_items").insert({
    id: itemId,
    name: ITEM_NAME,
    unit: "ml",
    cost: 1,
    stock: 0,
    max_stock: 100000,
    purchase_unit_size: 1000,
  });
  expect(itemError, `inventory insert failed: ${itemError?.message}`).toBeNull();

  try {
    await loginAsAdmin(page);
    await openAdminPanel(page, "Inventory");
    await page.click('button:has-text("Stock Inventory")');
    await page.waitForSelector("text=Add Stock Item", { timeout: 15000 });

    // Create a 20-piece restock through the surviving inline path.
    const stockRow = page.locator("tr", { hasText: ITEM_NAME }).first();
    await stockRow.locator('input[placeholder="+Qty"]').fill("20");
    await stockRow.locator('button:has-text("Add")').click();

    const created = await pollUntil(async () => {
      const { data } = await supabase
        .from("restocks")
        .select("id, quantity_added, created_at")
        .eq("item_name_snapshot", ITEM_NAME)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    });
    expect(created, "restock row persisted").toBeTruthy();
    restockId = created!.id as string;
    // Stored in base units: 20 pieces x 1000 ml.
    expect(Number(created!.quantity_added)).toBe(20000);
    const stockAfter = await supabase
      .from("inventory_items")
      .select("stock")
      .eq("id", itemId)
      .single();
    expect(Number(stockAfter.data?.stock), "stock tracked in ml, not pieces").toBe(20000);

    // The table buckets rows by the PH calendar day of created_at; the
    // stored created_at can fall on a different PH day than "today", so
    // navigate the date filter to the row's actual day (same approach as
    // persistent-delete.spec).
    const phDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(created!.created_at as string));

    // Restock tab: history table only - no form.
    await page.click('button:has-text("Restock")');
    await page.waitForSelector("text=Added Qty", { timeout: 10000 });
    await expect(page.locator("text=Add Restock Record")).toHaveCount(0);
    await expect(page.locator("text=Edit Restock Record")).toHaveCount(0);
    await page.locator('input[type="date"]').fill(phDay);

    // The server action's revalidatePath can briefly overwrite the
    // optimistic row with a stale cached store; wait out the TTL and reload
    // (also proves the display survives a full refetch).
    await page.waitForTimeout(6000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await openAdminPanel(page, "Inventory");
    await page.click('button:has-text("Restock")');
    await page.locator('input[type="date"]').fill(phDay);
    const row = page.locator("tr", { hasText: ITEM_NAME }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.locator("td").nth(2)).toHaveText("+20");
    await expect(row.locator("td").nth(3)).toHaveText("pcs");
    await expect(row.locator('[aria-label^="Edit restock"]')).toHaveCount(0);
    await expect(row.locator('[aria-label^="Delete restock"]')).toHaveCount(1);

    // Same shared component, cashier POS surface: no form, same display.
    const posContext = await browser.newContext();
    const posPage = await posContext.newPage();
    try {
      await loginAsCashier(posPage);
      await openPosMenu(posPage);
      await posPage.click('button:has-text("Restock")');
      await posPage.waitForSelector("text=Added Qty", { timeout: 15000 });
      await expect(posPage.locator("text=Add Restock Record")).toHaveCount(0);
      await posPage.locator('input[type="date"]').fill(phDay);
      const posRow = posPage.locator("tr", { hasText: ITEM_NAME }).first();
      await expect(posRow.locator("td").nth(2)).toHaveText("+20", { timeout: 15000 });
      await expect(posRow.locator("td").nth(3)).toHaveText("pcs");
    } finally {
      await posContext.close();
    }

    // Delete remains functional from the history table.
    await expect(async () => {
      const stillThere = await supabase
        .from("restocks")
        .select("id")
        .eq("id", restockId)
        .maybeSingle();
      if (!stillThere.data) return;
      const dateInput = page.locator('input[type="date"]');
      if ((await dateInput.inputValue()) !== phDay) {
        await dateInput.fill(phDay);
      }
      const target = page.locator("tr", { hasText: ITEM_NAME }).first();
      await target.locator('[aria-label^="Delete restock"]').click({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await pollUntil(async () => {
      const { data } = await supabase.from("restocks").select("id").eq("id", restockId);
      return (data ?? []).length === 0 ? true : null;
    });
  } finally {
    if (restockId) {
      await supabase.from("restocks").delete().eq("id", restockId);
    }
    await supabase.from("inventory_items").delete().eq("id", itemId);
  }
});
