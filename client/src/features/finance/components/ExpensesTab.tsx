import { useCallback, useEffect, useState } from 'react';
import { Coins, PencilSimple, Plus, Receipt, SpinnerGap, Tag, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DatePicker, MonthPicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import FilterSelect from '@/components/shared/FilterSelect';
import StatStrip from '@/components/shared/StatStrip';
import { EmptyState, ErrorState } from '@/components/common/EmptyState';
import { confirmAction } from '@/components/common/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { useCan } from '@/hooks/usePermission';
import { apiError } from '../api/monthlyFeesApi';
import { financeOpsApi } from '../api/financeOpsApi';
import { money, periodLabel, thisPeriod } from '../monthlyTypes';
import { dayLabel, today, type Expense, type ExpenseList } from '../opsTypes';
import type { PaymentMethod } from '../types';

/** Money the school spent: record it, find it by month or category, correct or delete it. */
export default function ExpensesTab({ paymentMethods }: { paymentMethods: PaymentMethod[] }) {
  const canCreate = useCan('fees', 'create');
  const canEdit = useCan('fees', 'edit');
  const canDelete = useCan('fees', 'delete');
  const { showToast } = useToast();
  const [period, setPeriod] = useState(thisPeriod());
  const [category, setCategory] = useState('');
  const [list, setList] = useState<ExpenseList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The form: null is closed, 'new' a new expense, otherwise the one being changed.
  const [form, setForm] = useState<Expense | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await financeOpsApi.listExpenses({ period: period || undefined, category: category || undefined }));
    } catch (err) {
      setError(apiError(err, 'Could not load the expenses.'));
    } finally {
      setLoading(false);
    }
  }, [period, category]);

  useEffect(() => { load(); }, [load]);

  const remove = async (e: Expense) => {
    const ok = await confirmAction({
      title: `Delete this ${money(e.amount)} expense?`,
      text: `${e.category}${e.paidTo ? ` to ${e.paidTo}` : ''} on ${dayLabel(e.date)}. It comes off the totals and the books.`,
      confirmLabel: 'Delete expense',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await financeOpsApi.deleteExpense(e._id);
      showToast('Expense deleted.', 'success');
      load();
    } catch (err) {
      showToast(apiError(err, 'Could not delete this expense.'), 'error');
    }
  };

  const scope = period ? periodLabel(period) : 'All months';
  const rows = list?.rows ?? [];
  const biggest = list?.byCategory[0];

  return (
    <div className="space-y-5">
      <Card className="border-border shadow-xs">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="ex-month" className="text-xs">Month</Label>
            <MonthPicker id="ex-month" value={period} max={thisPeriod()} clearable placeholder="All months" onChange={setPeriod} className="w-48" />
          </div>
          <FilterSelect label="Category" value={category} onChange={setCategory} className="min-w-[170px]"
            options={[{ value: '', label: 'All categories' }, ...(list?.categories ?? []).map((c) => ({ value: c, label: c }))]} />
          {loading && <SpinnerGap size={18} className="mb-2.5 animate-spin text-primary" />}
          {canCreate && <Button className="ml-auto" onClick={() => setForm('new')}><Plus size={15} /> Record expense</Button>}
        </CardContent>
      </Card>

      {error && <Card className="border-border shadow-xs"><ErrorState text={error} onRetry={load} /></Card>}

      {list && !error && (
        <>
          <StatStrip items={[
            { label: 'Spent', value: money(list.total), icon: Coins, tone: 'rose', hint: category ? `${category} · ${scope}` : scope },
            { label: 'Expenses', value: rows.length, icon: Receipt, tone: 'sky', hint: 'Recorded' },
            { label: 'Biggest category', value: biggest ? money(biggest.total) : '—', icon: Tag, tone: 'violet', hint: biggest ? biggest.category : 'Nothing recorded yet' },
          ]} />

          <Card className="overflow-hidden border-border shadow-xs">
            {rows.length === 0 ? (
              <EmptyState icon={Coins} text={category ? 'No expenses in this category.' : `No expenses recorded for ${scope.toLowerCase() === 'all months' ? 'any month' : scope}.`} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Paid to</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Receipt no.</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      {(canEdit || canDelete) && <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((e) => (
                      <TableRow key={e._id}>
                        <TableCell className="whitespace-nowrap text-sm">{dayLabel(e.date)}</TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{e.category}</p>
                          {e.note && <p className="max-w-xs truncate text-xs text-muted-foreground">{e.note}</p>}
                        </TableCell>
                        <TableCell className="text-sm">{e.paidTo || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.paymentMethod || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.receiptNo || '—'}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(e.amount)}</TableCell>
                        {(canEdit || canDelete) && (
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {canEdit && <Button size="icon-sm" variant="ghost" aria-label={`Change ${e.expenseNumber}`} onClick={() => setForm(e)}><PencilSimple size={15} /></Button>}
                              {canDelete && <Button size="icon-sm" variant="ghost" aria-label={`Delete ${e.expenseNumber}`} className="text-destructive hover:text-destructive" onClick={() => remove(e)}><Trash size={15} /></Button>}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(list.total)}</TableCell>
                      {(canEdit || canDelete) && <TableCell />}
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      {form && (
        <ExpenseDialog expense={form === 'new' ? null : form} categories={list?.categories ?? []} paymentMethods={paymentMethods}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
      )}
    </div>
  );
}

function ExpenseDialog({ expense, categories, paymentMethods, onClose, onSaved }: {
  expense: Expense | null;
  categories: string[];
  paymentMethods: PaymentMethod[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(expense ? new Date(expense.date).toISOString().slice(0, 10) : today());
  const [category, setCategory] = useState(expense?.category ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [paidTo, setPaidTo] = useState(expense?.paidTo ?? '');
  const [methodId, setMethodId] = useState(expense?.paymentMethodId
    ?? (paymentMethods.find((m) => /cash/i.test(m.payment_method_name)) ?? paymentMethods[0])?._id ?? '');
  const [receiptNo, setReceiptNo] = useState(expense?.receiptNo ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = !!date && !!category.trim() && Number(amount) > 0 && !!methodId && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    const data = {
      date, category: category.trim(), amount: Number(amount), paid_to: paidTo.trim(), payment_method: methodId, note: note.trim(), receipt_no: receiptNo.trim(),
    };
    try {
      if (expense) await financeOpsApi.updateExpense(expense._id, data);
      else await financeOpsApi.createExpense(data);
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Could not save this expense.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={Coins} tint="pink">
          <DialogTitle>{expense ? 'Change expense' : 'Record an expense'}</DialogTitle>
          <DialogDescription>Money the school spent. It shows on the Overview under money out.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Date</Label>
              <DatePicker value={date} onChange={setDate} max={today()} aria-label="Date spent" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount" className="text-xs font-semibold">Amount</Label>
              <Input id="exp-amount" type="number" min={0} autoFocus={!expense} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-category" className="text-xs font-semibold">Category</Label>
            <Input id="exp-category" list="exp-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Pick one or type your own" />
            <datalist id="exp-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="exp-to" className="text-xs font-semibold">Paid to (optional)</Label>
              <Input id="exp-to" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="Who received the money" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-method" className="text-xs font-semibold">Paid by</Label>
              <NativeSelect id="exp-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {paymentMethods.map((m) => <option key={m._id} value={m._id}>{m.payment_method_name}</option>)}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-receipt" className="text-xs font-semibold">Receipt number (optional)</Label>
            <Input id="exp-receipt" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-note" className="text-xs font-semibold">Note (optional)</Label>
            <Textarea id="exp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {paymentMethods.length === 0 && <p className="text-sm text-destructive">Add a payment method in Setup first.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!valid}>{saving && <SpinnerGap size={15} className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
