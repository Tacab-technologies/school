import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, CalendarBlank, CheckCircle, Clock, FloppyDisk, LockSimple, NotePencil, PaperPlaneTilt, SpinnerGap, UsersThree } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, ListLoading, TableEmptyRow, TableLoadingRows } from '@/components/common/EmptyState';
import { confirmAction } from '@/components/common/ConfirmDialog';
import FilterSelect from '@/components/shared/FilterSelect';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { examsApi, apiMessage } from '../api/examsApi';
import { formatPercent, gradeLetter } from '../grading';
import type { ExamItem, MarkRow, Marksheet, MarkingOptions, ProgressRow } from '../types';
import { GradeChip } from './ReportCard';
import { entryText } from '../entryWindow';

type Draft = { score: string; absent: boolean; remark: string };
const toDraft = (r: MarkRow): Draft => ({ score: r.score === null ? '' : String(r.score), absent: r.absent, remark: r.remark });

/** Where one mark sheet stands, in plain words. */
function sheetBadge(p: ProgressRow) {
  if (p.editRequested) return { label: 'Change requested', icon: Clock, className: 'bg-tile-pink text-tile-foreground' };
  if (p.unlocked) return { label: 'Open for changes', icon: ArrowCounterClockwise, className: 'bg-tile-blue text-tile-foreground' };
  if (p.status === 'submitted') return { label: 'Submitted', icon: CheckCircle, className: 'bg-tile-green text-tile-foreground' };
  if (p.marked === 0) return { label: 'Not started', icon: NotePencil, className: 'bg-muted text-muted-foreground' };
  if (p.remaining === 0) return { label: 'Ready to submit', icon: PaperPlaneTilt, className: 'bg-tile-blue text-tile-foreground' };
  return { label: 'Draft', icon: NotePencil, className: 'bg-tile-yellow text-tile-foreground' };
}

export default function MarkEntryTab({ exams, loadingExams = false, examId, onExamChange }: {
  exams: ExamItem[]; loadingExams?: boolean; examId: string; onExamChange: (id: string) => void;
}) {
  const { showToast } = useToast();
  const [options, setOptions] = useState<MarkingOptions | null>(null);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [sheet, setSheet] = useState<Marksheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const [progress, setProgress] = useState<ProgressRow[] | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [optionsTry, setOptionsTry] = useState(0);

  // With only one exam to mark, open it straight away.
  useEffect(() => { if (!examId && exams.length === 1) onExamChange(exams[0]._id); }, [examId, exams, onExamChange]);

  // What this person may mark in the chosen exam.
  useEffect(() => {
    setOptions(null); setSheet(null); setClassId(''); setSectionId(''); setSubjectId(''); setProgress(null);
    if (!examId) return;
    setOptionsError('');
    examsApi.options(examId).then(setOptions).catch((err) => setOptionsError(apiMessage(err, 'Could not load your classes for this exam.')));
  }, [examId, optionsTry]);

  // Every mark sheet of this exam: a teacher's own, or all of them for the office.
  const isTeacher = !!options?.pairs;
  const loadProgress = useCallback(() => {
    if (!examId) return;
    examsApi.progress(examId).then((p) => setProgress(p.rows)).catch(() => setProgress(null));
  }, [examId]);
  useEffect(() => { if (options) loadProgress(); }, [options, loadProgress]);

  const pairs = options?.pairs ?? null;
  const classOptions = useMemo(() => options?.classes ?? [], [options]);
  const sectionOptions = useMemo(() => (options?.sections ?? []).filter((s) => s.classId === classId
    && (!pairs || pairs.some((p) => p.classId === classId && (!p.sectionId || p.sectionId === s._id)))), [options, classId, pairs]);
  const subjectOptions = useMemo(() => (options?.subjects ?? []).filter((s) => {
    if (pairs) return pairs.some((p) => p.classId === classId && (!sectionId || !p.sectionId || p.sectionId === sectionId) && p.subjectId === s._id);
    return !s.classIds?.length || s.classIds.includes(classId);
  }), [options, classId, sectionId, pairs]);
  const needsSection = sectionOptions.length > 0;
  const ready = !!examId && !!classId && !!subjectId && (!needsSection || !!sectionId);
  const key = useMemo(() => ({ classId, sectionId, subjectId }), [classId, sectionId, subjectId]);

  // Pick the only choice automatically (a teacher with one class, etc.).
  useEffect(() => { if (!classId && classOptions.length === 1) setClassId(classOptions[0]._id); }, [classOptions, classId]);
  useEffect(() => { if (!sectionId && sectionOptions.length === 1) setSectionId(sectionOptions[0]._id); }, [sectionOptions, sectionId]);
  useEffect(() => { if (!subjectId && subjectOptions.length === 1) setSubjectId(subjectOptions[0]._id); }, [subjectOptions, subjectId]);

  const loadSheet = useCallback(async () => {
    const res = await examsApi.marksheet(examId, key);
    setSheet(res);
    setDrafts(Object.fromEntries(res.rows.map((r) => [r.studentId, toDraft(r)])));
  }, [examId, key]);

  useEffect(() => {
    if (!ready) { setSheet(null); return; }
    let cancelled = false;
    setLoading(true);
    // Clear the last sheet so a slow load never shows another class's marks.
    setSheet(null);
    examsApi.marksheet(examId, key)
      .then((res) => {
        if (cancelled) return;
        setSheet(res);
        setDrafts(Object.fromEntries(res.rows.map((r) => [r.studentId, toDraft(r)])));
      })
      .catch((err) => { if (!cancelled) showToast(apiMessage(err, 'Could not load the mark sheet.'), 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ready, examId, key, showToast]);

  const max = sheet?.exam.maxMarks ?? 100;
  const locked = !!sheet?.locked;
  const unlocked = !!sheet?.sheet.unlocked;
  const requestPending = sheet?.sheet.editRequest?.status === 'pending';
  const submitted = sheet?.sheet.status === 'submitted';
  const savedCount = (sheet?.rows ?? []).filter((r) => r.score !== null || r.absent).length;
  const changed = useMemo(() => (sheet?.rows ?? []).filter((r) => {
    const d = drafts[r.studentId];
    const o = toDraft(r);
    return d && (d.score !== o.score || d.absent !== o.absent || d.remark !== o.remark);
  }), [sheet, drafts]);
  const invalid = (d?: Draft) => !!d && !d.absent && d.score !== '' && (Number.isNaN(Number(d.score)) || Number(d.score) < 0 || Number(d.score) > max);
  const anyInvalid = Object.values(drafts).some(invalid);

  // Absent counts as 0, the same as on results and report cards.
  const scored = Object.values(drafts).filter((d) => d.absent || (d.score !== '' && !invalid(d)));
  const average = scored.length ? (scored.reduce((n, d) => n + (d.absent ? 0 : Number(d.score)), 0) / scored.length / max) * 100 : null;
  const marked = scored.length;
  const blanks = (sheet?.rows.length ?? 0) - marked;

  const setDraft = (id: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...all[id], ...patch } }));

  const save = async () => {
    if (!sheet || !changed.length) return;
    setSaving(true);
    try {
      const marks = changed.map((r) => {
        const d = drafts[r.studentId];
        return { studentId: r.studentId, score: d.absent || d.score === '' ? null : Number(d.score), absent: d.absent, remark: d.remark };
      });
      await examsApi.saveMarks(examId, key, marks);
      showToast(`${marks.length} mark${marks.length === 1 ? '' : 's'} saved as a draft.`);
      await loadSheet();
      loadProgress();
    } catch (err) {
      showToast(apiMessage(err, 'Could not save the marks.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const ok = await confirmAction({
      title: 'Submit these marks?',
      text: "After you submit you can't change them without the academic office's permission.",
      confirmLabel: 'Submit marks',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await examsApi.submitSheet(examId, key);
      showToast('Marks submitted to the academic office.');
      await loadSheet();
      loadProgress();
    } catch (err) {
      showToast(apiMessage(err, 'Could not submit the marks.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    const ok = await confirmAction({ title: 'Allow changes to this sheet?', text: 'Its teacher can change the marks until they submit again.', confirmLabel: 'Allow changes' });
    if (!ok) return;
    try {
      await examsApi.reopenSheet(examId, key);
      showToast('The teacher can change these marks now.');
      await loadSheet();
      loadProgress();
    } catch (err) {
      showToast(apiMessage(err, 'Could not open the sheet.'), 'error');
    }
  };

  // Enter moves down the list, like a spreadsheet.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Enter') { e.preventDefault(); inputs.current[i + 1]?.focus(); inputs.current[i + 1]?.select(); }
  };

  // The office sees every sheet; the class picker narrows the list.
  const sheetList = (progress ?? []).filter((p) => isTeacher || !classId || p.classId === classId);
  const doneCount = sheetList.filter((p) => p.status === 'submitted').length;

  return (
    <div className="space-y-5">
      <Card className="rounded-2xl p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect label="Exam" value={examId} onChange={onExamChange} placeholder="Choose exam"
            options={exams.map((e) => ({ value: e._id, label: `${e.name}${e.term ? ` · ${e.term.name}` : ''}` }))} />
          <FilterSelect label="Class" value={classId} onChange={(v) => { setClassId(v); setSectionId(''); setSubjectId(''); }} placeholder="Choose class"
            disabled={!options} options={classOptions.map((c) => ({ value: c._id, label: c.name }))} />
          <FilterSelect label="Section" value={sectionId} onChange={(v) => { setSectionId(v); setSubjectId(''); }}
            placeholder={classId && !needsSection ? 'No sections' : 'Choose section'} disabled={!needsSection}
            options={sectionOptions.map((s) => ({ value: s._id, label: s.name }))} />
          <FilterSelect label="Subject" value={subjectId} onChange={setSubjectId} placeholder="Choose subject" disabled={!classId}
            options={subjectOptions.map((s) => ({ value: s._id, label: s.name }))} />
        </div>
      </Card>

      {!!sheetList.length && (
        <Card className="rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{isTeacher ? 'Your mark sheets' : 'Mark sheets in this exam'}</h3>
            <p className="text-xs text-muted-foreground">{doneCount} of {sheetList.length} submitted · click one to open it</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {sheetList.map((p) => {
              const badge = sheetBadge(p);
              const current = p.classId === classId && (p.sectionId ?? '') === sectionId && p.subjectId === subjectId;
              return (
                <Button variant="plain" key={`${p.classId}-${p.sectionId}-${p.subjectId}`} type="button"
                  onClick={() => { setClassId(p.classId); setSectionId(p.sectionId ?? ''); setSubjectId(p.subjectId); }}
                  className={cn('flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                    current ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{[p.className, p.sectionName].filter(Boolean).join(' ')} · {p.subjectName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.marked} / {p.students} marked{!isTeacher && p.teachers ? ` · ${p.teachers}` : ''}
                    </span>
                  </span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', badge.className)}>
                    <badge.icon size={12} /> {badge.label}
                  </span>
                </Button>
              );
            })}
          </div>
        </Card>
      )}

      {optionsError ? (
        <Card className="rounded-2xl"><ErrorState text={optionsError} onRetry={() => setOptionsTry((n) => n + 1)} /></Card>
      ) : loadingExams || (examId && !options) ? (
        <Card className="rounded-2xl"><ListLoading rows={4} /></Card>
      ) : !examId ? (
        <Card className="rounded-2xl"><EmptyState icon={NotePencil} tint="green" title="Choose an exam" text={exams.length ? 'Then pick the class and subject you want to enter marks for.' : 'No exams yet. The academic office creates them on the Exams tab.'} /></Card>
      ) : options && pairs?.length === 0 ? (
        <Card className="rounded-2xl"><EmptyState icon={UsersThree} tint="yellow" title="No classes to mark" text="You aren't assigned to a class in this exam. Ask the academic office to add you to the timetable." /></Card>
      ) : !ready ? (
        <Card className="rounded-2xl"><EmptyState icon={NotePencil} tint="blue" title="Pick a mark sheet" text="Click one of the sheets above, or choose a class and subject. The class list opens here, ready for marks." /></Card>
      ) : (
        <Card className="overflow-hidden rounded-2xl">
          {sheet?.exam.published ? (
            <div className="flex items-center gap-2 border-b border-border bg-tile-yellow px-4 py-2.5 text-sm text-tile-foreground">
              <LockSimple size={16} /> {isTeacher ? "These results are published, so marks can't be changed. Ask the academic office to unpublish them first." : 'These results are published. Students and parents can see them.'}
            </div>
          ) : unlocked ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-tile-blue px-4 py-2.5 text-sm text-tile-foreground">
              <ArrowCounterClockwise size={16} /> {isTeacher ? 'The academic office let you change these marks. Save, then submit again when you finish.' : 'The teacher may change this sheet until they submit again.'}
            </div>
          ) : (sheet && (locked || !isTeacher)) ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/60 px-4 py-2.5 text-sm text-foreground">
              <span className="flex items-center gap-2">
                <LockSimple size={16} />
                {isTeacher
                  ? requestPending
                    ? 'You asked to change marks here; waiting for the academic office.'
                    : submitted
                      ? "You submitted these marks. To change one, ask the academic office."
                      : `${entryText(sheet.exam)}. Ask the academic office for permission to enter or change marks.`
                  : submitted
                    ? "The teacher submitted this sheet. They can't change it without your permission."
                    : `Draft: ${savedCount} of ${sheet.rows.length} marked, not submitted yet.`}
              </span>
              {isTeacher && !requestPending && <Button size="xs" variant="outline" onClick={() => setAsking(true)}><NotePencil size={13} /> Ask to change</Button>}
              {!isTeacher && <Button size="xs" variant="outline" onClick={() => void reopen()}><ArrowCounterClockwise size={13} /> Allow changes</Button>}
            </div>
          ) : sheet && isTeacher ? (
            <div className="flex items-center gap-2 border-b border-border bg-tile-green/60 px-4 py-2.5 text-sm text-tile-foreground">
              <CalendarBlank size={16} /> {entryText(sheet.exam)}. Save as a draft and come back any time. When every student has a mark or Absent, submit; after that, changes need the office's permission.
            </div>
          ) : null}
          {isTeacher && sheet?.sheet.editRequest?.status === 'rejected' && !unlocked && (
            <div className="border-b border-border bg-tile-pink px-4 py-2.5 text-sm text-tile-foreground">
              The office kept the marks as they are.{sheet.sheet.editRequest.note ? ` Note: ${sheet.sheet.editRequest.note}` : ''}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[680px]">
              <TableHeader>
                <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wider hover:bg-muted/50">
                  <TableHead className="w-12 pl-5 font-semibold">#</TableHead>
                  <TableHead className="font-semibold">Student</TableHead>
                  <TableHead className="w-40 font-semibold">Mark (out of {max})</TableHead>
                  <TableHead className="w-24 text-center font-semibold">Absent</TableHead>
                  <TableHead className="w-20 text-center font-semibold">Grade</TableHead>
                  <TableHead className="pr-5 font-semibold">Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !sheet ? <TableLoadingRows columns={6} avatar={false} /> : !sheet?.rows.length ? (
                  <TableEmptyRow colSpan={6} icon={UsersThree} tint="blue" title="No students in this class" text="Students registered in this class and section appear here." />
                ) : sheet.rows.map((r, i) => {
                  const d = drafts[r.studentId] ?? toDraft(r);
                  const bad = invalid(d);
                  const pct = !d.absent && d.score !== '' && !bad ? (Number(d.score) / max) * 100 : d.absent ? 0 : null;
                  return (
                    <TableRow key={r.studentId} className={cn(!locked && !d.absent && d.score === '' && marked > 0 && 'bg-tile-yellow/20')}>
                      <TableCell className="pl-5 text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.admissionNumber}
                          {r.noSection && <span className="ml-2 rounded-full bg-tile-yellow px-1.5 py-0.5 text-[10px] font-medium text-tile-foreground" title="This student has no section yet. Ask the office to set one.">No section</span>}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Input ref={(el) => { inputs.current[i] = el; }} type="number" inputMode="decimal" min={0} max={max} step="0.5"
                          value={d.absent ? '' : d.score} disabled={locked || d.absent} placeholder={d.absent ? 'Absent' : '—'}
                          aria-label={`Mark for ${r.name}`} aria-invalid={bad}
                          className={cn('h-9 w-28 tabular-nums', bad && 'border-destructive focus-visible:ring-destructive')}
                          onChange={(e) => setDraft(r.studentId, { score: e.target.value })} onKeyDown={(e) => onKey(e, i)} />
                        {bad && <p className="mt-1 text-[11px] text-destructive">0 to {max}</p>}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox checked={d.absent} disabled={locked} aria-label={`${r.name} was absent`}
                          onCheckedChange={(v) => setDraft(r.studentId, { absent: v === true, score: v === true ? '' : d.score })} />
                      </TableCell>
                      <TableCell className="text-center"><GradeChip grade={gradeLetter(pct)} /></TableCell>
                      <TableCell className="pr-5">
                        <Input value={d.remark} maxLength={200} disabled={locked} placeholder="Optional" aria-label={`Remark for ${r.name}`}
                          className="h-9" onChange={(e) => setDraft(r.studentId, { remark: e.target.value })} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {!!sheet?.rows.length && (
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{marked}</span> of {sheet.rows.length} marked · class average <span className="font-semibold text-foreground">{formatPercent(average === null ? null : Math.round(average * 10) / 10)}</span>
                {changed.length > 0 && <span className="ml-2 rounded-full bg-tile-yellow px-2 py-0.5 text-xs font-medium text-tile-foreground">{changed.length} unsaved</span>}
              </p>
              {!locked && (
                <div className="flex flex-wrap items-center gap-2">
                  {blanks > 0 && <span className="text-xs text-muted-foreground">{blanks} still blank: give a mark or tick Absent</span>}
                  <Button variant="outline" onClick={() => void save()} disabled={saving || !changed.length || anyInvalid}>
                    {saving ? <SpinnerGap size={16} className="animate-spin" /> : <FloppyDisk size={16} />} {saving ? 'Saving…' : 'Save draft'}
                  </Button>
                  {(isTeacher ? !submitted : !submitted && !sheet.exam.published) && (
                    <Button onClick={() => void submit()} disabled={saving || blanks > 0 || changed.length > 0 || anyInvalid}
                      title={blanks > 0 ? 'Every student needs a mark or Absent' : changed.length ? 'Save your changes first' : undefined}>
                      <PaperPlaneTilt size={16} /> Submit
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {asking && sheet && (
        <AskToChangeDialog examId={examId} sheetKey={key} onClose={() => setAsking(false)}
          onSent={() => { setAsking(false); void loadSheet(); loadProgress(); }} />
      )}
    </div>
  );
}

function AskToChangeDialog({ examId, sheetKey, onClose, onSent }: {
  examId: string; sheetKey: { classId: string; sectionId: string; subjectId: string }; onClose: () => void; onSent: () => void;
}) {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      await examsApi.requestEdit(examId, sheetKey, reason.trim());
      showToast('Request sent. The academic office will answer it.');
      onSent();
    } catch (err) {
      showToast(apiMessage(err, 'Could not send the request.'), 'error');
      setSending(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent centered className="max-w-md">
        <DialogHeader icon={NotePencil} tint="yellow">
          <DialogTitle>Ask to change these marks</DialogTitle>
          <DialogDescription>The academic office reads your reason. If they agree, the sheet opens again for you.</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3}
          placeholder="e.g. I entered Amina's mark in the wrong row" aria-label="Reason" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void send()} disabled={sending || reason.trim().length < 3}>{sending ? 'Sending…' : 'Send request'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
