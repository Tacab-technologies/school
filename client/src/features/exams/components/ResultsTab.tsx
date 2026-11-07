import { useEffect, useMemo, useState } from 'react';
import { ChartBar, CheckCircle, DownloadSimple, Exam, Trophy, UsersThree } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, TableEmptyRow, TableLoadingRows } from '@/components/common/EmptyState';
import FilterSelect from '@/components/shared/FilterSelect';
import StatStrip from '@/components/shared/StatStrip';
import { cn } from '@/lib/utils';
import { downloadCSV } from '../../reports/utils/csv';
import type { Class, Section, Term } from '../../academic-structure/types';
import { examsApi, apiMessage } from '../api/examsApi';
import { formatPercent } from '../grading';
import type { ClassResults } from '../types';
import { GradeChip, ReportCardDialog } from './ReportCard';
import { termLabel } from './ExamsTab';

const sectionClassId = (s: Section) => (typeof s.class === 'string' ? s.class : s.class._id);

/** Medal tiles for the top three. */
const POSITION_TONE: Record<number, string> = { 1: 'bg-tile-yellow', 2: 'bg-tile-blue', 3: 'bg-tile-pink' };

export default function ResultsTab({ terms, classes, sections }: { terms: Term[]; classes: Class[]; sections: Section[] }) {
  const activeTerm = useMemo(() => terms.find((t) => t.status === 'active') ?? terms[0], [terms]);
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [results, setResults] = useState<ClassResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [card, setCard] = useState<{ id: string; name: string } | null>(null);

  // A teacher's own classes and sections this term; null = staff, who see every class.
  const [pairs, setPairs] = useState<{ classId: string; sectionId: string }[] | null | undefined>(undefined);

  useEffect(() => { if (!termId && activeTerm) setTermId(activeTerm._id); }, [activeTerm, termId]);
  useEffect(() => {
    if (!termId) return;
    let cancelled = false;
    examsApi.teaching(termId)
      .then((res) => { if (!cancelled) setPairs(res.pairs); })
      .catch(() => { if (!cancelled) setPairs(null); });
    return () => { cancelled = true; };
  }, [termId]);

  const classOptions = useMemo(() => (pairs ? classes.filter((c) => pairs.some((p) => p.classId === c._id)) : classes), [classes, pairs]);
  const allSections = sections.filter((s) => sectionClassId(s) === classId);
  const classSections = pairs ? allSections.filter((s) => pairs.some((p) => p.classId === classId && p.sectionId === s._id)) : allSections;
  // The whole class only for staff, or a teacher who teaches every section of it.
  const wholeClassAllowed = !pairs || classSections.length === allSections.length;
  // Drop a choice that isn't offered (e.g. after changing term) and pick the only one there is.
  useEffect(() => {
    if (pairs === undefined) return;
    if (classId && !classOptions.some((c) => c._id === classId)) { setClassId(''); setSectionId(''); return; }
    if (!classId && pairs && classOptions.length === 1) setClassId(classOptions[0]._id);
  }, [pairs, classOptions, classId]);
  useEffect(() => {
    if (!classId || wholeClassAllowed || sectionId) return;
    if (classSections.length) setSectionId(classSections[0]._id);
  }, [classId, classSections, wholeClassAllowed, sectionId]);

  useEffect(() => {
    if (!termId || !classId || (!wholeClassAllowed && !sectionId)) { setResults(null); return; }
    let cancelled = false;
    setLoading(true);
    examsApi.results({ termId, classId, sectionId })
      .then((res) => { if (!cancelled) { setResults(res); setError(''); } })
      .catch((err) => { if (!cancelled) { setResults(null); setError(apiMessage(err, 'Could not load the results.')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [termId, classId, sectionId, wholeClassAllowed]);

  const top = results?.students.find((s) => s.position === 1);
  // What each subject is marked out of this term (the exams' "out of" added up).
  const examsOutOf = (results?.exams ?? []).reduce((n, e) => n + e.maxMarks, 0);
  const outOf = (subjectId: string) => Math.max(examsOutOf, ...(results?.students ?? []).map((r) => r.subjects[subjectId]?.possible ?? 0));
  const totalOutOf = Math.max(0, ...(results?.students ?? []).map((r) => r.possible ?? 0));
  const marks = (n: number | null | undefined, possible: number | null | undefined) => (possible ? String(Math.round((n ?? 0) * 100) / 100) : '—');
  const exportCsv = () => {
    if (!results) return;
    downloadCSV(`results-${classes.find((c) => c._id === classId)?.cl_name ?? 'class'}`, results.students.map((r) => ({
      Position: r.position ?? '',
      Student: r.student.name,
      'Admission no.': r.student.admissionNumber ?? '',
      Section: r.student.section ?? '',
      ...Object.fromEntries(results.subjects.map((s) => [`${s.name} (out of ${outOf(s._id)})`, r.subjects[s._id]?.possible ? r.subjects[s._id].earned : ''])),
      [`Total (out of ${totalOutOf})`]: r.possible ? r.earned : '',
      'Average %': r.percent ?? '',
      Grade: r.grade?.grade ?? '',
    })));
  };

  return (
    <div className="space-y-5">
      <Card className="rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect label="Term" value={termId} onChange={setTermId} className="w-60"
            options={terms.map((t) => ({ value: t._id, label: termLabel(t) }))} placeholder="Choose term" />
          <FilterSelect label="Class" value={classId} onChange={(v) => { setClassId(v); setSectionId(''); }} className="w-48"
            options={classOptions.map((c) => ({ value: c._id, label: c.cl_name }))} placeholder="Choose class" />
          <FilterSelect label="Section" value={sectionId} onChange={setSectionId} className="w-40" disabled={!classSections.length}
            placeholder="Choose section"
            options={[...(wholeClassAllowed ? [{ value: '', label: 'Whole class' }] : []), ...classSections.map((s) => ({ value: s._id, label: s.name }))]} />
          {results && results.students.length > 0 && (
            <Button variant="outline" className="ml-auto" onClick={exportCsv}><DownloadSimple size={16} /> Export CSV</Button>
          )}
        </div>
      </Card>

      {pairs && pairs.length === 0 ? (
        <Card className="rounded-2xl"><EmptyState icon={UsersThree} tint="yellow" title="No classes this term" text="You aren't assigned to a class in this term. Ask the academic office to add you to the timetable." /></Card>
      ) : !classId ? (
        <Card className="rounded-2xl"><EmptyState icon={ChartBar} tint="blue" title="Choose a class" text="See every student's marks, grade and position for the term." /></Card>
      ) : error ? (
        <Card className="rounded-2xl"><ErrorState text={error} /></Card>
      ) : (
        <>
          <StatStrip items={[
            { label: 'Students', value: results?.summary.students ?? '—', icon: UsersThree, tone: 'sky', hint: `${results?.summary.marked ?? 0} with marks` },
            { label: 'Class average', value: formatPercent(results?.summary.average), icon: ChartBar, tone: 'violet', hint: `${results?.exams.length ?? 0} exam${results?.exams.length === 1 ? '' : 's'} this term` },
            { label: 'Passed', value: results ? `${results.summary.passed} / ${results.summary.marked}` : '—', icon: CheckCircle, tone: 'emerald', hint: `${results?.passPercent ?? 50}% or more overall` },
            { label: 'Top student', value: top ? formatPercent(top.percent) : '—', icon: Trophy, tone: 'amber', hint: top?.student.name ?? 'No marks yet' },
          ]} />
          <Card className="overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wider hover:bg-muted/50">
                    <TableHead className="w-16 pl-5 font-semibold">Pos.</TableHead>
                    <TableHead className="font-semibold">Student</TableHead>
                    {results?.subjects.map((s) => (
                      <TableHead key={s._id} className="text-center font-semibold">{s.code || s.name}<span className="block text-[10px] font-normal normal-case">out of {outOf(s._id)}</span></TableHead>
                    ))}
                    <TableHead className="text-center font-semibold">Total<span className="block text-[10px] font-normal normal-case">out of {totalOutOf}</span></TableHead>
                    <TableHead className="text-center font-semibold">Average</TableHead>
                    <TableHead className="pr-5 text-center font-semibold">Grade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && !results ? <TableLoadingRows columns={6} avatar /> : !results?.students.length ? (
                    <TableEmptyRow colSpan={5 + (results?.subjects.length ?? 0)} icon={Exam} tint="green" title="No results yet"
                      text={results?.exams.length ? 'Marks show here as teachers enter them.' : 'There are no exams for this class in this term yet.'} />
                  ) : results.students.map((r) => (
                    <TableRow key={r.student._id} className={cn('cursor-pointer', loading && 'opacity-60')} onClick={() => setCard({ id: r.student._id, name: r.student.name })}>
                      <TableCell className="pl-5">
                        {r.position ? (
                          <span className={cn('inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-xs font-bold tabular-nums', POSITION_TONE[r.position] ? `${POSITION_TONE[r.position]} text-tile-foreground` : 'bg-muted text-foreground/80')}>
                            {r.position}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {r.student.name}
                          {r.student.held && <span className="ml-2 rounded-full bg-tile-pink px-1.5 py-0.5 text-[10px] font-medium text-tile-foreground" title="The office hid this student's results from them and their parents.">Hidden</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{[r.student.admissionNumber, r.student.section && `Section ${r.student.section}`].filter(Boolean).join(' · ')}</p>
                      </TableCell>
                      {results.subjects.map((s) => (
                        <TableCell key={s._id} className="text-center text-sm tabular-nums">{marks(r.subjects[s._id]?.earned, r.subjects[s._id]?.possible)}</TableCell>
                      ))}
                      <TableCell className="text-center font-semibold tabular-nums">{marks(r.earned, r.possible)}</TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{formatPercent(r.percent)}</TableCell>
                      <TableCell className="pr-5 text-center"><GradeChip grade={r.grade?.grade} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {!!results?.students.length && (
                  <TableFooter>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell className="pl-5" />
                      <TableCell className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Class average</TableCell>
                      {results.subjects.map((s) => <TableCell key={s._id} className="text-center text-sm font-semibold tabular-nums">{formatPercent(s.average)}</TableCell>)}
                      <TableCell />
                      <TableCell className="text-center font-semibold tabular-nums">{formatPercent(results.summary.average)}</TableCell>
                      <TableCell className="pr-5" />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
            {!!results?.students.length && (
              <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
                {results.ownSubjectsOnly ? 'Only the subjects you teach are shown; totals and positions are for these subjects. ' : ''}Click a student to open their report card.
              </p>
            )}
          </Card>
        </>
      )}

      {card && <ReportCardDialog studentId={card.id} studentName={card.name} termId={termId} onClose={() => setCard(null)} />}
    </div>
  );
}
