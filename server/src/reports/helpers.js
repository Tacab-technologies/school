import Student from '../models/Student.js';
import StudentClass from '../models/StudentClass.js';
import Teacher from '../models/Teacher.js';
import TeacherAssignment from '../models/TeacherAssignment.js';

/** Shared shapes and lookups used across the report definitions. */

export class ReportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const fullName = (person) =>
  person ? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() : '';

export const round1 = (value) => Math.round(value * 10) / 10;

export const percent = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : 0);

/**
 * Reusable filter descriptors — the client renders a control per entry.
 * `hint` is a short plain-language line shown under the control (what leaving
 * it empty means, for example).
 */
export const FILTERS = {
  class: { key: 'class_id', label: 'Class', type: 'class' },
  section: { key: 'section_id', label: 'Section', type: 'section' },
  subject: { key: 'subject_id', label: 'Subject', type: 'subject' },
  exam: { key: 'exam_id', label: 'Exam', type: 'exam' },
  dateFrom: { key: 'from', label: 'From date', type: 'date' },
  dateTo: { key: 'to', label: 'To date', type: 'date' },
  threshold: { key: 'threshold', label: 'Below this %', type: 'number', default: 50 },
  year: { key: 'year_id', label: 'Academic Year', type: 'year' },
  feeType: { key: 'fee_type_id', label: 'Fee Type', type: 'fee-type' },
  paymentMethod: { key: 'payment_method_id', label: 'Payment Method', type: 'payment-method' },
  term: { key: 'term_id', label: 'Term', type: 'term' },
  /** Exam that may be left empty — the report then covers every exam in the term. */
  examOptional: { key: 'exam_id', label: 'Exam', type: 'exam', hint: 'Leave empty to add up every exam in the term' },
  examB: { key: 'exam_b_id', label: 'Compare with exam', type: 'exam' },
  date: { key: 'date', label: 'Date', type: 'date' },
  month: { key: 'month', label: 'Month', type: 'month' },
  student: { key: 'student_id', label: 'Student', type: 'student' },
  teacher: { key: 'teacher_id', label: 'Teacher', type: 'teacher' },
  gender: {
    key: 'gender',
    label: 'Gender',
    type: 'select',
    options: [
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' }
    ]
  },
  limit: { key: 'limit', label: 'How many students', type: 'number', default: 10 },
  passMark: { key: 'pass_mark', label: 'Pass mark %', type: 'number', default: 50 },
  minFails: { key: 'min_fails', label: 'Failed at least this many subjects', type: 'number', default: 2 }
};

/** Today's date as YYYY-MM-DD (UTC), the default for single-day reports. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** This month as YYYY-MM (UTC), the default for monthly reports. */
export const thisMonth = () => new Date().toISOString().slice(0, 7);

/** The whole UTC day of a YYYY-MM-DD string, as a Mongo range. */
export const dayRange = (iso) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? '')) ? String(iso) : todayIso();
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  return { day, range: { $gte: start, $lte: end } };
};

/** The whole UTC month of a YYYY-MM string, as a Mongo range. */
export const monthRange = (value) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? '')) ? String(value) : thisMonth();
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { month, range: { $gte: start, $lte: end } };
};

/** A positive whole number from a filter, or the fallback. */
export const intFilter = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** A number from a filter, or the fallback. */
export const numberFilter = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

/** Money is stored as plain numbers; render it consistently across reports. */
export const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const dateRange = (filters = {}) => {
  const range = {};
  if (filters.from) range.$gte = new Date(filters.from);
  if (filters.to) {
    const to = new Date(filters.to);
    to.setUTCHours(23, 59, 59, 999);
    range.$lte = to;
  }
  return Object.keys(range).length ? range : null;
};

/** Active students, optionally narrowed to a class/section — today's roster. */
export const activeStudentFilter = (filters = {}) => {
  const query = { isDeleted: { $ne: true } };
  if (filters.class_id) query.classId = filters.class_id;
  if (filters.section_id) query.sectionId = filters.section_id;
  return query;
};

/**
 * A student's `classId` on the Student document is their *current* class —
 * it changes whenever they move class. A report scoped to a past academic
 * year ("Class 5, 2025") must not use it, or a student moved to Class 6
 * in 2026 silently vanishes from — or worse, never appears in — the 2025
 * report it actually belongs in.
 *
 * `StudentClass` is the school's real enrolment ledger: one row per
 * student per year, written when the student is created (studentService.js)
 * and again when they change class. This resolves the
 * roster for a specific year from that ledger instead, shaped exactly like
 * a populated Student query (`classId: { _id, cl_name }`) so callers don't
 * need to special-case it.
 *
 * Returns null when no year_id filter is given — the signal to callers that
 * no historical scoping applies and they should query Student directly, for
 * "who is enrolled right now" reports.
 *
 * Section: since 2026-08-19 StudentClass stores `section` too, so a
 * year-scoped roster returns the student's section *in that year*, not the
 * live one. Rows written before that field existed have section=null and
 * fall back to the student's current section — the backfill script
 * `scripts/backfillStudentClassSections.js` fills those in from the current
 * Student.sectionId for legacy data.
 */
export const resolveHistoricalRoster = async (filters = {}) => {
  if (!filters.year_id) return null;

  const query = { year: filters.year_id };
  if (filters.class_id) query.class = filters.class_id;
  // filters.section_id narrows to a specific section within the historical
  // enrolment — same semantics as the live query above.
  if (filters.section_id) query.section = filters.section_id;

  const enrolments = await StudentClass.find(query)
    .populate({
      path: 'student',
      select: 'firstName lastName admissionNumber sectionId gender status admissionType createdAt birthDate isDeleted',
      populate: { path: 'sectionId', select: 'name' }
    })
    .populate('class', 'cl_name')
    .populate('section', 'name');

  return enrolments
    .filter((row) => row.student && !row.student.isDeleted)
    .map((row) => {
      const student = row.student.toObject();
      return {
        ...student,
        classId: row.class,
        // Prefer the section captured on the enrolment row (year-correct).
        // Fall back to the student's current section only when the historical
        // row was written before the field existed, or the student had no
        // section that year.
        sectionId: row.section ?? student.sectionId ?? null
      };
    })
    .sort((a, b) => (a.admissionNumber || '').localeCompare(b.admissionNumber || ''));
};

/**
 * Student ids matching a class/year filter — the id-only counterpart to
 * resolveHistoricalRoster, for callers (finance reports) that only need to
 * narrow a query to "these students," not display full student records.
 * Returns null under the same condition: no year_id, no historical scoping.
 */
export const resolveYearScopedStudentIds = async (filters = {}) => {
  if (!filters.year_id) return null;
  const query = { year: filters.year_id };
  if (filters.class_id) query.class = filters.class_id;
  const ids = await StudentClass.distinct('student', query);
  return ids.map((id) => String(id));
};

/**
 * Map of studentId (string) -> the Class they were enrolled in during a
 * specific year. For reports that GROUP records by class (not just filter
 * by it) — grouping by a student's *current* classId when reporting on a
 * past year doesn't just mislabel a column, it silently merges figures into
 * the wrong bucket. Returns null when no year_id filter is given, meaning
 * "group by each record's live class field as before."
 */
export const resolveHistoricalClassMap = async (filters = {}) => {
  if (!filters.year_id) return null;
  const enrolments = await StudentClass.find({ year: filters.year_id })
    .select('student class')
    .populate('class', 'cl_name');
  const map = new Map();
  for (const row of enrolments) {
    if (row.student && row.class) map.set(String(row.student), row.class);
  }
  return map;
};

export const findStudents = async (filters = {}, extra = {}) => {
  const historical = await resolveHistoricalRoster(filters);
  if (historical) {
    const extraEntries = Object.entries(extra);
    return historical.filter((student) => extraEntries.every(([key, value]) => student[key] === value));
  }

  return Student.find({ ...activeStudentFilter(filters), ...extra })
    .select('firstName lastName admissionNumber classId sectionId gender status admissionType createdAt birthDate')
    .populate('classId', 'cl_name')
    .populate('sectionId', 'name')
    .sort({ admissionNumber: 1 });
};

/**
 * The classes and subjects the authenticated teacher is responsible for.
 *
 * Every report in the teaching department runs inside this scope, so a teacher
 * can only ever see their own classes — there is no filter they can widen to
 * reach the rest of the school.
 */
export const resolveTeacherScope = async (user, filters = {}) => {
  // Academic staff may inspect a specific teacher's reports; a teacher always
  // gets their own, whatever teacher_id they send.
  const isTeacher = user.role === 'teacher';
  let teacher = null;

  if (isTeacher) {
    teacher = await Teacher.findOne({ userId: user._id });
    if (!teacher) {
      throw new ReportError('No teacher record is linked to this account', 404);
    }
  } else if (filters.teacher_id) {
    teacher = await Teacher.findById(filters.teacher_id);
    if (!teacher) throw new ReportError('Teacher not found', 404);
  }

  const query = teacher ? { teacherId: teacher._id } : {};
  const assignments = await TeacherAssignment.find(query)
    .populate('subjectId', 'sub_name sub_no')
    .populate('classId', 'cl_name cl_no')
    .populate('sectionId', 'name')
    .populate({
      path: 'termId',
      select: 'name academicYearId',
      populate: { path: 'academicYearId', select: 'y_name' }
    })
    .populate('timetableSlots.periodId', 'per_no per_name time_in time_out')
    .populate({
      path: 'teacherId',
      select: 'userId',
      populate: { path: 'userId', select: 'firstName lastName username' }
    });

  const classIds = [...new Set(assignments.map((a) => String(a.classId?._id)).filter(Boolean))];
  const subjectIds = [...new Set(assignments.map((a) => String(a.subjectId?._id)).filter(Boolean))];

  return { teacher, assignments, classIds, subjectIds, isTeacher };
};

/**
 * Which classes a report may cover for this user.
 *
 * - A teacher only ever gets the classes they are assigned to
 *   (resolveTeacherScope). Asking for another class is refused.
 * - Everyone else (admin, principal, academic office, custom roles mapped to
 *   them) gets the chosen class, or every class when none is chosen.
 *
 * Returns { classIds, restricted }: classIds is null when the report may cover
 * the whole school; restricted is true for a teacher.
 */
export const classScopeFor = async (user, filters = {}) => {
  if (user?.role !== 'teacher') {
    return { classIds: filters.class_id ? [String(filters.class_id)] : null, restricted: false };
  }
  // A teacher's own record only — never a teacher_id they send.
  const scope = await resolveTeacherScope(user, {});
  if (filters.class_id) {
    if (!scope.classIds.includes(String(filters.class_id))) {
      throw new ReportError('You can only see the classes you teach.', 403);
    }
    return { classIds: [String(filters.class_id)], restricted: true };
  }
  return { classIds: scope.classIds, restricted: true };
};

/** The academic office: sees every class. */
export const OFFICE_ROLES = ['admin', 'principal', 'academic_officer'];

/**
 * One report offered twice: to the academic office (Academic Office
 * department, every class) and to teachers (My Classes department, their own
 * classes only). Both share one `run`, which scopes itself with
 * classScopeFor — the split only decides where the report is listed, so an
 * admin doesn't see it twice and a teacher sees it under their own heading.
 */
export const officeAndTeacher = ({
  id, teacherId, title, teacherTitle, description, teacherDescription, group, teacherGroup, filters, run
}) => [
  { id, title, description, group, department: 'academic', roles: OFFICE_ROLES, filters, run },
  {
    id: teacherId,
    title: teacherTitle ?? title,
    description: teacherDescription ?? description,
    group: teacherGroup,
    department: 'teaching',
    roles: ['teacher'],
    filters,
    run
  }
];

/** Shown in place of a table when a teacher has no classes assigned. */
export const NO_CLASSES_RESULT = {
  columns: [{ key: 'message', label: 'No classes are assigned to you yet. Ask the academic office to assign your subjects.' }],
  rows: [],
  summary: []
};

/** Narrow a class filter to the teacher's own classes, never outside them. */
export const scopedClassIds = (scope, filters = {}) => {
  if (filters.class_id && scope.classIds.includes(String(filters.class_id))) {
    return [String(filters.class_id)];
  }
  return scope.classIds;
};
