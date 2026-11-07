import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, MagnifyingGlass, PencilSimple, Plus, Student } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TableEmptyRow, TableLoadingRows, ErrorState } from '@/components/common/EmptyState';
import StatStrip from '@/components/shared/StatStrip';
import { useCan } from '@/hooks/usePermission';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { monthlyFeesApi, apiError } from '../api/monthlyFeesApi';
import type { Scholarship } from '../monthlyTypes';
import ScholarshipForm from './ScholarshipForm';

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const STATE: Record<Scholarship['state'], { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-tile-green text-tile-foreground' },
  upcoming: { label: 'Starts later', className: 'bg-tile-blue text-tile-foreground' },
  expired: { label: 'Finished', className: 'bg-muted text-muted-foreground' },
  ended: { label: 'Ended', className: 'bg-muted text-muted-foreground' },
};

/** Every student with a scholarship: who, how much, until when. */
export default function ScholarshipsTab() {
  const canEdit = useCan('fees-setup', 'edit');
  const [view, setView] = useState<'current' | 'all'>('current');
  const [rows, setRows] = useState<Scholarship[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Scholarship | null>(null);
  const [giving, setGiving] = useState(false);

  const load = useCallback(() => {
    setError(null);
    monthlyFeesApi.listScholarships(view === 'current' ? 'current' : undefined)
      .then(setRows)
      .catch((err) => setError(apiError(err, 'Could not load scholarships.')));
  }, [view]);

  useEffect(() => { setRows(null); load(); }, [load]);

  const current = (rows ?? []).filter((r) => r.state === 'active');
  const saved = () => { setEditing(null); setGiving(false); load(); };

  return (
    <div className="space-y-5">
      <StatStrip items={[
        { label: 'On a scholarship now', value: current.length, icon: GraduationCap, tone: 'emerald', hint: 'Students paying less this month' },
        { label: 'Free (100%)', value: current.filter((r) => r.percent === 100).length, icon: Student, tone: 'sky', hint: 'Pay nothing' },
        { label: 'Part scholarships', value: current.filter((r) => r.percent < 100).length, icon: GraduationCap, tone: 'violet', hint: 'Pay part of the fee' },
      ]} />

      <Card className="rounded-2xl border-border/70 shadow-none">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Scholarships</CardTitle>
            <CardDescription className="text-xs">Orphans, staff children, families in need: a share of the monthly fee is waived until the end date.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as 'current' | 'all')}>
              <TabsList className="h-9">
                <TabsTrigger value="current" className="px-3 py-1 text-xs">Current</TabsTrigger>
                <TabsTrigger value="all" className="px-3 py-1 text-xs">All, with history</TabsTrigger>
              </TabsList>
            </Tabs>
            {canEdit && <Button size="sm" onClick={() => setGiving(true)}><Plus size={15} /> Give a scholarship</Button>}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error ? <ErrorState text={error} onRetry={load} /> : (
            <div className="overflow-x-auto border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wider hover:bg-muted/50">
                    <TableHead className="pl-5 font-semibold">Student</TableHead>
                    <TableHead className="font-semibold">For</TableHead>
                    <TableHead className="font-semibold">Share</TableHead>
                    <TableHead className="font-semibold">Dates</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="pr-5 text-right font-semibold"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows === null ? <TableLoadingRows columns={6} /> : rows.length === 0 ? (
                    <TableEmptyRow colSpan={6} icon={GraduationCap} tint="green" title="No scholarships yet"
                      text="Give one from here, or from a student's card when taking a payment."
                      action={canEdit && <Button variant="outline" size="sm" onClick={() => setGiving(true)}><Plus size={15} /> Give a scholarship</Button>} />
                  ) : rows.map((r) => (
                    <TableRow key={r._id}>
                      <TableCell className="py-3 pl-5">
                        <p className="font-medium">{r.student?.name}</p>
                        <p className="text-xs text-muted-foreground">{r.student?.admissionNumber}{r.student?.className ? ` · ${r.student.className}` : ''}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{r.type}</p>
                        {r.reason && <p className="max-w-[220px] truncate text-xs text-muted-foreground">{r.reason}</p>}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">{r.percent === 100 ? 'Free' : `${r.percent}%`}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmt(r.from)} – {fmt(r.to)}</TableCell>
                      <TableCell><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATE[r.state].className)}>{STATE[r.state].label}</span></TableCell>
                      <TableCell className="pr-5 text-right">
                        {canEdit && r.student && (r.state === 'active' || r.state === 'upcoming') && (
                          <Button variant="ghost" size="xs" onClick={() => setEditing(r)}><PencilSimple size={14} /> Change</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing?.student && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditing(null); }}>
          <DialogContent>
            <DialogHeader icon={GraduationCap} tint="green">
              <DialogTitle>{editing.student.name}’s scholarship</DialogTitle>
              <DialogDescription>Change the share or the dates, or end it.</DialogDescription>
            </DialogHeader>
            <ScholarshipForm studentId={editing.student._id} studentName={editing.student.name} current={editing} onSaved={saved} onCancel={() => setEditing(null)} />
          </DialogContent>
        </Dialog>
      )}

      {giving && <GiveScholarship onClose={() => setGiving(false)} onSaved={saved} />}
    </div>
  );
}

/** Find the student, then fill in the scholarship. */
function GiveScholarship({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 300);
  const [found, setFound] = useState<Awaited<ReturnType<typeof monthlyFeesApi.searchStudents>>>([]);
  const [picked, setPicked] = useState<{ _id: string; name: string } | null>(null);

  useEffect(() => {
    if (debounced.trim().length < 2) { setFound([]); return; }
    let cancelled = false;
    monthlyFeesApi.searchStudents(debounced).then((r) => { if (!cancelled) setFound(r); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [debounced]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader icon={GraduationCap} tint="green">
          <DialogTitle>Give a scholarship</DialogTitle>
          <DialogDescription>{picked ? `For ${picked.name}` : 'Find the student by name, admission number or parent.'}</DialogDescription>
        </DialogHeader>
        {!picked ? (
          <div className="space-y-3">
            <div className="relative">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or admission number" className="pl-9" aria-label="Find student" />
            </div>
            <div className="space-y-1">
              {found.map((s) => (
                <Button key={s._id} variant="plain" type="button" onClick={() => setPicked(s)}
                  className="flex h-auto w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-left hover:bg-muted/60">
                  <span>
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{s.admissionNumber}{s.className ? ` · ${s.className}` : ''}{s.parentName ? ` · ${s.parentName}` : ''}</span>
                  </span>
                </Button>
              ))}
              {debounced.trim().length >= 2 && found.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No student matches “{debounced}”.</p>}
            </div>
          </div>
        ) : (
          <ScholarshipForm studentId={picked._id} studentName={picked.name} current={null} onSaved={onSaved} onCancel={() => setPicked(null)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
