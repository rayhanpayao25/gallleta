-- Phase 5: persist LoginActivity (real login/logout, manual staff punches,
-- barista clock-in/out), which today only lives in store.loginActivity
-- (memory-only, never read from or written to Supabase). Every entry
-- disappears on a cold start, which also breaks openBaristaShifts() -
-- a barista clocked in right before a restart looks "not clocked in"
-- afterward and can double-clock-in.
--
-- LoginActivity = { id, userId, username, name, role, type: "login"|"logout", at }
--
-- user_id is nullable with ON DELETE SET NULL, not CASCADE: deleting a
-- staff_users row must never erase attendance history. username/name/role
-- are stored as snapshots on every row specifically so a row stays fully
-- readable (who, what role, when) even after the staff account is renamed
-- or deleted.

create table if not exists public.login_activity (
  id text primary key,
  user_id text references public.staff_users(id) on delete set null,
  username text not null,
  name text not null,
  role text not null,
  type text not null check (type in ('login', 'logout')),
  at timestamptz not null
);

-- pairLoginSessions()/openBaristaShifts() re-sort in JS regardless, but
-- reads should not depend on unspecified row order either.
create index if not exists login_activity_at_idx on public.login_activity (at);
create index if not exists login_activity_user_id_idx on public.login_activity (user_id);

-- Tables created via plain CREATE TABLE do not inherit the
-- anon/authenticated/service_role grants that tables created through the
-- Supabase dashboard get automatically (discovered in Phase 4) - grant them
-- explicitly so the app's service-role client can actually use this table.
grant select, insert, update, delete on public.login_activity to anon, authenticated, service_role;
