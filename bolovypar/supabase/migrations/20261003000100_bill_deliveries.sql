create table public.bill_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  recipient_retailer_business_id uuid not null references public.businesses(id),
  document_kind text not null check (document_kind in ('confirmation', 'invoice')),
  sent_at timestamptz not null default now(),
  unique(order_id, recipient_retailer_business_id, document_kind)
);

create index bill_deliveries_recipient_sent_idx
  on public.bill_deliveries(recipient_retailer_business_id, sent_at desc);

alter table public.bill_deliveries enable row level security;

create policy bill_deliveries_supplier_read on public.bill_deliveries
for select to authenticated using (
  exists (select 1 from public.orders o join public.businesses b on b.id=o.supplier_business_id
    where o.id=order_id and b.owner_id=(select auth.uid()))
);

create policy bill_deliveries_recipient_read on public.bill_deliveries
for select to authenticated using (
  exists (select 1 from public.orders o join public.businesses b on b.id=recipient_retailer_business_id
    join public.retailer_links l on l.supplier_business_id=o.supplier_business_id
      and l.retailer_business_id=b.id and l.status='active'
    where o.id=order_id and b.owner_id=(select auth.uid()))
);

grant select on public.bill_deliveries to authenticated;
