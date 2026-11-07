import { useEffect, useRef } from 'react';
import { Printer, Receipt } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { printElement } from '@/lib/printElement';
import { useSchoolIdentity } from '../../settings/hooks/useSchoolIdentity';
import { amountInWords } from './FeeReceiptDialog';
import { money, periodLabel } from '../monthlyTypes';
import { dayLabel, type Payslip } from '../opsTypes';

// Same paper as the fee receipts: A5 turned sideways.
const PAYSLIP_PAGE = { page: 'A5 landscape', margin: '7mm' };

function Amount({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-neutral-200 py-1.5 last:border-0">
      <span className={strong ? 'font-semibold' : 'text-neutral-500'}>{label}</span>
      <span className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}

/** The paper payslip a member of staff takes home, one per payment. */
function PayslipView({ slip }: { slip: Payslip }) {
  const { schoolName, logoSrc, schoolPhone, schoolEmail } = useSchoolIdentity();
  const contact = [schoolPhone, schoolEmail].filter(Boolean).join(' · ');

  const details = [
    { label: 'Paid to', value: slip.name },
    { label: 'Staff ID', value: slip.staffId || '—' },
    { label: 'For', value: periodLabel(slip.period) },
    { label: 'Method', value: slip.method || '—' },
    { label: 'Paid by', value: slip.paid_by || '—' },
  ];

  return (
    <div className="mx-auto w-full max-w-[196mm] break-after-page rounded-xl border border-border bg-white p-5 text-[12px] leading-snug text-neutral-900 last:break-after-auto">
      <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src={logoSrc} alt="" className="h-14 w-14 shrink-0 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold leading-tight">{schoolName}</p>
            {contact && <p className="mt-0.5 truncate text-[11px] text-neutral-500">{contact}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="inline-block rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">Payslip</p>
          <p className="mt-1.5 font-mono text-[14px] font-semibold">{slip.payslip_no}</p>
          <p className="text-[11px] text-neutral-500">{dayLabel(slip.paid_on)}</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-5 gap-3 rounded-lg bg-neutral-100 px-3 py-2">
        {details.map((d) => (
          <div key={d.label} className="min-w-0">
            <dt className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">{d.label}</dt>
            <dd className="truncate font-medium">{d.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex items-stretch justify-between gap-6">
        <div className="min-w-0 flex-1">
          <Amount label="Salary" value={money(slip.basic)} />
          {slip.allowance > 0 && <Amount label="Allowance" value={`+${money(slip.allowance)}`} />}
          {slip.deduction > 0 && <Amount label="Deduction" value={`−${money(slip.deduction)}`} />}
          <Amount label="Pay for the month" value={money(slip.net)} strong />
          {slip.remaining > 0 && <Amount label="Still to pay after this" value={money(slip.remaining)} />}
        </div>
        <div className="flex shrink-0 flex-col justify-center rounded-lg border-2 border-neutral-900 px-4 py-2 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{slip.amount < slip.net ? 'Paid now' : 'Paid'}</p>
          <p className="text-[22px] font-bold leading-tight tabular-nums">{money(slip.amount)}</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-neutral-500">Amount in words</p>
      <p className="font-medium italic">{amountInWords(slip.amount)} only.</p>
      {slip.note && <p className="pt-1 text-[11px] text-neutral-500">Note: {slip.note}</p>}

      <div className="mt-6 flex justify-end gap-6 text-[11px] text-neutral-500">
        <p className="w-40 border-t border-neutral-400 pt-1 text-center">Received by (signature)</p>
        <p className="w-32 border-t border-neutral-400 pt-1 text-center">School stamp</p>
      </div>
    </div>
  );
}

export default function PayslipDialog({ payslips, onClose, autoPrint = false }: {
  payslips: Payslip[];
  onClose: () => void;
  /** Open the print dialog as soon as the payslips are shown (right after paying). */
  autoPrint?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const title = payslips.length === 1 ? payslips[0].payslip_no : 'Payslips';
  const print = () => { if (ref.current) printElement(ref.current, title, PAYSLIP_PAGE); };

  useEffect(() => {
    if (!autoPrint) return;
    // Give the dialog a moment to render (and the logo to load) first.
    const t = setTimeout(() => { if (ref.current) printElement(ref.current, title, PAYSLIP_PAGE); }, 400);
    return () => clearTimeout(t);
  }, [autoPrint, title]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader icon={Receipt} tint="green" className="print:hidden">
          <DialogTitle>{autoPrint ? 'Salary paid' : payslips.length === 1 ? `Payslip ${payslips[0].payslip_no}` : `${payslips.length} payslips`}</DialogTitle>
          <DialogDescription>Prints on A5 paper, sideways (landscape). Give it to the member of staff.</DialogDescription>
        </DialogHeader>
        <div ref={ref} className="space-y-4">
          {payslips.map((p) => <PayslipView key={p._id} slip={p} />)}
        </div>
        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={print}><Printer size={15} /> Print {payslips.length === 1 ? 'payslip' : 'payslips'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
