import { test, expect } from "@playwright/test";
import { loginAsAdmin, openAdminPanel, reloadIntoAdminPanel, supabaseTestClient, pollUntil, e2eId } from "./utils";

// UserManager (and its "Request off" tab) is only ever rendered from
// AdminShell, i.e. an admin session - so createOffRequest()'s non-admin
// ("pending") branch has no reachable UI entry point (confirmed in the
// Phase 6 audit). Every request created through the real UI is therefore
// auto-approved; there is no reachable path to a "pending" row to click
// Approve/Deny on. This test automates exactly what the real UI exposes:
// create (auto-approved), persistence across reload, and delete.
test("Off Request: create persists after reload, delete persists after reload", async ({ page }) => {
  const supabase = supabaseTestClient();

  await loginAsAdmin(page);
  await openAdminPanel(page, "Staff");
  await page.waitForSelector("text=Add staff", { timeout: 10000 });
  await page.click('button:has-text("Add staff")');
  await page.waitForSelector("text=New staff", { timeout: 10000 });
  const staffName = `E2E OffReq Staff ${e2eId("s")}`;
  const staffUsername = e2eId("u").replace(/[^a-z0-9]/g, "");
  const form = page.locator("form", { hasText: "New staff" });
  await form.locator("input").nth(0).fill(staffName);
  await form.locator("input").nth(1).fill(staffUsername);
  await form.locator('input[type="password"]').fill("e2etest1234");
  await form.locator('button[type="submit"]').click();
  await page.waitForSelector(`text=${staffName}`, { timeout: 20000 });

  await page.click('button:has-text("Request off")');
  await page.waitForSelector("text=Request off", { timeout: 10000 });
  const reason = `E2E off request ${e2eId("r")}`;
  await page.locator("select").filter({ hasText: "Select staff" }).selectOption({ label: staffName });
  await page.locator('input[type="date"]').fill("2026-12-15");
  await page.locator('label:has-text("Reason") input').fill(reason);
  await page.locator('button[type="submit"]:has-text("Add")').click();
  await page.waitForTimeout(1000);

  const created = await pollUntil(async () => (await supabase.from("off_requests").select("*").eq("reason", reason).maybeSingle()).data);
  expect(created, "off request should persist to DB").toBeTruthy();
  expect(created!.status, "admin-created request is auto-approved").toBe("approved");
  const requestId = created!.id as string;

  await reloadIntoAdminPanel(page, "Staff");
  await page.click('button:has-text("Request off")');
  await page.waitForSelector("text=Request off", { timeout: 10000 });
  await expect(page.locator(`text=${reason}`)).toBeVisible();

  await page.locator("tr", { hasText: reason }).locator("text=Delete").click();
  await pollUntil(async () => {
    const r = await supabase.from("off_requests").select("id").eq("id", requestId);
    return (r.data ?? []).length === 0 ? true : null;
  });

  await reloadIntoAdminPanel(page, "Staff");
  await page.click('button:has-text("Request off")');
  await page.waitForSelector("text=Request off", { timeout: 10000 });
  await expect(page.locator(`text=${reason}`)).toHaveCount(0);
  const stillGone = await supabase.from("off_requests").select("id").eq("id", requestId);
  expect(stillGone.data ?? []).toHaveLength(0);

  // Cleanup disposable staff.
  const staffRow = await supabase.from("staff_users").select("id").eq("username", staffUsername).maybeSingle();
  if (staffRow.data) await supabase.from("staff_users").delete().eq("id", staffRow.data.id);
});
