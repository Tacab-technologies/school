import { useEffect, useMemo, useState } from 'react';
import { SpinnerGap, Exam as ExamIcon, Tray } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/common/EmptyState';
import FilterSelect from '@/components/shared/FilterSelect';
import { examsApi, apiMessage } from '../../exams/api/examsApi';
import type { ExamItem, MarkingOptions } from '../../exams/types';
import { reportsApi } from '../api/reportsApi';
import type { ReportResult, ReportSummaryItem } from '../types';
import { messageOf } from '../utils/format';
import ReportActions from './ReportActions';
import { ReportTable, SummaryTiles } from './ReportTable';

/** The marks and results reports, quickest to reach at exam time. */
// exam-my-class-results and exam-marking-progress are the teachers' own
// (examReports.js); results-marking-progress is the office's whole-school
// version. exam-results-by-class and exam-student-results live in
// resultsReports.js; teaching-class-results is the teachers' version of the latter.
export const EXAM_REPORT_IDS = [
  'exam-my-class-results', 'teaching-class-results', 'exam-marking-progress',
  'results-marking-progress', 'exam-results-by-class', 'exam-student-results',
];

/**
 * Pick a marks report, an exam and (when the report needs it) a class, section
 * and subject, then see it here or download it. Teachers are only offered the
 * classes and subjects they teach in that exam.
 */
export default function ExamReportsPanel({ reports }: { reports: ReportSummaryItem[] }) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? '');
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [examId, setExamId] = useState('');
  const [options, setOptions] = useState<MarkingOptions | null>(null);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const report = reports.find((r) => r.id === reportId);
  const wants = (key: string) => !!report?.filters.some((f) => f.key === key);

  useEffect(() => {
    examsApi.list().then((list) => {
      setExams(list);
      if (list.length) setExamId((id) => id || list[0]._id);
    }).catch(() => setExams([]));
  }, []);

  useEffect(() => {
    setOptions(null); setClassId(''); setSectionId(''); setSubjectId('');
    if (!examId) return;
    examsApi.options(examId).then(setOptions).catch(() => setOptions(null));
  }, [examId]);

  const pairs = options?.pairs ?? null;
  const classOptions = options?.classes ?? [];
  const sectionOptions = useMemo(() => (options?.sections ?? []).filter((s) => s.classId === classId
    && (!pairs || pairs.some((p) => p.classId === classId && p.sectionId === s._id))), [options, classId, pairs]);
  const subjectOptions = useMemo(() => (options?.subjects ?? []).filter((s) => (pairs
    ? pairs.some((p) => p.classId === classId && (!sectionId || p.sectionId === sectionId) && p.subjectId === s._id)
    : !s.classIds?.length || s.classIds.includes(classId))), [options, classId, sectionId, pairs]);

  // Pick the only choice automatically.
  useEffect(() => { if (!classId && classOptions.length === 1) setClassId(classOptions[0]._id); }, [classOptions, classId]);
  useEffect(() => { if (!subjectId && subjectOptions.length === 1) setSubjectId(subjectOptions[0]._id); }, [subjectOptions, subjectId]);

  const missing = !examId ? 'Choose an exam.'
    : wants('class_id') && reportId !== 'exam-results-by-class' && !classId ? 'Choose a class.'
      : wants('subject_id') && !subjectId ? 'Choose a subject.' : '';

  const filters = useMemo(() => {
    const f: Record<string, string> = { exam_id: examId };
    if (wants('class_id') && classId) f.class_id = classId;
    if (wants('section_id') && sectionId) f.section_id = sectionId;
    if (wants('subject_id') && subjectId) f.subject_id = subjectId;
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, classId, sectionId, subjectId, reportId]);

  useEffect(() => {
    setResult(null); setError('');
    if (!reportId || missing) return;
    let cancelled = false;
    setLoading(true);
    reportsApi.run(reportId, filters)
      .then((res) => { if (!cancelled) setResult(res); })
      .catch((err) => { if (!cancelled) setError(apiMessage(err, 'Could not load the report.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reportId, filters, missing]);

  const message = result ? messageOf(result.columns) : '';

  return (
    <Card className="overflow-hidden rounded-2xl print:hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tile-yellow text-tile-foreground">
          <ExamIcon size={20} weight="bold" />
        </span>
        <div className="mr-auto min-w-0">
          <h3 className="text-base font-semibold text-foreground">Marks &amp; results</h3>
          <p className="text-sm text-muted-foreground">How did students do in an exam? Choose a report and an exam, and the table appears straight away.</p>
        </div>
        {report && <ReportActions reportId={report.id} title={report.title} filters={filters} result={result} />}
      </div>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect label="Report" value={reportId} onChange={setReportId}
          options={reports.map((r) => ({ value: r.id, label: r.title }))} />
        <FilterSelect label="Exam" value={examId} onChange={setExamId} placeholder={exams.length ? 'Choose an exam' : 'No exams yet'} disabled={!exams.length}
          options={exams.map((e) => ({ value: e._id, label: `${e.name}${e.term ? ` · ${e.term.name}` : ''}` }))} />
        {wants('class_id') && (
          <FilterSelect label="Class" value={classId} onChange={(v) => { setClassId(v); setSectionId(''); setSubjectId(''); }} disabled={!options}
            placeholder={reportId === 'exam-results-by-class' ? 'All classes' : 'Choose a class'}
            options={[...(reportId === 'exam-results-by-class' ? [{ value: '', label: 'All classes' }] : []), ...classOptions.map((c) => ({ value: c._id, label: c.name }))]} />
        )}
        {wants('section_id') && (
          <FilterSelect label="Section" value={sectionId} onChange={(v) => { setSectionId(v); setSubjectId(''); }} disabled={!sectionOptions.length}
            placeholder={pairs ? 'Choose a section' : 'Whole class'}
            options={[...(pairs ? [] : [{ value: '', label: 'Whole class' }]), ...sectionOptions.map((s) => ({ value: s._id, label: s.name }))]} />
        )}
        {wants('subject_id') && (
          <FilterSelect label="Subject" value={subjectId} onChange={setSubjectId} placeholder="Choose a subject" disabled={!classId}
            options={subjectOptions.map((s) => ({ value: s._id, label: s.name }))} />
        )}
      </div>
      {report && (report.question || report.description) && (
        <p className="border-b border-border bg-muted/30 px-5 py-2 text-xs text-muted-foreground">{report.question || report.description}</p>
      )}

      {missing ? (
        <EmptyState compact icon={ExamIcon} tint="yellow" title={missing} text={report?.description ?? ''} />
      ) : error ? (
        <ErrorState compact text={error} />
      ) : loading && !result ? (
        <div className="flex items-center justify-center py-12"><SpinnerGap className="h-6 w-6 animate-spin text-primary" /></div>
      ) : result ? (
        <>
          {result.summary.length > 0 && <div className="px-5 pt-4"><SummaryTiles summary={result.summary} /></div>}
          {!result.rows.length ? (
            <EmptyState compact icon={Tray} tint="blue" title="Nothing to show yet" text={message || 'No marks have been entered for this choice yet.'} />
          ) : (
            <div className="mt-4 border-t border-border">
              <ReportTable columns={result.columns} rows={result.rows} dimmed={loading} />
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
