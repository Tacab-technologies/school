import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock, DeviceMobile, PaperPlaneTilt, Receipt, Storefront, XCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { DatePicker, MonthPicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Panel } from '../../dashboard/components/DashboardKit';
import { parentPortalApi, type PayQuote } from '../api/parentPortalApi';
import { useParentPortal } from '../context/ParentContext';
import type { PaymentClaim } from '../../finance/monthlyTypes';

const formatUSD = (n: number) => `$${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthName = (p: string) => new Date(`${p}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

const STATUS: Record<PaymentClaim['status'], { short: string; icon: typeof Clock; className: string }> = {
  pending: { short: 'Being checked', icon: Clock, className: 'bg-tile-yellow text-tile-foreground' },
  confirmed: { short: 'Confirmed', icon: CheckCircle, className: 'bg-tile-green text-tile-foreground' },
  rejected: { short: 'Not accepted', icon: XCircle, className: 'bg-tile-pink text-tile-foreground' },
};

/**
 * Paying fees from home: the parent sends the money by mobile money or bank,
 * then tells the school here with the transaction reference. The finance
 * office checks it and confirms it, and the receipt number appears below.
 */
export default function PayFromHome({ balance, onSent }: { balance: number; onSent?: () => void }) {
  const { childId, guardianId, child, children } = useParentPortal();
  const { showToast } = useToast();
  const isParent = !guardianId; // staff viewing a parent's portal only see the history
  const [methods, setMethods] = useState<{ _id: string; name: string }[]>([]);
  const [history, setHistory] = useState<PaymentClaim[]>([]);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Which children this payment is for, and the month it pays up to.
  const [forIds, setForIds] = useState<string[]>([]);
  const [through, setThrough] = useState(thisMonth());
  const [quote, setQuote] = useState<PayQuote | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const activeChildren = children.filter((c) => c.status === 'Active' || c._id === childId);
  // No child picked = the "All children" page: one payment form and history for the family.
  const familyIds = children.map((c) => c._id).join(',');

  const loadHistory = useCallback(() => {
    if (childId) {
      parentPortalApi.getChildPayments(childId, guardianId).then(setHistory).catch(() => undefined);
      return;
    }
    if (!familyIds) return;
    // Every child's payments at once; a payment for several children shows once.
    Promise.all(familyIds.split(',').map((id) => parentPortalApi.getChildPayments(id, guardianId).catch(() => [] as PaymentClaim[])))
      .then((lists) => {
        const seen = new Map<string, PaymentClaim>();
        for (const h of lists.flat()) seen.set(h._id, h);
        setHistory([...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      });
  }, [childId, familyIds, guardianId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    if (!isParent) return;
    parentPortalApi.getPaymentMethods().then((m) => { setMethods(m); setMethod((cur) => cur || m[0]?._id || ''); }).catch(() => undefined);
  }, [isParent]);

  const start = () => {
    setAmount(balance > 0 ? String(balance) : ''); setReference(''); setNote(''); setPaidOn(today()); setError('');
    setForIds(childId ? [childId] : activeChildren.map((c) => c._id)); setThrough(thisMonth()); setAmountTouched(false); setOpen(true);
  };

  // The amount follows the children and months picked, until the parent types their own.
  useEffect(() => {
    if (!open || !isParent || !forIds.length) { setQuote(null); return; }
    let cancelled = false;
    parentPortalApi.getPayQuote(forIds, through)
      .then((q) => { if (cancelled) return; setQuote(q); if (!amountTouched) setAmount(q.total > 0 ? String(q.total) : ''); })
      .catch(() => { if (!cancelled) setQuote(null); });
    return () => { cancelled = true; };
  }, [open, isParent, forIds, through, amountTouched]);

  const send = async () => {
    if (!forIds.length) return;
    setSaving(true);
    setError('');
    try {
      await parentPortalApi.sendPayment(forIds[0], {
        amount: Number(amount), method, reference: reference.trim(), paidOn, note: note.trim() || undefined,
        students: forIds.length > 1 ? forIds : undefined,
        pay_through: through > thisMonth() ? through : undefined,
      });
      showToast('Sent. The school will check it and confirm.');
      setOpen(false);
      loadHistory();
      onSent?.();
    } catch (err) {
      setError(apiMessage(err, 'Could not send the payment. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const valid = Number(amount) > 0 && reference.trim().length >= 3 && !!method && !!paidOn && forIds.length > 0;

  return (
    <Panel title="Pay from home" description={isParent ? 'Paid by mobile money or bank? Let the school know here.' : 'Payments this parent sent from the portal.'}>
      <div className="space-y-5">
        {isParent && methods.length === 0 && (
          <div className="flex items-start gap-3 rounded-2xl bg-muted/50 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground"><Storefront size={18} /></span>
            <p className="text-sm text-muted-foreground">The school hasn’t set up mobile money or bank payments yet. Please pay at the school office.</p>
          </div>
        )}

        {isParent && methods.length > 0 && !open && (
          <div className="space-y-4 rounded-2xl bg-gradient-to-br from-tile-green via-tile-blue to-tile-violet p-4 text-tile-foreground">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card/80"><DeviceMobile size={20} weight="duotone" /></span>
              <div className="min-w-0">
                <p className="font-semibold">Sent the fees from your phone?</p>
                <p className="mt-0.5 text-xs opacity-80">Tell the school with the reference number. They check it and give you a receipt.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {methods.map((m) => (
                <span key={m._id} className="rounded-full bg-card/70 px-2.5 py-1 text-xs font-medium">{m.name}</span>
              ))}
            </div>
            <Button onClick={start} className="w-full"><PaperPlaneTilt size={16} /> I have paid</Button>
          </div>
        )}

        {open && (
          <div className="space-y-4">
            <ol className="space-y-2">
              {[
                `Send the money to the school’s ${methods.map((m) => m.name).join(' / ')} account.`,
                'Copy the reference number from the message you get back.',
                'Fill this in and press Send to school.',
              ].map((step, n) => (
                <li key={n} className="flex items-start gap-2.5 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tile-blue text-[11px] font-bold text-tile-foreground">{n + 1}</span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
            {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            {activeChildren.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Paying for</Label>
                <div className="flex flex-wrap gap-2">
                  {activeChildren.map((c) => (
                    <label key={c._id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                      <Checkbox checked={forIds.includes(c._id)}
                        onCheckedChange={(v) => setForIds((ids) => (v === true ? [...ids, c._id] : ids.filter((x) => x !== c._id)))} />
                      {c.firstName}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Pay up to and including</Label>
              <MonthPicker value={through} onChange={(v) => setThrough(v || thisMonth())} min={thisMonth()} aria-label="Pay up to month" />
              <p className="text-[11px] text-muted-foreground">Pick a later month to pay several months ahead.</p>
            </div>
            {quote && (
              <div className="space-y-1 rounded-xl bg-muted/50 p-3 text-xs">
                {quote.children.map((q) => (
                  <p key={q._id} className="flex justify-between gap-2">
                    <span>{q.name}{q.owed > 0 ? ` · owes ${formatUSD(q.owed)}` : ''}{q.monthsAhead.length ? ` · ${q.monthsAhead.length} month${q.monthsAhead.length === 1 ? '' : 's'} ahead × ${formatUSD(q.monthly)}` : ''}</span>
                    <span className="font-semibold tabular-nums">{formatUSD(q.total)}</span>
                  </p>
                ))}
                <p className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total up to {monthName(quote.through)}</span><span className="tabular-nums">{formatUSD(quote.total)}</span></p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-1.5">
                <Label htmlFor="pfh-method" className="text-xs font-semibold">How did you pay?</Label>
                <NativeSelect id="pfh-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {methods.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pfh-amount" className="text-xs font-semibold">Amount sent ($)</Label>
                <Input id="pfh-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => { setAmountTouched(true); setAmount(e.target.value); }} />
                <p className="text-[11px] text-muted-foreground">You can change it, e.g. to pay part now.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pfh-ref" className="text-xs font-semibold">Reference number</Label>
                <Input id="pfh-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From your payment message" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Day you paid</Label>
                <DatePicker value={paidOn} onChange={setPaidOn} max={today()} aria-label="Day you paid" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pfh-note" className="text-xs font-semibold">Note (optional)</Label>
              <Input id="pfh-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={child ? `e.g. October fees for ${child.firstName}` : 'e.g. October fees for all children'} />
            </div>
            <div className="flex gap-2">
              <Button onClick={send} disabled={saving || !valid} className="flex-1"><PaperPlaneTilt size={15} /> {saving ? 'Sending…' : 'Send to school'}</Button>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sent to the school</p>
          {history.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Receipt size={18} /></span>
              <p className="text-sm text-muted-foreground">Nothing sent yet. Payments you tell the school about show here with their status.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {history.map((h) => {
                const s = STATUS[h.status];
                return (
                  <li key={h._id} className="rounded-2xl border border-border/70 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold tabular-nums">{formatUSD(h.amount)}</p>
                        <p className="text-xs text-muted-foreground">{h.method} · {fmt(h.paidOn)}{h.pay_through ? ` · up to ${monthName(h.pay_through)}` : ''}{(h.students?.length ?? 0) > 1 ? ` · ${h.students!.map((s) => s.name.split(' ')[0]).join(', ')}` : !childId && h.student ? ` · ${h.student.name.split(' ')[0]}` : ''}</p>
                      </div>
                      <span className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', s.className)}><s.icon size={13} /> {s.short}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Ref <span className="font-mono">{h.reference}</span>
                      {h.receipt && <> · Receipt <span className="font-mono font-medium text-foreground">{h.receipt.receipt_no}</span></>}
                    </p>
                    {h.status === 'pending' && <p className="mt-1 text-xs text-muted-foreground">The school is checking it.</p>}
                    {h.status === 'rejected' && h.rejectReason && <p className="mt-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">School’s note: {h.rejectReason}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
