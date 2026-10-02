import { test, expect } from "@playwright/test";

// Protects the mobile Jira fix: at a phone viewport, /drinks must show the
// title on the left and only the back *icon* (no "Back to Home" text) on
// the right, and it must navigate to /#menu.
test.use({ viewport: { width: 390, height: 844 } });

test("mobile /drinks: title on left, icon-only Back button on right, navigates to /#menu", async ({ page }) => {
  await page.goto("/drinks", { waitUntil: "domcontentloaded" });

  const title = page.locator("h1", { hasText: "Coffee ZZ Drinks" });
  const backLink = page.locator('a[aria-label="Back to Home"]');
  await expect(title).toBeVisible();
  await expect(backLink).toBeVisible();

  const titleBox = await title.boundingBox();
  const backBox = await backLink.boundingBox();
  expect(titleBox).toBeTruthy();
  expect(backBox).toBeTruthy();
  // Title starts left of where the back control starts.
  expect(titleBox!.x).toBeLessThan(backBox!.x);

  // Only the icon is visible on mobile - the text label is hidden below
  // the sm: breakpoint.
  const icon = backLink.locator("svg");
  const label = backLink.locator("span", { hasText: "Back to Home" });
  await expect(icon).toBeVisible();
  await expect(label).toBeHidden();

  await backLink.click();
  await page.waitForURL("**/#menu", { timeout: 10000 });
  const url = new URL(page.url());
  expect(url.pathname).toBe("/");
  expect(url.hash).toBe("#menu");
});
