import { jest } from '@jest/globals';
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
import Period from '../src/models/Period.js';
import Student from '../src/models/Student.js';
import StudentClass from '../src/models/StudentClass.js';
import Guardian from '../src/models/Guardian.js';
import Family from '../src/models/Family.js';
import TeacherAssignment from '../src/models/TeacherAssignment.js';

// The school's System Testing 1.4 list: no duplicate school years, classes that
// start the new year empty until students are promoted, an optional student
// phone, ticking a teacher's classes, and adding teachers, parents and students
// through Add Many Users.
const secret = () => process.env.JWT_ACCESS_SECRET || 'default_access_secret_key_12345';
const bearer = (id, role) => `Bearer ${jwt.sign({ id: id.toString(), role }, secret())}`;
const DOMAIN = '@st14.test';
const mail = (name) => `${name}${DOMAIN}`;
const LAST = 'Sttest';
const adminId = new mongoose.Types.ObjectId();
const c = {};

const auth = (req) => req.set('Authorization', bearer(adminId, 'admin'));
const get = (url) => auth(request(app).get(url));
const post = (url, body) => auth(request(app).post(url)).send(body);
const put = (url, body) => auth(request(app).put(url)).send(body);

let phoneCounter = 0;
const parentPhone = () => { phoneCounter += 1; return `06148${String(phoneCounter).padStart(5, '0')}`; };
const registration = (firstName, extra = {}) => {
  const phone = parentPhone();
  return {
    firstName, lastName: LAST, gender: 'Female', birthDate: '2015-03-25', classId: String(c.g1._id), sectionId: String(c.a._id),
    phoneNumber: '0619990000', address: 'Hodan', parentName: 'St Parent', parentPhoneNumber: phone,
    guardian: { mode: 'new', name: `St Parent ${firstName}`, relationship: 'Father', phone }, ...extra,
  };
};
const seedStudent = (n, extra) => Student.create({
  firstName: `Seed${n}`, lastName: LAST, admissionNumber: `ST14-${n}`, gender: 'Male', birthDate: new Date('2014-01-01'),
  address: 'Hodan', parentName: 'St Parent', parentPhoneNumber: '0610000000', classId: c.g1._id, sectionId: c.a._id, ...extra,
});
const enrol = (student, year, cls = c.g1, section = c.a) => StudentClass.create({
  sc_no: `SC-${student._id}-${year._id}`, student: student._id, class: cls._id, section: section?._id ?? null, year: year._id,
});
const sectionCount = async (yearId) => {
  const res = await get(`/api/sections${yearId ? `?yearId=${yearId}` : ''}`);
  return res.body.data.find((s) => s._id === String(c.a._id)).studentCount;
};
const classCount = async (cls, yearId) => {
  const res = await get(`/api/classes${yearId ? `?yearId=${yearId}` : ''}`);
  return res.body.data.find((item) => item._id === String(cls._id)).studentCount;
};
const listed = async (query) => (await get(`/api/students?limit=100&search=${LAST}&${query}`)).body.data.students.map((s) => s.firstName).sort();

const cleanUp = async () => {
  const students = await Student.find({ lastName: LAST }).select('_id');
  await StudentClass.deleteMany({ student: { $in: students.map((s) => s._id) } });
  await Student.deleteMany({ lastName: LAST });
  const guardians = await Guardian.find({ $or: [{ name: /^St Parent/ }, { email: new RegExp(`${DOMAIN}$`) }] });
  await Family.deleteMany({ _id: { $in: guardians.map((g) => g.familyId) } });
  await Guardian.deleteMany({ _id: { $in: guardians.map((g) => g._id) } });
  const users = await User.find({ email: new RegExp(`${DOMAIN}$`) }).select('_id');
  const teachers = await Teacher.find({ userId: { $in: users.map((u) => u._id) } }).select('_id');
  await TeacherAssignment.deleteMany({ teacherId: { $in: teachers.map((t) => t._id) } });
  await Teacher.deleteMany({ _id: { $in: teachers.map((t) => t._id) } });
  await User.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  const years = await Year.find({ y_no: /^ST14/ }).select('_id');
  await Term.deleteMany({ academicYearId: { $in: years.map((y) => y._id) } });
  await Period.deleteMany({ per_no: /^ST14/ });
  await Year.deleteMany({ y_no: /^ST14/ });
  await Subject.deleteMany({ sub_no: /^ST14/ });
  await Section.deleteMany({ name: /^ST14/ });
  await Class.deleteMany({ cl_no: /^ST14/ });
  await Level.deleteMany({ lev_no: /^ST14/ });
};

describe('System Testing 1.4 fixes', () => {
  beforeAll(async () => {
    await cleanUp();
    await User.create({ _id: adminId, firstName: 'St', lastName: 'Admin', email: mail('admin'), password: 'password123', role: 'admin' });
    c.level = await Level.create({ lev_no: 'ST14-L', lev_name: 'St14 level' });
    c.oldYear = await Year.create({ y_no: 'ST14-Y1', y_name: 'St14 2025-2026' });
    c.newYear = await Year.create({ y_no: 'ST14-Y2', y_name: 'St14 2026-2027' });
    await Term.create({ name: 'ST14 old term', academicYearId: c.oldYear._id, status: 'inactive', startDate: new Date('2098-01-01') });
    // Far in the future, so it stays the current term whatever else is in the test database.
    c.term = await Term.create({ name: 'ST14 term', academicYearId: c.newYear._id, status: 'active', startDate: new Date('2099-01-01') });
    c.g1 = await Class.create({ cl_no: 'ST14-G1', cl_name: 'ST14 Grade 1', lev_no: c.level._id });
    c.g2 = await Class.create({ cl_no: 'ST14-G2', cl_name: 'ST14 Grade 2', lev_no: c.level._id }); // no sections
    c.a = await Section.create({ name: 'ST14 A', class: c.g1._id, capacity: 2 });
    c.b = await Section.create({ name: 'ST14 B', class: c.g1._id });
  });

  afterAll(cleanUp);

  describe('School years', () => {
    it('refuses a year that already exists, however it is written', async () => {
      const first = await post('/api/years', { y_no: 'ST14-D1', y_name: ' St14 2030-2031 ' });
      expect(first.status).toBe(201);
      expect(first.body.data.y_name).toBe('St14 2030-2031');

      for (const y_name of ['St14 2030-2031', '  st14 2030-2031', 'ST14 2030/2031', 'St14 2030 - 2031']) {
        const again = await post('/api/years', { y_no: 'ST14-D2', y_name });
        expect(again.status).toBe(409);
        expect(again.body.message).toMatch(/already exists/);
      }
      expect(await Year.countDocuments({ y_no: 'ST14-D2' })).toBe(0);

      const sameCode = await post('/api/years', { y_no: 'st14-d1', y_name: 'St14 2031-2032' });
      expect(sameCode.status).toBe(409);
      expect(sameCode.body.message).toMatch(/year code/);
    });

    it('refuses renaming a year to one that exists, but not saving it unchanged', async () => {
      const other = await post('/api/years', { y_no: 'ST14-D3', y_name: 'St14 2032-2033' });
      const renamed = await put(`/api/years/${other.body.data._id}`, { y_no: 'ST14-D3', y_name: 'st14 2030/2031' });
      expect(renamed.status).toBe(409);
      expect((await Year.findById(other.body.data._id)).y_name).toBe('St14 2032-2033');

      expect((await put(`/api/years/${other.body.data._id}`, { y_no: 'ST14-D3', y_name: 'St14 2032-2033' })).status).toBe(200);
      expect((await put(`/api/years/${other.body.data._id}`, { y_no: 'ST14-D3', y_name: 'St14 2033-2034' })).status).toBe(200);
      expect((await post('/api/years', { y_no: 'ST14-D4', y_name: 'St14 2032-2033' })).status).toBe(201); // the old name is free again
    });

    it('still works with duplicates saved before the rule existed', async () => {
      const [one, two] = await Year.create([{ y_no: 'ST14-O1', y_name: 'St14 old dup' }, { y_no: 'ST14-O2', y_name: 'St14 old dup' }]);
      expect((await post('/api/years', { y_no: 'ST14-O3', y_name: 'St14 OLD DUP' })).status).toBe(409);
      expect((await put(`/api/years/${one._id}`, { y_no: 'ST14-O1b', y_name: 'St14 old dup' })).status).toBe(200);
      expect((await put(`/api/years/${two._id}`, { y_name: 'St14 no longer dup' })).status).toBe(200);
    });

    it('lets the database itself refuse a second year with the same key', async () => {
      const key = 'st14-key-guard';
      await Year.create({ y_no: 'ST14-K1', y_name: 'k', nameKey: key });
      await expect(Year.create({ y_no: 'ST14-K2', y_name: 'k2', nameKey: key })).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('Classes in a new school year', () => {
    beforeAll(async () => {
      c.old1 = await seedStudent(1);
      c.old2 = await seedStudent(2);
      await enrol(c.old1, c.oldYear);
      await enrol(c.old2, c.oldYear);
    });

    it('starts empty: last year\'s students stay under last year', async () => {
      expect(await sectionCount()).toBe(0);
      expect(await classCount(c.g1)).toBe(0);
      expect(await sectionCount(c.newYear._id)).toBe(0);
      expect(await sectionCount(c.oldYear._id)).toBe(2);
      expect(await classCount(c.g1, c.oldYear._id)).toBe(2);

      const reference = await get('/api/students/references/all');
      expect(reference.body.data.sections.find((s) => s._id === String(c.a._id)).studentCount).toBe(0);
      const lastYear = await get(`/api/students/references/all?yearId=${c.oldYear._id}`);
      expect(lastYear.body.data.sections.find((s) => s._id === String(c.a._id)).studentCount).toBe(2);
    });

    it('takes a new student into a section last year filled, enrolled in the current year', async () => {
      const res = await post('/api/students', registration('Newone'));
      expect(res.status).toBe(201);
      const enrolments = await StudentClass.find({ student: res.body.data._id }).lean();
      expect(enrolments).toHaveLength(1);
      expect(enrolments[0]).toMatchObject({ class: c.g1._id, section: c.a._id, year: c.newYear._id });
      expect(await sectionCount()).toBe(1);
      expect(await sectionCount(c.oldYear._id)).toBe(2);
    });

    it('fills up by this year\'s students only', async () => {
      expect((await post('/api/students', registration('Newtwo'))).status).toBe(201);
      const full = await post('/api/students', registration('Newthree'));
      expect(full.status).toBe(409);
      expect(full.body.message).toMatch(/is full \(2 of 2 places\)/);
    });

    it('applies the same count to moving a student and to the spreadsheet check', async () => {
      const moving = await post('/api/students', registration('Mover', { sectionId: String(c.b._id) }));
      expect(moving.status).toBe(201);
      const refused = await put(`/api/students/${moving.body.data._id}`, { sectionId: String(c.a._id) });
      expect(refused.status).toBe(409);

      const check = await post('/api/students/import', {
        dryRun: true,
        rows: [{ 'First name': 'Sheet', 'Last name': LAST, Gender: 'F', 'Date of birth': '25/03/2015', Class: 'ST14 Grade 1', Section: 'ST14 A', Address: 'Hodan', 'Parent name': 'St Parent Sheet', 'Parent phone': parentPhone() }],
      });
      expect(check.body.data.rows[0].errors.join(' ')).toMatch(/is full/);
    });

    it('lists each year\'s class by its enrolments, like the counts', async () => {
      const inClass = `classId=${c.g1._id}&sectionId=${c.a._id}`;
      expect(await listed(`yearId=${c.newYear._id}&${inClass}`)).toEqual(['Newone', 'Newtwo']);
      expect(await listed(`yearId=${c.oldYear._id}&${inClass}`)).toEqual(['Seed1', 'Seed2']);
    });

    it('counts a student with no enrolment at all in the current year only', async () => {
      c.legacy = await seedStudent(3, { sectionId: c.b._id });
      const before = await classCount(c.g1);
      expect(await classCount(c.g1, c.oldYear._id)).toBe(2);
      expect((await listed(`yearId=${c.newYear._id}&classId=${c.g1._id}&sectionId=${c.b._id}`))).toContain('Seed3');
      expect(before).toBe(4); // Newone, Newtwo, Mover and Seed3
    });

    it('moves students by promotion, and leaves last year\'s count alone', async () => {
      const res = await post('/api/promotion', {
        toYearId: String(c.newYear._id),
        rules: [{ classId: String(c.g1._id), action: 'repeat' }],
        exceptions: { [String(c.old2._id)]: 'leave' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.repeated).toBeGreaterThanOrEqual(1);
      // Seed1 repeats into a section already full with this year's two students.
      expect(res.body.data.warnings.join(' ')).toMatch(/ST14 Grade 1 ST14 A now has more students/);

      expect(await sectionCount()).toBe(3); // Newone, Newtwo and Seed1
      expect(await listed(`yearId=${c.newYear._id}&classId=${c.g1._id}&sectionId=${c.a._id}`)).toEqual(['Newone', 'Newtwo', 'Seed1']);
      expect(await sectionCount(c.oldYear._id)).toBe(1); // Seed2 has left, Seed1 is still last year's
    });
  });

  describe('A student\'s phone is optional', () => {
    it('registers a student with no phone, or an empty one', async () => {
      const section = { sectionId: String(c.b._id) };
      const body = registration('Nophone', section);
      delete body.phoneNumber;
      const none = await post('/api/students', body);
      expect(none.status).toBe(201);
      expect(none.body.data.phoneNumber).toBeUndefined();

      const empty = await post('/api/students', registration('Emptyphone', { ...section, phoneNumber: '' }));
      expect(empty.status).toBe(201);
    });

    it('still refuses a number that is too short, and lets one be cleared', async () => {
      const short = await post('/api/students', registration('Shortphone', { sectionId: String(c.b._id), phoneNumber: '123' }));
      expect(short.status).toBe(400);
      expect(short.body.message).toMatch(/valid phone number/);

      const student = await Student.findOne({ firstName: 'Mover', lastName: LAST });
      const cleared = await put(`/api/students/${student._id}`, { phoneNumber: '' });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.phoneNumber).toBe('');
    });

    it('imports a student with no phone', async () => {
      const res = await post('/api/students/import', {
        dryRun: false,
        rows: [{ 'First name': 'Sheetnophone', 'Last name': LAST, Gender: 'F', 'Date of birth': '25/03/2015', Class: 'ST14 Grade 1', Section: 'ST14 B', Address: 'Hodan', 'Parent name': 'St Parent Sheet', 'Parent phone': parentPhone() }],
      });
      expect(res.body.data.created).toBe(1);
    });
  });

  describe('Ticking a teacher\'s classes and subjects', () => {
    const save = (items, termId = c.term._id, teacherId = c.teacher._id) => put(`/api/teachers/${teacherId}/assignments/bulk`, { termId: String(termId), items });
    const item = (subject, cls, section = null) => ({ subjectId: String(subject._id), classId: String(cls._id), sectionId: section ? String(section._id) : null });
    const held = async () => (await TeacherAssignment.find({ teacherId: c.teacher._id, termId: c.term._id }).lean())
      .map((a) => `${a.subjectId}|${a.classId}|${a.sectionId ?? ''}`).sort();
    const key = (subject, cls, section = null) => `${subject._id}|${cls._id}|${section?._id ?? ''}`;

    beforeAll(async () => {
      const user = await User.create({ firstName: 'Tick', lastName: 'Teacher', email: mail('tick'), password: 'password123', role: 'teacher' });
      c.teacher = await Teacher.create({ userId: user._id, staffId: 'ST14-T1' });
      c.math = await Subject.create({ sub_no: 'ST14-S1', sub_name: 'ST14 Maths' }); // every class
      c.sci = await Subject.create({ sub_no: 'ST14-S2', sub_name: 'ST14 Science', classIds: [c.g1._id] });
      c.period = await Period.create({ per_no: 'ST14-P1', per_name: 'ST14 P1', termId: c.term._id, time_in: '08:00', time_out: '08:40' });
    });

    it('adds every ticked box in one save, without timetable slots', async () => {
      const res = await save([item(c.math, c.g1, c.a), item(c.math, c.g1, c.b), item(c.sci, c.g1, c.a), item(c.math, c.g2)]);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ added: 4, removed: 0, kept: 0 });
      expect(await held()).toEqual([key(c.math, c.g1, c.a), key(c.math, c.g1, c.b), key(c.sci, c.g1, c.a), key(c.math, c.g2)].sort());
      expect(res.body.data.assignments.every((a) => a.timetableSlots.length === 0)).toBe(true);
    });

    it('removes what was unticked, keeps the lessons of what stays, and accepts the same save twice', async () => {
      await TeacherAssignment.updateOne(
        { teacherId: c.teacher._id, subjectId: c.math._id, classId: c.g1._id, sectionId: c.a._id },
        { timetableSlots: [{ day: 'Monday', periodId: c.period._id }] },
      );
      await TeacherAssignment.updateOne(
        { teacherId: c.teacher._id, subjectId: c.sci._id, classId: c.g1._id, sectionId: c.a._id },
        { timetableSlots: [{ day: 'Tuesday', periodId: c.period._id }] },
      );
      const items = [item(c.math, c.g1, c.a), item(c.math, c.g1, c.b), item(c.math, c.g2)];
      const res = await save(items);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ added: 0, removed: 1, kept: 3, lessonsRemoved: 1 });
      const kept = await TeacherAssignment.findOne({ teacherId: c.teacher._id, subjectId: c.math._id, classId: c.g1._id, sectionId: c.a._id });
      expect(kept.timetableSlots).toHaveLength(1);

      expect((await save(items)).body.data).toMatchObject({ added: 0, removed: 0, kept: 3 });
    });

    it('leaves other terms alone', async () => {
      const otherTerm = await Term.findOne({ name: 'ST14 old term' });
      await TeacherAssignment.create({ teacherId: c.teacher._id, subjectId: c.math._id, classId: c.g2._id, sectionId: null, termId: otherTerm._id });
      expect((await save([])).body.data.removed).toBe(3);
      expect(await held()).toEqual([]);
      expect(await TeacherAssignment.countDocuments({ teacherId: c.teacher._id, termId: otherTerm._id })).toBe(1);
    });

    it('applies the rules of a single assignment, and saves nothing if one tick is wrong', async () => {
      const good = item(c.math, c.g2);
      const notTaught = await save([good, item(c.sci, c.g2)]);
      expect(notTaught.status).toBe(400);
      expect(notTaught.body.message).toMatch(/is not taught in ST14 Grade 2/);

      const noSection = await save([good, item(c.math, c.g1)]);
      expect(noSection.status).toBe(400);
      expect(noSection.body.message).toMatch(/has sections/);

      const wrongSection = await save([good, item(c.math, c.g1, { _id: new mongoose.Types.ObjectId() })]);
      expect(wrongSection.status).toBe(400);
      expect(await held()).toEqual([]);

      // A class without sections takes none: a section sent by mistake is dropped.
      const dropped = await save([item(c.math, c.g2, c.a)]);
      expect(dropped.status).toBe(200);
      expect(await held()).toEqual([key(c.math, c.g2)]);
    });

    it('refuses an unknown term or teacher, and is for the academic office only', async () => {
      expect((await save([], new mongoose.Types.ObjectId())).status).toBe(400);
      expect((await save([], c.term._id, new mongoose.Types.ObjectId())).status).toBe(404);
      const accountantId = new mongoose.Types.ObjectId();
      await User.create({ _id: accountantId, firstName: 'St', lastName: 'Acc', email: mail('acc'), password: 'password123', role: 'accountant' });
      const res = await request(app).put(`/api/teachers/${c.teacher._id}/assignments/bulk`)
        .set('Authorization', bearer(accountantId, 'accountant')).send({ termId: String(c.term._id), items: [] });
      expect(res.status).toBe(403);
    });

    it('still edits a single assignment at its own address', async () => {
      const assignment = await TeacherAssignment.findOne({ teacherId: c.teacher._id, termId: c.term._id });
      const res = await put(`/api/teachers/${c.teacher._id}/assignments/${assignment._id}`, { timetableSlots: [{ day: 'Monday', periodId: String(c.period._id) }] });
      expect(res.status).toBe(200);
    });
  });

  describe('Add Many Users: teachers, parents and students', () => {
    const bulk = (users) => post('/api/users/bulk', { users });
    const row = (firstName, lastName, email, role, extra) => ({ firstName, lastName, email: mail(email), role, extra });
    const problemsOf = (res) => Object.fromEntries(res.body.problems.map((p) => [p.row, p.problems.join(' ')]));

    it('creates a teacher with a profile, a staff id and an optional phone', async () => {
      const res = await bulk([row('Bulk', 'Teacherone', 'bt1', 'teacher', '061 234 5678'), row('Bulk', 'Teachertwo', 'bt2', 'Teacher')]);
      expect(res.status).toBe(201);
      const [one, two] = res.body.data.users;
      const teachers = await Teacher.find({ userId: { $in: [one._id, two._id] } }).lean();
      expect(teachers).toHaveLength(2);
      const first = teachers.find((t) => String(t.userId) === one._id);
      const second = teachers.find((t) => String(t.userId) === two._id);
      expect(first.phone).toBe('0612345678');
      expect(second.phone).toBeUndefined();
      expect(first.staffId).toMatch(/^TCH-\d{4,}$/);
      expect(first.staffId).not.toBe(second.staffId);
      expect(one.detail).toBe(`Staff ID ${first.staffId}`);
      const user = await User.findById(one._id).lean();
      expect(user).toMatchObject({ role: 'teacher', mustChangePassword: true });

      // The profile is what makes the login work as a teacher.
      const signIn = await request(app).post('/api/auth/login').send({ email: mail('bt1'), password: one.temporaryPassword });
      expect(signIn.status).toBe(200);
      expect(signIn.body.data.user.role).toBe('teacher');
    });

    it('links a parent to a registered parent without a login, by email or by phone', async () => {
      const family = await Family.create({ familyName: 'St Parent Family', primaryContactPhone: '0614000001' });
      const byEmail = await Guardian.create({ familyId: family._id, name: 'St Parent Mail', relationship: 'Mother', phone: '0614000002', email: mail('PMail') });
      const byPhone = await Guardian.create({ familyId: family._id, name: 'St Parent Phone', relationship: 'Father', phone: '061 400 0003' });

      const res = await bulk([row('Hodan', 'Mail', 'pmail', 'parent'), row('Ali', 'Phone', 'pphone', 'parent', '0614000003')]);
      expect(res.status).toBe(201);
      const [one, two] = res.body.data.users;
      expect(String((await Guardian.findById(byEmail._id)).userId)).toBe(one._id);
      const phoneGuardian = await Guardian.findById(byPhone._id);
      expect(String(phoneGuardian.userId)).toBe(two._id);
      expect(phoneGuardian.email).toBe(mail('pphone')); // had none
      expect(one.detail).toBe('Linked to registered parent St Parent Mail');
      expect(await Guardian.countDocuments({ familyId: family._id })).toBe(2);
    });

    it('adds a new parent with their own family when none matches', async () => {
      const phone = parentPhone();
      const res = await bulk([row('St Parent', 'Brandnew', 'pnew', 'parent', phone)]);
      expect(res.status).toBe(201);
      const guardian = await Guardian.findOne({ email: mail('pnew') }).lean();
      expect(guardian).toMatchObject({ name: 'St Parent Brandnew', phone, isPrimary: true });
      expect(String(guardian.userId)).toBe(res.body.data.users[0]._id);
      expect(await Family.findById(guardian.familyId).lean()).toMatchObject({ primaryContactPhone: phone, primaryContactEmail: mail('pnew') });
    });

    it('reports parent rows it cannot place, and creates nothing', async () => {
      const phone = parentPhone();
      const res = await bulk([
        row('No', 'Phone', 'pnophone', 'parent'),
        row('Short', 'Phone', 'pshort', 'parent', '123'),
        row('Has', 'Login', 'plogin', 'parent', '0614000003'),
        row('New', 'One', 'pdup1', 'parent', phone),
        row('New', 'Two', 'pdup2', 'parent', phone),
      ]);
      expect(res.status).toBe(400);
      const byRow = problemsOf(res);
      expect(byRow[1]).toMatch(/new parent needs a phone/i);
      expect(byRow[2]).toMatch(/too short/);
      expect(byRow[3]).toMatch(/St Parent Phone already has a login/);
      expect(byRow[4]).toBeUndefined();
      expect(byRow[5]).toMatch(/also on row 4/);
      expect(await User.exists({ email: mail('pdup1') })).toBeNull();
      expect(await Guardian.exists({ phone })).toBeNull();
    });

    it('refuses two lines for one registered parent, or a phone that fits two parents', async () => {
      const family = await Family.create({ familyName: 'St Parent Twins', primaryContactPhone: '0614000010' });
      await Guardian.create([
        { familyId: family._id, name: 'St Parent Twin1', relationship: 'Mother', phone: '0614000011', email: mail('twin') },
        { familyId: family._id, name: 'St Parent Twin2', relationship: 'Aunt', phone: '0614000012' },
      ]);
      const twice = await bulk([row('A', 'One', 'twin', 'parent'), row('A', 'Two', 'twin2', 'parent', '0614000011')]);
      expect(problemsOf(twice)[2]).toMatch(/Row 1 is already for this parent/);

      const both = await bulk([row('A', 'One', 'twin', 'parent', '0614000012')]);
      expect(problemsOf(both)[1]).toMatch(/more than one parent/);
    });

    it('links a student login by admission number, or by name when only one fits', async () => {
      const student = await seedStudent(10, { firstName: 'Linkme', admissionNumber: 'ST14-ADM-10' });
      const byName = await seedStudent(11, { firstName: 'Byname' });
      const res = await bulk([row('Any', 'Name', 'sadm', 'student', 'st14-adm-10'), row('byname', 'sttest', 'sname', 'Student')]);
      expect(res.status).toBe(201);
      const [one, two] = res.body.data.users;
      expect(String((await Student.findById(student._id)).userId)).toBe(one._id);
      expect(String((await Student.findById(byName._id)).userId)).toBe(two._id);
      expect(one.detail).toBe('Linked to Linkme Sttest (ST14-ADM-10)');
      expect(await User.findById(two._id).lean()).toMatchObject({ role: 'student', mustChangePassword: true });
    });

    it('reports students it cannot link, and creates nothing', async () => {
      await seedStudent(20, { firstName: 'Samename' });
      await seedStudent(21, { firstName: 'Samename' });
      const free = await seedStudent(22, { firstName: 'Twicerow', admissionNumber: 'ST14-ADM-22' });
      const res = await bulk([
        row('Never', 'Registered', 'sa', 'student'),
        row('Any', 'Name', 'sb', 'student', 'NO-SUCH-NUMBER'),
        row('Samename', LAST, 'sc', 'student'),
        row('Any', 'Name', 'sd', 'student', 'ST14-ADM-10'),
        row('Twicerow', LAST, 'se', 'student'),
        row('Any', 'Name', 'sf', 'student', 'ST14-ADM-22'),
      ]);
      expect(res.status).toBe(400);
      const byRow = problemsOf(res);
      expect(byRow[1]).toBe('Register this student first, or add their admission number as a fifth column.');
      expect(byRow[2]).toMatch(/No student has admission number NO-SUCH-NUMBER/);
      expect(byRow[3]).toMatch(/2 students have this name/);
      expect(byRow[4]).toMatch(/already has a login/);
      expect(byRow[5]).toBeUndefined();
      expect(byRow[6]).toMatch(/Row 5 is already for this student/);
      expect((await Student.findById(free._id)).userId).toBeNull();
      expect(await User.exists({ email: mail('se') })).toBeNull();
    });

    it('takes every kind of row together, and no fifth column for staff', async () => {
      const refused = await bulk([row('Staff', 'Member', 'staff5', 'accountant', '0612345678')]);
      expect(problemsOf(refused)[1]).toMatch(/Only teacher, parent and student lines/);

      await seedStudent(30, { firstName: 'Mixed' });
      const res = await bulk([
        row('Mix', 'Accountant', 'mix1', 'accountant'),
        row('Mix', 'Teacher', 'mix2', 'teacher'),
        row('St Parent', 'Mix', 'mix3', 'parent', parentPhone()),
        row('Mixed', LAST, 'mix4', 'student'),
      ]);
      expect(res.status).toBe(201);
      expect(res.body.data.count).toBe(4);
      expect(new Set(res.body.data.users.map((u) => u.temporaryPassword)).size).toBe(4);
    });

    it('takes back the whole list if a write fails halfway', async () => {
      const family = await Family.create({ familyName: 'St Parent Roll', primaryContactPhone: '0614000020' });
      const guardian = await Guardian.create({ familyId: family._id, name: 'St Parent Roll', relationship: 'Mother', phone: '0614000021' });
      const student = await seedStudent(40, { firstName: 'Rollback', admissionNumber: 'ST14-ADM-40' });
      const phone = parentPhone();
      const failing = jest.spyOn(Family, 'create').mockRejectedValueOnce(new Error('The database went away'));
      try {
        const res = await bulk([
          row('Roll', 'Teacher', 'roll1', 'teacher'),
          row('Roll', 'Parent', 'roll2', 'parent', '0614000021'),
          row('Roll', 'Student', 'roll3', 'student', 'ST14-ADM-40'),
          row('Roll', 'Newparent', 'roll4', 'parent', phone),
        ]);
        expect(res.status).toBe(500);
      } finally {
        failing.mockRestore();
      }
      expect(await User.countDocuments({ email: { $in: ['roll1', 'roll2', 'roll3', 'roll4'].map(mail) } })).toBe(0);
      const after = await Guardian.findById(guardian._id).lean();
      expect(after.userId).toBeNull();
      expect(after.email).toBeUndefined();
      expect((await Student.findById(student._id)).userId).toBeNull();
    });

    it('keeps the single Add User rules: no teacher, student or parent logins there', async () => {
      const res = await post('/api/users', { firstName: 'One', lastName: 'Teacher', email: mail('single'), role: 'teacher' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Teachers, Students and Parents pages/);
    });
  });
});
