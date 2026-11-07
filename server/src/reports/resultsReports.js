import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import Mark from '../models/Mark.js';
import Term from '../models/Term.js';
import Class from '../models/Class.js';
import Student from '../models/Student.js';
import Section from '../models/Section.js';
import { buildClassResults, examHasClass } from '../services/resultService.js';
import { PASS_PERCENT, gradeFor, rankByPercent } from '../utils/grading.js';
import {
  FILTERS,
  NO_CLASSES_RESULT,
  ReportError,
  classScopeFor,
  fullName,
  intFilter,
  numberFilter,
  officeAndTeacher,
  round1
} from './helpers.js';

/**
 * Exam and term results: class results with positions, results by subject,
 * report cards, school summaries, exam comparisons, top students and students
 * who need help.
 *
 * Every report works for one exam, or for a whole term (all of its exams added
 * up, exactly like the report card). The academic office sees every class; a
 * teacher sees only the classes they teach (classScopeFor). All figures come
 * from resultService.buildClassResults, so they match the report cards.
 */

const isId = (v) => mongoose.isValidObjectId(v);
const sameId = (a, b) => String(a ?? '') === String(b ?? '');
const avg = (list) => (list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null);
const asPercent = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const byClassName = (a, b) => a.cl_name.localeCompare(b.cl_name, undefined, { numeric: true });

const OFFICE_GROUP = 'Exams & Results';
const TEACHER_GROUP = 'Marks & results';

/**
 * What the report is about: one exam, or every exam of a term.
 * Returns { termId, examId, exam, exams, label }.
 */
const resolveBasis = async (filters, examKey = 'exam_id') => {
  if (isId(filters[examKey])) {
    const exam = await Exam.findById(filters[examKey]).populate('termId', 'name').lean();
    if (!exam) throw new ReportError('Exam not found', 404);
    const termId = exam.termId?._id ?? exam.termId;
    return {
      termId,
      examId: exam._id,
      exam,
      exams: [exam],
      label: `${exam.name}${exam.termId?.name ? ` (${exam.termId.name})` : ''}`
    };
  }
  if (isId(filters.term_id)) {
    const term = await Term.findById(filters.term_id).populate('academicYearId', 'y_name').lean();
    if (!term) throw new ReportError('Term not found', 404);
    const exams = await Exam.find({ termId: term._id }).lean();
    return {
      termId: term._id,
      examId: null,
      exam: null,
      exams,
      label: `${term.name}${term.academicYearId?.y_name ? ` ${term.academicYearId.y_name}` : ''} — all exams`
    };
  }
  throw new ReportError('Choose a term or an exam.', 400);
};

/** The classes the report covers: the user's scope, narrowed to classes that sit the exam(s). */
const resolveClasses = async (basis, scope, filters) => {
  let ids;
  if (scope.classIds) {
    ids = scope.classIds;
  } else {
    const listed = basis.exams.flatMap((e) => (e.classIds ?? []).map(String));
    const marked = basis.exams.length
      ? (await Mark.distinct('classId', { examId: { $in: basis.exams.map((e) => e._id) } })).map(String)
      : [];
    ids = [...new Set([...listed, ...marked])];
  }
  if (basis.exam) {
    if (filters.class_id && !examHasClass(basis.exam, filters.class_id)) {
      throw new ReportError("This class doesn't sit this exam.", 400);
    }
    ids = ids.filter((id) => examHasClass(basis.exam, id));
  }
  const classes = await Class.find({ _id: { $in: ids } }).select('cl_name').lean();
  return classes.sort(byClassName);
};

/** buildClassResults for every covered class. Returns [{ cls, results }]. */
const loadResults = async (basis, classes, sectionId) => {
  const out = [];
  for (const cls of classes) {
    const results = await buildClassResults({
      termId: basis.termId,
      classId: cls._id,
      sectionId: isId(sectionId) ? sectionId : undefined,
      examId: basis.examId
    });
    out.push({ cls, results });
  }
  return out;
};

/** Shared front half of every results report. */
const prepare = async (filters, user) => {
  const scope = await classScopeFor(user, filters);
  if (scope.restricted && !scope.classIds.length) return { empty: NO_CLASSES_RESULT };
  const basis = await resolveBasis(filters);
  const classes = await resolveClasses(basis, scope, filters);
  const sets = await loadResults(basis, classes, filters.section_id);
  return { basis, classes, sets, scope };
};

const resultWord = (percent, passMark = PASS_PERCENT) =>
  percent === null || percent === undefined ? 'Not marked' : percent >= passMark ? 'Pass' : 'Fail';

// ============================================================
// Class results with totals, averages and positions
// ============================================================

const classResults = officeAndTeacher({
  id: 'exam-student-results',
  teacherId: 'teaching-class-results',
  title: 'Class results and positions',
  teacherTitle: 'My class results and positions',
  description: 'Every student in a class for an exam or a whole term: each subject, total, average, grade and position in class',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.term, FILTERS.examOptional, FILTERS.class, FILTERS.section],
  run: async (filters, { user }) => {
    if (!isId(filters.class_id)) throw new ReportError('Choose a class.', 400);
    const prepared = await prepare(filters, user);
    if (prepared.empty) return prepared.empty;
    const { basis, sets } = prepared;
    const results = sets[0]?.results;
    if (!results) return { columns: [{ key: 'message', label: "This class doesn't sit this exam." }], rows: [], summary: [] };
    const subjects = results.subjects.filter((s) => s.marked > 0);

    const rows = results.students.map((r) => ({
      position: r.position ?? '',
      rollNo: r.student.admissionNumber ?? '—',
      name: r.student.name,
      section: r.student.section ?? '—',
      ...Object.fromEntries(subjects.map((s) => [`s_${s._id}`, r.subjects[s._id]?.percent ?? null])),
      earned: r.possible ? r.earned : null,
      possible: r.possible || null,
      percent: r.percent,
      grade: r.grade?.grade ?? '',
      result: resultWord(r.percent)
    }));

    return {
      columns: [
        { key: 'position', label: 'Position', type: 'number' },
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'section', label: 'Section' },
        ...subjects.map((s) => ({ key: `s_${s._id}`, label: `${s.code || s.name} %`, type: 'number' })),
        { key: 'earned', label: 'Total', type: 'number' },
        { key: 'possible', label: 'Out of', type: 'number' },
        { key: 'percent', label: 'Average %', type: 'number' },
        { key: 'grade', label: 'Grade' },
        { key: 'result', label: 'Result' }
      ],
      rows,
      summary: [
        { label: 'Results for', value: basis.label },
        { label: 'Class', value: sets[0].cls.cl_name },
        { label: 'Students', value: results.summary.students },
        { label: 'Marked', value: results.summary.marked },
        { label: 'Class Average', value: asPercent(results.summary.average) },
        { label: 'Passed', value: results.summary.passed }
      ]
    };
  }
});

// ============================================================
// Results by class and subject
// ============================================================

const resultsByClass = officeAndTeacher({
  id: 'exam-results-by-class',
  teacherId: 'teaching-results-by-class',
  title: 'Results by class and subject',
  teacherTitle: 'My results by class and subject',
  description: 'For each class and subject: average, highest and lowest score, how many passed and the pass rate',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.term, FILTERS.examOptional, FILTERS.class],
  run: async (filters, { user }) => {
    const prepared = await prepare(filters, user);
    if (prepared.empty) return prepared.empty;
    const { basis, sets } = prepared;

    const rows = [];
    for (const { cls, results } of sets) {
      for (const subject of results.subjects) {
        const percents = results.students
          .map((s) => s.subjects[subject._id]?.percent)
          .filter((p) => p !== null && p !== undefined);
        if (!percents.length) continue;
        const absent = basis.examId
          ? results.students.filter((s) => s.subjects[subject._id]?.scores?.[String(basis.examId)]?.absent).length
          : null;
        const passed = percents.filter((p) => p >= PASS_PERCENT).length;
        rows.push({
          className: cls.cl_name,
          subject: subject.name,
          students: results.students.length,
          marked: percents.length,
          absent,
          average: avg(percents),
          highest: Math.max(...percents),
          lowest: Math.min(...percents),
          passed,
          failed: percents.length - passed,
          passRate: round1((passed / percents.length) * 100)
        });
      }
    }

    const marked = rows.reduce((n, r) => n + r.marked, 0);
    const passed = rows.reduce((n, r) => n + r.passed, 0);
    return {
      columns: [
        { key: 'className', label: 'Class' },
        { key: 'subject', label: 'Subject' },
        { key: 'students', label: 'Students', type: 'number' },
        { key: 'marked', label: 'Marked', type: 'number' },
        ...(basis.examId ? [{ key: 'absent', label: 'Absent', type: 'number' }] : []),
        { key: 'average', label: 'Average %', type: 'number' },
        { key: 'highest', label: 'Highest %', type: 'number' },
        { key: 'lowest', label: 'Lowest %', type: 'number' },
        { key: 'passed', label: 'Passed', type: 'number' },
        { key: 'failed', label: 'Failed', type: 'number' },
        { key: 'passRate', label: 'Pass Rate %', type: 'number' }
      ],
      rows,
      summary: [
        { label: 'Results for', value: basis.label },
        { label: 'Classes', value: new Set(rows.map((r) => r.className)).size },
        { label: 'Marks Entered', value: marked },
        { label: 'Pass Rate', value: asPercent(marked ? round1((passed / marked) * 100) : null) },
        { label: 'Pass Mark', value: `${PASS_PERCENT}%` }
      ]
    };
  }
});

// ============================================================
// School results summary — one row per class
// ============================================================

const schoolSummary = officeAndTeacher({
  id: 'results-school-summary',
  teacherId: 'teaching-results-summary',
  title: 'School results summary',
  teacherTitle: 'Results summary for my classes',
  description: 'One line per class: students, class average, highest and lowest average, pass rate and the top student',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.term, FILTERS.examOptional, FILTERS.class],
  run: async (filters, { user }) => {
    const prepared = await prepare(filters, user);
    if (prepared.empty) return prepared.empty;
    const { basis, sets } = prepared;

    const rows = sets
      .map(({ cls, results }) => {
        const marked = results.students.filter((s) => s.percent !== null);
        const percents = marked.map((s) => s.percent);
        const top = marked[0];
        return {
          className: cls.cl_name,
          students: results.summary.students,
          marked: results.summary.marked,
          average: results.summary.average,
          highest: percents.length ? Math.max(...percents) : null,
          lowest: percents.length ? Math.min(...percents) : null,
          passed: results.summary.passed,
          passRate: percents.length ? round1((results.summary.passed / percents.length) * 100) : null,
          topStudent: top ? `${top.student.name} (${top.percent}%)` : '—'
        };
      })
      .filter((r) => r.students > 0);

    // Rank the classes by average so the strongest class reads first.
    const positions = rankByPercent(rows.map((r) => ({ key: r.className, percent: r.average })));
    rows.forEach((r) => { r.position = positions.get(r.className) ?? ''; });
    rows.sort((a, b) => (a.position || Infinity) - (b.position || Infinity));

    const all = sets.flatMap(({ results }) => results.students.map((s) => s.percent).filter((p) => p !== null));
    return {
      columns: [
        { key: 'position', label: 'Rank', type: 'number' },
        { key: 'className', label: 'Class' },
        { key: 'students', label: 'Students', type: 'number' },
        { key: 'marked', label: 'Marked', type: 'number' },
        { key: 'average', label: 'Class Average %', type: 'number' },
        { key: 'highest', label: 'Highest %', type: 'number' },
        { key: 'lowest', label: 'Lowest %', type: 'number' },
        { key: 'passed', label: 'Passed', type: 'number' },
        { key: 'passRate', label: 'Pass Rate %', type: 'number' },
        { key: 'topStudent', label: 'Top Student' }
      ],
      rows,
      summary: [
        { label: 'Results for', value: basis.label },
        { label: 'Classes', value: rows.length },
        { label: 'Students Marked', value: all.length },
        { label: 'School Average', value: asPercent(avg(all)) },
        { label: 'Pass Rate', value: asPercent(all.length ? round1((all.filter((p) => p >= PASS_PERCENT).length / all.length) * 100) : null) }
      ],
      chart: { type: 'bar', x: 'className', series: ['average'] }
    };
  }
});

// ============================================================
// Report card — one student's subjects, marks and grades
// ============================================================

const reportCard = officeAndTeacher({
  id: 'results-report-card',
  teacherId: 'teaching-report-card',
  title: 'Student report card',
  description: "One student's marks and grade in every subject for an exam or a whole term, with position in class",
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.term, FILTERS.examOptional, FILTERS.class, FILTERS.student],
  run: async (filters, { user }) => {
    if (!isId(filters.student_id)) throw new ReportError('Choose a student.', 400);
    const basis = await resolveBasis(filters);
    const student = await Student.findOne({ _id: filters.student_id, isDeleted: { $ne: true } })
      .select('firstName lastName admissionNumber classId sectionId')
      .lean();
    if (!student) throw new ReportError('Student not found', 404);

    // The class the student was marked in for this exam/term (they may have moved since).
    const lastMark = basis.exams.length
      ? await Mark.findOne({ studentId: student._id, examId: { $in: basis.exams.map((e) => e._id) } }).sort({ updatedAt: -1 }).lean()
      : null;
    const classId = lastMark?.classId ?? student.classId;
    const sectionId = lastMark ? lastMark.sectionId : student.sectionId;

    const scope = await classScopeFor(user, {});
    if (scope.restricted && !scope.classIds.includes(String(classId))) {
      throw new ReportError('You can only see students in the classes you teach.', 403);
    }

    const results = await buildClassResults({ termId: basis.termId, classId, sectionId: sectionId ?? null, examId: basis.examId });
    const row = results.students.find((r) => sameId(r.student._id, student._id));
    const [cls, section] = await Promise.all([
      Class.findById(classId).select('cl_name').lean(),
      sectionId ? Section.findById(sectionId).select('name').lean() : null
    ]);

    const exams = results.exams;
    const subjects = results.subjects.filter((s) => row && Object.keys(row.subjects[s._id]?.scores ?? {}).length);
    const rows = subjects.map((s) => {
      const own = row.subjects[s._id];
      return {
        subject: s.name,
        ...Object.fromEntries(exams.map((e) => {
          const mark = own.scores[String(e._id)];
          return [`e_${e._id}`, mark ? (mark.absent ? 'Absent' : mark.score) : null];
        })),
        earned: own.possible ? own.earned : null,
        possible: own.possible || null,
        percent: own.percent,
        grade: own.grade?.grade ?? '',
        classAverage: s.average,
        result: resultWord(own.percent)
      };
    });

    return {
      columns: [
        { key: 'subject', label: 'Subject' },
        ...exams.map((e) => ({ key: `e_${e._id}`, label: `${e.name} (/${e.maxMarks})` })),
        { key: 'earned', label: 'Total', type: 'number' },
        { key: 'possible', label: 'Out of', type: 'number' },
        { key: 'percent', label: 'Score %', type: 'number' },
        { key: 'grade', label: 'Grade' },
        { key: 'classAverage', label: 'Class Average %', type: 'number' },
        { key: 'result', label: 'Result' }
      ],
      rows,
      summary: [
        { label: 'Student', value: `${fullName(student)} (${student.admissionNumber})` },
        { label: 'Class', value: [cls?.cl_name, section?.name].filter(Boolean).join(' ') || '—' },
        { label: 'Results for', value: basis.label },
        { label: 'Overall', value: asPercent(row?.percent ?? null) },
        { label: 'Grade', value: row?.grade?.grade ?? '—' },
        { label: 'Position', value: row?.position ? `${row.position} of ${results.summary.marked}` : '—' },
        { label: 'Class Average', value: asPercent(results.summary.average) }
      ]
    };
  }
});

// ============================================================
// Subject performance — one row per subject
// ============================================================

const subjectPerformance = officeAndTeacher({
  id: 'results-subject-performance',
  teacherId: 'teaching-subject-performance',
  title: 'Subject performance',
  teacherTitle: 'Subject performance in my classes',
  description: 'For every subject: average, highest and lowest score, pass rate, and the strongest and weakest class',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.term, FILTERS.examOptional, FILTERS.class, FILTERS.section],
  run: async (filters, { user }) => {
    const prepared = await prepare(filters, user);
    if (prepared.empty) return prepared.empty;
    const { basis, sets } = prepared;

    const bySubject = new Map();
    for (const { cls, results } of sets) {
      for (const subject of results.subjects) {
        const percents = results.students
          .map((s) => s.subjects[subject._id]?.percent)
          .filter((p) => p !== null && p !== undefined);
        if (!percents.length) continue;
        const key = String(subject._id);
        if (!bySubject.has(key)) bySubject.set(key, { subject: subject.name, percents: [], classes: [] });
        const entry = bySubject.get(key);
        entry.percents.push(...percents);
        entry.classes.push({ name: cls.cl_name, average: avg(percents) });
      }
    }

    const rows = [...bySubject.values()]
      .map((e) => {
        const passed = e.percents.filter((p) => p >= PASS_PERCENT).length;
        const ordered = [...e.classes].sort((a, b) => b.average - a.average);
        return {
          subject: e.subject,
          classes: e.classes.length,
          marked: e.percents.length,
          average: avg(e.percents),
          highest: Math.max(...e.percents),
          lowest: Math.min(...e.percents),
          passed,
          failed: e.percents.length - passed,
          passRate: round1((passed / e.percents.length) * 100),
          bestClass: ordered.length > 1 ? `${ordered[0].name} (${ordered[0].average}%)` : '—',
          weakestClass: ordered.length > 1 ? `${ordered.at(-1).name} (${ordered.at(-1).average}%)` : '—'
        };
      })
      .sort((a, b) => b.average - a.average);

    return {
      columns: [
        { key: 'subject', label: 'Subject' },
        { key: 'classes', label: 'Classes', type: 'number' },
        { key: 'marked', label: 'Students Marked', type: 'number' },
        { key: 'average', label: 'Average %', type: 'number' },
        { key: 'highest', label: 'Highest %', type: 'number' },
        { key: 'lowest', label: 'Lowest %', type: 'number' },
        { key: 'passed', label: 'Passed', type: 'number' },
        { key: 'failed', label: 'Failed', type: 'number' },
        { key: 'passRate', label: 'Pass Rate %', type: 'number' },
        { key: 'bestClass', label: 'Strongest Class' },
        { key: 'weakestClass', label: 'Weakest Class' }
      ],
      rows,
      summary: [
        { label: 'Results for', value: basis.label },
        { label: 'Subjects', value: rows.length },
        { label: 'Best Subject', value: rows[0] ? `${rows[0].subject} (${rows[0].average}%)` : '—' },
        { label: 'Weakest Subject', value: rows.length ? `${rows.at(-1).subject} (${rows.at(-1).average}%)` : '—' },
        { label: 'Pass Mark', value: `${PASS_PERCENT}%` }
      ],
      chart: { type: 'bar', x: 'subject', series: ['average', 'passRate'] }
    };
  }
});

// ============================================================
// Comparison between two exams
// ============================================================

const COMPARE_BY = {
  key: 'compare_by',
  label: 'Compare',
  type: 'select',
  default: 'subjects',
  options: [
    { value: 'subjects', label: 'Class averages by subject' },
    { value: 'students', label: 'Each student' }
  ]
};

const change = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : round1(b - a));
const trend = (diff) => (diff === null ? '—' : diff > 0 ? 'Improved' : diff < 0 ? 'Dropped' : 'Same');

const examComparison = officeAndTeacher({
  id: 'results-exam-comparison',
  teacherId: 'teaching-exam-comparison',
  title: 'Compare two exams',
  description: "How a class did in one exam compared with another: each subject's average, or each student's change",
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [
    { ...FILTERS.exam, label: 'First exam' },
    { ...FILTERS.examB, label: 'Second exam' },
    FILTERS.class,
    FILTERS.section,
    COMPARE_BY
  ],
  run: async (filters, { user }) => {
    if (!isId(filters.exam_id) || !isId(filters.exam_b_id)) throw new ReportError('Choose the two exams to compare.', 400);
    if (sameId(filters.exam_id, filters.exam_b_id)) throw new ReportError('Choose two different exams.', 400);
    const scope = await classScopeFor(user, filters);
    if (scope.restricted && !scope.classIds.length) return NO_CLASSES_RESULT;

    const first = await resolveBasis(filters, 'exam_id');
    const second = await resolveBasis(filters, 'exam_b_id');
    const firstClasses = await resolveClasses(first, scope, {});
    const secondIds = new Set((await resolveClasses(second, scope, {})).map((c) => String(c._id)));
    let classes = firstClasses.filter((c) => secondIds.has(String(c._id)));
    if (filters.class_id) classes = classes.filter((c) => sameId(c._id, filters.class_id));

    const [setA, setB] = await Promise.all([
      loadResults(first, classes, filters.section_id),
      loadResults(second, classes, filters.section_id)
    ]);
    const bySubjectAvg = (results) => new Map(results.subjects.map((s) => {
      const p = results.students.map((r) => r.subjects[s._id]?.percent).filter((v) => v !== null && v !== undefined);
      return [String(s._id), { name: s.name, average: avg(p) }];
    }));

    const rows = [];
    const byStudents = filters.compare_by === 'students';
    classes.forEach((cls, i) => {
      const a = setA[i].results;
      const b = setB[i].results;
      if (byStudents) {
        const bRows = new Map(b.students.map((r) => [String(r.student._id), r]));
        for (const ra of a.students) {
          const rb = bRows.get(String(ra.student._id));
          if (ra.percent === null && (!rb || rb.percent === null)) continue;
          const diff = change(ra.percent, rb?.percent ?? null);
          rows.push({
            className: cls.cl_name,
            rollNo: ra.student.admissionNumber ?? '—',
            name: ra.student.name,
            first: ra.percent,
            firstPosition: ra.position ?? '',
            second: rb?.percent ?? null,
            secondPosition: rb?.position ?? '',
            change: diff,
            trend: trend(diff)
          });
        }
      } else {
        const avgA = bySubjectAvg(a);
        const avgB = bySubjectAvg(b);
        for (const [id, sa] of avgA) {
          const sb = avgB.get(id);
          if (sa.average === null && (!sb || sb.average === null)) continue;
          const diff = change(sa.average, sb?.average ?? null);
          rows.push({ className: cls.cl_name, subject: sa.name, first: sa.average, second: sb?.average ?? null, change: diff, trend: trend(diff) });
        }
        const diff = change(a.summary.average, b.summary.average);
        if (a.summary.average !== null || b.summary.average !== null) {
          rows.push({ className: cls.cl_name, subject: 'All subjects', first: a.summary.average, second: b.summary.average, change: diff, trend: trend(diff) });
        }
      }
    });

    const firstLabel = first.exam.name;
    const secondLabel = second.exam.name;
    const columns = byStudents
      ? [
        { key: 'className', label: 'Class' },
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'first', label: `${firstLabel} %`, type: 'number' },
        { key: 'firstPosition', label: `${firstLabel} Position`, type: 'number' },
        { key: 'second', label: `${secondLabel} %`, type: 'number' },
        { key: 'secondPosition', label: `${secondLabel} Position`, type: 'number' },
        { key: 'change', label: 'Change (points)', type: 'number' },
        { key: 'trend', label: 'Trend' }
      ]
      : [
        { key: 'className', label: 'Class' },
        { key: 'subject', label: 'Subject' },
        { key: 'first', label: `${firstLabel} Average %`, type: 'number' },
        { key: 'second', label: `${secondLabel} Average %`, type: 'number' },
        { key: 'change', label: 'Change (points)', type: 'number' },
        { key: 'trend', label: 'Trend' }
      ];

    return {
      columns,
      rows,
      summary: [
        { label: 'First Exam', value: first.label },
        { label: 'Second Exam', value: second.label },
        { label: 'Improved', value: rows.filter((r) => r.trend === 'Improved').length },
        { label: 'Dropped', value: rows.filter((r) => r.trend === 'Dropped').length }
      ]
    };
  }
});

// ============================================================
// Top students and students who need help
// ============================================================

/** Every marked student across the covered classes, with their class. */
const allStudents = (sets) => sets.flatMap(({ cls, results }) =>
  results.students.map((r) => ({ ...r, className: cls.cl_name, subjectsList: results.subjects })));

const topStudents = officeAndTeacher({
  id: 'results-top-students',
  teacherId: 'teaching-top-students',
  title: 'Top students',
  teacherTitle: 'Top students in my classes',
  description: 'The best students by average for an exam or term — across the school or in one class',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.term, FILTERS.examOptional, FILTERS.class, FILTERS.section, FILTERS.limit],
  run: async (filters, { user }) => {
    const prepared = await prepare(filters, user);
    if (prepared.empty) return prepared.empty;
    const { basis, sets } = prepared;
    const limit = Math.max(1, Math.min(intFilter(filters.limit, 10), 500));

    const marked = allStudents(sets).filter((r) => r.percent !== null);
    const ranks = rankByPercent(marked.map((r) => ({ key: String(r.student._id), percent: r.percent })));
    const rows = marked
      .map((r) => ({
        rank: ranks.get(String(r.student._id)),
        rollNo: r.student.admissionNumber ?? '—',
        name: r.student.name,
        className: r.className,
        section: r.student.section ?? '—',
        percent: r.percent,
        grade: r.grade?.grade ?? '',
        classPosition: r.position ?? ''
      }))
      .sort((a, b) => a.rank - b.rank)
      .filter((r) => r.rank <= limit);

    return {
      columns: [
        { key: 'rank', label: 'Rank', type: 'number' },
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'className', label: 'Class' },
        { key: 'section', label: 'Section' },
        { key: 'percent', label: 'Average %', type: 'number' },
        { key: 'grade', label: 'Grade' },
        { key: 'classPosition', label: 'Position in Class', type: 'number' }
      ],
      rows,
      summary: [
        { label: 'Results for', value: basis.label },
        { label: 'Showing Top', value: limit },
        { label: 'Students Ranked', value: marked.length }
      ]
    };
  }
});

const needHelp = officeAndTeacher({
  id: 'results-need-help',
  teacherId: 'teaching-need-help',
  title: 'Students who need help',
  teacherTitle: 'Students in my classes who need help',
  description: 'Students whose average is below the pass mark, or who failed several subjects',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.term, FILTERS.examOptional, FILTERS.class, FILTERS.section, FILTERS.passMark, FILTERS.minFails],
  run: async (filters, { user }) => {
    const prepared = await prepare(filters, user);
    if (prepared.empty) return prepared.empty;
    const { basis, sets } = prepared;
    const passMark = numberFilter(filters.pass_mark, PASS_PERCENT);
    const minFails = Math.max(1, intFilter(filters.min_fails, 2));

    const rows = allStudents(sets)
      .filter((r) => r.percent !== null)
      .map((r) => {
        const failed = r.subjectsList
          .filter((s) => {
            const p = r.subjects[s._id]?.percent;
            return p !== null && p !== undefined && p < passMark;
          })
          .map((s) => s.name);
        const lowAverage = r.percent < passMark;
        const manyFails = failed.length >= minFails;
        return {
          rollNo: r.student.admissionNumber ?? '—',
          name: r.student.name,
          className: r.className,
          section: r.student.section ?? '—',
          percent: r.percent,
          grade: gradeFor(r.percent)?.grade ?? '',
          failedCount: failed.length,
          failedSubjects: failed.join(', ') || '—',
          reason: [lowAverage && 'Average below pass mark', manyFails && `Failed ${failed.length} subjects`].filter(Boolean).join('; '),
          include: lowAverage || manyFails
        };
      })
      .filter((r) => r.include)
      .map(({ include: _include, ...r }) => r)
      .sort((a, b) => a.percent - b.percent);

    return {
      columns: [
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'className', label: 'Class' },
        { key: 'section', label: 'Section' },
        { key: 'percent', label: 'Average %', type: 'number' },
        { key: 'grade', label: 'Grade' },
        { key: 'failedCount', label: 'Subjects Failed', type: 'number' },
        { key: 'failedSubjects', label: 'Failed Subjects' },
        { key: 'reason', label: 'Why Listed' }
      ],
      rows,
      summary: [
        { label: 'Results for', value: basis.label },
        { label: 'Students Listed', value: rows.length },
        { label: 'Pass Mark', value: `${passMark}%` },
        { label: 'Failed Subjects (at least)', value: minFails }
      ]
    };
  }
});

export const resultsReports = [
  ...classResults,
  ...resultsByClass,
  ...schoolSummary,
  ...reportCard,
  ...subjectPerformance,
  ...examComparison,
  ...topStudents,
  ...needHelp
];
