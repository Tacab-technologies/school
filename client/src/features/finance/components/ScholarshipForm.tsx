import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { DatePicker } from '@/components/ui/date-picker';
import { confirmAction } from '@/components/common/ConfirmDialog';
import { cn } from '@/lib/utils';
import { monthlyFeesApi, apiError } from '../api/monthlyFeesApi';
import { SCHOLARSHIP_TYPES, type Scholarship } from '../monthlyTypes';

const SHARES = [25, 50, 75, 100];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const inAYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return isoDay(d); };

/** Short words for a scholarship, e.g. "Orphan · 100% (free) until 24 Oct 2027". */
export function scholarshipLabel(s: Pick<Scholarship, 'type' | 'percent' | 'to'>) {
  const until = new Date(s.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${s.type} · ${s.percent}%${s.percent === 100 ? ' (free)' : ''} until ${until}`;
}

/**
 * Give a student a scholarship, or change / end the one they have. Saving also
 * updates this month's bill if nothing has been paid on it yet.
 */
export default function ScholarshipForm({ studentId, studentName, current, onSaved, onCancel }: {
  studentId: string;
  studentName?: string;
  current: Scholarship | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [type, setType] = useState(current?.type ?? SCHOLARSHIP_TYPES[0]);
  const [percent, setPercent] = useState(current ? String(current.percent) : '100');
  const [from, setFrom] = useState(current ? isoDay(new Date(current.from)) : isoDay(new Date()));
  const [to, setTo] = useState(current ? isoDay(new Date(current.to)) : inAYear());
  const [reason, setReason] = useState(current?.reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = Number(percent);
  const valid = share > 0 && share <= 100 && !!to && (!from || to >= from);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = { type, percent: share, from, to, reason: reason.trim() || undefined };
      if (current) await monthlyFeesApi.updateScholarship(current._id, data);
      else await monthlyFeesApi.grantScholarship(studentId, data);
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Could not save the scholarship.'));
    } finally {
      setSaving(false);
    }
  };

  const end = async () => {
    if (!current) return;
    const ok = await confirmAction({
      title: `End ${studentName ? `${studentName}'s` : 'this'} scholarship?`,
      text: 'From today they pay the normal fee. The scholarship stays in the history.',
      confirmLabel: 'End scholarship',
      tone: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await monthlyFeesApi.endScholarship(current._id);
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Could not end the scholarship.'));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">Takes this share off every monthly fee between the two dates, including this month’s bill if it isn’t paid yet.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Who is it for?</Label>
          <NativeSelect value={type} onChange={(e) => setType(e.target.value)}>
            {[...new Set([type, ...SCHOLARSHIP_TYPES])].map((t) => <option key={t} value={t}>{t}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Share of the fee</Label>
          <div className="flex items-center gap-1.5">
            {SHARES.map((p) => (
              <Button key={p} type="button" size="xs" variant={share === p ? 'default' : 'outline'} onClick={() => setPercent(String(p))}
                className={cn('flex-1', share === p && 'shadow-none')}>
                {p === 100 ? 'Free' : `${p}%`}
              </Button>
            ))}
            <Input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className="w-20" aria-label="Scholarship percent" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">From</Label>
          <DatePicker value={from} onChange={setFrom} aria-label="Scholarship starts" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Until</Label>
          <DatePicker value={to} onChange={setTo} min={from} aria-label="Scholarship ends" />
        </div>
      </div>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note (optional), e.g. father passed away in 2025" aria-label="Scholarship note" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving || !valid}>{current ? 'Save changes' : 'Give scholarship'}</Button>
        {current && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={end} disabled={saving}>End scholarship</Button>}
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>}
      </div>
    </div>
  );
}
