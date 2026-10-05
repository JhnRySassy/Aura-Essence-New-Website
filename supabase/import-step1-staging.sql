-- =====================================================================
-- IMPORT FROM GOOGLE SHEETS — STEP 1 of 2
-- Creates temporary import tables whose columns match your Google
-- Sheets tabs EXACTLY, so you can upload each tab's CSV without editing.
--
--   Sheet tab (main spreadsheet)   →  import table
--   Orders                         →  import_orders
--   Products                       →  import_products
--   Promotions                     →  import_promotions
--   Site Settings                  →  import_site_settings
--   Admin Audit                    →  import_admin_audit
--   Reviews (reviews spreadsheet)  →  import_reviews
--
-- Every column is plain text, so no row gets rejected during upload.
-- =====================================================================

create table if not exists public.import_orders (
  "Timestamp" text, "Order ID" text, "Full Name" text, "Contact Number" text,
  "Scent" text, "Scent ID" text, "Quantity" text, "Delivery / Meetup Location" text,
  "Payment Method" text, "Notes" text, "Price per Bottle" text, "Estimated Total" text,
  "Status" text, "Items JSON" text
);

create table if not exists public.import_products (
  "ID" text, "Name" text, "Category" text, "Description" text, "Image URL" text,
  "Price" text, "Stock" text, "Badges" text, "Active" text, "Profiles" text,
  "Longevity" text, "Projection" text, "Strength" text, "Time" text, "Occasion" text,
  "Long Description" text, "Top Notes" text, "Heart Notes" text, "Base Notes" text,
  "Application" text, "Sort Order" text
);

create table if not exists public.import_promotions (
  "ID" text, "Name" text, "Type" text, "Min Qty" text, "Fixed Total" text,
  "Percent Off" text, "Active" text
);

create table if not exists public.import_site_settings (
  "Key" text, "Value" text
);

create table if not exists public.import_admin_audit (
  "Timestamp" text, "Actor" text, "Action" text
);

create table if not exists public.import_reviews (
  "Timestamp" text, "Review ID" text, "Customer Name" text, "Scent" text,
  "Scent ID" text, "Rating" text, "Review" text, "Photo URL" text, "Status" text
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
