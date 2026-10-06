-- A supplier requesting a link must not read the retailer's private
-- address and GST details until the retailer accepts the request.
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
          where link.status = 'active'
            and ((link.supplier_business_id = mine.id and link.retailer_business_id = p_business_id)
              or (link.retailer_business_id = mine.id and link.supplier_business_id = p_business_id))
        )
        or exists (
          select 1 from public.retailer_links pending
          where pending.status = 'pending' and mine.kind = 'retailer'
            and pending.retailer_business_id = mine.id
            and pending.supplier_business_id = p_business_id
        )
      )
  );
$$;

alter table public.profiles add constraint profiles_display_name_length
  check (display_name is null or char_length(display_name) <= 100);
alter table public.profiles add constraint profiles_phone_length
  check (phone is null or char_length(phone) <= 20);
alter table public.businesses add constraint businesses_contact_length
  check (
    (phone is null or char_length(phone) <= 20)
    and (address_line1 is null or char_length(address_line1) <= 160)
    and (address_line2 is null or char_length(address_line2) <= 160)
    and (city is null or char_length(city) <= 80)
    and (state is null or char_length(state) <= 80)
  );
