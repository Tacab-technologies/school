import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChartPie, CheckCircle, Clock, CurrencyDollar, DownloadSimple, Percent, Receipt, SpinnerGap, Users } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import StatStrip from '@/components/shared/StatStrip';
import { EmptyState, ErrorState } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import { downloadCSV } from '../../reports/utils/csv';
import { apiError } from '../api/monthlyFeesApi';
import { financeOpsApi } from '../api/financeOpsApi';
import { money, periodLabel, thisPeriod } from '../monthlyTypes';
import type { FinanceOverview, OverviewClass } from '../opsTypes';

/** How much of what was billed has come in, as a small bar. */
function RateBar({ rate }: { rate: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full rounded-full', rate >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className="w-12 text-right text-sm tabular-nums">{rate}%</span>
    </div>
  );
}

/** One line of the money in and out statement. */
function Line({ label, value, sign, strong }: { label: string; value: number; sign?: '+' | '−'; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-2 text-sm', strong && 'border-t border-border font-semibold')}>
      <span className={cn(!strong && 'text-muted-foreground')}>{label}</span>
      <span className={cn('tabular-nums', sign === '+' && 'text-success', strong && value < 0 && 'text-destructive')}>
        {sign}{money(Math.abs(value))}{strong && value < 0 ? ' short' : ''}
      </span>
    </div>
  );
}

/** Where the school's money stands: per class, then in and out, for a month or all months. */
export default function FinanceOverviewTab({ onOpenClass }: {
  /** Open a class's list on Class Status, for this month if one is chosen. */
  onOpenClass: (classId: string, period: string | null) => void;
}) {
  const [period, setPeriod] = useState(thisPeriod());
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    financeOpsApi.getOverview(period || undefined)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(apiError(err, 'Could not load the overview.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, attempt]);

  const scope = period ? periodLabel(period) : 'All months';
  const t = data?.totals;
  const cashMonth = data ? periodLabel(data.period ?? data.currentPeriod, true) : '';

  const exportCsv = () => {
    if (!data || !t) return;
    const row = (name: string, r: Omit<OverviewClass, 'classId' | 'name'>) => ({
      Class: name,
      Students: r.students,
      Billed: r.billed,
      Collected: r.collected,
      'Still owed': r.owed,
      'Fully paid': r.fullyPaid,
      'Still owing': r.owing,
      'Not charged': r.notCharged,
      '% collected': r.rate,
    });
    downloadCSV(`fees-overview-${period || 'all-months'}`, [...data.classes.map((c) => row(c.name, c)), row('Total', t)]);
  };

  return (
    <div className="space-y-5">
      <Card className="border-border shadow-xs">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="ov-month" className="text-xs">Month</Label>
            <MonthPicker id="ov-month" value={period} max={thisPeriod()} clearable placeholder="All months" onChange={setPeriod} className="w-48" />
          </div>
          {period && <Button variant="ghost" onClick={() => setPeriod('')}>All months</Button>}
          {loading && data && <SpinnerGap size={18} className="mb-2.5 animate-spin text-primary" />}
          <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={!data?.classes.length}><DownloadSimple size={15} /> CSV</Button>
        </CardContent>
      </Card>

      {error && <Card className="border-border shadow-xs"><ErrorState text={error} onRetry={() => setAttempt((n) => n + 1)} /></Card>}
      {loading && !data && !error && <div className="flex justify-center py-12"><SpinnerGap size={22} className="animate-spin text-primary" /></div>}

      {data && t && !error && (
        <>
          <StatStrip items={[
            { label: 'Students', value: t.students, icon: Users, tone: 'muted', hint: t.notCharged ? `${t.notCharged} not charged yet` : 'In all classes' },
            { label: 'Billed', value: money(t.billed), icon: Receipt, tone: 'sky', hint: scope },
            { label: 'Collected', value: money(t.collected), icon: CheckCircle, tone: 'emerald', hint: `${t.fullyPaid} fully paid` },
            { label: 'Still owed', value: money(t.owed), icon: Clock, tone: 'rose', hint: `${t.owing} still owing` },
            { label: '% collected', value: `${t.rate}%`, icon: Percent, tone: 'violet', hint: 'Of what was billed' },
            { label: `Received in ${cashMonth}`, value: money(data.receivedInMonth), icon: CurrencyDollar, tone: 'amber', hint: 'Cash taken that month' },
          ]} />

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Card className="overflow-hidden border-border shadow-xs">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Class by class · {scope}</CardTitle>
                <CardDescription className="text-xs">Click a class to see its students.</CardDescription>
              </CardHeader>
              {data.classes.length === 0 ? (
                <EmptyState icon={Users} text="No classes yet. Add classes in Academic Structure, then set their monthly fee in Setup." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Class</TableHead>
                        <TableHead className="text-right">Students</TableHead>
                        <TableHead className="text-right">Billed</TableHead>
                        <TableHead className="text-right">Collected</TableHead>
                        <TableHead className="text-right">Still owed</TableHead>
                        <TableHead className="text-right">Fully paid</TableHead>
                        <TableHead className="text-right">Still owing</TableHead>
                        <TableHead className="text-right">% collected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.classes.map((c) => {
                        const { classId } = c;
                        return (
                          <TableRow key={classId ?? 'none'} className={cn(classId && 'cursor-pointer')} onClick={classId ? () => onOpenClass(classId, data.period) : undefined}>
                            <TableCell>
                              {classId ? (
                                <Button variant="plain" type="button" className="text-left font-medium text-foreground hover:underline"
                                  onClick={(e) => { e.stopPropagation(); onOpenClass(classId, data.period); }}>
                                  {c.name}
                                </Button>
                              ) : <span className="font-medium text-muted-foreground">{c.name}</span>}
                              {c.notCharged > 0 && <p className="text-xs text-muted-foreground">{c.notCharged} not charged</p>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{c.students}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(c.billed)}</TableCell>
                            <TableCell className="text-right tabular-nums text-success">{money(c.collected)}</TableCell>
                            <TableCell className={cn('text-right font-semibold tabular-nums', c.owed > 0 && 'text-destructive')}>{money(c.owed)}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.fullyPaid}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.owing}</TableCell>
                            <TableCell><RateBar rate={c.rate} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{t.students}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(t.billed)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(t.collected)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(t.owed)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{t.fullyPaid}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{t.owing}</TableCell>
                        <TableCell><RateBar rate={t.rate} /></TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </Card>

            <Card className="border-border shadow-xs">
              <CardHeader className="pb-1">
                <CardTitle className="flex items-center gap-2 text-sm"><ChartPie size={15} /> Money in and out</CardTitle>
                <CardDescription className="text-xs">{scope}, by the day the money moved.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="flex items-center gap-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ArrowDown size={12} /> In</p>
                <Line label="Fees collected" value={data.cash.feesCollected} sign="+" />
                <p className="flex items-center gap-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ArrowUp size={12} /> Out</p>
                <Line label="Salaries paid" value={data.cash.salaries} sign="−" />
                <Line label="Expenses" value={data.cash.expenses} sign="−" />
                <Line label="Refunds" value={data.cash.refunds} sign="−" />
                <Line label="Balance" value={data.cash.balance} strong />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
