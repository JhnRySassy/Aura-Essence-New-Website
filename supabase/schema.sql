-- =====================================================================
-- AURA & ESSENCE — Supabase schema
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again; it updates functions and policies in place.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id          text primary key,
  name        text not null check (char_length(name) between 1 and 120),
  cat         text not null default 'men' check (cat in ('men', 'women', 'unisex')),
  price       numeric(10,2) not null default 430 check (price >= 0),
  stock       integer check (stock is null or stock >= 0),   -- null = unlimited
  sort_order  integer not null default 0,
  img         text not null default '',
  descr       text not null default '',
  desc_long   text not null default '',
  top_notes   text[] not null default '{}',
  heart_notes text[] not null default '{}',
  base_notes  text[] not null default '{}',
  application text not null default '',
  profiles    text[] not null default '{}',
  longevity   smallint not null default 7 check (longevity between 1 and 10),
  projection  smallint not null default 7 check (projection between 1 and 10),
  strength    text not null default 'moderate' check (strength in ('subtle', 'moderate', 'bold')),
  time        text[] not null default '{}',
  occasion    text not null default '',
  badges      text[] not null default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Product IDs: letters, numbers, spaces, - _ . (matches IDs like "Clinique Happy" from the old sheet)
alter table public.products drop constraint if exists products_id_check;
alter table public.products add constraint products_id_check
  check (id ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$' and id = trim(id));

create table if not exists public.promotions (
  id          text primary key default gen_random_uuid()::text,
  name        text not null check (char_length(name) between 1 and 120),
  type        text not null default 'fixed_total' check (type in ('fixed_total', 'percent')),
  min_qty     integer not null default 2 check (min_qty >= 1),
  fixed_total numeric(10,2) not null default 0 check (fixed_total >= 0),
  percent_off numeric(5,2) not null default 0 check (percent_off between 0 and 100),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.promotions (id, name, type, min_qty, fixed_total, percent_off, active)
select 'two-bottle', '2-Bottle Promo', 'fixed_total', 2, 840, 0, true
where not exists (select 1 from public.promotions);

create table if not exists public.site_settings (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id, data)
values (1, '{"lowStockThreshold": 5, "showBestSellers": true, "showFeatured": true, "showNewArrivals": true, "showSignature": true}')
on conflict (id) do nothing;

create table if not exists public.orders (
  id              bigint generated always as identity primary key,
  order_id        text not null unique,
  fullname        text not null,
  contact         text not null,
  contact_digits  text generated always as (regexp_replace(contact, '\D', '', 'g')) stored,
  items           jsonb not null default '[]'::jsonb,   -- [{id, name, qty, price}]
  scent           text not null default '',
  quantity        integer not null default 0,
  address         text not null default '',
  payment         text not null default '',
  notes           text not null default '',
  subtotal        numeric(10,2) not null default 0,
  discount        numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  promotion_name  text,
  status          text not null default 'New'
                  check (status in ('New', 'Confirmed', 'Preparing', 'Out for Delivery', 'Completed', 'Cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_contact_digits_idx on public.orders (contact_digits);

-- Payment tracking + status timeline (added later; safe on existing databases)
do $$
declare
  is_new boolean := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_status');
begin
  alter table public.orders
    add column if not exists payment_status text not null default 'Unpaid',
    add column if not exists amount_paid    numeric(10,2),
    add column if not exists payment_ref    text not null default '',
    add column if not exists payment_note   text not null default '',
    add column if not exists paid_at        timestamptz,
    add column if not exists status_history jsonb not null default '[]'::jsonb;

  if is_new then
    -- Orders already Completed before this feature are treated as paid in full.
    update public.orders
       set payment_status = 'Paid', amount_paid = total, paid_at = updated_at
     where status = 'Completed';
  end if;
end $$;

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('Unpaid', 'Partial', 'Paid', 'Refunded'));
alter table public.orders drop constraint if exists orders_amount_paid_check;
alter table public.orders add constraint orders_amount_paid_check
  check (amount_paid is null or amount_paid >= 0);

create table if not exists public.reviews (
  id         text primary key default ('REV-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD-HH24MISS') || '-' || upper(substr(md5(random()::text), 1, 6))),
  name       text not null,
  scent      text not null default '',
  scent_id   text,
  rating     smallint not null default 5 check (rating between 1 and 5),
  review     text not null,
  photo_url  text,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists reviews_approved_idx on public.reviews (approved, created_at desc);

-- Customer ratings: how close to the original, how long it lasted, how strong it projected
alter table public.reviews add column if not exists similarity smallint;
alter table public.reviews add column if not exists wear_hours smallint;
alter table public.reviews add column if not exists projection text;
alter table public.reviews drop constraint if exists reviews_similarity_check;
alter table public.reviews add constraint reviews_similarity_check check (similarity is null or similarity between 1 and 10);
alter table public.reviews drop constraint if exists reviews_wear_hours_check;
alter table public.reviews add constraint reviews_wear_hours_check check (wear_hours is null or wear_hours in (4, 6, 8, 10));
alter table public.reviews drop constraint if exists reviews_projection_check;
alter table public.reviews add constraint reviews_projection_check check (projection is null or projection in ('soft', 'moderate', 'strong'));

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor      text not null default 'system',
  action     text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

-- ---------- Vouchers, product cost and restock log (added later) ----------

-- Puhunan per bottle. Kept up to date automatically as a weighted average
-- every time you record a restock; you can also type it in the product editor.
alter table public.products add column if not exists cost numeric(10,2);
alter table public.products drop constraint if exists products_cost_check;
alter table public.products add constraint products_cost_check check (cost is null or cost >= 0);

alter table public.orders add column if not exists voucher_code text;
create index if not exists orders_voucher_code_idx on public.orders (voucher_code) where voucher_code is not null;

create table if not exists public.vouchers (
  code          text primary key,
  type          text not null default 'percent' check (type in ('percent', 'amount')),
  value         numeric(10,2) not null check (value > 0),
  max_discount  numeric(10,2) check (max_discount is null or max_discount > 0),  -- cap for % vouchers
  min_order     numeric(10,2) not null default 0 check (min_order >= 0),
  starts_at     timestamptz,
  expires_at    timestamptz,
  usage_limit   integer check (usage_limit is null or usage_limit > 0),          -- total uses
  per_customer  integer check (per_customer is null or per_customer > 0),        -- uses per contact number
  note          text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.vouchers drop constraint if exists vouchers_code_check;
alter table public.vouchers add constraint vouchers_code_check check (code ~ '^[A-Z0-9_-]{3,30}$');
alter table public.vouchers drop constraint if exists vouchers_percent_check;
alter table public.vouchers add constraint vouchers_percent_check check (type <> 'percent' or value <= 100);
-- Welcome / first-order codes: only for numbers that haven't ordered before
alter table public.vouchers add column if not exists first_order_only boolean not null default false;

create table if not exists public.restocks (
  id            bigint generated always as identity primary key,
  product_id    text references public.products (id) on update cascade on delete set null,
  product_name  text not null default '',
  qty           integer not null check (qty > 0),
  unit_cost     numeric(10,2) check (unit_cost is null or unit_cost >= 0),
  supplier      text not null default '',
  note          text not null default '',
  received_at   date not null default (now() at time zone 'Asia/Manila')::date,
  created_by    text not null default 'system',
  created_at    timestamptz not null default now()
);
create index if not exists restocks_received_idx on public.restocks (received_at desc, id desc);

-- ---------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.current_actor()
returns text
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'system');
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
drop trigger if exists promotions_touch on public.promotions;
create trigger promotions_touch before update on public.promotions
  for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
drop trigger if exists vouchers_touch on public.vouchers;
create trigger vouchers_touch before update on public.vouchers
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.site_settings;
create trigger settings_touch before update on public.site_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- AUDIT LOG (automatic — written by the database, not the browser)
-- Only admin actions are logged, so customer orders don't flood it.
-- ---------------------------------------------------------------------

-- ₱ amounts in log messages: 430 or 430.50
create or replace function public.peso_text(v numeric)
returns text language sql immutable as $$
  select case when v is null then null
              when v = trunc(v) then to_char(v, 'FM999,999,990')
              else to_char(v, 'FM999,999,990.00') end;
$$;

create or replace function public.audit_admin_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  label   text;
  verb    text;
  target  text;
  changes text[] := '{}';
  details jsonb  := '{}'::jsonb;
begin
  if not public.is_admin() then
    return coalesce(new, old);
  end if;

  verb := case tg_op when 'INSERT' then 'Created' when 'UPDATE' then 'Updated' else 'Deleted' end;

  case tg_table_name
    when 'products' then
      label  := 'product';
      target := coalesce(new.id, old.id);
      if tg_op = 'UPDATE' then
        -- say exactly what changed, e.g. "stock 10 → 9"
        if new.stock is distinct from old.stock then
          changes := changes || format('stock %s → %s', coalesce(old.stock::text, '∞'), coalesce(new.stock::text, '∞'));
        end if;
        if new.price is distinct from old.price then
          changes := changes || format('price ₱%s → ₱%s', public.peso_text(old.price), public.peso_text(new.price));
        end if;
        if new.active is distinct from old.active then
          changes := changes || (case when new.active then 'now visible' else 'now hidden' end)::text;
        end if;
        if new.name is distinct from old.name then
          changes := changes || format('name "%s" → "%s"', old.name, new.name);
        end if;
        if new.badges is distinct from old.badges then
          changes := changes || format('badges %s', coalesce(nullif(array_to_string(new.badges, ', '), ''), 'none'));
        end if;
        if new.cost is distinct from old.cost then
          changes := changes || format('cost ₱%s → ₱%s', coalesce(public.peso_text(old.cost), '—'), coalesce(public.peso_text(new.cost), '—'));
        end if;
        if new.img is distinct from old.img then
          changes := changes || 'new photo'::text;
        end if;
        if new.id is distinct from old.id then
          changes := changes || format('ID %s → %s', old.id, new.id);
        end if;
      end if;
    when 'promotions' then
      label  := 'promotion';
      target := coalesce(new.name, old.name);
      if tg_op = 'UPDATE' and new.active is distinct from old.active then
        verb := case when new.active then 'Turned on' else 'Turned off' end;
      end if;
    when 'vouchers' then
      label  := 'voucher';
      target := coalesce(new.code, old.code);
      if tg_op = 'UPDATE' and new.active is distinct from old.active then
        verb := case when new.active then 'Turned on' else 'Turned off' end;
      end if;
    when 'restocks' then
      label  := 'restock';
      if tg_op = 'INSERT' then
        verb   := 'Received';
        label  := 'stock';
        target := format('%s +%s%s', new.product_name, new.qty,
                         coalesce(' @ ₱' || public.peso_text(new.unit_cost), ''));
      else
        verb   := 'Removed restock';
        label  := 'entry';
        target := format('%s +%s', old.product_name, old.qty);
      end if;
    when 'site_settings' then
      label  := 'homepage settings';
      target := null;
    when 'reviews' then
      label  := 'review';
      target := coalesce(new.name, old.name);
      if tg_op = 'UPDATE' and new.approved is distinct from old.approved then
        verb := case when new.approved then 'Approved' else 'Hid' end;
      end if;
    when 'orders' then
      label  := 'order';
      target := coalesce(new.order_id, old.order_id);
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        verb   := 'Set status ' || new.status || ' on';
        details := jsonb_build_object('from', old.status, 'to', new.status);
      elsif tg_op = 'UPDATE' then
        label  := 'payment';
        verb   := 'Recorded';
        target := format('%s%s on order %s', new.payment_status,
                         coalesce(' ₱' || public.peso_text(new.amount_paid), ''), new.order_id);
      end if;
    else
      label  := tg_table_name;
  end case;

  -- Nothing worth logging (e.g. only updated_at changed)
  if tg_table_name = 'products' and tg_op = 'UPDATE' and array_length(changes, 1) is null then
    return new;
  end if;

  insert into public.audit_log (actor, action, details)
  values (
    public.current_actor(),
    trim(verb || ' ' || label || coalesce(' ' || target, '') ||
         case when array_length(changes, 1) > 0 then ': ' || array_to_string(changes, ', ') else '' end),
    details || jsonb_build_object('table', tg_table_name, 'op', lower(tg_op),
                                'kind', case when tg_table_name = 'restocks' then 'stock' else label end)
  );

  return coalesce(new, old);
end $$;

drop trigger if exists products_audit on public.products;
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_admin_change();
drop trigger if exists promotions_audit on public.promotions;
create trigger promotions_audit after insert or update or delete on public.promotions
  for each row execute function public.audit_admin_change();
drop trigger if exists vouchers_audit on public.vouchers;
create trigger vouchers_audit after insert or update or delete on public.vouchers
  for each row execute function public.audit_admin_change();
drop trigger if exists restocks_audit on public.restocks;
create trigger restocks_audit after insert or delete on public.restocks
  for each row execute function public.audit_admin_change();
drop trigger if exists settings_audit on public.site_settings;
create trigger settings_audit after update on public.site_settings
  for each row execute function public.audit_admin_change();
drop trigger if exists reviews_audit on public.reviews;
create trigger reviews_audit after update or delete on public.reviews
  for each row execute function public.audit_admin_change();
drop trigger if exists orders_audit on public.orders;
create trigger orders_audit after update of status, payment_status, amount_paid or delete on public.orders
  for each row execute function public.audit_admin_change();

-- ---------------------------------------------------------------------
-- ORDER TIMELINE: remembers when each status was set and by whom
-- ---------------------------------------------------------------------

create or replace function public.track_order_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(jsonb_array_length(new.status_history), 0) = 0 then
      new.status_history := jsonb_build_array(
        jsonb_build_object('status', new.status, 'at', coalesce(new.created_at, now()), 'by', 'customer'));
    end if;
  elsif new.status is distinct from old.status then
    new.status_history := coalesce(old.status_history, '[]'::jsonb) || jsonb_build_object(
      'status', new.status, 'at', now(), 'by', public.current_actor());
  end if;

  -- paid_at follows the payment status
  if new.payment_status = 'Paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'Paid') then
    new.paid_at := now();
  elsif new.payment_status in ('Unpaid', 'Refunded') then
    new.paid_at := null;
  end if;

  return new;
end $$;

drop trigger if exists orders_history on public.orders;
create trigger orders_history before insert or update on public.orders
  for each row execute function public.track_order_status();

-- ---------------------------------------------------------------------
-- INVENTORY: cancelling an order puts its bottles back in stock,
-- un-cancelling takes them out again.
-- ---------------------------------------------------------------------

create or replace function public.restock_on_cancel()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  line jsonb;
  dir  integer;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status = 'Cancelled' then
    dir := 1;
  elsif old.status = 'Cancelled' then
    dir := -1;
  else
    return new;
  end if;

  for line in select * from jsonb_array_elements(new.items) loop
    -- manual orders entered without touching stock are marked "stock": false
    continue when coalesce(line ->> 'stock', 'true') = 'false';
    update public.products
       set stock = greatest(0, stock + dir * coalesce((line ->> 'qty')::int, 0))
     where id = line ->> 'id' and stock is not null;
  end loop;
  return new;
end $$;

drop trigger if exists orders_restock on public.orders;
create trigger orders_restock after update of status on public.orders
  for each row execute function public.restock_on_cancel();

-- ---------------------------------------------------------------------
-- PLACE ORDER (customers)
-- Prices, promotions and stock are checked here on the server, so the
-- total can't be changed from the browser.
-- ---------------------------------------------------------------------

-- Voucher check shared by checkout preview and place_order.
-- p_digits = customer's contact number digits ('' = skip the per-customer check).
create or replace function public.voucher_discount(p_code text, p_subtotal numeric, p_digits text default '', p_lock boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v      public.vouchers%rowtype;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_used integer;
  v_disc numeric(10,2);
  v_label text;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'Enter a voucher code.');
  end if;

  if p_lock then
    select * into v from public.vouchers where code = v_code for update;
  else
    select * into v from public.vouchers where code = v_code;
  end if;

  if not found or not v.active then
    return jsonb_build_object('ok', false, 'message', 'Voucher code not found.');
  end if;
  if v.starts_at is not null and now() < v.starts_at then
    return jsonb_build_object('ok', false, 'message', 'This voucher is not active yet.');
  end if;
  if v.expires_at is not null and now() > v.expires_at then
    return jsonb_build_object('ok', false, 'message', 'This voucher has expired.');
  end if;
  if p_subtotal < v.min_order then
    return jsonb_build_object('ok', false, 'message',
      format('Minimum order for %s is ₱%s.', v.code, public.peso_text(v.min_order)));
  end if;
  if v.usage_limit is not null then
    select count(*) into v_used from public.orders where voucher_code = v.code and status <> 'Cancelled';
    if v_used >= v.usage_limit then
      return jsonb_build_object('ok', false, 'message', 'This voucher has been fully used.');
    end if;
  end if;
  if v.per_customer is not null and char_length(coalesce(p_digits, '')) >= 7 then
    select count(*) into v_used from public.orders
     where voucher_code = v.code and status <> 'Cancelled'
       and right(contact_digits, 10) = right(p_digits, 10);
    if v_used >= v.per_customer then
      return jsonb_build_object('ok', false, 'message', 'You have already used this voucher.');
    end if;
  end if;
  if v.first_order_only and char_length(coalesce(p_digits, '')) >= 7 then
    if exists (select 1 from public.orders
                where status <> 'Cancelled'
                  and right(contact_digits, 10) = right(p_digits, 10)) then
      return jsonb_build_object('ok', false, 'message', format('%s is for first orders only.', v.code));
    end if;
  end if;

  if v.type = 'percent' then
    v_disc  := round(p_subtotal * v.value / 100, 2);
    if v.max_discount is not null then
      v_disc := least(v_disc, v.max_discount);
    end if;
    v_label := format('%s%% off', public.peso_text(v.value)) ||
               case when v.max_discount is not null
                    then format(' (up to ₱%s)', public.peso_text(v.max_discount)) else '' end;
  else
    v_disc  := least(v.value, p_subtotal);
    v_label := format('₱%s off', public.peso_text(v.value));
  end if;

  return jsonb_build_object('ok', true, 'code', v.code, 'discount', v_disc, 'label', v_label);
end $$;

revoke execute on function public.voucher_discount(text, numeric, text, boolean) from public, anon, authenticated;

-- Older version without the voucher parameter
drop function if exists public.place_order(text, text, jsonb, text, text, text);

create or replace function public.place_order(
  p_fullname text,
  p_contact  text,
  p_items    jsonb,
  p_address  text,
  p_payment  text,
  p_notes    text default '',
  p_voucher  text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits   text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
  v_line     record;
  v_product  public.products%rowtype;
  v_items    jsonb := '[]'::jsonb;
  v_names    text[] := '{}';
  v_qty      integer := 0;
  v_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2) := 0;
  v_promo_disc numeric(10,2) := 0;
  v_total    numeric(10,2);
  v_promo    public.promotions%rowtype;
  v_voucher  jsonb;
  v_vcode    text;
  v_label    text;
  v_note     text := '';
  v_order_id text;
begin
  -- Basic validation
  if char_length(trim(coalesce(p_fullname, ''))) not between 1 and 120 then
    return jsonb_build_object('success', false, 'message', 'Please enter your full name.');
  end if;
  if char_length(v_digits) not between 7 and 15 then
    return jsonb_build_object('success', false, 'message', 'Please enter a valid contact number.');
  end if;
  if char_length(trim(coalesce(p_address, ''))) not between 1 and 500 then
    return jsonb_build_object('success', false, 'message', 'Please enter your delivery or meetup location.');
  end if;
  if char_length(trim(coalesce(p_payment, ''))) not between 1 and 60 then
    return jsonb_build_object('success', false, 'message', 'Please choose a payment method.');
  end if;
  if char_length(coalesce(p_notes, '')) > 1000 then
    return jsonb_build_object('success', false, 'message', 'Notes are too long (1000 characters max).');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Your cart is empty.');
  end if;

  -- Simple spam guard: max 5 orders per contact number per 10 minutes
  if (select count(*) from public.orders
       where contact_digits = v_digits and created_at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('success', false, 'message', 'Too many orders from this number. Please wait a few minutes or contact us directly.');
  end if;

  if (select count(distinct x ->> 'id') from jsonb_array_elements(p_items) x) > 30 then
    return jsonb_build_object('success', false, 'message', 'Too many different scents in one order.');
  end if;

  -- Everything below runs as one unit: if any check fails, stock changes are rolled back.
  begin
    -- Merge duplicate lines, then price each one from the products table
    for v_line in
      select x ->> 'id' as id, sum(greatest(0, coalesce((x ->> 'qty')::int, 0)))::int as qty
        from jsonb_array_elements(p_items) x
       group by x ->> 'id'
       order by x ->> 'id'
    loop
      if v_line.qty < 1 or v_line.qty > 100 then
        raise exception 'Maximum order quantity exceeded (100 per scent).' using errcode = 'P0001';
      end if;

      select * into v_product from public.products where id = v_line.id for update;
      if not found or not v_product.active then
        raise exception 'One of the scents in your cart is no longer available.' using errcode = 'P0001';
      end if;
      if v_product.stock is not null and v_product.stock < v_line.qty then
        raise exception '%', format('%s has only %s bottle(s) in stock.', v_product.name, v_product.stock)
          using errcode = 'P0001';
      end if;

      if v_product.stock is not null then
        update public.products set stock = stock - v_line.qty where id = v_product.id;
      end if;

      -- cost is saved with the order so the profit report stays correct even if the cost changes later
      v_items    := v_items || jsonb_build_object('id', v_product.id, 'name', v_product.name,
                                                  'qty', v_line.qty, 'price', v_product.price,
                                                  'cost', v_product.cost);
      v_names    := v_names || v_product.name;
      v_qty      := v_qty + v_line.qty;
      v_subtotal := v_subtotal + v_product.price * v_line.qty;
    end loop;

    -- Same promotion rules as the storefront:
    -- fixed_total applies at exactly min_qty, percent at min_qty or more; highest min_qty wins.
    select * into v_promo from public.promotions
     where active
       and ((type = 'fixed_total' and v_qty = min_qty) or (type = 'percent' and v_qty >= min_qty))
     order by min_qty desc, created_at
     limit 1;

    if found then
      if v_promo.type = 'fixed_total' and v_promo.fixed_total > 0 and v_promo.fixed_total < v_subtotal then
        v_promo_disc := v_subtotal - v_promo.fixed_total;
      elsif v_promo.type = 'percent' then
        v_promo_disc := round(v_subtotal * v_promo.percent_off / 100, 2);
      else
        v_promo := null;
      end if;
    end if;
    v_discount := v_promo_disc;
    v_label    := v_promo.name;

    -- Voucher: never combined with a promo — the bigger discount wins.
    if nullif(trim(coalesce(p_voucher, '')), '') is not null then
      v_voucher := public.voucher_discount(p_voucher, v_subtotal, v_digits, true);
      if not (v_voucher ->> 'ok')::boolean then
        raise exception '%', v_voucher ->> 'message' using errcode = 'P0001';
      end if;
      if (v_voucher ->> 'discount')::numeric > v_promo_disc then
        v_discount := (v_voucher ->> 'discount')::numeric;
        v_vcode    := v_voucher ->> 'code';
        v_label    := 'Voucher ' || v_vcode;
      else
        v_note := format('Your %s already gives a bigger discount, so the voucher was not used.', v_promo.name);
      end if;
    end if;

    v_total := greatest(0, v_subtotal - v_discount);

    -- Same format as the old Apps Script: AE-20261005-143012-7F3A9C
    loop
      v_order_id := 'AE-' || to_char(clock_timestamp() at time zone 'Asia/Manila', 'YYYYMMDD-HH24MISS') || '-'
                    -- gen_random_uuid() is built into Postgres (no extension needed)
                    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      exit when not exists (select 1 from public.orders where order_id = v_order_id);
    end loop;

    insert into public.orders (order_id, fullname, contact, items, scent, quantity, address, payment,
                               notes, subtotal, discount, total, promotion_name, voucher_code)
    values (v_order_id, trim(p_fullname), trim(p_contact), v_items, array_to_string(v_names, ', '),
            v_qty, trim(p_address), trim(p_payment), coalesce(trim(p_notes), ''),
            v_subtotal, v_discount, v_total, v_label, v_vcode);
  exception
    when sqlstate 'P0001' then
      return jsonb_build_object('success', false, 'message', sqlerrm);
  end;

  return jsonb_build_object('success', true, 'type', 'order', 'orderId', v_order_id,
                            'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
                            'promo', coalesce(v_label, ''), 'voucher', coalesce(v_vcode, ''),
                            'voucherNote', v_note, 'message', 'Order saved successfully.');
end $$;

-- ---------------------------------------------------------------------
-- CHECK VOUCHER (customers) — live preview at checkout.
-- Uses the real prices from the database, same rules as place_order.
-- ---------------------------------------------------------------------

create or replace function public.check_voucher(p_code text, p_items jsonb, p_contact text default '')
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_digits     text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
  v_subtotal   numeric(10,2) := 0;
  v_qty        integer := 0;
  v_promo      public.promotions%rowtype;
  v_promo_disc numeric(10,2) := 0;
  v_voucher    jsonb;
  v_vdisc      numeric(10,2);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Add a scent to your cart first.');
  end if;
  if jsonb_array_length(p_items) > 30 then
    return jsonb_build_object('success', false, 'message', 'Too many items.');
  end if;

  select coalesce(sum(p.price * least(100, greatest(0, coalesce((x ->> 'qty')::int, 0)))), 0),
         coalesce(sum(least(100, greatest(0, coalesce((x ->> 'qty')::int, 0)))), 0)
    into v_subtotal, v_qty
    from jsonb_array_elements(p_items) x
    join public.products p on p.id = x ->> 'id' and p.active;

  select * into v_promo from public.promotions
   where active
     and ((type = 'fixed_total' and v_qty = min_qty) or (type = 'percent' and v_qty >= min_qty))
   order by min_qty desc, created_at
   limit 1;
  if found then
    if v_promo.type = 'fixed_total' and v_promo.fixed_total > 0 and v_promo.fixed_total < v_subtotal then
      v_promo_disc := v_subtotal - v_promo.fixed_total;
    elsif v_promo.type = 'percent' then
      v_promo_disc := round(v_subtotal * v_promo.percent_off / 100, 2);
    end if;
  end if;

  v_voucher := public.voucher_discount(p_code, v_subtotal, v_digits, false);
  if not (v_voucher ->> 'ok')::boolean then
    return jsonb_build_object('success', false, 'message', v_voucher ->> 'message');
  end if;
  v_vdisc := (v_voucher ->> 'discount')::numeric;

  return jsonb_build_object(
    'success',       true,
    'code',          v_voucher ->> 'code',
    'label',         v_voucher ->> 'label',
    'subtotal',      v_subtotal,
    'voucherDiscount', v_vdisc,
    'promoDiscount', v_promo_disc,
    'promo',         coalesce(v_promo.name, ''),
    'applies',       case when v_vdisc > v_promo_disc then 'voucher' else 'promo' end,
    'discount',      greatest(v_vdisc, v_promo_disc),
    'total',         greatest(0, v_subtotal - greatest(v_vdisc, v_promo_disc))
  );
end $$;

-- ---------------------------------------------------------------------
-- TRACK ORDER (customers) — needs the order ID AND the contact number
-- ---------------------------------------------------------------------

create or replace function public.track_order(p_order_id text, p_contact text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
  o        public.orders%rowtype;
begin
  if char_length(v_digits) < 7 then
    return jsonb_build_object('success', false, 'message', 'Order not found. Check your Order ID and contact number.');
  end if;

  select * into o from public.orders
   where upper(order_id) = upper(trim(p_order_id))
     and right(contact_digits, 10) = right(v_digits, 10);

  if not found then
    return jsonb_build_object('success', false, 'message', 'Order not found. Check your Order ID and contact number.');
  end if;

  return jsonb_build_object(
    'success', true,
    'orderId', o.order_id,
    'fullname', split_part(o.fullname, ' ', 1),   -- first name only
    'scent', o.scent,
    'qty', o.quantity || case when o.quantity = 1 then ' bottle' else ' bottles' end,
    'quantity', o.quantity,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i ->> 'name', 'qty', (i ->> 'qty')::int)), '[]'::jsonb)
                from jsonb_array_elements(o.items) i),
    'subtotal', o.subtotal,
    'discount', o.discount,
    'promo', coalesce(o.promotion_name, ''),
    'total', o.total,
    'status', o.status,
    'timestamp', o.created_at,
    -- when each status was set (without who set it)
    'history', (select coalesce(jsonb_agg(jsonb_build_object('status', h ->> 'status', 'at', h ->> 'at')), '[]'::jsonb)
                  from jsonb_array_elements(o.status_history) h),
    'payment', o.payment,
    'paymentStatus', o.payment_status,
    'amountPaid', o.amount_paid,
    'paidAt', o.paid_at
  );
end $$;

-- ---------------------------------------------------------------------
-- SUBMIT REVIEW (customers) — saved hidden until an admin approves it
-- ---------------------------------------------------------------------

-- Older version without the similarity / longevity / projection ratings
drop function if exists public.submit_review(text, text, text, integer, text, text);

create or replace function public.submit_review(
  p_name       text,
  p_scent      text,
  p_scent_id   text,
  p_rating     integer,
  p_review     text,
  p_photo_url  text,
  p_similarity integer default null,
  p_wear_hours integer default null,
  p_projection text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    return jsonb_build_object('success', false, 'message', 'Please enter your name.');
  end if;
  if char_length(trim(coalesce(p_scent, ''))) = 0 or char_length(trim(coalesce(p_review, ''))) = 0 or p_photo_url is null then
    return jsonb_build_object('success', false, 'message', 'Name, scent, rating, review, and photo are required.');
  end if;
  if char_length(trim(p_review)) > 600 then
    return jsonb_build_object('success', false, 'message', 'Review is too long. Maximum is 600 characters.');
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    return jsonb_build_object('success', false, 'message', 'Please choose a rating.');
  end if;
  -- Only accept photos stored in this project's review-photos bucket
  if p_photo_url !~ '/storage/v1/object/public/review-photos/pending/[A-Za-z0-9._-]+$' then
    return jsonb_build_object('success', false, 'message', 'Invalid photo upload.');
  end if;
  if (select count(*) from public.reviews where created_at > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('success', false, 'message', 'Too many reviews right now. Please try again shortly.');
  end if;

  insert into public.reviews (name, scent, scent_id, rating, review, photo_url, similarity, wear_hours, projection)
  values (trim(p_name), left(coalesce(p_scent, ''), 120), left(p_scent_id, 64), p_rating, trim(p_review), p_photo_url,
          case when p_similarity between 1 and 10 then p_similarity end,
          case when p_wear_hours in (4, 6, 8, 10) then p_wear_hours end,
          case when lower(p_projection) in ('soft', 'moderate', 'strong') then lower(p_projection) end);

  return jsonb_build_object('success', true, 'type', 'review', 'message', 'Review submitted successfully.');
end $$;

-- ---------------------------------------------------------------------
-- ADMIN DASHBOARD
-- ---------------------------------------------------------------------

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_settings  jsonb;
  v_threshold integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select data into v_settings from public.site_settings where id = 1;
  v_threshold := coalesce((v_settings ->> 'lowStockThreshold')::int, 5);

  return jsonb_build_object(
    'success', true,
    'settings', coalesce(v_settings, '{}'::jsonb),
    'stats', (
      select jsonb_build_object(
        'orders',    count(*),
        -- money actually received when recorded (after outside discounts), else the order total
        'revenue',   coalesce(sum(coalesce(amount_paid, total)) filter (where status <> 'Cancelled'), 0),
        'toCollect', coalesce(sum(greatest(0, total - coalesce(amount_paid, 0)))
                       filter (where status <> 'Cancelled' and payment_status in ('Unpaid', 'Partial')), 0),
        'unpaidOrders', count(*) filter (where status <> 'Cancelled' and payment_status in ('Unpaid', 'Partial')),
        'completed', count(*) filter (where status = 'Completed'),
        'pending',   count(*) filter (where status not in ('Completed', 'Cancelled')),
        'customers', count(distinct coalesce(nullif(right(contact_digits, 10), ''), fullname)),
        'averageOrderValue', coalesce(round(avg(coalesce(amount_paid, total)) filter (where status <> 'Cancelled'), 2), 0)
      ) from public.orders
    ),
    'topProducts', coalesce((
      select jsonb_agg(t order by t.units desc, t.name)
        from (
          select p.id, p.name, coalesce(s.units, 0) as units
            from public.products p
            left join (
              select i ->> 'id' as id, sum((i ->> 'qty')::int) as units
                from public.orders o, jsonb_array_elements(o.items) i
               where o.status <> 'Cancelled'
               group by i ->> 'id'
            ) s on s.id = p.id
           order by units desc, p.name
           limit 10
        ) t
    ), '[]'::jsonb),
    'lowStock', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock) order by stock, name)
        from public.products
       where active and stock is not null and stock <= v_threshold
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- ORDER EMAIL NOTIFICATION
-- Like the old MailApp email: every new order is sent to a small
-- Apps Script "mailer" (google-apps-script/OrderEmailNotifier.gs),
-- which emails the admin. Runs in the background; an email problem
-- can never block or cancel an order.
--
-- Settings live in the "private" schema, which the website can't read:
--   insert into private.config (key, value) values
--     ('order_email_webhook_url',    'https://script.google.com/macros/s/.../exec'),
--     ('order_email_webhook_secret', 'the-same-secret-as-in-the-mailer')
--   on conflict (key) do update set value = excluded.value;
-- ---------------------------------------------------------------------

create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.config (
  key   text primary key,
  value text not null
);

create or replace function public.notify_new_order()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from private.config where key = 'order_email_webhook_url';
  select value into v_secret from private.config where key = 'order_email_webhook_secret';

  if coalesce(v_url, '') = '' then
    return new;   -- email not set up yet
  end if;
  if coalesce(to_jsonb(new) ->> 'source', 'website') <> 'website' then
    return new;   -- orders typed in the admin (FB, walk-in…) don't need an email
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'secret',   coalesce(v_secret, ''),
                   'orderId',  new.order_id,
                   'date',     to_char(new.created_at at time zone 'Asia/Manila', 'FMMonth DD, YYYY • HH12:MI AM'),
                   'fullname', new.fullname,
                   'contact',  new.contact,
                   'items',    new.items,
                   'subtotal', new.subtotal,
                   'discount', new.discount,
                   'promo',    coalesce(new.promotion_name, ''),
                   'total',    new.total,
                   'address',  new.address,
                   'payment',  new.payment,
                   'notes',    new.notes,
                   'status',   new.status),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Order email notification failed: %', sqlerrm;
  end;

  return new;
end $$;

revoke execute on function public.notify_new_order() from public, anon, authenticated;

drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after insert on public.orders
  for each row execute function public.notify_new_order();

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.admins        enable row level security;
alter table public.products      enable row level security;
alter table public.promotions    enable row level security;
alter table public.site_settings enable row level security;
alter table public.orders        enable row level security;
alter table public.reviews       enable row level security;
alter table public.audit_log     enable row level security;

-- admins: a signed-in user can only see their own row
drop policy if exists "admins read own" on public.admins;
create policy "admins read own" on public.admins for select to authenticated
  using (user_id = auth.uid());

-- products: everyone can read (storefront needs inactive ones to hide them), admins write
drop policy if exists "products public read" on public.products;
create policy "products public read" on public.products for select to anon, authenticated using (true);
drop policy if exists "products admin write" on public.products;
create policy "products admin write" on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- promotions: everyone reads active ones, admins read and write all
drop policy if exists "promotions public read" on public.promotions;
create policy "promotions public read" on public.promotions for select to anon, authenticated
  using (active or public.is_admin());
drop policy if exists "promotions admin write" on public.promotions;
create policy "promotions admin write" on public.promotions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- settings: everyone reads, admins update
drop policy if exists "settings public read" on public.site_settings;
create policy "settings public read" on public.site_settings for select to anon, authenticated using (true);
drop policy if exists "settings admin write" on public.site_settings;
create policy "settings admin write" on public.site_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- orders: admins only (customers go through place_order / track_order)
drop policy if exists "orders admin read" on public.orders;
create policy "orders admin read" on public.orders for select to authenticated using (public.is_admin());
drop policy if exists "orders admin update" on public.orders;
create policy "orders admin update" on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "orders admin delete" on public.orders;
create policy "orders admin delete" on public.orders for delete to authenticated using (public.is_admin());

-- reviews: everyone reads approved ones, admins read and manage all
drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews for select to anon, authenticated
  using (approved or public.is_admin());
drop policy if exists "reviews admin update" on public.reviews;
create policy "reviews admin update" on public.reviews for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "reviews admin delete" on public.reviews;
create policy "reviews admin delete" on public.reviews for delete to authenticated using (public.is_admin());

-- audit log: admins read only
drop policy if exists "audit admin read" on public.audit_log;
create policy "audit admin read" on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- GRANTS (explicit, so it works whatever the project's defaults are)
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

revoke all on public.orders, public.audit_log, public.admins from anon;
grant select on public.products, public.promotions, public.site_settings, public.reviews to anon, authenticated;
grant insert, update, delete on public.products, public.promotions to authenticated;
grant update on public.site_settings to authenticated;
grant update, delete on public.reviews to authenticated;
grant select, update, delete on public.orders to authenticated;
grant select on public.audit_log, public.admins to authenticated;

revoke execute on function public.place_order(text, text, jsonb, text, text, text, text) from public;
revoke execute on function public.check_voucher(text, jsonb, text) from public;
revoke execute on function public.track_order(text, text) from public;
revoke execute on function public.submit_review(text, text, text, integer, text, text, integer, integer, text) from public;
revoke execute on function public.admin_dashboard() from public;
revoke execute on function public.is_admin() from public;

grant execute on function public.place_order(text, text, jsonb, text, text, text, text) to anon, authenticated;
grant execute on function public.check_voucher(text, jsonb, text) to anon, authenticated;
grant execute on function public.track_order(text, text) to anon, authenticated;
grant execute on function public.submit_review(text, text, text, integer, text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.admin_dashboard() to authenticated;

-- ---------------------------------------------------------------------
-- REALTIME: new orders appear in the admin panel instantly
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- STORAGE: review photos
-- Customers may only upload small JPEGs into review-photos/pending/.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "review photos upload" on storage.objects;
create policy "review photos upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = 'pending');

drop policy if exists "review photos admin delete" on storage.objects;
create policy "review photos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos' and public.is_admin());

-- =====================================================================
-- ADMIN TOOLS
-- Product photo uploads, quick stock buttons, low-stock email alerts.
-- =====================================================================

-- ---------- Product photos (uploaded from the admin panel) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product images admin upload" on storage.objects;
create policy "product images admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product images admin update" on storage.objects;
create policy "product images admin update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product images admin delete" on storage.objects;
create policy "product images admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ---------- Quick stock buttons (+1 / -1 / restock) ----------
-- p_set: set an exact number; otherwise p_delta is added (never below 0).
create or replace function public.admin_adjust_stock(p_id text, p_delta integer default 0, p_set integer default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.products
     set stock = case when p_set is not null then greatest(0, p_set)
                      else greatest(0, coalesce(stock, 0) + coalesce(p_delta, 0)) end
   where id = p_id
  returning stock into v_stock;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Product not found.');
  end if;

  return jsonb_build_object('success', true, 'stock', v_stock);
end $$;

revoke execute on function public.admin_adjust_stock(text, integer, integer) from public, anon;
grant execute on function public.admin_adjust_stock(text, integer, integer) to authenticated;

-- ---------- Low-stock email alert ----------
-- Emails you (through the same Apps Script mailer as new orders) when a
-- product's stock DROPS to the "Email me when stock reaches" number
-- on the admin Homepage tab (default 1), and again when it sells out (0).
-- Not on every order.
update public.site_settings
   set data = data || '{"lowStockAlertAt": 1}'::jsonb
 where id = 1 and not (data ? 'lowStockAlertAt');

create or replace function public.notify_low_stock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_url       text;
  v_secret    text;
  v_threshold integer;
begin
  if new.stock is null then
    return new;
  end if;

  select coalesce((data ->> 'lowStockAlertAt')::int, 1) into v_threshold
    from public.site_settings where id = 1;
  v_threshold := coalesce(v_threshold, 1);

  -- only when it crosses the line going down, plus once more when it sells out
  if not (
       (new.stock <= v_threshold and (old.stock is null or old.stock > v_threshold))
    or (new.stock = 0 and coalesce(old.stock, 1) > 0)
  ) then
    return new;
  end if;

  select value into v_url    from private.config where key = 'order_email_webhook_url';
  select value into v_secret from private.config where key = 'order_email_webhook_secret';
  if coalesce(v_url, '') = '' then
    return new;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'secret',    coalesce(v_secret, ''),
                   'type',      'low_stock',
                   'productId', new.id,
                   'name',      new.name,
                   'stock',     new.stock,
                   'threshold', v_threshold),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Low-stock email failed: %', sqlerrm;
  end;

  return new;
end $$;

revoke execute on function public.notify_low_stock() from public, anon, authenticated;

drop trigger if exists products_low_stock on public.products;
create trigger products_low_stock after update of stock on public.products
  for each row execute function public.notify_low_stock();

-- =====================================================================
-- VOUCHERS, RESTOCK LOG & PROFIT
-- =====================================================================

alter table public.vouchers enable row level security;
alter table public.restocks enable row level security;

-- Vouchers are secret codes: customers can't list them, only check one
-- code at a time through check_voucher / place_order.
drop policy if exists "vouchers admin all" on public.vouchers;
create policy "vouchers admin all" on public.vouchers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "restocks admin read" on public.restocks;
create policy "restocks admin read" on public.restocks for select to authenticated using (public.is_admin());

revoke all on public.vouchers, public.restocks from anon;
grant select, insert, update, delete on public.vouchers to authenticated;
grant select on public.restocks to authenticated;

-- Product cost is admin-only information: hide it from the public product list.
revoke select on public.products from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name <> 'cost';
  execute format('grant select (%s) on public.products to anon, authenticated', cols);
end $$;

-- Signed-in admins can read cost (turn OFF "Allow new users to sign up" in
-- Supabase → Authentication → Sign In / Providers so only your admins can sign in).
grant select (cost) on public.products to authenticated;

-- ---------- Record a restock ----------
-- Adds the bottles to stock, writes the restock log, and updates the
-- product's cost as a weighted average:
--   (old cost × bottles on hand + new cost × bottles received) ÷ total bottles
create or replace function public.admin_restock(
  p_id        text,
  p_qty       integer,
  p_unit_cost numeric default null,
  p_supplier  text default '',
  p_note      text default '',
  p_date      date default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v       public.products%rowtype;
  v_cost  numeric(10,2);
  v_onhand integer;
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(p_qty, 0) < 1 or p_qty > 10000 then
    return jsonb_build_object('success', false, 'message', 'Enter how many bottles arrived (1 or more).');
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    return jsonb_build_object('success', false, 'message', 'Cost cannot be negative.');
  end if;

  select * into v from public.products where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Product not found.');
  end if;

  v_onhand := greatest(coalesce(v.stock, 0), 0);
  v_cost := case
    when p_unit_cost is null then v.cost
    when v.cost is null or v_onhand = 0 then p_unit_cost
    else round((v.cost * v_onhand + p_unit_cost * p_qty) / (v_onhand + p_qty), 2)
  end;

  update public.products
     set stock = case when stock is null then null else stock + p_qty end,
         cost  = v_cost
   where id = v.id
  returning stock into v_stock;

  insert into public.restocks (product_id, product_name, qty, unit_cost, supplier, note, received_at, created_by)
  values (v.id, v.name, p_qty, p_unit_cost, left(trim(coalesce(p_supplier, '')), 120),
          left(trim(coalesce(p_note, '')), 500),
          coalesce(p_date, (now() at time zone 'Asia/Manila')::date), public.current_actor());

  return jsonb_build_object('success', true, 'stock', v_stock, 'cost', v_cost);
end $$;

-- ---------- Undo a restock entry (wrong entry) ----------
-- Takes the bottles back out of stock. The average cost is left as is
-- (edit it in the product if needed).
create or replace function public.admin_delete_restock(p_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.restocks%rowtype;
  v_stock integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  delete from public.restocks where id = p_id returning * into r;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Restock entry not found.');
  end if;

  update public.products
     set stock = greatest(0, stock - r.qty)
   where id = r.product_id and stock is not null
  returning stock into v_stock;

  return jsonb_build_object('success', true, 'stock', v_stock);
end $$;

revoke execute on function public.admin_restock(text, integer, numeric, text, text, date) from public, anon;
revoke execute on function public.admin_delete_restock(bigint) from public, anon;
grant execute on function public.admin_restock(text, integer, numeric, text, text, date) to authenticated;
grant execute on function public.admin_delete_restock(bigint) to authenticated;

-- ---------- Payment details shown after checkout (edit in admin → Homepage) ----------
update public.site_settings
   set data = data || '{"gcashNumber": "09351936851"}'::jsonb
 where id = 1 and not (data ? 'gcashNumber');

-- =====================================================================
-- HOMEPAGE: TRUST STRIP, SCENT OF THE WEEK, WELCOME OFFER
-- =====================================================================

-- ---------- Public store numbers (no customer details) ----------
-- Bottles sold, average rating, and the best seller of the past 7 days
-- (falls back to 30 days). Cancelled orders are not counted.
create or replace function public.store_stats()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with lines as (
    select o.created_at, i->>'id' as pid, greatest(0, coalesce((i->>'qty')::int, 0)) as qty
      from public.orders o, jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i
     where o.status <> 'Cancelled'
  ),
  wk as (select pid, sum(qty) q from lines where created_at > now() - interval '7 days' and pid is not null group by pid),
  mo as (select pid, sum(qty) q from lines where created_at > now() - interval '30 days' and pid is not null group by pid)
  select jsonb_build_object(
    'bottlesSold', (select coalesce(sum(quantity), 0) from public.orders where status <> 'Cancelled'),
    'customers',   (select count(distinct right(contact_digits, 10)) from public.orders where status <> 'Cancelled'),
    'avgRating',   (select round(avg(rating)::numeric, 1) from public.reviews where approved),
    'reviewCount', (select count(*) from public.reviews where approved),
    'weekTop',     coalesce((select pid from wk join public.products p on p.id = wk.pid and p.active order by q desc, pid limit 1),
                            (select pid from mo join public.products p on p.id = mo.pid and p.active order by q desc, pid limit 1))
  );
$$;
revoke execute on function public.store_stats() from public;
grant execute on function public.store_stats() to anon, authenticated;

-- ---------- Welcome list (mobile number or email → first-order code) ----------
create table if not exists public.subscribers (
  id          bigint generated always as identity primary key,
  contact     text not null check (char_length(contact) between 5 and 120),
  contact_key text not null unique,
  kind        text not null check (kind in ('mobile', 'email')),
  source      text not null default 'welcome',
  created_at  timestamptz not null default now()
);
create index if not exists subscribers_created_at_idx on public.subscribers (created_at desc);

alter table public.subscribers enable row level security;
drop policy if exists "subscribers admin read" on public.subscribers;
create policy "subscribers admin read" on public.subscribers for select to authenticated using (public.is_admin());
drop policy if exists "subscribers admin delete" on public.subscribers;
create policy "subscribers admin delete" on public.subscribers for delete to authenticated using (public.is_admin());
revoke all on public.subscribers from anon;
grant select, delete on public.subscribers to authenticated;

create or replace function public.join_welcome(p_contact text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_raw    text := trim(coalesce(p_contact, ''));
  v_digits text := regexp_replace(v_raw, '\D', '', 'g');
  v_kind   text;
  v_key    text;
  v_show   text;
  v_set    jsonb;
  v_code   text;
  v_vouch  public.vouchers%rowtype;
  v_label  text;
  v_back   boolean := false;
begin
  if v_raw ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' and char_length(v_raw) <= 120 then
    v_kind := 'email'; v_key := lower(v_raw); v_show := lower(v_raw);
  elsif v_digits ~ '^(63|0)?9\d{9}$' then
    v_kind := 'mobile'; v_key := '0' || right(v_digits, 10); v_show := v_key;
  else
    return jsonb_build_object('ok', false, 'message', 'Enter a mobile number (09XX XXX XXXX) or an email address.');
  end if;

  select data into v_set from public.site_settings where id = 1;
  v_code := upper(coalesce(v_set->>'welcomeCode', ''));
  if coalesce(v_set->>'welcomeEnabled', 'false') <> 'true' or v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'The welcome offer is not available right now.');
  end if;

  select * into v_vouch from public.vouchers where code = v_code;
  if not found or not v_vouch.active
     or (v_vouch.starts_at is not null and now() < v_vouch.starts_at)
     or (v_vouch.expires_at is not null and now() > v_vouch.expires_at) then
    return jsonb_build_object('ok', false, 'message', 'The welcome offer is not available right now.');
  end if;

  insert into public.subscribers (contact, contact_key, kind)
  values (v_show, v_key, v_kind)
  on conflict (contact_key) do nothing;

  if v_kind = 'mobile' then
    v_back := exists (select 1 from public.orders
                       where status <> 'Cancelled' and right(contact_digits, 10) = right(v_key, 10));
  end if;

  v_label := case when v_vouch.type = 'percent'
                  then public.peso_text(v_vouch.value) || '% off'
                  else '₱' || public.peso_text(v_vouch.value) || ' off' end;

  return jsonb_build_object('ok', true, 'code', v_vouch.code, 'label', v_label,
                            'minOrder', v_vouch.min_order, 'returning', v_back and v_vouch.first_order_only);
end $$;
revoke execute on function public.join_welcome(text) from public;
grant execute on function public.join_welcome(text) to anon, authenticated;

-- Default homepage settings for the new sections (only if not set yet)
update public.site_settings
   set data = '{"showEveryday": true, "showHiddenGems": true, "showTrust": true, "scentOfWeek": "auto", "welcomeEnabled": false}'::jsonb || data
 where id = 1;

-- =====================================================================
-- MANUAL ORDERS (Facebook, Instagram, walk-in… typed in the admin)
-- =====================================================================

alter table public.orders add column if not exists source text not null default 'website';
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source in ('website', 'facebook', 'instagram', 'tiktok', 'shopee', 'lazada', 'walk-in', 'reseller', 'other'));
create index if not exists orders_source_idx on public.orders (source);

-- Admin-only. Prices can be set per line (e.g. a friend's price), stock is
-- taken out unless p_take_stock is false, and the date can be in the past.
create or replace function public.admin_create_order(
  p_fullname       text,
  p_contact        text,
  p_items          jsonb,            -- [{id, qty, price?}]
  p_address        text default '',
  p_payment        text default 'Cash',
  p_source         text default 'facebook',
  p_status         text default 'Confirmed',
  p_payment_status text default 'Unpaid',
  p_discount       numeric default 0,
  p_notes          text default '',
  p_date           date default null,
  p_take_stock     boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_line     record;
  v_product  public.products%rowtype;
  v_items    jsonb := '[]'::jsonb;
  v_names    text[] := '{}';
  v_qty      integer := 0;
  v_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2) := greatest(0, coalesce(p_discount, 0));
  v_total    numeric(10,2);
  v_price    numeric(10,2);
  v_status   text := coalesce(nullif(trim(p_status), ''), 'Confirmed');
  v_pay      text := coalesce(nullif(trim(p_payment_status), ''), 'Unpaid');
  v_source   text := lower(coalesce(nullif(trim(p_source), ''), 'other'));
  v_take     boolean := coalesce(p_take_stock, true) and coalesce(nullif(trim(p_status), ''), 'Confirmed') <> 'Cancelled';
  v_when     timestamptz;
  v_order_id text;
  v_actor    text := public.current_actor();
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_fullname, ''))) not between 1 and 120 then
    return jsonb_build_object('success', false, 'message', 'Enter the customer''s name.');
  end if;
  if v_status not in ('New', 'Confirmed', 'Preparing', 'Out for Delivery', 'Completed', 'Cancelled') then
    return jsonb_build_object('success', false, 'message', 'Unknown order status.');
  end if;
  if v_pay not in ('Unpaid', 'Partial', 'Paid', 'Refunded') then
    return jsonb_build_object('success', false, 'message', 'Unknown payment status.');
  end if;
  if v_source = 'website' or v_source not in ('facebook', 'instagram', 'tiktok', 'shopee', 'lazada', 'walk-in', 'reseller', 'other') then
    v_source := 'other';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', 'Add at least one scent.');
  end if;

  -- the chosen day, at the current Manila time (keeps orders in a sensible order)
  v_when := case when p_date is null then now()
                 else (p_date + (now() at time zone 'Asia/Manila')::time) at time zone 'Asia/Manila' end;
  if v_when > now() + interval '1 day' then
    return jsonb_build_object('success', false, 'message', 'The order date can''t be in the future.');
  end if;

  begin
    for v_line in
      select x ->> 'id' as id,
             sum(greatest(0, coalesce((x ->> 'qty')::int, 0)))::int as qty,
             max(nullif(x ->> 'price', '')::numeric) as price
        from jsonb_array_elements(p_items) x
       group by x ->> 'id'
       order by x ->> 'id'
    loop
      if v_line.qty < 1 or v_line.qty > 500 then
        raise exception 'Quantity must be between 1 and 500.' using errcode = 'P0001';
      end if;
      select * into v_product from public.products where id = v_line.id for update;
      if not found then
        raise exception 'One of the scents no longer exists.' using errcode = 'P0001';
      end if;
      if v_take and v_product.stock is not null and v_product.stock < v_line.qty then
        raise exception '%', format('%s has only %s bottle(s) in stock. Untick "Take from stock" or restock first.', v_product.name, v_product.stock)
          using errcode = 'P0001';
      end if;
      if v_take and v_product.stock is not null then
        update public.products set stock = stock - v_line.qty where id = v_product.id;
      end if;

      v_price    := greatest(0, coalesce(v_line.price, v_product.price));
      v_items    := v_items || jsonb_build_object('id', v_product.id, 'name', v_product.name, 'qty', v_line.qty,
                                                  'price', v_price, 'cost', v_product.cost, 'stock', v_take);
      v_names    := v_names || v_product.name;
      v_qty      := v_qty + v_line.qty;
      v_subtotal := v_subtotal + v_price * v_line.qty;
    end loop;

    v_discount := least(v_discount, v_subtotal);
    v_total    := v_subtotal - v_discount;

    loop
      v_order_id := 'AE-' || to_char(v_when at time zone 'Asia/Manila', 'YYYYMMDD-HH24MISS') || '-'
                    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      exit when not exists (select 1 from public.orders where order_id = v_order_id);
    end loop;

    insert into public.orders (order_id, fullname, contact, items, scent, quantity, address, payment, notes,
                               subtotal, discount, total, promotion_name, status, payment_status, amount_paid,
                               source, created_at, status_history)
    values (v_order_id, trim(p_fullname), trim(coalesce(p_contact, '')), v_items, array_to_string(v_names, ', '),
            v_qty, trim(coalesce(p_address, '')), coalesce(nullif(trim(p_payment), ''), 'Cash'), left(coalesce(trim(p_notes), ''), 1000),
            v_subtotal, v_discount, v_total, case when v_discount > 0 then 'Manual discount' end,
            v_status, v_pay, case when v_pay = 'Paid' then v_total end,
            v_source, v_when,
            jsonb_build_array(jsonb_build_object('status', v_status, 'at', v_when, 'by', v_actor)));
  exception
    when sqlstate 'P0001' then
      return jsonb_build_object('success', false, 'message', sqlerrm);
  end;

  return jsonb_build_object('success', true, 'orderId', v_order_id, 'total', v_total);
end $$;

revoke execute on function public.admin_create_order(text, text, jsonb, text, text, text, text, text, numeric, text, date, boolean) from public, anon;
grant execute on function public.admin_create_order(text, text, jsonb, text, text, text, text, text, numeric, text, date, boolean) to authenticated;
