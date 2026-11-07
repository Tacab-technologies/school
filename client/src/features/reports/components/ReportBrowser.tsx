import { useEffect, useMemo, useState } from 'react';
import { ArrowCounterClockwise, ChartBar, HandPointing, MagnifyingGlass, Play, SpinnerGap, Tray } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker, MonthPicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState } from '@/components/common/EmptyState';
import FilterSelect from '@/components/shared/FilterSelect';
import { cn } from '@/lib/utils';
import { reportsApi } from '../api/reportsApi';
import type { FilterChoice, ReportDepartment, ReportFilter, ReportResult, ReportSummaryItem } from '../types';
import { errorMessage, messageOf } from '../utils/format';
import ReportActions from './ReportActions';
import { ReportTable, SummaryTiles } from './ReportTable';
import { departmentLook, groupLook } from './reportGroups';

type Values = Record<string, string>;

/** Placeholder for an empty dropdown: what leaving it empty means. */
const ANY_LABEL: Partial<Record<ReportFilter['type'], string>> = {
  class: 'All classes',
  section: 'All sections',
  subject: 'All subjects',
  year: 'All years',
  term: 'Choose a term',
  exam: 'No exam chosen',
  student: 'Choose a student',
  teacher: 'Choose a teacher',
  'fee-type': 'All fee types',
  'payment-method': 'All payment methods',
};

const initialValues = (report: ReportSummaryItem | undefined): Values =>
  Object.fromEntries((report?.filters ?? []).filter((f) => f.default !== undefined).map((f) => [f.key, String(f.default)]));

const questionOf = (r: ReportSummaryItem) => r.question || r.description;

/**
 * Every report this role may run, grouped by department and topic. Pick the
 * question you want answered, narrow it down if you like, then see it here,
 * download it or print it.
 */
export default function ReportBrowser({ departments }: { departments: ReportDepartment[] }) {
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [reportId, setReportId] = useState('');
  const [search, setSearch] = useState('');
  const [values, setValues] = useState<Values>({});
  const [choices, setChoices] = useState<FilterChoice[]>([]);
  const [students, setStudents] = useState<FilterChoice[]>([]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const department = departments.find((d) => d.id === departmentId) ?? departments[0];
  const allReports = useMemo(() => departments.flatMap((d) => d.groups.flatMap((g) => g.reports)), [departments]);
  const report = allReports.find((r) => r.id === reportId);
  const reportGroup = department?.groups.find((g) => g.reports.some((r) => r.id === reportId))?.name ?? '';

  useEffect(() => {
    reportsApi.filterChoices().then(setChoices).catch(() => setChoices([]));
  }, []);

  // A class's students, for the report card's student picker.
  const classId = values.class_id ?? '';
  const wantsStudent = !!report?.filters.some((f) => f.type === 'student');
  useEffect(() => {
    setStudents([]);
    if (!wantsStudent || !classId) return;
    reportsApi.filterChoices(classId)
      .then((rows) => setStudents(rows.filter((r) => r.kind === 'student')))
      .catch(() => setStudents([]));
  }, [wantsStudent, classId]);

  const pick = (id: string) => {
    setReportId(id);
    setValues(initialValues(allReports.find((r) => r.id === id)));
    setResult(null);
    setError('');
  };

  const setValue = (key: string, value: string) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // Choices that depend on another filter no longer apply when it changes.
      if (key === 'class_id') { delete next.section_id; delete next.student_id; }
      if (key === 'term_id') { delete next.exam_id; delete next.exam_b_id; }
      return next;
    });
  };

  const optionsFor = (filter: ReportFilter): { value: string; label: string }[] => {
    if (filter.type === 'select') return filter.options ?? [];
    let list = filter.type === 'student' ? students : choices.filter((c) => c.kind === filter.type);
    if (filter.type === 'section') list = values.class_id ? list.filter((c) => c.parent === values.class_id) : list;
    if (filter.type === 'exam' && values.term_id) list = list.filter((c) => c.parent === values.term_id);
    if (filter.type === 'student' && values.section_id) list = list.filter((c) => !c.parent || c.parent === values.section_id);
    return [{ value: '', label: ANY_LABEL[filter.type] ?? 'Any' }, ...list.map((c) => ({ value: c.value, label: c.label }))];
  };

  const params = useMemo(
    () => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== undefined)),
    [values],
  );

  const show = async () => {
    if (!report) return;
    setLoading(true);
    setError('');
    try {
      setResult(await reportsApi.run(report.id, params));
    } catch (err) {
      setResult(null);
      setError(await errorMessage(err, 'Could not load the report. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const term = search.trim().toLowerCase();
  // Searching looks across every department, so nobody has to know which office a report lives in.
  const searchGroups = term
    ? departments.flatMap((d) => d.groups.map((g) => ({
        ...g,
        key: `${d.id}:${g.name}`,
        reports: g.reports.filter((r) => `${r.title} ${r.question ?? ''} ${r.description}`.toLowerCase().includes(term)),
      })))
    : (department?.groups ?? []).map((g) => ({ ...g, key: `${department?.id}:${g.name}` }));
  const groups = searchGroups.filter((g) => g.reports.length);

  const renderFilter = (filter: ReportFilter) => {
    const value = values[filter.key] ?? '';
    const hint = filter.hint ? <span className="text-[11px] text-muted-foreground">{filter.hint}</span> : null;
    if (filter.type === 'date' || filter.type === 'month' || filter.type === 'number') {
      return (
        <label key={filter.key} className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{filter.label}</span>
          {filter.type === 'date' ? (
            <DatePicker value={value} onChange={(v) => setValue(filter.key, v)} placeholder="Any date" clearable aria-label={filter.label} />
          ) : filter.type === 'month' ? (
            <MonthPicker value={value} onChange={(v) => setValue(filter.key, v)} placeholder="Any month" clearable aria-label={filter.label} />
          ) : (
            <Input type="number" min={0} value={value} onChange={(e) => setValue(filter.key, e.target.value)} className="h-10" aria-label={filter.label} />
          )}
          {hint}
        </label>
      );
    }
    return (
      <div key={filter.key} className="flex flex-col gap-1">
        <FilterSelect
          label={filter.label}
          value={value}
          onChange={(v) => setValue(filter.key, v)}
          options={optionsFor(filter)}
          placeholder={ANY_LABEL[filter.type] ?? 'Any'}
          disabled={filter.type === 'student' && !values.class_id}
        />
        {filter.type === 'student' && !values.class_id
          ? <span className="text-[11px] text-muted-foreground">Choose a class first</span>
          : hint}
      </div>
    );
  };

  if (!departments.length) return null;

  const deptLook = department ? departmentLook(department.id) : null;
  const look = reportGroup ? groupLook(reportGroup) : null;
  const message = result ? messageOf(result.columns) : '';

  return (
    <Card className="overflow-hidden rounded-2xl print:hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <div className="mr-auto min-w-0">
          <h3 className="text-base font-semibold text-foreground">All reports</h3>
          <p className="text-sm text-muted-foreground">Pick the question you want answered. Then press <span className="font-medium text-foreground">Show report</span>.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, e.g. fees, absent, results" className="h-10 pl-9" aria-label="Search reports" />
        </div>
      </div>

      {departments.length > 1 && !term && (
        <div className="overflow-x-auto border-b border-border px-5 py-3">
          <Tabs value={department?.id} onValueChange={(v) => setDepartmentId(v)}>
            <TabsList>
              {departments.map((d) => {
                const { icon: DeptIcon } = departmentLook(d.id);
                return (
                  <TabsTrigger key={d.id} value={d.id} className="gap-1.5">
                    <DeptIcon size={15} /> {d.name}
                    <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{d.report_count}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          {department?.description && <p className="mt-2 text-xs text-muted-foreground">{department.description}</p>}
        </div>
      )}
      {departments.length === 1 && department && !term && deptLook && (
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg text-tile-foreground', deptLook.tile)}><deptLook.icon size={16} weight="bold" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{department.name}</p>
            <p className="truncate text-xs text-muted-foreground">{department.description}</p>
          </div>
        </div>
      )}

      <div className="grid gap-0 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <nav aria-label="Reports" className="max-h-[680px] overflow-y-auto border-b border-border p-3 lg:border-b-0 lg:border-r">
          {groups.length === 0 ? (
            <EmptyState compact icon={MagnifyingGlass} tint="blue" title="No report found" text={`Nothing matches “${search}”. Try a simpler word such as “fees” or “attendance”.`}
              action={<Button variant="ghost" size="sm" onClick={() => setSearch('')}>Clear search</Button>} />
          ) : groups.map((g) => {
            const { icon: GroupIcon, tile } = groupLook(g.name);
            return (
              <div key={g.key} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 px-2 pb-1.5">
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-md text-tile-foreground', tile)}><GroupIcon size={13} weight="bold" /></span>
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground/70">{g.name}</p>
                  <span className="text-[11px] text-muted-foreground">{g.reports.length}</span>
                </div>
                {g.reports.map((r) => {
                  const active = r.id === reportId;
                  return (
                    <Button
                      key={r.id}
                      variant="plain"
                      onClick={() => {
                        const owner = departments.find((d) => d.groups.some((dg) => dg.reports.some((x) => x.id === r.id)));
                        if (owner && owner.id !== department?.id) setDepartmentId(owner.id);
                        pick(r.id);
                      }}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'flex h-auto w-full flex-col items-start gap-0.5 whitespace-normal rounded-lg px-2.5 py-2 text-left transition-colors',
                        active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted',
                      )}
                    >
                      <span className={cn('text-sm font-medium', active ? 'text-primary' : 'text-foreground')}>{r.title}</span>
                      <span className="line-clamp-2 text-xs font-normal text-muted-foreground">{questionOf(r)}</span>
                    </Button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="min-w-0">
          {!report ? (
            <EmptyState icon={ChartBar} tint="blue" title="Choose a report on the left"
              text="Each report answers one question, written under its name. You can download or print any report once it is shown." />
          ) : (
            <>
              <div className="space-y-4 border-b border-border px-5 py-4">
                <div className="flex items-start gap-3">
                  {look && (
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-tile-foreground', look.tile)}>
                      <look.icon size={20} weight="bold" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <h4 className="text-base font-semibold text-foreground">{report.title}</h4>
                    <p className="text-sm text-foreground/80">{questionOf(report)}</p>
                    {report.question && report.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{report.description}</p>
                    )}
                  </div>
                </div>

                {report.filters.length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/30 p-3.5">
                    <p className="mb-2.5 text-xs font-semibold text-foreground/80">Narrow it down <span className="font-normal text-muted-foreground">(leave a box empty to include everything)</span></p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{report.filters.map(renderFilter)}</div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void show()} disabled={loading}>
                    {loading ? <SpinnerGap size={15} className="animate-spin" /> : <Play size={15} weight="fill" />} Show report
                  </Button>
                  {Object.keys(values).length > 0 && (
                    <Button variant="ghost" onClick={() => { setValues(initialValues(report)); setResult(null); setError(''); }}>
                      <ArrowCounterClockwise size={15} /> Start over
                    </Button>
                  )}
                  <div className="ml-auto">
                    <ReportActions reportId={report.id} title={report.title} filters={params} result={result} />
                  </div>
                </div>
              </div>

              {error ? (
                /^choose /i.test(error)
                  // "Choose a class." — the report needs one more choice, not an error.
                  ? <EmptyState compact icon={HandPointing} tint="yellow" title="One more choice is needed" text={error} />
                  : <ErrorState compact text={error} onRetry={() => void show()} />
              ) : loading && !result ? (
                <div className="flex items-center justify-center py-12"><SpinnerGap className="h-6 w-6 animate-spin text-primary" /></div>
              ) : !result ? (
                <EmptyState compact icon={Play} tint="green" title="Press Show report to see the results" text="Leave the boxes empty to include everything." />
              ) : (
                <>
                  {result.summary.length > 0 && (
                    <div className="px-5 pt-4"><SummaryTiles summary={result.summary} /></div>
                  )}
                  {!result.rows.length ? (
                    <EmptyState compact icon={Tray} tint="blue" title="Nothing to show"
                      text={message || 'No records match what you chose. Try a wider date range or leave more boxes empty.'} />
                  ) : (
                    <div className="mt-4 border-t border-border">
                      <ReportTable columns={result.columns} rows={result.rows} dimmed={loading} />
                    </div>
                  )}
                  {result.rows.length > 0 && (
                    <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
                      {result.rows.length.toLocaleString()} {result.rows.length === 1 ? 'line' : 'lines'}
                      {result.generatedAt ? ` · prepared ${new Date(result.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
