import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateLine, financialYear, sumBill } from './billing.js';
import { renderOrderPdf } from './orderPdf.js';

test('discount, quantity and intrastate GST use deterministic paise rounding', () => {
  const line = calculateLine({ quantity_milli: 1250, rate_paise: 1999, discount_bps: 1000, gst_rate_bps: 1800 }, 'intra');
  assert.deepEqual({ gross: line.gross_paise, discount: line.discount_paise, taxable: line.taxable_paise,
    cgst: line.cgst_paise, sgst: line.sgst_paise, total: line.total_paise },
    { gross: 2499, discount: 250, taxable: 2249, cgst: 202, sgst: 202, total: 2653 });
  assert.equal(sumBill([line, line]).total_paise, 5306);
});

test('five units at ₹1000 show ₹5000 before discount and recalculate tax after discount', () => {
  const plain = calculateLine({ quantity_milli: 5000, rate_paise: 100000, discount_bps: 0, gst_rate_bps: 1800 }, 'intra');
  assert.equal(plain.gross_paise, 500000);
  assert.equal(plain.total_paise, 590000);
  const discounted = calculateLine({ quantity_milli: 5000, rate_paise: 100000, discount_bps: 1000, gst_rate_bps: 1800 }, 'intra');
  assert.deepEqual({ discount: discounted.discount_paise, taxable: discounted.taxable_paise,
    cgst: discounted.cgst_paise, sgst: discounted.sgst_paise, total: discounted.total_paise },
  { discount: 50000, taxable: 450000, cgst: 40500, sgst: 40500, total: 531000 });
});

test('interstate GST uses IGST and financial year uses India local time', () => {
  const line = calculateLine({ quantity_milli: 1000, rate_paise: 10000, discount_bps: 0, gst_rate_bps: 1200 }, 'inter');
  assert.equal(line.igst_paise, 1200);
  assert.equal(line.cgst_paise, 0);
  assert.equal(financialYear(new Date('2026-03-31T18:29:00Z')), '2025-26');
  assert.equal(financialYear(new Date('2026-03-31T18:31:00Z')), '2026-27');
});

test('confirmed order and issued invoice PDFs have distinct titles', async () => {
  const base = { supplier: { name: 'परीक्षण Supplier', address_line1: 'Street 1', state: 'Delhi' },
    retailer: { name: 'Test Retailer', address_line1: 'Street 2', state: 'Delhi' },
    order: { id: 'abc', status: 'confirmed', confirmed_at: '2026-10-01T00:00:00Z', place_of_supply_state: 'Delhi',
      subtotal_paise: 10000, discount_paise: 0, taxable_paise: 10000, cgst_paise: 900, sgst_paise: 900,
      igst_paise: 0, total_paise: 11800 },
    lines: [{ product_name: 'चावल Rice', hsn_code: '1006', quantity_milli: 1000, unit_name: 'bag', rate_paise: 10000,
      discount_bps: 0, gst_rate_bps: 1800, taxable_paise: 10000, cgst_paise: 900, sgst_paise: 900, igst_paise: 0, total_paise: 11800 }] };
  const confirmation = await renderOrderPdf(base);
  const invoice = await renderOrderPdf({ ...base, order: { ...base.order, status: 'invoiced', invoice_number: 'BV/2026-27/000001',
    invoice_issued_at: '2026-10-01T00:00:00Z' } });
  assert.equal(Buffer.from(confirmation).subarray(0, 5).toString(), '%PDF-');
  assert.equal(Buffer.from(invoice).subarray(0, 5).toString(), '%PDF-');
  assert.notDeepEqual(confirmation, invoice);
});
