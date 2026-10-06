import { readFileSync } from 'node:fs';
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

type Row = Record<string, unknown>;
type Snapshot = { supplier: Row; retailer: Row; order: Row; lines: Row[] };
const value = (item: unknown) => String(item ?? '');
const clean = (item: unknown) => value(item).replace(/[^\x20-\x7e\u0900-\u097f]/g, ' ').replace(/\s+/g, ' ').trim();
const rupees = (item: unknown) => `Rs ${((Number(item) || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quantity = (item: unknown) => (Number(item) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const percent = (item: unknown) => `${((Number(item) || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
const address = (row: Row) => [row.address_line1, row.address_line2, row.city, row.state, row.postal_code].filter(Boolean).join(', ');
const date = (item: unknown) => {
  const parsed = new Date(value(item));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });
};

const small = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function numberWords(number: number): string {
  if (number < 20) return small[number] ?? '';
  if (number < 100) return [tens[Math.floor(number / 10)], numberWords(number % 10)].filter(Boolean).join(' ');
  if (number < 1000) return [small[Math.floor(number / 100)], 'Hundred', numberWords(number % 100)].filter(Boolean).join(' ');
  for (const [amount, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (number >= amount) return [numberWords(Math.floor(number / amount)), label, numberWords(number % amount)].filter(Boolean).join(' ');
  }
  return '';
}
function amountWords(paise: unknown): string {
  const amount = Math.max(0, Math.round(Number(paise) || 0));
  const whole = Math.floor(amount / 100);
  const fraction = amount % 100;
  return `${whole ? numberWords(whole) : 'Zero'} Rupees${fraction ? ` and ${numberWords(fraction)} Paise` : ''} Only`;
}

export async function renderOrderPdf(snapshot: Snapshot): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const hindi = await document.embedFont(readFileSync(new URL('../../assets/fonts/NotoSansDevanagariUI-Regular.ttf', import.meta.url)), { subset: true });
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.15, 0.16);
  const muted = rgb(0.35, 0.38, 0.4);
  const lineColor = rgb(0.28, 0.3, 0.31);
  const red = rgb(0.83, 0.12, 0.15);
  const pale = rgb(0.98, 0.97, 0.97);
  const isInvoice = snapshot.order.status === 'invoiced';
  const title = isInvoice ? 'TAX INVOICE' : 'ORDER CONFIRMATION';
  const number = isInvoice ? value(snapshot.order.invoice_number) : value(snapshot.order.id);
  const issueDate = isInvoice ? snapshot.order.invoice_issued_at : snapshot.order.confirmed_at;
  const left = 38;
  const right = 557;
  const columns = [left, 282, 333, 390, 448, 499, right];
  let page: PDFPage = document.addPage([595, 842]);

  const runs = (content: string, latin: PDFFont) => (content.match(/[\u0900-\u097f]+|[^\u0900-\u097f]+/g) ?? []).map((part) => ({
    part, face: /[\u0900-\u097f]/.test(part) ? hindi : latin
  }));
  const width = (content: string, face: PDFFont, size: number) => runs(content, face).reduce((sum, run) => sum + run.face.widthOfTextAtSize(run.part, size), 0);
  const write = (content: unknown, x: number, y: number, size = 9, face: PDFFont = regular, color = ink) => {
    let cursor = x;
    for (const run of runs(clean(content), face)) {
      page.drawText(run.part, { x: cursor, y, size, font: run.face, color });
      cursor += run.face.widthOfTextAtSize(run.part, size);
    }
  };
  const rightText = (content: unknown, edge: number, y: number, size = 9, face: PDFFont = regular, color = ink) => {
    const text = clean(content);
    write(text, edge - width(text, face, size), y, size, face, color);
  };
  const rule = (x1: number, y1: number, x2: number, y2: number, weight = 0.65, color = lineColor) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: weight, color });
  const box = (x: number, y: number, w: number, h: number, fill?: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y, width: w, height: h, borderWidth: 0.75, borderColor: lineColor, ...(fill ? { color: fill } : {}) });
  const wrap = (content: unknown, maxWidth: number, face: PDFFont = regular, size = 9): string[] => {
    const result: string[] = [];
    let current = '';
    for (const word of clean(content).split(' ').filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (width(candidate, face, size) <= maxWidth) { current = candidate; continue; }
      if (current) { result.push(current); current = ''; }
      let fragment = '';
      for (const char of Array.from(word)) {
        if (fragment && width(fragment + char, face, size) > maxWidth) { result.push(fragment); fragment = char; }
        else fragment += char;
      }
      current = fragment;
    }
    if (current) result.push(current);
    return result.length ? result : [''];
  };
  const lines = (content: unknown, x: number, top: number, maxWidth: number, maxLines: number, size = 9, face: PDFFont = regular, color = ink) => {
    const rows = wrap(content, maxWidth, face, size).slice(0, maxLines);
    rows.forEach((text, index) => write(text, x, top - index * (size + 3), size, face, color));
  };
  const footer = () => {
    rule(left, 61, right, 61, 1, red);
    const contact = [address(snapshot.supplier), snapshot.supplier.phone ? `Phone: ${snapshot.supplier.phone}` : ''].filter(Boolean).join(' | ');
    lines(contact, left, 47, 445, 2, 7.2, regular, muted);
  };
  const tableHeader = (top: number) => {
    box(left, top - 31, right - left, 31, pale);
    columns.slice(1, -1).forEach((x) => rule(x, top, x, top - 31));
    write('DESCRIPTION', 47, top - 19, 8, bold);
    write('HSN/SAC', 287, top - 19, 7.2, bold);
    write('QTY / UNIT', 338, top - 19, 7.2, bold);
    write('RATE', 404, top - 15, 7.2, bold);
    write('PER UNIT', 394, top - 24, 7.2, bold);
    write('DISC.', 459, top - 19, 7.2, bold);
    write('AMOUNT', 506, top - 19, 7.2, bold);
  };
  const tableGrid = (top: number, bottom: number) => {
    box(left, bottom, right - left, top - bottom);
    columns.slice(1, -1).forEach((x) => rule(x, top, x, bottom));
  };

  // The reference uses a prominent supplier header and a ruled invoice body.
  page.drawRectangle({ x: left, y: 730, width: 52, height: 76, color: red });
  write('BV', 49, 758, 24, bold, rgb(1, 1, 1));
  const supplierName = snapshot.supplier.name || 'Supplier';
  const supplierNameSize = [17, 14, 11].find((size) => wrap(supplierName, 382, bold, size).length <= 3) ?? 11;
  lines(supplierName, 105, 782, 382, 3, supplierNameSize, bold);
  lines(address(snapshot.supplier), 105, 741, 385, 2, 8, regular, muted);
  if (snapshot.supplier.gstin) rightText(`GSTIN: ${snapshot.supplier.gstin}`, right, 806, 8, bold);
  box(left, 694, right - left, 31, pale);
  write(title, 244 - width(title, bold, 15) / 2, 703, 15, bold);
  rule(450, 694, 450, 725);
  write(isInvoice ? 'Original for Recipient' : 'Customer Copy', 458, 705, 8, bold);
  box(left, 592, right - left, 102);
  rule(322, 592, 322, 694);
  write(isInvoice ? 'BILL TO / SERVICE RECIPIENT' : 'CUSTOMER / RETAILER', 47, 679, 8, bold);
  lines(snapshot.retailer.name, 47, 661, 263, 3, 9, bold);
  lines(address(snapshot.retailer), 47, 622, 263, 2, 8);
  if (snapshot.retailer.gstin) write(`GSTIN: ${snapshot.retailer.gstin}`, 47, 601, 8, bold);
  write('Date', 332, 679, 8, bold);
  rightText(date(issueDate), 547, 679, 8);
  rule(322, 668, right, 668);
  write(isInvoice ? 'Bill Number' : 'Order ID', 332, 655, 8, bold);
  lines(number, 409, 655, 138, 2, 8, bold);
  rule(322, 630, right, 630);
  write('Place of Supply', 332, 615, 8, bold);
  lines(snapshot.order.place_of_supply_state, 417, 615, 130, 2, 8);

  let top = 581;
  tableHeader(top);
  let cursor = top - 31;
  const rows = snapshot.lines.length ? snapshot.lines : [{}];
  for (const [index, line] of rows.entries()) {
    const description = `${index + 1}. ${clean(line.product_name || 'Item')}${line.source === 'one_off' ? ' (not in catalog)' : ''}`;
    const descriptionRows = wrap(description, 226, regular, 8.5);
    const noteRows = line.instructions ? wrap(`Note: ${line.instructions}`, 226, regular, 7.5) : [];
    const height = Math.max(39, 13 + descriptionRows.length * 12 + noteRows.length * 10);
    if (cursor - height < 285) {
      tableGrid(top - 31, 72);
      footer();
      page = document.addPage([595, 842]);
      write(`${title} - CONTINUED`, left, 796, 12, bold, red);
      rightText(number, right, 797, 8, bold);
      top = 775;
      tableHeader(top);
      cursor = top - 31;
    }
    const bottom = cursor - height;
    rule(left, bottom, right, bottom);
    descriptionRows.forEach((text, row) => write(text, 47, cursor - 14 - row * 12, 8.5));
    noteRows.forEach((text, row) => write(text, 47, cursor - 14 - descriptionRows.length * 12 - row * 10, 7.5, regular, muted));
    lines(line.hsn_code || '-', 287, cursor - 17, 42, 2, 8);
    lines(`${quantity(line.quantity_milli)} ${clean(line.unit_name)}`, 337, cursor - 17, 49, 2, 8);
    rightText(rupees(line.rate_paise), 444, cursor - 17, 7.4);
    rightText(percent(line.discount_bps), 494, cursor - 17, 7.6);
    rightText(rupees(line.taxable_paise), 553, cursor - 17, 7.4, bold);
    cursor = bottom;
  }
  tableGrid(top - 31, 285);
  box(left, 113, right - left, 172);
  rule(322, 113, 322, 285);
  write('Tax payable on reverse charge', 47, 268, 8);
  rightText('NO', 311, 268, 8, bold);
  rule(left, 257, 322, 257);
  write('AMOUNT IN WORDS', 47, 242, 8, bold);
  lines(amountWords(snapshot.order.total_paise), 47, 225, 264, 4, 8, bold);
  rule(left, 184, 322, 184);
  write(`For ${clean(snapshot.supplier.name)}`, 47, 169, 8, bold);
  write('Authorized Signatory', 47, 129, 8, bold);
  const orderId = value(snapshot.order.id);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    const qrData = await QRCode.toDataURL(`bolovyapar://order/${orderId}`, { errorCorrectionLevel: 'M', margin: 1, width: 256 });
    const qr = await document.embedPng(Buffer.from(qrData.split(',')[1] ?? '', 'base64'));
    page.drawImage(qr, { x: 241, y: 119, width: 63, height: 63 });
    write('SCAN ORDER', 184, 137, 7, bold);
  }
  const gstRates = [...new Set(snapshot.lines.map((line) => Number(line.gst_rate_bps) || 0))];
  const onlyGstRate = gstRates.length === 1 ? (gstRates[0] ?? 0) : 0;
  const taxLabel = (kind: 'CGST' | 'SGST' | 'IGST') => onlyGstRate > 0
    ? `${kind} ${percent(kind === 'IGST' ? onlyGstRate : onlyGstRate / 2)}`
    : kind;
  const totals: Array<[string, unknown, boolean]> = [
    ['Subtotal', snapshot.order.subtotal_paise, false],
    ['Discount', snapshot.order.discount_paise, false],
    ['Taxable Value', snapshot.order.taxable_paise, false],
    [taxLabel('CGST'), snapshot.order.cgst_paise, false],
    [taxLabel('SGST'), snapshot.order.sgst_paise, false],
    [taxLabel('IGST'), snapshot.order.igst_paise, false],
    ['Total Amount After Tax', snapshot.order.total_paise, true]
  ];
  totals.forEach(([label, amount, emphasis], index) => {
    const rowTop = 285 - index * (172 / totals.length);
    if (index) rule(322, rowTop, right, rowTop);
    if (emphasis) page.drawRectangle({ x: 323, y: 114, width: right - 324, height: 22, color: pale });
    write(label, 329, rowTop - 16, emphasis ? 8 : 8.5, emphasis ? bold : regular);
    rightText(rupees(amount), 552, rowTop - 16, emphasis ? 9 : 8, emphasis ? bold : regular);
  });
  if (!isInvoice) write('Order confirmation only. Tax invoice is issued separately.', left, 99, 8, bold, red);
  else write('Computer-generated invoice. Authorized signature may be added by the supplier.', left, 99, 7.5, regular, muted);
  footer();
  for (const [index, sheet] of document.getPages().entries()) {
    sheet.drawText(`Page ${index + 1} of ${document.getPageCount()}`, { x: 495, y: 35, size: 7.5, font: regular, color: muted });
  }
  document.setTitle(isInvoice ? `Invoice ${number}` : `Order ${number}`);
  return document.save();
}
