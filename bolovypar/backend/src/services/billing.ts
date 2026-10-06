export type TaxMode = 'none' | 'intra' | 'inter';

export type BillLineInput = {
  quantity_milli: number;
  rate_paise: number;
  discount_bps: number;
  gst_rate_bps: number;
};

export type BillLine = BillLineInput & {
  gross_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
};

function rounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function safeAmount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Bill amount is too large');
  return Number(value);
}

export function calculateLine(input: BillLineInput, mode: TaxMode): BillLine {
  const gross = rounded(BigInt(input.quantity_milli) * BigInt(input.rate_paise), 1000n);
  const discount = rounded(gross * BigInt(input.discount_bps), 10000n);
  const taxable = gross - discount;
  const rate = BigInt(input.gst_rate_bps);
  const cgst = mode === 'intra' ? rounded(taxable * rate, 20000n) : 0n;
  const sgst = mode === 'intra' ? rounded(taxable * rate, 20000n) : 0n;
  const igst = mode === 'inter' ? rounded(taxable * rate, 10000n) : 0n;
  return {
    ...input,
    gross_paise: safeAmount(gross),
    discount_paise: safeAmount(discount),
    taxable_paise: safeAmount(taxable),
    cgst_paise: safeAmount(cgst),
    sgst_paise: safeAmount(sgst),
    igst_paise: safeAmount(igst),
    total_paise: safeAmount(taxable + cgst + sgst + igst)
  };
}

export function sumBill(lines: BillLine[]) {
  const sum = (key: keyof BillLine) => safeAmount(lines.reduce((total, line) => total + BigInt(line[key] as number), 0n));
  return {
    subtotal_paise: sum('gross_paise'), discount_paise: sum('discount_paise'),
    taxable_paise: sum('taxable_paise'), cgst_paise: sum('cgst_paise'),
    sgst_paise: sum('sgst_paise'), igst_paise: sum('igst_paise'), total_paise: sum('total_paise')
  };
}

export function financialYear(date: Date): string {
  // Indian financial years run April 1 through March 31.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(date);
  const calendarYear = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const year = month >= 4 ? calendarYear : calendarYear - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}
