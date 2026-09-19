import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Voided-ticket reclaim regression coverage.
//
// These specs exercise create_order_atomic / void_order_atomic against a
// real Postgres backend, so they MUTATE the database they point at. They
// therefore refuse to run against the canonical production project and only
// execute when an isolated project is supplied via:
//   TICKET_TEST_SUPABASE_URL
//   TICKET_TEST_SUPABASE_SECRET_KEY
//
// All rows use the `tkr-` id prefix and are deleted in finally blocks.

const PROD_REF = "jnozoxaieyirasqwzarl";
const TEST_URL = process.env.TICKET_TEST_SUPABASE_URL;
const TEST_KEY = process.env.TICKET_TEST_SUPABASE_SECRET_KEY;
const ISOLATED = !!TEST_URL && !!TEST_KEY && !TEST_URL.includes(PROD_REF);

let seq = 0;
function oid(label: string) {
  seq += 1;
  return `tkr-${label}-${Date.now().toString(36)}-${seq}`;
}

const ITEMS = JSON.stringify([{ productId: "x", name: "Item", qty: 1, price: 100 }]);

async function createOrder(
  supabase: SupabaseClient,
  id: string,
  opts: { voided?: boolean; createdAt?: string } = {},
) {
  const { data, error } = await supabase.rpc("create_order_atomic", {
    p_order_id: id,
    p_created_at: opts.createdAt ?? new Date().toISOString(),
    p_barista_name: "tkr",
    p_barista_user_id: null,
    p_items: ITEMS,
    p_subtotal: 100,
    p_discount: 0,
    p_promo_id: null,
    p_promo_label: null,
    p_total: 100,
    p_payment_method: "cash",
    p_paid: 100,
    p_change: 0,
    p_deductions: "[]",
    p_voided: opts.voided ?? false,
    p_void_reason: opts.voided ? "tkr" : null,
    p_voided_by: opts.voided ? "tkr" : null,
  });
  expect(error, `create_order_atomic failed: ${error?.message}`).toBeNull();
  return (data as { ticketNo: string }).ticketNo;
}

async function voidOrder(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.rpc("void_order_atomic", {
    p_order_id: id,
    p_reason: "tkr",
    p_voided_by: "tkr",
  });
  expect(error, `void_order_atomic failed: ${error?.message}`).toBeNull();
  return data as { ok: boolean; error?: string };
}

async function cleanup(supabase: SupabaseClient, ids: string[]) {
  await supabase.from("order_items").delete().in("order_id", ids);
  await supabase.from("usage_logs").delete().in("order_id", ids);
  await supabase.from("orders").delete().in("id", ids);
}

test.describe("voided ticket reclaim", () => {
  test.skip(!ISOLATED, "requires TICKET_TEST_SUPABASE_URL/_SECRET_KEY pointing at a non-production project");

  let supabase: SupabaseClient;
  test.beforeAll(() => {
    supabase = createClient(TEST_URL!, TEST_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  test("latest voided ticket is reclaimed by the next completed order", async () => {
    const a = oid("a");
    const b = oid("b");
    const c = oid("c");
    try {
      const t1 = await createOrder(supabase, a);
      const t2 = await createOrder(supabase, b);
      expect(t2 > t1).toBe(true);
      expect((await voidOrder(supabase, b)).ok).toBe(true);
      const t3 = await createOrder(supabase, c);
      // The next completed order reuses the just-voided latest ticket.
      expect(t3).toBe(t2);

      const { data: rows } = await supabase
        .from("orders")
        .select("id, ticket_no, voided")
        .in("id", [b, c]);
      // Duplicate display numbers coexist: historical voided row + active row.
      expect(rows?.find((r) => r.id === b)?.voided).toBe(true);
      expect(rows?.find((r) => r.id === c)?.voided).toBe(false);
      expect(rows?.find((r) => r.id === b)?.ticket_no).toBe(t2);
    } finally {
      await cleanup(supabase, [a, b, c]);
    }
  });

  test("a transaction created already-voided does not consume the sequence", async () => {
    const a = oid("a");
    const v = oid("v");
    const c = oid("c");
    try {
      await createOrder(supabase, a);
      const voidedTicket = await createOrder(supabase, v, { voided: true });
      const next = await createOrder(supabase, c);
      // The pre-checkout void's number is immediately reusable.
      expect(next).toBe(voidedTicket);
    } finally {
      await cleanup(supabase, [a, v, c]);
    }
  });

  test("historical void does not rewind the counter", async () => {
    const a = oid("a");
    const b = oid("b");
    const c = oid("c");
    const d = oid("d");
    try {
      const t1 = await createOrder(supabase, a);
      await createOrder(supabase, b);
      const t3 = await createOrder(supabase, c);
      // Void the middle ticket AFTER later tickets exist.
      expect((await voidOrder(supabase, a)).ok).toBe(true);
      const next = await createOrder(supabase, d);
      expect(Number(next)).toBe(Number(t3) + 1);
      expect(next > t1).toBe(true);
    } finally {
      await cleanup(supabase, [a, b, c, d]);
    }
  });

  test("double void is rejected and cannot reclaim twice", async () => {
    const a = oid("a");
    const b = oid("b");
    const c = oid("c");
    try {
      await createOrder(supabase, a);
      const t = await createOrder(supabase, b);
      expect((await voidOrder(supabase, b)).ok).toBe(true);
      const second = await voidOrder(supabase, b);
      expect(second.ok).toBe(false);
      expect(second.error).toBe("ALREADY_VOIDED");
      // Only one reclaim happened: the next order gets the voided ticket once.
      expect(await createOrder(supabase, c)).toBe(t);
    } finally {
      await cleanup(supabase, [a, b, c]);
    }
  });

  test("chained latest voids reclaim in order and skip permanently-consumed numbers", async () => {
    const a = oid("a");
    const b = oid("b");
    const c = oid("c");
    const d = oid("d");
    try {
      await createOrder(supabase, a);
      const t2 = await createOrder(supabase, b);
      const t3 = await createOrder(supabase, c);
      // Void t1 while t2/t3 exist: t1 is permanently consumed.
      await voidOrder(supabase, a);
      // Void t3 then t2: both were latest at void time and reclaim in order.
      await voidOrder(supabase, c);
      await voidOrder(supabase, b);
      const next = await createOrder(supabase, d);
      expect(next).toBe(t2);
      const again = oid("e");
      const after = await createOrder(supabase, again);
      expect(after).toBe(t3);
      await cleanup(supabase, [again]);
    } finally {
      await cleanup(supabase, [a, b, c, d]);
    }
  });

  test("concurrent completed orders never share a ticket", async () => {
    const ids = Array.from({ length: 5 }, () => oid("p"));
    try {
      const tickets = await Promise.all(ids.map((id) => createOrder(supabase, id)));
      expect(new Set(tickets).size).toBe(ids.length);
    } finally {
      await cleanup(supabase, ids);
    }
  });

  test("reclaim is scoped to the order's Philippine sales day", async () => {
    const old = oid("old");
    const today = oid("today");
    try {
      // An order created on a different PH day uses that day's counter.
      const oldTicket = await createOrder(supabase, old, {
        createdAt: "2020-06-15T10:00:00.000Z",
      });
      await voidOrder(supabase, old);
      const reclaimed = oid("old2");
      const again = await createOrder(supabase, reclaimed, {
        createdAt: "2020-06-15T11:00:00.000Z",
      });
      expect(again).toBe(oldTicket);
      await cleanup(supabase, [reclaimed]);
      // Today's counter is unaffected by the other day's reclaim.
      const todayTicket = await createOrder(supabase, today);
      expect(Number(todayTicket)).toBeGreaterThan(0);
    } finally {
      await cleanup(supabase, [old, today]);
    }
  });
});
