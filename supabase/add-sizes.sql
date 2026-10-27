-- =====================================================================
-- SIZES (50ml + 20ml)
-- Run once in Supabase -> SQL Editor. Safe to re-run.
--
-- Idea: a 20ml bottle is its own row in `products` (so stock, cost,
-- restocks, orders, promos and profit all keep working), but it is
-- LINKED to its 50ml scent through `parent_id`. The 20ml copies the
-- scent info (photo, notes, description, badges...) from the 50ml
-- automatically, and stays in sync whenever you edit the 50ml.
-- Only price, stock and cost belong to each size.
-- =====================================================================

alter table public.products
  add column if not exists parent_id  text references public.products (id)
                                           on update cascade on delete restrict,
  add column if not exists size_label text not null default '50ml';

alter table public.products drop constraint if exists products_size_label_check;
alter table public.products add constraint products_size_label_check
  check (size_label ~ '^[A-Za-z0-9.]{1,10}$');

alter table public.products drop constraint if exists products_parent_not_self;
alter table public.products add constraint products_parent_not_self
  check (parent_id is null or parent_id <> id);

-- one row per size under the same scent
create unique index if not exists products_parent_size_uniq
  on public.products (parent_id, lower(size_label)) where parent_id is not null;
create index if not exists products_parent_idx
  on public.products (parent_id) where parent_id is not null;

-- ---------------------------------------------------------------------
-- A size row always mirrors the scent info of its 50ml parent.
-- (price, stock, cost, active and the size label are its own)
-- ---------------------------------------------------------------------
create or replace function public.products_inherit_from_parent()
returns trigger
language plpgsql
as $$
declare
  v_parent public.products%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;

  select * into v_parent from public.products where id = new.parent_id;
  if not found then
    raise exception 'The 50ml product for this size was not found.' using errcode = 'P0001';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'A size cannot be added under another size.' using errcode = 'P0001';
  end if;

  new.name        := v_parent.name || ' (' || new.size_label || ')';
  new.cat         := v_parent.cat;
  new.img         := v_parent.img;
  new.descr       := v_parent.descr;
  new.desc_long   := v_parent.desc_long;
  new.top_notes   := v_parent.top_notes;
  new.heart_notes := v_parent.heart_notes;
  new.base_notes  := v_parent.base_notes;
  new.application := v_parent.application;
  new.profiles    := v_parent.profiles;
  new.longevity   := v_parent.longevity;
  new.projection  := v_parent.projection;
  new.strength    := v_parent.strength;
  new.time        := v_parent.time;
  new.occasion    := v_parent.occasion;
  new.badges      := v_parent.badges;
  new.sort_order  := v_parent.sort_order;
  return new;
end $$;

drop trigger if exists products_inherit_from_parent on public.products;
create trigger products_inherit_from_parent
  before insert or update on public.products
  for each row execute function public.products_inherit_from_parent();

-- ---------------------------------------------------------------------
-- When the 50ml's scent info changes, push it to its sizes.
-- Fires only when one of the shared columns is in the UPDATE, so normal
-- order/stock updates on the 50ml never touch the 20ml rows.
-- ---------------------------------------------------------------------
create or replace function public.products_push_to_sizes()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null then
    return null;
  end if;

  -- the BEFORE trigger on each size row re-copies everything from this parent
  update public.products c
     set name = c.name
   where c.parent_id = new.id
     and (   c.cat         is distinct from new.cat
          or c.img         is distinct from new.img
          or c.descr       is distinct from new.descr
          or c.desc_long   is distinct from new.desc_long
          or c.top_notes   is distinct from new.top_notes
          or c.heart_notes is distinct from new.heart_notes
          or c.base_notes  is distinct from new.base_notes
          or c.application is distinct from new.application
          or c.profiles    is distinct from new.profiles
          or c.longevity   is distinct from new.longevity
          or c.projection  is distinct from new.projection
          or c.strength    is distinct from new.strength
          or c.time        is distinct from new.time
          or c.occasion    is distinct from new.occasion
          or c.badges      is distinct from new.badges
          or c.sort_order  is distinct from new.sort_order
          or c.name        is distinct from (new.name || ' (' || c.size_label || ')'));
  return null;
end $$;

drop trigger if exists products_push_to_sizes on public.products;
create trigger products_push_to_sizes
  after update of name, cat, img, descr, desc_long, top_notes, heart_notes, base_notes,
                  application, profiles, longevity, projection, strength, time,
                  occasion, badges, sort_order
  on public.products
  for each row execute function public.products_push_to_sizes();

-- ---------------------------------------------------------------------
-- Admin: add a size (e.g. 20ml) to an existing scent.
-- You only give the price, stock and cost; everything else is copied.
-- ---------------------------------------------------------------------
create or replace function public.admin_add_size(
  p_parent_id text,
  p_size      text,
  p_price     numeric,
  p_stock     integer default null,   -- null = unlimited
  p_cost      numeric default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_parent public.products%rowtype;
  v_size   text := lower(trim(coalesce(p_size, '')));
  v_id     text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_size !~ '^[a-z0-9.]{1,10}$' then
    return jsonb_build_object('success', false, 'message', 'Size should look like 20ml.');
  end if;
  if p_price is null or p_price < 0 then
    return jsonb_build_object('success', false, 'message', 'Please enter a price.');
  end if;
  if p_stock is not null and p_stock < 0 then
    return jsonb_build_object('success', false, 'message', 'Stock cannot be negative.');
  end if;
  if p_cost is not null and p_cost < 0 then
    return jsonb_build_object('success', false, 'message', 'Cost cannot be negative.');
  end if;

  select * into v_parent from public.products where id = p_parent_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Product not found.');
  end if;
  if v_parent.parent_id is not null then
    return jsonb_build_object('success', false, 'message', 'Add the size to the 50ml product, not to another size.');
  end if;
  if lower(v_parent.size_label) = v_size then
    return jsonb_build_object('success', false, 'message', format('This product is already the %s size.', v_parent.size_label));
  end if;
  if exists (select 1 from public.products where parent_id = v_parent.id and lower(size_label) = v_size) then
    return jsonb_build_object('success', false, 'message', format('%s already has a %s size.', v_parent.name, v_size));
  end if;

  -- id like "Clinique Happy 20ml" (kept within the 64-character id limit)
  v_id := left(v_parent.id, 64 - char_length(' ' || v_size)) || ' ' || v_size;
  if exists (select 1 from public.products where id = v_id) then
    return jsonb_build_object('success', false, 'message', format('The ID "%s" is already used.', v_id));
  end if;

  -- scent info is filled in by the products_inherit_from_parent trigger
  insert into public.products (id, name, parent_id, size_label, price, stock, cost, active)
  values (v_id, v_parent.name, v_parent.id, v_size, p_price, p_stock, p_cost, v_parent.active);

  return jsonb_build_object('success', true, 'id', v_id);
end $$;

revoke execute on function public.admin_add_size(text, text, numeric, integer, numeric) from public, anon;
grant  execute on function public.admin_add_size(text, text, numeric, integer, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- The public site may read the two new columns (cost stays admin-only).
-- ---------------------------------------------------------------------
grant select (parent_id, size_label) on public.products to anon, authenticated;
