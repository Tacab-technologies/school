import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/server.js';
import User from '../src/models/User.js';
import Teacher from '../src/models/Teacher.js';
import Level from '../src/models/Level.js';
import Year from '../src/models/Year.js';
import Term from '../src/models/Term.js';
import Class from '../src/models/Class.js';
import Section from '../src/models/Section.js';
import Subject from '../src/models/Subject.js';
import Student from '../src/models/Student.js';
import Guardian from '../src/models/Guardian.js';
import Family from '../src/models/Family.js';
import TeacherAssignment from '../src/models/TeacherAssignment.js';
import Exam from '../src/models/Exam.js';
import Mark from '../src/models/Mark.js';
import MarkSheet from '../src/models/MarkSheet.js';
import SystemSetting from '../src/models/SystemSetting.js';
import SequenceCounter from '../src/models/SequenceCounter.js';
import FeeStructure from '../src/models/FeeStructure.js';
import PaymentMethod from '../src/models/PaymentMethod.js';
import PaymentClaim from '../src/models/PaymentClaim.js';
import StudentInvoice from '../src/models/StudentInvoice.js';
import { addMonths, currentPeriod, ensureFeeIndexes } from '../src/services/monthlyFeeService.js';

// The school's System Testing 1.2 list: submitting marks and asking to change
// them, teachers seeing only their own subjects, admission numbers, teacher
// assignments without a section, parent logins, the family view and paying ahead.
const secret = () => process.env.JWT_ACCESS_SECRET || 'default_access_secret_key_12345';
const bearer = (id, role) => `Bearer ${jwt.sign({ id: id.toString(), role }, secret())}`;
const ids = {
  admin: new mongoose.Types.ObjectId(), officer: new mongoose.Types.ObjectId(),
  teacher: new mongoose.Types.ObjectId(), other: new mongoose.Types.ObjectId(),
};
const emails = ['st.admin@test.com', 'st.officer@test.com', 'st.teacher@test.com', 'st.other@test.com', 'st.parent@test.com'];
const c = {};

const studentData = (n, extra) => ({
  firstName: `St${n}`, lastName: 'Student', admissionNumber: `ST-${n}`, gender: 'Female', birthDate: new Date('2013-01-01'),
  phoneNumber: '0616660000', address: 'Hodan', parentName: 'St Parent', parentPhoneNumber: '0616660001', ...extra,
});

describe('System Testing 1.2 fixes', () => {
  const admin = () => bearer(ids.admin, 'admin');
  const officer = () => bearer(ids.officer, 'academic_officer');
  const teacher = () => bearer(ids.teacher, 'teacher');
  const otherTeacher = () => bearer(ids.other, 'teacher');
  const mathSheet = () => ({ classId: String(c.g5._id), sectionId: String(c.a._id), subjectId: String(c.math._id) });

  beforeAll(async () => {
    await User.deleteMany({ email: { $in: emails } });
    await User.create([
      { _id: ids.admin, firstName: 'St', lastName: 'Admin', email: emails[0], password: 'password123', role: 'admin' },
      { _id: ids.officer, firstName: 'St', lastName: 'Officer', email: emails[1], password: 'password123', role: 'academic_officer' },
      { _id: ids.teacher, firstName: 'St', lastName: 'Teacher', email: emails[2], password: 'password123', role: 'teacher' },
      { _id: ids.other, firstName: 'St', lastName: 'Other', email: emails[3], password: 'password123', role: 'teacher' },
    ]);
    c.teacher = await Teacher.create({ userId: ids.teacher, staffId: 'ST-T1' });
    c.other = await Teacher.create({ userId: ids.other, staffId: 'ST-T2' });
    c.level = await Level.create({ lev_no: 'ST-L', lev_name: 'St level' });
    c.year = await Year.create({ y_no: 'ST-Y1', y_name: 'St year' });
    c.term = await Term.create({ name: 'ST term', academicYearId: c.year._id, status: 'active', startDate: new Date('2026-05-01') });
    c.g5 = await Class.create({ cl_no: 'ST-G5', cl_name: 'ST Grade 5', lev_no: c.level._id });
    c.g6 = await Class.create({ cl_no: 'ST-G6', cl_name: 'ST Grade 6', lev_no: c.level._id }); // no sections
    c.a = await Section.create({ name: 'A', class: c.g5._id });
    c.math = await Subject.create({ sub_no: 'ST-S1', sub_name: 'ST Maths', classId: c.g5._id });
    c.sci = await Subject.create({ sub_no: 'ST-S2', sub_name: 'ST Science', classId: c.g5._id });
    c.art = await Subject.create({ sub_no: 'ST-S3', sub_name: 'ST Art' });
    c.s1 = await Student.create(studentData(1, { classId: c.g5._id, sectionId: c.a._id }));
    c.s2 = await Student.create(studentData(2, { classId: c.g5._id, sectionId: c.a._id }));
    await TeacherAssignment.create([
      { teacherId: c.teacher._id, subjectId: c.math._id, classId: c.g5._id, sectionId: c.a._id, termId: c.term._id },
      { teacherId: c.other._id, subjectId: c.sci._id, classId: c.g5._id, sectionId: c.a._id, termId: c.term._id },
    ]);
    c.exam = await Exam.create({ name: 'ST Midterm', termId: c.term._id, yearId: c.year._id, maxMarks: 50, classIds: [c.g5._id] });
    await Mark.create([
      { examId: c.exam._id, studentId: c.s1._id, subjectId: c.sci._id, classId: c.g5._id, sectionId: c.a._id, score: 44 },
    ]);
  }, 180000);

  afterAll(async () => {
    const students = await Student.find({ lastName: { $in: ['Student', 'Admitted', 'Family'] }, firstName: /^St/ }).select('_id').lean();
    const studentIds = students.map((s) => s._id);
    await Promise.all([
      User.deleteMany({ $or: [{ email: { $in: emails } }, { email: /@st-family\.test$/ }] }),
      Teacher.deleteMany({ staffId: { $in: ['ST-T1', 'ST-T2'] } }),
      Level.deleteMany({ lev_no: 'ST-L' }),
      Year.deleteMany({ y_no: 'ST-Y1' }),
      Term.deleteMany({ name: 'ST term' }),
      Class.deleteMany({ cl_no: { $in: ['ST-G5', 'ST-G6'] } }),
      Section.deleteMany({ _id: c.a?._id }),
      Subject.deleteMany({ sub_no: { $in: ['ST-S1', 'ST-S2', 'ST-S3'] } }),
      Student.deleteMany({ _id: { $in: studentIds } }),
      TeacherAssignment.deleteMany({ teacherId: { $in: [c.teacher?._id, c.other?._id] } }),
      Exam.deleteMany({ termId: c.term?._id }),
      Mark.deleteMany({ examId: c.exam?._id }),
      MarkSheet.deleteMany({ examId: c.exam?._id }),
      Guardian.deleteMany({ phone: '0616669999' }),
      Family.deleteMany({ familyName: 'ST Family' }),
      FeeStructure.deleteMany({ class_id: { $in: [c.g5?._id, c.g6?._id] } }),
      PaymentClaim.deleteMany({ reference: /^ST-REF/ }),
      StudentInvoice.deleteMany({ student: { $in: studentIds } }),
      PaymentMethod.deleteMany({ payment_method_no: 'ST-EVC' }),
    ]);
  }, 180000);

  describe('marks: draft, submit, ask to change, entry dates, publish', () => {
    const saveAs = (who, marks) => request(app).put(`/api/exams/${c.exam._id}/marks`).set('Authorization', who()).send({ ...mathSheet(), marks });
    const sheetAs = (who) => request(app).get(`/api/exams/${c.exam._id}/marksheet`).set('Authorization', who()).query(mathSheet());
    const submitAs = (who) => request(app).post(`/api/exams/${c.exam._id}/sheet/submit`).set('Authorization', who()).send(mathSheet());

    it('lets a teacher save a draft and change it while entry is open', async () => {
      expect((await saveAs(teacher, [{ studentId: c.s1._id, score: 40 }])).status).toBe(200);
      expect((await sheetAs(teacher)).body.data.locked).toBe(false);
      expect((await saveAs(teacher, [{ studentId: c.s1._id, score: 30 }])).status).toBe(200);
      expect((await saveAs(teacher, [{ studentId: c.s1._id, score: 40 }])).status).toBe(200);
    });

    it('refuses to submit while any student is blank', async () => {
      const res = await submitAs(teacher);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/mark or Absent.*St2 Student/);
    });

    it('locks the sheet once it is submitted', async () => {
      await saveAs(teacher, [{ studentId: c.s2._id, absent: true }]);
      const submit = await submitAs(teacher);
      expect(submit.status).toBe(200);
      expect(submit.body.data.status).toBe('submitted');
      expect((await sheetAs(teacher)).body.data.locked).toBe(true);

      const change = await saveAs(teacher, [{ studentId: c.s1._id, score: 30 }]);
      expect(change.status).toBe(403);
      expect(change.body.message).toMatch(/permission/);
    });

    it('shows submitted sheets on the exam list and in marking progress', async () => {
      const list = await request(app).get('/api/exams').set('Authorization', officer()).query({ termId: String(c.term._id) });
      const exam = list.body.data.find((e) => e.name === 'ST Midterm');
      expect(exam.sheets).toEqual({ total: 2, submitted: 1, requests: 0 });
      expect(exam.window).toBe('open');
      const progress = await request(app).get(`/api/exams/${c.exam._id}/progress`).set('Authorization', officer());
      expect(progress.body.data.rows.find((r) => r.subjectName === 'ST Maths').status).toBe('submitted');
    });

    it('lets the office still correct a mark', async () => {
      expect((await saveAs(officer, [{ studentId: c.s1._id, score: 41 }])).status).toBe(200);
    });

    it('lets the teacher ask to change it, and permission lasts until they submit again', async () => {
      const ask = await request(app).post(`/api/exams/${c.exam._id}/sheet/request-edit`).set('Authorization', teacher())
        .send({ ...mathSheet(), reason: 'Wrong mark for St1' });
      expect(ask.status).toBe(200);
      expect(ask.body.data.editRequest.status).toBe('pending');
      expect((await request(app).post(`/api/exams/${c.exam._id}/sheet/request-edit`).set('Authorization', teacher()).send({ ...mathSheet(), reason: 'Again' })).status).toBe(409);

      expect((await request(app).get('/api/exams/edit-requests').set('Authorization', teacher())).status).toBe(403);
      const requests = await request(app).get('/api/exams/edit-requests').set('Authorization', officer());
      const mine = requests.body.data.find((r) => r.subjectName === 'ST Maths');
      expect(mine).toMatchObject({ teacher: 'St Teacher', reason: 'Wrong mark for St1', className: 'ST Grade 5' });

      expect((await request(app).patch(`/api/exams/edit-requests/${mine._id}`).set('Authorization', officer()).send({ approve: true })).status).toBe(200);
      expect((await sheetAs(teacher)).body.data.locked).toBe(false);
      expect((await saveAs(teacher, [{ studentId: c.s1._id, score: 35 }])).status).toBe(200);
      expect((await saveAs(teacher, [{ studentId: c.s1._id, score: 36 }])).status).toBe(200);
      expect((await submitAs(teacher)).status).toBe(200);
      expect((await saveAs(teacher, [{ studentId: c.s1._id, score: 37 }])).status).toBe(403);
    });

    it('keeps the marks when the office refuses', async () => {
      await request(app).post(`/api/exams/${c.exam._id}/sheet/request-edit`).set('Authorization', teacher()).send({ ...mathSheet(), reason: 'One more change' });
      const sheet = await MarkSheet.findOne({ examId: c.exam._id, subjectId: c.math._id });
      expect((await request(app).patch(`/api/exams/edit-requests/${sheet._id}`).set('Authorization', officer()).send({ approve: false, note: 'Too late' })).status).toBe(200);
      const after = await sheetAs(teacher);
      expect(after.body.data.locked).toBe(true);
      expect(after.body.data.sheet.editRequest).toMatchObject({ status: 'rejected', note: 'Too late' });
    });

    it('lets the office give a teacher permission directly, but not a teacher', async () => {
      expect((await request(app).post(`/api/exams/${c.exam._id}/sheet/reopen`).set('Authorization', teacher()).send(mathSheet())).status).toBe(403);
      const reopen = await request(app).post(`/api/exams/${c.exam._id}/sheet/reopen`).set('Authorization', officer()).send(mathSheet());
      expect(reopen.status).toBe(200);
      expect(reopen.body.data).toMatchObject({ unlocked: true, status: 'draft' });
      expect((await saveAs(teacher, [{ studentId: c.s1._id, score: 37 }])).status).toBe(200);
      expect((await submitAs(teacher)).status).toBe(200);
    });

    it('only accepts teachers\' marks between the entry dates, unless the office allows it', async () => {
      const day = 24 * 60 * 60 * 1000;
      await request(app).post(`/api/exams/${c.exam._id}/sheet/reopen`).set('Authorization', officer()).send(mathSheet());
      await MarkSheet.updateOne({ examId: c.exam._id, subjectId: c.math._id }, { unlocked: false });
      await Exam.updateOne({ _id: c.exam._id }, { marksOpenFrom: new Date(Date.now() - 10 * day), marksOpenUntil: new Date(Date.now() - 2 * day) });
      const closed = await sheetAs(teacher);
      expect(closed.body.data.exam.window).toBe('closed');
      expect(closed.body.data.locked).toBe(true);
      const late = await saveAs(teacher, [{ studentId: c.s2._id, score: 20 }]);
      expect(late.status).toBe(403);
      expect(late.body.message).toMatch(/closed on/);
      expect((await submitAs(teacher)).status).toBe(403);
      expect((await saveAs(officer, [{ studentId: c.s2._id, score: 20 }])).status).toBe(200);

      await Exam.updateOne({ _id: c.exam._id }, { marksOpenFrom: new Date(Date.now() + 2 * day), marksOpenUntil: null });
      expect((await saveAs(teacher, [{ studentId: c.s2._id, score: 21 }])).body.message).toMatch(/opens on/);

      await request(app).post(`/api/exams/${c.exam._id}/sheet/reopen`).set('Authorization', officer()).send(mathSheet());
      expect((await saveAs(teacher, [{ studentId: c.s2._id, score: 21 }])).status).toBe(200);
      expect((await submitAs(teacher)).status).toBe(200);
      await Exam.updateOne({ _id: c.exam._id }, { marksOpenFrom: null, marksOpenUntil: null });
    });

    it('refuses entry dates that close before they open', async () => {
      const res = await request(app).put(`/api/exams/${c.exam._id}`).set('Authorization', officer()).send({
        name: 'ST Midterm', termId: String(c.term._id), maxMarks: 50, classIds: [String(c.g5._id)],
        marksOpenFrom: '2026-06-10', marksOpenUntil: '2026-06-01',
      });
      expect(res.status).toBe(400);
    });

    it('only the office publishes; hidden students see nothing until they are shown again', async () => {
      expect((await request(app).patch(`/api/exams/${c.exam._id}/publish`).set('Authorization', teacher()).send({ published: true })).status).toBe(403);
      const studentUser = await User.create({ firstName: 'St1', lastName: 'Student', email: 'st1@st-family.test', password: 'password123', role: 'student' });
      await Student.updateOne({ _id: c.s1._id }, { userId: studentUser._id });
      const asStudent = () => request(app).get('/api/portal/student/results').set('Authorization', bearer(studentUser._id, 'student'));
      const before = await asStudent();
      expect(before.status).toBe(200);
      expect(before.body.data.card).toBeNull();

      expect((await request(app).patch(`/api/exams/${c.exam._id}/publish`).set('Authorization', officer()).send({ published: true })).status).toBe(200);
      const after = await asStudent();
      expect(after.body.data.card.subjects.map((sub) => sub.name)).toEqual(expect.arrayContaining(['ST Maths', 'ST Science']));
      expect(after.body.data.card.subjects.find((sub) => sub.name === 'ST Maths').earned).toBe(37);

      // Hiding: the office only; this student loses the results, staff keep them.
      const holds = `/api/exams/${c.exam._id}/holds`;
      expect((await request(app).put(holds).set('Authorization', teacher()).send({ studentIds: [c.s1._id], hidden: true })).status).toBe(403);
      expect((await request(app).put(holds).set('Authorization', officer()).send({ studentIds: [c.s1._id], hidden: true, reason: 'Fees not paid', note: 'Until paid' })).status).toBe(200);
      const hidden = await asStudent();
      expect(hidden.body.data.card).toBeNull();
      expect(hidden.body.data.onHold).toBe(1);
      const list = await request(app).get(holds).set('Authorization', officer());
      expect(list.body.data.students.find((s) => s._id === String(c.s1._id)).hold).toEqual({ reason: 'Fees not paid', note: 'Until paid' });
      const staffView = await request(app).get('/api/exams/results').set('Authorization', officer())
        .query({ termId: String(c.term._id), classId: String(c.g5._id), sectionId: String(c.a._id) });
      const row = staffView.body.data.students.find((r) => r.student._id === String(c.s1._id));
      expect(row.student.held).toBe(true);
      expect(row.earned).toBeGreaterThan(0);

      expect((await request(app).put(holds).set('Authorization', officer()).send({ studentIds: [c.s1._id], hidden: false })).status).toBe(200);
      const back = await asStudent();
      expect(back.body.data.card).not.toBeNull();
      expect(back.body.data.onHold).toBe(0);

      await Exam.updateOne({ _id: c.exam._id }, { published: false, publishedAt: null });
      await Student.updateOne({ _id: c.s1._id }, { userId: null });
    });
  });

  describe("teachers see only their own subjects' results", () => {
    it('leaves out a colleague\'s subject from class results', async () => {
      const res = await request(app).get('/api/exams/results').set('Authorization', teacher())
        .query({ termId: String(c.term._id), classId: String(c.g5._id), sectionId: String(c.a._id) });
      expect(res.status).toBe(200);
      expect(res.body.data.ownSubjectsOnly).toBe(true);
      expect(res.body.data.subjects.map((s) => s.name)).toEqual(['ST Maths']);

      const office = await request(app).get('/api/exams/results').set('Authorization', officer())
        .query({ termId: String(c.term._id), classId: String(c.g5._id), sectionId: String(c.a._id) });
      expect(office.body.data.subjects.map((s) => s.name)).toEqual(expect.arrayContaining(['ST Maths', 'ST Science']));
    });

    it('leaves it out of report cards too', async () => {
      const card = await request(app).get(`/api/exams/report-card/${c.s1._id}`).set('Authorization', teacher()).query({ termId: String(c.term._id) });
      expect(card.status).toBe(200);
      expect(card.body.data.card.subjects.map((s) => s.name)).toEqual(['ST Maths']);
      const science = await request(app).get(`/api/exams/report-card/${c.s1._id}`).set('Authorization', otherTeacher()).query({ termId: String(c.term._id) });
      expect(science.body.data.card.subjects.map((s) => s.name)).toEqual(['ST Science']);
    });
  });

  describe('teacher assignments', () => {
    it('allows a class without sections and no timetable slots yet', async () => {
      const res = await request(app).post(`/api/teachers/${c.teacher._id}/assignments`).set('Authorization', admin())
        .send({ subjectId: String(c.art._id), classId: String(c.g6._id), termId: String(c.term._id) });
      expect(res.status).toBe(201);
      expect(res.body.data.sectionId).toBeNull();
    });

    it('still needs a section in a class that has sections', async () => {
      const res = await request(app).post(`/api/teachers/${c.teacher._id}/assignments`).set('Authorization', admin())
        .send({ subjectId: String(c.math._id), classId: String(c.g5._id), termId: String(c.term._id), timetableSlots: [] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/section/i);
    });

    it("shows the teacher's classes and subjects on their dashboard", async () => {
      const res = await request(app).get('/api/v1/analytics/teacher-kpis').set('Authorization', teacher());
      expect(res.status).toBe(200);
      const names = res.body.data.myClasses.map((k) => `${k.className}${k.sectionName ? ` ${k.sectionName}` : ''}: ${k.subjects.join(',')}`);
      expect(names).toEqual(['ST Grade 5 A: ST Maths', 'ST Grade 6: ST Art']);
      expect(res.body.data.myClasses[0].students).toBe(2);
      expect(res.body.data.mySubjects).toEqual(['ST Art', 'ST Maths']);
    });
  });

  describe('admission numbers', () => {
    let previousCode;
    beforeAll(async () => {
      const settings = await SystemSetting.findOne();
      previousCode = settings?.schoolCode;
      if (settings) { settings.schoolCode = 'st'; await settings.save(); } else await SystemSetting.create({ schoolCode: 'st' });
      await SequenceCounter.deleteMany({ name: 'admission:ST' });
    });
    afterAll(async () => {
      await SystemSetting.updateOne({}, { schoolCode: previousCode ?? '' });
      await SequenceCounter.deleteMany({ name: 'admission:ST' });
    });

    const register = (firstName) => request(app).post('/api/students').set('Authorization', admin()).send({
      firstName, lastName: 'Admitted', gender: 'Female', birthDate: '2014-02-02', classId: String(c.g6._id),
      phoneNumber: '0616661111', address: 'Hodan', parentName: 'St Admit Parent', parentPhoneNumber: '0616661112',
      guardian: { mode: 'new', name: `St Admit Parent ${firstName}`, relationship: 'Mother', phone: `06166611${firstName.length}${firstName.charCodeAt(2)}` },
    });

    it('uses the school code and its own running number, carrying on from numbers already used', async () => {
      const year = new Date().getFullYear();
      await Student.create(studentData('Pre', { admissionNumber: `ST-${year}-0007`, classId: c.g6._id }));
      const ref = await request(app).get('/api/students/references/all').set('Authorization', admin());
      expect(ref.body.data.nextAdmissionNumber).toBe(`ST-${year}-0008`);

      const first = await register('Stone');
      expect(first.status).toBe(201);
      expect(first.body.data.admissionNumber).toBe(`ST-${year}-0008`);
      const second = await register('Sttwo');
      expect(second.body.data.admissionNumber).toBe(`ST-${year}-0009`);
    });
  });

  describe('parents', () => {
    beforeAll(async () => {
      await ensureFeeIndexes();
      c.family = await Family.create({ familyName: 'ST Family', primaryContactPhone: '0616669999' });
      c.guardian = await Guardian.create({ familyId: c.family._id, name: 'St Family Mother', relationship: 'Mother', phone: '0616669999' });
      const kid = (n, classId, sectionId) => Student.create({
        ...studentData(`Fam${n}`, { classId, sectionId, lastName: 'Family', familyId: c.family._id }),
        guardians: [{ guardianId: c.guardian._id }],
      });
      c.k1 = await kid(1, c.g5._id, c.a._id);
      c.k2 = await kid(2, c.g6._id, null);
      await request(app).put(`/api/fees/class-fees/${c.g5._id}`).set('Authorization', admin()).send({ amount: 20 });
      await request(app).put(`/api/fees/class-fees/${c.g6._id}`).set('Authorization', admin()).send({ amount: 30 });
      await request(app).post('/api/fees/charge').set('Authorization', admin()).send({ period: currentPeriod(), class_id: String(c.g6._id) });
      c.evc = await PaymentMethod.create({ payment_method_no: 'ST-EVC', payment_method_name: 'EVC Plus' });
    }, 60000);

    it('creates a portal login for a parent who has none', async () => {
      const res = await request(app).post(`/api/parents/${c.guardian._id}/login`).set('Authorization', admin()).send({ email: 'mother@st-family.test' });
      expect(res.status).toBe(201);
      expect(res.body.data.temporaryPassword).toEqual(expect.any(String));
      const login = await request(app).post('/api/auth/login').send({ email: 'mother@st-family.test', password: res.body.data.temporaryPassword });
      expect(login.status).toBe(200);
      expect(login.body.data.user.mustChangePassword).toBe(true);
      c.parentToken = `Bearer ${login.body.data.accessToken}`;
      // The parent picks their own password first (see userOnboarding.test.js).
      const changed = await request(app).post('/api/auth/change-password').set('Authorization', c.parentToken)
        .send({ currentPassword: res.body.data.temporaryPassword, newPassword: 'mother-own-password' });
      expect(changed.status).toBe(200);

      const twice = await request(app).post(`/api/parents/${c.guardian._id}/login`).set('Authorization', admin()).send({ email: 'other@st-family.test' });
      expect(twice.status).toBe(409);
      expect((await request(app).post(`/api/parents/${c.guardian._id}/login`).set('Authorization', teacher()).send({})).status).toBe(403);
    });

    it('shows the whole family together', async () => {
      const res = await request(app).get('/api/portal/parent/family').set('Authorization', c.parentToken);
      expect(res.status).toBe(200);
      expect(res.body.data.children.map((k) => k.name).sort()).toEqual(['StFam1 Family', 'StFam2 Family']);
      expect(res.body.data.totals.balance).toBe(30);
    });

    it('quotes paying ahead for several children', async () => {
      const through = addMonths(currentPeriod(), 2);
      const res = await request(app).get('/api/portal/parent/pay-quote').set('Authorization', c.parentToken)
        .query({ students: `${c.k1._id},${c.k2._id}`, through });
      expect(res.status).toBe(200);
      const byName = Object.fromEntries(res.body.data.children.map((k) => [k.name, k]));
      expect(byName['StFam1 Family']).toMatchObject({ owed: 0, monthly: 20, ahead: 60, total: 60 });
      expect(byName['StFam2 Family']).toMatchObject({ owed: 30, monthly: 30, ahead: 60, total: 90 });
      expect(res.body.data.total).toBe(150);

      const stranger = await Student.create(studentData('Stranger', { classId: c.g6._id }));
      const refused = await request(app).get('/api/portal/parent/pay-quote').set('Authorization', c.parentToken).query({ students: String(stranger._id), through });
      expect(refused.status).toBe(403);
    });

    it('sends one payment for two children ahead, and the office applies it', async () => {
      const through = addMonths(currentPeriod(), 2);
      const sent = await request(app).post(`/api/portal/parent/children/${c.k1._id}/payments`).set('Authorization', c.parentToken).send({
        amount: 150, method: String(c.evc._id), reference: 'ST-REF-1', paidOn: new Date().toISOString().slice(0, 10),
        students: [String(c.k1._id), String(c.k2._id)], pay_through: through,
      });
      expect(sent.status).toBe(201);
      expect(sent.body.data.pay_through).toBe(through);
      expect(sent.body.data.students).toHaveLength(2);

      const confirm = await request(app).post(`/api/fees/payment-claims/${sent.body.data._id}/confirm`).set('Authorization', admin()).send({});
      expect(confirm.status).toBe(201);
      const left = await StudentInvoice.aggregate([{ $match: { student: { $in: [c.k1._id, c.k2._id] } } }, { $group: { _id: null, n: { $sum: 1 }, owed: { $sum: '$balance' } } }]);
      expect(left[0]).toMatchObject({ n: 6, owed: 0 });

      const k2History = await request(app).get(`/api/portal/parent/children/${c.k2._id}/payments`).set('Authorization', c.parentToken);
      expect(k2History.body.data.map((h) => h.reference)).toContain('ST-REF-1');
    });
  });
});
