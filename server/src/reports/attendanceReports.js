import Student from '../models/Student.js';
import StudentAttendance from '../models/StudentAttendance.js';
import StaffAttendance from '../models/StaffAttendance.js';
import Teacher from '../models/Teacher.js';
import {
  FILTERS,
  NO_CLASSES_RESULT,
  OFFICE_ROLES,
  classScopeFor,
  dateRange,
  dayRange,
  fullName,
  monthRange,
  numberFilter,
  officeAndTeacher,
  percent,
  todayIso
} from './helpers.js';

/**
 * Attendance reports for students (by class, by day and by month, absent and
 * late lists, low attendance) and for teachers (StaffAttendance — the only
 * staff attendance the school records; it is kept per teacher, per day).
 *
 * Student attendance is taken per lesson (period), so a student can have
 * several records on one day. For "how many students were present today" a
 * student counts once per day:
 *   Present  — attended at least one lesson on time
 *   Late     — attended, but was late for a lesson and on time for none
 *   Absent   — marked absent and attended no lesson
 *   Excused  — only excused records that day
 * Rates follow the rest of the app: late counts as attending, excused is left
 * out — attended / (attended + absent).
 */

const OFFICE_GROUP = 'Attendance';
const TEACHER_GROUP = 'Attendance';

const byClassName = (a, b) => a.className.localeCompare(b.className, undefined, { numeric: true })
  || String(a.sectionName ?? '').localeCompare(String(b.sectionName ?? ''));

/** The students a report covers, inside the user's class scope. */
const scopedStudents = async (filters, user) => {
  const scope = await classScopeFor(user, filters);
  if (scope.restricted && !scope.classIds.length) return null;
  const query = { isDeleted: { $ne: true }, status: 'Active' };
  if (scope.classIds) query.classId = { $in: scope.classIds };
  if (filters.section_id) query.sectionId = filters.section_id;
  return Student.find(query)
    .select('firstName lastName admissionNumber classId sectionId parentName parentPhoneNumber')
    .populate('classId', 'cl_name')
    .populate('sectionId', 'name')
    .sort({ admissionNumber: 1 })
    .lean();
};

/** One status per student per day from that day's lesson records. */
const dayStatus = (statuses) => {
  if (statuses.includes('Present')) return 'Present';
  if (statuses.includes('Late')) return 'Late';
  if (statuses.includes('Absent')) return 'Absent';
  return 'Excused';
};

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

/** Map "studentId|YYYY-MM-DD" -> day status. */
const dailyStatuses = (records) => {
  const grouped = new Map();
  for (const r of records) {
    const key = `${r.studentId}|${dayKey(r.att_date)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r.status);
  }
  return new Map([...grouped].map(([key, statuses]) => [key, dayStatus(statuses)]));
};

const classKeyOf = (s) => `${s.classId?._id ?? ''}|${s.sectionId?._id ?? ''}`;

const blankTally = (s) => ({
  className: s.classId?.cl_name ?? '—',
  sectionName: s.sectionId?.name ?? '—',
  students: 0,
  present: 0,
  late: 0,
  absent: 0,
  excused: 0,
  notMarked: 0
});

const rateOf = (t) => percent(t.present + t.late, t.present + t.late + t.absent);

// ============================================================
// Daily attendance by class
// ============================================================

const dailyByClass = officeAndTeacher({
  id: 'attendance-daily-by-class',
  teacherId: 'teaching-attendance-daily-by-class',
  title: 'Daily attendance by class',
  teacherTitle: 'Daily attendance for my classes',
  description: 'For one day: how many students in each class were present, late, absent, excused or not marked',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [{ ...FILTERS.date, label: 'Day', hint: 'Leave empty for today' }, FILTERS.class, FILTERS.section],
  run: async (filters, { user }) => {
    const students = await scopedStudents(filters, user);
    if (!students) return NO_CLASSES_RESULT;
    const { day, range } = dayRange(filters.date);

    const records = await StudentAttendance.find({ studentId: { $in: students.map((s) => s._id) }, att_date: range })
      .select('studentId status att_date')
      .lean();
    const statuses = dailyStatuses(records);

    const byClass = new Map();
    for (const s of students) {
      const key = classKeyOf(s);
      if (!byClass.has(key)) byClass.set(key, blankTally(s));
      const t = byClass.get(key);
      t.students += 1;
      const status = statuses.get(`${s._id}|${day}`);
      if (status === 'Present') t.present += 1;
      else if (status === 'Late') t.late += 1;
      else if (status === 'Absent') t.absent += 1;
      else if (status === 'Excused') t.excused += 1;
      else t.notMarked += 1;
    }

    const rows = [...byClass.values()].map((t) => ({ ...t, rate: rateOf(t) })).sort(byClassName);
    const total = rows.reduce((acc, r) => {
      for (const k of ['students', 'present', 'late', 'absent', 'excused', 'notMarked']) acc[k] += r[k];
      return acc;
    }, { students: 0, present: 0, late: 0, absent: 0, excused: 0, notMarked: 0 });

    return {
      columns: [
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'students', label: 'Students', type: 'number' },
        { key: 'present', label: 'Present', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'excused', label: 'Excused', type: 'number' },
        { key: 'notMarked', label: 'Not Marked', type: 'number' },
        { key: 'rate', label: 'Attendance %', type: 'number' }
      ],
      rows,
      summary: [
        { label: 'Day', value: day },
        { label: 'Students', value: total.students },
        { label: 'Present', value: total.present },
        { label: 'Late', value: total.late },
        { label: 'Absent', value: total.absent },
        { label: 'Not Marked', value: total.notMarked },
        { label: 'Attendance', value: `${rateOf(total)}%` }
      ],
      chart: { type: 'bar', x: 'className', series: ['present', 'late', 'absent'] }
    };
  }
});

// ============================================================
// Monthly attendance by class
// ============================================================

const monthlyByClass = officeAndTeacher({
  id: 'attendance-monthly-by-class',
  teacherId: 'teaching-attendance-monthly-by-class',
  title: 'Monthly attendance by class',
  teacherTitle: 'Monthly attendance for my classes',
  description: 'For one month: the attendance rate of each class, with days recorded and student-days present, late and absent',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [{ ...FILTERS.month, label: 'Month', hint: 'Leave empty for this month' }, FILTERS.class, FILTERS.section],
  run: async (filters, { user }) => {
    const students = await scopedStudents(filters, user);
    if (!students) return NO_CLASSES_RESULT;
    const { month, range } = monthRange(filters.month);

    const records = await StudentAttendance.find({ studentId: { $in: students.map((s) => s._id) }, att_date: range })
      .select('studentId status att_date')
      .lean();
    const statuses = dailyStatuses(records);
    const studentBy = new Map(students.map((s) => [String(s._id), s]));

    const byClass = new Map();
    for (const s of students) {
      const key = classKeyOf(s);
      if (!byClass.has(key)) byClass.set(key, { ...blankTally(s), days: new Set() });
      byClass.get(key).students += 1;
    }
    for (const [key, status] of statuses) {
      const [studentId, day] = key.split('|');
      const t = byClass.get(classKeyOf(studentBy.get(studentId)));
      if (!t) continue;
      t.days.add(day);
      if (status === 'Present') t.present += 1;
      else if (status === 'Late') t.late += 1;
      else if (status === 'Absent') t.absent += 1;
      else t.excused += 1;
    }

    const rows = [...byClass.values()]
      .map(({ days, notMarked: _notMarked, ...t }) => ({ ...t, days: days.size, rate: rateOf(t) }))
      .sort(byClassName);
    const total = rows.reduce((acc, r) => {
      acc.present += r.present; acc.late += r.late; acc.absent += r.absent;
      return acc;
    }, { present: 0, late: 0, absent: 0 });
    const ordered = rows.filter((r) => r.days > 0).sort((a, b) => b.rate - a.rate);

    return {
      columns: [
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'students', label: 'Students', type: 'number' },
        { key: 'days', label: 'Days Recorded', type: 'number' },
        { key: 'present', label: 'Present (student-days)', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'excused', label: 'Excused', type: 'number' },
        { key: 'rate', label: 'Attendance %', type: 'number' }
      ],
      rows,
      summary: [
        { label: 'Month', value: month },
        { label: 'School Attendance', value: `${rateOf(total)}%` },
        { label: 'Best Class', value: ordered[0] ? `${ordered[0].className} ${ordered[0].sectionName} (${ordered[0].rate}%)` : '—' },
        { label: 'Lowest Class', value: ordered.length ? `${ordered.at(-1).className} ${ordered.at(-1).sectionName} (${ordered.at(-1).rate}%)` : '—' }
      ],
      chart: { type: 'bar', x: 'className', series: ['rate'] }
    };
  }
});

// ============================================================
// Absent and late students
// ============================================================

const STATUS_FILTER = {
  key: 'status',
  label: 'Show',
  type: 'select',
  default: 'both',
  options: [
    { value: 'both', label: 'Absent and late' },
    { value: 'Absent', label: 'Absent only' },
    { value: 'Late', label: 'Late only' }
  ]
};

const absentLate = officeAndTeacher({
  id: 'attendance-absent-late',
  teacherId: 'teaching-attendance-absent-late',
  title: 'Absent and late students',
  teacherTitle: 'Absent and late students in my classes',
  description: 'Every student absent or late in the chosen dates (today if none), with the lessons missed and a parent phone number',
  group: OFFICE_GROUP,
  teacherGroup: TEACHER_GROUP,
  filters: [FILTERS.dateFrom, FILTERS.dateTo, FILTERS.class, FILTERS.section, STATUS_FILTER],
  run: async (filters, { user }) => {
    const students = await scopedStudents(filters, user);
    if (!students) return NO_CLASSES_RESULT;
    const range = dateRange(filters) ?? dayRange(todayIso()).range;
    const wanted = filters.status === 'Absent' || filters.status === 'Late' ? [filters.status] : ['Absent', 'Late'];

    const records = await StudentAttendance.find({
      studentId: { $in: students.map((s) => s._id) },
      att_date: range,
      status: { $in: wanted }
    })
      .select('studentId status att_date periodId')
      .populate('periodId', 'per_name time_in')
      .sort({ att_date: -1 })
      .lean();
    const studentBy = new Map(students.map((s) => [String(s._id), s]));

    // One row per student, day and status, listing the lessons.
    const grouped = new Map();
    for (const r of records) {
      const key = `${r.studentId}|${dayKey(r.att_date)}|${r.status}`;
      if (!grouped.has(key)) grouped.set(key, { record: r, lessons: [] });
      grouped.get(key).lessons.push(r.periodId?.per_name ?? '—');
    }

    const rows = [...grouped.values()].map(({ record, lessons }) => {
      const s = studentBy.get(String(record.studentId));
      return {
        date: dayKey(record.att_date),
        rollNo: s?.admissionNumber ?? '—',
        name: fullName(s),
        className: s?.classId?.cl_name ?? '—',
        sectionName: s?.sectionId?.name ?? '—',
        status: record.status,
        lessons: lessons.length,
        lessonList: lessons.join(', '),
        parentName: s?.parentName ?? '—',
        parentPhone: s?.parentPhoneNumber ?? '—'
      };
    }).sort((a, b) => b.date.localeCompare(a.date) || a.className.localeCompare(b.className) || a.name.localeCompare(b.name));

    return {
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'status', label: 'Status' },
        { key: 'lessons', label: 'Lessons', type: 'number' },
        { key: 'lessonList', label: 'Periods' },
        { key: 'parentName', label: 'Parent' },
        { key: 'parentPhone', label: 'Parent Phone' }
      ],
      rows,
      summary: [
        { label: 'Absent', value: rows.filter((r) => r.status === 'Absent').length },
        { label: 'Late', value: rows.filter((r) => r.status === 'Late').length },
        { label: 'Students', value: new Set(rows.map((r) => r.rollNo)).size }
      ]
    };
  }
});

// ============================================================
// Students with low attendance (academic office; teachers already have
// "Students with low attendance" under My Classes)
// ============================================================

const lowAttendance = {
  id: 'attendance-low',
  title: 'Students with low attendance',
  description: 'Students whose attendance is below the chosen percentage (75% unless you change it), with a parent phone number',
  group: OFFICE_GROUP,
  department: 'academic',
  roles: OFFICE_ROLES,
  filters: [
    { ...FILTERS.threshold, label: 'Below %', default: 75 },
    FILTERS.dateFrom,
    FILTERS.dateTo,
    FILTERS.class,
    FILTERS.section
  ],
  run: async (filters, { user }) => {
    const students = await scopedStudents(filters, user);
    if (!students) return NO_CLASSES_RESULT;
    const threshold = numberFilter(filters.threshold, 75);
    const range = dateRange(filters);

    const records = await StudentAttendance.find({
      studentId: { $in: students.map((s) => s._id) },
      ...(range ? { att_date: range } : {})
    }).select('studentId status').lean();

    const tally = new Map();
    for (const r of records) {
      const key = String(r.studentId);
      if (!tally.has(key)) tally.set(key, { present: 0, late: 0, absent: 0, excused: 0 });
      const t = tally.get(key);
      if (r.status === 'Present') t.present += 1;
      else if (r.status === 'Late') t.late += 1;
      else if (r.status === 'Absent') t.absent += 1;
      else t.excused += 1;
    }

    const tracked = students
      .filter((s) => tally.has(String(s._id)))
      .map((s) => {
        const t = tally.get(String(s._id));
        return {
          rollNo: s.admissionNumber,
          name: fullName(s),
          className: s.classId?.cl_name ?? '—',
          sectionName: s.sectionId?.name ?? '—',
          present: t.present,
          late: t.late,
          absent: t.absent,
          rate: rateOf(t),
          parentName: s.parentName ?? '—',
          parentPhone: s.parentPhoneNumber ?? '—',
          counted: t.present + t.late + t.absent
        };
      });
    const rows = tracked
      .filter((r) => r.counted > 0 && r.rate < threshold)
      .map(({ counted: _counted, ...r }) => r)
      .sort((a, b) => a.rate - b.rate);

    return {
      columns: [
        { key: 'rollNo', label: 'Admission No' },
        { key: 'name', label: 'Student' },
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'present', label: 'Present (lessons)', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'rate', label: 'Attendance %', type: 'number' },
        { key: 'parentName', label: 'Parent' },
        { key: 'parentPhone', label: 'Parent Phone' }
      ],
      rows,
      summary: [
        { label: 'Below Threshold', value: rows.length },
        { label: 'Threshold', value: `${threshold}%` },
        { label: 'Students Tracked', value: tracked.length }
      ]
    };
  }
};

// ============================================================
// Teacher attendance (StaffAttendance)
// ============================================================

const teacherName = (t) => fullName(t.userId) || t.userId?.username || t.staffId;

const activeTeachers = () => Teacher.find({ status: { $ne: 'Inactive' } })
  .select('userId staffId department phone status')
  .populate('userId', 'firstName lastName username')
  .lean();

const staffDaily = {
  id: 'attendance-staff-daily',
  title: 'Teacher attendance (daily)',
  description: 'Each teacher on one day: present, late, absent, excused or not marked, with time in and out',
  group: OFFICE_GROUP,
  department: 'academic',
  roles: OFFICE_ROLES,
  filters: [{ ...FILTERS.date, label: 'Day', hint: 'Leave empty for today' }],
  run: async (filters) => {
    const { day, range } = dayRange(filters.date);
    const [teachers, records] = await Promise.all([
      activeTeachers(),
      StaffAttendance.find({ att_date: range }).lean()
    ]);
    const byTeacher = new Map(records.map((r) => [String(r.teacherId), r]));

    const rows = teachers.map((t) => {
      const r = byTeacher.get(String(t._id));
      return {
        staffId: t.staffId,
        name: teacherName(t),
        department: t.department ?? '—',
        status: r?.status ?? 'Not marked',
        timeIn: r?.time_in ?? '—',
        timeOut: r?.time_out ?? '—',
        remarks: r?.remarks ?? ''
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const count = (status) => rows.filter((r) => r.status === status).length;
    return {
      columns: [
        { key: 'staffId', label: 'Staff ID' },
        { key: 'name', label: 'Teacher' },
        { key: 'department', label: 'Department' },
        { key: 'status', label: 'Status' },
        { key: 'timeIn', label: 'Time In' },
        { key: 'timeOut', label: 'Time Out' },
        { key: 'remarks', label: 'Remarks' }
      ],
      rows,
      summary: [
        { label: 'Day', value: day },
        { label: 'Teachers', value: rows.length },
        { label: 'Present', value: count('Present') },
        { label: 'Late', value: count('Late') },
        { label: 'Absent', value: count('Absent') },
        { label: 'Excused', value: count('Excused') },
        { label: 'Not Marked', value: count('Not marked') }
      ]
    };
  }
};

const staffMonthly = {
  id: 'attendance-staff-monthly',
  title: 'Teacher attendance (monthly)',
  description: 'Each teacher over one month: days present, late, absent and excused, and their attendance rate',
  group: OFFICE_GROUP,
  department: 'academic',
  roles: OFFICE_ROLES,
  filters: [{ ...FILTERS.month, label: 'Month', hint: 'Leave empty for this month' }],
  run: async (filters) => {
    const { month, range } = monthRange(filters.month);
    const [teachers, records] = await Promise.all([
      activeTeachers(),
      StaffAttendance.find({ att_date: range }).select('teacherId status').lean()
    ]);
    const tally = new Map();
    for (const r of records) {
      const key = String(r.teacherId);
      if (!tally.has(key)) tally.set(key, { present: 0, late: 0, absent: 0, excused: 0 });
      const t = tally.get(key);
      if (r.status === 'Present') t.present += 1;
      else if (r.status === 'Late') t.late += 1;
      else if (r.status === 'Absent') t.absent += 1;
      else t.excused += 1;
    }

    const rows = teachers.map((t) => {
      const c = tally.get(String(t._id)) ?? { present: 0, late: 0, absent: 0, excused: 0 };
      return {
        staffId: t.staffId,
        name: teacherName(t),
        department: t.department ?? '—',
        ...c,
        days: c.present + c.late + c.absent + c.excused,
        rate: rateOf(c)
      };
    }).sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));

    const total = rows.reduce((acc, r) => {
      acc.present += r.present; acc.late += r.late; acc.absent += r.absent;
      return acc;
    }, { present: 0, late: 0, absent: 0 });

    return {
      columns: [
        { key: 'staffId', label: 'Staff ID' },
        { key: 'name', label: 'Teacher' },
        { key: 'department', label: 'Department' },
        { key: 'days', label: 'Days Recorded', type: 'number' },
        { key: 'present', label: 'Present', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'excused', label: 'Excused', type: 'number' },
        { key: 'rate', label: 'Attendance %', type: 'number' }
      ],
      rows,
      summary: [
        { label: 'Month', value: month },
        { label: 'Teachers', value: rows.length },
        { label: 'Overall Attendance', value: `${rateOf(total)}%` },
        { label: 'Absences', value: total.absent },
        { label: 'Late Arrivals', value: total.late }
      ]
    };
  }
};

export const attendanceReports = [
  ...dailyByClass,
  ...monthlyByClass,
  ...absentLate,
  lowAttendance,
  staffDaily,
  staffMonthly
];
