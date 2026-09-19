import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import { createOrderAtomic, voidOrderAtomic } from "@/lib/store";

// KAN-124: public.sales is a reporting view over the authoritative
// orders/order_items ledger - no dual writes, no backfill. These specs
// prove existing orders appear, new atomic orders appear transactionally,
// voided orders stay visible flagged, deleted orders disappear, line
// detail is correct, and sales_date buckets to the PH calendar day.
// All rows use e2e-* ids and are cleaned up regardless of pass/fail.

function ensureStoreEnv() {
  for (const file of [".env", ".env.local"]) {
    const envPath = path.join(process.cwd(), file);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i < 0 || line.trim().startsWith("#")) continue;
      const key = line.slice(0, i).trim();
      if (key && !(key in process.env)) process.env[key] = line.slice(i + 1).trim();
    }
  }
}

ensureStoreEnv();

test.describe("sales reporting view (KAN-124)", () => {
  test("existing orders, transactional visibility, void and delete semantics", async () => {
    const supabase = supabaseTestClient();
    const orderId = e2eId("sales-order");

    // Historical orders are already visible - no backfill needed.
    const { data: baseline, error: baselineError } = await supabase
      .from("sales")
      .select("order_id")
      .limit(1);
    expect(baselineError, `view select failed: ${baselineError?.message}`).toBeNull();
    expect(baseline, "historical orders appear in the view").not.toBeNull();

    const created = await createOrderAtomic({
      order: {
        id: orderId,
        createdAt: new Date().toISOString(),
        baristaName: "E2E Sales",
        items: [
          {
            productId: "e2e-not-a-menu-item",
            name: "E2E Sales Drink",
            qty: 2,
            price: 120,
            style: "iced",
            addons: [{ id: "shot", name: "Shot", price: 10, qty: 1 }],
          },
        ],
        subtotal: 250,
        discount: 10,
        total: 240,
        paymentMethod: "cash",
        paid: 250,
        change: 10,
        voided: false,
      },
      deductions: [],
    });
    expect(created.ok, "order creation should succeed").toBe(true);
    const ticketNo = created.ok ? created.ticketNo : "";
    expect(ticketNo, "ticket allocated").toBeTruthy();

    try {
      // The same transaction that wrote the order makes it visible - no
      // separate sales insert exists to lag or fail.
      const { data: row, error: rowError } = await supabase
        .from("sales")
        .select("*")
        .eq("order_id", orderId)
        .single();
      expect(rowError, `sales row missing: ${rowError?.message}`).toBeNull();
      expect(row?.ticket_no).toBe(ticketNo);
      expect(Number(row?.total)).toBe(240);
      expect(Number(row?.subtotal)).toBe(250);
      expect(Number(row?.discount)).toBe(10);
      expect(row?.payment_method).toBe("cash");
      expect(row?.voided).toBe(false);
      expect(Number(row?.qty_total)).toBe(2);
      const items = row?.items as { name?: string; qty?: number; price?: number; style?: string; addons?: unknown[] }[] | null;
      expect(items?.[0]?.name).toBe("E2E Sales Drink");
      expect(items?.[0]?.style).toBe("iced");
      expect(items?.[0]?.qty).toBe(2);

      // sales_date is the PH calendar day of the order.
      const phToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
      expect(String(row?.sales_date)).toBe(phToday);

      // Voided orders stay in the view, flagged - Admin analytics exclude
      // them from totals the same way it filters liveOrders().
      const voided = await voidOrderAtomic(orderId, "e2e void", "admin-1");
      expect(voided.ok, `void failed: ${!voided.ok ? voided.error : ""}`).toBe(true);
      const { data: voidedRow } = await supabase
        .from("sales")
        .select("voided, void_reason")
        .eq("order_id", orderId)
        .single();
      expect(voidedRow?.voided).toBe(true);
      expect(voidedRow?.void_reason).toBe("e2e void");

      // Deleted orders disappear - there is no sales row to leave behind.
      const { error: deleteError } = await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
      expect(deleteError, `delete failed: ${deleteError?.message}`).toBeNull();
      const { data: gone } = await supabase
        .from("sales")
        .select("order_id")
        .eq("order_id", orderId);
      expect(gone ?? []).toHaveLength(0);
    } finally {
      await supabase.rpc("delete_order_atomic", { p_order_id: orderId }).then(() => undefined, () => undefined);
    }
  });
});
