import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Clock, CurrencyDollar, HandCoins, PencilSimple, Printer, SpinnerGap, Users, Wallet } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker, MonthPicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import StatStrip from '@/components/shared/StatStrip';
import { EmptyState, ErrorState } from '@/components/common/EmptyState';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { apiError } from '../api/monthlyFeesApi';
import { financeOpsApi } from '../api/financeOpsApi';
import PayslipDialog from './PayslipDialog';
import { money, periodLabel, thisPeriod } from '../monthlyTypes';
import { dayLabel, today, type PayStatus, type Payroll, type PayrollRow, type Payslip } from '../opsTypes';
import type { PaymentMethod } from '../types';

const STATUS_TONE: Record<PayStatus, StatusTone> = { Paid: 'success', 'Part paid': 'warning', 'Not paid': 'destructive' };

interface Extras { allowance: string; deduction: string }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** This person's pay for the month once the allowance and deduction boxes are counted. */
const netOf = (r: PayrollRow, extras?: Extras) => {
  if (r.paid > 0 || !extras) return r.net;
  return round2(r.basic + (Number(extras.allowance) || 0) - (Number(extras.deduction) || 0));
};

/** Monthly salaries and paying them: pick a month, then pay one person or tick many. */
export default function SalariesTab({ paymentMethods }: { paymentMethods: PaymentMethod[] }) {
  const { showToast } = useToast();
  const [period, setPeriod] = useState(thisPeriod());
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // What was typed in each row's allowance and deduction boxes, until it is paid.
  const [extras, setExtras] = useState<Record<string, Extras>>({});
  const [paying, setPaying] = useState<PayrollRow[] | null>(null);
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const [slips, setSlips] = useState<{ payslips: Payslip[]; justPaid: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayroll(await financeOpsApi.getPayroll(period));
    } catch (err) {
      setError(apiError(err, 'Could not load the salaries.'));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setSelected([]);
    setExtras({});
    load();
  }, [load]);

  // Office staff stay out of the way until they have a salary or the box is ticked.
  const rows = useMemo(() => (payroll?.rows ?? []).filter((r) =>
    showAll || r.kind === 'teacher' || r.salary !== null || r.payslips.length > 0
  ), [payroll, showAll]);
  const payable = rows.filter((r) => r.remaining > 0 && r.salary !== null);
  const picked = payable.filter((r) => selected.includes(r.user));
  const hiddenStaff = (payroll?.rows.length ?? 0) - rows.length;

  const setExtra = (user: string, key: keyof Extras, value: string) => setExtras((all) => ({
    ...all,
    [user]: { ...(all[user] ?? { allowance: '', deduction: '' }), [key]: value },
  }));

  const paid = (payslips: Payslip[], failed: { message: string }[]) => {
    setPaying(null);
    setSelected([]);
    setExtras({});
    if (failed.length) showToast(`${failed.length} could not be paid: ${failed[0].message}`, 'error');
    setSlips({ payslips, justPaid: true });
    load();
  };

  const s = payroll?.summary;

  return (
    <div className="space-y-5">
      <Card className="border-border shadow-xs">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="pr-month" className="text-xs">Month</Label>
            <MonthPicker id="pr-month" value={period} max={thisPeriod()} onChange={(v) => v && setPeriod(v)} className="w-48" />
          </div>
          {hiddenStaff > 0 || showAll ? (
            <Label className="mb-2.5 flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={showAll} onCheckedChange={(v) => setShowAll(v === true)} />
              Show office staff without a salary
            </Label>
          ) : null}
          <Button className="ml-auto" disabled={!picked.length} onClick={() => setPaying(picked)}>
            <HandCoins size={15} /> Pay {picked.length || ''} selected
          </Button>
        </CardContent>
      </Card>

      {error && <Card className="border-border shadow-xs"><ErrorState text={error} onRetry={load} /></Card>}

      {s && !error && (
        <StatStrip items={[
          { label: 'On the payroll', value: s.people, icon: Users, tone: 'muted', hint: 'With a salary this month' },
          { label: 'To pay', value: money(s.due), icon: CurrencyDollar, tone: 'sky', hint: periodLabel(period) },
          { label: 'Paid', value: money(s.paid), icon: CheckCircle, tone: 'emerald', hint: `${s.fullyPaid} of ${s.people} fully paid` },
          { label: 'Left to pay', value: money(s.remaining), icon: Clock, tone: 'rose', hint: periodLabel(period, true) },
        ]} />
      )}

      {payroll && !error && (
        <Card className="overflow-hidden border-border shadow-xs">
          {loading && !rows.length ? (
            <div className="flex justify-center py-12"><SpinnerGap size={22} className="animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Users} text="No teachers yet. Add teachers first, then set their salaries here." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox aria-label="Select everyone left to pay"
                        checked={payable.length > 0 && picked.length === payable.length}
                        onCheckedChange={(v) => setSelected(v === true ? payable.map((r) => r.user) : [])} />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Salary</TableHead>
                    <TableHead className="text-right">Allowance</TableHead>
                    <TableHead className="text-right">Deduction</TableHead>
                    <TableHead className="text-right">To pay</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Left</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const locked = r.paid > 0;
                    const noSalary = r.salary === null;
                    const net = netOf(r, extras[r.user]);
                    const canPay = r.remaining > 0 && !noSalary;
                    return (
                      <TableRow key={r.user}>
                        <TableCell>
                          {canPay && (
                            <Checkbox aria-label={`Select ${r.name}`} checked={selected.includes(r.user)}
                              onCheckedChange={(v) => setSelected((all) => (v === true ? [...all, r.user] : all.filter((id) => id !== r.user)))} />
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{r.name}</p>
                          <p className="text-xs text-muted-foreground">{r.staffId || (r.kind === 'teacher' ? 'Teacher' : (r.role ?? 'Staff').replace(/_/g, ' '))}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="xs" variant="ghost" onClick={() => setEditing(r)} className="tabular-nums">
                            {noSalary ? 'Set salary' : money(r.salary)} <PencilSimple size={12} />
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          {locked || noSalary ? <span className="tabular-nums text-muted-foreground">{r.allowance ? money(r.allowance) : '—'}</span> : (
                            <Input type="number" min={0} value={extras[r.user]?.allowance ?? ''} placeholder="0" aria-label={`Allowance for ${r.name}`}
                              onChange={(e) => setExtra(r.user, 'allowance', e.target.value)} className="ml-auto h-8 w-20 text-right text-sm" />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {locked || noSalary ? <span className="tabular-nums text-muted-foreground">{r.deduction ? money(r.deduction) : '—'}</span> : (
                            <Input type="number" min={0} value={extras[r.user]?.deduction ?? ''} placeholder="0" aria-label={`Deduction for ${r.name}`}
                              onChange={(e) => setExtra(r.user, 'deduction', e.target.value)} className="ml-auto h-8 w-20 text-right text-sm" />
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{noSalary ? '—' : money(net)}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{money(r.paid)}</TableCell>
                        <TableCell className={cn('text-right font-semibold tabular-nums', !noSalary && r.remaining > 0 && 'text-destructive')}>
                          {noSalary ? '—' : money(locked ? r.remaining : net)}
                        </TableCell>
                        <TableCell>
                          {noSalary ? <span className="text-xs text-muted-foreground">No salary set</span> : <StatusBadge status={r.status} tone={STATUS_TONE[r.status]} />}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {canPay && <Button size="xs" variant="outline" onClick={() => setPaying([r])}>{locked ? 'Pay the rest' : 'Pay'}</Button>}
                            {r.payslips.length > 0 && (
                              <Button size="icon-sm" variant="ghost" aria-label={`Payslips for ${r.name}`} onClick={() => setSlips({ payslips: r.payslips, justPaid: false })}>
                                <Printer size={15} />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {paying && (
        <PayDialog period={period} rows={paying} extras={extras} paymentMethods={paymentMethods}
          onClose={() => setPaying(null)} onPaid={paid} />
      )}
      {editing && <SalaryDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {slips && <PayslipDialog payslips={slips.payslips} autoPrint={slips.justPaid} onClose={() => setSlips(null)} />}
    </div>
  );
}

/** Choose how and when the money was paid, then pay everyone in `rows`. */
function PayDialog({ period, rows, extras, paymentMethods, onClose, onPaid }: {
  period: string;
  rows: PayrollRow[];
  extras: Record<string, Extras>;
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  onPaid: (payslips: Payslip[], failed: { message: string }[]) => void;
}) {
  const single = rows.length === 1 ? rows[0] : null;
  const leftFor = (r: PayrollRow) => (r.paid > 0 ? r.remaining : netOf(r, extras[r.user]));
  const [methodId, setMethodId] = useState(() => (paymentMethods.find((m) => /cash/i.test(m.payment_method_name)) ?? paymentMethods[0])?._id ?? '');
  const [paidOn, setPaidOn] = useState(today());
  const [amount, setAmount] = useState(single ? String(leftFor(single)) : '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = single ? Number(amount) : round2(rows.reduce((s, r) => s + leftFor(r), 0));
  const left = single ? leftFor(single) : total;
  const partly = !!single && Number(amount) > 0 && Number(amount) < left;
  const valid = total > 0 && total <= left + 0.001 && !!methodId && !!paidOn && !saving;

  const pay = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await financeOpsApi.paySalaries({
        period,
        payment_method: methodId,
        paid_on: paidOn,
        items: rows.map((r) => {
          const typed = extras[r.user];
          return {
            user: r.user,
            ...(single ? { amount: Number(amount) } : {}),
            ...(r.paid === 0 && typed ? { allowance: Number(typed.allowance) || 0, deduction: Number(typed.deduction) || 0 } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          };
        }),
      });
      onPaid(result.payslips, result.failed);
    } catch (err) {
      setError(apiError(err, 'Could not pay. Nothing was recorded.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={Wallet} tint="green">
          <DialogTitle>{single ? `Pay ${single.name}` : `Pay ${rows.length} people`}</DialogTitle>
          <DialogDescription>Salary for {periodLabel(period)}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {single ? (
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount" className="text-xs font-semibold">Amount to pay now</Label>
              <Input id="pay-amount" type="number" min={0} max={left} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className={cn('text-xs', partly ? 'text-warning' : 'text-muted-foreground')}>
                {partly ? `Part payment: ${money(round2(left - Number(amount)))} will stay left to pay.` : `${money(left)} is left to pay for this month.`}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border">
              {rows.map((r) => (
                <div key={r.user} className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                  <span>{r.name}</span>
                  <span className="tabular-nums">{money(leftFor(r))}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 bg-muted/40 px-3 py-2 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(total)}</span>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-method" className="text-xs font-semibold">Paid by</Label>
              <NativeSelect id="pay-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {paymentMethods.map((m) => <option key={m._id} value={m._id}>{m.payment_method_name}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Date</Label>
              <DatePicker value={paidOn} onChange={setPaidOn} max={today()} aria-label="Date paid" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-note" className="text-xs font-semibold">Note (optional)</Label>
            <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown on the payslip" />
          </div>
          {paymentMethods.length === 0 && <p className="text-sm text-destructive">Add a payment method in Setup first.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={pay} disabled={!valid}>
            {saving ? <SpinnerGap size={15} className="animate-spin" /> : <HandCoins size={15} />}
            Pay {money(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Set or change someone's monthly salary; earlier amounts stay listed. */
function SalaryDialog({ row, onClose, onSaved }: { row: PayrollRow; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(row.salary === null ? '' : String(row.salary));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);
  const valid = amount !== '' && value >= 0 && value !== row.salary && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await financeOpsApi.setSalary(row.user, value);
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Could not save the salary.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={CurrencyDollar} tint="blue">
          <DialogTitle>Monthly salary</DialogTitle>
          <DialogDescription>{row.name}. A new amount applies to months not yet paid.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sal-amount" className="text-xs font-semibold">Amount per month</Label>
            <Input id="sal-amount" type="number" min={0} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {row.salaryHistory.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Changes</p>
              <div className="rounded-lg border border-border">
                {[...row.salaryHistory].reverse().map((h) => (
                  <div key={h.changed_at} className="flex justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                    <span className="tabular-nums">{money(h.amount)}</span>
                    <span className="text-xs text-muted-foreground">{dayLabel(h.changed_at)}{h.changed_by ? ` · ${h.changed_by}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!valid}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
