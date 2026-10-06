import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParams } from '../../App';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { commerceApi, type Contact, type OrderInput, type Product, type VoiceResult } from '../services/commerceApi';
import { prepareVoiceAudio } from '../services/prepareVoiceAudio';
import { colors, spacing, type } from '../theme/tokens';
import { Choice, Notice, Row, SectionTitle, decimal, parseDecimal, rupees } from './CommerceCommon';

type Props = NativeStackScreenProps<RootStackParams, 'VoiceOrder'>;
type Sample = { uri: string; name: string; mimeType: string; file?: globalThis.File };
type Line = { key: number; search: string; productId: string; unitId: string; quantity: string; rate: string; discount: string;
  rateSource: 'spoken' | 'retailer' | 'catalog' | 'edited' | null;
  instructions: string; evidence: string; confidence: number | null; issues: string[]; reviewed: boolean; showAllProducts: boolean;
  oneOffApproved: boolean; unitName: string; spokenRateUnit: string; gstRate: string; hsnCode: string;
  suggestions: { product_id: string; name: string; score: number }[]; spokenName: string; aliasDismissed: boolean };
const blankLine = (key: number): Line => ({ key, search: '', productId: '', unitId: '', quantity: '', rate: '', discount: '0',
  rateSource: null, instructions: '', evidence: '', confidence: null, issues: [], reviewed: false, showAllProducts: false,
  oneOffApproved: false, unitName: '', spokenRateUnit: '', gstRate: '', hsnCode: '', suggestions: [],
  spokenName: '', aliasDismissed: false });
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong';
function audioMime(name: string, reported?: string) {
  if (reported?.startsWith('audio/') || reported === 'application/ogg') return reported;
  const extension = name.toLocaleLowerCase().split('.').pop();
  return ({ wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
    webm: 'audio/webm', ogg: 'audio/ogg' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function metricUnit(value: string) {
  const unit = value.normalize('NFKC').toLocaleLowerCase().replace(/^(per|प्रति)\s+/u, '').trim();
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms|किलो|किल्लो|किलोग्राम|केजी)$/.test(unit)) return 'kg';
  if (/^(g|gm|gram|grams|ग्राम)$/.test(unit)) return 'g';
  if (/^(l|lt|ltr|ltrs|liter|liters|litre|litres|लीटर|लिटर|लितर|लेटर)$/.test(unit)) return 'l';
  if (/^(ml|milliliter|milliliters|millilitre|millilitres|मिलीलीटर|मिली लीटर)$/.test(unit)) return 'ml';
  return null;
}
function metricRatio(from: string, to: string) {
  const a = metricUnit(from), b = metricUnit(to);
  if (!a || !b) return null;
  if (a === b) return 1;
  if ((a === 'kg' || a === 'g') && (b === 'kg' || b === 'g') ||
    (a === 'l' || a === 'ml') && (b === 'l' || b === 'ml')) return (a === 'kg' || a === 'l' ? 1000 : 1) /
      (b === 'kg' || b === 'l' ? 1000 : 1);
  return null;
}
function aliasKey(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');
}
function meterLevel(db: number) {
  return Math.max(0, Math.min(1, (db + 60) / 55));
}

function lineEstimate(line: Line) {
  try {
    const quantity = parseDecimal(line.quantity, 3, 'quantity');
    const rate = parseDecimal(line.rate, 2, 'rate');
    const discountBps = parseDecimal(line.discount, 2, 'discount');
    if (quantity <= 0 || discountBps > 10000) return null;
    const gross = (BigInt(quantity) * BigInt(rate) + 500n) / 1000n;
    const discount = (gross * BigInt(discountBps) + 5000n) / 10000n;
    if (gross > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { gross_paise: Number(gross), discount_paise: Number(discount), taxable_paise: Number(gross - discount) };
  } catch { return null; }
}

function matchingRetailers(contacts: Contact[], search: string): Contact[] {
  const terms = search.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return contacts;
  return contacts.filter((contact) => {
    const fields = [contact.name, contact.phone, contact.email].filter(Boolean)
      .join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every((term) => fields.includes(term));
  });
}

function matchingProducts(products: Product[], search: string): Product[] {
  const terms = search.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return products;
  return products.filter((product) => {
    const fields = [product.name, product.sku, ...product.aliases].filter(Boolean)
      .join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every((term) => fields.includes(term));
  });
}

function speechSpelling(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function phoneticSpelling(value: string) {
  const letters: Record<string, string> = { क: 'k', ख: 'kh', ग: 'g', घ: 'gh', च: 'ch', छ: 'chh',
    ज: 'j', झ: 'jh', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', त: 't', थ: 'th', द: 'd', ध: 'dh',
    न: 'n', प: 'p', फ: 'f', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v',
    श: 'sh', ष: 'sh', स: 's', ह: 'h', ड़: 'r', ढ़: 'rh', क़: 'k', ख़: 'kh', ग़: 'g', ज़: 'z', फ़: 'f' };
  return [...value.normalize('NFKC').toLocaleLowerCase()]
    .map((letter) => letter === 'ं' || letter === 'ँ' ? 'n' : letters[letter] ?? letter)
    .join('').replace(/\p{M}/gu, '').replace(/ph/g, 'f').replace(/[aeiou]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function spellingDistance(left: string, right: string) {
  const a = [...left], b = [...right];
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1,
      row[j - 1]! + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length]!;
}

function suggestedProducts(products: Product[], search: string): Product[] {
  const wanted = speechSpelling(search);
  const phonetic = phoneticSpelling(search);
  if ([...wanted].length < 2 && phonetic.length < 2) return [];
  const limit = [...wanted].length >= 5 ? 2 : 1;
  return products.map((product) => ({ product, distance: Math.min(...[product.name, ...product.aliases]
    .flatMap((name) => {
      const plain = speechSpelling(name), sound = phoneticSpelling(name);
      return [plain && plain[0] === wanted[0] ? spellingDistance(wanted, plain) : 999,
        phonetic && sound && sound[0] === phonetic[0] ? spellingDistance(phonetic, sound) : 999];
    })) }))
    .filter(({ distance }) => distance <= limit)
    .sort((a, b) => a.distance - b.distance || a.product.name.localeCompare(b.product.name))
    .slice(0, 8).map(({ product }) => product);
}

export function VoiceOrderScreen({ navigation }: Props) {
  const { session, account } = useAuth();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1,
    isMeteringEnabled: true, android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource: 'voice_communication' } });
  const nativeRecorderState = useAudioRecorderState(recorder, 120);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webRecorder = useRef<MediaRecorder | null>(null);
  const webMeter = useRef<{ context: AudioContext; interval: ReturnType<typeof setInterval> } | null>(null);
  const webChunks = useRef<Blob[]>([]);
  const webSampleUrl = useRef<string | null>(null);
  const nextKey = useRef(1);
  const [recording, setRecording] = useState(false);
  const [meterHistory, setMeterHistory] = useState<number[]>(Array(18).fill(0));
  const [meterAvailable, setMeterAvailable] = useState(true);
  const [sample, setSample] = useState<Sample | null>(null);
  const [consent, setConsent] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [contactId, setContactId] = useState('');
  const [retailerSearch, setRetailerSearch] = useState('');
  const [retailerReviewed, setRetailerReviewed] = useState(false);
  const [place, setPlace] = useState('');
  const [instructions, setInstructions] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof commerceApi.quoteOrder>>['quote'] | null>(null);
  const [quoteKey, setQuoteKey] = useState('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
  const [aliasSavingKey, setAliasSavingKey] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' && recording && nativeRecorderState.metering !== undefined) {
      const level = meterLevel(nativeRecorderState.metering);
      setMeterHistory((current) => [...current.slice(1), level]);
    }
  }, [nativeRecorderState.metering, recording]);

  useFocusEffect(useCallback(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    Promise.all([commerceApi.products(session.access_token), commerceApi.contacts(session.access_token)]).then(([p, c]) => {
      if (!active) return;
      const availableProducts = p.products.filter((item) => !item.archived_at);
      setProducts(availableProducts);
      setLines((current) => current.map((line) => {
        const product = availableProducts.find((item) => item.id === line.productId);
        if (!line.productId || !product) return line.productId ? { ...line, productId: '', unitId: '', reviewed: false } : line;
        if (line.unitId && !product.units.some((unit) => unit.id === line.unitId && unit.active)) {
          return { ...line, unitId: '', reviewed: false };
        }
        return line;
      }));
      const available = c.contacts.filter((item) => !item.archived_at);
      setContacts(available);
      setContactId((current) => available.some((contact) => contact.id === current) ? current : '');
      setRetailerReviewed(false);
      setError(null);
    }).catch((cause: unknown) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session]));
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (webMeter.current) {
      clearInterval(webMeter.current.interval);
      void webMeter.current.context.close().catch(() => undefined);
      webMeter.current = null;
    }
    webRecorder.current?.stream.getTracks().forEach((track) => track.stop());
    if (webSampleUrl.current) URL.revokeObjectURL(webSampleUrl.current);
  }, []);

  const selectedContact = contacts.find((contact) => contact.id === contactId);
  const retailerMatches = useMemo(() => matchingRetailers(contacts, retailerSearch), [contacts, retailerSearch]);
  const updateLine = (key: number, patch: Partial<Line>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch, reviewed: false } : line));
  const selectProduct = (line: Line, product: Product) => {
    setLines((current) => current.map((item) => item.key === line.key ? { ...item, productId: product.id, unitId: '', search: product.name,
      rate: item.rateSource === 'spoken' || item.rateSource === 'edited' ? item.rate : '',
      rateSource: item.rateSource === 'spoken' || item.rateSource === 'edited' ? item.rateSource : null,
      reviewed: false, showAllProducts: false, oneOffApproved: false, aliasDismissed: false } : item));
  };
  async function saveSpokenAlias(line: Line, product: Product) {
    if (!session || !line.spokenName.trim()) return;
    setAliasSavingKey(line.key); setError(null);
    try {
      const result = await commerceApi.addProductAlias(session.access_token, product.id, line.spokenName.trim());
      setProducts((current) => current.map((entry) => entry.id === product.id ? { ...entry, aliases: result.aliases } : entry));
      setNotice(`“${line.spokenName.trim()}” saved as an alias for ${product.name}.`);
    } catch (cause) { setError(message(cause)); }
    finally { setAliasSavingKey(null); }
  }
  function startWebMeter(stream: MediaStream) {
    if (typeof AudioContext === 'undefined') { setMeterAvailable(false); return; }
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      void context.resume().catch(() => setMeterAvailable(false));
      const interval = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let power = 0;
        for (const value of samples) power += value * value;
        const db = 20 * Math.log10(Math.max(0.00001, Math.sqrt(power / samples.length)));
        setMeterHistory((current) => [...current.slice(1), meterLevel(db)]);
      }, 120);
      webMeter.current = { context, interval };
    } catch { setMeterAvailable(false); }
  }
  async function stopWebMeter() {
    const meter = webMeter.current;
    if (!meter) return;
    webMeter.current = null;
    clearInterval(meter.interval);
    await meter.context.close().catch(() => undefined);
  }
  const selectUnit = (line: Line, product: Product, unitId: string) => {
    const unit = product.units.find((entry) => entry.id === unitId);
    if (!unit) return;
    const retailerPrice = selectedContact?.prices.find((entry) => entry.product_unit_id === unitId)?.price_paise;
    const preserveRate = line.rateSource === 'spoken' || line.rateSource === 'edited' || line.unitId === unitId;
    const quantityRatio = !line.unitId ? metricRatio(line.unitName, unit.unit_name) : null;
    const rateRatio = !line.unitId ? metricRatio(unit.unit_name, line.spokenRateUnit) : null;
    const quantity = quantityRatio === null ? Number(line.quantity) : Number(line.quantity) * quantityRatio;
    const rate = preserveRate && line.rateSource === 'spoken' && rateRatio !== null && line.rate.trim()
      ? Number(line.rate) * rateRatio : Number.NaN;
    const validQuantity = Boolean(line.quantity.trim()) && Number.isFinite(quantity) && quantity > 0 && Number(quantity.toFixed(3)) === quantity;
    const validRate = Number.isFinite(rate) && rate >= 0 && Number(rate.toFixed(2)) === rate;
    updateLine(line.key, { unitId, quantity: validQuantity ? String(quantity) : quantityRatio === null ? line.quantity : '',
      rate: validRate ? String(rate) : preserveRate && (rateRatio !== null || !line.spokenRateUnit) ? line.rate
        : line.rateSource === 'spoken' ? '' : decimal(retailerPrice ?? unit.standard_price_paise, 2),
      rateSource: validRate ? 'spoken' : preserveRate && (rateRatio !== null || !line.spokenRateUnit) ? line.rateSource
        : line.rateSource === 'spoken' ? null : retailerPrice === undefined ? 'catalog' : 'retailer',
      issues: validQuantity && quantityRatio !== null && quantityRatio !== 1
        ? [...line.issues, `Converted spoken quantity to ${quantity} ${unit.unit_name}; verify before saving`] : line.issues });
  };

  async function stopRecording() {
    setRecording(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    try {
      if (Platform.OS === 'web' && webRecorder.current) {
        const mediaRecorder = webRecorder.current;
        const mimeType = mediaRecorder.mimeType.split(';')[0] || 'audio/webm';
        const blob = await new Promise<Blob>((resolve, reject) => {
          mediaRecorder.addEventListener('stop', () => resolve(new Blob(webChunks.current, { type: mimeType })), { once: true });
          mediaRecorder.addEventListener('error', () => reject(new Error('Microphone recording failed')), { once: true });
          mediaRecorder.stop();
        });
        if (!blob.size) throw new Error('Recording was empty; try again closer to the microphone');
        if (webSampleUrl.current) URL.revokeObjectURL(webSampleUrl.current);
        const uri = URL.createObjectURL(blob);
        webSampleUrl.current = uri;
        const name = mimeType === 'audio/mp4' ? 'voice-order.m4a' :
          mimeType === 'audio/ogg' ? 'voice-order.ogg' : 'voice-order.webm';
        setSample({ uri, name, mimeType, file: new globalThis.File([blob], name, { type: mimeType }) });
      } else {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('Recording did not produce an audio file');
      const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      const name = `voice-order.${Platform.OS === 'web' ? 'webm' : 'm4a'}`;
      const file = Platform.OS === 'web' ? new globalThis.File([await (await fetch(uri)).blob()], name, { type: mimeType }) : undefined;
      setSample({ uri, name, mimeType, file });
      await setAudioModeAsync({ allowsRecording: false });
      }
      setResult(null); setQuote(null); setNotice('Recording ready. Review consent, then process it.');
    } catch (cause) { setError(message(cause)); }
    finally {
      await stopWebMeter();
      webRecorder.current?.stream.getTracks().forEach((track) => track.stop());
      webRecorder.current = null; setRecording(false);
    }
  }
  async function startRecording() {
    setError(null); setNotice(null);
    setMeterHistory(Array(18).fill(0)); setMeterAvailable(true);
    try {
      if (Platform.OS === 'web' && typeof MediaRecorder !== 'undefined') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          autoGainControl: true, noiseSuppression: true, echoCancellation: true, channelCount: 1
        } });
        try {
          const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
            .find((type) => MediaRecorder.isTypeSupported(type));
          const mediaRecorder = new MediaRecorder(stream, {
            ...(preferredType ? { mimeType: preferredType } : {}), audioBitsPerSecond: 128000
          });
          webChunks.current = [];
          mediaRecorder.addEventListener('dataavailable', (event) => { if (event.data.size) webChunks.current.push(event.data); });
          webRecorder.current = mediaRecorder;
          mediaRecorder.start();
          startWebMeter(stream);
        } catch (cause) { stream.getTracks().forEach((track) => track.stop()); throw cause; }
        setRecording(true); setSample(null); setResult(null); setQuote(null);
        timer.current = setTimeout(() => { void stopRecording(); }, 29000);
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is required');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true); setSample(null); setResult(null); setQuote(null);
      timer.current = setTimeout(() => { void stopRecording(); }, 29000);
    } catch (cause) { setError(message(cause)); }
  }
  async function pickAudio() {
    setError(null); setNotice(null);
    try {
      const chosen = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'application/ogg'], multiple: false, copyToCacheDirectory: true, base64: false });
      if (chosen.canceled) return;
      const asset = chosen.assets[0];
      if (!asset) return;
      if (asset.size && asset.size > 10 * 1024 * 1024) throw new Error('Audio must be under 10 MB');
      setSample({ uri: asset.uri, name: asset.name, mimeType: audioMime(asset.name, asset.mimeType), file: asset.file });
      setResult(null); setQuote(null);
    } catch (cause) { setError(message(cause)); }
  }
  async function processSample() {
    if (!session || !sample || !consent) { setError('Select audio and confirm consent from every recorded speaker'); return; }
    setBusy(true); setError(null); setNotice(null); setQuote(null);
    try {
      const uploaded = Platform.OS === 'web' && sample.file ? await prepareVoiceAudio(sample.file) : sample.file;
      const preparedSample = uploaded && uploaded !== sample.file
        ? { ...sample, file: uploaded, name: uploaded.name, mimeType: uploaded.type } : sample;
      const parsed = await commerceApi.processVoice(session.access_token, preparedSample);
      setResult(parsed); setSavedOrderId(null); setContactId(parsed.matched.retailer_contact_id ?? '');
      setRetailerSearch(''); setRetailerReviewed(false); setPlace('');
      setInstructions(parsed.extraction.instructions ?? '');
      setLines(parsed.matched.lines.map((item) => ({
        key: nextKey.current++, search: item.product_name, productId: item.product_id ?? '', unitId: item.product_unit_id ?? '',
        quantity: item.quantity_milli === null ? '' : decimal(item.quantity_milli, 3),
        rate: item.rate_paise === null ? '' : decimal(item.rate_paise, 2), rateSource: item.rate_source,
        discount: decimal(item.discount_bps, 2),
        instructions: item.instructions ?? '', evidence: item.evidence, confidence: item.confidence, issues: item.issues,
        reviewed: false, showAllProducts: false, oneOffApproved: false,
        unitName: item.unit_name ?? item.rate_unit ?? '', spokenRateUnit: item.rate_unit ?? '',
        gstRate: account?.business?.gstin ? '' : '0', hsnCode: '',
        suggestions: item.suggestions ?? [], spokenName: item.product_name, aliasDismissed: false
      })));
      const contact = contacts.find((item) => item.id === parsed.matched.retailer_contact_id);
      setPlace(contact?.state ?? account?.business?.state ?? '');
      if (!parsed.matched.lines.length) setNotice('No line items were recognized. Add them manually after reviewing the transcript.');
      else if (parsed.matched.lines.some((item) => item.rate_paise === null))
        setNotice('One or more prices were not recognized. Enter the spoken rate for those items before saving the bill.');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  const orderInput = useCallback((): OrderInput => {
    if (!contactId) throw new Error('Choose a retailer');
    if (!place.trim()) throw new Error('Enter the place of supply state');
    if (!lines.length) throw new Error('Add at least one item');
    return { retailer_contact_id: contactId, place_of_supply_state: place.trim(), instructions: instructions.trim() || null,
      lines: lines.map((line, index) => {
        const quantity_milli = parseDecimal(line.quantity, 3, `item ${index + 1} quantity`);
        if (quantity_milli <= 0) throw new Error(`Item ${index + 1}: quantity must be greater than zero`);
        const rate_paise = parseDecimal(line.rate, 2, `item ${index + 1} rate`);
        const discount_bps = parseDecimal(line.discount, 2, `item ${index + 1} discount`);
        if (discount_bps > 10000) throw new Error(`Item ${index + 1}: discount must be 0–100%`);
        const lineInstructions = line.instructions.trim() || null;
        if (line.oneOffApproved) {
          if (!line.search.trim()) throw new Error(`Item ${index + 1}: enter the one-off product name`);
          if (!line.unitName.trim()) throw new Error(`Item ${index + 1}: enter a selling unit for the one-off product`);
          const gst_rate_bps = parseDecimal(line.gstRate, 2, `item ${index + 1} GST rate`);
          if (gst_rate_bps > 10000) throw new Error(`Item ${index + 1}: GST rate must be 0–100%`);
          const hsn_code = line.hsnCode.trim() || null;
          if (hsn_code && !/^[0-9]{4,8}$/.test(hsn_code)) throw new Error(`Item ${index + 1}: HSN must be 4–8 digits`);
          return { source: 'one_off' as const, product_name: line.search.trim(), unit_name: line.unitName.trim(),
            hsn_code, gst_rate_bps, quantity_milli, rate_paise, discount_bps, instructions: lineInstructions };
        }
        if (!line.productId) throw new Error(`Item ${index + 1}: select a product from the catalog choices. If it is missing, add it in Products.`);
        if (!line.unitId) throw new Error(`Item ${index + 1}: select a selling unit for the chosen product.`);
        return { product_unit_id: line.unitId, quantity_milli, rate_paise, discount_bps, instructions: lineInstructions };
      }) };
  }, [contactId, place, instructions, lines]);
  const inputKey = useMemo(() => { try { return JSON.stringify(orderInput()); } catch { return ''; } }, [orderInput]);
  const currentQuote = quote && quoteKey === inputKey && inputKey ? quote : null;
  const confirmReady = Boolean(inputKey) && retailerReviewed && lines.every((line) => line.reviewed);
  useEffect(() => {
    if (!session || !result || !inputKey) { setQuote(null); setQuoteError(null); return; }
    const input = JSON.parse(inputKey) as OrderInput;
    let active = true;
    const timeout = setTimeout(() => {
      void commerceApi.quoteOrder(session.access_token, input).then((response) => {
        if (active) { setQuote(response.quote); setQuoteKey(JSON.stringify(input)); setQuoteError(null); }
      }).catch((cause: unknown) => { if (active) { setQuote(null); setQuoteError(message(cause)); } });
    }, 500);
    return () => { active = false; clearTimeout(timeout); };
  }, [session, result, inputKey]);

  async function save(confirm: boolean) {
    if (!session || !result) return;
    if (!currentQuote) {
      try { orderInput(); setError(quoteError ?? 'Wait for the bill preview to finish calculating'); }
      catch (cause) { setError(message(cause)); }
      return;
    }
    if (confirm && !confirmReady) { setError('Check the retailer and every item before confirming'); return; }
    if (confirm && account?.business?.gstin) {
      const missingHsn = lines.findIndex((line) => line.oneOffApproved && !line.hsnCode.trim());
      if (missingHsn >= 0) { setError(`Item ${missingHsn + 1}: enter the HSN code before confirming this GST order`); return; }
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const data = orderInput();
      const { order } = await commerceApi.saveOrder(session.access_token, { ...data, expected_total_paise: currentQuote.total_paise }, savedOrderId ?? undefined);
      setSavedOrderId(order);
      if (confirm) {
        try { await commerceApi.confirm(session.access_token, order); }
        catch (cause) { setNotice(`Draft ${order} was saved, but confirmation failed: ${message(cause)}`); return; }
      }
      setResult(null); setLines([]); setSample(null); setSavedOrderId(null);
      navigation.navigate('Orders', { orderId: order, openSend: confirm,
        notice: confirm ? 'Order confirmed. Its confirmation PDF is ready. A tax invoice is issued separately when GST details are complete.'
          : 'Draft saved. Open it below to edit or confirm.' });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  return <Screen>
    <Text style={styles.title}>Voice to order</Text>
    <Text style={styles.body}>Record or upload a short sample (up to 30 seconds). Review every field before saving.</Text>
    <AppCard style={styles.card}>
      <SectionTitle>Audio sample</SectionTitle>
      <Row>
        <AppButton title={recording ? 'Stop recording' : 'Record voice'} onPress={() => void (recording ? stopRecording() : startRecording())} disabled={busy} />
        <AppButton title="Upload audio" variant="secondary" onPress={() => void pickAudio()} disabled={busy || recording} />
      </Row>
      {recording ? <Text style={styles.warning}>Recording… stops automatically after 29 seconds.</Text> : null}
      {recording ? <View style={styles.meterCard} accessibilityRole="progressbar"
        accessibilityLabel="Live microphone level" accessibilityValue={{ min: 0, max: 100,
          now: Math.round((meterHistory[meterHistory.length - 1] ?? 0) * 100) }}>
        <Text style={styles.hint}>Microphone level · speak normally and watch the bars move</Text>
        {meterAvailable ? <View style={styles.meterBars}>{meterHistory.map((level, index) =>
          <View key={index} style={[styles.meterBar, { height: 5 + Math.round(level * 35),
            backgroundColor: level > 0.88 ? colors.error : colors.primary }]} />)}</View> :
          <Text style={styles.hint}>Live level is unavailable on this browser; recording continues.</Text>}
      </View> : null}
      {sample ? <Text style={styles.body}>Selected: {sample.name}</Text> : null}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent((value) => !value)} style={styles.consent}>
        <Text style={styles.body}>{consent ? '☑' : '☐'} I have consent from every person recorded. Audio is sent to Groq Whisper, or to Sarvam if Whisper fails or an item or price needs a second check. The transcript is sent to Groq for order extraction. BoloVyapar does not store the raw audio.</Text>
      </Pressable>
      <AppButton title={busy ? 'Processing…' : 'Transcribe and extract'} onPress={() => void processSample()} disabled={!sample || !consent || busy || loading || recording} />
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
    </AppCard>
    {result ? <>
      <AppCard style={styles.card}>
        <SectionTitle>Transcript</SectionTitle>
        <Text selectable style={styles.body}>{result.speech.transcript}</Text>
        <Text style={styles.hint}>Detected language: {result.speech.language_code ?? 'unknown'}. Compare every extracted value with this transcript.</Text>
        {result.alternative_speech && result.alternative_speech.transcript !== result.speech.transcript ? <>
          <Text style={styles.name}>Second transcription</Text>
          <Text selectable style={styles.body}>{result.alternative_speech.transcript}</Text>
          <Text style={styles.warning}>If the two versions disagree on a name, quantity or price, correct the item fields before confirming.</Text>
        </> : null}
      </AppCard>
      <AppCard style={styles.card}>
        <SectionTitle>Retailer and supply</SectionTitle>
        {result.matched.retailer_issues.map((issue) => <Text key={issue} style={styles.warning}>{issue}</Text>)}
        {result.extraction.retailer_name ? <Text style={styles.body}>Spoken retailer: {result.extraction.retailer_name}</Text> : null}
        <AppField label="Find retailer" value={retailerSearch} onChangeText={(value) => {
          setRetailerSearch(value); setContactId(''); setRetailerReviewed(false); setError(null);
        }} hint="Search saved retailers by name, phone or email. Leave empty to see all." />
        <Row><AppButton title="Clear search" variant="secondary" onPress={() => setRetailerSearch('')} />
          <AppButton title="Manage retailers" variant="secondary" onPress={() => navigation.navigate('Contacts')} /></Row>
        {loading ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.hint}>
          {retailerMatches.length ? `${retailerMatches.length} retailer${retailerMatches.length === 1 ? '' : 's'} found` :
            contacts.length ? 'No saved retailer matches. Clear the search or add the retailer in Retailers.' : 'No saved retailers yet. Add one in Retailers.'}
        </Text>}
        {selectedContact ? <Text style={styles.name}>Selected retailer: {selectedContact.name}</Text> :
          <Text style={styles.hint}>Select a retailer below to use it for this order.</Text>}
        <Row>{retailerMatches.map((contact) => <Choice key={contact.id} title={contact.name}
          subtitle={[contact.phone, contact.email].filter(Boolean).join(' · ') || undefined}
          selected={contactId === contact.id} onPress={() => {
          setContactId(contact.id); setRetailerSearch(contact.name); setRetailerReviewed(false); setPlace(contact.state ?? account?.business?.state ?? '');
          setLines((current) => current.map((line) => {
            const unit = products.flatMap((product) => product.units).find((entry) => entry.id === line.unitId);
            const retailerPrice = contact.prices.find((entry) => entry.product_unit_id === line.unitId)?.price_paise;
            return { ...line, reviewed: false, ...((line.rateSource === 'retailer' || line.rateSource === 'catalog') && unit ? {
              rate: decimal(retailerPrice ?? unit.standard_price_paise, 2), rateSource: retailerPrice === undefined ? 'catalog' as const : 'retailer' as const
            } : {}) };
          }));
        }} />)}</Row>
        <AppField label="Place of supply state" value={place} onChangeText={(value) => { setPlace(value); setRetailerReviewed(false); }} />
        <AppField label="Order instructions" value={instructions} onChangeText={setInstructions} multiline />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: retailerReviewed }} onPress={() => setRetailerReviewed((value) => !value)}>
          <Text style={styles.review}>{retailerReviewed ? '☑' : '☐'} I checked the retailer and place of supply</Text>
        </Pressable>
      </AppCard>
      {lines.map((line, index) => {
        const product = products.find((item) => item.id === line.productId);
        const aliasOffer = product && line.spokenName.trim() && !line.aliasDismissed &&
          aliasKey(line.spokenName) !== aliasKey(product.name) &&
          !product.aliases.some((alias) => aliasKey(alias) === aliasKey(line.spokenName));
        const aliasSaved = product && line.spokenName.trim() && aliasKey(line.spokenName) !== aliasKey(product.name) &&
          product.aliases.some((alias) => aliasKey(alias) === aliasKey(line.spokenName));
        const selectedUnit = product?.units.find((unit) => unit.id === line.unitId && unit.active);
        const otherHearing = result.alternative_extraction?.items.length === lines.length
          ? result.alternative_extraction.items[index] : null;
        const safeOtherName = otherHearing?.product_name && otherHearing.product_name.trim() !== line.search.trim() &&
          otherHearing.quantity === Number(line.quantity) && otherHearing.rate === Number(line.rate);
        const matches = matchingProducts(products, line.search);
        const backendSuggestions = line.suggestions.map((candidate) => products.find((entry) => entry.id === candidate.product_id))
          .filter((candidate): candidate is Product => Boolean(candidate));
        const suggestions = matches.length ? [] : backendSuggestions.length ? backendSuggestions : suggestedProducts(products, line.search);
        const candidatePool = matches.length ? matches : suggestions.length ? suggestions : products;
        const candidates = line.showAllProducts ? candidatePool : candidatePool.slice(0, 12);
        const estimate = lineEstimate(line);
        const billedLine = currentQuote?.lines[index];
        const readyToReview = Boolean(selectedUnit || (line.oneOffApproved && line.search.trim() && line.unitName.trim() && line.gstRate.trim()));
        return <AppCard key={line.key} style={styles.card}>
          <Row><SectionTitle>Item {index + 1}</SectionTitle><AppButton title="Remove" variant="secondary" onPress={() => setLines((current) => current.filter((item) => item.key !== line.key))} /></Row>
          {line.evidence ? <Text style={styles.hint}>Heard: “{line.evidence}” · AI confidence {Math.round((line.confidence ?? 0) * 100)}%</Text> : <Text style={styles.hint}>Added manually</Text>}
          {safeOtherName && otherHearing ? <Row><Text style={styles.hint}>Other transcription heard: “{otherHearing.product_name}”</Text>
            <AppButton title="Use other name" variant="secondary" onPress={() => updateLine(line.key, {
              search: otherHearing.product_name, productId: '', unitId: '', evidence: otherHearing.evidence,
              unitName: otherHearing.unit_name ?? line.unitName
            })} /></Row> : null}
          {line.issues.filter((issue) => !((line.productId || line.oneOffApproved) && issue.startsWith('Choose a catalog product')) &&
            !((line.unitId || line.oneOffApproved) && issue.startsWith('Choose the catalog unit'))).map((issue) =>
            <Text key={issue} style={styles.warning}>Review: {issue}</Text>)}
          <AppField label={line.oneOffApproved ? 'One-off product name' : 'Find catalog product'} value={line.search}
            hint={line.oneOffApproved ? 'This name appears on the order and PDF.' : 'Search a saved product name, SKU or alias.'} onChangeText={(value) => updateLine(line.key, {
            search: value, productId: '', unitId: '', showAllProducts: false, suggestions: [],
            rate: line.rateSource === 'spoken' || line.rateSource === 'edited' ? line.rate : '',
            rateSource: line.rateSource === 'spoken' || line.rateSource === 'edited' ? line.rateSource : null
          })} />
          {!product && (line.search.trim() && !matches.length || !products.length || line.oneOffApproved) ?
            <View style={styles.oneOffPrompt}>
              <Text style={styles.name}>{suggestions.length
                ? `No exact catalog match for “${line.search.trim()}”. Check the possible matches below or include it as a one-off item.`
                : `“${line.search.trim() || `Item ${index + 1}`}” is not in your inventory. Continue with it?`}</Text>
              <Text style={styles.hint}>A one-off item appears on this order but is not added to Products or deducted from tracked stock.</Text>
              <Row><Choice title="Yes, include in the bill" selected={line.oneOffApproved} onPress={() => updateLine(line.key, {
                oneOffApproved: true, productId: '', unitId: '',
                gstRate: line.gstRate || (account?.business?.gstin ? '' : '0')
              })} />
                <Choice title="No, use inventory product" selected={!line.oneOffApproved} onPress={() => updateLine(line.key, { oneOffApproved: false })} /></Row>
            </View> : null}
          {line.oneOffApproved ? <>
            <Text style={styles.name}>One-off item: {line.search.trim() || 'Enter a name above'}</Text>
            <Row><View style={styles.field}><AppField label="Selling unit" value={line.unitName} placeholder="kg, bag, piece"
              onChangeText={(value) => updateLine(line.key, { unitName: value })} /></View>
              <View style={styles.field}><AppField label="GST rate %" value={line.gstRate} keyboardType="decimal-pad"
                placeholder="Enter 0 if applicable" onChangeText={(value) => updateLine(line.key, { gstRate: value })} /></View>
              <View style={styles.field}><AppField label="HSN code for tax invoice" value={line.hsnCode} keyboardType="number-pad"
                placeholder="4–8 digits" onChangeText={(value) => updateLine(line.key, { hsnCode: value })} /></View></Row>
            <Text style={styles.hint}>Check the GST rate. {account?.business?.gstin
              ? 'HSN is required before confirming this GST order.' : 'HSN will be needed if a GST tax invoice is issued later.'}</Text>
          </> : <>
            <Row><AppButton title="Clear product search" variant="secondary" onPress={() => updateLine(line.key, {
              search: '', productId: '', unitId: '', showAllProducts: false,
              rate: line.rateSource === 'spoken' || line.rateSource === 'edited' ? line.rate : '',
              rateSource: line.rateSource === 'spoken' || line.rateSource === 'edited' ? line.rateSource : null
            })} />
              <AppButton title="Add or edit in Products" variant="secondary" onPress={() => navigation.navigate('Products')} /></Row>
            {!product ? <Text style={styles.warning}>Item {index + 1}: choose a product below or use it as a one-off item above.</Text> :
              <Text style={styles.name}>Selected product: {product.name}</Text>}
            {!matches.length && suggestions.length && !product ?
              <Text style={styles.hint}>Possible matches for the spoken spelling. Check the name before selecting.</Text> : null}
            <Row>{candidates.map((item) => <Choice key={item.id} title={item.name}
              subtitle={[line.suggestions.find((candidate) => candidate.product_id === item.id)
                ? `${Math.round(line.suggestions.find((candidate) => candidate.product_id === item.id)!.score * 100)}% spelling match` : '',
              item.sku ? `SKU ${item.sku}` : ''].filter(Boolean).join(' · ') || undefined} selected={line.productId === item.id}
              onPress={() => selectProduct(line, item)} />)}</Row>
            {candidatePool.length > 12 ? <AppButton title={line.showAllProducts ? 'Show fewer products' : `Show all ${candidatePool.length} products`}
              variant="secondary" onPress={() => setLines((current) => current.map((item) => item.key === line.key
                ? { ...item, showAllProducts: !item.showAllProducts } : item))} /> : null}
          </>}
          {product ? <><Text style={styles.hint}>Choose a selling unit and check its packaging conversion.</Text>
            {aliasSaved ? <Text style={styles.hint}>“{line.spokenName.trim()}” is saved as an alias for {product.name}.</Text> : null}
            {aliasOffer ? <View style={styles.aliasPrompt}>
              <Text style={styles.name}>Save “{line.spokenName.trim()}” as an alias for {product.name} for future voice orders?</Text>
              <Row><AppButton title={aliasSavingKey === line.key ? 'Saving alias…' : 'Save alias'}
                disabled={aliasSavingKey !== null} onPress={() => void saveSpokenAlias(line, product)} />
                <AppButton title="Not now" variant="secondary" onPress={() => setLines((current) => current.map((item) =>
                  item.key === line.key ? { ...item, aliasDismissed: true } : item))} /></Row>
            </View> : null}
            {!selectedUnit ? <Text style={styles.warning}>Item {index + 1}: select a selling unit below.</Text> :
              <Text style={styles.name}>Selected unit: {selectedUnit.unit_name}</Text>}
            {!product.units.some((unit) => unit.active) ? <Text style={styles.warning}>This product has no active selling unit. Add one in Products.</Text> : null}
            <Row>{product.units.filter((unit) => unit.active).map((unit) =>
            <Choice key={unit.id} title={unit.unit_name} subtitle={`1 ${unit.unit_name} = ${decimal(unit.stock_factor_milli, 3)} stock units`}
              selected={line.unitId === unit.id} onPress={() => selectUnit(line, product, unit.id)} />)}</Row></> : null}
          <Row><View style={styles.field}><AppField label="Quantity" value={line.quantity} keyboardType="decimal-pad" onChangeText={(value) => updateLine(line.key, { quantity: value })} /></View>
            <View style={styles.field}><AppField label="Rate (₹ per selected unit)" value={line.rate} keyboardType="decimal-pad" onChangeText={(value) => updateLine(line.key, { rate: value, rateSource: 'edited' })} /></View>
            <View style={styles.field}><AppField label="Discount %" value={line.discount} keyboardType="decimal-pad" onChangeText={(value) => updateLine(line.key, { discount: value })} /></View></Row>
          {estimate ? <View style={styles.calculation}>
            <Text style={styles.body}>{line.quantity} × {rupees(parseDecimal(line.rate, 2, 'rate'))} = {rupees(estimate.gross_paise)}</Text>
            <Text style={styles.body}>Discount {line.discount}%: −{rupees(estimate.discount_paise)}</Text>
            <Text style={styles.name}>Item total before tax: {rupees(estimate.taxable_paise)}</Text>
            {billedLine ? <>
              <Text style={styles.body}>GST {decimal(billedLine.gst_rate_bps, 2)}%: {currentQuote?.tax_mode === 'intra'
                ? `CGST ${rupees(billedLine.cgst_paise)} + SGST ${rupees(billedLine.sgst_paise)}`
                : currentQuote?.tax_mode === 'inter' ? `IGST ${rupees(billedLine.igst_paise)}` : 'No GST charged'}</Text>
              <Text style={styles.lineTotal}>Item total with tax: {rupees(billedLine.total_paise)}</Text>
            </> : <Text style={styles.hint}>Select the retailer and complete the {line.oneOffApproved ? 'one-off unit and GST rate' : 'catalog product and unit'} to calculate GST and final total.</Text>}
          </View> : <Text style={styles.hint}>Enter a valid quantity, rate and discount to see this item’s total.</Text>}
          {line.rateSource ? <Text style={styles.hint}>Rate source: {line.rateSource}</Text> : null}
          <AppField label="Item instructions" value={line.instructions} onChangeText={(value) => updateLine(line.key, { instructions: value })} multiline />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: line.reviewed, disabled: !readyToReview }} disabled={!readyToReview}
            onPress={() => setLines((current) => current.map((item) => item.key === line.key ? { ...item, reviewed: !item.reviewed } : item))}>
            <Text style={[styles.review, !readyToReview && styles.disabledReview]}>{line.reviewed ? '☑' : '☐'} I checked this item against the transcript and {line.oneOffApproved ? 'one-off details' : 'catalog'}</Text>
          </Pressable>
        </AppCard>;
      })}
      <AppButton title="Add item" variant="secondary" onPress={() => setLines((current) => [...current, blankLine(nextKey.current++)])} />
      <AppCard style={styles.card}>
        <SectionTitle>Bill preview</SectionTitle>
        {currentQuote ? <><Text style={styles.body}>Subtotal: {rupees(currentQuote.subtotal_paise)}</Text><Text style={styles.body}>Discount: {rupees(currentQuote.discount_paise)}</Text>
          <Text style={styles.body}>After discount: {rupees(currentQuote.taxable_paise)}</Text>
          <Text style={styles.body}>CGST: {rupees(currentQuote.cgst_paise)} · SGST: {rupees(currentQuote.sgst_paise)} · IGST: {rupees(currentQuote.igst_paise)}</Text>
          <Text style={styles.body}>Tax: {rupees(currentQuote.cgst_paise + currentQuote.sgst_paise + currentQuote.igst_paise)} ({currentQuote.tax_mode})</Text>
          <Text style={styles.total}>Total: {rupees(currentQuote.total_paise)}</Text></> : <Text style={styles.hint}>Complete the fields to calculate the bill.</Text>}
        {quoteError ? <Text style={styles.warning}>{quoteError}</Text> : null}
        <Text style={styles.hint}>The server recalculates tax and total after edits. A complete quote can be saved as a draft. To confirm, also check the retailer and every item.</Text>
        <Row><AppButton title="Save draft" variant="secondary" disabled={busy} onPress={() => void save(false)} />
          <AppButton title="Confirm order" disabled={busy} onPress={() => void save(true)} /></Row>
      </AppCard>
    </> : null}
    <Notice error={error} message={notice} />
  </Screen>;
}

const styles = StyleSheet.create({
  title: { color: colors.ink, fontSize: type.title, fontWeight: '800' },
  body: { color: colors.ink, fontSize: type.body, lineHeight: 24 },
  hint: { color: colors.muted, fontSize: type.caption, lineHeight: 20 },
  warning: { color: colors.error, fontSize: type.label, lineHeight: 20 },
  card: { gap: spacing.md },
  consent: { paddingVertical: spacing.sm },
  field: { flexGrow: 1, minWidth: 150 },
  review: { color: colors.primaryDark, fontSize: type.label, fontWeight: '700', paddingVertical: spacing.md },
  disabledReview: { opacity: 0.55 },
  oneOffPrompt: { backgroundColor: colors.primarySoft, borderRadius: 10, padding: spacing.md, gap: spacing.sm },
  aliasPrompt: { backgroundColor: colors.primarySoft, borderRadius: 10, padding: spacing.md, gap: spacing.sm },
  meterCard: { gap: spacing.sm, padding: spacing.md, borderColor: colors.border, borderWidth: 1, borderRadius: 10 },
  meterBars: { height: 42, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  meterBar: { flex: 1, maxWidth: 12, borderRadius: 3 },
  calculation: { backgroundColor: colors.primarySoft, borderRadius: 10, padding: spacing.md, gap: spacing.xs },
  name: { color: colors.ink, fontSize: type.body, fontWeight: '700' },
  lineTotal: { color: colors.primaryDark, fontSize: type.body, fontWeight: '800' },
  total: { color: colors.ink, fontSize: type.heading, fontWeight: '800' }
});
