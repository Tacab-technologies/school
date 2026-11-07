import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import Class from '../models/Class.js';
import Section from '../models/Section.js';
import Subject from '../models/Subject.js';
import TeacherAssignment from '../models/TeacherAssignment.js';
import {
  examHasClass, markingProgress, sheetStudents, teacherLessons,
} from '../services/resultService.js';
import { PASS_PERCENT, gradeFor } from '../utils/grading.js';
import { FILTERS, OFFICE_ROLES, ReportError, fullName, round1 } from './helpers.js';

/**
 * Marks and results reports.
 *
 * Teachers (My Classes) get the results of their own lessons and how far
 * their marking has got; the academic office gets marking progress for the
 * whole school, and results per class and per student (resultsReports.js). Teachers are always held to the lessons they teach in the exam's
 * term (resultService.teacherLessons) — a filter can't widen that.
 */

const TEACHER_ROLES = ['teacher'];
const TEACHER_GROUP = 'Marks & results';

const isId = (v) => mongoose.isValidObjectId(v);
const sameId = (a, b) => String(a ?? '') === String(b ?? '');
const pct = (score, max) => (score === null || score === undefined || !max ? null : round1((score / max) * 100));
const avg = (list) => (list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null);
const asPercent = (v) => (v === null || v === undefined ? '—' : `${v}%`);

const loadExam = async (filters) => {
  if (!isId(filters.exam_id)) throw new ReportError('Choose an exam.', 400);
  const exam = await Exam.findById(filters.exam_id).populate('termId', 'name').lean();
  if (!exam) throw new ReportError('Exam not found', 404);
  return { ...exam, termId: exam.termId?._id ?? exam.termId, termName: exam.termId?.name ?? '' };
};

const examLabel = (exam) => `${exam.name}${exam.termName ? ` (${exam.termName})` : ''}`;

const NO_LESSONS = {
  key: 'message',
  label: "You don't teach a class in this exam. Ask the academic office to add you to the timetable for this term."
};

// ============================================================
// Teacher reports (My Classes)
// ============================================================

const myClassResults = {
  id: 'exam-my-class-results',
  title: 'Marks for my subject',
  description: 'Each student\'s mark and grade in one exam, for a class and subject you teach',
  group: TEACHER_GROUP,
  department: 'teaching',
  roles: TEACHER_ROLES,
  filters: [FILTERS.exam, FILTERS.class, FILTERS.section, FILTERS.subject],
  run: async (filters, { user }) => {
    const exam = await loadExam(filters);
    const classId = filters.class_id;
    const subjectId = filters.subject_id;
    if (!isId(classId) || !isId(subjectId)) throw new ReportError('Choose a class and a subject.', 400);
    if (!examHasClass(exam, classId)) throw new ReportError("This class doesn't sit this exam.", 400);
    let sectionId = isId(filters.section_id) ? filters.section_id : null;

    if (user.role === 'teacher') {
      const lessons = (await teacherLessons(user._id, exam.termId))
        .filter((l) => sameId(l.classId, classId) && sameId(l.subjectId, subjectId));
      // One section taught in this class: use it without asking.
      if (!sectionId && lessons.length === 1) sectionId = String(lessons[0].sectionId);
      if (!lessons.length || (sectionId && !lessons.some((l) => sameId(l.sectionId, sectionId)))) {
        throw new ReportError('You can only see results for the classes and subjects you teach.', 403);
      }
      if (!sectionId) throw new ReportError('Choose the section you teach.', 400);
    }

    const { students, marks } = await sheetStudents(exam, { classId, sectionId, subjectId });
    const byStudent = new Map(marks.map((m) => [String(m.studentId), m]));
    const rows = students.map((s, i) => {
      const m = byStudent.get(String(s._id));
      const absent = !!m?.absent;
      const score = absent ? null : m?.score ?? null;
      const percent = absent ? 0 : pct(score, exam.maxMarks);
      const marked = absent || score !== null;
      return {
        no: i + 1,
        rollNo: s.admissionNumber ?? '—',
        name: fullName(s),
        score: absent ? 'Absent' : score ?? '',
        outOf: exam.maxMarks,
        percent: marked ? percent : null,
        grade: marked ? gradeFor(percent)?.grade ?? '' : '',
        status: absent ? 'Absent' : marked ? (percent >= PASS_PERCENT ? 'Pass' : 'Fail') : 'Not marked',
        remark: m?.remark ?? ''
      };
    });

    const percents = rows.filter((r) => r.percent !== null).map((r) => r.percent);
    const scores = rows.filter((r) => typeof r.score === 'number').map((r) => r.score);
    const [cls, section, subject] = await Promise.all([
      Class.findById(classId).select('cl_name').lean(),
      sectionId ? Section.findById(sectionId).select('name').lean() : null,
      Subject.findById(subjectId).select('sub_name').lean()
    ]);

    return {
      columns: [
        { key: 'no', label: '#', type: 'number' },
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'score', label: 'Mark' },
        { key: 'outOf', label: 'Out of', type: 'number' },
        { key: 'percent', label: 'Score %', type: 'number' },
        { key: 'grade', label: 'Grade' },
        { key: 'status', label: 'Result' },
        { key: 'remark', label: 'Remark' }
      ],
      rows,
      summary: [
        { label: 'Exam', value: examLabel(exam) },
        { label: 'Class', value: [cls?.cl_name, section?.name].filter(Boolean).join(' ') || '—' },
        { label: 'Subject', value: subject?.sub_name ?? '—' },
        { label: 'Students', value: rows.length },
        { label: 'Marked', value: percents.length },
        { label: 'Absent', value: rows.filter((r) => r.status === 'Absent').length },
        { label: 'Average', value: asPercent(avg(percents)) },
        { label: 'Highest Mark', value: scores.length ? Math.max(...scores) : '—' },
        { label: 'Lowest Mark', value: scores.length ? Math.min(...scores) : '—' },
        { label: 'Passed', value: rows.filter((r) => r.status === 'Pass').length }
      ]
    };
  }
};

const progressStatus = (r) => (r.students && r.remaining === 0 ? 'Done' : r.marked ? 'In progress' : 'Not started');

const runMarkingProgress = async (filters, { user }) => {
  const exam = await loadExam(filters);
  const isTeacher = user.role === 'teacher';
  const lessons = isTeacher
    ? await teacherLessons(user._id, exam.termId)
    : await TeacherAssignment.find({ termId: exam.termId }).select('teacherId classId sectionId subjectId').lean();
  const rows = (await markingProgress(exam, lessons)).map((r) => ({
    className: r.className,
    sectionName: r.sectionName ?? '—',
    subjectName: r.subjectName,
    teachers: r.teachers || '—',
    students: r.students,
    marked: r.marked,
    remaining: r.remaining,
    status: progressStatus(r)
  }));
  if (!rows.length) return { columns: [NO_LESSONS], rows: [], summary: [] };

  const total = rows.reduce((n, r) => n + r.students, 0);
  const marked = rows.reduce((n, r) => n + r.marked, 0);
  return {
    columns: [
      { key: 'className', label: 'Class' },
      { key: 'sectionName', label: 'Section' },
      { key: 'subjectName', label: 'Subject' },
      ...(isTeacher ? [] : [{ key: 'teachers', label: 'Teacher' }]),
      { key: 'students', label: 'Students', type: 'number' },
      { key: 'marked', label: 'Marked', type: 'number' },
      { key: 'remaining', label: 'Left to Mark', type: 'number' },
      { key: 'status', label: 'Status' }
    ],
    rows,
    summary: [
      { label: 'Exam', value: examLabel(exam) },
      { label: 'Sheets', value: rows.length },
      { label: 'Finished Sheets', value: rows.filter((r) => r.status === 'Done').length },
      { label: 'Marks Entered', value: `${marked} of ${total}` },
      { label: 'Published', value: exam.published ? 'Yes' : 'No' }
    ]
  };
};

const MARKING_DESCRIPTION = 'How many students are marked in each class and subject for an exam, and what is left';

// Teachers see their own lessons; the academic office sees every lesson in
// the exam's term, with the teacher's name, under Academic Office.
const teacherMarkingProgress = {
  id: 'exam-marking-progress',
  title: 'My marking progress',
  description: MARKING_DESCRIPTION,
  group: TEACHER_GROUP,
  department: 'teaching',
  roles: TEACHER_ROLES,
  filters: [FILTERS.exam],
  run: runMarkingProgress
};

const officeMarkingProgress = {
  id: 'results-marking-progress',
  title: 'Marking progress',
  description: `${MARKING_DESCRIPTION}, with the teacher of each`,
  group: 'Exams & Results',
  department: 'academic',
  roles: OFFICE_ROLES,
  filters: [FILTERS.exam],
  run: runMarkingProgress
};

// The academic office's results reports (class results with positions,
// results by class and subject, report cards, ...) live in resultsReports.js,
// where they also cover a whole term and are offered to teachers for their
// own classes.

export const examReports = [myClassResults, teacherMarkingProgress];

/** Listed after the office's results reports (see registry.js). */
export const officeExamReports = [officeMarkingProgress];
