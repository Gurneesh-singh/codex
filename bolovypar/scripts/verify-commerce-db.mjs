import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: { ca: readFileSync(new URL('../backend/certs/supabase-root-2021.crt', import.meta.url), 'utf8'), rejectUnauthorized: true },
  connectionTimeoutMillis: 10000 });
const db = await pool.connect();
async function expectDenied(sql, params = []) {
  await db.query('savepoint expected_failure');
  let failed = false;
  try { await db.query(sql, params); } catch { failed = true; }
  await db.query('rollback to savepoint expected_failure');
  assert.equal(failed, true, `Expected rejection: ${sql}`);
}
async function count(table, id) { return Number((await db.query(`select count(*) from public.${table} where id=$1`, [id])).rows[0].count); }
const supplierUser = randomUUID(), retailerUser = randomUUID(), otherRetailerUser = randomUUID(), outsiderUser = randomUUID();

try {
  await db.query('begin');
  for (const user of [supplierUser, retailerUser, otherRetailerUser, outsiderUser]) {
    await db.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,
      [user, `commerce-${user}@example.invalid`]);
  }
  const supplier = (await db.query(`insert into public.businesses(owner_id,kind,name,state,gstin,address_line1,postal_code)
    values($1,'supplier','Test Supplier','Delhi','07AAAAA0000A1Z5','1 Test Street','110001') returning id`, [supplierUser])).rows[0].id;
  const retailer = (await db.query(`insert into public.businesses(owner_id,kind,name,state,address_line1,postal_code)
    values($1,'retailer','Test Retailer','Delhi','2 Test Street','110002') returning id`, [retailerUser])).rows[0].id;
  const otherRetailer = (await db.query(`insert into public.businesses(owner_id,kind,name,state,address_line1,postal_code)
    values($1,'retailer','Other Test Retailer','Delhi','3 Test Street','110003') returning id`, [otherRetailerUser])).rows[0].id;
  await db.query(`insert into public.retailer_links(supplier_business_id,retailer_business_id,status) values($1,$2,'active')`, [supplier, retailer]);
  await db.query(`insert into public.retailer_links(supplier_business_id,retailer_business_id,status) values($1,$2,'active')`, [supplier, otherRetailer]);
  const product = (await db.query(`insert into public.products(supplier_business_id,name,sku,hsn_code,gst_rate_bps,stock_quantity_milli)
    values($1,'Test Rice','M3-RICE','1006',1800,10000) returning id`, [supplier])).rows[0].id;
  const unit = (await db.query(`insert into public.product_units(product_id,unit_name,standard_price_paise)
    values($1,'bag',10000) returning id`, [product])).rows[0].id;
  const contact = (await db.query(`insert into public.retailer_contacts(supplier_business_id,retailer_business_id,name,state,address_line1,postal_code)
    values($1,$2,'Test Retailer','Delhi','2 Test Street','110002') returning id`, [supplier, retailer])).rows[0].id;
  await db.query(`insert into public.retailer_prices(retailer_contact_id,product_unit_id,price_paise) values($1,$2,9000)`, [contact, unit]);
  const draft = (await db.query(`insert into public.orders(supplier_business_id,retailer_contact_id,retailer_business_id,place_of_supply_state,tax_mode,
    subtotal_paise,taxable_paise,cgst_paise,sgst_paise,total_paise) values($1,$2,$3,'Delhi','intra',9000,9000,810,810,10620) returning id`,
    [supplier, contact, retailer])).rows[0].id;
  const line = (await db.query(`insert into public.order_lines(order_id,product_id,product_unit_id,product_name,hsn_code,unit_name,
    quantity_milli,stock_factor_milli,rate_paise,gross_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,position)
    values($1,$2,$3,'Test Rice','1006','bag',1000,1000,9000,9000,0,9000,810,810,0,10620,0) returning id`,
    [draft, product, unit])).rows[0].id;
  const oneOffLine = (await db.query(`insert into public.order_lines(order_id,source,product_name,hsn_code,unit_name,
    quantity_milli,stock_factor_milli,rate_paise,gst_rate_bps,gross_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,position)
    values($1,'one_off','One-off basmati','1006','kg',1000,1000,9000,500,9000,0,9000,225,225,0,9450,1) returning id`,
    [draft])).rows[0].id;
  await expectDenied(`insert into public.order_lines(order_id,source,product_id,product_name,unit_name,quantity_milli,stock_factor_milli,
    rate_paise,gross_paise,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,position)
    values($1,'one_off',$2,'Invalid','kg',1000,1000,9000,9000,0,9000,0,0,0,9000,2)`, [draft, product]);
  await db.query(`set local role authenticated`);
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', supplierUser]);
  assert.equal(await count('products', product), 1);
  assert.equal(await count('retailer_contacts', contact), 1);
  assert.equal(await count('orders', draft), 1);
  await expectDenied(`insert into public.products(supplier_business_id,name) values($1,'Direct write')`, [supplier]);
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', retailerUser]);
  assert.equal(await count('products', product), 0);
  assert.equal(await count('orders', draft), 0);
  assert.equal(await count('order_lines', line), 0);
  assert.equal(await count('order_lines', oneOffLine), 0);
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', outsiderUser]);
  assert.equal(await count('orders', draft), 0);
  await db.query('reset role');
  const confirmation = { supplier: { id: supplier }, retailer: { id: retailer }, lines: [{ id: line }] };
  await db.query(`update public.orders set status='confirmed',confirmed_at=now(),confirmation_snapshot=$2 where id=$1`, [draft, JSON.stringify(confirmation)]);
  const delivery = (await db.query(`insert into public.bill_deliveries(order_id,recipient_retailer_business_id,document_kind)
    values($1,$2,'confirmation') returning id`, [draft, otherRetailer])).rows[0].id;
  await expectDenied(`update public.order_lines set quantity_milli=2000 where id=$1`, [line]);
  await expectDenied(`update public.order_lines set quantity_milli=2000 where id=$1`, [oneOffLine]);
  await expectDenied(`update public.orders set total_paise=20000 where id=$1`, [draft]);
  await db.query(`set local role authenticated`);
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', retailerUser]);
  assert.equal(await count('orders', draft), 1);
  assert.equal(await count('order_lines', line), 1);
  assert.equal(await count('order_lines', oneOffLine), 1);
  assert.equal(await count('bill_deliveries', delivery), 0);
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', otherRetailerUser]);
  assert.equal(await count('orders', draft), 0);
  assert.equal(await count('bill_deliveries', delivery), 1);
  await expectDenied(`insert into public.bill_deliveries(order_id,recipient_retailer_business_id,document_kind)
    values($1,$2,'invoice')`, [draft, otherRetailer]);
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', outsiderUser]);
  assert.equal(await count('orders', draft), 0);
  assert.equal(await count('bill_deliveries', delivery), 0);
  await db.query('reset role');
  await db.query(`insert into public.invoice_counters(supplier_business_id,financial_year,last_number) values($1,'2026-27',1)`, [supplier]);
  await expectDenied(`insert into public.invoice_counters(supplier_business_id,financial_year,last_number) values($1,'2026-27',1)`, [supplier]);
  await db.query(`update public.orders set status='invoiced',invoice_number='BV/2026-27/000001',invoice_issued_at=now(),invoice_snapshot=$2 where id=$1`,
    [draft, JSON.stringify({ ...confirmation, invoice_number: 'BV/2026-27/000001' })]);
  await expectDenied(`update public.orders set invoice_number='CHANGED' where id=$1`, [draft]);
  await db.query(`update public.orders set paid_paise=5000,payment_status='partial' where id=$1`, [draft]);
  assert.equal((await db.query('select payment_status from public.orders where id=$1', [draft])).rows[0].payment_status, 'partial');
  console.log('PASS: catalog and one-off line constraints, delivery RLS, draft privacy, immutable confirmations and invoices, payment update');
} finally {
  await db.query('rollback');
  db.release();
  await pool.end();
}
