import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowCounterClockwise, CheckCircle, Clock, LockKeyOpen, NotePencil } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ListLoading } from '@/components/common/EmptyState';
import FilterSelect from '@/components/shared/FilterSelect';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { examsApi, apiMessage } from '../api/examsApi';
import type { ExamItem, ProgressRow } from '../types';

const status = (p: ProgressRow) => {
  if (p.unlocked) return { label: 'Allowed to change', icon: LockKeyOpen, className: 'bg-tile-blue text-tile-foreground' };
  if (p.status === 'submitted') return { label: 'Submitted', icon: CheckCircle, className: 'bg-tile-green text-tile-foreground' };
  if (p.marked === 0) return { label: 'Not started', icon: NotePencil, className: 'bg-muted text-muted-foreground' };
  return { label: 'Draft', icon: Clock, className: 'bg-tile-yellow text-tile-foreground' };
};

/**
 * Every mark sheet of an exam with its teacher: the office's place to give a
 * teacher permission to change submitted marks, or to work after the entry dates.
 */
export default function SheetsDrawer({ exam, onClose, onChanged }: { exam: ExamItem; onClose: () => void; onChanged: () => void }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ProgressRow[] | null>(null);
  const [teacher, setTeacher] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    examsApi.progress(exam._id).then((p) => setRows(p.rows)).catch((err) => { setRows([]); showToast(apiMessage(err, 'Could not load the mark sheets.'), 'error'); });
  }, [exam._id, showToast]);
  useEffect(() => { load(); }, [load]);

  const teachers = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.teachers.split(', ')).filter(Boolean))].sort(), [rows]);
  const shown = (rows ?? []).filter((r) => !teacher || r.teachers.split(', ').includes(teacher));
  const lockedShown = shown.filter((r) => !r.unlocked);

  const allow = async (list: ProgressRow[]) => {
    setBusy(true);
    try {
      await Promise.all(list.map((r) => examsApi.reopenSheet(exam._id, { classId: r.classId, sectionId: r.sectionId, subjectId: r.subjectId })));
      showToast(list.length === 1 ? `${list[0].teachers || 'The teacher'} can change this sheet now.` : `${list.length} sheets are open for changes.`);
      load();
      onChanged();
    } catch (err) {
      showToast(apiMessage(err, 'Could not give permission.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader icon={LockKeyOpen} tint="blue">
          <DialogTitle>{exam.name}: mark sheets</DialogTitle>
          <DialogDescription>Give a teacher permission to change marks. It lasts until they submit again.</DialogDescription>
        </DialogHeader>
        {rows === null ? <ListLoading rows={5} /> : rows.length === 0 ? (
          <EmptyState icon={NotePencil} tint="blue" title="No mark sheets yet" text="Sheets appear once teachers are assigned to the classes sitting this exam." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <FilterSelect label="Teacher" value={teacher} onChange={setTeacher} className="w-60"
                options={[{ value: '', label: 'All teachers' }, ...teachers.map((t) => ({ value: t, label: t }))]} />
              {teacher && lockedShown.length > 0 && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void allow(lockedShown)}>
                  <ArrowCounterClockwise size={15} /> Allow all of {teacher.split(' ')[0]}&apos;s sheets
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {shown.map((r) => {
                const s = status(r);
                return (
                  <li key={`${r.classId}-${r.sectionId}-${r.subjectId}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{[r.className, r.sectionName].filter(Boolean).join(' ')} · {r.subjectName}</p>
                      <p className="text-xs text-muted-foreground">{r.teachers || 'No teacher'} · {r.marked} of {r.students} marked</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', s.className)}><s.icon size={12} /> {s.label}</span>
                      {!r.unlocked && (
                        <Button size="xs" variant="outline" disabled={busy || exam.published} onClick={() => void allow([r])}>Allow changes</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {exam.published && <p className="text-xs text-muted-foreground">These results are published. Unpublish them first to let a teacher change marks.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
