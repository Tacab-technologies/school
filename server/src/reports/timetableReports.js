import mongoose from 'mongoose';
import Term from '../models/Term.js';
import Period from '../models/Period.js';
import Class from '../models/Class.js';
import Teacher from '../models/Teacher.js';
import TeacherAssignment from '../models/TeacherAssignment.js';
import { activeTermId } from '../services/resultService.js';
import {
  FILTERS,
  OFFICE_ROLES,
  ReportError,
  classScopeFor,
  fullName,
  officeAndTeacher
} from './helpers.js';

/**
 * Timetables as a grid — one row per period, one column per school day —
 * built from the teaching assignments' timetable slots (the timetable the
 * school actually uses). Without a term the current term is used.
 */

const DAY_ORDER = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const isId = (v) => mongoose.isValidObjectId(v);

const teacherNameOf = (teacher) => fullName(teacher?.userId) || teacher?.userId?.username || 'No teacher';

const loadTerm = async (filters) => {
  const termId = isId(filters.term_id) ? filters.term_id : await activeTermId();
  if (!termId) throw new ReportError('Choose a term.', 400);
  const term = await Term.findById(termId).populate('academicYearId', 'y_name').lean();
  if (!term) throw new ReportError('Term not found', 404);
  return term;
};

/**
 * Build the grid. `cellOf(assignment)` gives the text for one lesson; several
 * lessons in the same slot (e.g. different sections) are joined.
 */
const buildGrid = async (term, assignments, cellOf) => {
  const periods = await Period.find({ termId: term._id }).lean();
  periods.sort((a, b) => String(a.time_in).localeCompare(String(b.time_in)) || String(a.per_no).localeCompare(String(b.per_no)));

  const cells = new Map();
  const usedDays = new Set(term.workingDays ?? []);
  let lessons = 0;
  for (const a of assignments) {
    for (const slot of a.timetableSlots ?? []) {
      if (!slot.periodId || !slot.day) continue;
      const key = `${slot.day}|${slot.periodId}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(cellOf(a));
      usedDays.add(slot.day);
      lessons += 1;
    }
  }
  const days = DAY_ORDER.filter((d) => usedDays.has(d));

  const rows = periods.map((p) => ({
    period: p.per_name,
    time: `${p.time_in}–${p.time_out}`,
    ...Object.fromEntries(days.map((d) => [d, (cells.get(`${d}|${p._id}`) ?? []).join(' / ') || ''])),
  }));

  return {
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'time', label: 'Time' },
      ...days.map((d) => ({ key: d, label: d }))
    ],
    rows,
    lessons,
    free: rows.reduce((n, r) => n + days.filter((d) => !r[d]).length, 0)
  };
};

const ASSIGNMENT_POPULATE = [
  { path: 'subjectId', select: 'sub_name subjectCode' },
  { path: 'classId', select: 'cl_name' },
  { path: 'sectionId', select: 'name' },
  { path: 'teacherId', select: 'userId', populate: { path: 'userId', select: 'firstName lastName username' } }
];

const byClass = officeAndTeacher({
  id: 'timetable-by-class',
  teacherId: 'teaching-timetable-by-class',
  title: 'Class timetable',
  teacherTitle: 'Timetable of my classes',
  description: 'The weekly timetable of one class: each day and period with its subject and teacher',
  group: 'Timetable',
  teacherGroup: 'Timetable',
  filters: [{ ...FILTERS.term, label: 'Term', hint: 'Leave empty for the current term' }, FILTERS.class, FILTERS.section],
  run: async (filters, { user }) => {
    if (!isId(filters.class_id)) throw new ReportError('Choose a class.', 400);
    await classScopeFor(user, filters); // a teacher may only open the classes they teach
    const term = await loadTerm(filters);
    const query = { termId: term._id, classId: filters.class_id };
    if (isId(filters.section_id)) query.sectionId = filters.section_id;
    const [assignments, klass] = await Promise.all([
      TeacherAssignment.find(query).populate(ASSIGNMENT_POPULATE).lean(),
      Class.findById(filters.class_id).select('cl_name').lean()
    ]);
    const sections = new Set(assignments.map((a) => String(a.sectionId?._id ?? '')));
    const showSection = sections.size > 1;

    const grid = await buildGrid(term, assignments, (a) =>
      `${a.subjectId?.sub_name ?? '—'} — ${teacherNameOf(a.teacherId)}${showSection && a.sectionId ? ` (${a.sectionId.name})` : ''}`);

    return {
      columns: grid.columns,
      rows: grid.rows,
      summary: [
        { label: 'Class', value: klass?.cl_name ?? '—' },
        { label: 'Term', value: `${term.name}${term.academicYearId?.y_name ? ` ${term.academicYearId.y_name}` : ''}` },
        { label: 'Lessons per Week', value: grid.lessons },
        { label: 'Free Periods', value: grid.free },
        { label: 'Teachers', value: new Set(assignments.map((a) => String(a.teacherId?._id))).size }
      ]
    };
  }
});

const byTeacher = {
  id: 'timetable-by-teacher',
  title: 'Teacher timetable',
  description: "One teacher's weekly timetable: each day and period with the subject and class they teach",
  group: 'Timetable',
  department: 'academic',
  roles: OFFICE_ROLES,
  filters: [{ ...FILTERS.term, label: 'Term', hint: 'Leave empty for the current term' }, FILTERS.teacher],
  run: async (filters) => {
    if (!isId(filters.teacher_id)) throw new ReportError('Choose a teacher.', 400);
    const term = await loadTerm(filters);
    const teacher = await Teacher.findById(filters.teacher_id).populate('userId', 'firstName lastName username').lean();
    if (!teacher) throw new ReportError('Teacher not found', 404);
    const assignments = await TeacherAssignment.find({ termId: term._id, teacherId: teacher._id })
      .populate(ASSIGNMENT_POPULATE)
      .lean();

    const grid = await buildGrid(term, assignments, (a) =>
      `${a.subjectId?.sub_name ?? '—'} — ${a.classId?.cl_name ?? '—'}${a.sectionId?.name ? ` ${a.sectionId.name}` : ''}`);

    return {
      columns: grid.columns,
      rows: grid.rows,
      summary: [
        { label: 'Teacher', value: teacherNameOf(teacher) },
        { label: 'Term', value: `${term.name}${term.academicYearId?.y_name ? ` ${term.academicYearId.y_name}` : ''}` },
        { label: 'Periods per Week', value: grid.lessons },
        { label: 'Classes', value: new Set(assignments.map((a) => String(a.classId?._id))).size },
        { label: 'Subjects', value: new Set(assignments.map((a) => String(a.subjectId?._id))).size }
      ]
    };
  }
};

export const timetableReports = [...byClass, byTeacher];
