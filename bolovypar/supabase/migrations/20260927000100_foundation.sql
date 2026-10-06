-- Foundation schema. Client access is denied until tenant policies are added in Milestone 2.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('supplier', 'retailer')),
  name text not null check (length(trim(name)) > 0),
  gstin text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_owner_id_idx on public.businesses(owner_id);

create table public.retailer_links (
  id uuid primary key default gen_random_uuid(),
  supplier_business_id uuid not null references public.businesses(id) on delete cascade,
  retailer_business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_business_id, retailer_business_id),
  check (supplier_business_id <> retailer_business_id)
);

create index retailer_links_retailer_idx on public.retailer_links(retailer_business_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger businesses_updated_at before update on public.businesses
for each row execute function public.set_updated_at();
create trigger retailer_links_updated_at before update on public.retailer_links
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.retailer_links enable row level security;

-- No client policies yet. Milestone 2 will add verified membership policies and
-- secure onboarding functions before these tables become available to clients.
