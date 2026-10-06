import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../database/pool.js';
import { calculateLine, financialYear, sumBill, type TaxMode } from '../services/billing.js';
import { renderOrderPdf } from '../services/orderPdf.js';

export const commerceRouter = Router();

const id = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.number().int().min(0).max(100000000000);
const unitSchema = z.object({ id: id.optional(), unit_name: z.string().trim().min(1).max(40), standard_price_paise: money,
  stock_factor_milli: z.number().int().min(1).max(1000000000).default(1000), active: z.boolean().default(true) }).strict();
const productSchema = z.object({ name: z.string().trim().min(1).max(160), sku: text(64), aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  packaging: text(160), hsn_code: z.string().regex(/^[0-9]{4,8}$/).nullable().optional(), gst_rate_bps: z.number().int().min(0).max(10000),
  stock_quantity_milli: z.number().int().min(0).max(100000000000).nullable().optional(), units: z.array(unitSchema).min(1).max(20) }).strict();
const aliasSchema = z.object({ alias: z.string().trim().min(1).max(80) }).strict();
const contactSchema = z.object({ name: z.string().trim().min(1).max(160), retailer_business_id: id.nullable().optional(), phone: text(30),
  email: z.email().max(254).nullable().optional(), address_line1: text(160), address_line2: text(160), city: text(80), state: text(80),
  postal_code: z.string().regex(/^[1-9][0-9]{5}$/).nullable().optional(), gstin: z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/).nullable().optional(), notes: text(1000) }).strict();
const orderLineBase = { quantity_milli: z.number().int().min(1).max(1000000000),
  discount_bps: z.number().int().min(0).max(10000).default(0), instructions: text(500) };
const orderLineSchema = z.union([
  z.object({ ...orderLineBase, source: z.literal('catalog').optional(), product_unit_id: id, rate_paise: money.optional() }).strict(),
  z.object({ ...orderLineBase, source: z.literal('one_off'), product_name: z.string().trim().min(1).max(160),
    unit_name: z.string().trim().min(1).max(40), rate_paise: money,
    gst_rate_bps: z.number().int().min(0).max(10000), hsn_code: z.string().regex(/^[0-9]{4,8}$/).nullable().optional() }).strict()
]);
const orderSchema = z.object({ retailer_contact_id: id, place_of_supply_state: z.string().trim().min(1).max(80),
  instructions: text(2000), expected_total_paise: money.optional(), lines: z.array(orderLineSchema).min(1).max(100) }).strict();
const documentKind = z.enum(['confirmation', 'invoice']);
const sendBillSchema = z.object({ recipient_business_id: id, document_kind: documentKind,
  acknowledge_other_recipient: z.boolean().default(false) }).strict();

type ProductInput = z.infer<typeof productSchema>;
type ContactInput = z.infer<typeof contactSchema>;
type OrderInput = z.infer<typeof orderSchema>;

class CommerceError extends Error { constructor(public status: number, message: string) { super(message); } }
function authId(response: Response): string { return response.locals.account.user.id as string; }
function fail(response: Response, cause: unknown) {
  const error = cause as { code?: string; message?: string };
  const status = cause instanceof CommerceError ? cause.status : error.code === '23505' ? 409 : error.code === '23514' ? 400 : 500;
  response.status(status).json({ error: { code: status === 500 ? 'DATA_ERROR' : 'INVALID_REQUEST', message: status === 500 ? 'Could not complete the request' : error.message } });
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CommerceError(400, result.error.issues[0]?.message ?? 'Invalid input');
  return result.data;
}
function ready() { if (!pool) throw new CommerceError(503, 'Database is not configured'); return pool; }
async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ready().connect();
  try { await client.query('begin'); const result = await work(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
async function business(client: PoolClient, userId: string, kind: 'supplier' | 'retailer') {
  const result = await client.query('select * from public.businesses where owner_id=$1 and kind=$2', [userId, kind]);
  if (!result.rows[0]) throw new CommerceError(403, `A ${kind} business is required`);
  return result.rows[0];
}
function ensureRow<T>(row: T | null | undefined, what = 'Record'): NonNullable<T> {
  if (!row) throw new CommerceError(404, `${what} not found`);
  return row as NonNullable<T>;
}
function handler(work: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response) => { void work(request, response).catch((error) => fail(response, error)); };
}
function normalizeState(value: string) { return value.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' '); }
function normalizeAlias(value: string) { return value.normalize('NFKC').trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' '); }
function serialize(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    /(_paise|_milli)$/.test(key) && value !== null ? Number(value) : value]));
}

commerceRouter.get('/products', handler(async (request, response) => {
  const search = String(request.query.search ?? '').trim().slice(0, 100);
  const client = await ready().connect();
  try {
    const seller = await business(client, authId(response), 'supplier');
    const products = await client.query(`select p.*, coalesce(jsonb_agg(to_jsonb(u) order by u.unit_name) filter (where u.id is not null),'[]'::jsonb) units
      from public.products p left join public.product_units u on u.product_id=p.id
      where p.supplier_business_id=$1 and ($2='' or p.name ilike '%'||$2||'%' or p.sku ilike '%'||$2||'%' or exists
        (select 1 from unnest(p.aliases) a where a ilike '%'||$2||'%'))
      group by p.id order by p.archived_at nulls first,p.name limit 500`, [seller.id, search]);
    response.json({ products: products.rows.map((row) => ({ ...serialize(row), units: row.units.map(serialize) })) });
  } finally { client.release(); }
}));

async function saveProduct(client: PoolClient, sellerId: string, data: ProductInput, productId?: string) {
  const existing = productId ? (await client.query('select * from public.products where id=$1 and supplier_business_id=$2 for update', [productId, sellerId])).rows[0] : null;
  if (productId) ensureRow(existing, 'Product');
  const names = new Set(data.units.map((unit) => unit.unit_name.toLowerCase()));
  if (names.size !== data.units.length) throw new CommerceError(400, 'Unit names must be unique');
  const fields = [sellerId, data.name, data.sku || null, data.aliases, data.packaging || null, data.hsn_code || null,
    data.gst_rate_bps, data.stock_quantity_milli ?? null];
  const result = productId
    ? await client.query(`update public.products set name=$2,sku=$3,aliases=$4,packaging=$5,hsn_code=$6,gst_rate_bps=$7,stock_quantity_milli=$8
        where id=$9 and supplier_business_id=$1 returning *`, [...fields, productId])
    : await client.query(`insert into public.products(supplier_business_id,name,sku,aliases,packaging,hsn_code,gst_rate_bps,stock_quantity_milli)
        values($1,$2,$3,$4,$5,$6,$7,$8) returning *`, fields);
  const product = result.rows[0];
  const kept: string[] = [];
  for (const unit of data.units) {
    if (unit.id) {
      const updated = await client.query(`update public.product_units set unit_name=$1,standard_price_paise=$2,stock_factor_milli=$3,active=$4
        where id=$5 and product_id=$6 returning id`, [unit.unit_name, unit.standard_price_paise, unit.stock_factor_milli, unit.active, unit.id, product.id]);
      ensureRow(updated.rows[0], 'Unit'); kept.push(unit.id);
    } else {
      const created = await client.query(`insert into public.product_units(product_id,unit_name,standard_price_paise,stock_factor_milli,active)
        values($1,$2,$3,$4,$5) returning id`, [product.id, unit.unit_name, unit.standard_price_paise, unit.stock_factor_milli, unit.active]);
      kept.push(created.rows[0].id);
    }
  }
  await client.query('update public.product_units set active=false where product_id=$1 and not (id=any($2::uuid[]))', [product.id, kept]);
  return product;
}

commerceRouter.post('/products', handler(async (request, response) => {
  const data = parse(productSchema, request.body);
  const product = await transaction(async (client) => saveProduct(client, (await business(client, authId(response), 'supplier')).id, data));
  response.status(201).json({ product: serialize(product) });
}));
commerceRouter.put('/products/:id', handler(async (request, response) => {
  const productId = parse(id, request.params.id), data = parse(productSchema, request.body);
  const product = await transaction(async (client) => saveProduct(client, (await business(client, authId(response), 'supplier')).id, data, productId));
  response.json({ product: serialize(product) });
}));
commerceRouter.post('/products/:id/aliases', handler(async (request, response) => {
  const productId = parse(id, request.params.id), { alias } = parse(aliasSchema, request.body);
  const aliases = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    // Serialize alias additions for this supplier so simultaneous reviews cannot claim the same word.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [seller.id]);
    const rows = (await client.query(`select id,name,aliases from public.products
      where supplier_business_id=$1 and archived_at is null for update`, [seller.id])).rows as
      { id: string; name: string; aliases: string[] }[];
    const product = ensureRow(rows.find((row) => row.id === productId), 'Product');
    const wanted = normalizeAlias(alias);
    if (normalizeAlias(product.name) === wanted || product.aliases.some((name) => normalizeAlias(name) === wanted))
      return product.aliases;
    if (rows.some((row) => row.id !== productId && [row.name, ...row.aliases].some((name) => normalizeAlias(name) === wanted)))
      throw new CommerceError(409, 'That name is already used by another product');
    if (product.aliases.length >= 20) throw new CommerceError(400, 'This product already has 20 aliases');
    return (await client.query('update public.products set aliases=array_append(aliases,$1) where id=$2 returning aliases',
      [alias, productId])).rows[0].aliases as string[];
  });
  response.json({ aliases });
}));
commerceRouter.post('/products/:id/archive', handler(async (request, response) => {
  const productId = parse(id, request.params.id);
  const result = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    return client.query('update public.products set archived_at=now() where id=$1 and supplier_business_id=$2 returning id', [productId, seller.id]);
  });
  ensureRow(result.rows[0], 'Product'); response.json({ archived: true });
}));
commerceRouter.post('/products/:id/restore', handler(async (request, response) => {
  const productId = parse(id, request.params.id);
  const result = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    return client.query('update public.products set archived_at=null where id=$1 and supplier_business_id=$2 returning id', [productId, seller.id]);
  });
  ensureRow(result.rows[0], 'Product'); response.json({ restored: true });
}));

commerceRouter.get('/contacts', handler(async (_request, response) => {
  const client = await ready().connect();
  try {
    const seller = await business(client, authId(response), 'supplier');
    const result = await client.query(`select c.*,coalesce(jsonb_agg(to_jsonb(p) order by p.product_unit_id) filter (where p.product_unit_id is not null),'[]'::jsonb) prices
      from public.retailer_contacts c left join public.retailer_prices p on p.retailer_contact_id=c.id
      where c.supplier_business_id=$1 group by c.id order by c.archived_at nulls first,c.name`, [seller.id]);
    response.json({ contacts: result.rows.map((row) => ({ ...row, prices: row.prices.map(serialize) })) });
  } finally { client.release(); }
}));

async function saveContact(client: PoolClient, sellerId: string, data: ContactInput, contactId?: string) {
  if (data.retailer_business_id) {
    const link = await client.query(`select 1 from public.retailer_links where supplier_business_id=$1 and retailer_business_id=$2 and status='active'`, [sellerId, data.retailer_business_id]);
    if (!link.rows[0]) throw new CommerceError(400, 'Retailer connection is not active');
  }
  const values = [sellerId, data.retailer_business_id ?? null, data.name, data.phone ?? null, data.email ?? null,
    data.address_line1 ?? null, data.address_line2 ?? null, data.city ?? null, data.state ?? null,
    data.postal_code ?? null, data.gstin?.toUpperCase() ?? null, data.notes ?? null];
  if (contactId) {
    const result = await client.query(`update public.retailer_contacts set retailer_business_id=$2,name=$3,phone=$4,email=$5,address_line1=$6,address_line2=$7,
      city=$8,state=$9,postal_code=$10,gstin=$11,notes=$12 where id=$13 and supplier_business_id=$1 returning *`, [...values, contactId]);
    return ensureRow(result.rows[0], 'Contact');
  }
  const result = await client.query(`insert into public.retailer_contacts(supplier_business_id,retailer_business_id,name,phone,email,address_line1,
    address_line2,city,state,postal_code,gstin,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`, values);
  return result.rows[0];
}
commerceRouter.post('/contacts', handler(async (request, response) => {
  const data = parse(contactSchema, request.body);
  const contact = await transaction(async (client) => saveContact(client, (await business(client, authId(response), 'supplier')).id, data));
  response.status(201).json({ contact });
}));
commerceRouter.put('/contacts/:id', handler(async (request, response) => {
  const contactId = parse(id, request.params.id), data = parse(contactSchema, request.body);
  const contact = await transaction(async (client) => saveContact(client, (await business(client, authId(response), 'supplier')).id, data, contactId));
  response.json({ contact });
}));
commerceRouter.post('/contacts/:id/archive', handler(async (request, response) => {
  const contactId = parse(id, request.params.id);
  const result = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    return client.query('update public.retailer_contacts set archived_at=now() where id=$1 and supplier_business_id=$2 returning id', [contactId, seller.id]);
  });
  ensureRow(result.rows[0], 'Contact'); response.json({ archived: true });
}));
commerceRouter.post('/contacts/:id/restore', handler(async (request, response) => {
  const contactId = parse(id, request.params.id);
  const result = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    return client.query('update public.retailer_contacts set archived_at=null where id=$1 and supplier_business_id=$2 returning id', [contactId, seller.id]);
  });
  ensureRow(result.rows[0], 'Contact'); response.json({ restored: true });
}));
commerceRouter.put('/contacts/:id/prices', handler(async (request, response) => {
  const contactId = parse(id, request.params.id);
  const data = parse(z.object({ product_unit_id: id, price_paise: money.nullable() }).strict(), request.body);
  await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    ensureRow((await client.query('select id from public.retailer_contacts where id=$1 and supplier_business_id=$2 and archived_at is null', [contactId, seller.id])).rows[0], 'Contact');
    ensureRow((await client.query(`select u.id from public.product_units u join public.products p on p.id=u.product_id
      where u.id=$1 and p.supplier_business_id=$2`, [data.product_unit_id, seller.id])).rows[0], 'Unit');
    if (data.price_paise === null) await client.query('delete from public.retailer_prices where retailer_contact_id=$1 and product_unit_id=$2', [contactId, data.product_unit_id]);
    else await client.query(`insert into public.retailer_prices(retailer_contact_id,product_unit_id,price_paise) values($1,$2,$3)
      on conflict(retailer_contact_id,product_unit_id) do update set price_paise=excluded.price_paise`, [contactId, data.product_unit_id, data.price_paise]);
  });
  response.json({ saved: true });
}));

async function orderAccess(client: PoolClient, userId: string, orderId: string, lock = false) {
  const seller = (await client.query(`select * from public.businesses where owner_id=$1`, [userId])).rows[0];
  if (!seller) throw new CommerceError(403, 'Business required');
  const result = await client.query(`select o.* from public.orders o where o.id=$1 and
    (o.supplier_business_id=$2 or (o.retailer_business_id=$2 and o.status<>'draft' and exists
      (select 1 from public.retailer_links l where l.supplier_business_id=o.supplier_business_id and l.retailer_business_id=$2 and l.status='active')))
    ${lock ? 'for update of o' : ''}`, [orderId, seller.id]);
  return { viewer: seller, order: ensureRow(result.rows[0], 'Order') };
}
async function detailedOrder(client: PoolClient, userId: string, orderId: string) {
  const { viewer, order } = await orderAccess(client, userId, orderId);
  const lines = await client.query('select * from public.order_lines where order_id=$1 order by position', [orderId]);
  const contact = await client.query('select name from public.retailer_contacts where id=$1', [order.retailer_contact_id]);
  return { order: { ...serialize(order), retailer_name: contact.rows[0]?.name ?? null },
    lines: lines.rows.map(serialize), can_edit: viewer.id === order.supplier_business_id };
}

async function saveOrder(client: PoolClient, userId: string, data: OrderInput, orderId?: string) {
  const seller = await business(client, userId, 'supplier');
  const contact = ensureRow((await client.query(`select * from public.retailer_contacts where id=$1 and supplier_business_id=$2 and archived_at is null`,
    [data.retailer_contact_id, seller.id])).rows[0], 'Contact') as Record<string, string | null>;
  if (!seller.state) throw new CommerceError(400, 'Set the supplier state in your business profile first');
  let retailerId: string | null = null;
  if (contact.retailer_business_id) {
    const linked = await client.query(`select 1 from public.retailer_links where supplier_business_id=$1 and retailer_business_id=$2 and status='active'`,
      [seller.id, contact.retailer_business_id]);
    if (linked.rows[0]) retailerId = contact.retailer_business_id;
  }
  const mode: TaxMode = !seller.gstin ? 'none' : normalizeState(seller.state) === normalizeState(data.place_of_supply_state) ? 'intra' : 'inter';
  const calculated = [];
  for (const [position, entry] of data.lines.entries()) {
    if (entry.source === 'one_off') {
      let bill: ReturnType<typeof calculateLine>;
      try {
        bill = calculateLine({ quantity_milli: entry.quantity_milli, rate_paise: entry.rate_paise,
          discount_bps: entry.discount_bps, gst_rate_bps: mode === 'none' ? 0 : entry.gst_rate_bps }, mode);
      } catch (error) { throw new CommerceError(400, error instanceof Error ? error.message : 'Invalid bill amount'); }
      calculated.push({ ...bill, position, source: 'one_off', product_id: null, product_unit_id: null,
        product_name: entry.product_name, sku: null, hsn_code: entry.hsn_code ?? null, unit_name: entry.unit_name,
        stock_factor_milli: 1000, instructions: entry.instructions ?? null });
      continue;
    }
    const unit = ensureRow((await client.query(`select u.*,p.name product_name,p.sku,p.hsn_code,p.gst_rate_bps,p.id product_id
      from public.product_units u join public.products p on p.id=u.product_id
      where u.id=$1 and u.active=true and p.archived_at is null and p.supplier_business_id=$2`,
      [entry.product_unit_id, seller.id])).rows[0], 'Active product unit');
    const override = await client.query('select price_paise from public.retailer_prices where retailer_contact_id=$1 and product_unit_id=$2',
      [contact.id, entry.product_unit_id]);
    const rate = entry.rate_paise ?? Number(override.rows[0]?.price_paise ?? unit.standard_price_paise);
    let bill: ReturnType<typeof calculateLine>;
    try {
      bill = calculateLine({ quantity_milli: entry.quantity_milli, rate_paise: rate,
        discount_bps: entry.discount_bps, gst_rate_bps: mode === 'none' ? 0 : unit.gst_rate_bps }, mode);
    } catch (error) {
      throw new CommerceError(400, error instanceof Error ? error.message : 'Invalid bill amount');
    }
    calculated.push({ ...bill, position, source: 'catalog', product_id: unit.product_id, product_unit_id: unit.id, product_name: unit.product_name,
      sku: unit.sku, hsn_code: unit.hsn_code, unit_name: unit.unit_name, stock_factor_milli: Number(unit.stock_factor_milli), instructions: entry.instructions ?? null });
  }
  let totals: ReturnType<typeof sumBill>;
  try { totals = sumBill(calculated); }
  catch (error) { throw new CommerceError(400, error instanceof Error ? error.message : 'Invalid bill total'); }
  if (data.expected_total_paise !== undefined && totals.total_paise !== data.expected_total_paise) {
    throw new CommerceError(409, 'Bill amount changed since preview. Review the updated quote before saving.');
  }
  let idValue = orderId;
  if (orderId) {
    const order = ensureRow((await client.query('select * from public.orders where id=$1 and supplier_business_id=$2 for update', [orderId, seller.id])).rows[0], 'Order');
    if (order.status !== 'draft') throw new CommerceError(409, 'Only draft orders can be edited');
    if (Number(order.paid_paise) > totals.total_paise) throw new CommerceError(400, 'Paid amount exceeds the revised total');
    await client.query('delete from public.order_lines where order_id=$1', [orderId]);
    await client.query(`update public.orders set retailer_contact_id=$2,retailer_business_id=$3,place_of_supply_state=$4,tax_mode=$5,instructions=$6,
      subtotal_paise=$7,discount_paise=$8,taxable_paise=$9,cgst_paise=$10,sgst_paise=$11,igst_paise=$12,total_paise=$13 where id=$1`,
      [orderId, contact.id, retailerId, data.place_of_supply_state, mode, data.instructions ?? null, ...Object.values(totals)]);
  } else {
    const created = await client.query(`insert into public.orders(supplier_business_id,retailer_contact_id,retailer_business_id,place_of_supply_state,tax_mode,
      instructions,subtotal_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [seller.id, contact.id, retailerId, data.place_of_supply_state, mode, data.instructions ?? null, ...Object.values(totals)]);
    idValue = created.rows[0].id;
  }
  for (const line of calculated) {
    await client.query(`insert into public.order_lines(order_id,product_id,product_unit_id,product_name,sku,hsn_code,unit_name,quantity_milli,
      stock_factor_milli,rate_paise,discount_bps,gst_rate_bps,gross_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,
      total_paise,instructions,position,source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [idValue, line.product_id, line.product_unit_id, line.product_name, line.sku, line.hsn_code, line.unit_name, line.quantity_milli,
        line.stock_factor_milli, line.rate_paise, line.discount_bps, line.gst_rate_bps, line.gross_paise, line.discount_paise,
        line.taxable_paise, line.cgst_paise, line.sgst_paise, line.igst_paise, line.total_paise, line.instructions, line.position, line.source]);
  }
  return idValue!;
}

commerceRouter.get('/orders', handler(async (request, response) => {
  const client = await ready().connect();
  try {
    const viewer = ensureRow((await client.query('select * from public.businesses where owner_id=$1', [authId(response)])).rows[0], 'Business');
    const orders = await client.query(`select o.*,c.name retailer_name,b.name supplier_name from public.orders o
      join public.retailer_contacts c on c.id=o.retailer_contact_id join public.businesses b on b.id=o.supplier_business_id
      where ${viewer.kind === 'supplier' ? 'o.supplier_business_id=$1' : `o.retailer_business_id=$1 and o.status<>'draft' and exists
        (select 1 from public.retailer_links l where l.supplier_business_id=o.supplier_business_id and l.retailer_business_id=$1 and l.status='active')`}
      order by o.created_at desc limit 300`, [viewer.id]);
    response.json({ orders: orders.rows.map(serialize) });
  } finally { client.release(); }
}));
commerceRouter.post('/orders', handler(async (request, response) => {
  const data = parse(orderSchema, request.body);
  const orderId = await transaction((client) => saveOrder(client, authId(response), data));
  response.status(201).json({ order: orderId });
}));
commerceRouter.post('/orders/quote', handler(async (request, response) => {
  const data = parse(orderSchema, request.body);
  const client = await ready().connect();
  try {
    await client.query('begin');
    const orderId = await saveOrder(client, authId(response), data);
    const quoted = (await client.query(`select subtotal_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,tax_mode
      from public.orders where id=$1`, [orderId])).rows[0];
    const lines = await client.query(`select position,gst_rate_bps,gross_paise,discount_paise,taxable_paise,
      cgst_paise,sgst_paise,igst_paise,total_paise from public.order_lines where order_id=$1 order by position`, [orderId]);
    await client.query('rollback');
    response.json({ quote: { ...serialize(quoted), lines: lines.rows.map(serialize) } });
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}));
commerceRouter.get('/orders/:id', handler(async (request, response) => {
  const orderId = parse(id, request.params.id);
  const client = await ready().connect();
  try { response.json(await detailedOrder(client, authId(response), orderId)); }
  finally { client.release(); }
}));
commerceRouter.get('/orders/:id/deliveries', handler(async (request, response) => {
  const orderId = parse(id, request.params.id);
  const client = await ready().connect();
  try {
    const seller = await business(client, authId(response), 'supplier');
    ensureRow((await client.query('select id from public.orders where id=$1 and supplier_business_id=$2', [orderId, seller.id])).rows[0], 'Order');
    const deliveries = await client.query(`select d.id,d.order_id,d.recipient_retailer_business_id,d.document_kind,d.sent_at,
      b.name recipient_name from public.bill_deliveries d join public.businesses b on b.id=d.recipient_retailer_business_id
      where d.order_id=$1 order by d.sent_at desc`, [orderId]);
    response.json({ deliveries: deliveries.rows });
  } finally { client.release(); }
}));
commerceRouter.post('/orders/:id/deliveries', handler(async (request, response) => {
  const orderId = parse(id, request.params.id);
  const data = parse(sendBillSchema, request.body);
  const delivery = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    const order = ensureRow((await client.query('select * from public.orders where id=$1 and supplier_business_id=$2',
      [orderId, seller.id])).rows[0], 'Order');
    if (order.status === 'draft') throw new CommerceError(409, 'Confirm the order before sending its PDF');
    if (data.document_kind === 'invoice' && order.status !== 'invoiced') throw new CommerceError(409, 'Issue the tax invoice before sending it');
    if (data.recipient_business_id !== order.retailer_business_id && !data.acknowledge_other_recipient) {
      throw new CommerceError(400, 'Acknowledge that this PDF names a different retailer before sending a copy');
    }
    const linked = await client.query(`select 1 from public.retailer_links where supplier_business_id=$1
      and retailer_business_id=$2 and status='active'`, [seller.id, data.recipient_business_id]);
    if (!linked.rows[0]) throw new CommerceError(403, 'Choose an actively connected retailer');
    const inserted = await client.query(`insert into public.bill_deliveries(order_id,recipient_retailer_business_id,document_kind)
      values($1,$2,$3) on conflict(order_id,recipient_retailer_business_id,document_kind) do nothing returning id,sent_at`,
    [orderId, data.recipient_business_id, data.document_kind]);
    const found = inserted.rows[0] ?? ensureRow((await client.query(`select id,sent_at from public.bill_deliveries
      where order_id=$1 and recipient_retailer_business_id=$2 and document_kind=$3`,
    [orderId, data.recipient_business_id, data.document_kind])).rows[0], 'Delivery');
    return { ...found, already_sent: !inserted.rows[0] };
  });
  response.status(delivery.already_sent ? 200 : 201).json({ delivery });
}));
commerceRouter.get('/deliveries', handler(async (_request, response) => {
  const client = await ready().connect();
  try {
    const retailer = await business(client, authId(response), 'retailer');
    const deliveries = await client.query(`select d.id,d.order_id,d.document_kind,d.sent_at,o.total_paise,
      o.invoice_number,b.name supplier_name,c.name billed_to_name
      from public.bill_deliveries d join public.orders o on o.id=d.order_id
      join public.businesses b on b.id=o.supplier_business_id
      join public.retailer_contacts c on c.id=o.retailer_contact_id
      where d.recipient_retailer_business_id=$1 and exists (select 1 from public.retailer_links l
        where l.supplier_business_id=o.supplier_business_id and l.retailer_business_id=$1 and l.status='active')
      order by d.sent_at desc limit 300`, [retailer.id]);
    response.json({ deliveries: deliveries.rows.map(serialize) });
  } finally { client.release(); }
}));
commerceRouter.get('/deliveries/:id/pdf', handler(async (request, response) => {
  const deliveryId = parse(id, request.params.id);
  const client = await ready().connect();
  try {
    const retailer = await business(client, authId(response), 'retailer');
    const row = ensureRow((await client.query(`select d.document_kind,o.id order_id,o.invoice_number,
      o.confirmation_snapshot,o.invoice_snapshot from public.bill_deliveries d
      join public.orders o on o.id=d.order_id where d.id=$1 and d.recipient_retailer_business_id=$2
      and exists (select 1 from public.retailer_links l where l.supplier_business_id=o.supplier_business_id
        and l.retailer_business_id=$2 and l.status='active')`, [deliveryId, retailer.id])).rows[0], 'Bill');
    const snapshot = row.document_kind === 'invoice' ? row.invoice_snapshot : row.confirmation_snapshot;
    if (!snapshot) throw new CommerceError(409, 'This PDF is not available');
    response.type('application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${row.document_kind === 'invoice'
      ? 'invoice-' + row.invoice_number.replaceAll('/', '-') : 'order-' + row.order_id}.pdf"`);
    response.send(Buffer.from(await renderOrderPdf(snapshot)));
  } finally { client.release(); }
}));
commerceRouter.put('/orders/:id', handler(async (request, response) => {
  const orderId = parse(id, request.params.id), data = parse(orderSchema, request.body);
  await transaction((client) => saveOrder(client, authId(response), data, orderId));
  response.json({ order: orderId });
}));
commerceRouter.post('/orders/:id/confirm', handler(async (request, response) => {
  const orderId = parse(id, request.params.id);
  await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    const order = ensureRow((await client.query('select * from public.orders where id=$1 and supplier_business_id=$2 for update', [orderId, seller.id])).rows[0], 'Order');
    if (order.status !== 'draft') throw new CommerceError(409, 'Order is already confirmed');
    const lines = await client.query(`select l.*,p.archived_at,u.active from public.order_lines l
      left join public.products p on p.id=l.product_id left join public.product_units u on u.id=l.product_unit_id
      where l.order_id=$1 order by l.position`, [orderId]);
    if (!lines.rows.length) throw new CommerceError(400, 'Add at least one line');
    for (const line of lines.rows) {
      if (line.source === 'one_off') {
        if (seller.gstin && !line.hsn_code) throw new CommerceError(400,
          `Set an HSN code for the one-off item ${line.product_name}, then update this draft before confirming`);
        continue;
      }
      if (line.archived_at || !line.active) throw new CommerceError(400, `${line.product_name} is archived or its unit is inactive`);
      if (seller.gstin && !line.hsn_code) throw new CommerceError(400, `Set an HSN code for ${line.product_name}, then update this draft before confirming`);
      const units = BigInt(line.quantity_milli) * BigInt(line.stock_factor_milli);
      const required = (units + 999n) / 1000n;
      const updated = await client.query(`update public.products set stock_quantity_milli=stock_quantity_milli-$1
        where id=$2 and supplier_business_id=$3 and (stock_quantity_milli is null or stock_quantity_milli >= $1) returning id`,
        [String(required), line.product_id, seller.id]);
      if (!updated.rows[0]) throw new CommerceError(409, `Insufficient stock for ${line.product_name}`);
    }
    const confirmedAt = new Date();
    const contact = ensureRow((await client.query('select * from public.retailer_contacts where id=$1', [order.retailer_contact_id])).rows[0], 'Contact');
    const snapshot = { supplier: seller, retailer: contact, order: { ...order, status: 'confirmed', confirmed_at: confirmedAt.toISOString() },
      lines: lines.rows.map(({ archived_at: _archived, active: _active, ...line }) => line) };
    await client.query(`update public.orders set status='confirmed',confirmed_at=$2,confirmation_snapshot=$3 where id=$1`,
      [orderId, confirmedAt, JSON.stringify(snapshot)]);
  });
  response.json({ confirmed: true });
}));
commerceRouter.post('/orders/:id/invoice', handler(async (request, response) => {
  const orderId = parse(id, request.params.id);
  const invoiceNumber = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    const order = ensureRow((await client.query('select * from public.orders where id=$1 and supplier_business_id=$2 for update', [orderId, seller.id])).rows[0], 'Order');
    if (order.status !== 'confirmed') throw new CommerceError(409, 'Confirm the order before issuing an invoice');
    const expectedMode: TaxMode = !seller.gstin ? 'none' : normalizeState(seller.state ?? '') === normalizeState(order.place_of_supply_state) ? 'intra' : 'inter';
    if (expectedMode !== order.tax_mode || order.tax_mode === 'none') throw new CommerceError(400, 'Supplier GST details changed after confirmation; create a new order with the correct tax calculation');
    const contact = ensureRow((await client.query('select * from public.retailer_contacts where id=$1', [order.retailer_contact_id])).rows[0], 'Contact');
    if (!seller.gstin || !seller.state || !seller.address_line1 || !seller.postal_code) throw new CommerceError(400, 'Complete the supplier GSTIN, state, address and postal code before issuing a tax invoice');
    if (!contact.address_line1 || !contact.state || !contact.postal_code) throw new CommerceError(400, 'Complete the retailer address, state and postal code before issuing a tax invoice');
    const lines = (await client.query('select * from public.order_lines where order_id=$1 order by position', [orderId])).rows;
    if (lines.some((line) => !line.hsn_code)) throw new CommerceError(400, 'Set an HSN code for every product before creating the order');
    const issuedAt = new Date();
    const fy = financialYear(issuedAt);
    const counter = await client.query(`insert into public.invoice_counters(supplier_business_id,financial_year,last_number) values($1,$2,1)
      on conflict(supplier_business_id,financial_year) do update set last_number=public.invoice_counters.last_number+1 returning last_number`, [seller.id, fy]);
    const number = `BV/${fy}/${String(counter.rows[0].last_number).padStart(6, '0')}`;
    const snapshot = { supplier: seller, retailer: contact, order: { ...order, status: 'invoiced', invoice_number: number,
      invoice_issued_at: issuedAt.toISOString() }, lines };
    await client.query(`update public.orders set status='invoiced',invoice_number=$2,invoice_issued_at=$3,invoice_snapshot=$4 where id=$1`,
      [orderId, number, issuedAt, JSON.stringify(snapshot)]);
    return number;
  });
  response.json({ invoice_number: invoiceNumber });
}));
commerceRouter.patch('/orders/:id/payment', handler(async (request, response) => {
  const orderId = parse(id, request.params.id);
  const { paid_paise } = parse(z.object({ paid_paise: money }).strict(), request.body);
  const payment = await transaction(async (client) => {
    const seller = await business(client, authId(response), 'supplier');
    const order = ensureRow((await client.query('select * from public.orders where id=$1 and supplier_business_id=$2 for update', [orderId, seller.id])).rows[0], 'Order');
    if (order.status === 'draft') throw new CommerceError(400, 'Confirm the order first');
    if (paid_paise > Number(order.total_paise)) throw new CommerceError(400, 'Paid amount exceeds total');
    const status = paid_paise === 0 ? 'unpaid' : paid_paise === Number(order.total_paise) ? 'paid' : 'partial';
    await client.query('update public.orders set paid_paise=$2,payment_status=$3 where id=$1', [orderId, paid_paise, status]);
    return status;
  });
  response.json({ payment_status: payment });
}));
commerceRouter.get('/orders/:id/pdf', handler(async (request, response) => {
  const orderId = parse(id, request.params.id);
  const requested = request.query.document === undefined ? null : parse(documentKind, request.query.document);
  const client = await ready().connect();
  try {
    const { order } = await orderAccess(client, authId(response), orderId);
    if (order.status === 'draft') throw new CommerceError(400, 'Confirm the order before downloading a PDF');
    const kind = requested ?? (order.status === 'invoiced' ? 'invoice' : 'confirmation');
    if (kind === 'invoice' && order.status !== 'invoiced') throw new CommerceError(409, 'Issue the tax invoice first');
    const snapshot = kind === 'invoice' ? order.invoice_snapshot : order.confirmation_snapshot;
    if (!snapshot) throw new CommerceError(409, 'This PDF is not available');
    const bytes = await renderOrderPdf(snapshot);
    response.type('application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${kind === 'invoice' ? 'invoice-' + order.invoice_number.replaceAll('/', '-') : 'order-' + orderId}.pdf"`);
    response.send(Buffer.from(bytes));
  } finally { client.release(); }
}));
