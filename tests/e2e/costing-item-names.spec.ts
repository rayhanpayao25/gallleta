import { test, expect } from "@playwright/test";
import { loginAsAdmin, openAdminPanel } from "./utils";

// KAN-118: item names in the Recipe Costing "Menu Items" selector were truncated
// to a few characters ("Sea S...", "Match...") by a 3-column grid inside the
// narrow assignment panel. They must render readably at every viewport.
async function assertNamesReadable(editingSection: import("@playwright/test").Locator, label: string) {
  const nameSpans = editingSection.locator('label:has(input[type="checkbox"]) > span');
  const count = await nameSpans.count();
  expect(count, `${label}: menu items should be listed`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const span = nameSpans.nth(i);
    const clipped = await span.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `${label}: "${await span.innerText()}" is truncated`).toBe(false);
  }
}

test("KAN-118: recipe costing menu item names are readable, checkbox assignment works", async ({ page }) => {
  await loginAsAdmin(page);
  await openAdminPanel(page, "Inventory");
  await page.click('button:has-text("Costing")');
  await page.waitForSelector('button:has-text("Add recipe")', { timeout: 10000 });
  await page.click('button:has-text("Add recipe")');
  const editingSection = page.locator('section:has(input[placeholder="Recipe name"])');
  await editingSection.waitFor({ timeout: 10000 });

  // Desktop (default 1280px): the assignment panel is narrow -> single column,
  // names must not be ellipsized.
  await assertNamesReadable(editingSection, "desktop");

  // Narrow/tablet viewport: the section stacks full-width -> two columns,
  // names still readable.
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(300);
  await assertNamesReadable(editingSection, "narrow");

  // Checkbox assignment still toggles (local state only; nothing is saved).
  const checkbox = editingSection
    .locator('label:has(input[type="checkbox"]:not([disabled])) input[type="checkbox"]')
    .first();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
});
