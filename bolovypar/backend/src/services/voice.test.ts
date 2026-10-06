import assert from 'node:assert/strict';
import test from 'node:test';
import { matchExtraction, recoverVoiceFieldsWithBackup, transcribeWithFallback, whisperPrompt, type AudioSample, type Extraction, type SpeechProvider } from './voice.js';

const sample: Extraction = {
  retailer_name: 'Sharma Stores', retailer_evidence: 'Sharma Stores', instructions: null,
  items: [{ product_name: 'Amul butter', quantity: 2, unit_name: 'box', rate: 500, rate_unit: 'box',
    discount_percent: 5, instructions: null, evidence: '2 box Amul butter', confidence: 0.96, ambiguous: false }]
};
const products = [{ id: 'p1', name: 'Amul Butter', aliases: ['Amul butter'],
  units: [{ id: 'u1', unit_name: 'box', standard_price_paise: 55000, stock_factor_milli: 12000, active: true }] }];
const contacts = [{ id: 'c1', name: 'Sharma Stores', state: 'Delhi', prices: [{ product_unit_id: 'u1', price_paise: 52000 }] }];

test('Whisper is used first and Sarvam is called only when it fails', async () => {
  const audio: AudioSample = { buffer: Buffer.from('synthetic'), mimeType: 'audio/wav', filename: 'sample.wav' };
  const calls: string[] = [];
  const whisper: SpeechProvider = { async transcribe() { calls.push('whisper');
    return { transcript: 'order', language_code: 'en', provider: 'groq:whisper-large-v3-turbo' }; } };
  const sarvam: SpeechProvider = { async transcribe() { calls.push('sarvam');
    return { transcript: 'backup order', language_code: 'en-IN', provider: 'sarvam:saaras:v4' }; } };
  assert.equal((await transcribeWithFallback(audio, [], whisper, sarvam)).provider, 'groq:whisper-large-v3-turbo');
  assert.deepEqual(calls, ['whisper']);
  const brokenWhisper: SpeechProvider = { async transcribe() { calls.push('whisper'); throw new Error('upstream failed'); } };
  assert.equal((await transcribeWithFallback(audio, [], brokenWhisper, sarvam)).provider, 'sarvam:saaras:v4');
  assert.deepEqual(calls, ['whisper', 'whisper', 'sarvam']);
});

test('exact catalog and packaging match preserves the spoken rate and discount', () => {
  const result = matchExtraction(sample, 'Sharma Stores wants 2 box Amul butter at 500 rupees per box', products, contacts);
  assert.equal(result.retailer_contact_id, 'c1');
  assert.deepEqual(result.retailer_issues, []);
  assert.deepEqual(result.lines[0]?.issues, []);
  assert.equal(result.lines[0]?.product_unit_id, 'u1');
  assert.equal(result.lines[0]?.stock_factor_milli, 12000);
  assert.equal(result.lines[0]?.quantity_milli, 2000);
  assert.equal(result.lines[0]?.rate_paise, 50000);
  assert.equal(result.lines[0]?.discount_bps, 500);
});

test('missing rate uses retailer price but requires explicit review', () => {
  const result = matchExtraction({ ...sample, items: [{ ...sample.items[0]!, rate: null, rate_unit: null }] },
    'Sharma Stores wants 2 box Amul butter', products, contacts);
  assert.equal(result.lines[0]?.rate_paise, 52000);
  assert.equal(result.lines[0]?.rate_source, 'retailer');
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /Rate was not spoken/);
});

test('common spoken plurals match the catalog unit without changing its packaging factor', () => {
  const result = matchExtraction({ ...sample, items: [{ ...sample.items[0]!, unit_name: 'boxes' }] },
    'Sharma Stores wants 2 box Amul butter at 500 rupees per box', products, contacts);
  assert.equal(result.lines[0]?.product_unit_id, 'u1');
  assert.equal(result.lines[0]?.stock_factor_milli, 12000);
});

test('Hindi plural selling units match a configured Hindi catalog unit', () => {
  const item = { ...sample.items[0]!, product_name: 'अमूल मक्खन', unit_name: 'डिब्बे', rate_unit: 'डिब्बा',
    evidence: 'दो डिब्बे अमूल मक्खन' };
  const result = matchExtraction({ ...sample, retailer_name: 'शर्मा स्टोर्स', retailer_evidence: 'शर्मा स्टोर्स', items: [item] },
    'शर्मा स्टोर्स के लिए दो डिब्बे अमूल मक्खन',
    [{ ...products[0]!, aliases: ['अमूल मक्खन'], units: [{ ...products[0]!.units[0]!, unit_name: 'डिब्बा' }] }],
    [{ ...contacts[0]!, name: 'शर्मा स्टोर्स' }]);
  assert.equal(result.lines[0]?.product_unit_id, 'u1');
  assert.equal(result.lines[0]?.rate_paise, 50000);
});

test('Hindi kilo and rate per kilo match a kilogram catalog unit', () => {
  const result = matchExtraction({ ...sample, items: [{ ...sample.items[0]!, unit_name: 'किलो', rate_unit: 'प्रति किलो' }] },
    'Sharma Stores wants 2 किलो Amul butter at 500 रुपये प्रति किलो',
    [{ ...products[0]!, units: [{ ...products[0]!.units[0]!, unit_name: 'kilogram' }] }], contacts);
  assert.equal(result.lines[0]?.product_unit_id, 'u1');
  assert.equal(result.lines[0]?.rate_paise, 50000);
  assert.doesNotMatch(result.lines[0]?.issues.join(' ') ?? '', /spoken rate unit/);
});

test('Hindi and English litre spellings match one selling unit and millilitres convert safely', () => {
  const catalog = [{ id: 'oil', name: 'Cooking oil', aliases: ['तेल'], units: [{ id: 'litre', unit_name: 'litre',
    standard_price_paise: 11000, stock_factor_milli: 1000, active: true }] }];
  const item = { ...sample.items[0]!, product_name: 'तेल', quantity: 2.5, unit_name: 'लीटर', rate: 100,
    rate_unit: 'प्रति लिटर', discount_percent: 0, evidence: 'ढाई लीटर तेल सौ रुपये का' };
  const transcript = 'ढाई लीटर तेल सौ रुपये का';
  const matched = matchExtraction({ ...sample, retailer_name: null, retailer_evidence: null, items: [item] },
    transcript, catalog, []);
  assert.equal(matched.lines[0]?.product_unit_id, 'litre');
  assert.equal(matched.lines[0]?.quantity_milli, 2500);
  assert.equal(matched.lines[0]?.rate_paise, 10000);
  assert.doesNotMatch(matched.lines[0]?.issues.join(' ') ?? '', /spoken rate unit/);
  const english = matchExtraction({ ...sample, retailer_name: null, retailer_evidence: null,
    items: [{ ...item, unit_name: 'liters', rate_unit: 'per ltr' }] }, transcript,
    [{ ...catalog[0]!, units: [{ ...catalog[0]!.units[0]!, unit_name: 'लिटर' }] }], []);
  assert.equal(english.lines[0]?.product_unit_id, 'litre');
  const millilitres = matchExtraction({ ...sample, retailer_name: null, retailer_evidence: null,
    items: [{ ...item, quantity: 250, unit_name: 'मिलीलीटर', rate_unit: 'ml' }] }, transcript, catalog, []);
  assert.equal(millilitres.lines[0]?.product_unit_id, 'litre');
  assert.equal(millilitres.lines[0]?.quantity_milli, 250);
  assert.match(millilitres.lines[0]?.issues.join(' ') ?? '', /Converted/);
});

test('Whisper context uses unique catalog spellings within its short prompt limit', () => {
  const prompt = whisperPrompt(['घी', 'घी', 'Basmati Rice', 'Sharma Stores']);
  assert.match(prompt, /किलो.*लीटर.*Order:/);
  assert.equal(prompt.match(/घी/g)?.length, 1);
  assert.match(prompt, /Basmati Rice/);
  assert.ok(prompt.length <= 210);
});

test('metric unit conversion changes quantity and rate into the catalog selling unit', () => {
  const catalog = [{ id: 'elaichi', name: 'Elaichi', aliases: ['इलायची'], units: [{ id: 'kg',
    unit_name: 'kg', standard_price_paise: 120000, stock_factor_milli: 1000, active: true }] }];
  const item = { ...sample.items[0]!, product_name: 'इलायची', quantity: 250, unit_name: 'g',
    rate: 1.2, rate_unit: 'g', evidence: '250 g इलायची 1.2 रुपये प्रति g' };
  const result = matchExtraction({ ...sample, items: [item] }, item.evidence, catalog, []);
  assert.equal(result.lines[0]?.product_unit_id, 'kg');
  assert.equal(result.lines[0]?.quantity_milli, 250);
  assert.equal(result.lines[0]?.rate_paise, 120000);
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /Converted 250 g to 0.25 kg/);
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /Converted spoken rate/);
});

test('empty inventory converts a 500 g one-off order priced per kg to ₹50', () => {
  const item = { ...sample.items[0]!, product_name: 'maida', quantity: 500, unit_name: 'gram',
    rate: 100, rate_unit: 'kilo', price_basis: 'per_unit' as const, discount_percent: 0,
    evidence: '500 gram maida kar de aur 1 kilo maide ka rate 100 rupaye hai' };
  const matched = matchExtraction({ ...sample, retailer_name: null, retailer_evidence: null, items: [item] },
    item.evidence, [], []);
  assert.equal(matched.lines.length, 1);
  assert.equal(matched.lines[0]?.product_id, null);
  assert.equal(matched.lines[0]?.unit_name, 'kilo');
  assert.equal(matched.lines[0]?.quantity_milli, 500);
  assert.equal(matched.lines[0]?.rate_paise, 10000);
  assert.equal(Math.round(matched.lines[0]!.quantity_milli! * matched.lines[0]!.rate_paise! / 1000), 5000);
});

test('fuzzy and phonetic catalog candidates are suggestions only', () => {
  const catalog = [{ ...products[0]!, name: 'Fortune Sun Oil', aliases: [] }];
  const result = matchExtraction({ ...sample, items: [{ ...sample.items[0]!, product_name: 'Fortune Sunflower Oil' }] },
    'Fortune Sunflower Oil', catalog, []);
  assert.equal(result.lines[0]?.product_id, null);
  assert.equal(result.lines[0]?.suggestions[0]?.product_id, 'p1');
});

test('a stated budget is never converted into a per-unit rate or catalog price', () => {
  const item = { ...sample.items[0]!, quantity: null, rate: null, rate_unit: null,
    price_basis: 'budget' as const, spoken_total: 100, evidence: '100 rupees worth of Amul butter' };
  const result = matchExtraction({ ...sample, items: [item] }, item.evidence, products, contacts);
  assert.equal(result.lines[0]?.rate_paise, null);
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /budget ₹100 is not a per-unit rate/);
});

test('backup hearing cannot turn a stated budget into a unit price', async () => {
  const item = { ...sample.items[0]!, quantity: null, rate: null, rate_unit: null,
    price_basis: 'budget' as const, spoken_total: 100, evidence: '100 rupees worth of Amul butter' };
  const primary: Extraction = { ...sample, items: [item] };
  const audio: AudioSample = { buffer: Buffer.from('synthetic'), mimeType: 'audio/wav', filename: 'sample.wav' };
  const backup: SpeechProvider = { async transcribe() { return {
    transcript: '100 rupees worth of Amul butter', language_code: 'en', provider: 'sarvam:saaras:v4' }; } };
  const result = await recoverVoiceFieldsWithBackup(audio, [],
    { transcript: '100 rupees worth of Amul butter', language_code: 'en', provider: 'groq:whisper-large-v3-turbo' },
    primary, products, contacts, backup, async () => ({ ...primary, items: [{ ...item,
      quantity: 1, rate: 100, rate_unit: 'box', price_basis: 'per_unit', spoken_total: null }] }));
  assert.equal(result.extraction.items[0]?.price_basis, 'budget');
});

test('backup transcription can recover a missing second-item Hindi rate without changing the first rate', async () => {
  const audio: AudioSample = { buffer: Buffer.from('synthetic'), mimeType: 'audio/wav', filename: 'sample.wav' };
  const first = { ...sample.items[0]!, product_name: 'मैदा', quantity: 4, unit_name: 'किलो', rate: 1000,
    rate_unit: 'किलो', evidence: '4 किलो मैदा एक हजार रुपया का' };
  const second = { ...first, product_name: 'मिर्च', quantity: 5, rate: null, rate_unit: null,
    price_basis: 'unspecified' as const, spoken_total: null,
    evidence: '5 किलो मिर्च' };
  const extraction: Extraction = { ...sample, items: [first, second] };
  const transcript = '4 किलो मैदा एक हजार रुपया का, 5 किलो मिर्च 100 रुपए का';
  const backup: SpeechProvider = { async transcribe() { return { transcript, language_code: 'hi-IN', provider: 'sarvam:saaras:v4' }; } };
  const result = await recoverVoiceFieldsWithBackup(audio, [],
    { transcript: '4 किलो मैदा एक हजार रुपया का, 5 किलो मिर्च', language_code: 'hi', provider: 'groq:whisper-large-v3-turbo' },
    extraction, [], [], backup, async () => ({ ...extraction, items: [first, { ...second, rate: 100, rate_unit: 'किलो',
      price_basis: 'per_unit', evidence: '5 किलो मिर्च 100 रुपए का' }] }));
  assert.equal(result.speech.provider, 'sarvam:saaras:v4');
  assert.deepEqual(result.recoveredRateIndices, [1]);
  assert.equal(result.extraction.items[1]?.rate, 100);
});

test('backup rate is rejected if its product or existing price changes', async () => {
  const audio: AudioSample = { buffer: Buffer.from('synthetic'), mimeType: 'audio/wav', filename: 'sample.wav' };
  const first = { ...sample.items[0]!, product_name: 'मैदा', quantity: 4, rate: 1000 };
  const second = { ...first, product_name: 'मिर्च', quantity: 5, rate: null };
  const extraction: Extraction = { ...sample, items: [first, second] };
  const backup: SpeechProvider = { async transcribe() { return { transcript: '4 किलो मैदा 500 रुपए, 5 किलो धनिया 100 रुपए',
    language_code: 'hi-IN', provider: 'sarvam:saaras:v4' }; } };
  const result = await recoverVoiceFieldsWithBackup(audio, [],
    { transcript: '4 किलो मैदा 1000 रुपए, 5 किलो मिर्च', language_code: 'hi', provider: 'groq:whisper-large-v3-turbo' },
    extraction, [], [], backup, async () => ({ ...extraction, items: [{ ...first, rate: 500 },
      { ...second, product_name: 'धनिया', rate: 100, evidence: '5 किलो धनिया 100 रुपए' }] }));
  assert.deepEqual(result.recoveredRateIndices, []);
  assert.equal(result.extraction.items[1]?.rate, null);
});

test('backup can recover a uniquely matched product when Whisper mishears its name', async () => {
  const audio: AudioSample = { buffer: Buffer.from('synthetic'), mimeType: 'audio/wav', filename: 'sample.wav' };
  const first: Extraction = { ...sample, retailer_name: null, retailer_evidence: null, items: [{
    ...sample.items[0]!, product_name: 'मेच', quantity: 10, unit_name: 'किलो', rate: 1000,
    rate_unit: 'किलो', evidence: 'दस किलो मेच एक हजार रुपये की'
  }] };
  const catalog = [{ id: 'chilli', name: 'मिर्च', aliases: [], units: [{ id: 'kg', unit_name: 'kg',
    standard_price_paise: 100000, stock_factor_milli: 1000, active: true }] }];
  const transcript = 'दस किलो मिर्च एक हजार रुपये की';
  const backup: SpeechProvider = { async transcribe() { return { transcript, language_code: 'hi-IN', provider: 'sarvam:saaras:v4' }; } };
  const result = await recoverVoiceFieldsWithBackup(audio, [],
    { transcript: 'दस किलो मेच एक हजार रुपये की', language_code: 'hi', provider: 'groq:whisper-large-v3-turbo' },
    first, catalog, [], backup, async () => ({ ...first, items: [{ ...first.items[0]!, product_name: 'मिर्च',
      evidence: transcript }] }));
  assert.deepEqual(result.recoveredProductIndices, [0]);
  assert.equal(matchExtraction(result.extraction, result.speech.transcript, catalog, []).lines[0]?.product_unit_id, 'kg');
});

test('an empty catalog keeps both transcriptions visible when product names disagree', async () => {
  const audio: AudioSample = { buffer: Buffer.from('synthetic'), mimeType: 'audio/wav', filename: 'sample.wav' };
  const original: Extraction = { ...sample, retailer_name: null, retailer_evidence: null, items: [{
    ...sample.items[0]!, product_name: 'मेच', quantity: 10, unit_name: 'किलो', rate: 1000,
    rate_unit: 'किलो', evidence: 'दस किलो मेच एक हजार रुपये की'
  }] };
  const backup: SpeechProvider = { async transcribe() { return { transcript: 'दस किलो मिर्च एक हजार रुपये की',
    language_code: 'hi-IN', provider: 'sarvam:saaras:v4' }; } };
  const result = await recoverVoiceFieldsWithBackup(audio, [],
    { transcript: 'दस किलो मेच एक हजार रुपये की', language_code: 'hi', provider: 'groq:whisper-large-v3-turbo' },
    original, [], [], backup, async () => ({ ...original, items: [{ ...original.items[0]!, product_name: 'मिर्च',
      evidence: 'दस किलो मिर्च एक हजार रुपये की' }] }));
  assert.equal(result.extraction.items[0]?.product_name, 'मेच');
  assert.equal(result.alternativeSpeech?.transcript, 'दस किलो मिर्च एक हजार रुपये की');
  assert.equal(result.alternativeExtraction?.items[0]?.product_name, 'मिर्च');
});

test('complete backup replaces a primary transcription that lost every price and misheard litre quantity', async () => {
  const audio: AudioSample = { buffer: Buffer.from('synthetic'), mimeType: 'audio/wav', filename: 'sample.wav' };
  const first: Extraction = { ...sample, retailer_name: null, retailer_evidence: null, items: [
    { ...sample.items[0]!, product_name: '', quantity: 4, unit_name: 'लीटर', rate: null, rate_unit: null,
      evidence: '4 लीटर 300 रुपे का', confidence: 0, ambiguous: true },
    { ...sample.items[0]!, product_name: 'दूद', quantity: 5, unit_name: 'लीटर', rate: null, rate_unit: null,
      evidence: '5 लीटर दूद 60 रुपे का', confidence: 0, ambiguous: true }
  ] };
  const transcript = 'चार लीटर तेल सौ रुपये का, ढाई लीटर दूध साठ रुपये का';
  const alternate: Extraction = { ...first, items: [
    { ...first.items[0]!, product_name: 'तेल', quantity: 4, rate: 100, rate_unit: 'लीटर',
      evidence: 'चार लीटर तेल सौ रुपये का', confidence: 0.99, ambiguous: false },
    { ...first.items[1]!, product_name: 'दूध', quantity: 2.5, rate: 60, rate_unit: 'लीटर',
      evidence: 'ढाई लीटर दूध साठ रुपये का', confidence: 0.99, ambiguous: false }
  ] };
  const backup: SpeechProvider = { async transcribe() { return { transcript, language_code: 'hi-IN', provider: 'sarvam:saaras:v4' }; } };
  const result = await recoverVoiceFieldsWithBackup(audio, [],
    { transcript: '4 लीटर 300 रुपे का, 5 लीटर दूद 60 रुपे का', language_code: 'hi', provider: 'groq:whisper-large-v3-turbo' },
    first, [], [], backup, async () => alternate);
  assert.equal(result.speech.provider, 'sarvam:saaras:v4');
  assert.deepEqual(result.replacedByBackupIndices, [0, 1]);
  assert.equal(result.extraction.items[1]?.quantity, 2.5);
  assert.equal(result.extraction.items[1]?.rate, 60);
});

test('unclear product and missing evidence stay in supplier review', () => {
  const result = matchExtraction({ ...sample, items: [{ ...sample.items[0]!, product_name: '', evidence: '',
    confidence: 0, ambiguous: true }] }, 'Sharma Stores wants two items', products, contacts);
  assert.equal(result.lines[0]?.product_unit_id, null);
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /Enter the product name/);
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /evidence is missing/);
});

test('ambiguous names and incompatible rate units never silently select a unit', () => {
  const result = matchExtraction({ ...sample, retailer_name: 'Other shop', items: [{ ...sample.items[0]!, unit_name: 'packet', rate_unit: 'packet', ambiguous: true }] },
    '2 packet Amul butter for Other shop', products, contacts);
  assert.equal(result.retailer_contact_id, null);
  assert.equal(result.lines[0]?.product_unit_id, null);
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /catalog unit/);
  assert.match(result.lines[0]?.issues.join(' ') ?? '', /uncertain/);
});
