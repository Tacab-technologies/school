import type { EntryWindow } from './types';

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** When teachers may enter marks, in words. */
export function entryText(exam: { marksOpenFrom: string | null; marksOpenUntil: string | null; window: EntryWindow }) {
  const { marksOpenFrom: from, marksOpenUntil: until, window } = exam;
  if (window === 'not-yet' && from) return `Marks entry opens ${shortDay(from)}`;
  if (window === 'closed' && until) return `Marks entry closed ${shortDay(until)}`;
  if (from && until) return `Marks entry open ${shortDay(from)} – ${shortDay(until)}`;
  if (until) return `Marks entry open until ${shortDay(until)}`;
  return 'Marks entry open';
}
