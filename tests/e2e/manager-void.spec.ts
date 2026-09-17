import { test, expect } from "@playwright/test";
import {
  loginAsCashier,
  supabaseTestClient,
  pollUntil,
  e2eId,
  CASHIER_URL,
} from "./utils";

// Manager void attribution + DB-allocated ticket numbers:
//  - a cashier's post-payment void authorised with manager credentials must
//    persist that manager's staff_users.id in orders.voided_by (not null, not
//    the display name) with voided_at set
//  - a pre-checkout manager void (cart discarded via Confirm Void) must
//    persist the same actor + timestamp through create_order_atomic
//  - a voided ticket number is never handed out again: the next order's
//    DB-allocated ticket differs
//  - a manager POS session voids with session.userId and the ticket search
//    resolves exactly one ticket
//
// Uses food/pastry items so a single tap adds to the cart, and creates the
// manager-session target order via the service RPC (a manager session cannot
// check out: canCharge is false for isManager).

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

async function managerStaffId() {
  const supabase = supabaseTestClient();
  const { data } = await supabase
    .from("staff_users")
    .select("id")
    .eq("username", "manager")
    .single();
  expect(data?.id, "seed manager staff_users row must exist").toBeTruthy();
  return data!.id as string;
}

async function ensurePosOpen(page: import("@playwright/test").Page) {
  const openPosButton = page.locator('button:has-text("Open POS")');
  if ((await openPosButton.count()) > 0) {
    await openPosButton.click();
    await page.waitForTimeout(500);
  }
}

async function checkoutOneItem(page: import("@playwright/test").Page, menuItem: { name: string }) {
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
}

async function latestOrderWithItem(productId: string) {
  const supabase = supabaseTestClient();
  return pollUntil(async () => {
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
    return items.data?.some((i) => i.product_id_snapshot === productId)
      ? candidate
      : null;
  });
}

test("manager-credential void records the manager id and the ticket is never reused", async ({
  page,
}) => {
  const menuItem = await findSimpleMenuItem();
  const supabase = supabaseTestClient();
  const managerId = await managerStaffId();
  const reason = `e2e manager void ${Date.now().toString(36)}`;
  let orderId = "";
  let secondOrderId = "";

  await loginAsCashier(page);
  await ensurePosOpen(page);

  try {
    // Two orders back-to-back: distinct DB-allocated tickets.
    await checkoutOneItem(page, menuItem);
    const order = await latestOrderWithItem(menuItem.id);
    expect(order, "first paid order should exist").toBeTruthy();
    orderId = order!.id as string;
    const freedTicket = order!.ticket_no as string;
    expect(freedTicket).toMatch(/^\d{3}$/);

    // Manager-credential void of the just-paid ticket (empty cart).
    await page.click('button:has-text("Void")');
    await page.waitForSelector("text=Manager approval required to void.", { timeout: 10000 });
    await page.fill('input[placeholder="Enter username"]', "manager");
    await page.fill('input[type="password"]', "commune");
    await page.fill('textarea[placeholder*="Customer changed mind"]', reason);
    await page.click('button:has-text("Confirm Void")');
    await expect(page.locator("text=Transaction voided.")).toBeVisible({ timeout: 10000 });

    const voided = await pollUntil(async () => {
      const { data } = await supabase
        .from("orders")
        .select("voided, void_reason, voided_by, voided_at")
        .eq("id", orderId)
        .maybeSingle();
      return data?.voided ? data : null;
    });
    expect(voided, "order voided by manager credentials").toBeTruthy();
    expect(voided!.void_reason).toBe(reason);
    expect(voided!.voided_by, "voided_by must be the manager staff_users.id").toBe(managerId);
    expect(voided!.voided_at).toBeTruthy();

    // The freed ticket number must not be reissued.
    await checkoutOneItem(page, menuItem);
    const second = await pollUntil(async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, ticket_no")
        .neq("id", orderId)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    });
    expect(second, "second paid order should exist").toBeTruthy();
    secondOrderId = second!.id as string;
    expect(second!.ticket_no).not.toBe(freedTicket);
    expect(second!.ticket_no).toMatch(/^\d{3}$/);
  } finally {
    if (orderId) await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
    if (secondOrderId)
      await supabase.rpc("delete_order_atomic", { p_order_id: secondOrderId });
  }
});

test("pre-checkout manager void persists actor and timestamp", async ({ page }) => {
  const menuItem = await findSimpleMenuItem();
  const supabase = supabaseTestClient();
  const managerId = await managerStaffId();
  const reason = `e2e pre-checkout void ${Date.now().toString(36)}`;
  let orderId = "";

  await loginAsCashier(page);
  await ensurePosOpen(page);

  try {
    // Add to cart but do NOT pay: the void records an already-voided order.
    await page
      .locator("button, div[role=button]", { hasText: menuItem.name })
      .first()
      .click();
    await page.waitForTimeout(300);
    await page.click('button:has-text("Void")');
    await page.waitForSelector("text=Manager approval required to void.", { timeout: 10000 });
    await page.fill('input[placeholder="Enter username"]', "manager");
    await page.fill('input[type="password"]', "commune");
    await page.fill('textarea[placeholder*="Customer changed mind"]', reason);
    await page.click('button:has-text("Confirm Void")');
    await expect(page.locator("text=Checkout voided.")).toBeVisible({ timeout: 10000 });

    const order = await pollUntil(async () => {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("void_reason", reason)
        .maybeSingle();
      return data ?? null;
    });
    expect(order, "pre-checkout void must persist an order row").toBeTruthy();
    orderId = order!.id as string;
    expect(order!.voided).toBe(true);
    expect(order!.voided_by).toBe(managerId);
    expect(order!.voided_at).toBeTruthy();
    expect(order!.ticket_no).toMatch(/^\d{3}$/);
    // No inventory was ever deducted for a pre-checkout void.
    const usage = await supabase.from("usage_logs").select("id").eq("order_id", orderId);
    expect(usage.data ?? []).toHaveLength(0);
  } finally {
    if (orderId) await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
  }
});

test("manager session void uses the session manager id and ticket search resolves one ticket", async ({
  page,
}) => {
  const menuItem = await findSimpleMenuItem();
  const supabase = supabaseTestClient();
  const managerId = await managerStaffId();
  const orderId = e2eId("mgr-order");
  const reason = `e2e manager session void ${Date.now().toString(36)}`;

  // A manager session cannot check out, so create the target order directly.
  const created = await supabase.rpc("create_order_atomic", {
    p_order_id: orderId,
    p_created_at: new Date().toISOString(),
    p_barista_name: "E2E Cashier",
    p_barista_user_id: null,
    p_items: [
      { productId: menuItem.id, name: menuItem.name, qty: 1, price: menuItem.price },
    ],
    p_subtotal: menuItem.price,
    p_discount: 0,
    p_promo_id: null,
    p_promo_label: null,
    p_total: menuItem.price,
    p_payment_method: "cash",
    p_paid: menuItem.price,
    p_change: 0,
    p_deductions: [],
  });
  expect(created.error, created.error?.message).toBeNull();
  const ticketNo = created.data?.ticketNo as string;
  expect(ticketNo).toMatch(/^\d{3}$/);

  try {
    // The manager signs in through the cashier gate (managers share it).
    await page.goto(CASHIER_URL, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="username"]', "manager");
    await page.fill('input[name="password"]', "commune");
    await page.click('button:has-text("Enter commune")');
    await page.waitForURL("**/pos", { timeout: 15000 });
    await ensurePosOpen(page);
    await page.waitForSelector("text=Void tickets", { timeout: 15000 });

    // Ticket search must resolve unambiguously to exactly this order. The
    // desktop viewport renders the results as table rows.
    await page.fill('input[placeholder="Search ticket, item, or cashier"]', ticketNo);
    await page.waitForTimeout(600); // client-side filter
    const matches = page.locator("tr", { hasText: `#${ticketNo}` });
    await expect(matches).toHaveCount(1);
    await matches.first().locator('button:has-text("Void")').click();

    await page.waitForSelector("text=This cannot be undone.", { timeout: 10000 });
    await page.fill('textarea[placeholder*="Customer changed mind"]', reason);
    await page.click('button:has-text("Void ticket")');
    await expect(page.locator("text=Transaction voided.")).toBeVisible({ timeout: 10000 });

    const voided = await pollUntil(async () => {
      const { data } = await supabase
        .from("orders")
        .select("voided, voided_by, voided_at")
        .eq("id", orderId)
        .maybeSingle();
      return data?.voided ? data : null;
    });
    expect(voided, "manager-session void persisted").toBeTruthy();
    expect(voided!.voided_by).toBe(managerId);
    expect(voided!.voided_at).toBeTruthy();
  } finally {
    await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
  }
});
