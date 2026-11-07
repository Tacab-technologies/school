import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, DeviceMobile, Receipt, XCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { MonthPicker } from '@/components/ui/date-picker';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TableEmptyRow, TableLoadingRows, ErrorState } from '@/components/common/EmptyState';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { monthlyFeesApi, apiError } from '../api/monthlyFeesApi';
import { addMonths, money, type AccountStudent, type FeeReceipt, type PaymentClaim } from '../monthlyTypes';
import type { PaymentMethod } from '../types';
import FeeReceiptDialog from './FeeReceiptDialog';

type View = PaymentClaim['status'] | 'all';
const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const STATUS: Record<PaymentClaim['status'], { label: string; className: string }> = {
  pending: { label: 'To check', className: 'bg-tile-yellow text-tile-foreground' },
  confirmed: { label: 'Confirmed', className: 'bg-tile-green text-tile-foreground' },
  rejected: { label: 'Rejected', className: 'bg-tile-pink text-tile-foreground' },
};

/**
 * Payments parents sent from home by mobile money or bank. Check the money
 * arrived (match the reference in your EVC / Zaad / bank messages), then
 * confirm it to record the payment and make the receipt, or reject it with a reason.
 */
export default function ParentPaymentsTab({ paymentMethods, onChanged }: { paymentMethods: PaymentMethod[]; onChanged?: (pending: number) => void }) {
  const [view, setView] = useState<View>('pending');
  const [rows, setRows] = useState<PaymentClaim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PaymentClaim | null>(null);
  const [rejecting, setRejecting] = useState<PaymentClaim | null>(null);
  const [receipt, setReceipt] = useState<FeeReceipt | null>(null);

  const load = useCallback(() => {
    setError(null);
    monthlyFeesApi.listPaymentClaims(view === 'all' ? undefined : view)
      .then((d) => { setRows(d.claims); onChanged?.(d.pending); })
      .catch((err) => setError(apiError(err, 'Could not load the payments parents sent.')));
  }, [view, onChanged]);

  useEffect(() => { setRows(null); load(); }, [load]);

  const openReceipt = async (id: string) => {
    try { setReceipt(await monthlyFeesApi.getReceipt(id)); } catch { /* the row stays as it is */ }
  };

  return (
    <Card className="rounded-2xl border-border/70 shadow-none">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Payments from parents</CardTitle>
          <CardDescription className="text-xs">Parents who paid by EVC, Zaad, eDahab or bank send the reference here. Check the money arrived, then confirm it.</CardDescription>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-9">
            <TabsTrigger value="pending" className="px-3 py-1 text-xs">To check</TabsTrigger>
            <TabsTrigger value="confirmed" className="px-3 py-1 text-xs">Confirmed</TabsTrigger>
            <TabsTrigger value="rejected" className="px-3 py-1 text-xs">Rejected</TabsTrigger>
            <TabsTrigger value="all" className="px-3 py-1 text-xs">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="p-0">
        {error ? <ErrorState text={error} onRetry={load} /> : (
          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wider hover:bg-muted/50">
                  <TableHead className="pl-5 font-semibold">Student</TableHead>
                  <TableHead className="font-semibold">Parent</TableHead>
                  <TableHead className="text-right font-semibold">Amount</TableHead>
                  <TableHead className="font-semibold">Paid by</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="pr-5 text-right font-semibold"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows === null ? <TableLoadingRows columns={6} /> : rows.length === 0 ? (
                  <TableEmptyRow colSpan={6} icon={DeviceMobile} tint="yellow"
                    title={view === 'pending' ? 'Nothing to check' : 'No payments here'}
                    text={view === 'pending' ? 'When a parent sends a payment from the parent portal, it shows here.' : 'Payments parents send from the portal show here once checked.'} />
                ) : rows.map((r) => (
                  <TableRow key={r._id}>
                    <TableCell className="py-3 pl-5">
                      <p className="font-medium">{(r.students?.length ?? 0) > 1 ? r.students!.map((s) => s.name).join(', ') : r.student?.name ?? 'Removed student'}</p>
                      <p className="text-xs text-muted-foreground">{r.student?.admissionNumber}{r.student?.className ? ` · ${r.student.className}` : ''}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{r.parent?.name}</p>
                      <p className="text-xs text-muted-foreground">{r.payerPhone || r.parent?.phone}</p>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(r.amount)}</TableCell>
                    <TableCell>
                      <p className="text-sm">{r.method} · <span className="font-mono text-xs">{r.reference}</span></p>
                      <p className="text-xs text-muted-foreground">Paid {fmt(r.paidOn)}{r.note ? ` · ${r.note}` : ''}</p>
                    </TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS[r.status].className)}>{STATUS[r.status].label}</span>
                      {r.status === 'rejected' && r.rejectReason && <p className="mt-1 max-w-[200px] text-xs text-muted-foreground">{r.rejectReason}</p>}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      {r.status === 'pending' && (
                        <div className="flex justify-end gap-1.5">
                          <Button size="xs" onClick={() => setConfirming(r)}><CheckCircle size={14} /> Confirm</Button>
                          <Button size="xs" variant="outline" onClick={() => setRejecting(r)}><XCircle size={14} /> Reject</Button>
                        </div>
                      )}
                      {r.status === 'confirmed' && r.receipt && (
                        <Button size="xs" variant="ghost" onClick={() => openReceipt(r.receipt!._id)}><Receipt size={14} /> {r.receipt.receipt_no}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {confirming && (
        <ConfirmDialog claim={confirming} paymentMethods={paymentMethods} onClose={() => setConfirming(null)}
          onDone={(r) => { setConfirming(null); setReceipt(r); load(); }} />
      )}
      {rejecting && <RejectDialog claim={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} />}
      {receipt && <FeeReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />}
    </Card>
  );
}

function ConfirmDialog({ claim, paymentMethods, onClose, onDone }: {
  claim: PaymentClaim; paymentMethods: PaymentMethod[]; onClose: () => void; onDone: (receipt: FeeReceipt) => void;
}) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState(String(claim.amount));
  const [methodId, setMethodId] = useState(() => paymentMethods.find((m) => m.payment_method_name === claim.method)?._id ?? '');
  const [student, setStudent] = useState<AccountStudent | null>(null);
  const [current, setCurrent] = useState('');
  const [payThrough, setPayThrough] = useState(claim.pay_through ?? '');
  const family = (claim.students?.length ?? 0) > 1;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claim.student) return;
    monthlyFeesApi.getAccount(claim.student._id).then((acc) => {
      const s = acc.students.find((x) => x._id === claim.student!._id) ?? null;
      setStudent(s);
      setCurrent(acc.currentPeriod);
      const extra = Number(claim.amount) - (s?.totalOwed ?? 0);
      if (!claim.pay_through && s?.monthlyFee && s.monthlyFee.net > 0 && extra > 0.001) {
        setPayThrough(addMonths(acc.currentPeriod, Math.ceil(extra / s.monthlyFee.net)));
      }
    }).catch(() => undefined);
  }, [claim]);

  const value = Number(amount);
  // For a payment covering several children the server works out what is owed across them.
  const overOwed = !family && student ? value > student.totalOwed + 0.001 : false;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await monthlyFeesApi.confirmPaymentClaim(claim._id, {
        amount: value !== claim.amount ? value : undefined,
        payment_method: methodId || undefined,
        pay_through: (overOwed || claim.pay_through) && payThrough ? payThrough : undefined,
      });
      showToast(`Payment confirmed. Receipt ${res.receipt.receipt_no} made.`);
      onDone(res.receipt);
    } catch (err) {
      setError(apiError(err, 'Could not confirm the payment.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={CheckCircle} tint="green">
          <DialogTitle>Confirm payment</DialogTitle>
          <DialogDescription>Only confirm once you can see this money in your {claim.method} account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-muted/25 p-3 text-sm">
            <p className="font-medium">
              {family ? claim.students!.map((s) => s.name).join(', ') : claim.student?.name}
              {!family && <span className="font-normal text-muted-foreground"> · {claim.student?.className}</span>}
            </p>
            {claim.pay_through && <p className="mt-1 text-muted-foreground">Paying ahead up to <span className="font-semibold text-foreground">{claim.pay_through}</span></p>}
            <p className="mt-1 text-muted-foreground">{claim.parent?.name} sent {money(claim.amount)} by {claim.method} on {fmt(claim.paidOn)}</p>
            <p className="mt-1">Reference <span className="font-mono font-semibold">{claim.reference}</span></p>
            {student && !family && <p className="mt-1 text-muted-foreground">Owes now: <span className="font-semibold text-foreground">{money(student.totalOwed)}</span></p>}
          </div>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pc-amount" className="text-xs font-semibold">Amount received</Label>
              <Input id="pc-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-method" className="text-xs font-semibold">Came in through</Label>
              <NativeSelect id="pc-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                <option value="" disabled>Choose</option>
                {paymentMethods.map((m) => <option key={m._id} value={m._id}>{m.payment_method_name}</option>)}
              </NativeSelect>
            </div>
          </div>
          {overOwed && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">This is more than is owed. Put the extra towards months up to</Label>
              <MonthPicker value={payThrough} onChange={setPayThrough} min={current} aria-label="Pay through month" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={confirm} disabled={saving || !(value > 0) || !methodId || (overOwed && !payThrough)}>
            {saving ? 'Confirming…' : 'Confirm and make receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ claim, onClose, onDone }: { claim: PaymentClaim; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reject = async () => {
    setSaving(true);
    setError(null);
    try {
      await monthlyFeesApi.rejectPaymentClaim(claim._id, reason.trim());
      onDone();
    } catch (err) {
      setError(apiError(err, 'Could not reject the payment.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={XCircle} tint="pink">
          <DialogTitle>Reject payment</DialogTitle>
          <DialogDescription>{claim.parent?.name} will see your reason in the parent portal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-1.5">
            {['No money arrived with this reference', 'The amount received is different', 'Wrong student'].map((r) => (
              <Button key={r} size="xs" variant="outline" type="button" onClick={() => setReason(r)}>{r}</Button>
            ))}
          </div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you rejecting it?" rows={3} aria-label="Reason" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="destructive" onClick={reject} disabled={saving || reason.trim().length < 3}>{saving ? 'Rejecting…' : 'Reject payment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
