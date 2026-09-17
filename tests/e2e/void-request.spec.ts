import { test, expect } from "@playwright/test";
import {
  loginAsAdmin,
  loginAsCashier,
  supabaseTestClient,
  pollUntil,
  e2eId,
} from "./utils";

// Void requests are durable rows in public.void_requests (not process
// memory): a cashier's request must be readable by an admin served by a
// different code path/instance, survive reloads, and approval must affect
// the referenced order atomically. Uses the same food/pastry item strategy
// as pos-order.spec.ts so a single tap adds to the cart.

async function findSimpleMenuItem() {
  const supabase = supabaseTestClient();
  const categories = await supabase.from("menu_categories").select("id, name");
  const foodOrPastryIds = (categories.data ?? [])
    .filter((c) => /food|pastr/i.test(c.name))
    .map((c) => c.id);
  const { data } = await supabase
    .from("menu_items")
    .select("id, name, price, available, category_id")
    .eq("available", true)
    .in("category_id", foodOrPastryIds)
    .limit(1);
  if (!data || data.length === 0)
    throw new Error("No available food/pastry menu item found to drive the POS test");
  return data[0] as { id: string; name: string; price: number };
}

async function openAdminVoidsPanel(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    window.localStorage.setItem("admin_activePanel", "voids");
    window.localStorage.setItem("admin_section", "admin");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Void request approval", { timeout: 15000 });
}

test("cashier void request persists, admin approves, order voids and inventory restores once", async ({
  page,
  browser,
}) => {
  const menuItem = await findSimpleMenuItem();
  const supabase = supabaseTestClient();
  const reason = `e2e void request ${Date.now().toString(36)}`;

  await loginAsCashier(page);
  const openPosButton = page.locator('button:has-text("Open POS")');
  if ((await openPosButton.count()) > 0) {
    await openPosButton.click();
    await page.waitForTimeout(500);
  }

  const beforeInventory = await supabase.from("inventory_items").select("id, stock");
  const beforeMap = new Map(
    (beforeInventory.data ?? []).map((r) => [r.id, Number(r.stock)]),
  );

  await page
    .locator("button, div[role=button]", { hasText: menuItem.name })
    .first()
    .click();
  await page.waitForTimeout(300);
  const cashButton = page.locator('button:has-text("Cash")').first();
  if ((await cashButton.count()) > 0) await cashButton.click();
  const exactButton = page.locator('button:has-text("Exact")');
  if ((await exactButton.count()) > 0) await exactButton.click();
  await page.click('button:has-text("Proceed Order")');
  await expect(page.locator("text=/Paid/")).toBeVisible({ timeout: 10000 });

  const order = await pollUntil(async () => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
    const candidate = data?.[0];
    if (!candidate) return null;
    const items = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", candidate.id);
    return items.data?.some((i) => i.product_id_snapshot === menuItem.id)
      ? candidate
      : null;
  });
  expect(order, "paid order should exist").toBeTruthy();
  const orderId = order!.id as string;
  const usageLogs = await supabase.from("usage_logs").select("*").eq("order_id", orderId);

  // Request admin approval for the paid ticket (empty cart -> orderId mode).
  await page.click('button:has-text("Void")');
  await page.waitForSelector("text=Manager approval required to void.", { timeout: 10000 });
  await page.fill('textarea[placeholder*="Customer changed mind"]', reason);
  await page.click('button:has-text("Request to admin")');
  await expect(page.locator("text=Void request pending admin approval")).toBeVisible({
    timeout: 10000,
  });

  const request = await pollUntil(async () => {
    const { data } = await supabase
      .from("void_requests")
      .select("*")
      .eq("reason", reason)
      .maybeSingle();
    return data ?? null;
  });
  expect(request, "request row persisted to void_requests").toBeTruthy();
  const requestId = request!.id as string;
  expect(request!.order_id).toBe(orderId);
  expect(request!.status).toBe("pending");

  // Durability: a full reload must rebuild the pending state from the DB
  // row, not from process memory.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("text=Void request pending admin approval")).toBeVisible({
    timeout: 15000,
  });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await loginAsAdmin(adminPage);
    await openAdminVoidsPanel(adminPage);
    const row = adminPage.locator("tr", { hasText: reason });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator('button:has-text("Approve")').click();
    await expect(adminPage.locator("text=Void request approved.")).toBeVisible({
      timeout: 15000,
    });

    const approved = await pollUntil(async () => {
      const { data } = await supabase
        .from("void_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();
      return data?.status === "approved" ? data : null;
    });
    expect(approved, "approval persisted").toBeTruthy();
    expect(approved!.processed_order_id).toBe(orderId);
    expect(approved!.approved_by_name).toBeTruthy();
    expect(approved!.approved_at).toBeTruthy();

    const voided = await pollUntil(async () => {
      const { data } = await supabase
        .from("orders")
        .select("voided, void_reason")
        .eq("id", orderId)
        .maybeSingle();
      return data?.voided ? data : null;
    });
    expect(voided, "order voided by approval").toBeTruthy();
    expect(voided!.void_reason).toBe(reason);

    const afterInventory = await supabase.from("inventory_items").select("id, stock");
    const afterMap = new Map(
      (afterInventory.data ?? []).map((r) => [r.id, Number(r.stock)]),
    );
    for (const log of usageLogs.data ?? []) {
      const before = beforeMap.get(log.inventory_item_id);
      const after = afterMap.get(log.inventory_item_id);
      expect(after, `inventory restored exactly once for ${log.item_name_snapshot}`).toBeCloseTo(
        before!,
        5,
      );
    }

    // Cashier's 2s status poll is a direct DB read - it sees the approval
    // even though the approval was committed by a different request path.
    await expect(
      page.locator("text=Admin approved the void. The checkout has been voided."),
    ).toBeVisible({ timeout: 15000 });

    // Double approval cannot happen twice at the workflow level.
    const second = await supabase.rpc("approve_void_request_atomic", {
      p_request_id: requestId,
      p_approved_by_id: null,
      p_approved_by_name: "E2E Admin",
    });
    expect(second.data?.ok).toBe(false);
    expect(second.data?.error).toBe("ALREADY_APPROVED");
    const finalInventory = await supabase.from("inventory_items").select("id, stock");
    const finalMap = new Map(
      (finalInventory.data ?? []).map((r) => [r.id, Number(r.stock)]),
    );
    for (const log of usageLogs.data ?? []) {
      expect(
        finalMap.get(log.inventory_item_id),
        "rejected second approval must not restore again",
      ).toBeCloseTo(beforeMap.get(log.inventory_item_id)!, 5);
    }

    // Delete the request through the admin UI; it must stay deleted after a
    // fresh reload (no memoryStore resurrection).
    adminPage.on("dialog", (dialog) => void dialog.accept());
    await adminPage
      .locator("tr", { hasText: reason })
      .locator('button[aria-label="Delete void request"]')
      .click();
    await expect(adminPage.locator("text=Void request deleted.")).toBeVisible({
      timeout: 15000,
    });
    const gone = await supabase.from("void_requests").select("id").eq("id", requestId);
    expect(gone.data ?? []).toHaveLength(0);
    await adminPage.reload({ waitUntil: "domcontentloaded" });
    await adminPage.waitForTimeout(6000); // past the store TTL + panel refresh
    await expect(adminPage.locator("tr", { hasText: reason })).toHaveCount(0);
  } finally {
    await adminContext.close();
    await supabase.from("void_requests").delete().eq("id", requestId);
    await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
  }
});

test("a void request written by another instance appears in the admin panel and deletes durably", async ({
  page,
}) => {
  const supabase = supabaseTestClient();
  const cashier = (
    await supabase.from("staff_users").select("id").eq("username", "cashier").single()
  ).data!;
  const requestId = e2eId("vr");
  const reason = `e2e external request ${Date.now().toString(36)}`;

  await loginAsAdmin(page);
  await openAdminVoidsPanel(page);

  // Simulate a second server instance writing the row directly: nothing in
  // this process's memoryStore knows about it.
  const { error } = await supabase.from("void_requests").insert({
    id: requestId,
    requested_at: new Date().toISOString(),
    requested_by_id: cashier.id,
    requested_by_name: "E2E Cashier",
    reason,
    status: "pending",
    order_id: null,
    items: [{ productId: "e2e-item", name: "E2E External", qty: 1, price: 100 }],
    subtotal: 100,
    discount: 0,
    promo_label: null,
    total: 100,
    payment_method: "cash",
  });
  expect(error, `external insert failed: ${error?.message}`).toBeNull();

  try {
    // The panel refreshes every 5s and the store cache TTL is 5s - the row
    // must appear without any restart or local mutation.
    await expect(page.locator("tr", { hasText: reason })).toBeVisible({ timeout: 20000 });

    page.on("dialog", (dialog) => void dialog.accept());
    await page
      .locator("tr", { hasText: reason })
      .locator('button[aria-label="Delete void request"]')
      .click();
    await expect(page.locator("text=Void request deleted.")).toBeVisible({ timeout: 15000 });

    const gone = await supabase.from("void_requests").select("id").eq("id", requestId);
    expect(gone.data ?? []).toHaveLength(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await expect(page.locator("tr", { hasText: reason })).toHaveCount(0);
  } finally {
    await supabase.from("void_requests").delete().eq("id", requestId);
  }
});
