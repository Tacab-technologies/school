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
import TeacherAssignment from '../src/models/TeacherAssignment.js';
import Exam from '../src/models/Exam.js';
import Mark from '../src/models/Mark.js';

// jest.globalSetup/jest.setup always point MONGODB_URI at SMS_Test and drop it.
// Set PRIVATE_TEST_DB (e.g. mongodb://127.0.0.1:27017/SMS_Test_marks) to run
// this suite in its own database instead, so it can't collide with suites
// running at the same time.
if (process.env.PRIVATE_TEST_DB && mongoose.connection.readyState === 0) {
  await mongoose.connect(process.env.PRIVATE_TEST_DB, { serverSelectionTimeoutMS: 8000 });
}

// Teachers entering marks: only this term's lessons, students without a
// section, the exam list, marking progress and the marks/results reports.
const secret = () => process.env.JWT_ACCESS_SECRET || 'default_access_secret_key_12345';
const bearer = (id, role) => `Bearer ${jwt.sign({ id: id.toString(), role }, secret())}`;
const ids = { admin: new mongoose.Types.ObjectId(), teacher: new mongoose.Types.ObjectId(), principal: new mongoose.Types.ObjectId() };
const emails = ['em.admin@test.com', 'em.teacher@test.com', 'em.principal@test.com'];
const c = {};

const studentData = (n, extra) => ({
  firstName: `Em${n}`, lastName: 'Student', admissionNumber: `EM-${n}`, gender: 'Male', birthDate: new Date('2012-01-01'),
  phoneNumber: '0615550000', address: 'Hodan', parentName: 'Parent', parentPhoneNumber: '0615550001', ...extra,
});

describe('Teacher mark entry and exam reports', () => {
  const admin = () => bearer(ids.admin, 'admin');
  const teacher = () => bearer(ids.teacher, 'teacher');
  const principal = () => bearer(ids.principal, 'principal');
  const sheetA = () => ({ classId: String(c.g7._id), sectionId: String(c.a._id), subjectId: String(c.math._id) });

  beforeAll(async () => {
    await User.deleteMany({ email: { $in: emails } });
    await User.create([
      { _id: ids.admin, firstName: 'Em', lastName: 'Admin', email: emails[0], password: 'password123', role: 'admin' },
      { _id: ids.teacher, firstName: 'Em', lastName: 'Teacher', email: emails[1], password: 'password123', role: 'teacher' },
      { _id: ids.principal, firstName: 'Em', lastName: 'Principal', email: emails[2], password: 'password123', role: 'principal' },
    ]);
    c.teacher = await Teacher.create({ userId: ids.teacher, staffId: 'EM-T1' });
    c.level = await Level.create({ lev_no: 'EM-L', lev_name: 'Em level' });
    c.year = await Year.create({ y_no: 'EM-Y1', y_name: 'Em year' });
    c.oldTerm = await Term.create({ name: 'EM term 1', academicYearId: c.year._id, status: 'inactive', startDate: new Date('2026-01-01') });
    c.term = await Term.create({ name: 'EM term 2', academicYearId: c.year._id, status: 'active', startDate: new Date('2026-05-01') });
    c.g7 = await Class.create({ cl_no: 'EM-G7', cl_name: 'EM Grade 7', lev_no: c.level._id });
    c.g8 = await Class.create({ cl_no: 'EM-G8', cl_name: 'EM Grade 8', lev_no: c.level._id });
    c.a = await Section.create({ name: 'A', class: c.g7._id });
    c.b = await Section.create({ name: 'B', class: c.g7._id });
    c.a8 = await Section.create({ name: 'A', class: c.g8._id });
    c.math = await Subject.create({ sub_no: 'EM-S1', sub_name: 'EM Maths', subjectCode: 'MTH', classId: c.g7._id });
    c.sci = await Subject.create({ sub_no: 'EM-S2', sub_name: 'EM Science', subjectCode: 'SCI', classId: c.g7._id });
    c.s1 = await Student.create(studentData(1, { classId: c.g7._id, sectionId: c.a._id }));
    c.s2 = await Student.create(studentData(2, { classId: c.g7._id, sectionId: c.a._id }));
    c.s3 = await Student.create(studentData(3, { classId: c.g7._id, sectionId: c.b._id }));
    c.s4 = await Student.create(studentData(4, { classId: c.g7._id })); // never given a section
    c.s5 = await Student.create(studentData(5, { classId: c.g8._id, sectionId: c.a8._id }));
    // This term: Grade 7 A maths. Last term only: Grade 8 A maths.
    await TeacherAssignment.create([
      { teacherId: c.teacher._id, subjectId: c.math._id, classId: c.g7._id, sectionId: c.a._id, termId: c.term._id },
      { teacherId: c.teacher._id, subjectId: c.math._id, classId: c.g8._id, sectionId: c.a8._id, termId: c.oldTerm._id },
    ]);
    c.exam = await Exam.create({ name: 'EM Midterm', termId: c.term._id, yearId: c.year._id, maxMarks: 40, classIds: [c.g7._id] });
    c.exam8 = await Exam.create({ name: 'EM Grade 8 test', termId: c.term._id, yearId: c.year._id, maxMarks: 20, classIds: [c.g8._id] });
  }, 180000);

  afterAll(async () => {
    const students = [c.s1, c.s2, c.s3, c.s4, c.s5].filter(Boolean).map((s) => s._id);
    await Promise.all([
      User.deleteMany({ email: { $in: emails } }),
      Teacher.deleteMany({ staffId: 'EM-T1' }),
      Level.deleteMany({ lev_no: 'EM-L' }),
      Year.deleteMany({ y_no: 'EM-Y1' }),
      Term.deleteMany({ name: { $in: ['EM term 1', 'EM term 2'] } }),
      Class.deleteMany({ cl_no: { $in: ['EM-G7', 'EM-G8'] } }),
      Section.deleteMany({ _id: { $in: [c.a, c.b, c.a8].filter(Boolean).map((s) => s._id) } }),
      Subject.deleteMany({ sub_no: { $in: ['EM-S1', 'EM-S2'] } }),
      Student.deleteMany({ _id: { $in: students } }),
      TeacherAssignment.deleteMany({ teacherId: c.teacher?._id }),
      Exam.deleteMany({ termId: { $in: [c.term?._id, c.oldTerm?._id] } }),
      Mark.deleteMany({ studentId: { $in: students } }),
    ]);
  }, 180000);

  it("lists for a teacher only the exams with a class they teach this term", async () => {
    const mine = await request(app).get('/api/exams').set('Authorization', teacher());
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((e) => e.name)).toEqual(['EM Midterm']);
    const all = await request(app).get('/api/exams').set('Authorization', admin());
    expect(all.body.data.map((e) => e.name)).toEqual(expect.arrayContaining(['EM Midterm', 'EM Grade 8 test']));
  });

  it("refuses last term's classes", async () => {
    const opts = await request(app).get(`/api/exams/${c.exam8._id}/options`).set('Authorization', teacher());
    expect(opts.status).toBe(200);
    expect(opts.body.data.pairs).toEqual([]);
    const save = await request(app).put(`/api/exams/${c.exam8._id}/marks`).set('Authorization', teacher())
      .send({ classId: c.g8._id, sectionId: c.a8._id, subjectId: c.math._id, marks: [{ studentId: c.s5._id, score: 10 }] });
    expect(save.status).toBe(403);
  });

  it('puts a student without a section on the section sheet and saves the mark without a section', async () => {
    const sheet = await request(app).get(`/api/exams/${c.exam._id}/marksheet`).set('Authorization', teacher()).query(sheetA());
    expect(sheet.status).toBe(200);
    const rows = sheet.body.data.rows;
    expect(rows.map((r) => r.name).sort()).toEqual(['Em1 Student', 'Em2 Student', 'Em4 Student']);
    expect(rows.find((r) => r.studentId === String(c.s4._id)).noSection).toBe(true);

    const save = await request(app).put(`/api/exams/${c.exam._id}/marks`).set('Authorization', teacher())
      .send({ ...sheetA(), marks: [{ studentId: c.s1._id, score: 36 }, { studentId: c.s4._id, score: 18.5 }, { studentId: c.s2._id, absent: true }] });
    expect(save.status).toBe(200);
    expect(save.body.data.saved).toBe(3);

    const unsectioned = await Mark.findOne({ studentId: c.s4._id }).lean();
    expect(unsectioned.sectionId).toBeNull();
    expect(String((await Mark.findOne({ studentId: c.s1._id }).lean()).sectionId)).toBe(String(c.a._id));

    // And they reload.
    const again = await request(app).get(`/api/exams/${c.exam._id}/marksheet`).set('Authorization', teacher()).query(sheetA());
    const byId = Object.fromEntries(again.body.data.rows.map((r) => [r.studentId, r]));
    expect(byId[c.s1._id].score).toBe(36);
    expect(byId[c.s4._id].score).toBe(18.5);
    expect(byId[c.s2._id].absent).toBe(true);
  });

  it("refuses a section that isn't in the class", async () => {
    const res = await request(app).get(`/api/exams/${c.exam._id}/marksheet`).set('Authorization', admin())
      .query({ classId: String(c.g7._id), sectionId: String(c.a8._id), subjectId: String(c.math._id) });
    expect(res.status).toBe(400);
  });

  it('gives the office every subject with the classes it is taught in', async () => {
    await Subject.updateOne({ _id: c.sci._id }, { $set: { classIds: [c.g7._id, c.g8._id] } });
    const res = await request(app).get(`/api/exams/${c.exam._id}/options`).set('Authorization', admin());
    expect(res.status).toBe(200);
    expect(res.body.data.pairs).toBeNull();
    const byName = Object.fromEntries(res.body.data.subjects.map((s) => [s.name, s]));
    expect(byName['EM Maths'].classIds).toEqual([String(c.g7._id)]); // old single classId still read
    expect(byName['EM Science'].classIds).toEqual([String(c.g7._id), String(c.g8._id)]);
  });

  it('shows the teacher how far their marking has got', async () => {
    const res = await request(app).get(`/api/exams/${c.exam._id}/progress`).set('Authorization', teacher());
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toEqual([expect.objectContaining({
      className: 'EM Grade 7', sectionName: 'A', subjectName: 'EM Maths', students: 3, marked: 3, remaining: 0,
    })]);
  });

  it('gives a teacher their own classes for the results tab', async () => {
    const res = await request(app).get('/api/exams/teaching').set('Authorization', teacher()).query({ termId: String(c.term._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.pairs).toEqual([{ classId: String(c.g7._id), sectionId: String(c.a._id) }]);
    const staff = await request(app).get('/api/exams/teaching').set('Authorization', admin());
    expect(staff.body.data.pairs).toBeNull();
  });

  it('lists the marks reports for the right roles', async () => {
    const mine = await request(app).get('/api/reports/catalog').set('Authorization', teacher());
    const ids1 = mine.body.data.flatMap((d) => d.groups.flatMap((g) => g.reports.map((r) => r.id)));
    expect(ids1).toEqual(expect.arrayContaining(['exam-my-class-results', 'exam-marking-progress']));
    expect(ids1).not.toContain('exam-student-results');
    const office = await request(app).get('/api/reports/catalog').set('Authorization', principal());
    const ids2 = office.body.data.flatMap((d) => d.groups.flatMap((g) => g.reports.map((r) => r.id)));
    expect(ids2).toEqual(expect.arrayContaining(['exam-results-by-class', 'exam-student-results']));
  });

  it("runs 'My class results' for a teacher's own lesson only", async () => {
    const res = await request(app).get('/api/reports/run/exam-my-class-results').set('Authorization', teacher())
      .query({ exam_id: String(c.exam._id), class_id: String(c.g7._id), subject_id: String(c.math._id) });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.rows.map((r) => [r.name, r]));
    expect(byName['Em1 Student']).toMatchObject({ score: 36, percent: 90, grade: 'A', status: 'Pass' });
    expect(byName['Em2 Student']).toMatchObject({ score: 'Absent', status: 'Absent' });
    expect(byName['Em4 Student']).toMatchObject({ score: 18.5, status: 'Fail' });

    const other = await request(app).get('/api/reports/run/exam-my-class-results').set('Authorization', teacher())
      .query({ exam_id: String(c.exam._id), class_id: String(c.g7._id), section_id: String(c.b._id), subject_id: String(c.math._id) });
    expect(other.status).toBe(403);
    const otherSubject = await request(app).get('/api/reports/run/exam-my-class-results').set('Authorization', teacher())
      .query({ exam_id: String(c.exam._id), class_id: String(c.g7._id), subject_id: String(c.sci._id) });
    expect(otherSubject.status).toBe(403);
    const noExam = await request(app).get('/api/reports/run/exam-my-class-results').set('Authorization', teacher());
    expect(noExam.status).toBe(400);
  });

  it('runs the marking progress report and exports it', async () => {
    const res = await request(app).get('/api/reports/run/exam-marking-progress').set('Authorization', teacher())
      .query({ exam_id: String(c.exam._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toEqual([expect.objectContaining({ className: 'EM Grade 7', marked: 3, status: 'Done' })]);
    const xlsx = await request(app).get('/api/reports/run/exam-marking-progress/export').set('Authorization', teacher())
      .query({ exam_id: String(c.exam._id), format: 'xlsx' }).buffer(true).parse((r, cb) => { const b = []; r.on('data', (d) => b.push(d)); r.on('end', () => cb(null, Buffer.concat(b))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.length).toBeGreaterThan(1000);
  });

  it('gives the office results by class and per student, with exports', async () => {
    await request(app).put(`/api/exams/${c.exam._id}/marks`).set('Authorization', admin())
      .send({ classId: c.g7._id, sectionId: c.b._id, subjectId: c.math._id, marks: [{ studentId: c.s3._id, score: 28 }] });

    const byClass = await request(app).get('/api/reports/run/exam-results-by-class').set('Authorization', principal())
      .query({ exam_id: String(c.exam._id) });
    expect(byClass.status).toBe(200);
    // Marked: 36/40=90, absent=0, 18.5/40=46.3, 28/40=70.
    expect(byClass.body.data.rows).toEqual([expect.objectContaining({
      className: 'EM Grade 7', subject: 'EM Maths', marked: 4, absent: 1, highest: 90, lowest: 0, passed: 2, failed: 2,
    })]);

    const students = await request(app).get('/api/reports/run/exam-student-results').set('Authorization', principal())
      .query({ exam_id: String(c.exam._id), class_id: String(c.g7._id) });
    expect(students.status).toBe(200);
    const [first, second] = students.body.data.rows;
    expect(first).toMatchObject({ position: 1, name: 'Em1 Student', percent: 90, grade: 'A', result: 'Pass' });
    expect(second).toMatchObject({ position: 2, name: 'Em3 Student', percent: 70 });
    expect(students.body.data.columns.map((col) => col.label)).toContain('MTH %');

    const pdf = await request(app).get('/api/reports/run/exam-student-results/export').set('Authorization', principal())
      .query({ exam_id: String(c.exam._id), class_id: String(c.g7._id), format: 'pdf' }).buffer(true).parse((r, cb) => { const b = []; r.on('data', (d) => b.push(d)); r.on('end', () => cb(null, Buffer.concat(b))); });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');

    const byTeacher = await request(app).get('/api/reports/run/exam-student-results').set('Authorization', teacher())
      .query({ exam_id: String(c.exam._id), class_id: String(c.g7._id) });
    expect(byTeacher.status).toBe(403);
  });

  it('locks published marks for the teacher', async () => {
    await request(app).patch(`/api/exams/${c.exam._id}/publish`).set('Authorization', admin()).send({ published: true });
    const sheet = await request(app).get(`/api/exams/${c.exam._id}/marksheet`).set('Authorization', teacher()).query(sheetA());
    expect(sheet.body.data.locked).toBe(true);
    const save = await request(app).put(`/api/exams/${c.exam._id}/marks`).set('Authorization', teacher())
      .send({ ...sheetA(), marks: [{ studentId: c.s1._id, score: 10 }] });
    expect(save.status).toBe(403);
    expect((await Mark.findOne({ studentId: c.s1._id }).lean()).score).toBe(36);
  });
});
