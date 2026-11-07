import mongoose from 'mongoose';
import Year from '../models/Year.js';
import Term from '../models/Term.js';
import Class from '../models/Class.js';
import Section from '../models/Section.js';
import Subject from '../models/Subject.js';
import Exam from '../models/Exam.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import FeeType from '../models/FeeType.js';
import PaymentMethod from '../models/PaymentMethod.js';
import { classScopeFor, fullName } from './helpers.js';

/**
 * The choices for the Reports page's filter dropdowns (years, terms, classes,
 * sections, subjects, exams, teachers, students, fee types, payment methods).
 *
 * Served through the report runner rather than each module's own endpoint so
 * that every role that can open the Reports page gets its choices — the
 * module endpoints are gated per role, and a teacher may not be able to list
 * every class. Choices follow the same scope as the reports: a teacher only
 * gets the classes (and their students and exams) they teach.
 *
 * Hidden from the catalogue (`hidden: true`); rows are { kind, value, label, parent }.
 * Pass class_id to also get that class's students.
 */

const isId = (v) => mongoose.isValidObjectId(v);
const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });

export const filterOptionsReport = {
  id: 'report-filter-options',
  title: 'Report filter choices',
  description: 'Choices for the report filters',
  group: 'Internal',
  department: 'academic',
  hidden: true,
  roles: ['admin', 'principal', 'academic_officer', 'teacher', 'accountant'],
  filters: [],
  run: async (filters, { user }) => {
    const isTeacher = user?.role === 'teacher';
    // A teacher with no teacher record gets no classes rather than an error.
    const scope = await classScopeFor(user, {}).catch(() => ({ classIds: [], restricted: true }));
    const classQuery = scope.classIds ? { _id: { $in: scope.classIds } } : {};

    const [years, terms, classes, sections, subjects, exams, teachers, feeTypes, methods] = await Promise.all([
      Year.find().select('y_name').lean(),
      Term.find().populate('academicYearId', 'y_name').sort({ startDate: -1, createdAt: -1 }).lean(),
      Class.find(classQuery).select('cl_name').lean(),
      Section.find(scope.classIds ? { class: { $in: scope.classIds } } : {}).select('name class').lean(),
      Subject.find({ status: 'active' }).select('sub_name').lean(),
      Exam.find().populate('termId', 'name').sort({ date: -1, createdAt: -1 }).lean(),
      isTeacher ? [] : Teacher.find({ status: { $ne: 'Inactive' } }).select('userId staffId').populate('userId', 'firstName lastName username').lean(),
      FeeType.find().select('fee_name').lean(),
      PaymentMethod.find().select('payment_method_name').lean()
    ]);

    const rows = [
      ...years.map((y) => ({ kind: 'year', value: String(y._id), label: y.y_name })).sort(byLabel).reverse(),
      ...terms.map((t) => ({
        kind: 'term',
        value: String(t._id),
        label: `${t.name}${t.academicYearId?.y_name ? ` · ${t.academicYearId.y_name}` : ''}`,
        parent: t.academicYearId?._id ? String(t.academicYearId._id) : null
      })),
      ...classes.map((c) => ({ kind: 'class', value: String(c._id), label: c.cl_name })).sort(byLabel),
      ...sections.map((s) => ({ kind: 'section', value: String(s._id), label: s.name, parent: String(s.class) })).sort(byLabel),
      ...subjects.map((s) => ({ kind: 'subject', value: String(s._id), label: s.sub_name })).sort(byLabel),
      ...exams
        .filter((e) => !scope.classIds || !e.classIds?.length || e.classIds.some((c) => scope.classIds.includes(String(c))))
        .map((e) => ({
          kind: 'exam',
          value: String(e._id),
          label: `${e.name}${e.termId?.name ? ` · ${e.termId.name}` : ''}`,
          parent: e.termId?._id ? String(e.termId._id) : null
        })),
      ...teachers
        .map((t) => ({ kind: 'teacher', value: String(t._id), label: fullName(t.userId) || t.userId?.username || t.staffId }))
        .sort(byLabel),
      ...feeTypes.map((f) => ({ kind: 'fee-type', value: String(f._id), label: f.fee_name })).sort(byLabel),
      ...methods.map((m) => ({ kind: 'payment-method', value: String(m._id), label: m.payment_method_name })).sort(byLabel)
    ];

    // Students only for one class at a time — a whole school is too long a list.
    if (isId(filters.class_id) && (!scope.classIds || scope.classIds.includes(String(filters.class_id)))) {
      const students = await Student.find({ classId: filters.class_id, isDeleted: { $ne: true } })
        .select('firstName lastName admissionNumber sectionId')
        .lean();
      rows.push(...students
        .map((s) => ({
          kind: 'student',
          value: String(s._id),
          label: `${fullName(s)} (${s.admissionNumber})`,
          parent: s.sectionId ? String(s.sectionId) : null
        }))
        .sort(byLabel));
    }

    return {
      columns: [
        { key: 'kind', label: 'Kind' },
        { key: 'value', label: 'Value' },
        { key: 'label', label: 'Label' }
      ],
      rows
    };
  }
};
