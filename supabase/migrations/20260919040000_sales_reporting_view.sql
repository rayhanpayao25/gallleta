-- KAN-124: a dedicated database structure for Sales reporting.
--
-- Implemented as a VIEW over orders/order_items - the authoritative
-- transactional ledger - rather than a second mutable sales table, so:
--   * no dual-write inconsistency is possible
--   * historical orders appear automatically (no backfill)
--   * new orders land transactionally via create_order_atomic
--   * hard-deleted orders disappear, voided orders remain visible with
--     voided = true (matching Admin analytics, which exclude voided rows
--     from totals via liveOrders()).
--
-- sales_date is the order's calendar day in Asia/Manila, matching the
-- PH-time bucketing the Admin Sales page already uses.

create or replace view public.sales
with (security_invoker = true) as
select
  o.id                                                          as order_id,
  o.ticket_no,
  o.created_at,
  (o.created_at at time zone 'Asia/Manila')::date               as sales_date,
  o.barista_name,
  o.subtotal,
  o.discount,
  o.promo_label,
  o.total,
  o.paid,
  o.change,
  o.payment_method,
  o.voided,
  o.void_reason,
  coalesce(items.item_count, 0)                                 as item_count,
  coalesce(items.qty_total, 0)                                  as qty_total,
  items.items                                                   as items
from public.orders o
left join lateral (
  select
    count(*)          as item_count,
    coalesce(sum(oi.qty), 0) as qty_total,
    jsonb_agg(
      jsonb_build_object(
        'product_id', oi.product_id_snapshot,
        'name', oi.name_snapshot,
        'qty', oi.qty,
        'price', oi.price_snapshot,
        'style', oi.style,
        'addons', oi.addons
      )
      order by oi.created_at
    ) as items
  from public.order_items oi
  where oi.order_id = o.id
) items on true;

-- Same access discipline as the protected business tables: the view runs
-- with the invoker's privileges (security_invoker), so non-service roles
-- are additionally blocked by the revoked view grant and their lack of
-- SELECT on the underlying tables.
revoke all on public.sales from public, anon, authenticated;
grant select on public.sales to service_role;
