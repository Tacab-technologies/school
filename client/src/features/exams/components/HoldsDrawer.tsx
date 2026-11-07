import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeSlash, MagnifyingGlass } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState, ListLoading } from '@/components/common/EmptyState';
import FilterSelect from '@/components/shared/FilterSelect';
import { useToast } from '@/hooks/use-toast';
import { examsApi, apiMessage } from '../api/examsApi';
import type { ExamItem, HoldStudent } from '../types';

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/**
 * Hide some students' results for an exam from them and their parents (unpaid
 * fees, discipline), before or after publishing, and show them again later.
 */
export default function HoldsDrawer({ exam, onClose, onChanged }: { exam: ExamItem; onClose: () => void; onChanged: () => void }) {
  const { showToast } = useToast();
  const [students, setStudents] = useState<HoldStudent[] | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [klass, setKlass] = useState('');
  const [view, setView] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState('Fees not paid');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    examsApi.holds(exam._id).then((res) => { setStudents(res.students); setReasons(res.reasons); })
      .catch((err) => { setStudents([]); showToast(apiMessage(err, 'Could not load the students.'), 'error'); });
  }, [exam._id, showToast]);
  useEffect(() => { load(); }, [load]);

  const classLabel = (s: HoldStudent) => [s.className, s.sectionName].filter(Boolean).join(' ');
  const classes = useMemo(() => [...new Set((students ?? []).map(classLabel))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [students]);
  const shown = (students ?? []).filter((s) => (!klass || classLabel(s) === klass)
    && (view !== 'hidden' || s.hold) && (view !== 'owing' || s.owes > 0)
    && (!search || `${s.name} ${s.admissionNumber ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const hiddenCount = (students ?? []).filter((s) => s.hold).length;
  const toggle = (id: string, on: boolean) => setPicked((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
  const allShownPicked = shown.length > 0 && shown.every((s) => picked.includes(s._id));

  const apply = async (hidden: boolean) => {
    setBusy(true);
    try {
      await examsApi.setHolds(exam._id, { studentIds: picked, hidden, reason, note: note.trim() });
      showToast(hidden ? `Results hidden for ${picked.length} student${picked.length === 1 ? '' : 's'}.` : `Results shown again for ${picked.length} student${picked.length === 1 ? '' : 's'}.`);
      setPicked([]);
      setNote('');
      load();
      onChanged();
    } catch (err) {
      showToast(apiMessage(err, 'Could not change this.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader icon={EyeSlash} tint="pink">
          <DialogTitle>{exam.name}: hide results</DialogTitle>
          <DialogDescription>Hidden students and their parents can't see this exam's results until you show them again. Other students aren't affected, and staff still see the marks.</DialogDescription>
        </DialogHeader>
        {students === null ? <ListLoading rows={6} /> : students.length === 0 ? (
          <EmptyState icon={EyeSlash} tint="pink" title="No students" text="No active students sit this exam." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <FilterSelect label="Class" value={klass} onChange={setKlass} options={[{ value: '', label: 'All classes' }, ...classes.map((c) => ({ value: c, label: c }))]} />
              <FilterSelect label="Show" value={view} onChange={setView}
                options={[{ value: '', label: 'Everyone' }, { value: 'owing', label: 'Students who owe fees' }, { value: 'hidden', label: `Hidden now (${hiddenCount})` }]} />
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Search</span>
                <div className="relative">
                  <MagnifyingGlass size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or admission no." className="pl-9" aria-label="Search students" />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allShownPicked}
                onCheckedChange={(v) => setPicked((ids) => (v === true ? [...new Set([...ids, ...shown.map((s) => s._id)])] : ids.filter((id) => !shown.some((s) => s._id === id))))} />
              Tick all {shown.length} shown
            </label>

            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {shown.map((s) => (
                <li key={s._id}>
                  <label className="flex items-center gap-3 px-4 py-2.5">
                    <Checkbox checked={picked.includes(s._id)} onCheckedChange={(v) => toggle(s._id, v === true)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{s.name}</span>
                      <span className="block text-xs text-muted-foreground">{classLabel(s)}{s.owes > 0 ? ` · owes ${money(s.owes)}` : ''}</span>
                    </span>
                    {s.hold && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tile-pink px-2 py-0.5 text-[11px] font-medium text-tile-foreground" title={s.hold.note || undefined}>
                        <EyeSlash size={12} /> Hidden · {s.hold.reason}
                      </span>
                    )}
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody matches.</li>}
            </ul>

            <div className="grid gap-3 sm:grid-cols-2">
              <FilterSelect label="Reason" value={reason} onChange={setReason} options={reasons.map((r) => ({ value: r, label: r }))} />
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Note for staff (optional)</span>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Until October is paid" aria-label="Note" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" disabled={busy || !picked.length} onClick={() => void apply(false)}><Eye size={15} /> Show results ({picked.length})</Button>
          <Button disabled={busy || !picked.length} onClick={() => void apply(true)}><EyeSlash size={15} /> Hide results ({picked.length})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
