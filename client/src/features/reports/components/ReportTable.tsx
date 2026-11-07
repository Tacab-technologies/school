import type { ReportCell, ReportColumn, ReportResult } from '../types';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatCell, formatSummaryValue, humanizeLabel, isNumeric, totalsFor } from '../utils/format';

const TILES = ['bg-tile-blue', 'bg-tile-green', 'bg-tile-yellow', 'bg-tile-violet', 'bg-tile-pink'] as const;

/** The report's key figures as small pastel tiles ("Students 120", "Collected $4,500.00"). */
export function SummaryTiles({ summary }: { summary: ReportResult['summary'] }) {
  if (!summary.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      {summary.map((s, i) => (
        <div key={s.label} className={cn('min-w-0 rounded-xl px-3.5 py-2.5 text-tile-foreground', TILES[i % TILES.length])}>
          <p className="truncate text-xs font-medium opacity-80" title={s.label}>{s.label}</p>
          <p className="mt-0.5 truncate text-lg font-semibold tabular-nums" title={String(s.value)}>{formatSummaryValue(s.label, s.value)}</p>
        </div>
      ))}
    </div>
  );
}

const align = (c: ReportColumn) => (isNumeric(c) ? 'text-right' : 'text-left');

/**
 * A readable report table: plain headings, formatted money, dates and numbers,
 * and a totals row when the figures add up.
 */
export function ReportTable({
  columns, rows, maxHeight = 'max-h-[560px]', dimmed = false, showTotals = true,
}: {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  maxHeight?: string;
  dimmed?: boolean;
  /** Off for a preview of the first few rows, where a total would mislead. */
  showTotals?: boolean;
}) {
  const totals = showTotals ? totalsFor(columns, rows) : null;
  // The first text column carries the "Total" word.
  const labelKey = columns.find((c) => !isNumeric(c) && !(totals && c.key in totals))?.key;

  return (
    <div className={cn('overflow-auto', maxHeight, dimmed && 'opacity-60')}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            {columns.map((c) => (
              <TableHead key={c.key} className={cn('h-auto whitespace-nowrap px-4 py-3 text-xs font-semibold text-foreground/80', align(c))}>
                {humanizeLabel(c.label)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} className="even:bg-muted/20">
              {columns.map((c) => (
                <TableCell key={c.key} className={cn('whitespace-nowrap px-4 py-2.5 text-sm', isNumeric(c) ? 'text-right tabular-nums' : 'text-foreground/85')}>
                  {formatCell(row[c.key], c)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {totals && (
          <TableFooter className="bg-muted">
            <TableRow className="hover:bg-muted">
              {columns.map((c) => (
                <TableCell key={c.key} className={cn('whitespace-nowrap px-4 py-2.5 text-sm font-semibold', align(c), isNumeric(c) && 'tabular-nums')}>
                  {c.key in totals ? formatCell(totals[c.key], c) : c.key === labelKey ? 'Total' : ''}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
