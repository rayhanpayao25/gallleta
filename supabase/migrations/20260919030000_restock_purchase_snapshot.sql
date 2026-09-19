-- KAN-126: the restocks row must preserve the purchase-facing entry the
-- admin typed (e.g. "10 pcs") alongside the normalized base-unit
-- quantity_added (e.g. 10000 ml) that stock arithmetic and reversal depend
-- on. quantity_added semantics are unchanged. The new snapshot columns are
-- nullable: legacy rows cannot be reconstructed safely (their entered
-- pieces depend on the item's purchase_unit_size at the time, which may
-- have changed), so they simply read as NULL and the UI falls back to the
-- computed display it already used.

alter table public.restocks
  add column if not exists purchase_qty numeric,
  add column if not exists purchase_unit text;

-- Replace the create/edit restock RPCs with the extended signature. The old
-- overloads are dropped deliberately so PostgREST cannot resolve an
-- ambiguous function; the new trailing params default to null so callers on
-- the previous signature keep working during a rolling deploy.
drop function if exists public.create_restock_atomic(text, text, text, numeric, timestamptz);
drop function if exists public.edit_restock_atomic(text, text, numeric, text, text, numeric, timestamptz);

create or replace function public.create_restock_atomic(
  p_id text,
  p_inventory_item_id text,
  p_item_name_snapshot text,
  p_quantity_added numeric,
  p_created_at timestamptz,
  p_purchase_qty numeric default null,
  p_purchase_unit text default null
)
returns jsonb
language plpgsql
as $$
begin
  insert into public.restocks (id, inventory_item_id, item_name_snapshot, quantity_added, purchase_qty, purchase_unit, created_at)
  values (p_id, p_inventory_item_id, p_item_name_snapshot, p_quantity_added, p_purchase_qty, p_purchase_unit, p_created_at);

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
  p_new_created_at timestamptz,
  p_new_purchase_qty numeric default null,
  p_new_purchase_unit text default null
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
      purchase_qty = p_new_purchase_qty,
      purchase_unit = p_new_purchase_unit,
      created_at = p_new_created_at
  where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.create_restock_atomic(text, text, text, numeric, timestamptz, numeric, text) from public, anon, authenticated;
revoke all on function public.edit_restock_atomic(text, text, numeric, text, text, numeric, timestamptz, numeric, text) from public, anon, authenticated;

grant execute on function public.create_restock_atomic(text, text, text, numeric, timestamptz, numeric, text) to service_role;
grant execute on function public.edit_restock_atomic(text, text, numeric, text, text, numeric, timestamptz, numeric, text) to service_role;
