import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.env.SARVAM_API_KEY) throw new Error('Set SARVAM_API_KEY in backend/.env');
const text = 'शर्मा स्टोर्स के लिए अमूल मक्खन के दो डिब्बे चाहिए। हर डिब्बे की कीमत पाँच सौ रुपये है।';
const response = await fetch('https://api.sarvam.ai/text-to-speech', { method: 'POST', headers: {
  'api-subscription-key': process.env.SARVAM_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, language_code: 'hi-IN', model: 'bulbul:v3' }), signal: AbortSignal.timeout(45000) });
if (!response.ok) throw new Error(`Sarvam TTS returned ${response.status}`);
const audio = Buffer.from((await response.json()).audios[0], 'base64');
const directory = join(process.cwd(), '.tmp', 'voice-eval');
await mkdir(directory, { recursive: true });
const audioPath = join(directory, 'sample-hindi.wav');
await writeFile(audioPath, audio);
await writeFile(join(directory, 'manifest.json'), JSON.stringify([{ audio_path: audioPath, mime_type: 'audio/wav',
  reference: text, synthetic: true }], null, 2));
console.log(`Synthetic Hindi sample and manifest saved under ${directory}`);
