import { useCallback, useEffect, useState } from 'react';
import { ArrowUUpLeft, CheckCircle, Coins, MagnifyingGlass, Plus, Receipt, SpinnerGap } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import StatStrip from '@/components/shared/StatStrip';
import { EmptyState, ErrorState } from '@/components/common/EmptyState';
import { confirmAction } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/hooks/use-toast';
import { useCan } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';
import { financeApi } from '../api/financeApi';
import { apiError, monthlyFeesApi } from '../api/monthlyFeesApi';
import { financeOpsApi } from '../api/financeOpsApi';
import { money, periodLabel, thisPeriod } from '../monthlyTypes';
import { dayLabel, type RefundablePayment } from '../opsTypes';
import type { PaymentMethod, Refund } from '../types';

/** Money handed back to families: the list, and refunding a payment. */
export default function RefundsTab({ paymentMethods }: { paymentMethods: PaymentMethod[] }) {
  const canRefund = useCan('fees', 'create');
  const { showToast } = useToast();
  const [period, setPeriod] = useState(thisPeriod());
  const [refunds, setRefunds] = useState<Refund[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRefunds(await financeApi.getRefunds({ period: period || undefined }));
    } catch (err) {
      setError(apiError(err, 'Could not load the refunds.'));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const reverse = async (r: Refund) => {
    const ok = await confirmAction({
      title: `Cancel refund ${r.refund_no}?`,
      text: `Use this if the ${money(r.amount)} was not really handed back. The payment counts as paid again.`,
      confirmLabel: 'Cancel refund',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await financeApi.reverseRefund(r._id);
      showToast('Refund cancelled.', 'success');
      load();
    } catch (err) {
      showToast(apiError(err, 'Could not cancel this refund.'), 'error');
    }
  };

  const scope = period ? periodLabel(period) : 'All months';
  const issued = (refunds ?? []).filter((r) => r.status === 'issued');
  const total = issued.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-5">
      <Card className="border-border shadow-xs">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="rf-month" className="text-xs">Month</Label>
            <MonthPicker id="rf-month" value={period} max={thisPeriod()} clearable placeholder="All months" onChange={setPeriod} className="w-48" />
          </div>
          {loading && <SpinnerGap size={18} className="mb-2.5 animate-spin text-primary" />}
          {canRefund && <Button className="ml-auto" onClick={() => setRefunding(true)}><Plus size={15} /> Refund a payment</Button>}
        </CardContent>
      </Card>

      {error && <Card className="border-border shadow-xs"><ErrorState text={error} onRetry={load} /></Card>}

      {refunds && !error && (
        <>
          <StatStrip items={[
            { label: 'Refunded', value: money(total), icon: Coins, tone: 'rose', hint: scope },
            { label: 'Refunds', value: issued.length, icon: Receipt, tone: 'sky', hint: 'Handed back' },
            { label: 'Cancelled', value: refunds.length - issued.length, icon: CheckCircle, tone: 'muted', hint: 'Recorded by mistake' },
          ]} />

          <Card className="overflow-hidden border-border shadow-xs">
            {refunds.length === 0 ? (
              <EmptyState icon={ArrowUUpLeft} text={`No refunds for ${period ? scope : 'any month'}.`} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Refund</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      {canRefund && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {refunds.map((r) => (
                      <TableRow key={r._id}>
                        <TableCell className="font-mono text-xs font-medium">{r.refund_no}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{dayLabel(r.refundDate)}</TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{r.student ? `${r.student.firstName} ${r.student.lastName}` : '—'}</p>
                          <p className="text-xs text-muted-foreground">{r.student?.classId?.cl_name ?? ''}</p>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm">{r.reason}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.payment_method_no?.payment_method_name ?? '—'}</TableCell>
                        <TableCell className={cn('text-right font-semibold tabular-nums', r.status === 'reversed' && 'text-muted-foreground line-through')}>{money(r.amount)}</TableCell>
                        <TableCell>
                          {r.status === 'issued' ? <StatusBadge status="Refunded" tone="info" /> : <StatusBadge status="Cancelled" tone="neutral" />}
                        </TableCell>
                        {canRefund && (
                          <TableCell className="text-right">
                            {r.status === 'issued' && <Button size="xs" variant="ghost" onClick={() => reverse(r)}>Cancel</Button>}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      {refunding && (
        <RefundDialog paymentMethods={paymentMethods} onClose={() => setRefunding(false)}
          onDone={() => { setRefunding(false); showToast('Refund recorded.', 'success'); load(); }} />
      )}
    </div>
  );
}

/** Find the student, pick the payment, say how much and why. */
function RefundDialog({ paymentMethods, onClose, onDone }: {
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 300);
  const [found, setFound] = useState<Awaited<ReturnType<typeof monthlyFeesApi.searchStudents>>>([]);
  const [student, setStudent] = useState<{ _id: string; name: string } | null>(null);
  const [payments, setPayments] = useState<RefundablePayment[] | null>(null);
  const [payment, setPayment] = useState<RefundablePayment | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [methodId, setMethodId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (debounced.trim().length < 2) { setFound([]); return; }
    let cancelled = false;
    monthlyFeesApi.searchStudents(debounced).then((r) => { if (!cancelled) setFound(r); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [debounced]);

  useEffect(() => {
    if (!student) { setPayments(null); return; }
    let cancelled = false;
    financeOpsApi.getRefundablePayments(student._id)
      .then((r) => { if (!cancelled) setPayments(r); })
      .catch((err) => { if (!cancelled) setError(apiError(err, 'Could not load this student’s payments.')); });
    return () => { cancelled = true; };
  }, [student]);

  const pick = (p: RefundablePayment) => {
    setPayment(p);
    setAmount(String(p.refundable));
    setMethodId(p.methodId ?? '');
  };

  const value = Number(amount);
  const tooMuch = !!payment && value > payment.refundable;
  const valid = !!payment && value > 0 && !tooMuch && !!reason.trim() && !saving;

  const save = async () => {
    if (!payment) return;
    setSaving(true);
    setError(null);
    try {
      await financeApi.createRefund({ student_fee_no: payment._id, amount: value, reason: reason.trim(), payment_method_no: methodId || undefined });
      onDone();
    } catch (err) {
      setError(apiError(err, 'Could not record this refund.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={ArrowUUpLeft} tint="yellow">
          <DialogTitle>Refund a payment</DialogTitle>
          <DialogDescription>{student ? `For ${student.name}` : 'Find the student by name, admission number or parent.'}</DialogDescription>
        </DialogHeader>

        {!student ? (
          <div className="space-y-3">
            <div className="relative">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or admission number" className="pl-9" aria-label="Find student" />
            </div>
            <div className="space-y-1">
              {found.map((s) => (
                <Button key={s._id} variant="plain" type="button" onClick={() => setStudent(s)}
                  className="flex h-auto w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-left hover:bg-muted/60">
                  <span>
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{s.admissionNumber}{s.className ? ` · ${s.className}` : ''}{s.parentName ? ` · ${s.parentName}` : ''}</span>
                  </span>
                </Button>
              ))}
              {debounced.trim().length >= 2 && found.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No student matches “{debounced}”.</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Which payment?</p>
              {!payments && !error && <div className="flex justify-center py-6"><SpinnerGap size={20} className="animate-spin text-primary" /></div>}
              {payments?.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">This student has no payments to refund.</p>}
              <div className="space-y-1">
                {payments?.map((p) => (
                  <Button key={p._id} variant="plain" type="button" disabled={p.refundable <= 0} onClick={() => pick(p)}
                    className={cn('flex h-auto w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left disabled:opacity-50',
                      payment?._id === p._id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60')}>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{p.period ? periodLabel(p.period) : p.description}</span>
                      <span className="block text-xs text-muted-foreground">{p.receipt_no} · {dayLabel(p.paidOn)}{p.method ? ` · ${p.method}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">{money(p.paid)}</span>
                      {p.refunded > 0 && <span className="block text-xs text-muted-foreground">{money(p.refunded)} refunded</span>}
                    </span>
                  </Button>
                ))}
              </div>
            </div>

            {payment && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-amount" className="text-xs font-semibold">Amount to give back</Label>
                    <Input id="rf-amount" type="number" min={0} max={payment.refundable} value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <p className={cn('text-xs', tooMuch ? 'text-destructive' : 'text-muted-foreground')}>At most {money(payment.refundable)}.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-method" className="text-xs font-semibold">Paid back by</Label>
                    <NativeSelect id="rf-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                      {paymentMethods.map((m) => <option key={m._id} value={m._id}>{m.payment_method_name}</option>)}
                    </NativeSelect>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rf-reason" className="text-xs font-semibold">Reason</Label>
                  <Input id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the money is going back" />
                </div>
                <p className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                  {payment.period ? periodLabel(payment.period) : 'This bill'} will show {money(value > 0 ? value : 0)} as owed again.
                </p>
              </>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={saving}
            onClick={student ? () => { setStudent(null); setPayment(null); setError(null); } : onClose}>
            {student ? 'Back' : 'Cancel'}
          </Button>
          {student && <Button onClick={save} disabled={!valid}>{saving && <SpinnerGap size={15} className="animate-spin" />} Give back {money(value > 0 ? value : 0)}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
