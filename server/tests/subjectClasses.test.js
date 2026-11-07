import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/server.js';
import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import Class from '../src/models/Class.js';
import Section from '../src/models/Section.js';
import Subject from '../src/models/Subject.js';
import Teacher from '../src/models/Teacher.js';
import Term from '../src/models/Term.js';
import Year from '../src/models/Year.js';
import TeacherAssignment from '../src/models/TeacherAssignment.js';
import Period from '../src/models/Period.js';

// Which subjects each class takes: the subject's class list, the
// "subjects per class" save, and teacher assignments respecting it.
const secret = () => process.env.JWT_ACCESS_SECRET || 'default_access_secret_key_12345';
const bearer = (id, role) => `Bearer ${jwt.sign({ id: id.toString(), role }, secret())}`;
const adminId = new mongoose.Types.ObjectId();
const teacherUserId = new mongoose.Types.ObjectId();
const emails = ['sc.admin@test.com', 'sc.teacher@test.com'];
const c = {};
const admin = () => bearer(adminId, 'admin');
const ids = (list) => list.map((s) => String(s._id)).sort();

describe('Subjects per class', () => {
  beforeAll(async () => {
    await User.deleteMany({ email: { $in: emails } });
    await User.create([
      { _id: adminId, firstName: 'Sc', lastName: 'Admin', email: emails[0], password: 'password123', role: 'admin' },
      { _id: teacherUserId, firstName: 'Sc', lastName: 'Teacher', email: emails[1], password: 'password123', role: 'teacher' },
    ]);
    c.level = await Level.create({ lev_no: 'SC-L', lev_name: 'Sc level' });
    [c.g1, c.g2, c.g3] = await Class.create([
      { cl_no: 'SC-G1', cl_name: 'Sc Grade 1', lev_no: c.level._id },
      { cl_no: 'SC-G2', cl_name: 'Sc Grade 2', lev_no: c.level._id },
      { cl_no: 'SC-G3', cl_name: 'Sc Grade 3', lev_no: c.level._id },
    ]);
    c.sec1 = await Section.create({ name: 'A', class: c.g1._id });
    c.sec2 = await Section.create({ name: 'A', class: c.g2._id });
    c.year = await Year.create({ y_no: 'SC-Y', y_name: 'Sc year' });
    c.term = await Term.create({ name: 'SC term', academicYearId: c.year._id, status: 'inactive' });
    c.period = await Period.create({ termId: c.term._id, per_no: 'SC1', per_name: 'Sc period 1', time_in: '08:00', time_out: '08:40' });
    c.teacher = await Teacher.create({ userId: teacherUserId, staffId: 'SC-T1' });
    // An old record: one class in the deprecated field, no classIds.
    await Subject.collection.insertOne({ sub_no: 'SC-LEGACY', sub_name: 'Sc Legacy History', classId: c.g1._id, status: 'active' });
    c.legacy = await Subject.findOne({ sub_no: 'SC-LEGACY' });
  }, 180000);

  afterAll(async () => {
    await Promise.all([
      User.deleteMany({ email: { $in: emails } }),
      Level.deleteMany({ lev_no: 'SC-L' }),
      Class.deleteMany({ cl_no: { $in: ['SC-G1', 'SC-G2', 'SC-G3'] } }),
      Section.deleteMany({ _id: { $in: [c.sec1, c.sec2].filter(Boolean).map((s) => s._id) } }),
      Year.deleteMany({ y_no: 'SC-Y' }),
      Term.deleteMany({ name: 'SC term' }),
      Period.deleteMany({ per_no: 'SC1', termId: c.term?._id }),
      Teacher.deleteMany({ staffId: 'SC-T1' }),
      Subject.deleteMany({ sub_name: /^Sc / }),
      TeacherAssignment.deleteMany({ teacherId: c.teacher?._id }),
    ]);
  }, 180000);

  it('creates a subject for chosen classes and numbers it when no number is given', async () => {
    const res = await request(app).post('/api/subjects').set('Authorization', admin())
      .send({ sub_name: 'Sc Mathematics', classIds: [String(c.g1._id), String(c.g2._id)] });
    expect(res.status).toBe(201);
    expect(res.body.data.sub_no).toMatch(/^SUB-\d{3,}$/);
    expect(res.body.data.classIds.sort()).toEqual(ids([c.g1, c.g2]));
    expect(res.body.data.classId).toBeUndefined();
    c.math = res.body.data;

    const every = await request(app).post('/api/subjects').set('Authorization', admin())
      .send({ sub_name: 'Sc English', sub_no: 'SC-ENG', subjectCode: '' });
    expect(every.status).toBe(201);
    expect(every.body.data.classIds).toEqual([]);
    c.english = every.body.data;

    const art = await request(app).post('/api/subjects').set('Authorization', admin())
      .send({ sub_name: 'Sc Art', sub_no: 'SC-ART', classIds: [String(c.g3._id)] });
    expect(art.status).toBe(201);
    c.art = art.body.data;
  });

  it('refuses a subject without a name or with an unknown class, in plain words', async () => {
    const noName = await request(app).post('/api/subjects').set('Authorization', admin()).send({ sub_name: '  ' });
    expect(noName.status).toBe(400);
    expect(noName.body.message).toBe('Enter the subject name.');

    const ghost = await request(app).post('/api/subjects').set('Authorization', admin())
      .send({ sub_name: 'Sc Ghost', classIds: [String(new mongoose.Types.ObjectId())] });
    expect(ghost.status).toBe(400);
    expect(ghost.body.message).toMatch(/class/i);
  });

  it('updates the class list and reads an old single-class subject as a list', async () => {
    const res = await request(app).put(`/api/subjects/${c.math._id}`).set('Authorization', admin())
      .send({ classIds: [String(c.g2._id)] });
    expect(res.status).toBe(200);
    expect(res.body.data.classIds).toEqual([String(c.g2._id)]);

    const legacy = await request(app).get(`/api/subjects/${c.legacy._id}`).set('Authorization', admin());
    expect(legacy.body.data.classIds).toEqual([String(c.g1._id)]);
  });

  it('lists only the subjects a class takes, including "every class" ones', async () => {
    const g1 = await request(app).get(`/api/subjects?classId=${c.g1._id}`).set('Authorization', admin());
    expect(g1.status).toBe(200);
    const names = g1.body.data.map((s) => s.sub_name).filter((n) => n.startsWith('Sc '));
    expect(names).toEqual(['Sc English', 'Sc Legacy History']);

    const g2 = await request(app).get(`/api/subjects?classId=${c.g2._id}`).set('Authorization', admin());
    expect(g2.body.data.map((s) => s.sub_name).filter((n) => n.startsWith('Sc '))).toEqual(['Sc English', 'Sc Mathematics']);
  });

  it('sets exactly which subjects a class takes', async () => {
    // Grade 1 now takes Maths and Art, and stops taking English (an "every class" subject).
    // Legacy History is only taught in Grade 1, so it stays ticked.
    const res = await request(app).put(`/api/subjects/class/${c.g1._id}`).set('Authorization', admin())
      .send({ subjectIds: [c.math._id, c.art._id, String(c.legacy._id)] });
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.sub_name).filter((n) => n.startsWith('Sc '))).toEqual(['Sc Art', 'Sc Legacy History', 'Sc Mathematics']);

    const math = await Subject.findById(c.math._id).lean();
    expect(math.classIds.map(String).sort()).toEqual(ids([c.g1, c.g2]));
    // English was "every class": it becomes every class except Grade 1.
    const english = await Subject.findById(c.english._id).lean();
    expect(english.classIds.map(String)).not.toContain(String(c.g1._id));
    expect(english.classIds.map(String)).toEqual(expect.arrayContaining([String(c.g2._id), String(c.g3._id)]));
    // The old record moved onto classIds.
    const legacy = await Subject.findById(c.legacy._id).lean();
    expect(legacy.classIds.map(String)).toEqual([String(c.g1._id)]);
    expect(legacy.classId).toBeUndefined();
  });

  it('refuses to untick a subject from the only class that takes it', async () => {
    const res = await request(app).put(`/api/subjects/class/${c.g1._id}`).set('Authorization', admin())
      .send({ subjectIds: [c.math._id, c.art._id] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Sc Legacy History is only taught in Sc Grade 1/);
    // Nothing changed.
    expect((await Subject.findById(c.art._id).lean()).classIds.map(String)).toContain(String(c.g1._id));
  });

  it('is for academic staff only', async () => {
    const res = await request(app).put(`/api/subjects/class/${c.g1._id}`)
      .set('Authorization', bearer(teacherUserId, 'teacher')).send({ subjectIds: [] });
    expect(res.status).toBe(403);
    const bad = await request(app).put(`/api/subjects/class/${c.g1._id}`).set('Authorization', admin()).send({});
    expect(bad.status).toBe(400);
  });

  it('refuses a teacher assignment for a subject the class does not take', async () => {
    const base = { classId: c.g2._id, sectionId: c.sec2._id, termId: c.term._id, timetableSlots: [{ day: 'Monday', periodId: c.period._id }] };
    const wrong = await request(app).post(`/api/teachers/${c.teacher._id}/assignments`).set('Authorization', admin())
      .send({ ...base, subjectId: c.art._id });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe("Sc Art is not taught in Sc Grade 2. Add it to this class's subjects in Academic Structure first, or choose another subject.");

    const ok = await request(app).post(`/api/teachers/${c.teacher._id}/assignments`).set('Authorization', admin())
      .send({ ...base, subjectId: c.math._id });
    expect(ok.status).toBe(201);

    // Moving it to a subject Grade 2 doesn't take is refused too.
    const move = await request(app).put(`/api/teachers/${c.teacher._id}/assignments/${ok.body.data._id}`).set('Authorization', admin())
      .send({ subjectId: c.art._id });
    expect(move.status).toBe(400);
    expect(move.body.message).toMatch(/not taught in Sc Grade 2/);
  });
});
