import { test, expect } from "@playwright/test";
import { ADMIN_URL, ADMIN_USERNAME, ADMIN_PASSWORD, CASHIER_URL, CASHIER_USERNAME, CASHIER_PASSWORD } from "./utils";

// Protects the Jira fix: admin logout must redirect back to its own gate
// path, not the site root or the cashier gate.
test("admin login -> dashboard -> logout -> redirect to /mouna1233", async ({ page }) => {
  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', ADMIN_USERNAME);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button:has-text("Enter Galleta Café")');

  await page.waitForURL("**/admin", { timeout: 15000 });
  await expect(page.locator("text=Sales analysis")).toBeVisible({ timeout: 15000 });

  await page.click('[aria-label="Open menu"]');
  await page.click('button:has-text("Log out")');

  await page.waitForURL(`**${ADMIN_URL}`, { timeout: 15000 });
  expect(new URL(page.url()).pathname).toBe(ADMIN_URL);
});

test("cashier login opens POS without showing a logout control", async ({ page }) => {
  await page.goto(CASHIER_URL, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', CASHIER_USERNAME);
  await page.fill('input[name="password"]', CASHIER_PASSWORD);
  await page.click('button:has-text("Enter Galleta Café")');

  await page.waitForURL("**/pos", { timeout: 15000 });
  await expect(page.locator('[aria-label="Open menu"]')).toBeVisible({ timeout: 15000 });
  await page.click('[aria-label="Open menu"]');
  await expect(page.locator("button:has-text('Log out')")).toHaveCount(0);
});

test("POS and admin stay signed in independently in separate tabs", async ({ page }) => {
  await page.goto("/pos", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("POS Terminal")).toBeVisible();

  const adminPage = await page.context().newPage();
  await adminPage.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await adminPage.fill('input[name="username"]', ADMIN_USERNAME);
  await adminPage.fill('input[name="password"]', ADMIN_PASSWORD);
  await adminPage.click('button:has-text("Enter Galleta Café")');
  await adminPage.waitForURL("**/admin", { timeout: 15000 });
  await expect(adminPage.locator("text=Sales analysis")).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(page.getByText("POS Terminal")).toBeVisible();
  await adminPage.reload();
  await expect(adminPage.locator("text=Sales analysis")).toBeVisible({ timeout: 15000 });
});
