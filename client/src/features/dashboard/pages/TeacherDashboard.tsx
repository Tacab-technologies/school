import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CalendarBlank, CheckSquareOffset, Clock, Exam, NotePencil, Plus, Stack } from '@phosphor-icons/react';
import { getTeacherDashboardData } from '../../../services/dashboardService';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  DashboardError, DashboardLoading, DonutBreakdown, DotPill, KpiRow, KpiTile, Panel, PanelEmpty, PanelLink, QuickActions,
} from '../components/DashboardKit';
import { TILE_FILLS } from '../components/dashboardUtils';

interface TeacherDashboardData {
  summary: { classCount: number; subjectCount: number; totalLogs: number; completedLogs: number; draftLogs: number };
  term?: { _id: string; name: string } | null;
  myClasses?: { classId: string; className: string; sectionName: string | null; subjects: string[]; lessonsPerWeek: number; students: number }[];
  mySubjects?: string[];
  todaySchedule: { subject: string; class: string; period?: string; startTime?: string; endTime?: string }[];
  recentLogs: { _id?: string; subject: string; classId: string; topicTaught: string; status: 'draft' | 'completed'; date: string }[];
}

// What a teacher with no classes or logs yet sees — real zeros, never sample data.
const EMPTY: TeacherDashboardData = {
  summary: { classCount: 0, subjectCount: 0, totalLogs: 0, completedLogs: 0, draftLogs: 0 },
  todaySchedule: [],
  recentLogs: [],
};

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<TeacherDashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTeacherDashboardData()
      .then((d) => setData(d || EMPTY))
      .catch(() => setError('Could not load your dashboard from the server.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardLoading />;

  const { summary, todaySchedule, recentLogs } = data;
  const myClasses = data.myClasses ?? [];

  return (
    <div className="space-y-6">
      <DashboardError message={error} />

      <KpiRow columns={4}>
        <KpiTile label="My classes" value={summary.classCount} fill="bg-tile-pink" icon={Stack}
          note="Classes you teach" to="/timetable" />
        <KpiTile label="My subjects" value={summary.subjectCount} fill="bg-tile-yellow" icon={BookOpen}
          note={data.mySubjects?.length ? data.mySubjects.slice(0, 3).join(", ") + (data.mySubjects.length > 3 ? "…" : "") : "Subjects you teach"} to="/timetable" />
        <KpiTile label="Lessons today" value={todaySchedule.length} fill="bg-tile-green" icon={Clock}
          note={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} to="/timetable" />
        <KpiTile label="Teaching logs" value={summary.totalLogs} fill="bg-tile-blue" icon={NotePencil}
          note={`${summary.completedLogs} completed · ${summary.draftLogs} draft${summary.draftLogs === 1 ? '' : 's'}`} to="/teaching-log" />
      </KpiRow>

      <Panel title="Today's lessons" description={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        action={<PanelLink to="/timetable">Timetable</PanelLink>}>
        {todaySchedule.length === 0 ? (
          <PanelEmpty text="No lessons are scheduled for you today." />
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {todaySchedule.map((slot, i) => (
              <li key={i} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl p-3.5 text-tile-foreground', TILE_FILLS[i % TILE_FILLS.length])}>
                <div>
                  <p className="font-semibold">{slot.subject}</p>
                  <p className="text-xs opacity-75">{slot.class}{slot.period ? ` · ${slot.period}` : ''}</p>
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium dark:bg-white/10">
                  <Clock size={12} />
                  {slot.startTime && slot.endTime ? `${slot.startTime} – ${slot.endTime}` : 'Time not set'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="My classes and subjects" description={data.term ? `What you teach in ${data.term.name}` : 'What you teach this term'}
        action={<PanelLink to="/timetable">Timetable</PanelLink>}>
        {myClasses.length === 0 ? (
          <PanelEmpty text="You aren't assigned to any class yet. The academic office adds you to classes and the timetable." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {myClasses.map((c, i) => (
              <li key={`${c.classId}-${c.sectionName ?? ''}`} className="rounded-xl border border-border p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-foreground">{c.className}{c.sectionName ? ` · Section ${c.sectionName}` : ''}</p>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{c.students} student{c.students === 1 ? '' : 's'}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.subjects.map((sub) => (
                    <span key={sub} className={cn('rounded-full px-2 py-0.5 text-xs font-medium text-tile-foreground', TILE_FILLS[i % TILE_FILLS.length])}>{sub}</span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{c.lessonsPerWeek ? `${c.lessonsPerWeek} lesson${c.lessonsPerWeek === 1 ? '' : 's'} a week` : 'Not on the timetable yet'}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <DonutBreakdown title="My teaching logs" description="Completed and still in draft"
          data={[
            { name: 'Completed', value: summary.completedLogs, color: 'hsl(var(--tile-green))' },
            { name: 'Draft', value: summary.draftLogs, color: 'hsl(var(--tile-yellow))' },
          ]}
          centerLabel="Logs" emptyText="No teaching logs yet." />
        <QuickActions title="Quick actions" description="The jobs you do most, one click away" actions={[
          { label: 'New Log', icon: Plus, to: '/teaching-log/create' },
          { label: 'Attendance', icon: CheckSquareOffset, to: '/attendance' },
          { label: 'My Logs', icon: NotePencil, to: '/teaching-log' },
          { label: 'Timetable', icon: CalendarBlank, to: '/timetable' },
          { label: 'Enter marks', icon: Exam, to: '/exams' },
          { label: 'My lessons', icon: Stack, to: '/teacher-portal' },
        ]} />
      </div>

      <Panel title="Recent teaching logs" flush action={<PanelLink to="/teaching-log">View all</PanelLink>}>
        {recentLogs.length === 0 ? (
          <PanelEmpty text="You have not written any teaching logs yet." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-6">Topic</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="pr-6">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLogs.map((log, i) => (
                  <TableRow key={log._id ?? i} className={log._id ? 'cursor-pointer' : undefined}
                    onClick={log._id ? () => navigate(`/teaching-log/${log._id}`) : undefined}>
                    <TableCell className="max-w-[260px] pl-6"><p className="truncate font-medium">{log.topicTaught}</p></TableCell>
                    <TableCell className="text-sm">{log.subject}</TableCell>
                    <TableCell><span className="rounded-md bg-tile-blue px-2 py-0.5 text-xs font-medium text-tile-foreground">{log.classId}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {log.date ? new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </TableCell>
                    <TableCell className="pr-6"><DotPill tone={log.status === 'completed' ? 'success' : 'warning'}>{log.status}</DotPill></TableCell>
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
