import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import app from '../src/server.js';
import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import Class from '../src/models/Class.js';
import Section from '../src/models/Section.js';
import Student from '../src/models/Student.js';
import StudentClass from '../src/models/StudentClass.js';
import Guardian from '../src/models/Guardian.js';
import Family from '../src/models/Family.js';

// Importing students from the spreadsheet template: the check (dryRun) writes
// nothing and names each row's problems; the real run registers the good rows,
// brothers and sisters land in one family, and the school's own admission
// numbers are kept but never duplicated.
const secret = () => process.env.JWT_ACCESS_SECRET || 'default_access_secret_key_12345';
const bearer = (id, role) => `Bearer ${jwt.sign({ id: id.toString(), role }, secret())}`;
const adminId = new mongoose.Types.ObjectId();
const teacherId = new mongoose.Types.ObjectId();
const emails = ['imp.admin@test.com', 'imp.teacher@test.com'];
const LAST = 'Imptest';
const PHONE_PREFIX = /^0617770/;
const c = {};

const admin = () => bearer(adminId, 'admin');
const row = (extra = {}) => ({
  'First name': 'Ayan', 'Last name': LAST, Gender: 'Female', 'Date of birth': '2015-03-25',
  Class: 'Imp Grade 1', Section: 'A', Phone: '0617770001', Address: 'Hodan',
  'Parent name': 'Imp Parent', 'Parent phone': '0617770002', 'Parent relationship': 'mother',
  ...extra,
});
const post = (rows, dryRun) => request(app).post('/api/students/import').set('Authorization', admin()).send({ rows, dryRun });

describe('Student import', () => {
  beforeAll(async () => {
    await User.deleteMany({ email: { $in: emails } });
    await User.create([
      { _id: adminId, firstName: 'Imp', lastName: 'Admin', email: emails[0], password: 'password123', role: 'admin' },
      { _id: teacherId, firstName: 'Imp', lastName: 'Teacher', email: emails[1], password: 'password123', role: 'teacher' },
    ]);
    c.level = await Level.create({ lev_no: 'IMP-L', lev_name: 'Imp level' });
    c.grade1 = await Class.create({ cl_no: 'IMP-C1', cl_name: 'Imp Grade 1', lev_no: c.level._id });
    c.grade2 = await Class.create({ cl_no: 'IMP-C2', cl_name: 'Imp Grade 2', lev_no: c.level._id });
    await Section.create([{ name: 'A', class: c.grade1._id }, { name: 'B', class: c.grade1._id }]);
    c.family = await Family.create({ familyName: 'Imp Existing Family', primaryContactPhone: '0617770100' });
    c.guardian = await Guardian.create({ familyId: c.family._id, name: 'Imp Existing Parent', relationship: 'Father', phone: '0617770100', isPrimary: true });
  }, 180000);

  afterAll(async () => {
    const students = await Student.find({ lastName: LAST }).select('_id').lean();
    await Promise.all([
      User.deleteMany({ email: { $in: emails } }),
      Student.deleteMany({ lastName: LAST }),
      StudentClass.deleteMany({ student: { $in: students.map((s) => s._id) } }),
      Guardian.deleteMany({ phone: PHONE_PREFIX }),
      Family.deleteMany({ primaryContactPhone: PHONE_PREFIX }),
      Section.deleteMany({ class: { $in: [c.grade1?._id, c.grade2?._id] } }),
      Class.deleteMany({ cl_no: { $in: ['IMP-C1', 'IMP-C2'] } }),
      Level.deleteMany({ lev_no: 'IMP-L' }),
    ]);
  }, 180000);

  it('is for the staff who register students', async () => {
    const res = await request(app).post('/api/students/import').set('Authorization', bearer(teacherId, 'teacher')).send({ rows: [row()] });
    expect(res.status).toBe(403);
  });

  it('checks every row without writing anything', async () => {
    const res = await post([
      row({ 'First name': 'Okay', Gender: 'f', 'Date of birth': '25/03/2015' }),
      row({ 'First name': 'Noclass', Class: 'Grade 99' }),
      row({ 'First name': 'Badgender', Gender: 'Boyish' }),
      row({ 'First name': 'Nophone', Phone: '' }),
      row({ 'First name': 'Nosection', Section: '' }),
      row({ 'First name': 'Serial', Class: 'imp grade 2', Section: '', 'Date of birth': 42088, Gender: 'M' }),
    ], true);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.rows.map((r) => [r.name.split(' ')[0], r]));
    expect(res.body.data).toMatchObject({ dryRun: true, total: 6, ready: 3, withProblems: 3 });
    expect(byName.Okay).toMatchObject({ row: 2, ok: true, errors: [] });
    expect(byName.Serial.ok).toBe(true);
    expect(byName.Noclass.errors.join(' ')).toMatch(/Class "Grade 99" does not exist/);
    expect(byName.Badgender.errors.join(' ')).toMatch(/Gender "Boyish" is not valid/);
    expect(byName.Nophone).toMatchObject({ ok: true, errors: [] }); // a student's phone is optional
    expect(byName.Nosection.errors.join(' ')).toMatch(/Section is missing.*A, B/);
    expect(byName.Okay._body).toBeUndefined();
    expect(await Student.countDocuments({ lastName: LAST })).toBe(0);
  });

  it('refuses an empty or oversized file', async () => {
    expect((await post([], true)).status).toBe(400);
    expect((await post(Array.from({ length: 1001 }, () => row()), true)).status).toBe(400);
  });

  it('puts brothers and sisters in one family, and links a parent who is already registered', async () => {
    const rows = [
      row({ 'First name': 'Sibone', 'Parent phone': '061 777 0200', 'Parent name': 'Imp Sibling Parent' }),
      row({ 'First name': 'Sibtwo', 'Parent phone': '0617770200', 'Parent name': 'Imp Sibling Parent', Gender: 'Male' }),
      row({ 'First name': 'Known', 'Parent phone': '0617770100', 'Parent name': 'Someone Else' }),
    ];
    const check = await post(rows, true);
    expect(check.body.data.rows.map((r) => [r.ok, r.willLinkToExistingParent, r.sameParentAsRow]))
      .toEqual([[true, false, null], [true, false, 2], [true, true, null]]);
    expect(check.body.data).toMatchObject({ newParents: 1, existingParents: 1 });

    const res = await post(rows, false);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dryRun: false, created: 3, failed: [] });

    const [one, two, known] = await Promise.all(['Sibone', 'Sibtwo', 'Known'].map((firstName) => Student.findOne({ firstName, lastName: LAST }).lean()));
    expect(await Guardian.countDocuments({ phone: '0617770200' })).toBe(1);
    expect(String(one.familyId)).toBe(String(two.familyId));
    expect(String(one.guardians[0].guardianId)).toBe(String(two.guardians[0].guardianId));
    expect(String(known.familyId)).toBe(String(c.family._id));
    expect(String(known.guardians[0].guardianId)).toBe(String(c.guardian._id));
    expect(known.parentName).toBe('Imp Existing Parent');
    expect(one.admissionNumber).toMatch(/^[A-Z0-9]+-\d{4}-\d{4}$/);
    expect(await StudentClass.countDocuments({ student: one._id })).toBeLessThanOrEqual(1);
  });

  it('keeps the school\'s own admission numbers but never twice', async () => {
    const first = await post([row({ 'First name': 'Ownnumber', 'Admission number': 'IMP-ADM-1', 'Parent phone': '0617770300' })], false);
    expect(first.body.data.created).toBe(1);
    expect((await Student.findOne({ firstName: 'Ownnumber', lastName: LAST }).lean()).admissionNumber).toBe('IMP-ADM-1');

    const again = await post([
      row({ 'First name': 'Taken', 'Admission number': 'IMP-ADM-1', 'Parent phone': '0617770301' }),
      row({ 'First name': 'Twicea', 'Admission number': 'IMP-ADM-2', 'Parent phone': '0617770302' }),
      row({ 'First name': 'Twiceb', 'Admission number': 'IMP-ADM-2', 'Parent phone': '0617770303' }),
    ], true);
    const [taken, a, b] = again.body.data.rows;
    expect(taken.errors.join(' ')).toMatch(/IMP-ADM-1 is already used/);
    expect(a.ok).toBe(true);
    expect(b.errors.join(' ')).toMatch(/also used in row 3/);

    const real = await post([row({ 'First name': 'Taken', 'Admission number': 'IMP-ADM-1', 'Parent phone': '0617770301' })], false);
    expect(real.body.data.created).toBe(0);
    expect(real.body.data.failed[0]).toMatchObject({ row: 2 });
    expect(real.body.data.failed[0].error).toMatch(/already used/);
  });

  it('does not import the same student twice', async () => {
    const res = await post([row({ 'First name': 'Sibone', 'Parent phone': '0617770200' })], true);
    expect(res.body.data.rows[0].errors.join(' ')).toMatch(/already registered/);
  });

  it('gives a template that reads back into rows', async () => {
    const template = await request(app).get('/api/students/import/template').set('Authorization', admin())
      .buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (d) => chunks.push(d)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(template.status).toBe(200);
    expect(template.headers['content-type']).toMatch(/spreadsheetml/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template.body);
    const sheet = workbook.getWorksheet('Students');
    expect(sheet.getRow(1).getCell(1).value).toBe('First name');
    const instructions = [];
    workbook.getWorksheet('Instructions').eachRow((r) => instructions.push(r.getCell(1).value));
    expect(instructions).toContain('Imp Grade 1');

    // Only the example row: nothing to import.
    const onlyExample = await request(app).post('/api/students/import/read').set('Authorization', admin())
      .attach('file', Buffer.from(await workbook.xlsx.writeBuffer()), 'students.xlsx');
    expect(onlyExample.status).toBe(400);

    sheet.getRow(3).values = ['Filled', LAST, 'F', '01/02/2016', 'Imp Grade 1', 'B', '0617770400', 'Hodan', 'Imp Read Parent', '0617770401'];
    const read = await request(app).post('/api/students/import/read').set('Authorization', admin())
      .attach('file', Buffer.from(await workbook.xlsx.writeBuffer()), 'students.xlsx');
    expect(read.status).toBe(200);
    expect(read.body.data.rows).toHaveLength(1);
    expect(read.body.data.rows[0]).toMatchObject({ rowNumber: 3, 'First name': 'Filled', Section: 'B' });

    const check = await post(read.body.data.rows, true);
    expect(check.body.data.rows[0]).toMatchObject({ row: 3, ok: true });
  });

  it('reads a CSV saved by Excel', async () => {
    const csv = '﻿First name;Last name;Gender;Date of birth;Class;Section;Phone;Address;Parent name;Parent phone\n'
      + `Csvkid;${LAST};Male;2016-05-04;Imp Grade 2;;0617770500;Hodan;Imp Csv Parent;0617770501\n`;
    const res = await request(app).post('/api/students/import/read').set('Authorization', admin())
      .attach('file', Buffer.from(csv), 'students.csv');
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0]).toMatchObject({ rowNumber: 2, 'First name': 'Csvkid', Class: 'Imp Grade 2' });

    const xls = await request(app).post('/api/students/import/read').set('Authorization', admin())
      .attach('file', Buffer.from('x'), 'old.xls');
    expect(xls.status).toBe(400);
    expect(xls.body.message).toMatch(/\.xlsx/);
  });
});
