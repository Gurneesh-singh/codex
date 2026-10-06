import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { pool } from '../backend/dist/database/pool.js';
import { commerceRouter } from '../backend/dist/routes/commerce.js';

if (!pool) throw new Error('Set DATABASE_URL before running the commerce API verification');
const db = await pool.connect();
const originalQuery = db.query.bind(db);
const originalConnect = pool.connect.bind(pool);
const originalRelease = db.release.bind(db);
const supplierUser = randomUUID(), retailerUser = randomUUID(), otherRetailerUser = randomUUID(), outsiderUser = randomUUID();
let activeUser = supplierUser;
let server;
let baseUrl;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${baseUrl}/commerce${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (new URL(response.url).pathname.endsWith('/pdf') && response.ok) return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  return { status: response.status, data: await response.json() };
}
try {
  await originalQuery('begin');
  for (const user of [supplierUser, retailerUser, otherRetailerUser, outsiderUser]) {
    await originalQuery(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,
      [user, `commerce-api-${user}@example.invalid`]);
  }
  const supplier = (await originalQuery(`insert into public.businesses(owner_id,kind,name,state,gstin,address_line1,postal_code)
    values($1,'supplier','API Supplier','Delhi','07AAAAA0000A1Z5','1 Test Street','110001') returning id`, [supplierUser])).rows[0].id;
  const retailer = (await originalQuery(`insert into public.businesses(owner_id,kind,name,state,address_line1,postal_code)
    values($1,'retailer','API Retailer','Delhi','2 Test Street','110002') returning id`, [retailerUser])).rows[0].id;
  const otherRetailer = (await originalQuery(`insert into public.businesses(owner_id,kind,name,state,address_line1,postal_code)
    values($1,'retailer','Other API Retailer','Delhi','3 Test Street','110003') returning id`, [otherRetailerUser])).rows[0].id;
  await originalQuery(`insert into public.retailer_links(supplier_business_id,retailer_business_id,status) values($1,$2,'active')`, [supplier, retailer]);
  await originalQuery(`insert into public.retailer_links(supplier_business_id,retailer_business_id,status) values($1,$2,'active')`, [supplier, otherRetailer]);
  // Keep all API writes inside this one transaction. Route-level BEGIN/COMMIT use a savepoint.
  db.query = (statement, params) => {
    if (typeof statement === 'string') {
      const command = statement.trim().toLowerCase();
      if (command === 'begin') return originalQuery('savepoint commerce_request');
      if (command === 'commit') return originalQuery('release savepoint commerce_request');
      if (command === 'rollback') return originalQuery('rollback to savepoint commerce_request');
    }
    return originalQuery(statement, params);
  };
  db.release = () => {};
  pool.connect = async () => db;
  const app = express();
  app.use(express.json());
  app.use((_, response, next) => { response.locals.account = { user: { id: activeUser } }; next(); });
  app.use('/commerce', commerceRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  let result = await api('/products', 'POST', { name: 'API Rice', sku: 'API-RICE', aliases: ['chawal'], packaging: 'bag', hsn_code: '1006',
    gst_rate_bps: 1800, stock_quantity_milli: 10000, units: [{ unit_name: 'bag', standard_price_paise: 10000, stock_factor_milli: 1000, active: true }] });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const productId = result.data.product.id;
  result = await api(`/products/${productId}/aliases`, 'POST', { alias: 'चावल' });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.aliases, ['chawal', 'चावल']);
  result = await api(`/products/${productId}/aliases`, 'POST', { alias: ' चावल ' });
  assert.deepEqual(result.data.aliases, ['chawal', 'चावल']);
  assert.equal((await api('/products?search=चावल')).data.products.length, 1);
  const otherProduct = await api('/products', 'POST', { name: 'API Sugar', sku: null, aliases: [], packaging: null, hsn_code: null,
    gst_rate_bps: 0, stock_quantity_milli: null, units: [{ unit_name: 'kg', standard_price_paise: 10000, stock_factor_milli: 1000, active: true }] });
  assert.equal(otherProduct.status, 201, JSON.stringify(otherProduct.data));
  assert.equal((await api(`/products/${productId}/aliases`, 'POST', { alias: 'API Sugar' })).status, 409);
  result = await api('/products?search=chawal');
  assert.equal(result.data.products.length, 1);
  const unitId = result.data.products[0].units[0].id;
  result = await api('/contacts', 'POST', { name: 'API Retailer', retailer_business_id: retailer, state: 'Delhi',
    address_line1: '2 Test Street', postal_code: '110002' });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const contactId = result.data.contact.id;
  result = await api(`/contacts/${contactId}/prices`, 'PUT', { product_unit_id: unitId, price_paise: 9000 });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const orderInput = { retailer_contact_id: contactId, place_of_supply_state: 'Delhi', instructions: 'Deliver before noon',
    lines: [{ product_unit_id: unitId, quantity_milli: 1250, discount_bps: 1000 }] };
  result = await api('/orders/quote', 'POST', orderInput);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.quote.total_paise, 11947);
  assert.equal(result.data.quote.lines.length, 1);
  assert.equal(result.data.quote.lines[0].gross_paise, 11250);
  assert.equal(result.data.quote.lines[0].discount_paise, 1125);
  assert.equal(result.data.quote.lines[0].total_paise, 11947);
  assert.equal((await originalQuery('select count(*) from public.orders where supplier_business_id=$1', [supplier])).rows[0].count, '0');
  result = await api('/orders', 'POST', orderInput);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const orderId = result.data.order;
  result = await api(`/orders/${orderId}`);
  assert.equal(result.data.order.total_paise, 11947);
  assert.equal(result.data.lines[0].rate_paise, 9000);
  activeUser = retailerUser;
  assert.equal((await api('/products')).status, 403);
  assert.equal((await api(`/products/${productId}/aliases`, 'POST', { alias: 'unauthorized' })).status, 403);
  assert.equal((await api('/orders')).data.orders.length, 0);
  assert.equal((await api(`/orders/${orderId}`)).status, 404);
  assert.equal((await api('/deliveries')).data.deliveries.length, 0);
  activeUser = supplierUser;
  assert.equal((await api(`/orders/${orderId}/confirm`, 'POST')).status, 200);
  assert.equal(Number((await originalQuery('select stock_quantity_milli from public.products where id=$1', [productId])).rows[0].stock_quantity_milli), 8750);
  result = await api(`/orders/${orderId}/pdf`);
  assert.equal(result.status, 200);
  assert.equal(Buffer.from(result.bytes).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await api(`/orders/${orderId}/pdf?document=invoice`)).status, 409);
  result = await api(`/orders/${orderId}/deliveries`, 'POST', { recipient_business_id: retailer, document_kind: 'confirmation', acknowledge_other_recipient: false });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const buyerDelivery = result.data.delivery.id;
  assert.equal((await api(`/orders/${orderId}/deliveries`, 'POST', { recipient_business_id: otherRetailer,
    document_kind: 'confirmation', acknowledge_other_recipient: false })).status, 400);
  result = await api(`/orders/${orderId}/deliveries`, 'POST', { recipient_business_id: otherRetailer,
    document_kind: 'confirmation', acknowledge_other_recipient: true });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const otherDelivery = result.data.delivery.id;
  result = await api(`/orders/${orderId}/deliveries`, 'POST', { recipient_business_id: otherRetailer,
    document_kind: 'confirmation', acknowledge_other_recipient: true });
  assert.equal(result.status, 200);
  assert.equal(result.data.delivery.already_sent, true);
  assert.equal((await api(`/orders/${orderId}/deliveries`)).data.deliveries.length, 2);
  activeUser = retailerUser;
  assert.equal((await api('/orders')).data.orders.length, 1);
  assert.equal((await api(`/orders/${orderId}`)).data.order.status, 'confirmed');
  assert.equal((await api(`/orders/${orderId}/invoice`, 'POST')).status, 403);
  assert.equal((await api('/deliveries')).data.deliveries.length, 1);
  assert.equal((await api(`/deliveries/${buyerDelivery}/pdf`)).status, 200);
  assert.equal((await api(`/deliveries/${otherDelivery}/pdf`)).status, 404);
  activeUser = otherRetailerUser;
  assert.equal((await api('/orders')).data.orders.length, 0);
  assert.equal((await api(`/orders/${orderId}`)).status, 404);
  assert.equal((await api('/deliveries')).data.deliveries.length, 1);
  assert.equal((await api(`/deliveries/${otherDelivery}/pdf`)).status, 200);
  assert.equal((await api(`/deliveries/${buyerDelivery}/pdf`)).status, 404);
  activeUser = outsiderUser;
  assert.equal((await api('/deliveries')).status, 403);
  assert.equal((await api(`/deliveries/${otherDelivery}/pdf`)).status, 403);
  activeUser = supplierUser;
  result = await api(`/orders/${orderId}/invoice`, 'POST');
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.match(result.data.invoice_number, /^BV\/\d{4}-\d{2}\/000001$/);
  result = await api(`/orders/${orderId}/pdf?document=confirmation`);
  assert.equal(result.status, 200);
  result = await api(`/orders/${orderId}/pdf?document=invoice`);
  assert.equal(result.status, 200);
  result = await api(`/orders/${orderId}/deliveries`, 'POST', { recipient_business_id: otherRetailer,
    document_kind: 'invoice', acknowledge_other_recipient: true });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  activeUser = otherRetailerUser;
  assert.equal((await api('/deliveries')).data.deliveries.length, 2);
  assert.equal((await api(`/deliveries/${result.data.delivery.id}/pdf`)).status, 200);
  activeUser = supplierUser;
  assert.equal((await api(`/orders/${orderId}/payment`, 'PATCH', { paid_paise: 5000 })).status, 200);
  result = await api(`/orders/${orderId}`);
  assert.equal(result.data.order.payment_status, 'partial');
  assert.equal((await api(`/orders/${orderId}/pdf`)).status, 200);
  const oneOffInput = { retailer_contact_id: contactId, place_of_supply_state: 'Delhi', instructions: null,
    lines: [{ source: 'one_off', product_name: 'बासमती', unit_name: 'kg', quantity_milli: 4000,
      rate_paise: 9000, discount_bps: 0, gst_rate_bps: 500, hsn_code: null, instructions: null }] };
  result = await api('/orders/quote', 'POST', oneOffInput);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.quote.total_paise, 37800);
  result = await api('/orders', 'POST', oneOffInput);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const oneOffOrderId = result.data.order;
  result = await api(`/orders/${oneOffOrderId}`);
  assert.equal(result.data.lines[0].source, 'one_off');
  assert.equal(result.data.lines[0].product_id, null);
  assert.equal((await api(`/orders/${oneOffOrderId}/confirm`, 'POST')).status, 400);
  oneOffInput.lines[0].hsn_code = '1006';
  assert.equal((await api(`/orders/${oneOffOrderId}`, 'PUT', oneOffInput)).status, 200);
  assert.equal((await api(`/orders/${oneOffOrderId}/confirm`, 'POST')).status, 200);
  assert.equal(Number((await originalQuery('select stock_quantity_milli from public.products where id=$1', [productId])).rows[0].stock_quantity_milli), 8750);
  result = await api(`/orders/${oneOffOrderId}/pdf?document=confirmation`);
  assert.equal(result.status, 200);
  assert.equal(Buffer.from(result.bytes).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await api(`/orders/${oneOffOrderId}/invoice`, 'POST')).status, 200);
  assert.equal((await api(`/orders/${oneOffOrderId}/pdf?document=invoice`)).status, 200);
  console.log('PASS: alias addition and conflicts, quote lines, one-off inventory choice, PDFs, retailer delivery, stock and payment API');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.query = originalQuery;
  pool.connect = originalConnect;
  db.release = originalRelease;
  await originalQuery('rollback');
  originalRelease();
  await pool.end();
}
