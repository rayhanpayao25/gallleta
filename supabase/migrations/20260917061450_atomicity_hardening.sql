-- Phase 8: atomic RPCs for order creation, void, deletion, and restocks.
--
-- Recipe/costing resolution (ingredientsForOrderLine, which of recipeCostings
-- vs legacy recipes applies, cup-sku selection, addon deduction) stays in
-- TypeScript, unchanged - reimplementing that resolution logic in SQL would
-- risk silently diverging from the actual business logic. These RPCs take a
-- pre-resolved deduction manifest (already computed by the existing TS
-- logic) and perform the WRITE + stock-safety enforcement atomically.
--
-- Overselling protection: inventory deduction uses
--   UPDATE inventory_items SET stock = stock - x WHERE id = ... AND stock >= x
-- which is safe under concurrency - Postgres serializes concurrent UPDATEs to
-- the same row, so two simultaneous orders can never both succeed against a
-- combined deduction that would go negative; the loser's WHERE clause
-- evaluates against the post-commit value and affects zero rows, which
-- raises an exception and rolls back the whole order.

alter table public.inventory_items
  add constraint inventory_items_stock_nonnegative check (stock >= 0) not valid;
alter table public.inventory_items validate constraint inventory_items_stock_nonnegative;

-- === Order creation ===================================================
-- p_voided/p_void_reason cover approveVoidRequest()'s "no prior checkout"
-- path (a cashier requested void approval before ever completing the sale,
-- so no inventory was ever deducted) - the order is inserted already
-- voided, with deductions skipped entirely regardless of what's passed in.
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
  p_ticket_no text,
  p_paid integer,
  p_change integer,
  p_deductions jsonb,
  p_voided boolean default false,
  p_void_reason text default null
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
begin
  if p_order_id is null or length(trim(p_order_id)) = 0 then
    raise exception 'create_order_atomic: p_order_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_order_atomic: p_items must be a non-empty JSON array';
  end if;

  insert into public.orders (
    id, created_at, barista_name, barista_user_id, subtotal, discount,
    promo_id, promo_label, total, payment_method, ticket_no, paid, change, voided, void_reason, voided_at
  )
  values (
    p_order_id, p_created_at, p_barista_name, p_barista_user_id, p_subtotal, p_discount,
    p_promo_id, p_promo_label, p_total, p_payment_method, p_ticket_no, p_paid, p_change, p_voided,
    case when p_voided then p_void_reason else null end,
    case when p_voided then now() else null end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    -- product_id_snapshot/name_snapshot are the historical source of truth;
    -- menu_item_id is a live-lookup convenience and must stay NULL for
    -- manual/synthetic entries that are not a real menu_items.id (e.g. the
    -- Transactions tab's "manual-<id>" rows), since it has an FK.
    select id into v_menu_item_id from public.menu_items where id = v_item->>'productId';
    insert into public.order_items (id, order_id, menu_item_id, product_id_snapshot, name_snapshot, qty, price_snapshot)
    values (
      p_order_id || '-item-' || v_index,
      p_order_id,
      v_menu_item_id,
      v_item->>'productId',
      v_item->>'name',
      (v_item->>'qty')::integer,
      (v_item->>'price')::integer
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

  return jsonb_build_object('ok', true, 'orderId', p_order_id);
end;
$$;

-- === Void (restore inventory exactly once, atomically) ================
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
  v_usage record;
begin
  -- FOR UPDATE locks the order row: a concurrent/second void call blocks
  -- here until the first transaction commits, then sees voided = true and
  -- returns ALREADY_VOIDED instead of restoring inventory a second time.
  select id, voided into v_id, v_voided from public.orders where id = p_order_id for update;
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

  return jsonb_build_object('ok', true);
end;
$$;

-- === Delete (restore inventory only if not already voided/restored) ===
create or replace function public.delete_order_atomic(p_order_id text)
returns jsonb
language plpgsql
as $$
declare
  v_id text;
  v_voided boolean;
  v_usage record;
begin
  select id, voided into v_id, v_voided from public.orders where id = p_order_id for update;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  if not v_voided then
    for v_usage in
      select inventory_item_id, used_amount
      from public.usage_logs
      where order_id = p_order_id and inventory_item_id is not null
    loop
      update public.inventory_items set stock = stock + v_usage.used_amount where id = v_usage.inventory_item_id;
    end loop;
  end if;

  -- order_items and usage_logs cascade via ON DELETE CASCADE.
  delete from public.orders where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- === Restock create/edit/delete (ledger row + stock adjustment, atomic) ==
create or replace function public.create_restock_atomic(
  p_id text,
  p_inventory_item_id text,
  p_item_name_snapshot text,
  p_quantity_added numeric,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
as $$
begin
  insert into public.restocks (id, inventory_item_id, item_name_snapshot, quantity_added, created_at)
  values (p_id, p_inventory_item_id, p_item_name_snapshot, p_quantity_added, p_created_at);

  if p_inventory_item_id is not null then
    update public.inventory_items set stock = stock + p_quantity_added where id = p_inventory_item_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.edit_restock_atomic(
  p_id text,
  p_old_inventory_item_id text,
  p_old_quantity numeric,
  p_new_inventory_item_id text,
  p_new_item_name_snapshot text,
  p_new_quantity numeric,
  p_new_created_at timestamptz
)
returns jsonb
language plpgsql
as $$
begin
  if p_old_inventory_item_id is not null then
    update public.inventory_items set stock = greatest(0, stock - p_old_quantity) where id = p_old_inventory_item_id;
  end if;
  if p_new_inventory_item_id is not null then
    update public.inventory_items set stock = stock + p_new_quantity where id = p_new_inventory_item_id;
  end if;

  update public.restocks
  set inventory_item_id = p_new_inventory_item_id,
      item_name_snapshot = p_new_item_name_snapshot,
      quantity_added = p_new_quantity,
      created_at = p_new_created_at
  where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_restock_atomic(
  p_id text,
  p_inventory_item_id text,
  p_quantity_added numeric
)
returns jsonb
language plpgsql
as $$
begin
  if p_inventory_item_id is not null then
    update public.inventory_items set stock = greatest(0, stock - p_quantity_added) where id = p_inventory_item_id;
  end if;
  delete from public.restocks where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.create_order_atomic(text, timestamptz, text, text, jsonb, integer, integer, text, text, integer, text, text, integer, integer, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.void_order_atomic(text, text, text) from public, anon, authenticated;
revoke all on function public.delete_order_atomic(text) from public, anon, authenticated;
revoke all on function public.create_restock_atomic(text, text, text, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.edit_restock_atomic(text, text, numeric, text, text, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_restock_atomic(text, text, numeric) from public, anon, authenticated;

grant execute on function public.create_order_atomic(text, timestamptz, text, text, jsonb, integer, integer, text, text, integer, text, text, integer, integer, jsonb, boolean, text) to service_role;
grant execute on function public.void_order_atomic(text, text, text) to service_role;
grant execute on function public.delete_order_atomic(text) to service_role;
grant execute on function public.create_restock_atomic(text, text, text, numeric, timestamptz) to service_role;
grant execute on function public.edit_restock_atomic(text, text, numeric, text, text, numeric, timestamptz) to service_role;
grant execute on function public.delete_restock_atomic(text, text, numeric) to service_role;
