create table if not exists public.login_links (
  id text primary key check (id = 'coffeezz-coffee'),
  admin_path text not null,
  cashier_path text not null,
  updated_at timestamptz not null default now(),
  check (admin_path <> cashier_path)
);

insert into public.login_links (id, admin_path, cashier_path)
values ('coffeezz-coffee', 'mouna1233', 'sale1803')
on conflict (id) do nothing;

revoke all on table public.login_links from anon, authenticated;
grant select, insert, update, delete on table public.login_links to service_role;
