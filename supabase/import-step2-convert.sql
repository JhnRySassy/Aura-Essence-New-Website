-- =====================================================================
-- IMPORT FROM GOOGLE SHEETS — STEP 2 of 2
-- Run AFTER uploading your CSVs into the import_* tables (step 1).
--
-- • Products, Promotions, Site Settings: your sheet is treated as the
--   source of truth, so it overwrites rows with the same ID.
-- • Orders, Reviews, Admin Audit: added once; existing rows are kept,
--   so running this again won't create duplicates (except audit lines).
-- At the end it shows what was imported and deletes the import tables.
-- =====================================================================

-- Google Sheets exports dates like 10/3/2026 9:34:11 (month/day/year).
set datestyle = 'ISO, MDY';
set timezone = 'Asia/Manila';

-- ---------- temporary helpers (disappear when the query ends) ----------

-- trims and removes the leading apostrophe Apps Script added to some values
create or replace function pg_temp.txt(v text) returns text language sql immutable as $$
  select regexp_replace(trim(coalesce(v, '')), '^''', '');
$$;

create or replace function pg_temp.to_list(v text) returns text[] language plpgsql immutable as $$
begin
  v := nullif(pg_temp.txt(v), '');
  if v is null then return '{}'; end if;
  if left(v, 1) = '[' then
    begin
      return array(select trim(x) from jsonb_array_elements_text(v::jsonb) x where trim(x) <> '');
    exception when others then null;
    end;
  end if;
  return array(select trim(x) from unnest(string_to_array(v, ',')) x where trim(x) <> '');
end $$;

create or replace function pg_temp.to_num(v text) returns numeric language plpgsql immutable as $$
begin
  return nullif(substring(replace(coalesce(v, ''), ',', '') from '-?[0-9]+(?:\.[0-9]+)?'), '')::numeric;
exception when others then return null;
end $$;

create or replace function pg_temp.is_false(v text) returns boolean language sql immutable as $$
  select lower(pg_temp.txt(v)) in ('false', '0', 'no', 'off');
$$;

create or replace function pg_temp.to_ts(v text) returns timestamptz language plpgsql stable as $$
begin
  return coalesce(nullif(pg_temp.txt(v), '')::timestamptz, now());
exception when others then return now();
end $$;

-- Old Drive links (drive.google.com/file/d/ID/view or ?id=ID) can't be shown as images;
-- convert them to the same lh3 format the Apps Script used for newer photos.
create or replace function pg_temp.photo(v text) returns text language sql immutable as $$
  select case
    when pg_temp.txt(v) = '' then null
    when pg_temp.txt(v) ~ 'drive\.google\.com' and coalesce(substring(v from '/d/([A-Za-z0-9_-]{10,})'), substring(v from '[?&]id=([A-Za-z0-9_-]{10,})')) is not null
      then 'https://lh3.googleusercontent.com/d/' || coalesce(substring(v from '/d/([A-Za-z0-9_-]{10,})'), substring(v from '[?&]id=([A-Za-z0-9_-]{10,})')) || '=w1200'
    else pg_temp.txt(v)
  end;
$$;

-- Orders: use "Items JSON" when present; older rows fall back to Scent / Scent ID / Quantity.
create or replace function pg_temp.to_items(items text, scent text, scent_id text, qty text)
returns jsonb language plpgsql immutable as $$
declare
  j jsonb;
begin
  begin
    j := pg_temp.txt(items)::jsonb;
    if jsonb_typeof(j) = 'array' and jsonb_array_length(j) > 0 then
      return j;
    end if;
  exception when others then null;
  end;
  return jsonb_build_array(jsonb_build_object(
    'id',   case when position(',' in coalesce(scent_id, '')) = 0 then nullif(pg_temp.txt(scent_id), '') end,
    'name', pg_temp.txt(scent),
    'qty',  coalesce(pg_temp.to_num(qty), 1)::int));
end $$;

-- ---------- products (sheet "Products") ----------
insert into public.products (id, name, cat, descr, img, price, stock, badges, active, profiles,
  longevity, projection, strength, time, occasion, desc_long, top_notes, heart_notes, base_notes,
  application, sort_order)
select
  pg_temp.txt("ID"),
  pg_temp.txt("Name"),
  case when lower(pg_temp.txt("Category")) in ('men', 'women', 'unisex') then lower(pg_temp.txt("Category")) else 'men' end,
  pg_temp.txt("Description"),
  pg_temp.txt("Image URL"),
  coalesce(pg_temp.to_num("Price"), 430),
  case when pg_temp.to_num("Stock") is null then null    -- blank = unlimited (same as before)
       else greatest(0, pg_temp.to_num("Stock"))::int end,
  array(select upper(b) from unnest(pg_temp.to_list("Badges")) b),
  not pg_temp.is_false("Active"),
  pg_temp.to_list("Profiles"),
  least(10, greatest(1, coalesce(pg_temp.to_num("Longevity"), 7)))::int,
  least(10, greatest(1, coalesce(pg_temp.to_num("Projection"), 7)))::int,
  case lower(pg_temp.txt("Strength"))
    when 'light' then 'subtle' when 'subtle' then 'subtle'
    when 'strong' then 'bold' when 'bold' then 'bold' else 'moderate' end,
  pg_temp.to_list("Time"),
  pg_temp.txt("Occasion"),
  pg_temp.txt("Long Description"),
  pg_temp.to_list("Top Notes"), pg_temp.to_list("Heart Notes"), pg_temp.to_list("Base Notes"),
  pg_temp.txt("Application"),
  coalesce(pg_temp.to_num("Sort Order"), 0)::int
from public.import_products
where pg_temp.txt("ID") ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$'
  and pg_temp.txt("Name") <> ''
on conflict (id) do update set
  name = excluded.name, cat = excluded.cat, descr = excluded.descr, img = excluded.img,
  price = excluded.price, stock = excluded.stock, badges = excluded.badges, active = excluded.active,
  profiles = excluded.profiles, longevity = excluded.longevity, projection = excluded.projection,
  strength = excluded.strength, time = excluded.time, occasion = excluded.occasion,
  desc_long = excluded.desc_long, top_notes = excluded.top_notes, heart_notes = excluded.heart_notes,
  base_notes = excluded.base_notes, application = excluded.application, sort_order = excluded.sort_order;

-- ---------- promotions (sheet "Promotions") ----------
insert into public.promotions (id, name, type, min_qty, fixed_total, percent_off, active)
select
  coalesce(nullif(pg_temp.txt("ID"), ''), gen_random_uuid()::text),
  coalesce(nullif(pg_temp.txt("Name"), ''), pg_temp.txt("ID")),
  case when lower(pg_temp.txt("Type")) = 'percent' then 'percent' else 'fixed_total' end,
  greatest(1, coalesce(pg_temp.to_num("Min Qty"), 2))::int,
  greatest(0, coalesce(pg_temp.to_num("Fixed Total"), 0)),
  least(100, greatest(0, coalesce(pg_temp.to_num("Percent Off"), 0))),
  not pg_temp.is_false("Active")
from public.import_promotions
where coalesce(nullif(pg_temp.txt("Name"), ''), pg_temp.txt("ID")) <> ''
on conflict (id) do update set
  name = excluded.name, type = excluded.type, min_qty = excluded.min_qty,
  fixed_total = excluded.fixed_total, percent_off = excluded.percent_off, active = excluded.active;

-- ---------- site settings (sheet "Site Settings": Key / Value) ----------
update public.site_settings s
   set data = s.data || coalesce((
     select jsonb_object_agg(
              pg_temp.txt("Key"),
              case
                when lower(pg_temp.txt("Value")) in ('true', 'false') then to_jsonb(lower(pg_temp.txt("Value")) = 'true')
                when pg_temp.txt("Value") ~ '^-?[0-9]+$' then to_jsonb(pg_temp.txt("Value")::int)
                else to_jsonb(pg_temp.txt("Value"))
              end)
       from public.import_site_settings
      where pg_temp.txt("Key") <> ''), '{}'::jsonb)
 where s.id = 1;

-- ---------- orders (sheet "Orders") ----------
insert into public.orders (order_id, fullname, contact, items, scent, quantity, address, payment,
  notes, subtotal, total, status, created_at)
select
  pg_temp.txt("Order ID"),
  coalesce(nullif(pg_temp.txt("Full Name"), ''), 'Customer'),
  -- Sheets drops the leading 0 of numbers like 09171234567; put it back
  case when pg_temp.txt("Contact Number") ~ '^9[0-9]{9}$' then '0' || pg_temp.txt("Contact Number")
       else pg_temp.txt("Contact Number") end,
  pg_temp.to_items("Items JSON", "Scent", "Scent ID", "Quantity"),
  pg_temp.txt("Scent"),
  coalesce(pg_temp.to_num("Quantity"), 1)::int,
  pg_temp.txt("Delivery / Meetup Location"),
  pg_temp.txt("Payment Method"),
  pg_temp.txt("Notes"),
  coalesce(pg_temp.to_num("Estimated Total"), 0),
  coalesce(pg_temp.to_num("Estimated Total"), 0),
  case when pg_temp.txt("Status") in ('New', 'Confirmed', 'Preparing', 'Out for Delivery', 'Completed', 'Cancelled')
       then pg_temp.txt("Status") else 'New' end,
  pg_temp.to_ts("Timestamp")
from public.import_orders
where pg_temp.txt("Order ID") <> ''
on conflict (order_id) do nothing;

-- ---------- reviews (Reviews spreadsheet; only "Approved" ones are shown) ----------
insert into public.reviews (id, name, scent, scent_id, rating, review, photo_url, approved, created_at)
select
  coalesce(nullif(pg_temp.txt("Review ID"), ''), 'REV-IMPORT-' || md5(coalesce("Timestamp", '') || coalesce("Review", ''))),
  coalesce(nullif(pg_temp.txt("Customer Name"), ''), 'Customer'),
  pg_temp.txt("Scent"),
  nullif(pg_temp.txt("Scent ID"), ''),
  least(5, greatest(1, coalesce(pg_temp.to_num("Rating"), 5)))::int,
  pg_temp.txt("Review"),
  pg_temp.photo("Photo URL"),
  lower(pg_temp.txt("Status")) = 'approved',
  pg_temp.to_ts("Timestamp")
from public.import_reviews
where pg_temp.txt("Review") <> ''
on conflict (id) do nothing;

-- ---------- admin audit (sheet "Admin Audit") ----------
insert into public.audit_log (actor, action, created_at)
select coalesce(nullif(pg_temp.txt("Actor"), ''), 'admin'), pg_temp.txt("Action"), pg_temp.to_ts("Timestamp")
from public.import_admin_audit
where pg_temp.txt("Action") <> '';

-- ---------- results ----------
select 'Products in database' as item, count(*)::text as result from public.products
union all select 'Promotions in database', count(*)::text from public.promotions
union all select 'Orders in database', count(*)::text from public.orders
union all select 'Reviews in database (approved)', count(*) || ' (' || count(*) filter (where approved) || ')' from public.reviews
union all select 'Audit log entries', count(*)::text from public.audit_log
union all select 'SKIPPED product rows (bad or missing ID/Name): ' || coalesce(string_agg(coalesce("ID", '(blank)'), ', '), 'none'),
                 count(*)::text
  from public.import_products
 where not (pg_temp.txt("ID") ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$' and pg_temp.txt("Name") <> '');

-- ---------- clean up ----------
drop table if exists public.import_orders, public.import_products, public.import_promotions,
                     public.import_site_settings, public.import_admin_audit, public.import_reviews;