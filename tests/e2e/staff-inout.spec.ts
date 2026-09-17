import { test, expect } from "@playwright/test";
import { loginAsAdmin, openAdminPanel, reloadIntoAdminPanel, supabaseTestClient, pollUntil, e2eId } from "./utils";

test("Staff In/Out: punch In, reload keeps open shift, punch Out, edit times, delete session", async ({ page }) => {
  const supabase = supabaseTestClient();
  const staffName = `E2E Staff ${e2eId("staff")}`;
  const staffUsername = e2eId("user").replace(/[^a-z0-9]/g, "");

  await loginAsAdmin(page);
  await openAdminPanel(page, "Staff");
  await page.waitForSelector("text=Add staff", { timeout: 10000 });
  await page.click('button:has-text("Add staff")');
  await page.waitForSelector("text=New staff", { timeout: 10000 });
  const form = page.locator("form", { hasText: "New staff" });
  await form.locator("input").nth(0).fill(staffName);
  await form.locator("input").nth(1).fill(staffUsername);
  await form.locator('input[type="password"]').fill("e2etest1234");
  await form.locator('button[type="submit"]').click();
  await page.waitForSelector(`text=${staffName}`, { timeout: 20000 });

  await page.click('button:has-text("In / Out")');
  await page.waitForSelector("text=Staff in / out", { timeout: 10000 });
  await page.locator("select").filter({ hasText: "Select staff" }).selectOption({ label: staffName });
  await page.locator("button", { hasText: /^In$/ }).click();
  await page.waitForTimeout(1000);

  const loginRow = await pollUntil(async () => {
    const r = await supabase.from("login_activity").select("*").eq("username", staffUsername).eq("type", "login");
    return (r.data ?? [])[0] ?? null;
  });
  expect(loginRow, "login_activity row should exist after In punch").toBeTruthy();

  // Reload: open shift must still be recognized (persistence, not memory).
  await reloadIntoAdminPanel(page, "Staff");
  await page.click('button:has-text("In / Out")');
  await page.waitForSelector("text=Staff in / out", { timeout: 10000 });
  const openRow = page.locator("tr", { hasText: staffName });
  await expect(openRow.first()).toContainText("Still in");

  // Punch Out.
  await page.locator("select").filter({ hasText: "Select staff" }).selectOption({ label: staffName });
  await page.locator("button", { hasText: /^Out$/ }).click();
  await page.waitForTimeout(1000);
  const logoutRow = await pollUntil(async () => {
    const r = await supabase.from("login_activity").select("*").eq("username", staffUsername).eq("type", "logout");
    return (r.data ?? [])[0] ?? null;
  });
  expect(logoutRow, "login_activity row should exist after Out punch").toBeTruthy();

  await reloadIntoAdminPanel(page, "Staff");
  await page.click('button:has-text("In / Out")');
  await page.waitForSelector("text=Staff in / out", { timeout: 10000 });
  const closedRow = page.locator("tr", { hasText: staffName }).first();
  await expect(closedRow).not.toContainText("Still in");

  // Edit session time.
  await closedRow.locator("button", { hasText: /^Edit$/ }).click();
  await page.waitForTimeout(300);
  const loginInput = closedRow.locator('input[type="datetime-local"]').nth(0);
  await loginInput.fill("2026-02-01T09:00");
  await closedRow.locator("button", { hasText: /^Save$/ }).click();
  await page.waitForTimeout(1200);
  const editedLogin = await pollUntil(async () => {
    const r = await supabase.from("login_activity").select("at").eq("id", loginRow!.id).maybeSingle();
    return r.data?.at ? r.data : null;
  });
  expect(new Date(editedLogin!.at as string).getUTCHours()).toBe(1); // 09:00 PH (+08:00) = 01:00 UTC

  // Delete the session.
  await reloadIntoAdminPanel(page, "Staff");
  await page.click('button:has-text("In / Out")');
  await page.waitForSelector("text=Staff in / out", { timeout: 10000 });
  const sessionRow = page.locator("tr", { hasText: staffName }).first();
  await sessionRow.locator('[aria-label*="Delete in / out record"]').click();
  await pollUntil(async () => {
    const r = await supabase.from("login_activity").select("id").in("id", [loginRow!.id, logoutRow!.id]);
    return (r.data ?? []).length === 0 ? true : null;
  });

  // Cleanup: remove the disposable staff account.
  const staffRow = await supabase.from("staff_users").select("id").eq("username", staffUsername).maybeSingle();
  if (staffRow.data) await supabase.from("staff_users").delete().eq("id", staffRow.data.id);

  const finalCheck = await supabase.from("login_activity").select("id").eq("username", staffUsername);
  expect(finalCheck.data ?? []).toHaveLength(0);
});
