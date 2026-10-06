import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { ca: readFileSync(new URL('../backend/certs/supabase-root-2021.crt', import.meta.url), 'utf8'), rejectUnauthorized: true },
  connectionTimeoutMillis: 10000
});
const db = await pool.connect();
const supplier = randomUUID();
const retailer = randomUUID();
const outsider = randomUUID();

async function asUser(id) {
  await db.query('select set_config($1,$2,true)', ['request.jwt.claim.sub', id]);
}
async function expectDenied(sql, params = []) {
  await db.query('savepoint expected_failure');
  let failed = false;
  try { await db.query(sql, params); }
  catch { failed = true; }
  await db.query('rollback to savepoint expected_failure');
  assert.equal(failed, true, `Expected rejection: ${sql}`);
}

try {
  await db.query('begin');
  for (const [id, verified] of [[supplier, true], [retailer, true], [outsider, false]]) {
    await db.query(`insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,$3,'{}','{}',now(),now())`,
      [id, `milestone2-${id}@example.invalid`, verified ? new Date() : null]);
  }
  assert.equal(Number((await db.query('select count(*) from public.profiles where id = any($1::uuid[])', [[supplier, retailer, outsider]])).rows[0].count), 3);

  await db.query('set local role authenticated');
  await asUser(outsider);
  await expectDenied('select public.onboard_business($1,$2)', ['supplier', 'Unverified']);
  await asUser(supplier);
  const supplierBusiness = (await db.query('select to_jsonb(public.onboard_business($1,$2)) as business', ['supplier', 'Test Supplier'])).rows[0].business;
  assert.equal(supplierBusiness.kind, 'supplier');
  assert.equal((await db.query('update public.profiles set display_name=$1 where id=$2 returning display_name', ['Supplier Owner', supplier])).rows[0].display_name, 'Supplier Owner');
  assert.equal((await db.query('update public.businesses set city=$1 where id=$2 returning city', ['Delhi', supplierBusiness.id])).rows[0].city, 'Delhi');
  await expectDenied('select public.onboard_business($1,$2)', ['retailer', 'Role Change']);
  await expectDenied('update public.businesses set kind=$1 where id=$2', ['retailer', supplierBusiness.id]);
  await expectDenied('insert into public.businesses(owner_id,kind,name) values($1,$2,$3)', [outsider, 'retailer', 'Forged']);

  await asUser(retailer);
  const retailerBusiness = (await db.query('select to_jsonb(public.onboard_business($1,$2)) as business', ['retailer', 'Test Retailer'])).rows[0].business;
  assert.equal(Number((await db.query('select count(*) from public.businesses')).rows[0].count), 1);
  assert.equal((await db.query('update public.profiles set display_name=$1 where id=$2 returning id', ['Forbidden', supplier])).rowCount, 0);
  await expectDenied('select public.request_retailer_link($1)', [supplierBusiness.id]);

  await asUser(supplier);
  assert.equal(Number((await db.query('select count(*) from public.businesses where id=$1', [retailerBusiness.id])).rows[0].count), 0);
  const link = (await db.query('select to_jsonb(public.request_retailer_link($1)) as link', [retailerBusiness.id])).rows[0].link;
  assert.equal(link.status, 'pending');
  assert.equal(Number((await db.query('select count(*) from public.businesses where id=$1', [retailerBusiness.id])).rows[0].count), 0);
  await expectDenied('select public.respond_retailer_link($1,true)', [link.id]);

  await asUser(retailer);
  assert.equal(Number((await db.query('select count(*) from public.businesses where id=$1', [supplierBusiness.id])).rows[0].count), 1);
  assert.equal(Number((await db.query('select count(*) from public.retailer_links where id=$1', [link.id])).rows[0].count), 1);
  const accepted = (await db.query('select to_jsonb(public.respond_retailer_link($1,true)) as link', [link.id])).rows[0].link;
  assert.equal(accepted.status, 'active');
  await asUser(supplier);
  assert.equal(Number((await db.query('select count(*) from public.businesses where id=$1', [retailerBusiness.id])).rows[0].count), 1);
  await asUser(outsider);
  assert.equal(Number((await db.query('select count(*) from public.businesses')).rows[0].count), 0);
  assert.equal(Number((await db.query('select count(*) from public.retailer_links')).rows[0].count), 0);

  console.log('PASS: profile trigger, verified onboarding, immutable role, tenant RLS, link request and approval');
} finally {
  await db.query('rollback');
  db.release();
  await pool.end();
}
