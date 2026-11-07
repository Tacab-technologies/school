import { useState } from 'react';
import { CaretDown, DownloadSimple, FileCsv, FilePdf, FileXls, Printer, SpinnerGap } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { reportsApi } from '../api/reportsApi';
import type { ReportResult } from '../types';
import { downloadCSV } from '../utils/csv';
import { errorMessage, fileNameFor, formatCell, humanizeLabel, saveBlob } from '../utils/format';

/**
 * "Download" (Excel, PDF or CSV) and "Print" for one report. Print opens the
 * same PDF the server produces in a new tab, so the printout always matches
 * the download, whatever page the person is on.
 */
export default function ReportActions({
  reportId, title, filters, result,
}: {
  reportId: string;
  title: string;
  filters: Record<string, string | number>;
  result: ReportResult | null;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf' | 'print'>('');
  const disabled = !!busy || !result?.rows.length;
  const name = fileNameFor(title);

  const download = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      saveBlob(await reportsApi.export(reportId, format, filters), `${name}.${format}`);
    } catch (err) {
      showToast(await errorMessage(err, 'Could not download the report.'), 'error');
    } finally {
      setBusy('');
    }
  };

  const downloadCsv = () => {
    if (!result) return;
    downloadCSV(name, result.rows.map((row) =>
      Object.fromEntries(result.columns.map((c) => [humanizeLabel(c.label), formatCell(row[c.key], c)]))));
  };

  const print = async () => {
    // Open the tab now, while the click still counts, or the browser blocks it.
    const tab = window.open('', '_blank');
    setBusy('print');
    try {
      const blob = await reportsApi.export(reportId, 'pdf', filters);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (tab) tab.location.href = url;
      else saveBlob(blob, `${name}.pdf`);
      // Long enough for the new tab to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      showToast(await errorMessage(err, 'Could not prepare the report for printing.'), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={disabled} aria-label="Download this report">
            {busy === 'xlsx' || busy === 'pdf' ? <SpinnerGap size={15} className="animate-spin" /> : <DownloadSimple size={15} />}
            Download <CaretDown size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem className="gap-2.5" onSelect={() => void download('xlsx')}>
            <FileXls size={18} className="text-success" />
            <span className="flex flex-col"><span>Excel</span><span className="text-xs text-muted-foreground">To sort or edit the figures</span></span>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onSelect={() => void download('pdf')}>
            <FilePdf size={18} className="text-destructive" />
            <span className="flex flex-col"><span>PDF</span><span className="text-xs text-muted-foreground">To share or keep on file</span></span>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onSelect={downloadCsv}>
            <FileCsv size={18} className="text-info" />
            <span className="flex flex-col"><span>CSV</span><span className="text-xs text-muted-foreground">For other programs</span></span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" disabled={disabled} onClick={() => void print()}>
        {busy === 'print' ? <SpinnerGap size={15} className="animate-spin" /> : <Printer size={15} />} Print
      </Button>
    </div>
  );
}
