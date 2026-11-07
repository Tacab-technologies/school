import api from '../../../lib/axios';

// Spreadsheet import (server/src/routes/studentRoutes.js, /students/import*).

/** One spreadsheet row, keyed by its column titles, plus its row number in the sheet. */
export type ImportRow = Record<string, unknown> & { rowNumber?: number };

export interface ImportCheckRow {
  row: number;
  ok: boolean;
  errors: string[];
  name: string;
  className: string;
  sectionName: string;
  parentName: string;
  /** The parent phone belongs to a parent already in the system: the child joins that family. */
  willLinkToExistingParent: boolean;
  /** Same new parent as an earlier row in this file (brothers and sisters). */
  sameParentAsRow: number | null;
}

export interface ImportCheckResult {
  dryRun: true;
  total: number;
  ready: number;
  withProblems: number;
  newParents: number;
  existingParents: number;
  rows: ImportCheckRow[];
}

export interface ImportRunResult {
  dryRun: false;
  total: number;
  created: number;
  students: { row: number; id: string; name: string; admissionNumber: string }[];
  failed: { row: number; name: string; error: string }[];
}

export const studentImportApi = {
  /** Saves the .xlsx template (it lists the school's classes) to the computer. */
  downloadTemplate: async () => {
    const res = await api.get('/students/import/template', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'students-import-template.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  /** The chosen .xlsx/.csv file → its rows (read on the server). */
  readFile: async (file: File): Promise<{ rows: ImportRow[]; total: number }> => {
    const formData = new FormData();
    formData.append('file', file);
    return (await api.post('/students/import/read', formData)).data.data;
  },
  check: async (rows: ImportRow[]): Promise<ImportCheckResult> =>
    (await api.post('/students/import', { rows, dryRun: true })).data.data,
  run: async (rows: ImportRow[]): Promise<ImportRunResult> =>
    (await api.post('/students/import', { rows, dryRun: false }, { timeout: 10 * 60_000 })).data.data,
};
