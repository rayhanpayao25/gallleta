-- RLS hardening for the tables created during the persistence phases.
--
-- Audit finding: these five tables were created with broad CRUD grants to
-- anon + authenticated AND row-level security disabled, so anyone holding
-- the public anon key could read/write them directly through PostgREST.
-- The application only ever touches them from server actions via the
-- service-role client (no browser code creates a Supabase client at all),
-- so the correct posture is: RLS enabled with zero permissive policies
-- (deny-all for non-bypass roles) plus the client-role grants revoked.
-- service_role bypasses RLS and keeps its table grants, so every existing
-- server action keeps working unchanged.
--
-- Older pre-existing tables (orders, menu_items, ...) already have RLS
-- enabled and no permissive policies, so they are already sealed for
-- anon/authenticated and are intentionally left untouched.

alter table public.login_activity enable row level security;
alter table public.off_requests enable row level security;
alter table public.recipe_costings enable row level security;
alter table public.recipe_costing_menu_items enable row level security;
alter table public.recipe_costing_ingredients enable row level security;

revoke all on public.login_activity from anon, authenticated;
revoke all on public.off_requests from anon, authenticated;
revoke all on public.recipe_costings from anon, authenticated;
revoke all on public.recipe_costing_menu_items from anon, authenticated;
revoke all on public.recipe_costing_ingredients from anon, authenticated;
