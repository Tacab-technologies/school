import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarBlank, CheckCircle, Clock, Exam, EyeSlash, ListChecks, LockSimple, Megaphone, NotePencil, PaperPlaneTilt, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSection } from '@/components/ui/drawer-kit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, ListLoading } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import FilterSelect from '@/components/shared/FilterSelect';
import StatStrip from '@/components/shared/StatStrip';
import { useToast } from '@/hooks/use-toast';
import { confirmAction } from '@/components/common/ConfirmDialog';
import type { Class, Term } from '../../academic-structure/types';
import { examsApi, apiMessage } from '../api/examsApi';
import type { EditRequest, ExamInput, ExamItem } from '../types';
import { entryText } from '../entryWindow';
import SheetsDrawer from './SheetsDrawer';
import HoldsDrawer from './HoldsDrawer';

export const termLabel = (t: Term) => {
  const year = typeof t.academicYearId === 'object' ? t.academicYearId?.y_name : null;
  return year ? `${t.name} · ${year}` : t.name;
};

const formatDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date set');
function ExamForm({ initial, terms, classes, defaultTermId, onClose, onSaved }: {
  initial: ExamItem | null; terms: Term[]; classes: Class[]; defaultTermId: string; onClose: () => void; onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState<ExamInput>({
    name: initial?.name ?? '',
    termId: initial?.termId ?? defaultTermId,
    maxMarks: initial?.maxMarks ?? 100,
    date: initial?.date ? initial.date.slice(0, 10) : null,
    classIds: initial?.classIds ?? [],
    marksOpenFrom: initial?.marksOpenFrom ? initial.marksOpenFrom.slice(0, 10) : null,
    marksOpenUntil: initial?.marksOpenUntil ? initial.marksOpenUntil.slice(0, 10) : null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const allClasses = form.classIds.length === 0;

  const toggleClass = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, classIds: on ? [...f.classIds, id] : f.classIds.filter((c) => c !== id) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (initial) await examsApi.update(initial._id, form);
      else await examsApi.create(form);
      showToast(initial ? `${form.name} saved.` : `${form.name} created. Teachers can now enter marks.`);
      onSaved();
    } catch (err) {
      setError(apiMessage(err, 'Could not save the exam.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={initial ? PencilSimple : Exam} tint="green">
          <DialogTitle>{initial ? 'Edit exam' : 'New exam'}</DialogTitle>
          <DialogDescription>Teachers enter one mark per student for each subject in this exam.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <FormSection title="Exam">
            <div className="space-y-1.5">
              <Label htmlFor="exam-name" className="text-xs font-semibold">Name *</Label>
              <Input id="exam-name" value={form.name} maxLength={80} required placeholder="e.g. Midterm, Final exam, Quiz 1"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FilterSelect label="Term *" value={form.termId} onChange={(termId) => setForm({ ...form, termId })}
                options={terms.map((t) => ({ value: t._id, label: termLabel(t) }))} placeholder="Choose term" />
              <div className="space-y-1.5">
                <Label htmlFor="exam-max" className="text-xs font-medium text-muted-foreground">Marked out of *</Label>
                <Input id="exam-max" type="number" min={1} max={1000} required value={form.maxMarks}
                  onChange={(e) => setForm({ ...form, maxMarks: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Date (optional)</span>
              <DatePicker value={form.date ?? ''} onChange={(date) => setForm({ ...form, date: date || null })} clearable placeholder="Pick a date" aria-label="Exam date" />
            </div>
          </FormSection>
          <FormSection title="When teachers can enter marks" description="After the last day, entry closes. A teacher then needs your permission to enter or change marks.">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">From</span>
                <DatePicker value={form.marksOpenFrom ?? ''} onChange={(d) => setForm({ ...form, marksOpenFrom: d || null })} clearable placeholder="Straight away" aria-label="Marks entry opens" />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Until (last day)</span>
                <DatePicker value={form.marksOpenUntil ?? ''} onChange={(d) => setForm({ ...form, marksOpenUntil: d || null })} clearable placeholder="No end date" aria-label="Marks entry closes" />
              </div>
            </div>
          </FormSection>
          <FormSection title="Classes sitting it" description="Leave all unticked for every class.">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allClasses} onCheckedChange={(v) => v === true && setForm({ ...form, classIds: [] })} />
              Every class
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {classes.map((c) => (
                <label key={c._id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <Checkbox checked={form.classIds.includes(c._id)} onCheckedChange={(v) => toggleClass(c._id, v === true)} />
                  <span className="truncate">{c.cl_name}</span>
                </label>
              ))}
            </div>
          </FormSection>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.termId}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create exam'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ExamsTab({ terms, classes, canManage, onEnterMarks }: {
  terms: Term[]; classes: Class[]; canManage: boolean; onEnterMarks: (exam: ExamItem) => void;
}) {
  const { showToast } = useToast();
  const activeTerm = useMemo(() => terms.find((t) => t.status === 'active') ?? terms[0], [terms]);
  const [termId, setTermId] = useState('');
  const [exams, setExams] = useState<ExamItem[] | null>(null);
  const [editing, setEditing] = useState<ExamItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ExamItem | null>(null);
  const [sheetsOf, setSheetsOf] = useState<ExamItem | null>(null);
  const [holdsOf, setHoldsOf] = useState<ExamItem | null>(null);

  useEffect(() => { if (!termId && activeTerm) setTermId(activeTerm._id); }, [activeTerm, termId]);

  const load = useCallback(async () => {
    try {
      setExams(await examsApi.list(termId ? { termId } : {}));
    } catch (err) {
      showToast(apiMessage(err, 'Could not load exams.'), 'error');
      setExams([]);
    }
  }, [termId, showToast]);

  useEffect(() => { void load(); }, [load]);

  const togglePublish = async (exam: ExamItem) => {
    if (!exam.published) {
      const missing = exam.sheets.total - exam.sheets.submitted;
      const ok = await confirmAction({
        title: `Publish ${exam.name}?`,
        text: missing > 0
          ? `${missing} of ${exam.sheets.total} mark sheets are not submitted yet. Students and parents will see the results that are entered so far, and teachers can no longer change marks.`
          : 'Students and parents will see these results in their portal, and teachers can no longer change marks.',
        confirmLabel: 'Publish results',
      });
      if (!ok) return;
    }
    try {
      await examsApi.publish(exam._id, !exam.published);
      showToast(exam.published ? `${exam.name} hidden from students and parents.` : `${exam.name} published. Students and parents can see it now.`);
      void load();
    } catch (err) {
      showToast(apiMessage(err, 'Could not change this exam.'), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await examsApi.remove(deleting._id);
      showToast(`${deleting.name} deleted.`);
      setDeleting(null);
      void load();
    } catch (err) {
      showToast(apiMessage(err, 'Could not delete this exam.'), 'error');
      setDeleting(null);
    }
  };

  const list = exams ?? [];
  const [requests, setRequests] = useState<EditRequest[]>([]);
  const loadRequests = useCallback(() => {
    if (!canManage) return;
    examsApi.editRequests().then(setRequests).catch(() => setRequests([]));
  }, [canManage]);
  useEffect(() => { loadRequests(); }, [loadRequests]);
  const decide = async (r: EditRequest, approve: boolean) => {
    try {
      await examsApi.decideEditRequest(r._id, approve);
      showToast(approve ? `${r.teacher || 'The teacher'} can change ${r.subjectName} marks now.` : 'Request refused. The marks stay as submitted.');
      loadRequests();
      void load();
    } catch (err) {
      showToast(apiMessage(err, 'Could not answer this request.'), 'error');
    }
  };
  return (
    <div className="space-y-5">
      <StatStrip items={[
        { label: 'Exams', value: list.length, icon: Exam, tone: 'sky', hint: termId ? 'In this term' : 'All terms' },
        { label: 'Published', value: list.filter((e) => e.published).length, icon: Megaphone, tone: 'emerald', hint: 'Visible to students and parents' },
        { label: 'Sheets submitted', value: `${list.reduce((n, e) => n + e.sheets.submitted, 0)} / ${list.reduce((n, e) => n + e.sheets.total, 0)}`, icon: PaperPlaneTilt, tone: 'violet', hint: 'Teachers who finished marking' },
        ...(canManage ? [{ label: 'Change requests', value: requests.length, icon: Clock, tone: 'amber' as const, hint: 'Teachers waiting for your answer' }] : []),
      ]} />

      {canManage && requests.length > 0 && (
        <Card className="rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-foreground">Teachers asking to change submitted marks</h3>
          <p className="mb-3 text-xs text-muted-foreground">Approve to open the sheet again for the teacher; refuse to keep the marks as they are.</p>
          <ul className="divide-y divide-border">
            {requests.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{r.teacher || 'A teacher'} · {r.exam?.name} · {[r.className, r.sectionName].filter(Boolean).join(' ')} · {r.subjectName}</p>
                  <p className="text-xs text-muted-foreground">“{r.reason}”</p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="xs" onClick={() => void decide(r, true)}><CheckCircle size={13} /> Approve</Button>
                  <Button size="xs" variant="outline" onClick={() => void decide(r, false)}><X size={13} /> Refuse</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterSelect label="Term" value={termId} onChange={setTermId} className="w-64"
          options={[{ value: '', label: 'All terms' }, ...terms.map((t) => ({ value: t._id, label: termLabel(t) }))]} />
        {canManage && <Button onClick={() => setEditing('new')} disabled={!terms.length}><Plus size={16} /> New exam</Button>}
      </div>

      {exams === null ? (
        <Card className="rounded-2xl"><ListLoading rows={3} /></Card>
      ) : list.length === 0 ? (
        <Card className="rounded-2xl">
          <EmptyState icon={Exam} tint="green" title="No exams yet"
            text={terms.length ? 'Create the exams for this term (e.g. Midterm and Final). Teachers then enter marks for their classes.' : 'Add a school year and term under Settings › Academic structure first.'}
            action={canManage && terms.length > 0 && <Button onClick={() => setEditing('new')}><Plus size={16} /> New exam</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((exam) => {
            const done = exam.sheets.total ? Math.round((exam.sheets.submitted / exam.sheets.total) * 100) : 0;
            return (
              <Card key={exam._id} className="flex flex-col gap-4 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-foreground">{exam.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {exam.term ? `${exam.term.name}${exam.term.year ? ` · ${exam.term.year}` : ''}` : ''} · {formatDay(exam.date)} · out of {exam.maxMarks}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{exam.classes.length ? exam.classes.map((c) => c.name).join(', ') : 'Every class'}</p>
                  </div>
                  {exam.published
                    ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tile-green px-2.5 py-1 text-xs font-semibold text-tile-foreground"><CheckCircle size={13} /> Published</span>
                    : <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"><EyeSlash size={13} /> Not published</span>}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-foreground">Mark sheets submitted</span>
                    <span className="tabular-nums text-muted-foreground">{exam.sheets.submitted} of {exam.sheets.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-success transition-all" style={{ width: `${done}%` }} />
                  </div>
                  <p className={cn('flex items-center gap-1.5 text-xs', exam.window === 'open' ? 'text-muted-foreground' : 'font-medium text-warning')}>
                    {exam.window === 'open' ? <CalendarBlank size={13} /> : <LockSimple size={13} />} {entryText(exam)}
                    {exam.sheets.requests > 0 && <span className="ml-1 rounded-full bg-tile-pink px-2 py-0.5 font-medium text-tile-foreground">{exam.sheets.requests} change request{exam.sheets.requests === 1 ? '' : 's'}</span>}
                  </p>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  {canManage && (
                    <Button size="sm" variant={exam.published ? 'outline' : 'default'} onClick={() => void togglePublish(exam)}>
                      {exam.published ? <><EyeSlash size={15} /> Unpublish</> : <><Megaphone size={15} /> Publish results</>}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onEnterMarks(exam)}><NotePencil size={15} /> Marks</Button>
                  {canManage && <Button size="sm" variant="outline" onClick={() => setSheetsOf(exam)}><ListChecks size={15} /> Mark sheets</Button>}
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => setHoldsOf(exam)}>
                      <EyeSlash size={15} /> Hide results{exam.held > 0 ? ` (${exam.held})` : ''}
                    </Button>
                  )}
                  {canManage && (
                    <span className="ml-auto flex gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(exam)} aria-label={`Edit ${exam.name}`}><PencilSimple size={15} /></Button>
                      <Button variant="ghost" size="icon-sm" className="hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleting(exam)} aria-label={`Delete ${exam.name}`}><Trash size={15} /></Button>
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {sheetsOf && <SheetsDrawer exam={sheetsOf} onClose={() => setSheetsOf(null)} onChanged={() => { void load(); loadRequests(); }} />}
      {holdsOf && <HoldsDrawer exam={holdsOf} onClose={() => setHoldsOf(null)} onChanged={() => void load()} />}
      {editing && (
        <ExamForm initial={editing === 'new' ? null : editing} terms={terms} classes={classes} defaultTermId={termId || activeTerm?._id || ''}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      )}
      {deleting && (
        <Dialog open onOpenChange={(open) => { if (!open) setDeleting(null); }}>
          <DialogContent centered className="max-w-md">
            <DialogHeader icon={Trash} tint="pink">
              <DialogTitle>Delete {deleting.name}?</DialogTitle>
              <DialogDescription>Only an exam with no marks entered can be deleted.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
              <Button variant="destructive" onClick={() => void remove()}>Delete exam</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
