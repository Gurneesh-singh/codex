create function public.can_read_bill_delivery(delivery_order_id uuid, recipient_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    join public.businesses b on b.id = recipient_business_id
    join public.retailer_links l on l.supplier_business_id = o.supplier_business_id
      and l.retailer_business_id = b.id and l.status = 'active'
    where o.id = delivery_order_id and o.status <> 'draft'
      and b.kind = 'retailer' and b.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.can_read_bill_delivery(uuid, uuid) from public;
grant execute on function public.can_read_bill_delivery(uuid, uuid) to authenticated;

drop policy bill_deliveries_recipient_read on public.bill_deliveries;
create policy bill_deliveries_recipient_read on public.bill_deliveries
for select to authenticated using (
  public.can_read_bill_delivery(order_id, recipient_retailer_business_id)
);
