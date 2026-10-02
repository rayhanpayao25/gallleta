-- Match the persisted menu to the Coffee ZZ printed menu and store per-size
-- prices so POS orders, recipes, and receipts all use the selected cup size.

alter table public.menu_categories
  add column if not exists sort_order integer not null default 1000;

alter table public.menu_items
  add column if not exists sizes jsonb not null default '[]'::jsonb,
  add column if not exists sort_order integer not null default 1000;

alter table public.order_items
  add column if not exists size text;

alter table public.recipe_costings
  add column if not exists small_cup_inventory_item_id text references public.inventory_items(id) on delete set null,
  add column if not exists large_cup_inventory_item_id text references public.inventory_items(id) on delete set null;

insert into public.menu_categories (id, name, sort_order)
values
  ('non-coffee', 'Non Coffee', 0),
  ('soda-series', 'Soda Series', 1),
  ('coffee-series', 'Coffee Series', 2),
  ('milky-series', 'Milky Series', 3),
  ('yugort-series', 'Yugort Series', 4),
  ('milk-tea-series', 'Milk Tea Series', 5),
  ('frappe-series', 'Frappe Series', 6)
on conflict (id) do update
set name = excluded.name, sort_order = excluded.sort_order;

create temporary table coffeezz_target_menu (
  id text primary key,
  name text not null,
  category_id text not null,
  sort_order integer not null,
  sizes jsonb not null
) on commit drop;

insert into coffeezz_target_menu (id, name, category_id, sort_order, sizes)
values
  ('iced-matcha', 'Iced Matcha', 'non-coffee', 0, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('iced-milo', 'Iced Milo', 'non-coffee', 1, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('iced-choco', 'Iced Choco', 'non-coffee', 2, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('choco-hazel-nut', 'Choco Hazel Nut', 'non-coffee', 3, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('matcha-berry', 'Matcha Berry', 'non-coffee', 4, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('blueberry-matcha', 'Blueberry Matcha', 'non-coffee', 5, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('soda-green-apple', 'Green Apple', 'soda-series', 6, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('soda-strawberry', 'Strawberry', 'soda-series', 7, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('soda-blueberry', 'Blueberry', 'soda-series', 8, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('mixed-berries-soda', 'Mixed Berries', 'soda-series', 9, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('lychee-soda', 'Lychee', 'soda-series', 10, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('caramel-macchiato', 'Caramel Macchiato', 'coffee-series', 11, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('spanish-latte', 'Spanish Latte', 'coffee-series', 12, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('vanilla-latte', 'Vanilla Latte', 'coffee-series', 13, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('salted-caramel', 'Salted Caramel', 'coffee-series', 14, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('matcha-latte', 'Matcha Latte', 'coffee-series', 15, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('mocha-latte', 'Mocha Latte', 'coffee-series', 16, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('milky-strawberry-milk', 'Strawberry Milk', 'milky-series', 17, '[{"label":"16oz","price":89},{"label":"22oz","price":109}]'),
  ('strawberry-matcha', 'Strawberry Matcha', 'milky-series', 18, '[{"label":"16oz","price":89},{"label":"22oz","price":109}]'),
  ('matcha-oreo', 'Matcha Oreo', 'milky-series', 19, '[{"label":"16oz","price":89},{"label":"22oz","price":109}]'),
  ('milky-cookies-cream', 'Cookies & Cream', 'milky-series', 20, '[{"label":"16oz","price":89},{"label":"22oz","price":109}]'),
  ('milo-lava', 'Milo Lava', 'milky-series', 21, '[{"label":"16oz","price":89},{"label":"22oz","price":109}]'),
  ('choco-berry', 'Choco Berry', 'milky-series', 22, '[{"label":"16oz","price":89},{"label":"22oz","price":109}]'),
  ('yogurt-strawberry', 'Strawberry', 'yugort-series', 23, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('yogurt-blueberry', 'Blueberry', 'yugort-series', 24, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('yogurt-green-apple', 'Green Apple', 'yugort-series', 25, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('yogurt-mixed-berries', 'Mixed Berries', 'yugort-series', 26, '[{"label":"16oz","price":50},{"label":"22oz","price":70}]'),
  ('brown-sugar-boba', 'Brown Sugar Boba', 'milk-tea-series', 27, '[{"label":"16oz","price":60},{"label":"22oz","price":80}]'),
  ('okinawa-milk-tea', 'Okinawa', 'milk-tea-series', 28, '[{"label":"16oz","price":60},{"label":"22oz","price":80}]'),
  ('wintermelon-milk-tea', 'Wintermelon', 'milk-tea-series', 29, '[{"label":"16oz","price":60},{"label":"22oz","price":80}]'),
  ('dark-choco-milk-tea', 'Dark Choco', 'milk-tea-series', 30, '[{"label":"16oz","price":60},{"label":"22oz","price":80}]'),
  ('cookies-cream-milk-tea', 'Cookies & Cream', 'milk-tea-series', 31, '[{"label":"16oz","price":60},{"label":"22oz","price":80}]'),
  ('frappe-strawberry-milk', 'Strawberry Milk', 'frappe-series', 32, '[{"label":"22oz","price":129}]'),
  ('frappe-matcha', 'Matcha', 'frappe-series', 33, '[{"label":"22oz","price":129}]'),
  ('frappe-matcha-oreo', 'Matcha Oreo', 'frappe-series', 34, '[{"label":"22oz","price":129}]'),
  ('dark-choco-cookies-frappe', 'Dark Choco Cookies', 'frappe-series', 35, '[{"label":"22oz","price":129}]'),
  ('java-chips-frappe', 'Java Chips', 'frappe-series', 36, '[{"label":"22oz","price":129}]');

insert into public.menu_items (
  id, name, price, category_id, image, available, styles, addons, sizes, sort_order
)
select
  target.id,
  target.name,
  (target.sizes -> 0 ->> 'price')::integer,
  target.category_id,
  '/images/logo.jpg',
  true,
  '[]'::jsonb,
  '[]'::jsonb,
  target.sizes,
  target.sort_order
from coffeezz_target_menu as target
on conflict (id) do update
set
  name = excluded.name,
  price = excluded.price,
  category_id = excluded.category_id,
  available = excluded.available,
  styles = excluded.styles,
  addons = excluded.addons,
  sizes = excluded.sizes,
  sort_order = excluded.sort_order;

-- order_items keeps name/price snapshots, so pruning obsolete menu rows does
-- not change historical receipts or charged totals.
delete from public.menu_items
where id not in (select id from coffeezz_target_menu);

delete from public.menu_categories
where id not in (
  'non-coffee',
  'soda-series',
  'coffee-series',
  'milky-series',
  'yugort-series',
  'milk-tea-series',
  'frappe-series'
);

create or replace function public.create_order_atomic(
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
      qty, price_snapshot, style, size, addons
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
      nullif(v_item->>'size', ''),
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

-- Keep the existing seven-argument recipe-costing RPC available for older
-- app instances while adding the 16oz and 22oz cup assignments used by the
-- current POS.
create function public.save_recipe_costing(
  p_id text,
  p_name text,
  p_hot_cup_inventory_item_id text,
  p_iced_cup_inventory_item_id text,
  p_other_cup_inventory_item_id text,
  p_small_cup_inventory_item_id text,
  p_large_cup_inventory_item_id text,
  p_menu_items jsonb,
  p_ingredients jsonb
)
returns void
language plpgsql
as $$
begin
  if p_id is null or length(trim(p_id)) = 0 then
    raise exception 'save_recipe_costing: p_id is required';
  end if;
  if p_menu_items is null or jsonb_typeof(p_menu_items) <> 'array' then
    raise exception 'save_recipe_costing: p_menu_items must be a JSON array';
  end if;
  if p_ingredients is null or jsonb_typeof(p_ingredients) <> 'array' then
    raise exception 'save_recipe_costing: p_ingredients must be a JSON array';
  end if;

  insert into public.recipe_costings (
    id, name, hot_cup_inventory_item_id, iced_cup_inventory_item_id,
    other_cup_inventory_item_id, small_cup_inventory_item_id,
    large_cup_inventory_item_id
  )
  values (
    p_id,
    trim(coalesce(p_name, '')),
    nullif(trim(coalesce(p_hot_cup_inventory_item_id, '')), ''),
    nullif(trim(coalesce(p_iced_cup_inventory_item_id, '')), ''),
    nullif(trim(coalesce(p_other_cup_inventory_item_id, '')), ''),
    nullif(trim(coalesce(p_small_cup_inventory_item_id, '')), ''),
    nullif(trim(coalesce(p_large_cup_inventory_item_id, '')), '')
  )
  on conflict (id) do update
    set name = excluded.name,
        hot_cup_inventory_item_id = excluded.hot_cup_inventory_item_id,
        iced_cup_inventory_item_id = excluded.iced_cup_inventory_item_id,
        other_cup_inventory_item_id = excluded.other_cup_inventory_item_id,
        small_cup_inventory_item_id = excluded.small_cup_inventory_item_id,
        large_cup_inventory_item_id = excluded.large_cup_inventory_item_id,
        updated_at = now();

  delete from public.recipe_costing_menu_items where recipe_costing_id = p_id;
  insert into public.recipe_costing_menu_items (recipe_costing_id, menu_item_name)
  select p_id, trim(value)
  from jsonb_array_elements_text(p_menu_items) as value
  where trim(value) <> '';

  delete from public.recipe_costing_ingredients where recipe_costing_id = p_id;
  insert into public.recipe_costing_ingredients (
    id, recipe_costing_id, inventory_item_id, name, amount, unit
  )
  select
    p_id || '-ing-' || row_number() over (),
    p_id,
    nullif(nullif(trim(coalesce(elem->>'inventoryItemId', '')), ''), 'other'),
    trim(elem->>'name'),
    (elem->>'amount')::numeric,
    coalesce(nullif(trim(elem->>'unit'), ''), '')
  from jsonb_array_elements(p_ingredients) as elem
  where trim(coalesce(elem->>'name', '')) <> '';
end;
$$;

revoke all on function public.save_recipe_costing(text, text, text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_recipe_costing(text, text, text, text, text, text, text, jsonb, jsonb)
  to service_role;
