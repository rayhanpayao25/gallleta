-- DB-side ticket number allocation + voided_by attribution for pre-voided orders.
--
-- Why: nextTicketNo() in application code counted only non-voided orders for
-- the PH day (a voided ticket's number was reused) and ran against a cached
-- store, so two Vercel instances could allocate the same number. Ticket
-- numbers are now allocated inside Postgres on a per-PH-day counter row;
-- INSERT ... ON CONFLICT DO UPDATE serializes concurrent allocations on that
-- row, and a voided ticket still counts as issued, so it is never reused.
--
-- Compatibility: the create_order_atomic signature keeps every existing
-- parameter (p_ticket_no is now ignored - the DB allocates instead) and gains
-- one trailing defaulted parameter (p_voided_by). Callers using named
-- parameters - including the previously deployed app, which still sends
-- p_ticket_no - keep working; the 17-argument overload is dropped so no stale
-- trusted-ticket path survives.

create table if not exists public.ticket_counters (
  day date primary key,
  n integer not null
);

alter table public.ticket_counters enable row level security;

-- Same hardened posture as the rest of the schema: the app only reaches this
-- table through service-role server actions, so direct client access is
-- revoked and no policies are created (RLS denies anon/authenticated).
revoke all on public.ticket_counters from public, anon, authenticated;
grant select, insert, update, delete on public.ticket_counters to service_role;

-- One row per Asia/Manila calendar day. On the first allocation for a day the
-- counter seeds above every order already created that day (including voided
-- orders, which still count as issued tickets), covering orders that existed
-- before this table did.
create or replace function public.next_ticket_no(p_at timestamptz default now())
returns text
language plpgsql
as $$
declare
  v_day date;
  v_n integer;
begin
  v_day := (p_at at time zone 'Asia/Manila')::date;
  insert into public.ticket_counters (day, n)
  select v_day,
         greatest(
           (select count(*) from public.orders o
             where (o.created_at at time zone 'Asia/Manila')::date = v_day),
           coalesce(
             (select max(o2.ticket_no::int) from public.orders o2
               where (o2.created_at at time zone 'Asia/Manila')::date = v_day
                 and o2.ticket_no ~ '^[0-9]+$'),
             0)
         ) + 1
  on conflict (day) do update set n = ticket_counters.n + 1
  returning n into v_n;
  return lpad(v_n::text, 3, '0');
end;
$$;

revoke all on function public.next_ticket_no(timestamptz) from public, anon, authenticated;
grant execute on function public.next_ticket_no(timestamptz) to service_role;

drop function if exists public.create_order_atomic(
  text, timestamptz, text, text, jsonb, integer, integer, text, text,
  integer, text, text, integer, integer, jsonb, boolean, text
);

create or replace function public.create_order_atomic(
  p_order_id text,
  p_created_at timestamptz,
  p_barista_name text,
  p_barista_user_id text,
  p_items jsonb,
  p_subtotal integer,
  p_discount integer,
  p_promo_id text,
  p_promo_label text,
  p_total integer,
  p_payment_method text,
  p_ticket_no text default null,
  p_paid integer default 0,
  p_change integer default 0,
  p_deductions jsonb default '[]'::jsonb,
  p_voided boolean default false,
  p_void_reason text default null,
  p_voided_by text default null
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

  -- The ticket number is issued by the DB allocator inside this transaction:
  -- one INSERT ... ON CONFLICT DO UPDATE on the day row serializes concurrent
  -- orders, and the counter counts every issued ticket (voided included), so
  -- a voided number can never be handed out again. p_ticket_no is ignored.
  v_ticket_no := public.next_ticket_no(p_created_at);

  insert into public.orders (
    id, created_at, barista_name, barista_user_id, subtotal, discount,
    promo_id, promo_label, total, payment_method, ticket_no, paid, change,
    voided, void_reason, voided_at, voided_by
  )
  values (
    p_order_id, p_created_at, p_barista_name, p_barista_user_id, p_subtotal, p_discount,
    p_promo_id, p_promo_label, p_total, p_payment_method, v_ticket_no, p_paid, p_change,
    p_voided,
    case when p_voided then p_void_reason else null end,
    case when p_voided then now() else null end,
    case when p_voided then p_voided_by else null end
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    -- product_id_snapshot/name_snapshot are the historical source of truth;
    -- menu_item_id is a live-lookup convenience and must stay NULL for
    -- manual/synthetic entries that are not a real menu_items.id (e.g. the
    -- Transactions tab's "manual-<id>" rows), since it has an FK.
    select id into v_menu_item_id from public.menu_items where id = v_item->>'productId';
    insert into public.order_items (id, order_id, menu_item_id, product_id_snapshot, name_snapshot, qty, price_snapshot)
    values (
      p_order_id || '-item-' || v_index,
      p_order_id,
      v_menu_item_id,
      v_item->>'productId',
      v_item->>'name',
      (v_item->>'qty')::integer,
      (v_item->>'price')::integer
    );
  end loop;

  if not p_voided and p_deductions is not null and jsonb_typeof(p_deductions) = 'array' then
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

      insert into public.usage_logs (id, order_id, order_item_id, inventory_item_id, item_name_snapshot, used_amount, unit)
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
  text, timestamptz, text, text, jsonb, integer, integer, text, text,
  integer, text, text, integer, integer, jsonb, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.create_order_atomic(
  text, timestamptz, text, text, jsonb, integer, integer, text, text,
  integer, text, text, integer, integer, jsonb, boolean, text, text
) to service_role;

-- approve_void_request_atomic: the pre-checkout branch now allocates the
-- ticket inside the same transaction (via create_order_atomic) instead of
-- trusting a number computed at request time, and records the approver's
-- staff_users.id as the created order's voided_by. Signature is unchanged.
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
    -- p_ticket_no is no longer passed: create_order_atomic allocates the
    -- ticket itself in this transaction, and the final argument records the
    -- approver as the void actor on the new already-voided order.
    select public.create_order_atomic(
      p_new_order_id, now(), v_req.requested_by_name, v_req.requested_by_id,
      v_req.items, v_req.subtotal, v_req.discount, null, v_req.promo_label,
      v_req.total, v_req.payment_method, null,
      0, 0, '[]'::jsonb, true, v_req.reason, p_approved_by_id
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

revoke all on function public.approve_void_request_atomic(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_void_request_atomic(text, text, text, text, text)
  to service_role;
