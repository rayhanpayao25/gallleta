-- Permanently remove Promotions, Void, and Off Requests data and schema.
drop view if exists public.sales;

delete from public.orders where voided = true;

drop function if exists public.approve_void_request_atomic(text, text, text, text, text);
drop function if exists public.approve_void_request_atomic(text, text, text, text);
drop function if exists public.void_order_atomic(text, text, text);
drop function if exists public.create_order_atomic(
  text, timestamptz, text, text, jsonb, integer, integer, text, text,
  integer, text, text, integer, integer, jsonb, boolean, text, text
);

drop table if exists public.void_requests cascade;
drop table if exists public.off_requests cascade;
drop table if exists public.promotions cascade;

alter table public.orders
  drop column if exists discount,
  drop column if exists promo_id,
  drop column if exists promo_label,
  drop column if exists voided,
  drop column if exists void_reason,
  drop column if exists voided_at,
  drop column if exists voided_by;

create function public.create_order_atomic(
  p_order_id text,
  p_created_at timestamptz,
  p_barista_name text,
  p_barista_user_id text,
  p_items jsonb,
  p_subtotal integer,
  p_total integer,
  p_payment_method text,
  p_ticket_no text,
  p_paid integer,
  p_change integer,
  p_deductions jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_item jsonb;
  v_index integer := 0;
  v_menu_item_id text;
  v_deduction jsonb;
  v_updated_rows integer;
  v_ticket_no text;
begin
  if p_order_id is null or length(trim(p_order_id)) = 0 then
    raise exception 'create_order_atomic: p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order_atomic: p_items must be a non-empty JSON array';
  end if;

  v_ticket_no := public.next_ticket_no(p_created_at);

  insert into public.orders (
    id, created_at, barista_name, barista_user_id, subtotal,
    total, payment_method, ticket_no, paid, change
  )
  values (
    p_order_id, p_created_at, p_barista_name, p_barista_user_id, p_subtotal,
    p_total, p_payment_method, v_ticket_no, p_paid, p_change
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    select id into v_menu_item_id from public.menu_items where id = v_item->>'productId';
    insert into public.order_items (
      id, order_id, menu_item_id, product_id_snapshot, name_snapshot,
      qty, price_snapshot, style, addons
    )
    values (
      p_order_id || '-item-' || v_index,
      p_order_id,
      v_menu_item_id,
      v_item->>'productId',
      v_item->>'name',
      (v_item->>'qty')::integer,
      (v_item->>'price')::integer,
      nullif(v_item->>'style', ''),
      case when jsonb_typeof(v_item->'addons') = 'array' then v_item->'addons' else '[]'::jsonb end
    );
  end loop;

  if p_deductions is not null and jsonb_typeof(p_deductions) = 'array' then
    for v_deduction in select * from jsonb_array_elements(p_deductions)
    loop
      update public.inventory_items
      set stock = stock - (v_deduction->>'amount')::numeric
      where id = v_deduction->>'inventoryItemId'
        and stock >= (v_deduction->>'amount')::numeric;

      get diagnostics v_updated_rows = row_count;
      if v_updated_rows = 0 then
        raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_deduction->>'itemName', v_deduction->>'inventoryItemId');
      end if;

      insert into public.usage_logs (
        id, order_id, order_item_id, inventory_item_id,
        item_name_snapshot, used_amount, unit
      )
      values (
        p_order_id || '-' || (v_deduction->>'inventoryItemId') || '-usage',
        p_order_id,
        coalesce(v_deduction->>'orderItemId', ''),
        v_deduction->>'inventoryItemId',
        v_deduction->>'itemName',
        (v_deduction->>'amount')::numeric,
        v_deduction->>'unit'
      );
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'orderId', p_order_id, 'ticketNo', v_ticket_no);
end;
$$;

revoke all on function public.create_order_atomic(
  text, timestamptz, text, text, jsonb, integer, integer,
  text, text, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.create_order_atomic(
  text, timestamptz, text, text, jsonb, integer, integer,
  text, text, integer, integer, jsonb
) to service_role;

create or replace function public.delete_order_atomic(p_order_id text)
returns jsonb
language plpgsql
as $$
declare
  v_id text;
  v_usage record;
begin
  select id into v_id from public.orders where id = p_order_id for update;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  for v_usage in
    select inventory_item_id, used_amount
    from public.usage_logs
    where order_id = p_order_id and inventory_item_id is not null
  loop
    update public.inventory_items
    set stock = stock + v_usage.used_amount
    where id = v_usage.inventory_item_id;
  end loop;

  delete from public.orders where id = p_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

create view public.sales
with (security_invoker = true) as
select
  o.id as order_id,
  o.ticket_no,
  o.created_at,
  (o.created_at at time zone 'Asia/Manila')::date as sales_date,
  o.barista_name,
  o.subtotal,
  o.total,
  o.paid,
  o.change,
  o.payment_method,
  coalesce(items.item_count, 0) as item_count,
  coalesce(items.qty_total, 0) as qty_total,
  items.items as items
from public.orders o
left join lateral (
  select
    count(*) as item_count,
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

revoke all on public.sales from public, anon, authenticated;
grant select on public.sales to service_role;
