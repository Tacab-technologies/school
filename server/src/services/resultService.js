// Term results and report cards, built from the marks teachers enter.
//
// For each student and subject the marks of every exam in the term are added
// up and compared with what was possible (each exam's maxMarks), giving a
// percentage and a grade. The same is done across all subjects for the overall
// result, and students are ranked within their class (and section).
import Exam from '../models/Exam.js';
import Mark from '../models/Mark.js';
import MarkSheet from '../models/MarkSheet.js';
import ResultHold from '../models/ResultHold.js';
import Student from '../models/Student.js';
import Subject from '../models/Subject.js';
import Term from '../models/Term.js';
import Class from '../models/Class.js';
import Section from '../models/Section.js';
import Teacher from '../models/Teacher.js';
import TeacherAssignment from '../models/TeacherAssignment.js';
import '../models/Year.js';
import AppError from '../utils/AppError.js';
import { taughtInClassFilter } from './subjectService.js';
import { GRADE_SCALE, PASS_PERCENT, gradeFor, rankByPercent, round1 } from '../utils/grading.js';

const sameId = (a, b) => String(a ?? '') === String(b ?? '');
const fullName = (s) => [s.firstName, s.lastName].filter(Boolean).join(' ');

/** The school's current term: the newest active one. */
export const activeTermId = async () => {
  const term = await Term.findOne({ status: 'active' }).sort({ startDate: -1, createdAt: -1 }).select('_id').lean();
  return term?._id ?? null;
};

/**
 * A teacher's lessons (class, section, subject) in one term. Only that term:
 * last term's timetable must never let a teacher mark or read a class they no
 * longer teach. Without a termId the active term is used.
 */
export const teacherLessons = async (userId, termId) => {
  const teacher = await Teacher.findOne({ userId }).select('_id').lean();
  if (!teacher) return [];
  const term = termId || (await activeTermId());
  if (!term) return [];
  return TeacherAssignment.find({ teacherId: teacher._id, termId: term }).lean();
};

/** Does an exam include this class? (No classes listed = every class sits it.) */
export const examHasClass = (exam, classId) => !exam.classIds?.length || exam.classIds.some((c) => sameId(c, classId));

/**
 * The students on one mark sheet: today's class list plus anyone already
 * marked on it.
 *
 * Students without a section: in a class that has sections, a student whose
 * section was never set would otherwise appear on no sheet at all. They are
 * shown on every section's sheet of their class (flagged `noSection`), and
 * their marks are saved without a section so they are not filed under the
 * wrong one. They count in whole-class results. In a class with no sections,
 * every student of the class is on the one sheet.
 */
export const sheetStudents = async (exam, { classId, sectionId, subjectId }) => {
  const sectionFilter = sectionId ? { sectionId: { $in: [sectionId, null] } } : {};
  const [current, marks] = await Promise.all([
    Student.find({ classId, isDeleted: false, status: 'Active', ...sectionFilter }).select('_id').lean(),
    Mark.find({ examId: exam._id, classId, subjectId, ...sectionFilter }).lean(),
  ]);
  const ids = [...new Set([...current.map((s) => String(s._id)), ...marks.map((m) => String(m.studentId))])];
  const students = await Student.find({ _id: { $in: ids } })
    .select('firstName lastName admissionNumber gender classId sectionId')
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  return {
    students: students.map((s) => ({ ...s, noSection: !!sectionId && !s.sectionId })),
    marks,
  };
};

const isMarked = (m) => m.score !== null || m.absent;

/**
 * How far marking has got for an exam: one row per lesson (class, section,
 * subject) with students marked out of the total on its sheet. `lessons` are
 * TeacherAssignment-like objects ({ classId, sectionId, subjectId, teacherId? }).
 */
export const markingProgress = async (exam, lessons) => {
  const own = lessons.filter((l) => examHasClass(exam, l.classId));
  // One row per class/section/subject even if two teachers share it.
  const unique = new Map();
  for (const l of own) {
    const key = `${l.classId}:${l.sectionId ?? ''}:${l.subjectId}`;
    if (!unique.has(key)) unique.set(key, { ...l, teacherIds: [] });
    if (l.teacherId) unique.get(key).teacherIds.push(l.teacherId);
  }
  const list = [...unique.values()];
  const [classes, sections, subjects, teachers, sheetDocs] = await Promise.all([
    Class.find({ _id: { $in: list.map((l) => l.classId) } }).select('cl_name').lean(),
    Section.find({ _id: { $in: list.map((l) => l.sectionId).filter(Boolean) } }).select('name').lean(),
    Subject.find({ _id: { $in: list.map((l) => l.subjectId) } }).select('sub_name').lean(),
    Teacher.find({ _id: { $in: list.flatMap((l) => l.teacherIds) } }).select('userId').populate('userId', 'firstName lastName').lean(),
    MarkSheet.find({ examId: exam._id }).lean(),
  ]);
  const sheetOf = new Map(sheetDocs.map((d) => [`${d.classId}:${d.sectionId ?? ''}:${d.subjectId}`, d]));
  const name = (docs, field) => new Map(docs.map((d) => [String(d._id), d[field]]));
  const className = name(classes, 'cl_name');
  const sectionName = name(sections, 'name');
  const subjectName = name(subjects, 'sub_name');
  const teacherName = new Map(teachers.map((t) => [String(t._id), t.userId ? fullName(t.userId) : '']));

  const rows = await Promise.all(list.map(async (l) => {
    const { students, marks } = await sheetStudents(exam, l);
    const onSheet = new Set(students.map((s) => String(s._id)));
    const marked = marks.filter((m) => isMarked(m) && onSheet.has(String(m.studentId))).length;
    const sheet = sheetOf.get(`${l.classId}:${l.sectionId ?? ''}:${l.subjectId}`);
    return {
      sheetId: sheet?._id ?? null,
      status: sheet?.status ?? 'draft',
      submittedAt: sheet?.submittedAt ?? null,
      editRequested: sheet?.editRequest?.status === 'pending',
      unlocked: !!sheet?.unlocked,
      classId: String(l.classId),
      sectionId: l.sectionId ? String(l.sectionId) : null,
      subjectId: String(l.subjectId),
      className: className.get(String(l.classId)) ?? '—',
      sectionName: l.sectionId ? sectionName.get(String(l.sectionId)) ?? '—' : null,
      subjectName: subjectName.get(String(l.subjectId)) ?? '—',
      teachers: l.teacherIds.map((id) => teacherName.get(String(id))).filter(Boolean).join(', '),
      students: students.length,
      marked,
      remaining: Math.max(0, students.length - marked),
    };
  }));
  return rows.sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true })
    || String(a.sectionName ?? '').localeCompare(String(b.sectionName ?? ''))
    || a.subjectName.localeCompare(b.subjectName));
};

/** Exams of a term that this class sits (an exam with no classes listed is for everyone). */
export const examsForClass = async (termId, classId, { publishedOnly = false, examId = null, excludeExamIds = [] } = {}) => {
  const exams = await Exam.find({
    termId,
    ...(publishedOnly && { published: true }),
    ...(examId ? { _id: examId } : excludeExamIds.length ? { _id: { $nin: excludeExamIds } } : {}),
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  return exams.filter((e) => examHasClass(e, classId));
};

const percentOf = (earned, possible) => (possible > 0 ? round1((earned / possible) * 100) : null);

/** Adds up one student's marks (for one subject, or all of them). */
const tally = (marks, maxByExam) => {
  let earned = 0;
  let possible = 0;
  for (const m of marks) {
    if (m.score === null && !m.absent) continue; // not marked yet
    earned += m.absent ? 0 : m.score;
    possible += maxByExam.get(String(m.examId)) ?? 0;
  }
  const percent = percentOf(earned, possible);
  return { earned, possible, percent, grade: gradeFor(percent) };
};

/**
 * Results for one class (and section) in a term: every student, every subject,
 * totals, grades and positions. `sectionId` undefined = the whole class.
 */
export const buildClassResults = async ({ termId, classId, sectionId, publishedOnly = false, examId = null, subjectIds = null, excludeExamIds = [] }) => {
  const term = await Term.findById(termId).populate('academicYearId', 'y_name').lean();
  if (!term) throw new AppError('Term not found', 404);
  // `examId` narrows the results to that one exam (used by the exam reports).
  const exams = await examsForClass(termId, classId, { publishedOnly, examId, excludeExamIds });
  const maxByExam = new Map(exams.map((e) => [String(e._id), e.maxMarks]));
  const sectionFilter = sectionId === undefined ? {} : { sectionId: sectionId || null };

  // `subjectIds` limits the results to those subjects (a teacher sees only what they teach).
  const subjectFilter = subjectIds ? { subjectId: { $in: subjectIds } } : {};
  const marks = exams.length
    ? await Mark.find({ examId: { $in: exams.map((e) => e._id) }, classId, ...sectionFilter, ...subjectFilter }).lean()
    : [];

  // Everyone who has marks here, plus today's class list so unmarked students show too.
  const current = await Student.find({ classId, isDeleted: false, status: 'Active', ...sectionFilter }).select('_id').lean();
  const studentIds = [...new Set([...marks.map((m) => String(m.studentId)), ...current.map((s) => String(s._id))])];
  const students = await Student.find({ _id: { $in: studentIds } })
    .select('firstName lastName admissionNumber sectionId gender')
    .populate('sectionId', 'name')
    .lean();

  // Whose results are hidden from them in these exams, for the staff views.
  const held = new Set((await ResultHold.distinct('studentId', { examId: { $in: exams.map((e) => e._id) }, studentId: { $in: studentIds } })).map(String));

  const markedSubjects = new Set(marks.map((m) => String(m.subjectId)));
  const subjects = await Subject.find({
    $or: [{ _id: { $in: [...markedSubjects] } }, { ...taughtInClassFilter(classId), status: 'active' }],
    ...(subjectIds && { _id: { $in: subjectIds } }),
  })
    .select('sub_name subjectCode')
    .sort({ sub_name: 1 })
    .lean();

  const marksByStudent = new Map();
  for (const m of marks) {
    const key = String(m.studentId);
    if (!marksByStudent.has(key)) marksByStudent.set(key, []);
    marksByStudent.get(key).push(m);
  }

  const rows = students.map((s) => {
    const own = marksByStudent.get(String(s._id)) ?? [];
    const bySubject = {};
    for (const subject of subjects) {
      const subjectMarks = own.filter((m) => sameId(m.subjectId, subject._id));
      bySubject[subject._id] = {
        ...tally(subjectMarks, maxByExam),
        scores: Object.fromEntries(subjectMarks.map((m) => [String(m.examId), { score: m.score, absent: m.absent, remark: m.remark }])),
      };
    }
    return {
      key: String(s._id),
      student: { _id: s._id, name: fullName(s), admissionNumber: s.admissionNumber, section: s.sectionId?.name ?? null, held: held.has(String(s._id)) },
      subjects: bySubject,
      ...tally(own, maxByExam),
    };
  });

  const positions = rankByPercent(rows);
  const ranked = rows
    .map(({ key, ...row }) => ({ ...row, position: positions.get(key) ?? null }))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.student.name.localeCompare(b.student.name));

  const subjectSummary = subjects.map((subject) => {
    const percents = rows.map((r) => r.subjects[subject._id].percent).filter((p) => p !== null);
    return {
      _id: subject._id,
      name: subject.sub_name,
      code: subject.subjectCode ?? null,
      average: percents.length ? round1(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
      passed: percents.filter((p) => p >= PASS_PERCENT).length,
      marked: percents.length,
    };
  });

  const overall = ranked.map((r) => r.percent).filter((p) => p !== null);
  return {
    term: { _id: term._id, name: term.name, year: term.academicYearId?.y_name ?? null },
    exams: exams.map((e) => ({ _id: e._id, name: e.name, maxMarks: e.maxMarks, published: e.published, date: e.date })),
    subjects: subjectSummary,
    students: ranked,
    summary: {
      students: ranked.length,
      marked: overall.length,
      average: overall.length ? round1(overall.reduce((a, b) => a + b, 0) / overall.length) : null,
      passed: overall.filter((p) => p >= PASS_PERCENT).length,
    },
    gradeScale: GRADE_SCALE,
    passPercent: PASS_PERCENT,
  };
};

/** Terms in which a student has marks, newest first, for the report card's term picker. */
export const termsWithResults = async (studentId, { publishedOnly = false, excludeExamIds = [] } = {}) => {
  const hidden = new Set(excludeExamIds.map(String));
  const examIds = (await Mark.distinct('examId', { studentId })).filter((id) => !hidden.has(String(id)));
  const termIds = await Exam.distinct('termId', { _id: { $in: examIds }, ...(publishedOnly && { published: true }) });
  const terms = await Term.find({ _id: { $in: termIds } })
    .populate('academicYearId', 'y_name')
    .sort({ startDate: -1, createdAt: -1 })
    .lean();
  return terms.map((t) => ({ _id: t._id, name: t.name, year: t.academicYearId?.y_name ?? null }));
};

/**
 * One student's report card for a term. Without a termId it uses the newest
 * term that has results. Returns { terms, card } where card is null when the
 * student has no results yet.
 */
export const buildReportCard = async (studentId, termId, { publishedOnly = false, subjectIdsFor = null } = {}) => {
  const student = await Student.findOne({ _id: studentId, isDeleted: false })
    .select('firstName lastName admissionNumber classId sectionId gender birthDate')
    .lean();
  if (!student) throw new AppError('Student not found', 404);

  // Students and parents don't see exams the office has hidden from this student.
  const excludeExamIds = publishedOnly ? await ResultHold.distinct('examId', { studentId }) : [];
  const onHold = publishedOnly ? await Exam.countDocuments({ _id: { $in: excludeExamIds }, published: true }) : 0;
  const terms = await termsWithResults(studentId, { publishedOnly, excludeExamIds });
  const chosen = termId ? terms.find((t) => sameId(t._id, termId)) : terms[0];
  if (!chosen) return { terms, card: null, onHold };

  // The class the student was in when marked this term (they may have moved since).
  const exams = await Exam.find({ termId: chosen._id, _id: { $nin: excludeExamIds }, ...(publishedOnly && { published: true }) }).select('_id').lean();
  const lastMark = await Mark.findOne({ studentId, examId: { $in: exams.map((e) => e._id) } }).sort({ updatedAt: -1 }).lean();
  const classId = lastMark?.classId ?? student.classId;
  const sectionId = lastMark ? lastMark.sectionId : student.sectionId;

  // `subjectIdsFor(term, class, section)` limits the card to some subjects (a teacher's own).
  const subjectIds = subjectIdsFor ? await subjectIdsFor(chosen._id, classId, sectionId ?? null) : null;
  const results = await buildClassResults({ termId: chosen._id, classId, sectionId: sectionId ?? null, publishedOnly, subjectIds, excludeExamIds });
  const row = results.students.find((r) => sameId(r.student._id, studentId)) ?? null;
  const [cls, section] = await Promise.all([
    Class.findById(classId).select('cl_name').lean(),
    sectionId ? Section.findById(sectionId).select('name').lean() : null,
  ]);

  return {
    terms,
    onHold,
    card: {
      student: { _id: student._id, name: fullName(student), admissionNumber: student.admissionNumber, gender: student.gender },
      className: cls?.cl_name ?? null,
      sectionName: section?.name ?? null,
      term: results.term,
      exams: results.exams,
      // Only subjects with something marked for this student.
      subjects: results.subjects
        .filter((s) => row && Object.keys(row.subjects[s._id]?.scores ?? {}).length)
        .map((s) => ({ ...s, ...row.subjects[s._id] })),
      total: row ? { earned: row.earned, possible: row.possible, percent: row.percent, grade: row.grade } : null,
      position: row?.position ?? null,
      classSize: results.summary.marked,
      classAverage: results.summary.average,
      gradeScale: results.gradeScale,
      passPercent: results.passPercent,
    },
  };
};
