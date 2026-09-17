-- Persist VoidRequest (the cashier -> admin void approval workflow), which
-- today only lives in store.voidRequests (memory-only, never read from or
-- written to Supabase) - it disappears on every cold start and is invisible
-- to other serverless instances.
--
-- Current model (src/lib/types.ts):
--   VoidRequest = {
--     id, requestedAt, requestedById, requestedByName, reason,
--     status: "pending" | "approved",
--     orderId?,            -- set when voiding an already-created order;
--                          -- absent for pre-checkout cart voids
--     items: OrderItem[],  -- cart/order line snapshot {productId,name,qty,price}
--     subtotal, discount, promoLabel?, total, paymentMethod,
--     approvedAt?, approvedByName?, processedOrderId?
--   }
--
-- Two live modes, both preserved:
--   order_id NOT NULL -> approval voids that existing order (void_order_atomic)
--   order_id NULL     -> approval creates an already-voided order row
--                        (create_order_atomic with p_voided, no deductions)

create table if not exists public.void_requests (
  id text primary key,
  requested_at timestamptz not null,
  -- Snapshot semantics: deleting a staff account must not erase request
  -- history, so ON DELETE SET NULL + requested_by_name keeps the row
  -- readable (same reasoning as login_activity/off_requests).
  requested_by_id text references public.staff_users(id) on delete set null,
  requested_by_name text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  -- Nullable: pre-checkout requests have no order yet. SET NULL keeps the
  -- request row if the referenced order is hard-deleted by an admin.
  order_id text references public.orders(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  subtotal integer not null default 0,
  discount integer not null default 0,
  promo_label text,
  total integer not null default 0,
  payment_method text not null default 'cash',
  approved_at timestamptz,
  approved_by_name text,
  processed_order_id text references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists void_requests_requested_at_idx
  on public.void_requests (requested_at);
create index if not exists void_requests_order_id_idx
  on public.void_requests (order_id);

-- The app-level rule "a cashier may only have one pending request" was an
-- in-memory check; enforce it durably so it also holds across instances.
create unique index if not exists void_requests_one_pending_per_user
  on public.void_requests (requested_by_id)
  where status = 'pending';

-- === Atomic approval =====================================================
-- Claim + apply in ONE transaction: the request row is locked FOR UPDATE,
-- the existing-order void (void_order_atomic) or pre-checkout order
-- creation (create_order_atomic) runs inside the same transaction, and the
-- request is marked approved only when the order effect succeeds. Two
-- admins approving concurrently cannot double-void or double-create: the
-- second blocks on the row lock, then sees status <> 'pending'.
create or replace function public.approve_void_request_atomic(
  p_request_id text,
  p_approved_by_id text,
  p_approved_by_name text,
  p_new_order_id text default null,
  p_ticket_no text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_req public.void_requests%rowtype;
  v_result jsonb;
  v_processed text;
begin
  select * into v_req from public.void_requests where id = p_request_id for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_APPROVED');
  end if;

  if v_req.order_id is not null then
    -- orders.voided_by is an FK to staff_users.id, so the actor id (not the
    -- display-name snapshot) is passed to the void RPC.
    select public.void_order_atomic(v_req.order_id, v_req.reason, p_approved_by_id)
      into v_result;
    if not coalesce((v_result->>'ok')::boolean, false) then
      -- e.g. ALREADY_VOIDED: the order is already in the desired end state,
      -- so the request stays pending (same visible outcome as before).
      return v_result;
    end if;
    v_processed := v_req.order_id;
  else
    if p_new_order_id is null or length(trim(p_new_order_id)) = 0 then
      raise exception 'approve_void_request_atomic: p_new_order_id is required for pre-checkout void requests';
    end if;
    select public.create_order_atomic(
      p_new_order_id, now(), v_req.requested_by_name, v_req.requested_by_id,
      v_req.items, v_req.subtotal, v_req.discount, null, v_req.promo_label,
      v_req.total, v_req.payment_method, coalesce(p_ticket_no, ''),
      0, 0, '[]'::jsonb, true, v_req.reason
    ) into v_result;
    v_processed := p_new_order_id;
  end if;

  update public.void_requests
  set status = 'approved',
      approved_at = now(),
      approved_by_name = p_approved_by_name,
      processed_order_id = v_processed
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'processedOrderId', v_processed);
end;
$$;

-- Server-side service-role client only: no browser code talks to Supabase.
grant select, insert, update, delete on public.void_requests to service_role;
revoke all on public.void_requests from anon, authenticated;
alter table public.void_requests enable row level security;

revoke all on function public.approve_void_request_atomic(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_void_request_atomic(text, text, text, text, text)
  to service_role;
