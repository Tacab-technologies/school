import mongoose from 'mongoose';
import Student from '../models/Student.js';
import StudentClass from '../models/StudentClass.js';
import { resolveCurrentYearId } from './currentYear.js';

// Headcounts follow the enrolment ledger (StudentClass), one school year at a
// time, by the same rule as the student list: a student counts in a year if
// they are enrolled in it, and a student with no enrolment at all counts in the
// current year. Student.classId alone can't be used: it still points at last
// year's class until the student is promoted.

/** A yearId from a query string, or null to mean the current year. */
export const queryYearId = (value) => (mongoose.isValidObjectId(value) ? String(value) : null);

const yearInQuestion = async (yearId) => {
  const current = await resolveCurrentYearId();
  const year = yearId ? String(yearId) : current;
  return { year, isCurrent: String(year ?? '') === String(current ?? '') };
};

// A row written before enrolments stored the section has none; the student's
// own section stands in, but only while they are still in that class.
const sectionOf = (enrolment, student) =>
  enrolment.section ?? (String(enrolment.class) === String(student.classId) ? student.sectionId : null);

/**
 * How many active students sit in each class and section in a school year (the
 * current year if none is given), counted in one pass. Used by the class and
 * section lists, the student form and the import check. `enrolledOnly` leaves
 * out students with no enrolment yet.
 */
export const activeStudentCounts = async (yearId = null, { enrolledOnly = false } = {}) => {
  const { year, isCurrent } = await yearInQuestion(yearId);
  const [students, enrolments, everEnrolled] = await Promise.all([
    Student.find({ isDeleted: false, status: 'Active' }).select('classId sectionId').lean(),
    year ? StudentClass.find({ year }).select('student class section').lean() : [],
    isCurrent ? StudentClass.distinct('student') : [],
  ]);
  const enrolmentOf = new Map(enrolments.map((row) => [String(row.student), row]));
  const hasEnrolment = new Set(everEnrolled.map(String));

  const byClass = new Map();
  const bySection = new Map();
  const add = (map, id) => { if (id) map.set(String(id), (map.get(String(id)) ?? 0) + 1); };
  for (const student of students) {
    const enrolment = enrolmentOf.get(String(student._id));
    if (enrolment) {
      add(byClass, enrolment.class);
      add(bySection, sectionOf(enrolment, student));
    } else if (isCurrent && !enrolledOnly && !hasEnrolment.has(String(student._id))) {
      add(byClass, student.classId);
      add(bySection, student.sectionId);
    }
  }
  return { byClass, bySection };
};

/**
 * Active students in one section in a school year (the current year if none is
 * given), optionally not counting one student (who is moving in).
 */
export const sectionHeadcount = async (section, { yearId = null, exceptStudentId = null, session = null } = {}) => {
  const { year, isCurrent } = await yearInQuestion(yearId);
  const enrolments = year
    ? await StudentClass.find({ year, class: section.class }).select('student section').session(session).lean()
    : [];
  const inSection = enrolments.filter((row) => String(row.section) === String(section._id)).map((row) => row.student);
  const noSectionStored = enrolments.filter((row) => !row.section).map((row) => row.student);
  const counted = [{ _id: { $in: inSection } }, { _id: { $in: noSectionStored }, sectionId: section._id }];

  if (isCurrent) {
    const seated = await Student.find({ sectionId: section._id, isDeleted: false, status: 'Active' }).select('_id').session(session).lean();
    const ids = seated.map((student) => student._id);
    const enrolled = new Set((await StudentClass.distinct('student', { student: { $in: ids } }).session(session)).map(String));
    counted.push({ _id: { $in: ids.filter((id) => !enrolled.has(String(id))) } });
  }

  return Student.countDocuments({
    isDeleted: false,
    status: 'Active',
    $or: counted,
    ...(exceptStudentId && { _id: { $ne: exceptStudentId } }),
  }).session(session);
};
