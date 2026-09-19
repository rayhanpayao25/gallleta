-- Reclaim the latest voided ticket number so a void does not permanently
-- consume the completed-order sequence.
--
-- Business rule: the ticket sequence tracks successful orders. When the
-- most recently allocated ticket is voided (or a transaction is created
-- already-voided by the pre-checkout void flow) and no later ticket has
-- been allocated yet, the next completed order may reuse that number.
-- Older voids never rewind the counter: the reclaim is a conditional
-- UPDATE ... WHERE n = <voided ticket> on the day row, which re-evaluates
-- after the row lock is acquired, so a concurrent allocation or a
-- historical void cannot rewind the sequence. A second void of the same
-- order returns ALREADY_VOIDED before reaching the counter and cannot
-- decrement twice. Voided order rows keep their ticket_no for audit; a
-- later completed order may display the same number, so mutations always
-- target order.id, never ticket_no.
--
-- No data is rewritten: existing orders and ticket_counters rows are
-- untouched. Only function definitions change.

create or replace function public.void_order_atomic(
  p_order_id text,
  p_reason text,
  p_voided_by text
)
returns jsonb
language plpgsql
as $$
declare
  v_id text;
  v_voided boolean;
  v_created_at timestamptz;
  v_ticket_no text;
  v_usage record;
begin
  -- FOR UPDATE locks the order row: a concurrent/second void call blocks
  -- here until the first transaction commits, then sees voided = true and
  -- returns ALREADY_VOIDED instead of restoring inventory a second time.
  select id, voided, created_at, ticket_no
    into v_id, v_voided, v_created_at, v_ticket_no
    from public.orders where id = p_order_id for update;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if v_voided then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_VOIDED');
  end if;

  for v_usage in
    select inventory_item_id, used_amount
    from public.usage_logs
    where order_id = p_order_id and inventory_item_id is not null
  loop
    update public.inventory_items set stock = stock + v_usage.used_amount where id = v_usage.inventory_item_id;
  end loop;

  update public.orders
  set voided = true, void_reason = p_reason, voided_at = now(), voided_by = p_voided_by
  where id = p_order_id;

  -- Reclaim the number only when this order's ticket is still the latest
  -- allocation for its PH day. The UPDATE's WHERE clause is re-evaluated
  -- after the ticket_counters row lock is acquired, so if another order
  -- already consumed the next number this is a no-op and the sequence is
  -- not rewound. Non-numeric/blank tickets are ignored.
  if v_ticket_no ~ '^[0-9]+$' then
    update public.ticket_counters
    set n = n - 1
    where day = (v_created_at at time zone 'Asia/Manila')::date
      and n = v_ticket_no::integer;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.void_order_atomic(text, text, text) from public, anon, authenticated;
grant execute on function public.void_order_atomic(text, text, text) to service_role;

-- create_order_atomic: an order created directly as voided (pre-checkout
-- void approval) must not consume a completed-order number. It is still
-- allocated a ticket for audit display, then the allocation is released
-- inside the same transaction while the counter row lock is held, so the
-- next completed order reuses it.
create or replace function public.create_order_atomic(
  p_order_id text,
  p_created_at timestamptz,
  p_barista_name text,
  p_barista_user_id text,
  p_items jsonb,
  p_subtotal integer,
  p_discount integer,
  p_promo_id text,
  p_promo_label text,
  p_total integer,
  p_payment_method text,
  p_ticket_no text default null,
  p_paid integer default 0,
  p_change integer default 0,
  p_deductions jsonb default '[]'::jsonb,
  p_voided boolean default false,
  p_void_reason text default null,
  p_voided_by text default null
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

  -- The ticket number is issued by the DB allocator inside this transaction:
  -- one INSERT ... ON CONFLICT DO UPDATE on the day row serializes concurrent
  -- orders. p_ticket_no is ignored.
  v_ticket_no := public.next_ticket_no(p_created_at);

  -- An already-voided order (pre-checkout void) keeps its allocated number
  -- for audit but must not advance the completed-order sequence. This
  -- transaction still holds the ticket_counters row lock taken by
  -- next_ticket_no, so the release cannot race another allocation.
  if p_voided then
    update public.ticket_counters
    set n = n - 1
    where day = (p_created_at at time zone 'Asia/Manila')::date
      and n = v_ticket_no::integer;
  end if;

  insert into public.orders (
    id, created_at, barista_name, barista_user_id, subtotal, discount,
    promo_id, promo_label, total, payment_method, ticket_no, paid, change,
    voided, void_reason, voided_at, voided_by
  )
  values (
    p_order_id, p_created_at, p_barista_name, p_barista_user_id, p_subtotal, p_discount,
    p_promo_id, p_promo_label, p_total, p_payment_method, v_ticket_no, p_paid, p_change,
    p_voided,
    case when p_voided then p_void_reason else null end,
    case when p_voided then now() else null end,
    case when p_voided then p_voided_by else null end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    -- product_id_snapshot/name_snapshot are the historical source of truth;
    -- menu_item_id is a live-lookup convenience and must stay NULL for
    -- manual/synthetic entries that are not a real menu_items.id (e.g. the
    -- Transactions tab's "manual-<id>" rows), since it has an FK.
    select id into v_menu_item_id from public.menu_items where id = v_item->>'productId';
    insert into public.order_items (id, order_id, menu_item_id, product_id_snapshot, name_snapshot, qty, price_snapshot, style, addons)
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

  if not p_voided and p_deductions is not null and jsonb_typeof(p_deductions) = 'array' then
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

      insert into public.usage_logs (id, order_id, order_item_id, inventory_item_id, item_name_snapshot, used_amount, unit)
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
  text, timestamptz, text, text, jsonb, integer, integer, text, text,
  integer, text, text, integer, integer, jsonb, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.create_order_atomic(
  text, timestamptz, text, text, jsonb, integer, integer, text, text,
  integer, text, text, integer, integer, jsonb, boolean, text, text
) to service_role;
