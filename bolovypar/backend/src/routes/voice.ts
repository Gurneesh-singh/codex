import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { pool } from '../database/pool.js';
import { env } from '../config/env.js';
import { extractOrder, matchExtraction, recoverVoiceFieldsWithBackup, transcribeWithFallback, type CatalogContact, type CatalogProduct } from '../services/voice.js';

export const voiceRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3 } });
const allowed = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg', 'application/ogg']);

function isAudio(buffer: Buffer) {
  if (buffer.length < 12) return false;
  const head = buffer.toString('ascii', 0, 4);
  return (head === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') || head === 'OggS' || head === 'ID3' ||
    buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ||
    buffer.toString('ascii', 4, 8) === 'ftyp' || buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0;
}
function failure(response: Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'Could not process voice sample';
  const configuration = /not configured/.test(message);
  const clientError = /audio|consent|speech was recognized/i.test(message) || error instanceof multer.MulterError;
  response.status(configuration ? 503 : clientError ? 400 : 502).json({ error: { code: configuration ? 'AI_NOT_CONFIGURED' : clientError ? 'INVALID_AUDIO' : 'AI_PROCESSING_FAILED', message } });
}

voiceRouter.post('/process', (request, response, next) => upload.single('audio')(request, response, (error) => {
  if (error) { failure(response, error); return; }
  next();
}), async (request: Request, response: Response) => {
  try {
    if (request.body.consent !== 'true') throw new Error('Explicit consent from every recorded speaker is required');
    if (!request.file || !allowed.has(request.file.mimetype) || !isAudio(request.file.buffer)) throw new Error('Upload a valid WAV, MP3, M4A, WebM, or Ogg audio file');
    if (!env.GROQ_API_KEY) throw new Error('Groq API key is not configured');
    if (!pool) throw new Error('Database is not configured');
    const client = await pool.connect();
    let products: CatalogProduct[]; let contacts: CatalogContact[];
    try {
      const userId = response.locals.account.user.id as string;
      const seller = (await client.query('select id from public.businesses where owner_id=$1 and kind=$2', [userId, 'supplier'])).rows[0];
      if (!seller) { response.status(403).json({ error: { code: 'SUPPLIER_REQUIRED', message: 'Supplier account required' } }); return; }
      const productRows = await client.query(`select p.id,p.name,p.aliases,coalesce(jsonb_agg(jsonb_build_object('id',u.id,'unit_name',u.unit_name,
        'standard_price_paise',u.standard_price_paise,'stock_factor_milli',u.stock_factor_milli,'active',u.active))
        filter (where u.id is not null),'[]'::jsonb) units from public.products p left join public.product_units u on u.product_id=p.id
        where p.supplier_business_id=$1 and p.archived_at is null group by p.id order by p.name limit 500`, [seller.id]);
      const contactRows = await client.query(`select c.id,c.name,c.state,coalesce(jsonb_agg(jsonb_build_object('product_unit_id',rp.product_unit_id,
        'price_paise',rp.price_paise)) filter (where rp.product_unit_id is not null),'[]'::jsonb) prices
        from public.retailer_contacts c left join public.retailer_prices rp on rp.retailer_contact_id=c.id
        where c.supplier_business_id=$1 and c.archived_at is null group by c.id order by c.name limit 500`, [seller.id]);
      products = productRows.rows.map((row) => ({ ...row, units: row.units.map((unit: CatalogProduct['units'][number]) => ({ ...unit,
        standard_price_paise: Number(unit.standard_price_paise), stock_factor_milli: Number(unit.stock_factor_milli) })) }));
      contacts = contactRows.rows.map((row) => ({ ...row, prices: row.prices.map((price: CatalogContact['prices'][number]) => ({ ...price,
        price_paise: Number(price.price_paise) })) }));
    } finally { client.release(); }
    const unitHints = products.length ? [...new Set(products.flatMap((product) => product.units.map((unit) => unit.unit_name)))].slice(0, 4)
      : ['लीटर', 'liter', 'किलो', 'kg'];
    const keyterms = [...unitHints, ...products.flatMap((product) => [product.name, ...product.aliases]).slice(0, 35),
      ...contacts.map((contact) => contact.name).slice(0, 10)];
    const sample = { buffer: request.file.buffer, mimeType: request.file.mimetype,
      filename: request.file.originalname.slice(0, 100) || 'sample.m4a' };
    const firstSpeech = await transcribeWithFallback(sample, keyterms);
    const firstExtraction = await extractOrder(firstSpeech.transcript);
    const { speech, extraction, recoveredRateIndices, recoveredProductIndices, replacedByBackupIndices,
      alternativeSpeech, alternativeExtraction } = env.SARVAM_API_KEY
      ? await recoverVoiceFieldsWithBackup(sample, keyterms, firstSpeech, firstExtraction, products, contacts)
      : { speech: firstSpeech, extraction: firstExtraction, recoveredRateIndices: [], recoveredProductIndices: [], replacedByBackupIndices: [],
        alternativeSpeech: null, alternativeExtraction: null };
    const matched = matchExtraction(extraction, speech.transcript, products, contacts);
    for (const index of recoveredRateIndices) matched.lines[index]?.issues.push('Price recovered from backup transcription; verify it against the audio');
    for (const index of recoveredProductIndices) matched.lines[index]?.issues.push('Product name recovered from backup transcription; verify it against the audio');
    for (const index of replacedByBackupIndices) matched.lines[index]?.issues.push('Primary transcription was incomplete; verify this item’s name, quantity, unit and price against the audio');
    response.json({ speech, alternative_speech: alternativeSpeech, alternative_extraction: alternativeExtraction, extraction, matched,
      consent_recorded_at: new Date().toISOString(), audio_retained: false });
  } catch (error) { failure(response, error); }
});
