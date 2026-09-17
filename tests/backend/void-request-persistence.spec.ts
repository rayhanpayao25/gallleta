import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";

// Void-request durability: the approval workflow now persists in
// public.void_requests instead of process memory. These tests exercise the
// real rows and the approve_void_request_atomic RPC directly against the
// live, shared Supabase project - no browser needed. Every row uses an
// e2e-* id and is cleaned up regardless of pass/fail.

// The project's publishable key - public by design (it is embedded in every
// browser bundle), used here only to prove direct client access is denied.
const PUBLISHABLE_KEY = "sb_publishable_t08cMNx4UckmxBiIhv69QA_OG6KOodT";

async function makeStaffUser(supabase: ReturnType<typeof supabaseTestClient>, label: string) {
  const id = e2eId(`staff-${label}`);
  const { error } = await supabase.from("staff_users").insert({
    id,
    username: id,
    password: "e2e-placeholder",
    name: `E2E ${label}`,
    role: "barista",
    title: "E2E",
  });
  expect(error, `staff_users insert failed: ${error?.message}`).toBeNull();
  return id;
}

function requestRow(input: {
  id: string;
  staffId: string;
  orderId?: string | null;
  items?: { productId: string; name: string; qty: number; price: number }[];
  total?: number;
}) {
  return {
    id: input.id,
    requested_at: new Date().toISOString(),
    requested_by_id: input.staffId,
    requested_by_name: "E2E Requester",
    reason: "e2e void request persistence",
    status: "pending",
    order_id: input.orderId ?? null,
    items: input.items ?? [],
    subtotal: input.total ?? 0,
    discount: 0,
    promo_label: null,
    total: input.total ?? 0,
    payment_method: "cash",
  };
}

test.describe("void request persistence", () => {
  test("post-order request: approve voids the order atomically, restores inventory exactly once, blocks double approval, delete persists", async () => {
    const supabase = supabaseTestClient();
    const menuItem = (
      await supabase.from("menu_items").select("id, name, price").limit(1).single()
    ).data!;
    const itemId = e2eId("inv");
    const staffId = await makeStaffUser(supabase, "req");
    let adminId = "";
    const orderId = e2eId("order");
    const requestId = e2eId("vr");
    await supabase.from("inventory_items").insert({
      id: itemId,
      name: "E2E Void Request Item",
      unit: "pcs",
      cost: 1,
      stock: 10,
      max_stock: 100,
    });

    try {
      const created = await supabase.rpc("create_order_atomic", {
        p_order_id: orderId,
        p_created_at: new Date().toISOString(),
        p_barista_name: "E2E",
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
        p_ticket_no: "E2E-VR",
        p_paid: menuItem.price,
        p_change: 0,
        p_deductions: [
          { inventoryItemId: itemId, itemName: "E2E Void Request Item", amount: 2, unit: "pcs" },
        ],
      });
      expect(created.error, `create_order_atomic failed: ${created.error?.message}`).toBeNull();
      const afterOrder = await supabase
        .from("inventory_items")
        .select("stock")
        .eq("id", itemId)
        .single();
      expect(Number(afterOrder.data?.stock)).toBe(8);

      const inserted = await supabase.from("void_requests").insert(
        requestRow({
          id: requestId,
          staffId,
          orderId,
          items: [{ productId: menuItem.id, name: menuItem.name, qty: 1, price: menuItem.price }],
          total: menuItem.price,
        }),
      );
      expect(inserted.error, `void_requests insert failed: ${inserted.error?.message}`).toBeNull();

      adminId = await makeStaffUser(supabase, "admin");
      const approved = await supabase.rpc("approve_void_request_atomic", {
        p_request_id: requestId,
        p_approved_by_id: adminId,
        p_approved_by_name: "E2E Admin",
      });
      expect(approved.error, `approve rpc error: ${approved.error?.message}`).toBeNull();
      expect(approved.data?.ok, JSON.stringify(approved.data)).toBe(true);
      expect(approved.data?.processedOrderId).toBe(orderId);

      const request = (
        await supabase.from("void_requests").select("*").eq("id", requestId).single()
      ).data!;
      expect(request.status).toBe("approved");
      expect(request.approved_by_name).toBe("E2E Admin");
      expect(request.approved_at).toBeTruthy();
      expect(request.processed_order_id).toBe(orderId);

      const order = (
        await supabase.from("orders").select("*").eq("id", orderId).single()
      ).data!;
      expect(order.voided).toBe(true);
      expect(order.void_reason).toBe("e2e void request persistence");
      expect(order.voided_at).toBeTruthy();
      expect(order.voided_by).toBe(adminId);

      const restored = await supabase
        .from("inventory_items")
        .select("stock")
        .eq("id", itemId)
        .single();
      expect(Number(restored.data?.stock), "inventory restored exactly once").toBe(10);

      const second = await supabase.rpc("approve_void_request_atomic", {
        p_request_id: requestId,
        p_approved_by_id: adminId,
        p_approved_by_name: "E2E Admin",
      });
      expect(second.error).toBeNull();
      expect(second.data?.ok).toBe(false);
      expect(second.data?.error).toBe("ALREADY_APPROVED");
      const afterSecond = await supabase
        .from("inventory_items")
        .select("stock")
        .eq("id", itemId)
        .single();
      expect(Number(afterSecond.data?.stock), "no double restore").toBe(10);

      const deleted = await supabase.from("void_requests").delete().eq("id", requestId);
      expect(deleted.error).toBeNull();
      const gone = await supabase.from("void_requests").select("id").eq("id", requestId);
      expect(gone.data ?? [], "request row gone and stays gone").toHaveLength(0);
    } finally {
      await supabase.from("void_requests").delete().eq("id", requestId);
      await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
      await supabase.from("inventory_items").delete().eq("id", itemId);
      await supabase
        .from("staff_users")
        .delete()
        .in("id", [staffId, adminId].filter(Boolean));
    }
  });

  test("pre-checkout request (order_id null): approve creates an already-voided order with no inventory movement", async () => {
    const supabase = supabaseTestClient();
    const menuItem = (
      await supabase.from("menu_items").select("id, name, price").limit(1).single()
    ).data!;
    const itemId = e2eId("inv");
    const staffId = await makeStaffUser(supabase, "pre");
    const requestId = e2eId("vr");
    const newOrderId = e2eId("order");
    await supabase.from("inventory_items").insert({
      id: itemId,
      name: "E2E Pre-Void Item",
      unit: "pcs",
      cost: 1,
      stock: 5,
      max_stock: 100,
    });

    try {
      await supabase.from("void_requests").insert(
        requestRow({
          id: requestId,
          staffId,
          items: [{ productId: menuItem.id, name: menuItem.name, qty: 2, price: menuItem.price }],
          total: menuItem.price * 2,
        }),
      );

      const approved = await supabase.rpc("approve_void_request_atomic", {
        p_request_id: requestId,
        p_approved_by_id: null,
        p_approved_by_name: "E2E Admin",
        p_new_order_id: newOrderId,
        p_ticket_no: "E2E-PRE",
      });
      expect(approved.error, `approve rpc error: ${approved.error?.message}`).toBeNull();
      expect(approved.data?.ok, JSON.stringify(approved.data)).toBe(true);
      expect(approved.data?.processedOrderId).toBe(newOrderId);

      const order = (
        await supabase.from("orders").select("*").eq("id", newOrderId).single()
      ).data!;
      expect(order.voided).toBe(true);
      expect(order.void_reason).toBe("e2e void request persistence");
      expect(order.voided_at).toBeTruthy();
      expect(order.barista_name).toBe("E2E Requester");
      expect(order.ticket_no).toBe("E2E-PRE");

      const lines = await supabase.from("order_items").select("*").eq("order_id", newOrderId);
      expect(lines.data ?? []).toHaveLength(1);
      expect(lines.data?.[0].qty).toBe(2);

      const usage = await supabase.from("usage_logs").select("id").eq("order_id", newOrderId);
      expect(usage.data ?? [], "pre-checkout void never deducts inventory").toHaveLength(0);
      const stock = await supabase
        .from("inventory_items")
        .select("stock")
        .eq("id", itemId)
        .single();
      expect(Number(stock.data?.stock)).toBe(5);

      const request = (
        await supabase.from("void_requests").select("*").eq("id", requestId).single()
      ).data!;
      expect(request.status).toBe("approved");
      expect(request.processed_order_id).toBe(newOrderId);
    } finally {
      await supabase.from("void_requests").delete().eq("id", requestId);
      await supabase.rpc("delete_order_atomic", { p_order_id: newOrderId });
      await supabase.from("inventory_items").delete().eq("id", itemId);
      await supabase.from("staff_users").delete().eq("id", staffId);
    }
  });

  test("one pending request per requester is enforced at the DB level across any writer", async () => {
    const supabase = supabaseTestClient();
    const staffId = await makeStaffUser(supabase, "dup");
    const firstId = e2eId("vr");
    const secondId = e2eId("vr");
    const thirdId = e2eId("vr");

    try {
      const first = await supabase
        .from("void_requests")
        .insert(requestRow({ id: firstId, staffId }));
      expect(first.error).toBeNull();

      const duplicate = await supabase
        .from("void_requests")
        .insert(requestRow({ id: secondId, staffId }));
      expect(duplicate.error?.message, "second pending request must be rejected").toMatch(
        /one_pending_per_user|duplicate key/,
      );

      await supabase.from("void_requests").update({ status: "approved" }).eq("id", firstId);
      const afterApproval = await supabase
        .from("void_requests")
        .insert(requestRow({ id: thirdId, staffId }));
      expect(afterApproval.error, "a new pending request is allowed once the first is resolved").toBeNull();
    } finally {
      await supabase.from("void_requests").delete().in("id", [firstId, secondId, thirdId]);
      await supabase.from("staff_users").delete().eq("id", staffId);
    }
  });

  test("deleting the staff account nulls requested_by_id but keeps the request snapshot", async () => {
    const supabase = supabaseTestClient();
    const staffId = await makeStaffUser(supabase, "fk");
    const requestId = e2eId("vr");

    try {
      await supabase.from("void_requests").insert(requestRow({ id: requestId, staffId }));
      await supabase.from("void_requests").update({ status: "approved" }).eq("id", requestId);
      await supabase.from("staff_users").delete().eq("id", staffId);

      const request = (
        await supabase.from("void_requests").select("*").eq("id", requestId).single()
      ).data!;
      expect(request.requested_by_id).toBeNull();
      expect(request.requested_by_name).toBe("E2E Requester");
    } finally {
      await supabase.from("void_requests").delete().eq("id", requestId);
      await supabase.from("staff_users").delete().eq("id", staffId);
    }
  });

  test("RLS: the public publishable key cannot read or write void_requests or the hardened tables", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const envPath = path.join(process.cwd(), ".env.local");
    const url = Object.fromEntries(
      fs
        .readFileSync(envPath, "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    ).SUPABASE_URL;
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(url, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    for (const table of [
      "void_requests",
      "login_activity",
      "off_requests",
      "recipe_costings",
      "recipe_costing_menu_items",
      "recipe_costing_ingredients",
    ]) {
      const { error } = await anon.from(table).select("id").limit(1);
      expect(error?.message ?? "", `${table}: anon select must be denied`).toMatch(
        /permission denied|row-level security/i,
      );
    }
    const { error: writeError } = await anon.from("void_requests").insert(
      requestRow({ id: e2eId("vr"), staffId: "nobody" }),
    );
    expect(writeError?.message ?? "", "anon insert must be denied").toMatch(
      /permission denied|row-level security/i,
    );
  });
});
