-- Milestone 3: server-owned catalog, contacts, orders, and invoice records.
-- Amounts are integer paise and quantities are thousandths of their unit.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  supplier_business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  sku text,
  aliases text[] not null default '{}',
  packaging text,
  hsn_code text,
  gst_rate_bps integer not null default 0 check (gst_rate_bps between 0 and 10000),
  stock_quantity_milli bigint check (stock_quantity_milli is null or stock_quantity_milli >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sku is null or char_length(trim(sku)) between 1 and 64),
  check (packaging is null or char_length(packaging) <= 160),
  check (hsn_code is null or hsn_code ~ '^[0-9]{4,8}$'),
  check (array_length(aliases, 1) is null or array_length(aliases, 1) <= 20)
);
create unique index products_supplier_sku_key on public.products(supplier_business_id, lower(sku)) where sku is not null;
create index products_supplier_name_idx on public.products(supplier_business_id, lower(name));

create table public.product_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  unit_name text not null check (char_length(trim(unit_name)) between 1 and 40),
  standard_price_paise bigint not null check (standard_price_paise between 0 and 100000000000),
  stock_factor_milli bigint not null default 1000 check (stock_factor_milli between 1 and 1000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, unit_name)
);

create table public.retailer_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_business_id uuid not null references public.businesses(id) on delete cascade,
  retailer_business_id uuid references public.businesses(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 160),
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  gstin text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is null or char_length(phone) <= 30),
  check (email is null or char_length(email) <= 254),
  check (address_line1 is null or char_length(address_line1) <= 160),
  check (address_line2 is null or char_length(address_line2) <= 160),
  check (city is null or char_length(city) <= 80),
  check (state is null or char_length(state) <= 80),
  check (postal_code is null or postal_code ~ '^[1-9][0-9]{5}$'),
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  check (notes is null or char_length(notes) <= 1000)
);
create unique index retailer_contacts_linked_key on public.retailer_contacts(supplier_business_id, retailer_business_id) where retailer_business_id is not null;
create index retailer_contacts_supplier_name_idx on public.retailer_contacts(supplier_business_id, lower(name));

create table public.retailer_prices (
  retailer_contact_id uuid not null references public.retailer_contacts(id) on delete cascade,
  product_unit_id uuid not null references public.product_units(id) on delete cascade,
  price_paise bigint not null check (price_paise between 0 and 100000000000),
  updated_at timestamptz not null default now(),
  primary key(retailer_contact_id, product_unit_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  supplier_business_id uuid not null references public.businesses(id) on delete cascade,
  retailer_contact_id uuid not null references public.retailer_contacts(id),
  retailer_business_id uuid references public.businesses(id),
  status text not null default 'draft' check (status in ('draft','confirmed','invoiced')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid')),
  place_of_supply_state text not null check (char_length(trim(place_of_supply_state)) between 1 and 80),
  tax_mode text not null check (tax_mode in ('none','intra','inter')),
  instructions text,
  subtotal_paise bigint not null default 0 check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  taxable_paise bigint not null default 0 check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  total_paise bigint not null default 0 check (total_paise >= 0),
  paid_paise bigint not null default 0 check (paid_paise >= 0 and paid_paise <= total_paise),
  confirmed_at timestamptz,
  confirmation_snapshot jsonb,
  invoice_number text,
  invoice_issued_at timestamptz,
  invoice_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (instructions is null or char_length(instructions) <= 2000),
  check ((status = 'draft' and confirmed_at is null and confirmation_snapshot is null and invoice_number is null and invoice_issued_at is null)
    or (status = 'confirmed' and confirmed_at is not null and confirmation_snapshot is not null and invoice_number is null and invoice_issued_at is null)
    or (status = 'invoiced' and confirmed_at is not null and confirmation_snapshot is not null and invoice_number is not null and invoice_issued_at is not null and invoice_snapshot is not null)),
  unique(supplier_business_id, invoice_number)
);
create index orders_supplier_created_idx on public.orders(supplier_business_id, created_at desc);
create index orders_retailer_created_idx on public.orders(retailer_business_id, created_at desc);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_unit_id uuid not null references public.product_units(id),
  product_name text not null,
  sku text,
  hsn_code text,
  unit_name text not null,
  quantity_milli bigint not null check (quantity_milli between 1 and 1000000000),
  stock_factor_milli bigint not null check (stock_factor_milli > 0),
  rate_paise bigint not null check (rate_paise between 0 and 100000000000),
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  gst_rate_bps integer not null default 0 check (gst_rate_bps between 0 and 10000),
  gross_paise bigint not null check (gross_paise >= 0),
  discount_paise bigint not null check (discount_paise >= 0),
  taxable_paise bigint not null check (taxable_paise >= 0),
  cgst_paise bigint not null check (cgst_paise >= 0),
  sgst_paise bigint not null check (sgst_paise >= 0),
  igst_paise bigint not null check (igst_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  instructions text,
  position integer not null check (position >= 0),
  check (instructions is null or char_length(instructions) <= 500),
  unique(order_id, position)
);
create index order_lines_order_idx on public.order_lines(order_id, position);

create table public.invoice_counters (
  supplier_business_id uuid not null references public.businesses(id) on delete cascade,
  financial_year text not null check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  last_number integer not null check (last_number > 0),
  primary key(supplier_business_id, financial_year)
);

create or replace function public.protect_order_finality() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'invoiced' then
    if (to_jsonb(new) - array['paid_paise','payment_status','updated_at'])
      <> (to_jsonb(old) - array['paid_paise','payment_status','updated_at']) then
      raise exception 'Issued invoices cannot be changed';
    end if;
  elsif old.status = 'confirmed' then
    if new.status not in ('confirmed','invoiced') or
      (to_jsonb(new) - array['status','invoice_number','invoice_issued_at','invoice_snapshot','paid_paise','payment_status','updated_at'])
      <> (to_jsonb(old) - array['status','invoice_number','invoice_issued_at','invoice_snapshot','paid_paise','payment_status','updated_at']) then
      raise exception 'Confirmed order details cannot be changed';
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_finality before update on public.orders for each row execute function public.protect_order_finality();

create or replace function public.protect_order_lines() returns trigger language plpgsql set search_path = '' as $$
declare current_status text;
begin
  if tg_op = 'DELETE' then
    select status into current_status from public.orders where id = old.order_id;
  else
    select status into current_status from public.orders where id = new.order_id;
  end if;
  if current_status <> 'draft' then raise exception 'Confirmed order lines cannot be changed'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger order_lines_finality before insert or update or delete on public.order_lines
for each row execute function public.protect_order_lines();

create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger product_units_updated_at before update on public.product_units for each row execute function public.set_updated_at();
create trigger retailer_contacts_updated_at before update on public.retailer_contacts for each row execute function public.set_updated_at();
create trigger retailer_prices_updated_at before update on public.retailer_prices for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.product_units enable row level security;
alter table public.retailer_contacts enable row level security;
alter table public.retailer_prices enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.invoice_counters enable row level security;

create policy products_supplier_read on public.products for select to authenticated using (
  exists (select 1 from public.businesses b where b.id = supplier_business_id and b.owner_id = (select auth.uid()))
);
create policy product_units_supplier_read on public.product_units for select to authenticated using (
  exists (select 1 from public.products p join public.businesses b on b.id = p.supplier_business_id
    where p.id = product_id and b.owner_id = (select auth.uid()))
);
create policy retailer_contacts_supplier_read on public.retailer_contacts for select to authenticated using (
  exists (select 1 from public.businesses b where b.id = supplier_business_id and b.owner_id = (select auth.uid()))
);
create policy retailer_prices_supplier_read on public.retailer_prices for select to authenticated using (
  exists (select 1 from public.retailer_contacts c join public.businesses b on b.id = c.supplier_business_id
    where c.id = retailer_contact_id and b.owner_id = (select auth.uid()))
);
create policy orders_supplier_read on public.orders for select to authenticated using (
  exists (select 1 from public.businesses b where b.id = supplier_business_id and b.owner_id = (select auth.uid()))
);
create policy orders_retailer_read on public.orders for select to authenticated using (
  status in ('confirmed','invoiced') and exists (
    select 1 from public.businesses b where b.id = retailer_business_id and b.owner_id = (select auth.uid()))
);
create policy order_lines_visible_read on public.order_lines for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id)
);

grant select on public.products, public.product_units, public.retailer_contacts,
  public.retailer_prices, public.orders, public.order_lines to authenticated;
revoke all on public.invoice_counters from anon, authenticated;
