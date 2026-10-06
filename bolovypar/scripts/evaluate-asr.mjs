import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, resolve } from 'node:path';
import { Ai4BharatSpeechProvider, GroqWhisperSpeechProvider, SarvamSpeechProvider } from '../backend/dist/services/voice.js';

// Manifest: [{ "audio_path": "E:\\...\\sample.wav", "mime_type": "audio/wav",
//              "reference": "human-checked transcript", "consent": true }]
// Generated speech may use "synthetic": true instead of speaker consent.
const manifestPath = process.argv[2];
if (!manifestPath || !process.env.GROQ_API_KEY || !process.env.SARVAM_API_KEY) {
  throw new Error('Usage: npm run evaluate:asr -- E:\\path\\manifest.json; set GROQ_API_KEY and SARVAM_API_KEY');
}
const samples = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.ok(Array.isArray(samples) && samples.length > 0 && samples.length <= 100, 'Manifest must contain 1–100 samples');
function words(value) { return value.normalize('NFKC').toLocaleLowerCase('en-IN').match(/[\p{L}\p{M}\p{N}]+/gu) ?? []; }
function wer(reference, actual) {
  const a = words(reference), b = words(actual);
  if (!a.length) throw new Error('Reference transcript is empty');
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
      previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    previous = current;
  }
  return previous[b.length] / a.length;
}
const whisper = new GroqWhisperSpeechProvider(), sarvam = new SarvamSpeechProvider();
const ai4bharat = process.env.AI4BHARAT_ASR_URL ? new Ai4BharatSpeechProvider() : null;
const results = [];
for (const [index, sample] of samples.entries()) {
  assert.ok(sample.consent === true || sample.synthetic === true, `Sample ${index + 1} requires explicit speaker consent or synthetic=true`);
  assert.equal(parse(resolve(sample.audio_path)).root.toUpperCase(), 'E:\\', 'Keep evaluation audio on E:');
  assert.ok(typeof sample.reference === 'string' && sample.reference.trim(), 'Reference transcript required');
  assert.ok(typeof sample.mime_type === 'string' && sample.mime_type.startsWith('audio/'), 'Audio MIME type required');
  const buffer = await readFile(sample.audio_path);
  assert.ok(buffer.length <= 10 * 1024 * 1024, 'Audio must be 10 MB or smaller');
  const audio = { buffer, mimeType: sample.mime_type, filename: parse(sample.audio_path).base };
  const [a, b, c] = await Promise.all([whisper.transcribe(audio, []), sarvam.transcribe(audio, []),
    ai4bharat ? ai4bharat.transcribe(audio, []) : Promise.resolve(null)]);
  const result = { sample: index + 1, whisper_wer: wer(sample.reference, a.transcript),
    sarvam_wer: wer(sample.reference, b.transcript), ...(c ? { ai4bharat_wer: wer(sample.reference, c.transcript) } : {}) };
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(JSON.stringify({ samples: results.length,
  mean_whisper_wer: results.reduce((sum, item) => sum + item.whisper_wer, 0) / results.length,
  mean_sarvam_wer: results.reduce((sum, item) => sum + item.sarvam_wer, 0) / results.length,
  ...(ai4bharat ? { mean_ai4bharat_wer: results.reduce((sum, item) => sum + item.ai4bharat_wer, 0) / results.length } : {}) }));
