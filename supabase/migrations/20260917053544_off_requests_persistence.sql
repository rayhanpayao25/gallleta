-- Phase 6: persist OffRequest (the Request Off tab in UserManager.tsx),
-- which today only lives in store.offRequests (memory-only, never read
-- from or written to Supabase) and disappears on every cold start.
--
-- OffRequest = { id, userId, name, date, reason, status: "pending"|"approved"|"denied", createdAt }
--
-- user_id is nullable with ON DELETE SET NULL, not CASCADE: deleting a
-- staff_users row must never erase off-request history. name is kept as a
-- snapshot on every row (same reasoning as login_activity in Phase 5) so a
-- row stays understandable even after the staff account is renamed or
-- deleted.

create table if not exists public.off_requests (
  id text primary key,
  user_id text references public.staff_users(id) on delete set null,
  name text not null,
  date date not null,
  reason text not null,
  status text not null check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null
);

-- UserManager.tsx re-sorts by date/createdAt in JS regardless, but reads
-- should not depend on unspecified row order either.
create index if not exists off_requests_created_at_idx on public.off_requests (created_at);
create index if not exists off_requests_user_id_idx on public.off_requests (user_id);

-- Tables created via plain CREATE TABLE do not inherit the
-- anon/authenticated/service_role grants that tables created through the
-- Supabase dashboard get automatically (discovered in Phase 4, recurred in
-- Phase 5) - grant them explicitly so the app's service-role client can
-- actually use this table.
grant select, insert, update, delete on public.off_requests to anon, authenticated, service_role;
