export interface TermRef { _id: string; name: string; year: string | null }

export interface ExamItem {
  _id: string;
  name: string;
  termId: string | null;
  term: TermRef | null;
  maxMarks: number;
  date: string | null;
  classIds: string[];
  classes: { _id: string; name: string }[];
  published: boolean;
  /** The days teachers may enter marks (null = no limit on that side), and whether that's today. */
  marksOpenFrom: string | null;
  marksOpenUntil: string | null;
  window: EntryWindow;
  progress: { marks: number; students: number };
  /** Students whose results for this exam are hidden from them. */
  held: number;
  /** Mark sheets (class, section, subject) in this exam: how many teachers submitted, and edit requests waiting. */
  sheets: { total: number; submitted: number; requests: number };
}

export type SheetStatus = 'draft' | 'submitted';
export type EntryWindow = 'open' | 'not-yet' | 'closed';

export interface SheetState {
  status: SheetStatus;
  /** The office allowed the teacher to change the sheet, until they submit again. */
  unlocked: boolean;
  submittedAt: string | null;
  editRequest: { status: 'pending' | 'approved' | 'rejected'; reason: string; requestedAt: string | null; note: string } | null;
}

export interface EditRequest {
  _id: string;
  exam: { _id: string; name: string; published: boolean } | null;
  classId: string;
  sectionId: string | null;
  subjectId: string;
  className: string;
  sectionName: string | null;
  subjectName: string;
  teacher: string;
  reason: string;
  requestedAt: string;
}

export interface ExamInput {
  name: string;
  termId: string;
  maxMarks: number;
  date: string | null;
  classIds: string[];
  marksOpenFrom: string | null;
  marksOpenUntil: string | null;
}

export interface MarkingOptions {
  classes: { _id: string; name: string }[];
  sections: { _id: string; name: string; classId: string }[];
  /** classIds: the classes a subject is taught in; empty = every class. */
  subjects: { _id: string; name: string; classIds: string[] }[];
  /** A teacher's own lessons; null for staff who can mark anything. */
  pairs: { classId: string; sectionId: string | null; subjectId: string }[] | null;
  locked: boolean;
}

export interface MarkRow {
  studentId: string;
  name: string;
  admissionNumber?: string;
  /** In a class with sections, a student whose section was never set. */
  noSection?: boolean;
  score: number | null;
  absent: boolean;
  remark: string;
}

/** A student on the "hide results" list of an exam. */
export interface HoldStudent {
  _id: string;
  name: string;
  admissionNumber?: string;
  className: string;
  sectionName: string | null;
  owes: number;
  hold: { reason: string; note: string } | null;
}

export interface Marksheet {
  exam: { _id: string; name: string; maxMarks: number; published: boolean; marksOpenFrom: string | null; marksOpenUntil: string | null; window: EntryWindow };
  sheet: SheetState;
  locked: boolean;
  rows: MarkRow[];
}

export interface Grade { grade: string; label: string; passed: boolean }
export interface GradeBand { min: number; grade: string; label: string }

export interface Tally {
  earned: number;
  possible: number;
  percent: number | null;
  grade: Grade | null;
}

export interface SubjectTally extends Tally {
  scores: Record<string, { score: number | null; absent: boolean; remark?: string }>;
}

export interface ResultExam { _id: string; name: string; maxMarks: number; published: boolean; date: string | null }

export interface ClassResults {
  term: TermRef;
  exams: ResultExam[];
  subjects: { _id: string; name: string; code: string | null; average: number | null; passed: number; marked: number }[];
  students: (Tally & {
    student: { _id: string; name: string; admissionNumber?: string; section: string | null; held?: boolean };
    subjects: Record<string, SubjectTally>;
    position: number | null;
  })[];
  summary: { students: number; marked: number; average: number | null; passed: number };
  gradeScale: GradeBand[];
  passPercent: number;
  /** A teacher: only the subjects they teach are included. */
  ownSubjectsOnly?: boolean;
}

export interface ReportCard {
  student: { _id: string; name: string; admissionNumber?: string; gender?: string };
  className: string | null;
  sectionName: string | null;
  term: TermRef;
  exams: ResultExam[];
  subjects: ({ _id: string; name: string; code: string | null; average: number | null } & SubjectTally)[];
  total: Tally | null;
  position: number | null;
  classSize: number;
  classAverage: number | null;
  gradeScale: GradeBand[];
  passPercent: number;
}

export interface ReportCardResponse {
  terms: TermRef[];
  card: ReportCard | null;
  /** Published exams the office has hidden from this student. */
  onHold?: number;
}

/** One lesson's mark sheet: how many of its students are marked. */
export interface ProgressRow {
  classId: string;
  sectionId: string | null;
  subjectId: string;
  className: string;
  sectionName: string | null;
  subjectName: string;
  teachers: string;
  sheetId: string | null;
  status: SheetStatus;
  submittedAt: string | null;
  editRequested: boolean;
  unlocked: boolean;
  students: number;
  marked: number;
  remaining: number;
}

export interface MarkingProgress {
  locked: boolean;
  published: boolean;
  rows: ProgressRow[];
}
