import Student from '../models/Student.js';
import StudentClass from '../models/StudentClass.js';
import '../models/Guardian.js';
import {
  FILTERS,
  NO_CLASSES_RESULT,
  OFFICE_ROLES,
  classScopeFor,
  fullName,
  officeAndTeacher
} from './helpers.js';

/**
 * Students and their parents: class lists with parent contacts, and students
 * with no parent linked.
 *
 * A student's parent can live in two places: the linked guardian record
 * (Student.guardians -> Guardian, which is also the parent's portal account)
 * and the parent name/phone typed on the student form. The linked guardian is
 * preferred; the typed details are the fallback.
 */

const STUDENT_FIELDS =
  'firstName lastName admissionNumber classId sectionId gender status phoneNumber parentName parentPhoneNumber guardians';

/** Students in scope for the user, optionally for a past academic year. */
const findScopedStudents = async (filters, user, extra = {}) => {
  const scope = await classScopeFor(user, filters);
  if (scope.restricted && !scope.classIds.length) return null;

  const query = { isDeleted: { $ne: true }, ...extra };
  if (filters.gender === 'Male' || filters.gender === 'Female') query.gender = filters.gender;

  if (filters.year_id) {
    // Who was in the class that year (the enrolment ledger), not who is in it today.
    const ledger = { year: filters.year_id };
    if (scope.classIds) ledger.class = { $in: scope.classIds };
    if (filters.section_id) ledger.section = filters.section_id;
    query._id = { $in: await StudentClass.distinct('student', ledger) };
  } else {
    if (scope.classIds) query.classId = { $in: scope.classIds };
    if (filters.section_id) query.sectionId = filters.section_id;
  }

  return Student.find(query)
    .select(STUDENT_FIELDS)
    .populate('classId', 'cl_name')
    .populate('sectionId', 'name')
    .populate('guardians.guardianId', 'name phone relationship email')
    .lean();
};

const primaryGuardian = (s) => {
  const links = s.guardians ?? [];
  return (links.find((g) => g.isPrimary) ?? links[0])?.guardianId ?? null;
};

const byClassThenName = (a, b) =>
  a.className.localeCompare(b.className, undefined, { numeric: true })
  || a.sectionName.localeCompare(b.sectionName)
  || a.name.localeCompare(b.name);

const contactList = officeAndTeacher({
  id: 'students-contact-list',
  teacherId: 'teaching-student-contacts',
  title: 'Student list with parent contacts',
  teacherTitle: 'My students with parent contacts',
  description: 'Students by class, section and gender, with the parent name and phone number',
  group: 'Students',
  teacherGroup: 'Classes & students',
  filters: [FILTERS.class, FILTERS.section, FILTERS.gender, FILTERS.year],
  run: async (filters, { user }) => {
    const students = await findScopedStudents(filters, user);
    if (!students) return NO_CLASSES_RESULT;

    const rows = students.map((s) => {
      const guardian = primaryGuardian(s);
      return {
        rollNo: s.admissionNumber,
        name: fullName(s),
        className: s.classId?.cl_name ?? '—',
        sectionName: s.sectionId?.name ?? '—',
        gender: s.gender ?? '—',
        status: s.status ?? '—',
        parentName: guardian?.name || s.parentName || '—',
        relationship: guardian?.relationship ?? '—',
        parentPhone: guardian?.phone || s.parentPhoneNumber || '—',
        studentPhone: s.phoneNumber || '—'
      };
    }).sort(byClassThenName);

    return {
      columns: [
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'gender', label: 'Gender' },
        { key: 'status', label: 'Status' },
        { key: 'parentName', label: 'Parent' },
        { key: 'relationship', label: 'Relationship' },
        { key: 'parentPhone', label: 'Parent Phone' },
        { key: 'studentPhone', label: 'Student Phone' }
      ],
      rows,
      summary: [
        { label: 'Students', value: rows.length },
        { label: 'Male', value: rows.filter((r) => r.gender === 'Male').length },
        { label: 'Female', value: rows.filter((r) => r.gender === 'Female').length }
      ]
    };
  }
});

const noParent = {
  id: 'students-no-parent',
  title: 'Students with no parent linked',
  description: 'Students with no parent account linked, or no parent phone number, so the office can complete their records',
  group: 'Students',
  department: 'academic',
  roles: OFFICE_ROLES,
  filters: [FILTERS.class, FILTERS.section],
  run: async (filters, { user }) => {
    const students = await findScopedStudents(filters, user);

    const rows = students
      .map((s) => {
        const guardian = primaryGuardian(s);
        const phone = (guardian?.phone || s.parentPhoneNumber || '').trim();
        const missing = [
          !guardian && 'No parent account linked',
          !phone && 'No parent phone'
        ].filter(Boolean);
        return {
          rollNo: s.admissionNumber,
          name: fullName(s),
          className: s.classId?.cl_name ?? '—',
          sectionName: s.sectionId?.name ?? '—',
          parentName: guardian?.name || s.parentName || '—',
          parentPhone: phone || '—',
          missing: missing.join('; '),
          noLink: !guardian,
          noPhone: !phone
        };
      })
      .filter((r) => r.missing)
      .sort(byClassThenName);

    return {
      columns: [
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'parentName', label: 'Parent Name on Form' },
        { key: 'parentPhone', label: 'Parent Phone' },
        { key: 'missing', label: "What's Missing" }
      ],
      rows: rows.map(({ noLink: _noLink, noPhone: _noPhone, ...r }) => r),
      summary: [
        { label: 'Students Listed', value: rows.length },
        { label: 'No Parent Account', value: rows.filter((r) => r.noLink).length },
        { label: 'No Parent Phone', value: rows.filter((r) => r.noPhone).length },
        { label: 'Students Checked', value: students.length }
      ]
    };
  }
};

export const peopleReports = [...contactList, noParent];
