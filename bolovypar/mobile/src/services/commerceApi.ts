import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';
import { defaultApiUrl } from './api';
import { authenticatedFetch } from './authenticatedFetch';

export type Unit = { id: string; product_id: string; unit_name: string; standard_price_paise: number; stock_factor_milli: number; active: boolean };
export type Product = { id: string; name: string; sku: string | null; aliases: string[]; packaging: string | null;
  hsn_code: string | null; gst_rate_bps: number; stock_quantity_milli: number | null; archived_at: string | null; units: Unit[] };
export type Contact = { id: string; name: string; retailer_business_id: string | null; phone: string | null; email: string | null;
  address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null;
  gstin: string | null; notes: string | null; archived_at: string | null; prices: { product_unit_id: string; price_paise: number }[] };
export type OrderLine = { id: string; source: 'catalog' | 'one_off'; product_unit_id: string | null; product_name: string;
  hsn_code: string | null; unit_name: string; quantity_milli: number;
  rate_paise: number; discount_bps: number; gst_rate_bps: number; gross_paise: number; discount_paise: number;
  taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; instructions: string | null };
export type Order = { id: string; status: 'draft' | 'confirmed' | 'invoiced'; payment_status: 'unpaid' | 'partial' | 'paid';
  supplier_name?: string; retailer_name?: string; retailer_contact_id: string; retailer_business_id: string | null;
  place_of_supply_state: string; tax_mode: string;
  instructions: string | null; total_paise: number; paid_paise: number; subtotal_paise: number; discount_paise: number;
  taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; invoice_number: string | null;
  created_at: string; confirmed_at: string | null };
export type OrderDetail = { order: Order; lines: OrderLine[]; can_edit: boolean };
export type DocumentKind = 'confirmation' | 'invoice';
export type PdfDocument = { filename: string; blob: Blob };
export type SentBill = { id: string; order_id: string; recipient_retailer_business_id: string;
  recipient_name: string; document_kind: DocumentKind; sent_at: string };
export type ReceivedBill = { id: string; order_id: string; document_kind: DocumentKind; sent_at: string;
  total_paise: number; invoice_number: string | null; supplier_name: string; billed_to_name: string };
export type ProductInput = { name: string; sku: string | null; aliases: string[]; packaging: string | null; hsn_code: string | null;
  gst_rate_bps: number; stock_quantity_milli: number | null; units: { id?: string; unit_name: string; standard_price_paise: number; stock_factor_milli: number; active: boolean }[] };
export type ContactInput = { name: string; retailer_business_id: string | null; phone: string | null; email: string | null;
  address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null;
  gstin: string | null; notes: string | null };
export type OrderInput = { retailer_contact_id: string; place_of_supply_state: string; instructions: string | null;
  expected_total_paise?: number;
  lines: ({ source?: 'catalog'; product_unit_id: string; quantity_milli: number; rate_paise?: number;
    discount_bps: number; instructions: string | null } | { source: 'one_off'; product_name: string; unit_name: string;
      hsn_code: string | null; gst_rate_bps: number; quantity_milli: number; rate_paise: number;
      discount_bps: number; instructions: string | null })[] };
export type QuoteLine = { position: number; gst_rate_bps: number; gross_paise: number; discount_paise: number;
  taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number };
export type OrderQuote = { subtotal_paise: number; discount_paise: number; taxable_paise: number;
  cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; tax_mode: string; lines: QuoteLine[] };
export type VoiceLine = { product_name: string; quantity: number | null; unit_name: string | null; rate: number | null;
  rate_unit: string | null; discount_percent: number | null; instructions: string | null; evidence: string; confidence: number;
  price_basis?: 'per_unit' | 'line_total' | 'budget' | 'unspecified'; spoken_total?: number | null;
  ambiguous: boolean; product_id: string | null; product_unit_id: string | null; quantity_milli: number | null;
  rate_paise: number | null; discount_bps: number; rate_source: 'spoken' | 'retailer' | 'catalog' | null;
  stock_factor_milli: number | null; issues: string[];
  suggestions?: { product_id: string; name: string; score: number }[] };
export type VoiceResult = { speech: { transcript: string; language_code: string | null; provider: string };
  alternative_speech: { transcript: string; language_code: string | null; provider: string } | null;
  alternative_extraction: { items: { product_name: string; quantity: number | null; unit_name: string | null;
    rate: number | null; rate_unit: string | null; evidence: string }[] } | null;
  extraction: { retailer_name: string | null; retailer_evidence: string | null; instructions: string | null };
  matched: { retailer_contact_id: string | null; retailer_issues: string[]; lines: VoiceLine[] };
  consent_recorded_at: string; audio_retained: false };

function url(path: string) {
  if (!defaultApiUrl) throw new Error('Set EXPO_PUBLIC_API_URL to your backend address');
  return `${defaultApiUrl.replace(/\/$/, '')}/api/account/commerce${path}`;
}
async function request<T>(token: string, path: string, method = 'GET', body?: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await authenticatedFetch(token, url(path), { method, signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'object' && result.error !== null && 'message' in result.error
        ? String(result.error.message) : `API returned ${response.status}`;
      throw new Error(message);
    }
    return result as T;
  } finally { clearTimeout(timeout); }
}

async function fetchPdf(token: string, path: string, filename: string): Promise<PdfDocument> {
  const response = await authenticatedFetch(token, url(path));
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error?.message ?? 'Could not download PDF');
  }
  return { filename, blob: await response.blob() };
}

function downloadPdf(pdf: PdfDocument) {
  if (Platform.OS !== 'web') throw new Error('Use the device share sheet to save this PDF');
  const objectUrl = URL.createObjectURL(pdf.blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = pdf.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
}

function canSharePdf(pdf: PdfDocument) {
  if (Platform.OS !== 'web' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    const file = new globalThis.File([pdf.blob], pdf.filename, { type: 'application/pdf' });
    return navigator.canShare({ files: [file] });
  } catch { return false; }
}

async function sharePdf(pdf: PdfDocument) {
  if (Platform.OS === 'web') {
    if (!canSharePdf(pdf)) throw new Error('Direct PDF sharing is unavailable in this browser');
    const file = new globalThis.File([pdf.blob], pdf.filename, { type: 'application/pdf' });
    await navigator.share({ files: [file], title: pdf.filename });
    return;
  }
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device');
  const file = new File(Paths.cache, pdf.filename);
  file.write(new Uint8Array(await pdf.blob.arrayBuffer()));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Share PDF' });
}

async function pdf(token: string, order: Order, kind: DocumentKind = order.status === 'invoiced' ? 'invoice' : 'confirmation') {
  const filename = kind === 'invoice' && order.invoice_number
    ? `invoice-${order.invoice_number.replaceAll('/', '-')}.pdf` : `order-${order.id}.pdf`;
  return fetchPdf(token, `/orders/${order.id}/pdf?document=${kind}`, filename);
}

async function deliveryPdf(token: string, bill: ReceivedBill) {
  const filename = bill.document_kind === 'invoice' && bill.invoice_number
    ? `invoice-${bill.invoice_number.replaceAll('/', '-')}.pdf` : `order-${bill.order_id}.pdf`;
  return fetchPdf(token, `/deliveries/${bill.id}/pdf`, filename);
}

export const commerceApi = {
  products: (token: string, search = '') => request<{ products: Product[] }>(token, `/products?search=${encodeURIComponent(search)}`),
  saveProduct: (token: string, data: ProductInput, id?: string) => request(token, id ? `/products/${id}` : '/products', id ? 'PUT' : 'POST', data),
  addProductAlias: (token: string, id: string, alias: string) =>
    request<{ aliases: string[] }>(token, `/products/${id}/aliases`, 'POST', { alias }),
  archiveProduct: (token: string, id: string) => request(token, `/products/${id}/archive`, 'POST'),
  restoreProduct: (token: string, id: string) => request(token, `/products/${id}/restore`, 'POST'),
  contacts: (token: string) => request<{ contacts: Contact[] }>(token, '/contacts'),
  saveContact: (token: string, data: ContactInput, id?: string) => request(token, id ? `/contacts/${id}` : '/contacts', id ? 'PUT' : 'POST', data),
  archiveContact: (token: string, id: string) => request(token, `/contacts/${id}/archive`, 'POST'),
  restoreContact: (token: string, id: string) => request(token, `/contacts/${id}/restore`, 'POST'),
  setPrice: (token: string, contactId: string, unitId: string, price: number | null) =>
    request(token, `/contacts/${contactId}/prices`, 'PUT', { product_unit_id: unitId, price_paise: price }),
  orders: (token: string) => request<{ orders: Order[] }>(token, '/orders'),
  order: (token: string, id: string) => request<OrderDetail>(token, `/orders/${id}`),
  saveOrder: (token: string, data: OrderInput, id?: string) => request<{ order: string }>(token, id ? `/orders/${id}` : '/orders', id ? 'PUT' : 'POST', data),
  quoteOrder: (token: string, data: OrderInput) => request<{ quote: OrderQuote }>(token, '/orders/quote', 'POST', data),
  processVoice: async (token: string, sample: { uri: string; name: string; mimeType: string; file?: globalThis.File }): Promise<VoiceResult> => {
    if (!defaultApiUrl) throw new Error('Set EXPO_PUBLIC_API_URL to your backend address');
    const body = new FormData();
    if (Platform.OS === 'web') {
      const file = sample.file ?? new globalThis.File([await (await fetch(sample.uri)).blob()], sample.name, { type: sample.mimeType });
      body.append('audio', file, sample.name);
    } else body.append('audio', { uri: sample.uri, name: sample.name, type: sample.mimeType } as unknown as Blob);
    body.append('consent', 'true');
    const response = await authenticatedFetch(token, `${defaultApiUrl.replace(/\/$/, '')}/api/account/voice/process`, {
      method: 'POST', body
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? 'Could not process the voice sample');
    return result as VoiceResult;
  },
  confirm: (token: string, id: string) => request(token, `/orders/${id}/confirm`, 'POST'),
  invoice: (token: string, id: string) => request(token, `/orders/${id}/invoice`, 'POST'),
  payment: (token: string, id: string, paid_paise: number) => request(token, `/orders/${id}/payment`, 'PATCH', { paid_paise }),
  pdf,
  downloadPdf,
  canSharePdf,
  sharePdf,
  sentBills: (token: string, orderId: string) => request<{ deliveries: SentBill[] }>(token, `/orders/${orderId}/deliveries`),
  sendBill: (token: string, orderId: string, recipient_business_id: string, document_kind: DocumentKind,
    acknowledge_other_recipient: boolean) => request<{ delivery: { id: string; sent_at: string; already_sent: boolean } }>(
    token, `/orders/${orderId}/deliveries`, 'POST', { recipient_business_id, document_kind, acknowledge_other_recipient }),
  receivedBills: (token: string) => request<{ deliveries: ReceivedBill[] }>(token, '/deliveries'),
  deliveryPdf,
  whatsapp: (order: Order) => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(
    `${order.status === 'invoiced' ? 'Invoice ' + order.invoice_number : 'Order ' + order.id}\nTotal: Rs ${(order.total_paise / 100).toFixed(2)}\nPayment: ${order.payment_status}`)}`)
};
