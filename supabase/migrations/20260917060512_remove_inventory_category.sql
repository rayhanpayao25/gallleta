-- Phase 7: remove the obsolete InventoryItem.category field.
--
-- Confirmed before this migration (see chat record / Phase 7 report):
--   - no FK constraint references inventory_items.category
--   - no view depends on inventory_items
--   - no trigger references category
--   - exactly one function, create_inventory_item_with_restock, reads/writes
--     it; nothing in this repo's application code calls that function, no
--     other function/trigger calls it, and a 30-day postgres_logs search
--     found no invocation of it
--   - application code (src/lib/store.ts, src/components/SalePurchaseTransactions.tsx,
--     scripts/verify-inventory.ts, InventoryItem/StockItem types) has already
--     stopped reading/writing inventory_items.category as of this phase
--
-- create_inventory_item_with_restock keeps its exact existing signature
-- (including p_category) in case an external/older caller still supplies
-- that argument positionally - only the function body changes, to stop
-- referencing the column being dropped.

create or replace function public.create_inventory_item_with_restock(
  p_id text,
  p_name text,
  p_category text,
  p_unit text,
  p_cost numeric,
  p_stock numeric,
  p_max_stock numeric,
  p_restock_id text,
  p_created_at timestamp with time zone
)
returns jsonb
language plpgsql
as $function$
BEGIN
  -- p_category is intentionally accepted and ignored: inventory_items.category
  -- has been removed (see below). Kept in the signature only so an existing
  -- caller passing it positionally does not break.
  -- 1. Insert the inventory item
  INSERT INTO public.inventory_items (id, name, unit, cost, stock, max_stock)
  VALUES (p_id, p_name, p_unit, p_cost, p_stock, p_max_stock);

  -- 2. Insert the initial restock record
  INSERT INTO public.restocks (id, item_name_snapshot, quantity_added, created_at)
  VALUES (p_restock_id, p_name, p_stock, p_created_at);

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$;

alter table public.inventory_items drop column if exists category;
