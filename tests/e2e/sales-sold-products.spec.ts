import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./utils";

test("Admin Sales: Sold Products follows menu category types and totals match", async ({ page }) => {
  await loginAsAdmin(page);

  const card = page.locator("div", { has: page.getByText("Sold Products", { exact: true }) }).filter({ hasText: "Total Sold" }).last();
  await expect(card).toBeVisible();

  const rows = card.locator("div.mt-3 > div");
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(1);
  await expect(rows.last()).toContainText("Total Sold");

  let categoryQty = 0;
  let categorySales = 0;
  for (let index = 0; index < rowCount - 1; index += 1) {
    const row = rows.nth(index);
    const label = await row.locator("p").first().innerText();
    expect(label).not.toBe("Total Sold");

    const qtyText = await row.locator("p").last().innerText();
    const qty = Number(qtyText.replace(/[^\d.-]/g, ""));
    expect(Number.isFinite(qty), `expected a quantity for ${label}, got "${qtyText}"`).toBe(true);
    categoryQty += qty;

    const salesText = await row.locator("p").nth(1).innerText();
    const sales = Number(salesText.replace(/[^\d.-]/g, ""));
    expect(Number.isFinite(sales), `expected sales for ${label}, got "${salesText}"`).toBe(true);
    categorySales += sales;
  }

  const totalRow = rows.last();
  const totalQtyText = await totalRow.locator("p").last().innerText();
  const totalQty = Number(totalQtyText.replace(/[^\d.-]/g, ""));
  const totalSalesText = await totalRow.locator("p").nth(1).innerText();
  const totalSales = Number(totalSalesText.replace(/[^\d.-]/g, ""));

  expect(totalQty).toBe(categoryQty);
  expect(totalSales).toBe(categorySales);
});
