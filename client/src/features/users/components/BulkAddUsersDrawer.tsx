import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Check, CheckCircle, Copy, DownloadSimple, FileArrowUp, ListChecks, UsersThree, Warning, WarningCircle } from '@phosphor-icons/react';
import StatStrip from '../../../components/shared/StatStrip';
import { confirmAction } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { usersApi } from '../api/usersApi';
import { BOM, BULK_LIMIT, FIFTH_COLUMN, credentialsCsv, parseBulkUsers, type BulkRole } from '../bulkUsers';
import type { BulkCreatedUser, BulkRowProblem } from '../types';

const EXAMPLE = [
  'Amina, Ali, amina.ali@school.com, Accountant',
  'Bashir, Omar, bashir.omar@school.com, Teacher, 0612345678',
  'Hodan, Nur, hodan.nur@gmail.com, Parent, 0619876543',
  'Yusuf, Hassan, yusuf.hassan@school.com, Student, HAA-2026-0001',
].join('\n');

interface Props {
  /** Every role that may be given here: staff, custom roles, teacher, parent and student. */
  roles: BulkRole[];
  onClose: () => void;
  onCreated: () => void;
}

/**
 * "Add many users": paste rows (or upload a CSV), check them in a preview,
 * then create every login at once. Each new login gets its own temporary
 * password, shown once afterwards, and must choose its own at first sign-in.
 */
export default function BulkAddUsersDrawer({ roles, onClose, onCreated }: Props) {
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [defaultRole, setDefaultRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Problems the server found (e.g. an email another login already uses), by row.
  const [serverProblems, setServerProblems] = useState<Map<number, string[]>>(new Map());
  const [created, setCreated] = useState<BulkCreatedUser[] | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => parseBulkUsers(text, roles, defaultRole), [text, roles, defaultRole]);
  const problemsFor = (row: number) => [...(rows[row - 1]?.problems ?? []), ...(serverProblems.get(row) ?? [])];
  const badRows = rows.filter((r) => problemsFor(r.row).length > 0).length;
  const tooMany = rows.length > BULK_LIMIT;
  const canCreate = rows.length > 0 && badRows === 0 && !tooMany && !saving;
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key.replace(/_/g, ' ');

  const edit = (value: string) => { setText(value); setServerProblems(new Map()); setError(''); };

  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError('That is an Excel file. In Excel choose File › Save As › CSV, or copy the rows and paste them here.');
      return;
    }
    edit(await file.text());
    setFileName(file.name);
  }

  async function create() {
    if (!canCreate) return;
    setSaving(true);
    setError('');
    try {
      const result = await usersApi.createMany(rows.map((r) => ({ firstName: r.firstName, lastName: r.lastName, email: r.email, role: r.role ?? r.roleText, extra: r.extra })));
      setCreated(result.users);
      onCreated();
      showToast(`${result.count} user${result.count === 1 ? '' : 's'} created.`);
    } catch (err: any) {
      const data = err?.response?.data;
      if (Array.isArray(data?.problems)) {
        setServerProblems(new Map((data.problems as BulkRowProblem[]).map((p) => [p.row, p.problems])));
      }
      setError(data?.message || "Can't reach the server. Check your internet connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const credentialsText = () => (created ?? []).map((u) => `${u.name}\t${u.email}\t${u.temporaryPassword}`).join('\n');

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(`Name\tEmail\tTemporary password\n${credentialsText()}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy. Use "Download as CSV" instead.', 'error');
    }
  }

  function download() {
    if (!created) return;
    const csv = credentialsCsv(created.map((u) => ({ ...u, role: roleName(u.role) })));
    const url = URL.createObjectURL(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `new-user-logins-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // The passwords cannot be shown again, so check before the list disappears.
  async function close() {
    if (created && !(await confirmAction({
      title: 'Close the list of passwords?',
      text: "These temporary passwords won't be shown again. Download or copy them first if you haven't.",
      confirmLabel: 'Close',
    }))) return;
    if (!created && text.trim() && !(await confirmAction({
      title: 'Discard this list?',
      text: 'The rows you pasted have not been created yet.',
      confirmLabel: 'Discard',
    }))) return;
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader icon={created ? CheckCircle : UsersThree} tint={created ? 'green' : 'blue'}>
          <DialogTitle>{created ? `${created.length} user${created.length === 1 ? '' : 's'} created` : 'Add many users'}</DialogTitle>
          <DialogDescription>
            {created
              ? 'Give each person their email and temporary password. They choose their own password the first time they sign in.'
              : 'For staff, custom roles, teachers, parents and students. Teachers get a teacher profile; parents and students are linked to their registered record.'}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <>
            <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-tile-yellow px-4 py-3 text-sm text-tile-foreground">
              <Warning size={18} className="mt-px shrink-0" weight="fill" />
              <span><strong>These passwords are shown only once.</strong> Download or copy them now — after you close this, they can't be shown again (you would have to reset each password).</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wider hover:bg-muted/50">
                    <TableHead className="px-4 font-semibold">Name</TableHead>
                    <TableHead className="px-4 font-semibold">Email</TableHead>
                    <TableHead className="px-4 font-semibold">Role</TableHead>
                    <TableHead className="px-4 font-semibold">Temporary password</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {created.map((u) => (
                    <TableRow key={u._id}>
                      <TableCell className="px-4 py-2.5 font-medium">{u.name}</TableCell>
                      <TableCell className="px-4 py-2.5 text-xs text-muted-foreground">{u.email}</TableCell>
                      <TableCell className="px-4 py-2.5 text-xs">
                        {roleName(u.role)}
                        {u.detail && <span className="block text-muted-foreground">{u.detail}</span>}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 font-mono text-sm">{u.temporaryPassword}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => void copyAll()}>
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy all'}
              </Button>
              <Button type="button" variant="outline" onClick={download}>
                <DownloadSimple size={16} /> Download as CSV
              </Button>
              <Button type="button" onClick={() => void close()}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="bulk-users" className="text-xs font-semibold">One person per line: First name, Last name, Email, Role, and a fifth column if needed</Label>
                <Button type="button" variant="ghost" size="xs" onClick={() => fileInput.current?.click()}>
                  <FileArrowUp size={14} /> Upload CSV
                </Button>
                <Input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void readFile(e)} />
              </div>
              <Textarea id="bulk-users" rows={7} value={text} onChange={(e) => { edit(e.target.value); setFileName(''); }}
                placeholder={EXAMPLE} className="rounded-xl bg-muted/40 font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">
                {fileName ? `Read from ${fileName}. ` : ''}
                Copy the rows from Excel and paste them here, or separate the columns with commas. A heading row is skipped.
                Role can be its name (e.g. Accountant) or key. Up to {BULK_LIMIT} at a time.
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                <li><strong className="font-semibold">Teacher:</strong> the fifth column is their phone, and can be left out.</li>
                <li><strong className="font-semibold">Parent:</strong> a registered parent with the same email or phone gets this login. Anyone else is added as a new parent, and then the phone in the fifth column is needed.</li>
                <li><strong className="font-semibold">Student:</strong> register the student first. The fifth column is their admission number; without it, the first and last name must match one student.</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-default-role" className="text-xs font-semibold">Role for lines without one</Label>
              <NativeSelect id="bulk-default-role" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)} className="h-10 rounded-xl bg-muted/40 text-sm">
                <option value="">None — every line names its role</option>
                {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </NativeSelect>
            </div>

            {rows.length > 0 && (
              <>
                <StatStrip items={[
                  { label: 'Rows', value: rows.length, icon: ListChecks, tone: 'sky', hint: tooMany ? `At most ${BULK_LIMIT}` : 'People in the list' },
                  { label: 'Ready', value: rows.length - badRows, icon: CheckCircle, tone: 'emerald', hint: 'Will be created' },
                  { label: 'Need fixing', value: badRows, icon: WarningCircle, tone: badRows ? 'rose' : 'muted', hint: badRows ? 'Fix these lines above' : 'No problems' },
                ]} />

                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wider hover:bg-muted/50">
                        <TableHead className="w-10 px-3 font-semibold">#</TableHead>
                        <TableHead className="px-3 font-semibold">Name</TableHead>
                        <TableHead className="px-3 font-semibold">Email</TableHead>
                        <TableHead className="px-3 font-semibold">Role</TableHead>
                        <TableHead className="px-3 font-semibold">Phone / admission no.</TableHead>
                        <TableHead className="px-3 font-semibold">Check</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const problems = problemsFor(r.row);
                        return (
                          <TableRow key={r.row} className={cn(problems.length > 0 && 'bg-destructive/5 hover:bg-destructive/10')}>
                            <TableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{r.row}</TableCell>
                            <TableCell className="px-3 py-2 text-sm font-medium">{[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}</TableCell>
                            <TableCell className="px-3 py-2 text-xs text-muted-foreground">{r.email || '—'}</TableCell>
                            <TableCell className="px-3 py-2 text-xs">{r.role ? roleName(r.role) : r.roleText || '—'}</TableCell>
                            <TableCell className="px-3 py-2 text-xs text-muted-foreground" title={r.role ? FIFTH_COLUMN[r.role] : undefined}>{r.extra || '—'}</TableCell>
                            <TableCell className="px-3 py-2 text-xs">
                              {problems.length ? (
                                <span className="flex items-start gap-1.5 text-destructive"><WarningCircle size={14} className="mt-px shrink-0" />{problems.join(' ')}</span>
                              ) : (
                                <span className="flex items-center gap-1.5 text-success"><CheckCircle size={14} weight="fill" />Ready</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            <p className="rounded-xl bg-tile-yellow px-3.5 py-2.5 text-xs text-tile-foreground">
              Each person gets a temporary password, shown once after creating. They must choose their own the first time they sign in.
              If any line has a problem, nothing is created until it is fixed.
            </p>

            {error && (
              <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => void close()}>Cancel</Button>
              <Button type="button" disabled={!canCreate} onClick={() => void create()}>
                {saving ? 'Creating…' : rows.length ? `Create ${rows.length} user${rows.length === 1 ? '' : 's'}` : 'Create users'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
