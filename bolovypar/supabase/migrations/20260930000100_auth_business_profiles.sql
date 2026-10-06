-- Milestone 2: a verified account owns exactly one immutable business role.
-- All relationship mutations go through authenticated, scoped functions.

alter table public.businesses add constraint businesses_one_per_owner unique (owner_id);
alter table public.businesses add constraint businesses_name_length check (char_length(name) <= 160);
alter table public.businesses add constraint businesses_gstin_format check (
  gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
);
alter table public.businesses add constraint businesses_postal_code_format check (
  postal_code is null or postal_code ~ '^[1-9][0-9]{5}$'
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select id, nullif(trim(coalesce(raw_user_meta_data ->> 'full_name', '')), '')
from auth.users
on conflict (id) do nothing;

create or replace function public.protect_business_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id or new.kind is distinct from old.kind then
    raise exception 'Business owner and role cannot be changed';
  end if;
  return new;
end;
$$;

create trigger businesses_protect_identity
before update on public.businesses
for each row execute function public.protect_business_identity();

create or replace function public.can_view_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.businesses mine
    where mine.owner_id = (select auth.uid())
      and (
        mine.id = p_business_id
        or exists (
          select 1 from public.retailer_links link
          where link.status in ('pending', 'active')
            and ((link.supplier_business_id = mine.id and link.retailer_business_id = p_business_id)
              or (link.retailer_business_id = mine.id and link.supplier_business_id = p_business_id))
        )
      )
  );
$$;

create policy profiles_read_own on public.profiles
for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy businesses_read_linked on public.businesses
for select to authenticated using (public.can_view_business(id));
create policy businesses_update_own on public.businesses
for update to authenticated using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy retailer_links_read_participant on public.retailer_links
for select to authenticated using (
  exists (
    select 1 from public.businesses mine
    where mine.owner_id = (select auth.uid())
      and mine.id in (supplier_business_id, retailer_business_id)
  )
);

create or replace function public.onboard_business(
  p_kind text,
  p_name text,
  p_phone text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_gstin text default null
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.businesses;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then raise exception 'Verify your email before onboarding'; end if;
  if p_kind not in ('supplier', 'retailer') then raise exception 'Invalid business role'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Business name is required'; end if;

  insert into public.businesses (
    owner_id, kind, name, phone, address_line1, address_line2,
    city, state, postal_code, gstin
  ) values (
    auth.uid(), p_kind, trim(p_name), nullif(trim(p_phone), ''),
    nullif(trim(p_address_line1), ''), nullif(trim(p_address_line2), ''),
    nullif(trim(p_city), ''), nullif(trim(p_state), ''),
    nullif(trim(p_postal_code), ''), nullif(upper(trim(p_gstin)), '')
  ) returning * into result;
  return result;
end;
$$;

create or replace function public.request_retailer_link(p_retailer_business_id uuid)
returns public.retailer_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplier_id uuid;
  result public.retailer_links;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select id into supplier_id from public.businesses
    where owner_id = auth.uid() and kind = 'supplier';
  if supplier_id is null then raise exception 'Only suppliers can request retailer links'; end if;
  if not exists (select 1 from public.businesses where id = p_retailer_business_id and kind = 'retailer') then
    raise exception 'Retailer not found';
  end if;
  insert into public.retailer_links (supplier_business_id, retailer_business_id)
    values (supplier_id, p_retailer_business_id)
    on conflict (supplier_business_id, retailer_business_id) do nothing;
  select * into result from public.retailer_links
    where supplier_business_id = supplier_id and retailer_business_id = p_retailer_business_id;
  return result;
end;
$$;

create or replace function public.respond_retailer_link(p_link_id uuid, p_accept boolean)
returns public.retailer_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.retailer_links;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.retailer_links link
  set status = case when p_accept then 'active' else 'rejected' end
  where link.id = p_link_id and link.status = 'pending'
    and exists (
      select 1 from public.businesses retailer
      where retailer.id = link.retailer_business_id
        and retailer.owner_id = auth.uid() and retailer.kind = 'retailer'
    )
  returning * into result;
  if result.id is null then raise exception 'Pending link not found for this retailer'; end if;
  return result;
end;
$$;

revoke all on function public.can_view_business(uuid) from public, anon;
revoke all on function public.onboard_business(text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.request_retailer_link(uuid) from public, anon;
revoke all on function public.respond_retailer_link(uuid, boolean) from public, anon;
grant execute on function public.can_view_business(uuid) to authenticated;
grant execute on function public.onboard_business(text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.request_retailer_link(uuid) to authenticated;
grant execute on function public.respond_retailer_link(uuid, boolean) to authenticated;
