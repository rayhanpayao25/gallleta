import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./utils";

test("Admin Sales: Sold Products shows Drinks/Food/Pastries/Total Sold and totals match", async ({ page }) => {
  await loginAsAdmin(page);

  const card = page.locator("div", { has: page.getByText("Sold Products", { exact: true }) }).filter({ hasText: "Total Sold" }).last();
  await expect(card).toBeVisible();

  for (const label of ["Drinks", "Food", "Pastries", "Total Sold"]) {
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  }

  async function valueFor(label: string): Promise<number> {
    const row = card.locator("div", { has: page.getByText(label, { exact: true }) }).last();
    const text = await row.locator("p").last().innerText();
    const parsed = Number(text.replace(/[^\d.-]/g, ""));
    expect(Number.isFinite(parsed), `expected a numeric value for ${label}, got "${text}"`).toBe(true);
    return parsed;
  }

  const drinks = await valueFor("Drinks");
  const food = await valueFor("Food");
  const pastries = await valueFor("Pastries");
  const total = await valueFor("Total Sold");

  expect(total).toBe(drinks + food + pastries);
});
