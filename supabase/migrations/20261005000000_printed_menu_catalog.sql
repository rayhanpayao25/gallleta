-- Replace the menu catalog with the current printed Galleta Cafe menu.
insert into public.menu_categories (id, name, sort_order)
values
  ('coffee-drinks', 'Coffee Drinks', 0),
  ('non-coffee-drinks', 'Non-Coffee Drinks', 1),
  ('soda-pop', 'Soda Pop', 2),
  ('matcha-series', 'Matcha Series', 3),
  ('snacks', 'Snacks', 4),
  ('rice-meals', 'Rice Meals', 5)
on conflict (id) do update
set name = excluded.name, sort_order = excluded.sort_order;

create temporary table printed_menu_addons (
  id text primary key,
  name text not null,
  price integer not null,
  sort_order integer not null
) on commit drop;

insert into printed_menu_addons (id, name, price, sort_order)
values
  ('coffee-shot', 'Coffee Shot', 15, 0),
  ('oreo', 'Oreo', 15, 1),
  ('strawberry', 'Strawberry', 15, 2),
  ('nata-de-coco', 'Nata de Coco', 10, 3),
  ('sea-salt-cream', 'Sea Salt Cream', 25, 4),
  ('seaweed-per-pack', 'Seaweed (per pack)', 25, 5);

create temporary table printed_menu_target (
  id text primary key,
  name text not null,
  category_id text not null,
  sort_order integer not null,
  sizes jsonb not null,
  addons jsonb not null
) on commit drop;

insert into printed_menu_target (id, name, category_id, sort_order, sizes, addons)
select
  item.id,
  item.name,
  item.category_id,
  item.sort_order,
  item.sizes,
  case
    when item.category_id in ('coffee-drinks', 'non-coffee-drinks', 'soda-pop', 'matcha-series')
      then (
        select jsonb_agg(jsonb_build_object(
          'id', addon.id,
          'name', addon.name,
          'price', addon.price,
          'qtyEnabled', false
        ) order by addon.sort_order)
        from printed_menu_addons as addon
      )
    else '[]'::jsonb
  end
from (values
  ('iced-latte', 'Iced Latte', 'coffee-drinks', 0, '[{"label":"16oz","price":69}]'::jsonb),
  ('spanish-latte', 'Spanish Latte', 'coffee-drinks', 1, '[{"label":"16oz","price":69}]'::jsonb),
  ('caramel-macchiato', 'Caramel Macchiato', 'coffee-drinks', 2, '[{"label":"16oz","price":69}]'::jsonb),
  ('hazelnut-latte', 'Hazelnut Latte', 'coffee-drinks', 3, '[{"label":"16oz","price":69}]'::jsonb),
  ('cinnamon-latte', 'Cinnamon Latte', 'coffee-drinks', 4, '[{"label":"16oz","price":69}]'::jsonb),
  ('sea-salt-latte', 'Sea Salt Latte', 'coffee-drinks', 5, '[{"label":"16oz","price":79}]'::jsonb),

  ('milo-dino', 'Milo Dino', 'non-coffee-drinks', 6, '[{"label":"16oz","price":59}]'::jsonb),
  ('iced-chocolate', 'Iced Chocolate', 'non-coffee-drinks', 7, '[{"label":"16oz","price":59}]'::jsonb),
  ('choco-oreo', 'Choco Oreo', 'non-coffee-drinks', 8, '[{"label":"16oz","price":59}]'::jsonb),
  ('choco-berry', 'Choco Berry', 'non-coffee-drinks', 9, '[{"label":"16oz","price":59}]'::jsonb),
  ('strawberry-milk', 'Strawberry Milk', 'non-coffee-drinks', 10, '[{"label":"16oz","price":59}]'::jsonb),

  ('soda-green-apple', 'Green Apple', 'soda-pop', 11, '[{"label":"16oz","price":49}]'::jsonb),
  ('soda-blueberry', 'Blueberry', 'soda-pop', 12, '[{"label":"16oz","price":49}]'::jsonb),
  ('soda-strawberry', 'Strawberry', 'soda-pop', 13, '[{"label":"16oz","price":49}]'::jsonb),
  ('soda-lychee', 'Lychee', 'soda-pop', 14, '[{"label":"16oz","price":49}]'::jsonb),

  ('milky-matcha', 'Milky Matcha', 'matcha-series', 15, '[{"label":"16oz","price":69}]'::jsonb),
  ('matcha-oreo', 'Matcha Oreo', 'matcha-series', 16, '[{"label":"16oz","price":69}]'::jsonb),
  ('matcha-berry', 'Matcha Berry', 'matcha-series', 17, '[{"label":"16oz","price":69}]'::jsonb),

  ('cheesy-fries', 'Cheesy Fries', 'snacks', 18, '[{"label":"1 order","price":69}]'::jsonb),
  ('regular-fries', 'Regular Fries', 'snacks', 19, '[{"label":"1 order","price":49}]'::jsonb),
  ('nachos', 'Nachos', 'snacks', 20, '[{"label":"1 order","price":69}]'::jsonb),
  ('siomai', 'Siomai', 'snacks', 21, '[{"label":"1 order","price":49}]'::jsonb),
  ('tempura', 'Tempura', 'snacks', 22, '[{"label":"1 order","price":49}]'::jsonb),
  ('squidballs', 'Squidballs', 'snacks', 23, '[{"label":"1 order","price":49}]'::jsonb),

  ('tapsilog', 'Tapsilog', 'rice-meals', 24, '[{"label":"1 order","price":109}]'::jsonb),
  ('tocilog', 'Tocilog', 'rice-meals', 25, '[{"label":"1 order","price":99}]'::jsonb),
  ('hungarian-silog', 'Hungarian Silog', 'rice-meals', 26, '[{"label":"1 order","price":109}]'::jsonb),
  ('chicken-wings', 'Chicken Wings', 'rice-meals', 27, '[{"label":"2pcs","price":79},{"label":"3pcs","price":99}]'::jsonb)
) as item(id, name, category_id, sort_order, sizes);

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
  target.addons,
  target.sizes,
  target.sort_order
from printed_menu_target as target
on conflict (id) do update
set
  name = excluded.name,
  price = excluded.price,
  category_id = excluded.category_id,
  image = excluded.image,
  available = excluded.available,
  styles = excluded.styles,
  addons = excluded.addons,
  sizes = excluded.sizes,
  sort_order = excluded.sort_order;

-- Keep only the printed catalog; order rows retain name and price snapshots.
delete from public.menu_items
where id not in (select id from printed_menu_target);

delete from public.menu_categories
where id not in (
  'coffee-drinks',
  'non-coffee-drinks',
  'soda-pop',
  'matcha-series',
  'snacks',
  'rice-meals'
);
