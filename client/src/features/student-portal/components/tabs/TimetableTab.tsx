import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarBlank, Clock, MapPin, Printer } from '@phosphor-icons/react';
import StatStrip from '@/components/shared/StatStrip';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { printElement } from '@/lib/printElement';
import { cn } from '@/lib/utils';
import { DashboardError, DashboardLoading, Panel, PanelEmpty } from '../../../dashboard/components/DashboardKit';
import { portalApi, type PortalTimetableSlot } from '../../api/portalApi';
import { usePortal } from '../../context/PortalContext';

// Somali school week — Saturday first.
const DAY_ORDER = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FILLS = ['bg-tile-blue', 'bg-tile-green', 'bg-tile-yellow', 'bg-tile-pink', 'bg-tile-violet'];

const teacherName = (t: PortalTimetableSlot['teacher']) =>
  t ? `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() || '—' : '—';

export default function TimetableTab() {
  const { studentId } = usePortal();
  const [slots, setSlots] = useState<PortalTimetableSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    portalApi.getTimetable(studentId)
      .then((data) => { if (!cancelled) { setSlots(data); setError(''); } })
      .catch(() => { if (!cancelled) setError('Could not load your timetable.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studentId]);

  if (loading) return <DashboardLoading />;
  if (error) return <DashboardError message={error} />;
  return <TimetableView slots={slots} emptyText="Your class timetable hasn't been published yet." />;
}

/** A class's week of lessons as one table: times down the side, days across. Shared with the parent portal. */
export function TimetableView({ slots, emptyText, printTitle = 'Timetable' }: { slots: PortalTimetableSlot[]; emptyText: string; printTitle?: string }) {
  const sheet = useRef<HTMLDivElement>(null);

  // Each subject keeps one colour across the whole week.
  const fillFor = useMemo(() => {
    const names = [...new Set(slots.map((s) => s.subject?.sub_name ?? ''))].sort();
    const map = new Map(names.map((n, i) => [n, FILLS[i % FILLS.length]]));
    return (name?: string) => map.get(name ?? '') ?? FILLS[0];
  }, [slots]);

  const today = DAY_NAMES[new Date().getDay()];
  // Saturday to Thursday always; Friday only if something is on it.
  const days = DAY_ORDER.filter((d) => d !== 'Friday' || slots.some((s) => s.day === 'Friday'));
  const times = useMemo(() => [...new Set(slots.map((s) => s.timePeriod || ''))].sort(), [slots]);
  const cell = useMemo(() => {
    const map = new Map<string, PortalTimetableSlot[]>();
    for (const s of slots) {
      const key = `${s.day}|${s.timePeriod || ''}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [slots]);

  const subjectCount = new Set(slots.map((s) => s.subject?._id).filter(Boolean)).size;
  const todayCount = slots.filter((s) => s.day === today).length;

  return (
    <div className="space-y-6">
      <StatStrip items={[
        { label: 'Lessons a week', value: slots.length, icon: CalendarBlank, tone: 'sky', hint: 'All scheduled lessons' },
        { label: 'Subjects', value: subjectCount, icon: BookOpen, tone: 'violet', hint: 'Different subjects' },
        { label: 'Today', value: todayCount, icon: Clock, tone: 'emerald', hint: todayCount ? `Lessons on ${today}` : `No lessons on ${today}` },
      ]} />

      <Panel title="The week" description={slots.length ? `${times.length} lesson time${times.length === 1 ? '' : 's'} a day · today is highlighted` : undefined} flush
        action={slots.length > 0 && (
          <Button variant="outline" size="xs" onClick={() => sheet.current && printElement(sheet.current, printTitle)}>
            <Printer size={13} /> Print or save as PDF
          </Button>
        )}>
        {slots.length === 0 ? (
          <PanelEmpty icon={CalendarBlank} text={emptyText} />
        ) : (
          <div ref={sheet} className="overflow-x-auto">
            <Table className="min-w-[760px] table-fixed">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="sticky left-0 z-10 w-28 bg-muted/90 pl-5 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">Time</TableHead>
                  {days.map((d) => (
                    <TableHead key={d} className={cn('text-center text-[11px] font-semibold uppercase tracking-wider', d === today && 'bg-tile-blue text-tile-foreground')}>
                      {d.slice(0, 3)}
                      {d === today && <span className="ml-1.5 rounded-full bg-card/70 px-1.5 py-0.5 text-[9px] normal-case tracking-normal">Today</span>}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {times.map((t) => (
                  <TableRow key={t} className="hover:bg-transparent">
                    <TableCell className="sticky left-0 z-10 bg-card py-3 pl-5 align-top">
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold tabular-nums"><Clock size={13} className="text-muted-foreground" /> {t || '—'}</span>
                    </TableCell>
                    {days.map((d) => {
                      const lessons = cell.get(`${d}|${t}`) ?? [];
                      return (
                        <TableCell key={d} className={cn('p-1.5 align-top', d === today && 'bg-tile-blue/25')}>
                          {lessons.length === 0 ? (
                            <div className="flex h-full min-h-[52px] items-center justify-center rounded-xl border border-dashed border-border/70 text-[11px] text-muted-foreground/70">Free</div>
                          ) : lessons.map((s) => (
                            <div key={s._id} className={cn('min-h-[52px] rounded-xl px-2.5 py-2 text-tile-foreground', fillFor(s.subject?.sub_name))}>
                              <p className="truncate text-xs font-semibold">{s.subject?.sub_name ?? 'Subject'}</p>
                              <p className="mt-0.5 truncate text-[11px] opacity-75">{teacherName(s.teacher)}</p>
                              {s.room && <p className="mt-0.5 flex items-center gap-0.5 truncate text-[11px] opacity-75"><MapPin size={10} /> {s.room}</p>}
                            </div>
                          ))}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}
