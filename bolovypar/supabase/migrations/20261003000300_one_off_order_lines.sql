alter table public.order_lines
  alter column product_id drop not null,
  alter column product_unit_id drop not null;

alter table public.order_lines
  add column source text not null default 'catalog'
    check (source in ('catalog', 'one_off')),
  add constraint order_lines_source_product_check check (
    (source = 'catalog' and product_id is not null and product_unit_id is not null)
    or (source = 'one_off' and product_id is null and product_unit_id is null)
  );
