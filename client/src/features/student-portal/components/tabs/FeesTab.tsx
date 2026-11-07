import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle, DownloadSimple, Receipt, WarningCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import StatStrip from '@/components/shared/StatStrip';
import { cn } from '@/lib/utils';
import { DashboardError, DashboardLoading, Panel, PanelEmpty } from '../../../dashboard/components/DashboardKit';
import { downloadCSV } from '../../utils/csv';
import { portalApi, type PortalInvoicesResponse } from '../../api/portalApi';
import { usePortal } from '../../context/PortalContext';

const formatUSD = (n: number) => `$${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const formatDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const monthOf = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

/** "Oct" and "2026", for the small date tile on each bill. */
const monthTile = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return { month: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }), year: String(y) };
};

const STATUS: Record<string, { label: string; pill: string }> = {
  Paid: { label: 'Paid', pill: 'bg-success/10 text-success' },
  Partially_Paid: { label: 'Part paid', pill: 'bg-warning/10 text-warning' },
  Unpaid: { label: 'Unpaid', pill: 'bg-destructive/10 text-destructive' },
};

export default function FeesTab() {
  const { studentId } = usePortal();
  const [data, setData] = useState<PortalInvoicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    portalApi.getInvoices(studentId)
      .then((res) => { if (!cancelled) { setData(res); setError(''); } })
      .catch(() => { if (!cancelled) setError('Could not load your fees.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studentId]);

  if (loading) return <DashboardLoading />;
  if (error) return <DashboardError message={error} />;
  return <FeesView data={data} title="My bills" emptyText="No bills yet. They appear here once the school charges your fees." />;
}

/** What has been billed and paid, bill by bill. `children` sits beside the bills on wide screens. Shared with the parent portal. */
export function FeesView({ data, title, emptyText, fileName = 'fees', children }: {
  data: PortalInvoicesResponse | null; title: string; emptyText: string; fileName?: string; children?: ReactNode;
}) {
  const totals = data?.totals ?? { invoiced: 0, paid: 0, balance: 0 };
  // Newest month first.
  const invoices = (data?.invoices ?? []).slice().sort((a, b) =>
    (b.period ?? b.dueDate ?? b.registerDate ?? '').localeCompare(a.period ?? a.dueDate ?? a.registerDate ?? ''));
  const paidPct = totals.invoiced > 0 ? Math.round((totals.paid / totals.invoiced) * 100) : 0;
  const open = invoices.filter((i) => i.balance > 0).length;

  const exportCsv = () => downloadCSV(fileName, invoices.map((i) => ({
    Month: i.period ? monthOf(i.period) : '', Bill: i.invoice_no, Due: formatDate(i.dueDate), Amount: i.invoice_amount,
    Paid: i.paid_amount, 'Still owed': i.balance, Status: STATUS[i.status]?.label ?? i.status,
  })));

  return (
    <div className="space-y-6">
      <StatStrip items={[
        { label: 'Still to pay', value: formatUSD(totals.balance), icon: WarningCircle, tone: totals.balance > 0 ? 'rose' : 'emerald', hint: totals.balance > 0 ? `${open} bill${open === 1 ? '' : 's'} open` : 'All paid, thank you' },
        { label: 'Paid', value: formatUSD(totals.paid), icon: CheckCircle, tone: 'emerald', hint: `${paidPct}% of all bills` },
        { label: 'Billed', value: formatUSD(totals.invoiced), icon: Receipt, tone: 'sky', hint: `${invoices.length} bill${invoices.length === 1 ? '' : 's'}` },
      ]} />

      <div className={cn('grid items-start gap-6', children && 'xl:grid-cols-[minmax(0,1fr)_380px]')}>
        <Panel title={title} description="Every monthly fee and what has been paid on it" flush
          action={<Button variant="outline" size="xs" onClick={exportCsv} disabled={!invoices.length}><DownloadSimple size={13} /> Download</Button>}>
          {invoices.length === 0 ? (
            <PanelEmpty icon={Receipt} text={emptyText} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
                <div className="min-w-[180px] flex-1">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{formatUSD(totals.paid)} paid <span className="font-normal text-muted-foreground">of {formatUSD(totals.invoiced)}</span></span>
                    <span className="font-semibold tabular-nums">{paidPct}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full transition-all', paidPct === 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${paidPct}%` }} />
                  </div>
                </div>
                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold text-tile-foreground', totals.balance > 0 ? 'bg-tile-pink' : 'bg-tile-green')}>
                  {totals.balance > 0 ? `${formatUSD(totals.balance)} still to pay` : 'Nothing owed'}
                </span>
              </div>
              <div className="overflow-x-auto border-t border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wider hover:bg-muted/50">
                      <TableHead className="pl-4 font-semibold sm:pl-6">Month</TableHead>
                      <TableHead className="hidden font-semibold sm:table-cell">Due</TableHead>
                      <TableHead className="text-right font-semibold">Amount</TableHead>
                      <TableHead className="hidden text-right font-semibold md:table-cell">Paid</TableHead>
                      <TableHead className="hidden text-right font-semibold sm:table-cell">Still owed</TableHead>
                      <TableHead className="pr-4 text-right font-semibold sm:pr-6">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((i) => {
                      const tile = i.period ? monthTile(i.period) : null;
                      const owes = i.balance > 0;
                      return (
                        <TableRow key={i._id}>
                          <TableCell className="py-3 pl-4 sm:pl-6">
                            <div className="flex items-center gap-3">
                              <span className={cn('flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-tile-foreground', owes ? 'bg-tile-pink' : 'bg-tile-green')}>
                                <span className="text-[11px] font-bold uppercase leading-none">{tile?.month ?? 'Fee'}</span>
                                {tile && <span className="mt-0.5 text-[9px] leading-none opacity-70">{tile.year}</span>}
                              </span>
                              <div className="min-w-0">
                                <p className="font-medium sm:whitespace-nowrap">{i.period ? monthOf(i.period) : 'School fee'}</p>
                                <p className="font-mono text-[11px] text-muted-foreground">{i.invoice_no}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">{formatDate(i.dueDate)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatUSD(i.invoice_amount)}</TableCell>
                          <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{formatUSD(i.paid_amount)}</TableCell>
                          <TableCell className={cn('hidden text-right font-semibold tabular-nums sm:table-cell', owes ? 'text-destructive' : 'text-muted-foreground')}>
                            {owes ? formatUSD(i.balance) : '—'}
                          </TableCell>
                          <TableCell className="pr-4 text-right sm:pr-6">
                            <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS[i.status]?.pill ?? 'bg-muted text-muted-foreground')}>
                              <span className="h-1.5 w-1.5 rounded-full bg-current" />
                              {STATUS[i.status]?.label ?? i.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Panel>
        {children}
      </div>
    </div>
  );
}
