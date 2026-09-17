import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";

// DB-side ticket allocation: create_order_atomic now issues ticket numbers
// from public.ticket_counters (one row per Asia/Manila day) instead of trusting
// caller input, and can persist voided_by/voided_at on already-voided orders.
// These tests hit the live Supabase project via the service client - no
// browser. Every row uses an e2e-* id and is cleaned up regardless of
// pass/fail. The counter row itself is left: it tracks issued tickets for the
// day and deleting it would allow reuse.

// The project's publishable key - public by design (embedded in the shipped
// browser bundle), used only to prove direct client access is denied.
const PUBLISHABLE_KEY = "sb_publishable_t08cMNx4UckmxBiIhv69QA_OG6KOodT";

type Client = ReturnType<typeof supabaseTestClient>;

function phDayRange(day: string) {
  const start = new Date(`${day}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function createOrderRpc(
  supabase: Client,
  overrides: {
    id?: string;
    ticketNo?: string;
    createdAt?: string;
    voided?: boolean;
    voidReason?: string;
    voidedBy?: string;
    total?: number;
  } = {},
) {
  const orderId = overrides.id ?? e2eId("ticket-order");
  const total = overrides.total ?? 10;
  const { data, error } = await supabase.rpc("create_order_atomic", {
    p_order_id: orderId,
    p_created_at: overrides.createdAt ?? new Date().toISOString(),
    p_barista_name: "E2E Ticket",
    p_barista_user_id: null,
    p_items: [
      { productId: "e2e-ticket-item", name: "E2E Ticket Item", qty: 1, price: total },
    ],
    p_subtotal: total,
    p_discount: 0,
    p_promo_id: null,
    p_promo_label: null,
    p_total: total,
    p_payment_method: "cash",
    p_ticket_no: overrides.ticketNo ?? null,
    p_paid: total,
    p_change: 0,
    p_deductions: [],
    p_voided: overrides.voided ?? false,
    p_void_reason: overrides.voidReason ?? null,
    p_voided_by: overrides.voidedBy ?? null,
  });
  return { data, error, orderId };
}

test.describe("atomic ticket allocation", () => {
  const orderIds: string[] = [];
  const requestIds: string[] = [];
  const counterDays = new Set<string>();

  test.afterEach(async () => {
    const supabase = supabaseTestClient();
    for (const requestId of requestIds.splice(0)) {
      await supabase.from("void_requests").delete().eq("id", requestId);
    }
    for (const orderId of orderIds.splice(0)) {
      await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
    }
    // Counter rows for days where the suite was the only writer are removed so
    // no synthetic seed survives; today's counter stays (it reflects real
    // issued tickets).
    const todayPH = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    for (const day of counterDays) {
      if (day !== todayPH) {
        const { start, end } = phDayRange(day);
        const { data: remaining } = await supabase
          .from("orders")
          .select("id")
          .gte("created_at", start)
          .lt("created_at", end);
        if (!remaining?.length) {
          await supabase.from("ticket_counters").delete().eq("day", day);
        }
      }
    }
  });

  test("concurrent creates get distinct tickets; caller-supplied ticket is ignored", async () => {
    const supabase = supabaseTestClient();
    const results = await Promise.all([
      createOrderRpc(supabase, { ticketNo: "999" }),
      createOrderRpc(supabase),
      createOrderRpc(supabase),
    ]);
    for (const r of results) {
      expect(r.error, r.error?.message).toBeNull();
      orderIds.push(r.orderId);
    }

    const tickets = results.map((r) => r.data.ticketNo as string);
    expect(new Set(tickets).size, `tickets must be unique: ${tickets}`).toBe(3);
    for (const t of tickets) expect(t).toMatch(/^\d{3}$/);
    expect(tickets).not.toContain("999");

    const { data: counter } = await supabase
      .from("ticket_counters")
      .select("day, n")
      .order("day", { ascending: false })
      .limit(1)
      .single();
    expect(counter).toBeTruthy();
    counterDays.add(counter!.day);
    expect(Number(counter!.n)).toBeGreaterThanOrEqual(
      Math.max(...tickets.map((t) => Number(t))),
    );

    // Tickets are sequential: sorted numbers differ by exactly 1.
    const sorted = tickets.map(Number).sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBe(1);
    expect(sorted[2] - sorted[1]).toBe(1);
  });

  test("allocation never collides with existing same-day orders incl. voided", async () => {
    const supabase = supabaseTestClient();
    const todayPH = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const { start, end } = phDayRange(todayPH);

    const r = await createOrderRpc(supabase);
    expect(r.error, r.error?.message).toBeNull();
    orderIds.push(r.orderId);

    // Uniqueness invariant: within the PH day, exactly one order - this one -
    // holds the allocated ticket number.
    const { data: holders } = await supabase
      .from("orders")
      .select("id")
      .eq("ticket_no", r.data.ticketNo)
      .gte("created_at", start)
      .lt("created_at", end);
    expect(holders?.map((o) => o.id)).toEqual([r.orderId]);
  });

  test("voiding an order never frees its ticket number", async () => {
    const supabase = supabaseTestClient();
    const first = await createOrderRpc(supabase);
    expect(first.error).toBeNull();
    orderIds.push(first.orderId);
    const freed = first.data.ticketNo as string;

    const { error: voidError } = await supabase.rpc("void_order_atomic", {
      p_order_id: first.orderId,
      p_reason: "e2e ticket void-no-reuse",
      p_voided_by: "admin-1",
    });
    expect(voidError).toBeNull();

    const { data: voided } = await supabase
      .from("orders")
      .select("voided, voided_by, voided_at")
      .eq("id", first.orderId)
      .single();
    expect(voided?.voided).toBe(true);
    expect(voided?.voided_by).toBe("admin-1");
    expect(voided?.voided_at).toBeTruthy();

    const next = await createOrderRpc(supabase);
    expect(next.error).toBeNull();
    orderIds.push(next.orderId);
    expect(next.data.ticketNo).not.toBe(freed);
    expect(Number(next.data.ticketNo)).toBeGreaterThan(Number(freed));
  });

  test("pre-voided create (voidCheckout path) sets voided_by + voided_at + allocated ticket", async () => {
    const supabase = supabaseTestClient();
    const manager = (
      await supabase.from("staff_users").select("id").eq("username", "manager").single()
    ).data;
    expect(manager?.id, "seed manager account must exist").toBeTruthy();

    const r = await createOrderRpc(supabase, {
      voided: true,
      voidReason: "e2e pre-checkout void",
      voidedBy: manager!.id,
      ticketNo: "777",
    });
    expect(r.error, r.error?.message).toBeNull();
    orderIds.push(r.orderId);
    expect(r.data.ticketNo).not.toBe("777");

    const { data: order } = await supabase
      .from("orders")
      .select("voided, void_reason, voided_by, voided_at, ticket_no")
      .eq("id", r.orderId)
      .single();
    expect(order?.voided).toBe(true);
    expect(order?.void_reason).toBe("e2e pre-checkout void");
    expect(order?.voided_by).toBe(manager!.id);
    expect(order?.voided_at).toBeTruthy();
    expect(order?.ticket_no).toBe(r.data.ticketNo);
  });

  test("voided_by rejects non-staff ids (FK enforced)", async () => {
    const supabase = supabaseTestClient();
    const r = await createOrderRpc(supabase, {
      voided: true,
      voidReason: "fk probe",
      voidedBy: "not-a-staff-user",
    });
    expect(r.error?.message ?? "").toMatch(/voided_by|foreign key|violates/i);
    if (!r.error) orderIds.push(r.orderId);
  });

  test("pre-checkout approval allocates the ticket at approval time", async () => {
    const supabase = supabaseTestClient();
    const staffId = e2eId("ticket-staff");
    await supabase.from("staff_users").insert({
      id: staffId,
      username: staffId,
      password: "e2e-placeholder",
      name: "E2E Ticket Staff",
      role: "barista",
      title: "E2E",
    });
    const requestId = e2eId("ticket-vr");
    const newOrderId = e2eId("ticket-approved");
    requestIds.push(requestId);
    orderIds.push(newOrderId);

    try {
      const { error: insertError } = await supabase.from("void_requests").insert({
        id: requestId,
        requested_at: new Date().toISOString(),
        requested_by_id: staffId,
        requested_by_name: "E2E Ticket Staff",
        reason: "e2e ticket cart request",
        status: "pending",
        order_id: null,
        items: [
          { productId: "e2e-ticket-item", name: "E2E Ticket Item", qty: 1, price: 10 },
        ],
        subtotal: 10,
        discount: 0,
        promo_label: null,
        total: 10,
        payment_method: "cash",
      });
      expect(insertError).toBeNull();

      const { data, error } = await supabase.rpc("approve_void_request_atomic", {
        p_request_id: requestId,
        p_approved_by_id: "admin-1",
        p_approved_by_name: "E2E Admin",
        p_new_order_id: newOrderId,
        p_ticket_no: "888",
      });
      expect(error).toBeNull();
      expect(data?.ok, JSON.stringify(data)).toBe(true);
      expect(data?.processedOrderId).toBe(newOrderId);

      const { data: order } = await supabase
        .from("orders")
        .select("voided, voided_by, voided_at, ticket_no")
        .eq("id", newOrderId)
        .single();
      expect(order?.voided).toBe(true);
      expect(order?.voided_by).toBe("admin-1");
      expect(order?.voided_at).toBeTruthy();
      expect(order?.ticket_no).toMatch(/^\d{3}$/);
      expect(order?.ticket_no).not.toBe("888");
    } finally {
      await supabase.from("staff_users").delete().eq("id", staffId);
    }
  });

  test("PH-day boundary allocates on a separate per-day counter", async () => {
    const supabase = supabaseTestClient();
    // An order backdated to a past PH day allocates on that day's counter,
    // seeded above that day's existing orders - independent of today's.
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const r = await createOrderRpc(supabase, { createdAt: past.toISOString() });
    expect(r.error, r.error?.message).toBeNull();
    orderIds.push(r.orderId);

    const phDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(past);
    counterDays.add(phDay);

    const { data: counter } = await supabase
      .from("ticket_counters")
      .select("n")
      .eq("day", phDay)
      .single();
    const { start, end } = phDayRange(phDay);
    const { data: thatDay } = await supabase
      .from("orders")
      .select("id")
      .gte("created_at", start)
      .lt("created_at", end);
    // The counter for that day equals the day's total order count (seeded
    // above pre-existing orders, then incremented once for this insert), and
    // the ticket equals the final counter value zero-padded - "001" on a
    // previously empty day.
    expect(Number(counter?.n)).toBe((thatDay ?? []).length);
    expect(r.data.ticketNo).toBe(
      String((thatDay ?? []).length).padStart(3, "0"),
    );
  });

  test("RLS: publishable key cannot read ticket_counters or call allocator", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const url = Object.fromEntries(
      fs
        .readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    ).SUPABASE_URL;
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(url, PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error: selectError } = await anon
      .from("ticket_counters")
      .select("day")
      .limit(1);
    // Access is denied either by revoked privileges (error) or by RLS with no
    // policies (zero rows readable).
    expect(selectError !== null || (data ?? []).length === 0).toBe(true);

    const { error: rpcError } = await anon.rpc("next_ticket_no");
    expect(rpcError).not.toBeNull();
  });
});
