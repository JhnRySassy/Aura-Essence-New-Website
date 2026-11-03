-- =====================================================================
-- EXPENSES (packaging, ads, shipping, other)  →  true NET profit
-- Run once in Supabase -> SQL Editor. Safe to re-run.
--
-- Net profit = sales − cost of bottles sold − expenses.
-- (Restocks are NOT counted again: the cost of the bottles you bought is
--  already in "cost of bottles sold" once they are sold.)
-- =====================================================================

create table if not exists public.expenses (
  id         bigint generated always as identity primary key,
  spent_on   date not null default (now() at time zone 'Asia/Manila')::date,
  category   text not null check (category in ('packaging', 'ads', 'shipping', 'other')),
  amount     numeric(10,2) not null check (amount > 0),
  note       text not null default '',
  order_id   text,                                   -- optional: which order this was for (e.g. shipping)
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);

create index if not exists expenses_spent_idx on public.expenses (spent_on desc, id desc);

-- Admin only (customers can never read this)
alter table public.expenses enable row level security;
drop policy if exists "expenses admin read" on public.expenses;
create policy "expenses admin read" on public.expenses for select to authenticated
  using (public.is_admin());
revoke all on public.expenses from anon;
revoke insert, update, delete on public.expenses from authenticated;
grant select on public.expenses to authenticated;

-- ---------------------------------------------------------------------
-- Add / delete (through functions so every change is checked + logged)
-- ---------------------------------------------------------------------
create or replace function public.admin_add_expense(
  p_date     date,
  p_category text,
  p_amount   numeric,
  p_note     text default '',
  p_order_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cat text := lower(trim(coalesce(p_category, '')));
  v_id  bigint;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_cat not in ('packaging', 'ads', 'shipping', 'other') then
    return jsonb_build_object('success', false, 'message', 'Choose a category.');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    return jsonb_build_object('success', false, 'message', 'Enter the amount spent (more than 0).');
  end if;

  insert into public.expenses (spent_on, category, amount, note, order_id, created_by)
  values (coalesce(p_date, (now() at time zone 'Asia/Manila')::date),
          v_cat, round(p_amount, 2),
          left(trim(coalesce(p_note, '')), 300),
          nullif(left(trim(coalesce(p_order_id, '')), 60), ''),
          public.current_actor())
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end $$;

create or replace function public.admin_delete_expense(p_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.expenses where id = p_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Expense not found.');
  end if;
  return jsonb_build_object('success', true);
end $$;

revoke execute on function public.admin_add_expense(date, text, numeric, text, text) from public, anon;
revoke execute on function public.admin_delete_expense(bigint) from public, anon;
grant  execute on function public.admin_add_expense(date, text, numeric, text, text) to authenticated;
grant  execute on function public.admin_delete_expense(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Audit log: "Added expense Packaging ₱350 (gift bags)"
-- ---------------------------------------------------------------------
create or replace function public.audit_expense_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r public.expenses%rowtype := coalesce(new, old);
  v_cat text := case r.category
                  when 'ads' then 'Ads' when 'packaging' then 'Packaging'
                  when 'shipping' then 'Shipping' else 'Other' end;
begin
  if not public.is_admin() then
    return r;
  end if;

  insert into public.audit_log (actor, action, details)
  values (
    public.current_actor(),
    format('%s expense %s ₱%s%s',
           case when tg_op = 'INSERT' then 'Added' else 'Removed' end,
           v_cat, public.peso_text(r.amount),
           case when r.note <> '' then ' (' || r.note || ')' else '' end),
    jsonb_build_object('table', 'expenses', 'op', lower(tg_op), 'kind', 'expense')
  );
  return r;
end $$;

drop trigger if exists expenses_audit on public.expenses;
create trigger expenses_audit after insert or delete on public.expenses
  for each row execute function public.audit_expense_change();
