// Shared display helpers for every report table on the Reports page, so the
// overview, the report browser and the marks panel all read the same way:
// money as $1,234.50, dates as local dates, no raw keys as headings.

import type { ReportCell, ReportColumn } from '../types';

export const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

const asDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isPercentColumn = (column?: Pick<ReportColumn, 'label' | 'key'>) =>
  !!column && (/%/.test(column.label) || /(^|[a-z])(rate|percent)$/i.test(column.key));

/** One cell as a person would write it. */
export function formatCell(value: ReportCell | undefined, column?: Pick<ReportColumn, 'type' | 'label' | 'key'>): string {
  if (value === null || value === undefined || value === '') return '—';
  const type = column?.type;
  if (type === 'money') return money(Number(value));
  if (type === 'date' || (typeof value === 'string' && ISO_DATE.test(value))) {
    const d = asDate(String(value));
    return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : String(value);
  }
  if (typeof value === 'number') {
    const text = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return isPercentColumn(column) ? `${text}%` : text;
  }
  return String(value);
}

/**
 * A heading a person can read. Server labels are already words ("Admission
 * No"), but a stray key such as `className` or `fee_type` is turned into
 * "Class name" / "Fee type" rather than shown raw.
 */
export function humanizeLabel(label: string): string {
  const text = String(label ?? '').trim();
  if (!text || /\s/.test(text)) return text;
  if (!/[_-]|[a-z][A-Z]/.test(text)) return text;
  const words = text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const isNumeric = (column: ReportColumn) => column.type === 'number' || column.type === 'money';

// Counts that make sense to add up. Averages, percentages, positions and
// "out of" columns never get a total.
const NEVER_TOTAL = /%|rate|average|avg|mean|position|rank|grade|^#$|^no\.?$|highest|lowest|out of|age\b|score|^mark$|year/i;
const COUNT_LABEL = /^(students|present|absent|late|excused|not ?marked|marked|left to mark|remaining|payments?|invoices?|admissions|transfers|male|female|boys|girls|total|count|lessons|periods|classes|sections|subjects|days|sheets|records|teachers|receipts|refunds|withdrawn|new)/i;

const canTotal = (column: ReportColumn) => {
  if (column.type === 'money') return !NEVER_TOTAL.test(column.label);
  if (column.type !== 'number') return false;
  return !NEVER_TOTAL.test(column.label) && COUNT_LABEL.test(column.label.trim());
};

/**
 * Column totals for the bottom row of a table, or null when nothing in it
 * adds up sensibly (or there is only one row).
 */
export function totalsFor(columns: ReportColumn[], rows: Record<string, ReportCell>[]): Record<string, number> | null {
  if (rows.length < 2) return null;
  const totals: Record<string, number> = {};
  for (const column of columns) {
    if (!canTotal(column)) continue;
    let sum = 0;
    let any = false;
    for (const row of rows) {
      const v = row[column.key];
      if (typeof v === 'number' && Number.isFinite(v)) { sum += v; any = true; }
    }
    if (any) totals[column.key] = Math.round(sum * 100) / 100;
  }
  return Object.keys(totals).length ? totals : null;
}

/** A report whose only column is a message ("No classes are assigned to you yet ..."). */
export const messageOf = (columns: ReportColumn[]) =>
  columns.length === 1 && columns[0].key === 'message' ? columns[0].label : '';

// Summary lines that carry an amount of money (the server sends plain numbers).
// Counts such as "Fully Paid" or "Unpaid Invoices" deliberately don't match.
const MONEY_SUMMARY = /revenue|^amount\b|collected|^still (outstanding|owed)|^total (collected|outstanding|discount|refunded|receipted|billed|paid|owed)|^over \d+ days|largest balance/i;

/** A summary value with money and numbers formatted. */
export function formatSummaryValue(label: string, value: string | number): string {
  if (typeof value !== 'number') return String(value);
  if (MONEY_SUMMARY.test(label)) return money(value);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const fileNameFor = (title: string) => title.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';

export const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/** The server's message out of a failed request (an export failure arrives as a Blob). */
export const errorMessage = async (err: unknown, fallback: string) => {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try { return (JSON.parse(await data.text()) as { message?: string }).message || fallback; } catch { return fallback; }
  }
  return (data as { message?: string } | undefined)?.message || fallback;
};
