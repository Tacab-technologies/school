import { useRef, useState } from 'react';
import {
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  SpinnerGap,
  UploadSimple,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSection } from '@/components/ui/drawer-kit';
import { cn } from '@/lib/utils';
import { studentImportApi, type ImportCheckResult, type ImportRow, type ImportRunResult } from '../api/studentImportApi';

const message = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

type Busy = null | 'template' | 'reading' | 'importing';

/**
 * Import students from a spreadsheet: download the template, fill it in Excel,
 * upload it, look at the check, then import. Nothing is saved before the
 * "Import" click; rows with problems are skipped.
 */
export default function ImportStudentsDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [check, setCheck] = useState<ImportCheckResult | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [result, setResult] = useState<ImportRunResult | null>(null);

  const downloadTemplate = async () => {
    setBusy('template');
    setError('');
    try {
      await studentImportApi.downloadTemplate();
    } catch (err) {
      setError(message(err, 'The template could not be downloaded.'));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    setCheck(null);
    setRows([]);
    setError('');
    setBusy('reading');
    try {
      const read = await studentImportApi.readFile(file);
      const checked = await studentImportApi.check(read.rows);
      setRows(read.rows);
      setCheck(checked);
      setOnlyProblems(checked.withProblems > 0 && checked.ready === 0);
    } catch (err) {
      setError(message(err, 'The file could not be read.'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runImport = async () => {
    setBusy('importing');
    setError('');
    try {
      const done = await studentImportApi.run(rows);
      setResult(done);
      if (done.created > 0) onImported();
    } catch (err) {
      setError(message(err, 'The import did not finish. Check the student list before trying again.'));
    } finally {
      setBusy(null);
    }
  };

  const shownRows = check ? (onlyProblems ? check.rows.filter((row) => !row.ok) : check.rows) : [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && busy !== 'importing') onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader icon={result ? CheckCircle : FileArrowUp} tint={result ? 'green' : 'violet'}>
          <DialogTitle>{result ? 'Import finished' : 'Import students'}</DialogTitle>
          <DialogDescription>
            {result
              ? 'Here is what was saved.'
              : 'Add many students at once from an Excel file. Nothing is saved until you press Import.'}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-2xl bg-tile-green p-4 text-tile-foreground">
              <CheckCircle size={28} weight="duotone" />
              <div>
                <p className="font-semibold">{plural(result.created, 'student')} imported</p>
                <p className="text-sm">Each one got an admission number and was put in their family.</p>
              </div>
            </div>
            {result.failed.length > 0 && (
              <FormSection title={`${plural(result.failed.length, 'row')} not imported`} icon={WarningCircle}
                description="Fix these rows in Excel and import only them again.">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.failed.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell className="tabular-nums">{row.row}</TableCell>
                        <TableCell className="font-medium">{row.name || '—'}</TableCell>
                        <TableCell className="text-sm text-destructive">{row.error}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </FormSection>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <FormSection title="1. Get the template" icon={DownloadSimple}
              description="An Excel file with the right columns and a list of your classes. Write one student per row.">
              <Button type="button" variant="outline" onClick={downloadTemplate} disabled={busy !== null}>
                {busy === 'template' ? <SpinnerGap size={16} className="animate-spin" /> : <DownloadSimple size={16} />}
                Download template
              </Button>
            </FormSection>

            <FormSection title="2. Upload the filled-in file" icon={UploadSimple}
              description="Brothers and sisters with the same parent phone are put in one family.">
              <div
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); if (busy === null) void chooseFile(event.dataTransfer.files?.[0]); }}
                className={cn('flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-5 text-center transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'border-border bg-card')}
              >
                <Input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" className="hidden" onChange={(event) => void chooseFile(event.target.files?.[0])} />
                <p className="text-sm text-muted-foreground">
                  {fileName ? <>Chosen: <span className="font-medium text-foreground">{fileName}</span></> : 'Drop the file here, or'}
                </p>
                <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                  {busy === 'reading' ? <SpinnerGap size={16} className="animate-spin" /> : <UploadSimple size={16} />}
                  {busy === 'reading' ? 'Checking the file…' : fileName ? 'Choose another file' : 'Choose file'}
                </Button>
                <p className="text-xs text-muted-foreground">Excel (.xlsx) or .csv, up to 1000 students.</p>
              </div>
            </FormSection>

            {check && (
              <FormSection title="3. Check and import" icon={UsersThree}
                action={check.withProblems > 0 && check.ready > 0 ? (
                  <div className="flex gap-1">
                    <Button type="button" size="xs" variant={onlyProblems ? 'ghost' : 'secondary'} onClick={() => setOnlyProblems(false)}>All</Button>
                    <Button type="button" size="xs" variant={onlyProblems ? 'secondary' : 'ghost'} onClick={() => setOnlyProblems(true)}>Problems</Button>
                  </div>
                ) : undefined}>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="success">{check.ready} ready</Badge>
                  {check.withProblems > 0 && <Badge variant="destructive">{plural(check.withProblems, 'row')} with problems</Badge>}
                  {check.newParents > 0 && <Badge variant="outline">{plural(check.newParents, 'new family')}</Badge>}
                  {check.existingParents > 0 && <Badge variant="info">{check.existingParents} already-registered {check.existingParents === 1 ? 'parent' : 'parents'}</Badge>}
                </div>
                {check.withProblems > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Rows with problems are skipped. Fix them in Excel and upload the file again, or import the ready ones now.
                  </p>
                )}
                <div className="max-h-[45vh] overflow-auto rounded-xl border border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Row</TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shownRows.map((row) => (
                        <TableRow key={row.row}>
                          <TableCell className="align-top tabular-nums text-muted-foreground">{row.row}</TableCell>
                          <TableCell className="align-top font-medium">{row.name || '—'}</TableCell>
                          <TableCell className="align-top whitespace-nowrap">{[row.className, row.sectionName].filter(Boolean).join(' ') || '—'}</TableCell>
                          <TableCell className="align-top">
                            {row.ok ? (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 text-sm font-medium text-success"><CheckCircle size={14} /> Ready</span>
                                {row.willLinkToExistingParent && <p className="text-xs text-muted-foreground">Joins {row.parentName}'s family</p>}
                                {row.sameParentAsRow && <p className="text-xs text-muted-foreground">Same family as row {row.sameParentAsRow}</p>}
                              </div>
                            ) : (
                              <ul className="space-y-0.5 text-sm text-destructive">
                                {row.errors.map((problem) => (
                                  <li key={problem} className="flex gap-1"><WarningCircle size={14} className="mt-0.5 shrink-0" />{problem}</li>
                                ))}
                              </ul>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </FormSection>
            )}
          </div>
        )}

        {error && (
          <p className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <WarningCircle size={16} /> {error}
          </p>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy === 'importing'}>Cancel</Button>
              <Button type="button" onClick={runImport} disabled={!check || check.ready === 0 || busy !== null}>
                {busy === 'importing' ? <SpinnerGap size={16} className="animate-spin" /> : <UploadSimple size={16} />}
                {busy === 'importing' ? 'Importing…' : `Import ${check ? plural(check.ready, 'student') : 'students'}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
