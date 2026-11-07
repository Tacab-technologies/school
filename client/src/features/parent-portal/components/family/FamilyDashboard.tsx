import { ArrowRight } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DashboardError, DashboardLoading, Panel } from '../../../dashboard/components/DashboardKit';
import { GradeChip } from '../../../exams/components/ReportCard';
import { parentPortalApi, type FamilyChild } from '../../api/parentPortalApi';
import { useParentPortal } from '../../context/ParentContext';
import { useFamilySummary } from '../../hooks/useFamilyResource';
import type { TabId } from '../../types';
import { BigFigure, ChildSection } from './FamilyKit';
import { formatUSD } from './familyFormat';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** What a result looks like in one line: "Term 1 · 80%" plus the grade. */
export function LatestResult({ result }: { result: FamilyChild['latestResult'] }) {
  if (!result) return <span className="text-base font-semibold">Not yet</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xl font-bold tabular-nums sm:text-2xl">{result.percent === null ? '—' : `${Math.round(result.percent)}%`}</span>
      {result.grade && <GradeChip grade={result.grade.grade} className="h-7 min-w-7 text-sm" />}
    </span>
  );
}

/** Every child on one page: attendance, days missed, fees owed and the latest result. */
export default function FamilyDashboard({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  const { children } = useParentPortal();
  const { data, loading, error } = useFamilySummary(parentPortalApi.getFamily);
  if (loading) return <DashboardLoading />;
  if (error || !data) return <DashboardError message="Could not load your children. Check your connection and refresh the page." />;
  const byId = new Map(data.children.map((c) => [c._id, c]));

  return (
    <div className="space-y-5">
      <Panel title="Your family" description={`${children.length} children · fees for all of them together`}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <BigFigure label="Still to pay" value={formatUSD(data.totals.balance)} fill={data.totals.balance > 0 ? 'bg-tile-yellow' : 'bg-tile-green'}
              note={data.totals.balance > 0 ? 'For all children' : 'All paid, thank you'} />
            <BigFigure label="Paid" value={formatUSD(data.totals.paid)} fill="bg-tile-green" />
            <BigFigure label="Billed" value={formatUSD(data.totals.invoiced)} fill="bg-tile-blue" />
          </div>
          {data.totals.balance > 0 && (
            <Button size="lg" className="w-full sm:w-auto" onClick={() => onNavigate('fees')}>
              Pay fees for all children <ArrowRight size={16} />
            </Button>
          )}
        </div>
      </Panel>

      {children.map((child, i) => {
        const row = byId.get(child._id);
        if (!row) return null;
        const absences = row.attendance.recentAbsences ?? [];
        return (
          <ChildSection key={child._id} child={child} index={i}>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <BigFigure label="Attendance" fill="bg-tile-green"
                value={row.attendance.rate === null ? '—' : `${row.attendance.rate}%`}
                note={row.attendance.total ? `${row.attendance.total} lessons marked` : 'Nothing marked yet'} />
              <BigFigure label="Absent" fill="bg-tile-pink" value={row.attendance.absent}
                note={row.attendance.late ? `Late ${row.attendance.late} times` : 'Lessons missed'} />
              <BigFigure label="Fees owed" fill={row.fees.balance > 0 ? 'bg-tile-yellow' : 'bg-tile-blue'} value={formatUSD(row.fees.balance)}
                note={row.fees.balance > 0 ? 'Still to pay' : 'All paid'} />
              <BigFigure label="Latest result" fill="bg-tile-violet" value={<LatestResult result={row.latestResult} />}
                note={row.latestResult ? row.latestResult.term.name : 'Shown once the school publishes it'} />
            </div>
            <div className="rounded-2xl bg-muted/50 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Last days absent</p>
              {absences.length === 0 ? (
                <p className="mt-0.5 text-sm text-muted-foreground">No absences. Well done!</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {absences.map((a, n) => (
                    <li key={n} className="rounded-full bg-card px-3 py-1 text-sm">
                      {day(a.date)}{a.lesson ? <span className="text-muted-foreground"> · {a.lesson}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ChildSection>
        );
      })}
    </div>
  );
}
