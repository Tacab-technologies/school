import { useEffect, useRef } from 'react';
import { Printer, Receipt } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { printElement } from '@/lib/printElement';
import { useSchoolIdentity } from '../../settings/hooks/useSchoolIdentity';
import { money, periodLabel, type FeeReceipt } from '../monthlyTypes';

const fullName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`;

// Receipts print on A5 turned sideways (210 × 148 mm), the usual size for a
// counter receipt: small enough to hand over, wide enough for several months.
const RECEIPT_PAGE = { page: 'A5 landscape', margin: '7mm' };

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function wordsBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')); }
  else if (n > 0 || parts.length === 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** 1250.5 → "One thousand two hundred fifty dollars and 50 cents", as written on a receipt. */
export function amountInWords(amount: number): string {
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);
  const groups: string[] = [];
  const scales = [[1_000_000, 'million'], [1_000, 'thousand']] as const;
  let rest = dollars;
  for (const [size, name] of scales) {
    if (rest >= size) { groups.push(`${wordsBelowThousand(Math.floor(rest / size))} ${name}`); rest %= size; }
  }
  if (rest > 0 || groups.length === 0) groups.push(wordsBelowThousand(rest));
  const text = `${groups.join(' ')} dollar${dollars === 1 ? '' : 's'}${cents ? ` and ${cents} cent${cents === 1 ? '' : 's'}` : ''}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The paper receipt a family takes home: one per counter payment, laid out for A5 landscape. */
export function FeeReceiptView({ receipt }: { receipt: FeeReceipt }) {
  const { schoolName, logoSrc, schoolPhone, schoolEmail } = useSchoolIdentity();
  const received = new Date(receipt.received_at);

  // Group the paid months under each child.
  const byStudent = new Map<string, { name: string; admissionNumber?: string; lines: FeeReceipt['lines'] }>();
  for (const line of receipt.lines) {
    const key = line.student._id;
    if (!byStudent.has(key)) byStudent.set(key, { name: fullName(line.student), admissionNumber: line.student.admissionNumber, lines: [] });
    byStudent.get(key)!.lines.push(line);
  }
  const remaining = new Map((receipt.remainingByStudent ?? []).map((r) => [r.student, r.balance]));
  const contact = [schoolPhone, schoolEmail].filter(Boolean).join(' · ');

  const details: { label: string; value: string }[] = [
    { label: 'Paid by', value: receipt.payer_name || '—' },
    { label: 'Phone', value: receipt.payer_phone || '—' },
    { label: 'Method', value: receipt.payment_method?.payment_method_name ?? '—' },
    { label: 'Reference', value: receipt.reference || '—' },
    { label: 'Received by', value: receipt.received_by_name || '—' },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[196mm] overflow-hidden rounded-xl border border-border bg-white p-5 text-[12px] leading-snug text-neutral-900">
      {/* A faint "PAID" across the middle, so a copy is easy to tell from a bill. */}
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 select-none text-[88px] font-black tracking-widest text-emerald-600/[0.06]">PAID</span>

      {/* School and receipt number */}
      <div className="relative flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src={logoSrc} alt="" className="h-14 w-14 shrink-0 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold leading-tight">{schoolName}</p>
            {contact && <p className="mt-0.5 truncate text-[11px] text-neutral-500">{contact}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="inline-block rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">Fee receipt</p>
          <p className="mt-1.5 font-mono text-[14px] font-semibold">{receipt.receipt_no}</p>
          <p className="text-[11px] text-neutral-500">
            {received.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}
            {received.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Who paid and how */}
      <dl className="relative mt-3 grid grid-cols-5 gap-3 rounded-lg bg-neutral-100 px-3 py-2">
        {details.map((d) => (
          <div key={d.label} className="min-w-0">
            <dt className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">{d.label}</dt>
            <dd className="truncate font-medium">{d.value}</dd>
          </div>
        ))}
      </dl>

      {/* What was paid */}
      <Table className="relative mt-3 w-full text-[12px]">
        <TableHeader>
          <TableRow className="border-b border-neutral-300 hover:bg-transparent">
            <TableHead className="h-7 py-1 pl-0 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Student</TableHead>
            <TableHead className="h-7 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Paid for</TableHead>
            <TableHead className="h-7 py-1 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Still owed after</TableHead>
            <TableHead className="h-7 py-1 pr-0 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...byStudent.entries()].map(([id, s]) =>
            s.lines.map((line, i) => (
              <TableRow key={line._id} className="border-b border-neutral-200 hover:bg-transparent">
                <TableCell className="py-1.5 pl-0 align-top">
                  {i === 0 && (
                    <>
                      <p className="font-semibold">{s.name}</p>
                      {s.admissionNumber && <p className="font-mono text-[10px] text-neutral-500">{s.admissionNumber}</p>}
                    </>
                  )}
                </TableCell>
                <TableCell className="py-1.5 align-top">
                  {line.period ? periodLabel(line.period) : line.description}
                  {line.balance_after > 0 && <span className="ml-1.5 rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-800">part payment</span>}
                </TableCell>
                <TableCell className="py-1.5 text-right align-top tabular-nums text-neutral-500">
                  {line.balance_after > 0 ? money(line.balance_after) : '—'}
                </TableCell>
                <TableCell className="py-1.5 pr-0 text-right align-top font-medium tabular-nums">{money(line.amount)}</TableCell>
              </TableRow>
            )).concat(
              <TableRow key={`${id}-left`} className="hover:bg-transparent">
                <TableCell colSpan={4} className="pb-2 pl-0 pr-0 pt-1 text-right text-[11px] text-neutral-500">
                  Total still owed by {s.name.split(' ')[0]}: <span className="font-semibold text-neutral-900">{money(remaining.get(id) ?? 0)}</span>
                </TableCell>
              </TableRow>,
            ),
          )}
        </TableBody>
      </Table>

      {/* Total, in figures and words */}
      <div className="relative mt-2 flex items-stretch justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1 self-center">
          <p className="text-[11px] text-neutral-500">Amount in words</p>
          <p className="font-medium italic">{amountInWords(receipt.total)} only.</p>
          {receipt.note && <p className="pt-1 text-[11px] text-neutral-500">Note: {receipt.note}</p>}
        </div>
        <div className="shrink-0 rounded-lg border-2 border-neutral-900 px-4 py-2 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Total paid</p>
          <p className="text-[22px] font-bold leading-tight tabular-nums">{money(receipt.total)}</p>
        </div>
      </div>

      {/* Sign-off */}
      <div className="relative mt-6 flex items-end justify-between gap-6 text-[11px] text-neutral-500">
        <p>Thank you. Please keep this receipt.</p>
        <div className="flex gap-6">
          <p className="w-40 border-t border-neutral-400 pt-1 text-center">Received by (signature)</p>
          <p className="w-32 border-t border-neutral-400 pt-1 text-center">School stamp</p>
        </div>
      </div>
    </div>
  );
}

export default function FeeReceiptDialog({ receipt, onClose, autoPrint = false }: {
  receipt: FeeReceipt;
  onClose: () => void;
  /** Open the print dialog as soon as the receipt is shown (right after a payment). */
  autoPrint?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const print = () => { if (ref.current) printElement(ref.current, receipt.receipt_no, RECEIPT_PAGE); };

  useEffect(() => {
    if (!autoPrint) return;
    // Give the dialog a moment to render (and the logo to load) first.
    const t = setTimeout(() => { if (ref.current) printElement(ref.current, receipt.receipt_no, RECEIPT_PAGE); }, 400);
    return () => clearTimeout(t);
  }, [autoPrint, receipt.receipt_no]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader icon={Receipt} tint="green" className="print:hidden">
          <DialogTitle>{autoPrint ? 'Payment recorded' : `Receipt ${receipt.receipt_no}`}</DialogTitle>
          <DialogDescription>Prints on A5 paper, sideways (landscape). Give it to the family.</DialogDescription>
        </DialogHeader>
        <div ref={ref}>
          <FeeReceiptView receipt={receipt} />
        </div>
        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={print}><Printer size={15} /> Print receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
