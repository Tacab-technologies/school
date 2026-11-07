// The tick-box grid for giving a teacher classes and subjects: one row per class
// (or per section, when the class has sections), one column per subject.
import type { Class, Section, Subject } from '../academic-structure/types';
import type { TeacherAssignment } from './types';

export interface GridRow {
  key: string;
  classId: string;
  sectionId: string | null;
  label: string;
  /** The subjects this class takes: the only boxes on the row. */
  subjectIds: Set<string>;
}

export interface BulkAssignmentItem {
  classId: string;
  sectionId: string | null;
  subjectId: string;
}

const inSchoolOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** An empty class list means every class takes the subject. */
export const taughtIn = (subject: Subject, classId: string) => !subject.classIds?.length || subject.classIds.includes(classId);

export const cellKey = (classId: string, sectionId: string | null, subjectId: string) => `${classId}|${sectionId ?? ''}|${subjectId}`;

export function buildGrid(classes: Class[], sections: Section[], subjects: Subject[]) {
  const columns = subjects
    .filter((s) => s.status !== 'inactive' && classes.some((c) => taughtIn(s, c._id)))
    .sort((a, b) => inSchoolOrder(a.sub_name, b.sub_name));

  const rows: GridRow[] = [];
  for (const cls of [...classes].sort((a, b) => inSchoolOrder(a.cl_name, b.cl_name))) {
    const subjectIds = new Set(columns.filter((s) => taughtIn(s, cls._id)).map((s) => s._id));
    const own = sections
      .filter((s) => (typeof s.class === 'string' ? s.class : s.class?._id) === cls._id)
      .sort((a, b) => inSchoolOrder(a.name, b.name));
    if (own.length === 0) rows.push({ key: cls._id, classId: cls._id, sectionId: null, label: cls.cl_name, subjectIds });
    for (const section of own) {
      rows.push({ key: `${cls._id}|${section._id}`, classId: cls._id, sectionId: section._id, label: `${cls.cl_name} ${section.name}`, subjectIds });
    }
  }
  return { rows, columns };
}

export const cellsOfRow = (row: GridRow) => [...row.subjectIds].map((subjectId) => cellKey(row.classId, row.sectionId, subjectId));

export const cellsOfColumn = (rows: GridRow[], subjectId: string) =>
  rows.filter((row) => row.subjectIds.has(subjectId)).map((row) => cellKey(row.classId, row.sectionId, subjectId));

/** Ticks every box in the group, or unticks them all when every one is ticked already. */
export function toggleGroup(ticked: Set<string>, cells: string[]): Set<string> {
  const next = new Set(ticked);
  const allTicked = cells.length > 0 && cells.every((cell) => next.has(cell));
  for (const cell of cells) {
    if (allTicked) next.delete(cell);
    else next.add(cell);
  }
  return next;
}

/** The teacher's assignments in one term, by the box each one belongs to. */
export function assignmentsByCell(assignments: TeacherAssignment[], termId: string) {
  const byCell = new Map<string, TeacherAssignment>();
  for (const a of assignments) {
    if (a.termId?._id !== termId || !a.classId || !a.subjectId) continue;
    byCell.set(cellKey(a.classId._id, a.sectionId?._id ?? null, a.subjectId._id), a);
  }
  return byCell;
}

export const toItem = (cell: string): BulkAssignmentItem => {
  const [classId, sectionId, subjectId] = cell.split('|');
  return { classId, sectionId: sectionId || null, subjectId };
};
