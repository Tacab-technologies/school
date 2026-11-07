import { cn } from '@/lib/utils';
import { DashboardLoading } from '../../../dashboard/components/DashboardKit';
import { parentPortalApi } from '../../api/parentPortalApi';
import { useParentPortal } from '../../context/ParentContext';
import { useFamilyResource } from '../../hooks/useFamilyResource';
import { BigFigure, ChildSection } from './FamilyKit';

const PILL: Record<string, string> = {
  Present: 'bg-success/10 text-success',
  Late: 'bg-warning/10 text-warning',
  Absent: 'bg-destructive/10 text-destructive',
  Excused: 'bg-info/10 text-info',
};
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** Every child's attendance: the rate and counts, then the last lessons marked. */
export default function FamilyAttendance() {
  const { children } = useParentPortal();
  const { items, loading } = useFamilyResource(parentPortalApi.getChildAttendance);
  if (loading) return <DashboardLoading />;

  return (
    <div className="space-y-5">
      {children.map((child, i) => {
        const item = items[child._id];
        const records = item?.data?.records ?? [];
        const count = (s: string) => records.filter((r) => r.status === s).length;
        const rate = records.length ? Math.round(((count('Present') + count('Late')) / records.length) * 100) : null;
        return (
          <ChildSection key={child._id} child={child} index={i} openLabel={`All of ${child.firstName}'s days`}>
            {item?.error ? (
              <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">Could not load {child.firstName}'s attendance. Refresh the page to try again.</p>
            ) : records.length === 0 ? (
              <p className="rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">No attendance has been recorded for {child.firstName} yet.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <BigFigure label="Attendance" value={rate === null ? '—' : `${rate}%`} note="Present or late" fill="bg-tile-green" />
                  <BigFigure label="Present" value={count('Present')} note="Lessons attended" fill="bg-tile-blue" />
                  <BigFigure label="Late" value={count('Late')} note="Arrived late" fill="bg-tile-yellow" />
                  <BigFigure label="Absent" value={count('Absent')} note={count('Excused') ? `${count('Excused')} excused` : 'Lessons missed'} fill="bg-tile-pink" />
                </div>
                <div>
                  <p className="pb-1 text-sm font-semibold text-foreground">Last lessons marked</p>
                  <ul className="divide-y divide-border rounded-2xl border border-border/70">
                    {records.slice(0, 6).map((r) => (
                      <li key={r._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{day(r.att_date)}</p>
                          <p className="truncate text-xs text-muted-foreground">{r.periodId?.per_name ?? 'Lesson'}{r.remarks ? ` · ${r.remarks}` : ''}</p>
                        </div>
                        <span className={cn('shrink-0 rounded-full px-3 py-1 text-sm font-medium', PILL[r.status])}>{r.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </ChildSection>
        );
      })}
    </div>
  );
}
