-- Store the optional classification on each menu category, not each item.
alter table public.menu_categories
  add column if not exists type text not null default '';

notify pgrst, 'reload schema';
