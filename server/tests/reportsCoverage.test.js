import request from 'supertest';
import app from '../src/server.js';
import User from '../src/models/User.js';
import Teacher from '../src/models/Teacher.js';
import Level from '../src/models/Level.js';
import Year from '../src/models/Year.js';
import Term from '../src/models/Term.js';
import Class from '../src/models/Class.js';
import Section from '../src/models/Section.js';
import Subject from '../src/models/Subject.js';
import Period from '../src/models/Period.js';
import TeacherAssignment from '../src/models/TeacherAssignment.js';
import Student from '../src/models/Student.js';
import Exam from '../src/models/Exam.js';
import Mark from '../src/models/Mark.js';
import StudentAttendance from '../src/models/StudentAttendance.js';
import StaffAttendance from '../src/models/StaffAttendance.js';
import { generateAccessToken } from '../src/utils/tokenService.js';

// The reports added for the school's "Reports page is missing important
// reports" issue: each one runs for the academic office across the school,
// for a teacher only in their own classes, and exports to Excel and PDF.
describe('Reports coverage', () => {
  const tag = `RC${Date.now()}`;
  const tokens = {};
  const c = {};
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const as = (role) => ({ Authorization: `Bearer ${tokens[role]}` });
  // Ids go over the query string as plain strings.
  const plain = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const run = (id, params = {}, role = 'admin') => request(app).get(`/api/reports/run/${id}`).query(plain(params)).set(as(role));
  const names = (res) => res.body.data.rows.map((r) => r.name).filter(Boolean);

  beforeAll(async () => {
    for (const role of ['admin', 'teacher', 'accountant']) {
      const u = await User.create({ firstName: 'RC', lastName: role, email: `${role}.${tag}@reports.test`, password: 'password123', role });
      c[role] = u;
      tokens[role] = generateAccessToken(u);
    }
    c.teacherRec = await Teacher.create({ userId: c.teacher._id, staffId: `${tag}-T` });
    const level = await Level.create({ lev_no: `${tag}-L`, lev_name: 'RC level' });
    c.year = await Year.create({ y_no: `${tag}-Y`, y_name: `RC ${tag}` });
    c.term = await Term.create({ name: `RC term ${tag}`, academicYearId: c.year._id, status: 'active', startDate: new Date('2000-01-01') });
    c.mine = await Class.create({ cl_no: `${tag}-C1`, cl_name: `RC mine ${tag}`, lev_no: level._id });
    c.other = await Class.create({ cl_no: `${tag}-C2`, cl_name: `RC other ${tag}`, lev_no: level._id });
    c.section = await Section.create({ name: 'A', class: c.mine._id });
    c.math = await Subject.create({ sub_no: `${tag}-S1`, sub_name: `RC Maths ${tag}`, classIds: [c.mine._id, c.other._id] });
    c.art = await Subject.create({ sub_no: `${tag}-S2`, sub_name: `RC Art ${tag}`, classIds: [c.mine._id] });
    c.period = await Period.create({ termId: c.term._id, per_no: '1', per_name: 'Period 1', time_in: '08:00', time_out: '08:40' });
    c.assignment = await TeacherAssignment.create({
      teacherId: c.teacherRec._id, subjectId: c.math._id, classId: c.mine._id, sectionId: c.section._id, termId: c.term._id,
      timetableSlots: [{ day: 'Monday', periodId: c.period._id }, { day: 'Tuesday', periodId: c.period._id }]
    });

    const mk = (firstName, cls, extra = {}) => Student.create({
      firstName, lastName: 'Reports', admissionNumber: `${tag}-${firstName}`, gender: 'Female', birthDate: new Date('2014-01-01'),
      classId: cls._id, phoneNumber: '0617000001', address: 'Hodan', parentName: 'RC Parent', parentPhoneNumber: '0617000002', ...extra
    });
    c.amina = await mk('Amina', c.mine, { sectionId: c.section._id });
    c.bilan = await mk('Bilan', c.mine, { sectionId: c.section._id, gender: 'Male' });
    c.caasha = await mk('Caasha', c.other);

    c.exam1 = await Exam.create({ name: `Midterm ${tag}`, termId: c.term._id, yearId: c.year._id, maxMarks: 100 });
    c.exam2 = await Exam.create({ name: `Final ${tag}`, termId: c.term._id, yearId: c.year._id, maxMarks: 100 });
    const mark = (exam, student, cls, subject, score, sectionId = null) =>
      Mark.create({ examId: exam._id, studentId: student._id, classId: cls._id, sectionId, subjectId: subject._id, score });
    await Promise.all([
      mark(c.exam1, c.amina, c.mine, c.math, 90, c.section._id),
      mark(c.exam1, c.amina, c.mine, c.art, 80, c.section._id),
      mark(c.exam1, c.bilan, c.mine, c.math, 30, c.section._id),
      mark(c.exam1, c.bilan, c.mine, c.art, 40, c.section._id),
      mark(c.exam2, c.amina, c.mine, c.math, 95, c.section._id),
      mark(c.exam2, c.bilan, c.mine, c.math, 45, c.section._id),
      mark(c.exam1, c.caasha, c.other, c.math, 70),
      mark(c.exam2, c.caasha, c.other, c.math, 60)
    ]);

    const at = new Date(`${today}T09:00:00.000Z`);
    await StudentAttendance.create([
      { studentId: c.amina._id, periodId: c.period._id, status: 'Present', att_date: at },
      { studentId: c.bilan._id, periodId: c.period._id, status: 'Absent', att_date: at },
      { studentId: c.caasha._id, periodId: c.period._id, status: 'Late', att_date: at }
    ]);
    await StaffAttendance.create({ teacherId: c.teacherRec._id, status: 'Present', att_date: at, time_in: '07:45' });
  }, 120000);

  afterAll(async () => {
    const students = [c.amina, c.bilan, c.caasha].filter(Boolean).map((s) => s._id);
    await Promise.all([
      Mark.deleteMany({ studentId: { $in: students } }),
      StudentAttendance.deleteMany({ studentId: { $in: students } }),
      StaffAttendance.deleteMany({ teacherId: c.teacherRec?._id }),
      Exam.deleteMany({ termId: c.term?._id }),
      Student.deleteMany({ _id: { $in: students } }),
      TeacherAssignment.deleteMany({ termId: c.term?._id }),
      Period.deleteMany({ termId: c.term?._id }),
      Subject.deleteMany({ sub_no: new RegExp(`^${tag}`) }),
      Section.deleteMany({ class: { $in: [c.mine?._id, c.other?._id] } }),
      Class.deleteMany({ cl_no: new RegExp(`^${tag}`) }),
      Term.deleteMany({ _id: c.term?._id }),
      Year.deleteMany({ y_no: `${tag}-Y` }),
      Level.deleteMany({ lev_no: `${tag}-L` }),
      Teacher.deleteMany({ staffId: `${tag}-T` }),
      User.deleteMany({ email: new RegExp(`${tag}@reports\\.test$`) })
    ]);
  }, 120000);

  // Office report id, teacher twin id (or null), filters.
  const cases = () => [
    ['exam-student-results', 'teaching-class-results', { term_id: c.term._id, class_id: c.mine._id }],
    ['exam-results-by-class', 'teaching-results-by-class', { exam_id: c.exam1._id }],
    ['results-school-summary', 'teaching-results-summary', { term_id: c.term._id }],
    ['results-report-card', 'teaching-report-card', { term_id: c.term._id, student_id: c.amina._id }],
    ['results-subject-performance', 'teaching-subject-performance', { term_id: c.term._id }],
    ['results-exam-comparison', 'teaching-exam-comparison', { exam_id: c.exam1._id, exam_b_id: c.exam2._id }],
    ['results-top-students', 'teaching-top-students', { term_id: c.term._id, limit: 5 }],
    ['results-need-help', 'teaching-need-help', { exam_id: c.exam1._id }],
    ['results-marking-progress', 'exam-marking-progress', { exam_id: c.exam1._id }],
    ['attendance-daily-by-class', 'teaching-attendance-daily-by-class', { date: today }],
    ['attendance-monthly-by-class', 'teaching-attendance-monthly-by-class', { month }],
    ['attendance-absent-late', 'teaching-attendance-absent-late', { from: today, to: today }],
    ['attendance-low', null, { threshold: 75 }],
    ['attendance-staff-daily', null, { date: today }],
    ['attendance-staff-monthly', null, { month }],
    ['students-contact-list', 'teaching-student-contacts', {}],
    ['students-no-parent', null, {}],
    ['timetable-by-class', 'teaching-timetable-by-class', { term_id: c.term._id, class_id: c.mine._id }],
    ['timetable-by-teacher', null, { term_id: c.term._id, teacher_id: c.teacherRec._id }],
    ['assignments-workload', null, { term_id: c.term._id }],
    ['assignments-unassigned-subjects', null, { term_id: c.term._id }]
  ];

  it('runs every new academic report for the office', async () => {
    for (const [id, , params] of cases()) {
      const res = await run(id, params);
      expect({ id, status: res.status, message: res.body.message }).toEqual({ id, status: 200, message: undefined });
      expect(Array.isArray(res.body.data.rows)).toBe(true);
    }
  }, 120000);

  it('runs every teacher version, and keeps teachers off the office versions', async () => {
    for (const [id, twin, params] of cases()) {
      expect({ id, status: (await run(id, params, 'teacher')).status }).toEqual({ id, status: 403 });
      if (!twin) continue;
      const res = await run(twin, params, 'teacher');
      expect({ twin, status: res.status, message: res.body.message }).toEqual({ twin, status: 200, message: undefined });
    }
  }, 120000);

  it('lists the new reports in the right catalogue for each role', async () => {
    const ids = async (role) => (await request(app).get('/api/reports/catalog').set(as(role))).body.data
      .flatMap((d) => d.groups.flatMap((g) => g.reports.map((r) => r.id)));
    const admin = await ids('admin');
    const teacher = await ids('teacher');
    for (const [id, twin] of cases()) {
      expect(admin).toContain(id);
      expect(teacher).not.toContain(id);
      if (twin) {
        expect(teacher).toContain(twin);
        expect(admin).not.toContain(twin);
      }
    }
    expect(admin).not.toContain('report-filter-options');
    // The school found a second "My Teaching" view for the office redundant:
    // the office gets the Academic Office only; teachers get My Classes.
    const departments = async (role) => (await request(app).get('/api/reports/catalog').set(as(role))).body.data.map((d) => d.name);
    expect(await departments('admin')).not.toContain('My Teaching');
    expect(await departments('admin')).not.toContain('My Classes');
    expect(await departments('teacher')).toEqual(['My Classes']);
    expect(await ids('accountant')).toEqual(expect.arrayContaining(['finance-student-fee-status', 'finance-standing-discounts']));
  });

  it('gives positions and averages from the marks', async () => {
    const res = await run('exam-student-results', { exam_id: c.exam1._id, class_id: c.mine._id });
    const [first, second] = res.body.data.rows;
    expect(first).toMatchObject({ name: 'Amina Reports', position: 1, percent: 85, earned: 170 });
    expect(second).toMatchObject({ name: 'Bilan Reports', position: 2, percent: 35, result: 'Fail' });

    const help = await run('results-need-help', { exam_id: c.exam1._id, class_id: c.mine._id });
    expect(names(help)).toEqual(['Bilan Reports']);
    expect(help.body.data.rows[0].failedCount).toBe(2);

    const top = await run('results-top-students', { term_id: c.term._id, limit: 1 });
    expect(top.body.data.rows[0].name).toBe('Amina Reports');

    const compare = await run('results-exam-comparison', { exam_id: c.exam1._id, exam_b_id: c.exam2._id, class_id: c.mine._id, compare_by: 'students' });
    const bilan = compare.body.data.rows.find((r) => r.name === 'Bilan Reports');
    expect(bilan).toMatchObject({ first: 35, second: 45, change: 10, trend: 'Improved' });
  });

  it('holds a teacher to their own classes', async () => {
    const results = await run('teaching-results-summary', { term_id: c.term._id }, 'teacher');
    expect(results.body.data.rows.map((r) => r.className)).toEqual([c.mine.cl_name]);

    const contacts = await run('teaching-student-contacts', {}, 'teacher');
    expect(names(contacts).sort()).toEqual(['Amina Reports', 'Bilan Reports']);
    expect(contacts.body.data.rows[0].parentPhone).toBe('0617000002');

    // Another class, or a student in it, is refused.
    expect((await run('teaching-class-results', { term_id: c.term._id, class_id: c.other._id }, 'teacher')).status).toBe(403);
    expect((await run('teaching-report-card', { term_id: c.term._id, student_id: c.caasha._id }, 'teacher')).status).toBe(403);

    // The office sees both classes.
    const office = await run('results-school-summary', { term_id: c.term._id });
    expect(office.body.data.rows.map((r) => r.className)).toEqual(expect.arrayContaining([c.mine.cl_name, c.other.cl_name]));
  });

  it('counts daily attendance per class and lists absent and late students', async () => {
    const daily = await run('attendance-daily-by-class', { date: today, class_id: c.mine._id });
    expect(daily.body.data.rows[0]).toMatchObject({ students: 2, present: 1, absent: 1, rate: 50 });

    const absent = await run('teaching-attendance-absent-late', { from: today, to: today }, 'teacher');
    expect(names(absent)).toEqual(['Bilan Reports']);

    const staff = await run('attendance-staff-daily', { date: today });
    expect(staff.body.data.rows.find((r) => r.staffId === `${tag}-T`)).toMatchObject({ status: 'Present', timeIn: '07:45' });
  });

  it('draws the class timetable as a day-by-period grid', async () => {
    const res = await run('timetable-by-class', { term_id: c.term._id, class_id: c.mine._id });
    const row = res.body.data.rows.find((r) => r.period === 'Period 1');
    expect(row.Monday).toBe(`${c.math.sub_name} — RC teacher`);
    expect(row.Tuesday).toBe(`${c.math.sub_name} — RC teacher`);

    const gaps = await run('assignments-unassigned-subjects', { term_id: c.term._id, class_id: c.mine._id });
    expect(gaps.body.data.rows.map((r) => r.subject)).toEqual([c.art.sub_name]);
  });

  it('gives teachers only their own classes in the filter choices', async () => {
    const res = await run('report-filter-options', {}, 'teacher');
    expect(res.status).toBe(200);
    const classes = res.body.data.rows.filter((r) => r.kind === 'class').map((r) => r.value);
    expect(classes).toEqual([String(c.mine._id)]);
    expect(res.body.data.rows.some((r) => r.kind === 'teacher')).toBe(false);
  });

  it('runs the new finance reports for the finance office only', async () => {
    for (const id of ['finance-student-fee-status', 'finance-standing-discounts', 'finance-outstanding-students']) {
      expect({ id, status: (await run(id, {}, 'accountant')).status }).toEqual({ id, status: 200 });
      expect({ id, status: (await run(id, {}, 'teacher')).status }).toEqual({ id, status: 403 });
    }
    const owing = await run('finance-outstanding-students', {}, 'accountant');
    expect(owing.body.data.columns.map((col) => col.key)).toEqual(expect.arrayContaining(['parentName', 'parentPhone']));
  });

  it('exports to Excel and PDF', async () => {
    const xlsx = await request(app)
      .get('/api/reports/run/exam-student-results/export')
      .query({ format: 'xlsx', exam_id: String(c.exam1._id), class_id: String(c.mine._id) })
      .set(as('admin'));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);

    const pdf = await request(app)
      .get('/api/reports/run/teaching-timetable-by-class/export')
      .query({ format: 'pdf', term_id: String(c.term._id), class_id: String(c.mine._id) })
      .set(as('teacher'));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);

    const attendancePdf = await request(app)
      .get('/api/reports/run/attendance-monthly-by-class/export')
      .query({ format: 'pdf', month })
      .set(as('admin'));
    expect(attendancePdf.status).toBe(200);
    expect(attendancePdf.headers['content-type']).toMatch(/application\/pdf/);
  }, 60000);
});
