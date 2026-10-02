import { test, expect } from "@playwright/test";
import { loginAsAdmin, openAdminPanel, supabaseTestClient, e2eId } from "./utils";

// Regression for the reported Login Activity staleness: a row committed by
// a different execution path (another server instance, a direct DB write)
// never reached the admin UI because the app served a permanent in-memory
// store snapshot. With the TTL cache the row must surface on the next
// admin auto-refresh after expiry - no restart, no reload.

test("login activity written by a separate client appears in Admin In/Out without restart", async ({ page }) => {
  const supabase = supabaseTestClient();
  const id = e2eId("login");
  const name = `E2E Watcher ${e2eId("who")}`;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Staff");
  await page.click('button:has-text("In / Out")');
  await page.waitForSelector("text=Staff in / out", { timeout: 10000 });

  // user_id null keeps this independent of staff_users (the column is
  // nullable / ON DELETE SET NULL); readStore() keys the row by its own id
  // so it renders as its own In/Out session.
  await supabase.from("login_activity").insert({
    id,
    user_id: null,
    username: id,
    name,
    role: "cashier",
    type: "login",
    at: new Date().toISOString(),
  });

  try {
    await expect(
      page.locator("tr", { hasText: name }).first(),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await supabase.from("login_activity").delete().eq("id", id);
  }
});

test("staff user and inventory item written by a separate client appear without restart", async ({ page }) => {
  test.setTimeout(90_000);
  const supabase = supabaseTestClient();
  const userId = e2eId("user");
  const username = userId.replace(/[^a-z0-9]/g, "");
  const staffName = `E2E Ext ${e2eId("s")}`;
  const invId = e2eId("inv");
  const invName = `E2E Stock ${e2eId("i")}`;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Staff");

  await supabase.from("staff_users").insert({
    id: userId,
    username,
    password: "e2e-password",
    name: staffName,
    role: "barista",
    title: "Barista",
  });
  await supabase.from("inventory_items").insert({
    id: invId,
    name: invName,
    unit: "pcs",
    cost: 1,
    stock: 3,
    max_stock: 10,
  });

  try {
    // Staff list (Staff tab is already open).
    await expect(page.getByText(staffName).first()).toBeVisible({ timeout: 30_000 });

    // Inventory panel -> Stock Inventory tab.
    await openAdminPanel(page, "Inventory");
    await page.click('button:has-text("Stock Inventory")');
    await expect(page.getByText(invName).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await supabase.from("staff_users").delete().eq("id", userId);
    await supabase.from("inventory_items").delete().eq("id", invId);
  }
});
