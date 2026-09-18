-- Make the persisted restocks row authoritative for stock reversal on delete.
--
-- Previously the caller supplied p_inventory_item_id / p_quantity_added. A
-- stale UI/store snapshot could send a null or wrong inventory id, and the
-- function would delete the ledger row while skipping the inventory reversal.
-- Now the function locks the target row, reads its own persisted
-- inventory_item_id and quantity_added, reverses that exact quantity, and
-- deletes the row - all in the same transaction. The two extra parameters are
-- kept so already-deployed callers keep working; they are ignored.
--
-- Legacy rows with inventory_item_id = null fall back to an unambiguous
-- exact name match on item_name_snapshot (there is exactly one such row in
-- production and it resolves uniquely). Ambiguous names raise instead of
-- guessing. If the inventory item itself is gone, the ledger delete still
-- proceeds but the result reports reversed=false explicitly.

create or replace function public.delete_restock_atomic(
  p_id text,
  p_inventory_item_id text,
  p_quantity_added numeric
)
returns jsonb
language plpgsql
as $$
declare
  v_restock public.restocks%rowtype;
  v_item_id text;
  v_matches integer;
begin
  select * into v_restock from public.restocks where id = p_id for update;
  if not found then
    raise exception 'delete_restock_atomic: restock % not found', p_id;
  end if;

  v_item_id := v_restock.inventory_item_id;

  if v_item_id is null then
    select count(*) into v_matches
    from public.inventory_items
    where lower(trim(name)) = lower(trim(v_restock.item_name_snapshot));
    if v_matches = 1 then
      select id into v_item_id from public.inventory_items
      where lower(trim(name)) = lower(trim(v_restock.item_name_snapshot));
    elsif v_matches > 1 then
      raise exception 'delete_restock_atomic: cannot safely reverse restock % - % inventory items named "%"', p_id, v_matches, v_restock.item_name_snapshot;
    end if;
  end if;

  if v_item_id is not null then
    update public.inventory_items
    set stock = greatest(0, stock - v_restock.quantity_added)
    where id = v_item_id;
    if not found then
      v_item_id := null;
    end if;
  end if;

  delete from public.restocks where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'reversed', v_item_id is not null,
    'inventoryItemId', v_item_id,
    'quantityAdded', v_restock.quantity_added
  );
end;
$$;

revoke all on function public.delete_restock_atomic(text, text, numeric) from public, anon, authenticated;
grant execute on function public.delete_restock_atomic(text, text, numeric) to service_role;
