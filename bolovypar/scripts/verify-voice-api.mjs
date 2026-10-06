import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { pool } from '../backend/dist/database/pool.js';
import { voiceRouter } from '../backend/dist/routes/voice.js';
import { commerceRouter } from '../backend/dist/routes/commerce.js';

if (!pool || !process.env.SARVAM_API_KEY || !process.env.GROQ_API_KEY) {
  throw new Error('Set DATABASE_URL, SARVAM_API_KEY and GROQ_API_KEY in backend/.env');
}
const db = await pool.connect();
const originalQuery = db.query.bind(db), originalConnect = pool.connect.bind(pool), originalRelease = db.release.bind(db);
const userId = randomUUID();
let activeUserId = userId;
let server;
try {
  await originalQuery('begin');
  await originalQuery(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,
    [userId, `voice-api-${userId}@example.invalid`]);
  const sellerId = (await originalQuery(`insert into public.businesses(owner_id,kind,name,state)
    values($1,'supplier','Voice Test Supplier','Delhi') returning id`, [userId])).rows[0].id;
  const contactId = (await originalQuery(`insert into public.retailer_contacts(supplier_business_id,name,state)
    values($1,'Sharma Stores','Delhi') returning id`, [sellerId])).rows[0].id;
  const productId = (await originalQuery(`insert into public.products(supplier_business_id,name,aliases,gst_rate_bps)
    values($1,'Amul butter',array['Amul Butter']::text[],0) returning id`, [sellerId])).rows[0].id;
  const unitId = (await originalQuery(`insert into public.product_units(product_id,unit_name,standard_price_paise,stock_factor_milli)
    values($1,'box',52000,12000) returning id`, [productId])).rows[0].id;
  db.query = (statement, params) => {
    if (typeof statement === 'string') {
      const command = statement.trim().toLowerCase();
      if (command === 'begin') return originalQuery('savepoint voice_request');
      if (command === 'commit') return originalQuery('release savepoint voice_request');
      if (command === 'rollback') return originalQuery('rollback to savepoint voice_request');
    }
    return originalQuery(statement, params);
  };
  db.release = () => {};
  pool.connect = async () => db;
  const app = express(); app.use(express.json());
  app.use((_request, response, next) => { response.locals.account = { user: { id: activeUserId } }; next(); });
  app.use('/voice', voiceRouter); app.use('/commerce', commerceRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const spoken = 'Sharma Stores wants two boxes of Amul butter at five hundred rupees per box.';
  const tts = await fetch('https://api.sarvam.ai/text-to-speech', { method: 'POST', headers: {
    'api-subscription-key': process.env.SARVAM_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: spoken, language_code: 'en-IN', model: 'bulbul:v3' }) });
  assert.equal(tts.status, 200, `Sarvam TTS returned ${tts.status}`);
  const wav = Buffer.from((await tts.json()).audios[0], 'base64');
  const rejected = new FormData(); rejected.append('audio', new Blob([wav], { type: 'audio/wav' }), 'synthetic.wav');
  let response = await fetch(`${base}/voice/process`, { method: 'POST', body: rejected });
  assert.equal(response.status, 400, 'Missing consent must be rejected');
  const form = new FormData(); form.append('consent', 'true'); form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'synthetic.wav');
  response = await fetch(`${base}/voice/process`, { method: 'POST', body: form });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.speech.provider, 'groq:whisper-large-v3-turbo');
  assert.match(result.speech.transcript.toLowerCase(), /amul butter/);
  assert.equal(result.matched.retailer_contact_id, contactId, JSON.stringify({ transcript: result.speech.transcript,
    retailer: result.extraction.retailer_name, issues: result.matched.retailer_issues }));
  assert.equal(result.matched.lines[0].product_unit_id, unitId, JSON.stringify({ transcript: result.speech.transcript,
    item: result.matched.lines[0] }));
  assert.equal(result.audio_retained, false);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (input, init) => String(input) === 'https://api.groq.com/openai/v1/audio/transcriptions'
      ? Promise.resolve(new Response('temporary error', { status: 503 })) : realFetch(input, init);
    const fallbackForm = new FormData(); fallbackForm.append('consent', 'true');
    fallbackForm.append('audio', new Blob([wav], { type: 'audio/wav' }), 'synthetic.wav');
    const fallbackResponse = await fetch(`${base}/voice/process`, { method: 'POST', body: fallbackForm });
    const fallbackResult = await fallbackResponse.json();
    assert.equal(fallbackResponse.status, 200, JSON.stringify(fallbackResult));
    assert.equal(fallbackResult.speech.provider, 'sarvam:saaras:v4');
  } finally { globalThis.fetch = realFetch; }
  const emptyCatalogUserId = randomUUID();
  await originalQuery(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,
    [emptyCatalogUserId, `voice-empty-${emptyCatalogUserId}@example.invalid`]);
  await originalQuery(`insert into public.businesses(owner_id,kind,name,state)
    values($1,'supplier','Empty Catalog Voice Test','Delhi')`, [emptyCatalogUserId]);
  activeUserId = emptyCatalogUserId;
  const emptyCatalogForm = new FormData(); emptyCatalogForm.append('consent', 'true');
  emptyCatalogForm.append('audio', new Blob([wav], { type: 'audio/wav' }), 'synthetic.wav');
  const emptyCatalogResponse = await fetch(`${base}/voice/process`, { method: 'POST', body: emptyCatalogForm });
  const emptyCatalogResult = await emptyCatalogResponse.json();
  assert.equal(emptyCatalogResponse.status, 200, JSON.stringify(emptyCatalogResult));
  assert.equal(emptyCatalogResult.matched.lines[0].product_id, null);
  assert.ok(emptyCatalogResult.matched.lines[0].rate_paise > 0, 'Spoken price must remain available for a one-off bill');
  assert.ok(emptyCatalogResult.alternative_speech?.transcript, 'Second transcription must be visible for an empty catalog');
  assert.ok(emptyCatalogResult.alternative_extraction?.items?.length, 'Second hearing must be available for item review');
  activeUserId = userId;
  const orderInput = { retailer_contact_id: contactId, place_of_supply_state: 'Delhi', instructions: null,
    lines: [{ product_unit_id: unitId, quantity_milli: 2000, rate_paise: 50000, discount_bps: 0, instructions: null }] };
  const quoteResponse = await fetch(`${base}/commerce/orders/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderInput) });
  const quoteResult = await quoteResponse.json();
  assert.equal(quoteResponse.status, 200, JSON.stringify(quoteResult));
  assert.equal(quoteResult.quote.total_paise, 100000);
  const stale = await fetch(`${base}/commerce/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...orderInput, expected_total_paise: 1 }) });
  assert.equal(stale.status, 409, await stale.text());
  assert.equal((await originalQuery('select count(*)::int count from public.orders where supplier_business_id=$1', [sellerId])).rows[0].count, 0);
  console.log('PASS: consent gate, live Whisper and Sarvam, extraction, catalog and empty-inventory pricing, quote rollback; test records rolled back');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.query = originalQuery; pool.connect = originalConnect; db.release = originalRelease;
  await originalQuery('rollback'); originalRelease(); await pool.end();
}
