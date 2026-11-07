// Exams and marks.
// The academic office (or an admin) creates the term's exams; teachers enter
// marks for the classes, sections and subjects they teach; publishing an exam
// makes its marks visible to students and parents.
import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import Mark from '../models/Mark.js';
import MarkSheet from '../models/MarkSheet.js';
import ResultHold, { HOLD_REASONS } from '../models/ResultHold.js';
import StudentInvoice from '../models/StudentInvoice.js';
import Term from '../models/Term.js';
import Class from '../models/Class.js';
import Section from '../models/Section.js';
import Subject from '../models/Subject.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import TeacherAssignment from '../models/TeacherAssignment.js';
import AppError from '../utils/AppError.js';
import ApiResponse from '../utils/ApiResponse.js';
import { escapeRegex } from '../utils/query.js';
import {
  buildClassResults, buildReportCard, examHasClass, markingProgress, sheetStudents, teacherLessons, termsWithResults,
} from '../services/resultService.js';
import { classIdsOf } from '../services/subjectService.js';

const isId = (v) => mongoose.isValidObjectId(v);
const sameId = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * A teacher's lessons (class, section, subject) in the given term — the exam's
 * term, or the active term when there is none — or null for staff who can mark
 * anything. Assignments from other terms never count.
 */
const teacherScope = async (req, termId) => {
  if (req.user?.role !== 'teacher') return null;
  return teacherLessons(req.user._id, termId);
};

const teaches = (scope, { classId, sectionId, subjectId }) => scope.some((a) =>
  sameId(a.classId, classId) && (!sectionId || !a.sectionId || sameId(a.sectionId, sectionId)) && (!subjectId || sameId(a.subjectId, subjectId)));

/** The subjects a teacher teaches in a class (and section). */
const taughtSubjects = (scope, { classId, sectionId }) => [...new Set(scope
  .filter((a) => sameId(a.classId, classId) && (!sectionId || !a.sectionId || sameId(a.sectionId, sectionId)))
  .map((a) => String(a.subjectId)))];

/**
 * Whether teachers may enter marks for this exam today: 'open', 'not-yet'
 * (before marksOpenFrom) or 'closed' (after the whole of marksOpenUntil).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const entryWindow = (exam, now = new Date()) => {
  if (exam.marksOpenFrom && now < new Date(exam.marksOpenFrom)) return 'not-yet';
  if (exam.marksOpenUntil && now >= new Date(new Date(exam.marksOpenUntil).getTime() + DAY_MS)) return 'closed';
  return 'open';
};
const dayText = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const isMarkedMark = (m) => !!m && (m.score !== null || m.absent);

/** The saved state of one mark sheet; a sheet nobody saved on yet is a draft. */
const sheetState = (sheet) => ({
  status: sheet?.status ?? 'draft',
  unlocked: !!sheet?.unlocked,
  submittedAt: sheet?.submittedAt ?? null,
  editRequest: sheet?.editRequest ? {
    status: sheet.editRequest.status,
    reason: sheet.editRequest.reason,
    requestedAt: sheet.editRequest.requestedAt,
    note: sheet.editRequest.note,
  } : null,
});

const findSheet = ({ exam, classId, sectionId, subjectId }) =>
  MarkSheet.findOne({ examId: exam._id, classId, sectionId: sectionId || null, subjectId });


/** One exam per name per term ("Midterm" and "midterm" count as the same). */
const assertNameFree = async ({ name, termId }, exceptId = null) => {
  const taken = await Exam.exists({ termId, name: new RegExp(`^${escapeRegex(name)}$`, 'i'), ...(exceptId && { _id: { $ne: exceptId } }) });
  if (taken) throw new AppError('This term already has an exam with that name.', 409);
};

const examInput = async (body) => {
  const name = String(body.name ?? '').trim();
  if (name.length < 2) throw new AppError('Give the exam a name, e.g. "Midterm".', 400);
  if (!isId(body.termId)) throw new AppError('Choose the term this exam belongs to.', 400);
  const term = await Term.findById(body.termId).select('academicYearId').lean();
  if (!term) throw new AppError('Term not found', 404);
  const maxMarks = Number(body.maxMarks ?? 100);
  if (!Number.isFinite(maxMarks) || maxMarks < 1 || maxMarks > 1000) throw new AppError('Out of must be between 1 and 1000.', 400);
  const classIds = Array.isArray(body.classIds) ? body.classIds.filter(isId) : [];
  const day = (v) => (v ? new Date(v) : null);
  const marksOpenFrom = day(body.marksOpenFrom);
  const marksOpenUntil = day(body.marksOpenUntil);
  if ([marksOpenFrom, marksOpenUntil].some((d) => d && Number.isNaN(d.getTime()))) throw new AppError('Pick valid dates for entering marks.', 400);
  if (marksOpenFrom && marksOpenUntil && marksOpenFrom > marksOpenUntil) throw new AppError('Marks entry must open before it closes.', 400);
  return { name, termId: body.termId, yearId: term.academicYearId, maxMarks, date: body.date ? new Date(body.date) : null, classIds, marksOpenFrom, marksOpenUntil };
};

// GET /api/exams?termId=&yearId=
export const listExams = async (req, res, next) => {
  try {
    const filter = {};
    if (isId(req.query.termId)) filter.termId = req.query.termId;
    if (isId(req.query.yearId)) filter.yearId = req.query.yearId;
    let exams = await Exam.find(filter)
      .populate({ path: 'termId', select: 'name academicYearId', populate: { path: 'academicYearId', select: 'y_name' } })
      .populate('classIds', 'cl_name')
      .sort({ date: -1, createdAt: -1 })
      .lean();
    // A teacher only sees exams with at least one class they teach in that exam's term.
    if (req.user?.role === 'teacher') {
      const teacher = await Teacher.findOne({ userId: req.user._id }).select('_id').lean();
      const lessons = teacher ? await TeacherAssignment.find({ teacherId: teacher._id }).select('termId classId').lean() : [];
      exams = exams.filter((e) => lessons.some((l) => sameId(l.termId, e.termId?._id)
        && (!e.classIds?.length || e.classIds.some((c) => sameId(c._id, l.classId)))));
    }
    const counts = await Mark.aggregate([
      { $match: { examId: { $in: exams.map((e) => e._id) }, $or: [{ score: { $ne: null } }, { absent: true }] } },
      { $group: { _id: '$examId', marks: { $sum: 1 }, students: { $addToSet: '$studentId' } } },
    ]);
    const byExam = new Map(counts.map((c) => [String(c._id), { marks: c.marks, students: c.students.length }]));
    // How many mark sheets teachers have submitted, and edit requests waiting.
    const sheets = await MarkSheet.aggregate([
      { $match: { examId: { $in: exams.map((e) => e._id) } } },
      { $group: {
        _id: '$examId',
        submitted: { $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] } },
        requests: { $sum: { $cond: [{ $eq: ['$editRequest.status', 'pending'] }, 1, 0] } },
      } },
    ]);
    const sheetsByExam = new Map(sheets.map((c) => [String(c._id), { submitted: c.submitted, requests: c.requests }]));
    const holds = await ResultHold.aggregate([
      { $match: { examId: { $in: exams.map((e) => e._id) } } },
      { $group: { _id: '$examId', n: { $sum: 1 } } },
    ]);
    const heldByExam = new Map(holds.map((h) => [String(h._id), h.n]));
    const termIds = [...new Set(exams.map((e) => String(e.termId?._id ?? e.termId)))];
    const lessons = await TeacherAssignment.find({ termId: { $in: termIds } }).select('termId classId sectionId subjectId').lean();
    const lessonCount = (e) => new Set(lessons
      .filter((l) => sameId(l.termId, e.termId?._id) && examHasClass({ classIds: (e.classIds ?? []).map((k) => k._id ?? k) }, l.classId))
      .map((l) => `${l.classId}:${l.sectionId ?? ''}:${l.subjectId}`)).size;
    res.status(200).json(new ApiResponse(200, exams.map((e) => ({
      ...e,
      term: e.termId ? { _id: e.termId._id, name: e.termId.name, year: e.termId.academicYearId?.y_name ?? null } : null,
      termId: e.termId?._id ?? null,
      classes: (e.classIds ?? []).map((c) => ({ _id: c._id, name: c.cl_name })),
      classIds: (e.classIds ?? []).map((c) => c._id),
      progress: byExam.get(String(e._id)) ?? { marks: 0, students: 0 },
      sheets: { total: lessonCount(e), ...(sheetsByExam.get(String(e._id)) ?? { submitted: 0, requests: 0 }) },
      window: entryWindow(e),
      held: heldByExam.get(String(e._id)) ?? 0,
    })), 'Exams retrieved'));
  } catch (error) {
    next(error);
  }
};

// POST /api/exams
export const createExam = async (req, res, next) => {
  try {
    const input = await examInput(req.body);
    await assertNameFree(input);
    const exam = await Exam.create({ ...input, createdBy: req.user?._id ?? null });
    res.status(201).json(new ApiResponse(201, exam, 'Exam created'));
  } catch (error) {
    if (error.code === 11000) return next(new AppError('This term already has an exam with that name.', 409));
    next(error);
  }
};

// PUT /api/exams/:id
export const updateExam = async (req, res, next) => {
  try {
    const input = await examInput(req.body);
    await assertNameFree(input, req.params.id);
    const highest = await Mark.findOne({ examId: req.params.id, score: { $gt: input.maxMarks } }).select('score').lean();
    if (highest) throw new AppError(`A mark of ${highest.score} is already entered, so "out of" can't be lower than that.`, 409);
    const exam = await Exam.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
    if (!exam) throw new AppError('Exam not found', 404);
    res.status(200).json(new ApiResponse(200, exam, 'Exam updated'));
  } catch (error) {
    if (error.code === 11000) return next(new AppError('This term already has an exam with that name.', 409));
    next(error);
  }
};

// DELETE /api/exams/:id — refused once marks are entered, so no results are lost by accident.
export const deleteExam = async (req, res, next) => {
  try {
    const marked = await Mark.countDocuments({ examId: req.params.id, $or: [{ score: { $ne: null } }, { absent: true }] });
    if (marked) throw new AppError(`${marked} mark${marked === 1 ? ' is' : 's are'} already entered for this exam. Clear them first if you really want to delete it.`, 409);
    const exam = await Exam.findByIdAndDelete(req.params.id);
    if (!exam) throw new AppError('Exam not found', 404);
    await Mark.deleteMany({ examId: exam._id });
    res.status(200).json(new ApiResponse(200, null, 'Exam deleted'));
  } catch (error) {
    next(error);
  }
};

// PATCH /api/exams/:id/publish  { published: boolean }
export const setPublished = async (req, res, next) => {
  try {
    const published = req.body.published !== false;
    const exam = await Exam.findByIdAndUpdate(req.params.id, { published, publishedAt: published ? new Date() : null }, { new: true });
    if (!exam) throw new AppError('Exam not found', 404);
    res.status(200).json(new ApiResponse(200, exam, published ? 'Results published' : 'Results hidden from students and parents'));
  } catch (error) {
    next(error);
  }
};

// GET /api/exams/:id/options — the classes, sections and subjects this user can mark.
export const markingOptions = async (req, res, next) => {
  try {
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) throw new AppError('Exam not found', 404);
    const scope = await teacherScope(req, exam.termId);
    const examClasses = exam.classIds?.length ? exam.classIds.map(String) : null;
    const inExam = (classId) => !examClasses || examClasses.includes(String(classId));

    let classes;
    let sections;
    let subjects;
    if (scope) {
      const own = scope.filter((a) => inExam(a.classId));
      [classes, sections, subjects] = await Promise.all([
        Class.find({ _id: { $in: own.map((a) => a.classId) } }).select('cl_name').sort({ cl_name: 1 }).lean(),
        Section.find({ _id: { $in: own.map((a) => a.sectionId) } }).select('name class').sort({ name: 1 }).lean(),
        Subject.find({ _id: { $in: own.map((a) => a.subjectId) } }).select('sub_name classId classIds').sort({ sub_name: 1 }).lean(),
      ]);
      // Only the exact pairs the teacher teaches.
      const pairs = own.map((a) => ({ classId: String(a.classId), sectionId: a.sectionId ? String(a.sectionId) : null, subjectId: String(a.subjectId) }));
      return res.status(200).json(new ApiResponse(200, {
        classes: classes.map((c) => ({ _id: c._id, name: c.cl_name })),
        sections: sections.map((s) => ({ _id: s._id, name: s.name, classId: s.class })),
        subjects: subjects.map((s) => ({ _id: s._id, name: s.sub_name, classIds: classIdsOf(s).map(String) })),
        pairs,
        locked: exam.published,
      }, 'Marking options'));
    }
    [classes, sections, subjects] = await Promise.all([
      Class.find(examClasses ? { _id: { $in: examClasses } } : {}).select('cl_name').sort({ cl_name: 1 }).lean(),
      Section.find(examClasses ? { class: { $in: examClasses } } : {}).select('name class').sort({ name: 1 }).lean(),
      Subject.find({ status: 'active' }).select('sub_name classId classIds').sort({ sub_name: 1 }).lean(),
    ]);
    res.status(200).json(new ApiResponse(200, {
      classes: classes.map((c) => ({ _id: c._id, name: c.cl_name })),
      sections: sections.map((s) => ({ _id: s._id, name: s.name, classId: s.class })),
      subjects: subjects.map((s) => ({ _id: s._id, name: s.sub_name, classIds: classIdsOf(s).map(String) })),
      pairs: null,
      locked: false,
    }, 'Marking options'));
  } catch (error) {
    next(error);
  }
};

const readSheetParams = async (req) => {
  const { classId, subjectId } = req.method === 'GET' ? req.query : req.body;
  const sectionId = (req.method === 'GET' ? req.query.sectionId : req.body.sectionId) || null;
  if (!isId(classId) || !isId(subjectId) || (sectionId && !isId(sectionId))) throw new AppError('Choose a class and a subject.', 400);
  const exam = await Exam.findById(req.params.id).lean();
  if (!exam) throw new AppError('Exam not found', 404);
  if (exam.classIds?.length && !exam.classIds.some((c) => sameId(c, classId))) throw new AppError("This class doesn't sit this exam.", 400);
  const sectionCount = await Section.countDocuments({ class: classId });
  if (sectionCount && !sectionId) throw new AppError('Choose a section.', 400);
  if (sectionId && !(await Section.exists({ _id: sectionId, class: classId }))) throw new AppError("That section isn't in this class.", 400);
  const scope = await teacherScope(req, exam.termId);
  if (scope && !teaches(scope, { classId, sectionId, subjectId })) throw new AppError("You can only enter marks for the classes and subjects you teach.", 403);
  return { exam, classId, sectionId, subjectId, scope };
};

// GET /api/exams/:id/marksheet?classId=&sectionId=&subjectId=
export const getMarksheet = async (req, res, next) => {
  try {
    const { exam, classId, sectionId, subjectId, scope } = await readSheetParams(req);
    const [{ students, marks }, sheet] = await Promise.all([
      sheetStudents(exam, { classId, sectionId, subjectId }),
      findSheet({ exam, classId, sectionId, subjectId }).lean(),
    ]);
    const byStudent = new Map(marks.map((m) => [String(m.studentId), m]));
    const state = sheetState(sheet);
    const window = entryWindow(exam);
    // For a teacher: nothing changes once results are published, once the
    // sheet is submitted, or outside the entry dates, unless the office allowed it.
    const sheetLocked = !!scope && (exam.published || (!state.unlocked && (state.status === 'submitted' || window !== 'open')));
    res.status(200).json(new ApiResponse(200, {
      exam: {
        _id: exam._id, name: exam.name, maxMarks: exam.maxMarks, published: exam.published,
        marksOpenFrom: exam.marksOpenFrom ?? null, marksOpenUntil: exam.marksOpenUntil ?? null, window,
      },
      sheet: state,
      locked: sheetLocked,
      rows: students.map((s) => {
        const m = byStudent.get(String(s._id));
        return {
          studentId: s._id,
          name: [s.firstName, s.lastName].filter(Boolean).join(' '),
          admissionNumber: s.admissionNumber,
          noSection: s.noSection,
          score: m?.score ?? null,
          absent: m?.absent ?? false,
          remark: m?.remark ?? '',
        };
      }),
    }, 'Mark sheet'));
  } catch (error) {
    next(error);
  }
};

// PUT /api/exams/:id/marks  { classId, sectionId, subjectId, marks: [{ studentId, score, absent, remark }] }
export const saveMarks = async (req, res, next) => {
  try {
    const { exam, classId, sectionId, subjectId, scope } = await readSheetParams(req);
    if (scope && exam.published) throw new AppError('These results are published. Ask the academic office to unpublish them before changing marks.', 403);
    const sheet = await findSheet({ exam, classId, sectionId, subjectId });
    const allowed = !!sheet?.unlocked;
    if (scope && !allowed) {
      if (sheet?.status === 'submitted') throw new AppError('You submitted this mark sheet. Ask the academic office for permission to change it.', 403);
      const window = entryWindow(exam);
      if (window === 'not-yet') throw new AppError(`Marks entry for ${exam.name} opens on ${dayText(exam.marksOpenFrom)}.`, 403);
      if (window === 'closed') throw new AppError(`Marks entry for ${exam.name} closed on ${dayText(exam.marksOpenUntil)}. Ask the academic office for permission.`, 403);
    }
    const entries = Array.isArray(req.body.marks) ? req.body.marks : [];
    if (!entries.length) throw new AppError('Nothing to save.', 400);

    const { students } = await sheetStudents(exam, { classId, sectionId, subjectId });
    const onSheet = new Map(students.map((s) => [String(s._id), s]));
    const ops = [];
    for (const entry of entries) {
      const student = onSheet.get(String(entry.studentId));
      if (!student) throw new AppError('A student on this sheet is not in this class.', 400);
      const absent = entry.absent === true;
      let score = entry.score === '' || entry.score === undefined ? null : entry.score;
      if (absent) score = null;
      if (score !== null) {
        score = Number(score);
        if (!Number.isFinite(score) || score < 0 || score > exam.maxMarks) {
          throw new AppError(`Marks must be between 0 and ${exam.maxMarks}.`, 400);
        }
        score = Math.round(score * 100) / 100;
      }
      const remark = String(entry.remark ?? '').slice(0, 200);
      ops.push({
        updateOne: {
          filter: { examId: exam._id, studentId: entry.studentId, subjectId },
          update: {
            $set: { classId, sectionId: student.noSection ? null : sectionId, score, absent, remark, enteredBy: req.user?._id ?? null },
          },
          upsert: true,
        },
      });
    }
    await Mark.bulkWrite(ops);
    res.status(200).json(new ApiResponse(200, { saved: ops.length }, `${ops.length} mark${ops.length === 1 ? '' : 's'} saved as a draft`));
  } catch (error) {
    next(error);
  }
};

// GET /api/exams/results?termId=&classId=&sectionId=
export const getClassResults = async (req, res, next) => {
  try {
    const { termId, classId } = req.query;
    const sectionId = req.query.sectionId || undefined;
    if (!isId(termId) || !isId(classId) || (sectionId && !isId(sectionId))) throw new AppError('Choose a term and a class.', 400);
    const scope = await teacherScope(req, termId);
    if (scope && !teaches(scope, { classId, sectionId })) throw new AppError('You can only see results for the classes you teach.', 403);
    // The whole class only for a teacher who teaches all of its sections.
    if (scope && !sectionId) {
      const sections = await Section.find({ class: classId }).select('_id').lean();
      if (sections.some((s) => !teaches(scope, { classId, sectionId: s._id }))) throw new AppError('Choose the section you teach.', 403);
    }
    // A teacher only sees the subjects they teach in this class, never their colleagues' marks.
    const subjectIds = scope ? taughtSubjects(scope, { classId, sectionId }) : null;
    res.status(200).json(new ApiResponse(200, { ...(await buildClassResults({ termId, classId, sectionId, subjectIds })), ownSubjectsOnly: !!scope }, 'Class results'));
  } catch (error) {
    next(error);
  }
};

// GET /api/exams/report-card/:studentId?termId=
export const getReportCard = async (req, res, next) => {
  try {
    if (!isId(req.params.studentId)) throw new AppError('Student not found', 404);
    let termId = isId(req.query.termId) ? req.query.termId : undefined;
    if (req.user?.role === 'teacher') {
      // Check the teacher against the term the card will show (the newest with results).
      if (!termId) termId = (await termsWithResults(req.params.studentId))[0]?._id;
      const student = await Student.findById(req.params.studentId).select('classId sectionId').lean();
      const scope = await teacherScope(req, termId);
      if (!student || !teaches(scope, { classId: student.classId, sectionId: student.sectionId })) {
        throw new AppError("You can only see report cards for the classes you teach.", 403);
      }
    }
    const subjectIdsFor = req.user?.role === 'teacher'
      ? async (term, classId, sectionId) => taughtSubjects(await teacherScope(req, term), { classId, sectionId })
      : null;
    res.status(200).json(new ApiResponse(200, await buildReportCard(req.params.studentId, termId, { subjectIdsFor }), 'Report card'));
  } catch (error) {
    next(error);
  }
};

// GET /api/exams/teaching?termId= — the classes and sections a teacher teaches in
// a term (the active term by default), for the Results tab. null for staff.
export const teachingClasses = async (req, res, next) => {
  try {
    const termId = isId(req.query.termId) ? req.query.termId : undefined;
    const scope = await teacherScope(req, termId);
    if (!scope) return res.status(200).json(new ApiResponse(200, { pairs: null }, 'All classes'));
    const seen = new Set();
    const pairs = [];
    for (const a of scope) {
      const key = `${a.classId}:${a.sectionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ classId: String(a.classId), sectionId: String(a.sectionId) });
    }
    res.status(200).json(new ApiResponse(200, { pairs }, 'Your classes'));
  } catch (error) {
    next(error);
  }
};

// GET /api/exams/:id/progress — marked vs total for each lesson in this exam:
// a teacher's own lessons, or every assigned lesson for the office.
export const getMarkingProgress = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new AppError('Exam not found', 404);
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) throw new AppError('Exam not found', 404);
    const scope = await teacherScope(req, exam.termId);
    const lessons = scope ?? await TeacherAssignment.find({ termId: exam.termId }).select('teacherId classId sectionId subjectId').lean();
    const rows = await markingProgress(exam, lessons.filter((l) => examHasClass(exam, l.classId)));
    res.status(200).json(new ApiResponse(200, { locked: !!scope && exam.published, published: exam.published, rows }, 'Marking progress'));
  } catch (error) {
    next(error);
  }
};

// POST /api/exams/:id/sheet/submit  { classId, sectionId, subjectId }
// Final: every student needs a mark or Absent, and the sheet then locks.
export const submitSheet = async (req, res, next) => {
  try {
    const params = await readSheetParams(req);
    const { exam, scope } = params;
    if (exam.published) throw new AppError('These results are already published.', 409);
    const sheet = await findSheet(params);
    if (scope && !sheet?.unlocked) {
      if (sheet?.status === 'submitted') throw new AppError('This mark sheet is already submitted.', 409);
      if (entryWindow(exam) !== 'open') throw new AppError('Marks entry is closed. Ask the academic office for permission.', 403);
    }
    const { students, marks } = await sheetStudents(exam, params);
    const markedIds = new Set(marks.filter(isMarkedMark).map((m) => String(m.studentId)));
    const blank = students.filter((st) => !markedIds.has(String(st._id)));
    if (!students.length) throw new AppError('There are no students on this sheet.', 400);
    if (blank.length) {
      const names = blank.slice(0, 3).map((st) => `${st.firstName} ${st.lastName}`).join(', ');
      throw new AppError(`Every student needs a mark or Absent. Still blank: ${names}${blank.length > 3 ? ` and ${blank.length - 3} more` : ''}.`, 400);
    }
    const saved = await MarkSheet.findOneAndUpdate(
      { examId: exam._id, classId: params.classId, sectionId: params.sectionId || null, subjectId: params.subjectId },
      { $set: { status: 'submitted', submittedBy: req.user?._id ?? null, submittedAt: new Date(), unlocked: false } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    res.status(200).json(new ApiResponse(200, sheetState(saved), 'Marks submitted to the academic office'));
  } catch (error) {
    next(error);
  }
};

// POST /api/exams/:id/sheet/request-edit  { classId, sectionId, subjectId, reason }
// A teacher asks the office for permission to change a submitted sheet.
export const requestSheetEdit = async (req, res, next) => {
  try {
    const params = await readSheetParams(req);
    const reason = String(req.body.reason ?? '').trim();
    if (reason.length < 3) throw new AppError('Say what needs changing, so the office can decide.', 400);
    const sheet = (await findSheet(params))
      ?? new MarkSheet({ examId: params.exam._id, classId: params.classId, sectionId: params.sectionId || null, subjectId: params.subjectId });
    if (sheet.unlocked) throw new AppError('The office already allowed changes. Change the marks, save, then submit.', 409);
    if (sheet.editRequest?.status === 'pending') throw new AppError('You already asked. The academic office will answer soon.', 409);
    sheet.editRequest = { status: 'pending', reason: reason.slice(0, 300), requestedBy: req.user?._id ?? null, requestedAt: new Date() };
    await sheet.save();
    res.status(200).json(new ApiResponse(200, sheetState(sheet), 'Request sent to the academic office'));
  } catch (error) {
    next(error);
  }
};

// POST /api/exams/:id/sheet/reopen  { classId, sectionId, subjectId }
// The office gives this sheet's teacher permission to change it, until they submit again.
export const reopenSheet = async (req, res, next) => {
  try {
    const params = await readSheetParams(req);
    const sheet = (await findSheet(params))
      ?? new MarkSheet({ examId: params.exam._id, classId: params.classId, sectionId: params.sectionId || null, subjectId: params.subjectId });
    sheet.unlocked = true;
    sheet.status = 'draft';
    if (sheet.editRequest?.status === 'pending') {
      Object.assign(sheet.editRequest, { status: 'approved', decidedBy: req.user?._id ?? null, decidedAt: new Date() });
    }
    await sheet.save();
    res.status(200).json(new ApiResponse(200, sheetState(sheet), 'Sheet opened again for changes'));
  } catch (error) {
    next(error);
  }
};

const personName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ');

// GET /api/exams/edit-requests — teachers waiting for permission to change submitted marks.
export const listEditRequests = async (req, res, next) => {
  try {
    const sheets = await MarkSheet.find({ 'editRequest.status': 'pending' })
      .populate('examId', 'name published')
      .populate('classId', 'cl_name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'sub_name')
      .populate('editRequest.requestedBy', 'firstName lastName')
      .sort({ 'editRequest.requestedAt': 1 })
      .lean();
    res.status(200).json(new ApiResponse(200, sheets.map((s) => ({
      _id: s._id,
      exam: s.examId ? { _id: s.examId._id, name: s.examId.name, published: s.examId.published } : null,
      classId: s.classId?._id ?? null,
      sectionId: s.sectionId?._id ?? null,
      subjectId: s.subjectId?._id ?? null,
      className: s.classId?.cl_name ?? '—',
      sectionName: s.sectionId?.name ?? null,
      subjectName: s.subjectId?.sub_name ?? '—',
      teacher: personName(s.editRequest.requestedBy),
      reason: s.editRequest.reason,
      requestedAt: s.editRequest.requestedAt,
    })), 'Edit requests'));
  } catch (error) {
    next(error);
  }
};

// PATCH /api/exams/edit-requests/:sheetId  { approve: boolean, note }
export const decideEditRequest = async (req, res, next) => {
  try {
    if (!isId(req.params.sheetId)) throw new AppError('Request not found', 404);
    const sheet = await MarkSheet.findById(req.params.sheetId);
    if (!sheet || sheet.editRequest?.status !== 'pending') throw new AppError('This request was already answered.', 409);
    const approve = req.body.approve === true;
    Object.assign(sheet.editRequest, {
      status: approve ? 'approved' : 'rejected',
      decidedBy: req.user?._id ?? null,
      decidedAt: new Date(),
      note: String(req.body.note ?? '').trim().slice(0, 300),
    });
    if (approve) { sheet.unlocked = true; sheet.status = 'draft'; }
    await sheet.save();
    res.status(200).json(new ApiResponse(200, sheetState(sheet), approve ? 'Approved. The teacher can change the marks now.' : 'Request refused. The marks stay as submitted.'));
  } catch (error) {
    next(error);
  }
};

const nameOf = (s) => [s.firstName, s.lastName].filter(Boolean).join(' ');

// GET /api/exams/:id/holds?classId=&sectionId= — the exam's students, whose
// results are hidden and why, and what each owes, so the office can pick.
export const listHolds = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new AppError('Exam not found', 404);
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) throw new AppError('Exam not found', 404);
    const filter = { isDeleted: false, status: 'Active' };
    if (isId(req.query.classId)) filter.classId = req.query.classId;
    else if (exam.classIds?.length) filter.classId = { $in: exam.classIds };
    if (isId(req.query.sectionId)) filter.sectionId = req.query.sectionId;
    const students = await Student.find(filter).select('firstName lastName admissionNumber classId sectionId')
      .populate('classId', 'cl_name').populate('sectionId', 'name').sort({ firstName: 1, lastName: 1 }).lean();
    const ids = students.map((s) => s._id);
    const [holds, owed] = await Promise.all([
      ResultHold.find({ examId: exam._id }).lean(),
      StudentInvoice.aggregate([{ $match: { student: { $in: ids }, status: { $ne: 'Paid' } } }, { $group: { _id: '$student', owed: { $sum: '$balance' } } }]),
    ]);
    const holdOf = new Map(holds.map((h) => [String(h.studentId), h]));
    const owedOf = new Map(owed.map((o) => [String(o._id), o.owed]));
    res.status(200).json(new ApiResponse(200, {
      reasons: HOLD_REASONS,
      students: students.map((s) => {
        const hold = holdOf.get(String(s._id));
        return {
          _id: s._id,
          name: nameOf(s),
          admissionNumber: s.admissionNumber,
          className: s.classId?.cl_name ?? '',
          sectionName: s.sectionId?.name ?? null,
          owes: owedOf.get(String(s._id)) ?? 0,
          hold: hold ? { reason: hold.reason, note: hold.note } : null,
        };
      }),
    }, 'Students'));
  } catch (error) {
    next(error);
  }
};

// PUT /api/exams/:id/holds  { studentIds, hidden: boolean, reason, note }
// Hides these students' results from them and their parents, or shows them
// again. Works before or after publishing; other students aren't affected.
export const setHolds = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new AppError('Exam not found', 404);
    const exam = await Exam.findById(req.params.id).select('_id').lean();
    if (!exam) throw new AppError('Exam not found', 404);
    const studentIds = (Array.isArray(req.body.studentIds) ? req.body.studentIds : []).filter(isId);
    if (!studentIds.length) throw new AppError('Choose at least one student.', 400);
    if (req.body.hidden === false) {
      const { deletedCount } = await ResultHold.deleteMany({ examId: exam._id, studentId: { $in: studentIds } });
      return res.status(200).json(new ApiResponse(200, { changed: deletedCount }, 'Results shown again'));
    }
    const reason = HOLD_REASONS.includes(req.body.reason) ? req.body.reason : 'Other';
    const note = String(req.body.note ?? '').trim().slice(0, 200);
    await ResultHold.bulkWrite(studentIds.map((studentId) => ({
      updateOne: {
        filter: { examId: exam._id, studentId },
        update: { $set: { reason, note, heldBy: req.user?._id ?? null } },
        upsert: true,
      },
    })));
    res.status(200).json(new ApiResponse(200, { changed: studentIds.length }, 'Results hidden'));
  } catch (error) {
    next(error);
  }
};
