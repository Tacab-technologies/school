import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/server.js';
import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import Year from '../src/models/Year.js';
import Term from '../src/models/Term.js';
import Class from '../src/models/Class.js';
import Section from '../src/models/Section.js';
import Subject from '../src/models/Subject.js';
import Student from '../src/models/Student.js';
import Guardian from '../src/models/Guardian.js';
import Family from '../src/models/Family.js';
import Exam from '../src/models/Exam.js';
import Mark from '../src/models/Mark.js';
import Period from '../src/models/Period.js';
import StudentAttendance from '../src/models/StudentAttendance.js';

// The parent portal's "All children" view: one call gives every child's
// attendance (with the last days missed), fees and latest result, and a parent
// only ever sees results the school has published.
const secret = () => process.env.JWT_ACCESS_SECRET || 'default_access_secret_key_12345';
const bearer = (id, role) => `Bearer ${jwt.sign({ id: id.toString(), role }, secret())}`;
const ids = { admin: new mongoose.Types.ObjectId(), parent: new mongoose.Types.ObjectId(), stranger: new mongoose.Types.ObjectId() };
const emails = ['fv.admin@test.com', 'fv.parent@test.com', 'fv.stranger@test.com'];
const c = {};

const studentData = (n, extra) => ({
  firstName: `Fv${n}`, lastName: 'Family', admissionNumber: `FV-${n}`, gender: 'Female', birthDate: new Date('2014-01-01'),
  phoneNumber: '0617770000', address: 'Hodan', parentName: 'Fv Parent', parentPhoneNumber: '0617770001', ...extra,
});

describe('Parent portal: all children on one page', () => {
  const admin = () => bearer(ids.admin, 'admin');
  const parent = () => bearer(ids.parent, 'parent');
  const stranger = () => bearer(ids.stranger, 'parent');

  beforeAll(async () => {
    await User.deleteMany({ email: { $in: emails } });
    await User.create([
      { _id: ids.admin, firstName: 'Fv', lastName: 'Admin', email: emails[0], password: 'password123', role: 'admin' },
      { _id: ids.parent, firstName: 'Fv', lastName: 'Parent', email: emails[1], password: 'password123', role: 'parent' },
      { _id: ids.stranger, firstName: 'Fv', lastName: 'Stranger', email: emails[2], password: 'password123', role: 'parent' },
    ]);
    c.level = await Level.create({ lev_no: 'FV-L', lev_name: 'Fv level' });
    c.year = await Year.create({ y_no: 'FV-Y1', y_name: 'Fv year' });
    c.term1 = await Term.create({ name: 'FV term 1', academicYearId: c.year._id, status: 'inactive', startDate: new Date('2026-01-01') });
    c.term2 = await Term.create({ name: 'FV term 2', academicYearId: c.year._id, status: 'active', startDate: new Date('2026-05-01') });
    c.g4 = await Class.create({ cl_no: 'FV-G4', cl_name: 'FV Grade 4', lev_no: c.level._id });
    c.a = await Section.create({ name: 'A', class: c.g4._id });
    c.math = await Subject.create({ sub_no: 'FV-S1', sub_name: 'FV Maths', classId: c.g4._id });

    c.family = await Family.create({ familyName: 'FV Family', primaryContactPhone: '0617779999' });
    c.guardian = await Guardian.create({ familyId: c.family._id, userId: ids.parent, name: 'Fv Mother', relationship: 'Mother', phone: '0617779999' });
    await Guardian.create({ familyId: c.family._id, userId: ids.stranger, name: 'Fv Stranger', relationship: 'Uncle', phone: '0617778888' });
    const kid = (n, extra) => Student.create({ ...studentData(n, { familyId: c.family._id, ...extra }), guardians: [{ guardianId: c.guardian._id }] });
    c.k1 = await kid(1, { classId: c.g4._id, sectionId: c.a._id });
    c.k2 = await kid(2, { classId: c.g4._id, sectionId: c.a._id });

    // Term 1's exam is published; term 2's (newer) is not yet.
    c.published = await Exam.create({ name: 'FV Final', termId: c.term1._id, yearId: c.year._id, maxMarks: 100, classIds: [c.g4._id], published: true, publishedAt: new Date() });
    c.draft = await Exam.create({ name: 'FV Midterm', termId: c.term2._id, yearId: c.year._id, maxMarks: 100, classIds: [c.g4._id] });
    await Mark.create([
      { examId: c.published._id, studentId: c.k1._id, subjectId: c.math._id, classId: c.g4._id, sectionId: c.a._id, score: 80 },
      { examId: c.draft._id, studentId: c.k1._id, subjectId: c.math._id, classId: c.g4._id, sectionId: c.a._id, score: 40 },
    ]);

    c.period = await Period.create({ termId: c.term2._id, per_no: 'FV-P1', per_name: 'FV Lesson 1', time_in: '08:00', time_out: '08:40' });
    const mark = (studentId, day, status) => ({ studentId, periodId: c.period._id, status, att_date: new Date(`2026-10-${day}T00:00:00Z`) });
    await StudentAttendance.create([
      mark(c.k1._id, '01', 'Present'), mark(c.k1._id, '02', 'Absent'), mark(c.k1._id, '03', 'Late'),
      mark(c.k1._id, '04', 'Absent'), mark(c.k1._id, '05', 'Absent'), mark(c.k1._id, '06', 'Absent'),
    ]);
  }, 180000);

  afterAll(async () => {
    const studentIds = [c.k1?._id, c.k2?._id].filter(Boolean);
    await Promise.all([
      User.deleteMany({ email: { $in: emails } }),
      Level.deleteMany({ lev_no: 'FV-L' }),
      Year.deleteMany({ y_no: 'FV-Y1' }),
      Term.deleteMany({ name: { $in: ['FV term 1', 'FV term 2'] } }),
      Class.deleteMany({ cl_no: 'FV-G4' }),
      Section.deleteMany({ _id: c.a?._id }),
      Subject.deleteMany({ sub_no: 'FV-S1' }),
      Student.deleteMany({ _id: { $in: studentIds } }),
      Guardian.deleteMany({ familyId: c.family?._id }),
      Family.deleteMany({ familyName: 'FV Family' }),
      Exam.deleteMany({ termId: { $in: [c.term1?._id, c.term2?._id] } }),
      Mark.deleteMany({ studentId: { $in: studentIds } }),
      Period.deleteMany({ per_no: 'FV-P1' }),
      StudentAttendance.deleteMany({ studentId: { $in: studentIds } }),
    ]);
  }, 180000);

  it('gives every child with class, attendance, the last days missed and fees', async () => {
    const res = await request(app).get('/api/portal/parent/family').set('Authorization', parent());
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.children.map((k) => [k.name, k]));
    expect(Object.keys(byName).sort()).toEqual(['Fv1 Family', 'Fv2 Family']);

    const k1 = byName['Fv1 Family'];
    expect(k1).toMatchObject({ className: 'FV Grade 4', sectionName: 'A', photoUrl: null });
    expect(k1.attendance).toMatchObject({ total: 6, absent: 4, late: 1, rate: 33 });
    // Newest three absences, newest first, with the lesson's name.
    expect(k1.attendance.recentAbsences.map((a) => a.date.slice(0, 10))).toEqual(['2026-10-06', '2026-10-05', '2026-10-04']);
    expect(k1.attendance.recentAbsences[0].lesson).toBe('FV Lesson 1');

    expect(byName['Fv2 Family'].attendance).toMatchObject({ total: 0, rate: null, recentAbsences: [] });
    expect(res.body.data.totals).toEqual({ invoiced: 0, paid: 0, balance: 0 });
  });

  it('shows a parent only the latest published result', async () => {
    const res = await request(app).get('/api/portal/parent/family').set('Authorization', parent());
    const byName = Object.fromEntries(res.body.data.children.map((k) => [k.name, k]));
    // Term 2 is newer but unpublished, so the parent sees term 1's 80%.
    expect(byName['Fv1 Family'].latestResult).toMatchObject({ term: { name: 'FV term 1' }, percent: 80, subjects: 1 });
    expect(byName['Fv1 Family'].latestResult.grade).toMatchObject({ grade: expect.any(String), passed: true });
    expect(byName['Fv2 Family'].latestResult).toBeNull();
  });

  it('hides a result entirely when nothing is published yet', async () => {
    await Exam.updateOne({ _id: c.published._id }, { published: false });
    try {
      const res = await request(app).get('/api/portal/parent/family').set('Authorization', parent());
      expect(res.body.data.children.every((k) => k.latestResult === null)).toBe(true);
    } finally {
      await Exam.updateOne({ _id: c.published._id }, { published: true });
    }
  });

  it('lets staff viewing the parent see the newest result, published or not', async () => {
    const res = await request(app).get(`/api/portal/parent/${c.guardian._id}/family`).set('Authorization', admin());
    expect(res.status).toBe(200);
    const k1 = res.body.data.children.find((k) => k.name === 'Fv1 Family');
    expect(k1.latestResult).toMatchObject({ term: { name: 'FV term 2' }, percent: 40 });
  });

  it('never shows another family', async () => {
    const res = await request(app).get('/api/portal/parent/family').set('Authorization', stranger());
    expect(res.status).toBe(200);
    expect(res.body.data.children).toEqual([]);
    const staffOnly = await request(app).get(`/api/portal/parent/${c.guardian._id}/family`).set('Authorization', stranger());
    expect(staffOnly.status).toBe(403);
  });
});
