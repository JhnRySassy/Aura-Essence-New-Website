-- =====================================================================
-- IMPORT FROM GOOGLE SHEETS — STEP 1 of 2
-- Creates temporary import tables for your Google Sheets CSVs.
--
-- Supabase's CSV upload only accepts headers made of letters, numbers,
-- "-" and "_". So BEFORE downloading each tab as CSV, change row 1 to the
-- names below (lowercase, spaces become _). Full list in the README.
--
--   Sheet tab (main spreadsheet)   →  import table
--   Orders                         →  import_orders
--   Products                       →  import_products
--   Promotions                     →  import_promotions
--   Site Settings                  →  import_site_settings
--   Admin Audit                    →  import_admin_audit
--   Reviews (reviews spreadsheet)  →  import_reviews
--
-- Running this again empties the import tables (start over).
-- =====================================================================

drop table if exists public.import_orders, public.import_products, public.import_promotions,
                     public.import_site_settings, public.import_admin_audit, public.import_reviews;

create table if not exists public.import_orders (
  timestamp text, order_id text, full_name text, contact_number text,
  scent text, scent_id text, quantity text, delivery_meetup_location text,
  payment_method text, notes text, price_per_bottle text, estimated_total text,
  status text, items_json text
);

create table if not exists public.import_products (
  id text, name text, category text, description text, image_url text,
  price text, stock text, badges text, active text, profiles text,
  longevity text, projection text, strength text, time text, occasion text,
  long_description text, top_notes text, heart_notes text, base_notes text,
  application text, sort_order text
);

create table if not exists public.import_promotions (
  id text, name text, type text, min_qty text, fixed_total text,
  percent_off text, active text
);

create table if not exists public.import_site_settings (
  key text, value text
);

create table if not exists public.import_admin_audit (
  timestamp text, actor text, action text
);

create table if not exists public.import_reviews (
  timestamp text, review_id text, customer_name text, scent text,
  scent_id text, rating text, review text, photo_url text, status text
);

-- Lock these tables so the public website can't read them while they exist.
do $$
declare t text;
begin
  foreach t in array array['import_orders', 'import_products', 'import_promotions',
                           'import_site_settings', 'import_admin_audit', 'import_reviews']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;