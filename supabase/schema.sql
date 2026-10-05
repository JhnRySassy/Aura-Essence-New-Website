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

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor      text not null default 'system',
  action     text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

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
drop trigger if exists settings_touch on public.site_settings;
create trigger settings_touch before update on public.site_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- AUDIT LOG (automatic — written by the database, not the browser)
-- Only admin actions are logged, so customer orders don't flood it.
-- ---------------------------------------------------------------------

create or replace function public.audit_admin_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  label  text;
  verb   text;
  target text;
begin
  if not public.is_admin() then
    return coalesce(new, old);
  end if;

  verb := case tg_op when 'INSERT' then 'Created' when 'UPDATE' then 'Updated' else 'Deleted' end;

  case tg_table_name
    when 'products' then
      label  := 'product';
      target := coalesce(new.id, old.id);
    when 'promotions' then
      label  := 'promotion';
      target := coalesce(new.name, old.name);
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
      end if;
    else
      label  := tg_table_name;
  end case;

  insert into public.audit_log (actor, action)
  values (public.current_actor(), trim(verb || ' ' || label || coalesce(' ' || target, '')));

  return coalesce(new, old);
end $$;

drop trigger if exists products_audit on public.products;
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_admin_change();
drop trigger if exists promotions_audit on public.promotions;
create trigger promotions_audit after insert or update or delete on public.promotions
  for each row execute function public.audit_admin_change();
drop trigger if exists settings_audit on public.site_settings;
create trigger settings_audit after update on public.site_settings
  for each row execute function public.audit_admin_change();
drop trigger if exists reviews_audit on public.reviews;
create trigger reviews_audit after update or delete on public.reviews
  for each row execute function public.audit_admin_change();
drop trigger if exists orders_audit on public.orders;
create trigger orders_audit after update of status or delete on public.orders
  for each row execute function public.audit_admin_change();

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

create or replace function public.place_order(
  p_fullname text,
  p_contact  text,
  p_items    jsonb,
  p_address  text,
  p_payment  text,
  p_notes    text default ''
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
  v_total    numeric(10,2);
  v_promo    public.promotions%rowtype;
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

      v_items    := v_items || jsonb_build_object('id', v_product.id, 'name', v_product.name,
                                                  'qty', v_line.qty, 'price', v_product.price);
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
        v_discount := v_subtotal - v_promo.fixed_total;
      elsif v_promo.type = 'percent' then
        v_discount := round(v_subtotal * v_promo.percent_off / 100, 2);
      else
        v_promo := null;
      end if;
    end if;
    v_total := greatest(0, v_subtotal - v_discount);

    -- Same format as the old Apps Script: AE-20261005-143012-7F3A9C
    loop
      v_order_id := 'AE-' || to_char(clock_timestamp() at time zone 'Asia/Manila', 'YYYYMMDD-HH24MISS') || '-'
                    || upper(encode(gen_random_bytes(3), 'hex'));
      exit when not exists (select 1 from public.orders where order_id = v_order_id);
    end loop;

    insert into public.orders (order_id, fullname, contact, items, scent, quantity, address, payment,
                               notes, subtotal, discount, total, promotion_name)
    values (v_order_id, trim(p_fullname), trim(p_contact), v_items, array_to_string(v_names, ', '),
            v_qty, trim(p_address), trim(p_payment), coalesce(trim(p_notes), ''),
            v_subtotal, v_discount, v_total, v_promo.name);
  exception
    when sqlstate 'P0001' then
      return jsonb_build_object('success', false, 'message', sqlerrm);
  end;

  return jsonb_build_object('success', true, 'type', 'order', 'orderId', v_order_id,
                            'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
                            'promo', coalesce(v_promo.name, ''), 'message', 'Order saved successfully.');
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
    'total', o.total,
    'status', o.status,
    'timestamp', o.created_at
  );
end $$;

-- ---------------------------------------------------------------------
-- SUBMIT REVIEW (customers) — saved hidden until an admin approves it
-- ---------------------------------------------------------------------

create or replace function public.submit_review(
  p_name      text,
  p_scent     text,
  p_scent_id  text,
  p_rating    integer,
  p_review    text,
  p_photo_url text
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

  insert into public.reviews (name, scent, scent_id, rating, review, photo_url)
  values (trim(p_name), left(coalesce(p_scent, ''), 120), left(p_scent_id, 64), p_rating, trim(p_review), p_photo_url);

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
        'revenue',   coalesce(sum(total) filter (where status <> 'Cancelled'), 0),
        'completed', count(*) filter (where status = 'Completed'),
        'pending',   count(*) filter (where status not in ('Completed', 'Cancelled')),
        'customers', count(distinct coalesce(nullif(right(contact_digits, 10), ''), fullname)),
        'averageOrderValue', coalesce(round(avg(total) filter (where status <> 'Cancelled'), 2), 0)
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

revoke execute on function public.place_order(text, text, jsonb, text, text, text) from public;
revoke execute on function public.track_order(text, text) from public;
revoke execute on function public.submit_review(text, text, text, integer, text, text) from public;
revoke execute on function public.admin_dashboard() from public;
revoke execute on function public.is_admin() from public;

grant execute on function public.place_order(text, text, jsonb, text, text, text) to anon, authenticated;
grant execute on function public.track_order(text, text) to anon, authenticated;
grant execute on function public.submit_review(text, text, text, integer, text, text) to anon, authenticated;
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