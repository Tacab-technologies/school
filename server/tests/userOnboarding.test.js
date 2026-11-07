import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/server.js';
import User from '../src/models/User.js';
import AccessRole from '../src/models/AccessRole.js';
import AuditLog from '../src/models/auditLog.model.js';
import { clearRoleCache } from '../src/services/accessRoleService.js';

// The school's "Admin" feedback: create many users at once, and make everyone
// choose their own password the first time they sign in.
const secret = () => process.env.JWT_ACCESS_SECRET || 'default_access_secret_key_12345';
const bearer = (id, role) => `Bearer ${jwt.sign({ id: id.toString(), role }, secret())}`;
const adminId = new mongoose.Types.ObjectId();
const admin = () => bearer(adminId, 'admin');
const DOMAIN = '@onboarding.test';
const mail = (name) => `${name}${DOMAIN}`;

const bulk = (users, auth = admin()) => request(app).post('/api/users/bulk').set('Authorization', auth).send({ users });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

describe('User onboarding', () => {
  beforeAll(async () => {
    await User.deleteMany({ email: { $regex: `${DOMAIN.replace('.', '\\.')}$` } });
    await AccessRole.deleteMany({ key: 'front_desk' });
    await User.create({ _id: adminId, firstName: 'Ob', lastName: 'Admin', email: mail('admin'), password: 'password123', role: 'admin' });
    await AccessRole.create({ key: 'front_desk', name: 'Front Desk', permissions: [{ module: 'students', actions: ['view'] }] });
    clearRoleCache();
  });

  afterAll(async () => {
    await User.deleteMany({ email: { $regex: `${DOMAIN.replace('.', '\\.')}$` } });
    await AccessRole.deleteMany({ key: 'front_desk' });
    clearRoleCache();
  });

  describe('Adding many users at once', () => {
    it('creates nothing and reports every bad row when any row has a problem', async () => {
      await User.create({ firstName: 'Already', lastName: 'Here', email: mail('taken'), password: 'password123', role: 'accountant' });
      const res = await bulk([
        { firstName: 'Good', lastName: 'Row', email: mail('good1'), role: 'accountant' },
        { firstName: '', lastName: 'Nofirst', email: mail('nofirst'), role: 'accountant' },
        { firstName: 'Bad', lastName: 'Email', email: 'not-an-email', role: 'accountant' },
        { firstName: 'Twice', lastName: 'One', email: mail('twice'), role: 'principal' },
        { firstName: 'Twice', lastName: 'Two', email: mail('TWICE'), role: 'principal' },
        { firstName: 'Used', lastName: 'Before', email: mail('taken'), role: 'principal' },
        { firstName: 'No', lastName: 'Role', email: mail('norole'), role: 'janitor' },
        { firstName: 'Nobody', lastName: 'Registeredyet', email: mail('stud'), role: 'student' },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Nothing was created/);
      const byRow = Object.fromEntries(res.body.problems.map((p) => [p.row, p.problems.join(' ')]));
      expect(Object.keys(byRow).map(Number).sort((a, b) => a - b)).toEqual([2, 3, 5, 6, 7, 8]);
      expect(byRow[2]).toMatch(/First name/);
      expect(byRow[3]).toMatch(/valid address/);
      expect(byRow[5]).toMatch(/also on row 4/);
      expect(byRow[6]).toMatch(/already used/);
      expect(byRow[7]).toMatch(/not a role/);
      expect(byRow[8]).toMatch(/Register this student first/);
      // All or nothing: not even the good rows were made.
      expect(await User.exists({ email: { $in: [mail('good1'), mail('twice')] } })).toBeNull();
    });

    it('creates every row with its own temporary password, accepting role names or keys', async () => {
      const res = await bulk([
        { firstName: 'Amina', lastName: 'Ali', email: mail('amina'), role: 'Accountant' },
        { firstName: 'Bashir', lastName: 'Omar', email: mail('BASHIR'), role: 'Academic Officer' },
        { firstName: 'Cawo', lastName: 'Nur', email: mail('cawo'), role: 'front desk' },
        { firstName: 'Deeqa', lastName: 'Yusuf', email: mail('deeqa'), role: 'principal' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.data.count).toBe(4);
      const rows = res.body.data.users;
      expect(rows.map((r) => [r.row, r.email, r.name, r.role])).toEqual([
        [1, mail('amina'), 'Amina Ali', 'accountant'],
        [2, mail('bashir'), 'Bashir Omar', 'academic_officer'],
        [3, mail('cawo'), 'Cawo Nur', 'front_desk'],
        [4, mail('deeqa'), 'Deeqa Yusuf', 'principal'],
      ]);
      const passwords = rows.map((r) => r.temporaryPassword);
      expect(passwords.every((p) => typeof p === 'string' && p.length >= 8)).toBe(true);
      expect(new Set(passwords).size).toBe(4);

      const saved = await User.find({ email: { $in: rows.map((r) => r.email) } }).lean();
      expect(saved).toHaveLength(4);
      expect(saved.every((u) => u.mustChangePassword === true && String(u.createBy) === String(adminId))).toBe(true);
      expect(saved.every((u) => !passwords.includes(u.password))).toBe(true); // stored hashed

      const signIn = await login(mail('cawo'), rows[2].temporaryPassword);
      expect(signIn.status).toBe(200);
      expect(signIn.body.data.user.role).toBe('front_desk');

      // Logged in the audit trail, but never with the passwords.
      const entry = await AuditLog.findOne({ 'after_changes.count': 4 }).sort({ audit_no: -1 }).lean();
      expect(entry).toBeTruthy();
      expect(JSON.stringify(entry.after_changes)).not.toContain(rows[0].temporaryPassword);
      expect(entry.after_changes.users[0].email).toBe(mail('amina'));
    });

    it('is for admins only, and needs at least one and at most 200 rows', async () => {
      const officerId = new mongoose.Types.ObjectId();
      await User.create({ _id: officerId, firstName: 'Ob', lastName: 'Officer', email: mail('officer'), password: 'password123', role: 'academic_officer' });
      expect((await bulk([{ firstName: 'X', lastName: 'Y', email: mail('x'), role: 'accountant' }], bearer(officerId, 'academic_officer'))).status).toBe(403);

      expect((await bulk([])).status).toBe(400);
      const many = Array.from({ length: 201 }, (_, i) => ({ firstName: 'N', lastName: `${i}`, email: mail(`n${i}`), role: 'accountant' }));
      const tooMany = await bulk(many);
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.message).toMatch(/at most 200/);
    });
  });

  describe('Choosing your own password on first sign-in', () => {
    it('flags every staff-made login, but not the users tests create directly', async () => {
      const single = await request(app).post('/api/users').set('Authorization', admin())
        .send({ firstName: 'Single', lastName: 'User', email: mail('single'), role: 'accountant' });
      expect(single.status).toBe(201);
      expect((await User.findOne({ email: mail('single') })).mustChangePassword).toBe(true);
      expect((await User.findById(adminId)).mustChangePassword).toBe(false);
    });

    it('forces the change before anything else works, then lets the user in', async () => {
      const made = await bulk([{ firstName: 'Faisal', lastName: 'Hassan', email: mail('faisal'), role: 'accountant' }]);
      const temporary = made.body.data.users[0].temporaryPassword;

      const signIn = await login(mail('faisal'), temporary);
      expect(signIn.status).toBe(200);
      expect(signIn.body.data.user.mustChangePassword).toBe(true);
      const auth = `Bearer ${signIn.body.data.accessToken}`;

      const me = await request(app).get('/api/auth/me').set('Authorization', auth);
      expect(me.status).toBe(200);
      expect(me.body.data.user.mustChangePassword).toBe(true);

      const blocked = await request(app).get('/api/students').set('Authorization', auth);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await request(app).get('/api/fees/payment-methods').set('Authorization', auth)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // Keeping the temporary password is not allowed; a wrong one is refused.
      const same = await request(app).post('/api/auth/change-password').set('Authorization', auth)
        .send({ currentPassword: temporary, newPassword: temporary });
      expect(same.status).toBe(400);
      const wrong = await request(app).post('/api/auth/change-password').set('Authorization', auth)
        .send({ currentPassword: 'not-the-password', newPassword: 'faisal-own-password' });
      expect(wrong.status).toBe(400);

      const changed = await request(app).post('/api/auth/change-password').set('Authorization', auth)
        .send({ currentPassword: temporary, newPassword: 'faisal-own-password', refreshToken: signIn.body.data.refreshToken });
      expect(changed.status).toBe(200);
      expect((await User.findOne({ email: mail('faisal') })).mustChangePassword).toBe(false);

      // The same session now works, and so does the new password.
      expect((await request(app).get('/api/auth/me').set('Authorization', auth)).body.data.user.mustChangePassword).toBe(false);
      const open = await request(app).get('/api/fees/payment-methods').set('Authorization', auth);
      expect(open.status).not.toBe(403);
      expect(open.body.code).toBeUndefined();
      const again = await login(mail('faisal'), 'faisal-own-password');
      expect(again.status).toBe(200);
      expect(again.body.data.user.mustChangePassword).toBe(false);
    });

    it('asks again after an admin resets the password', async () => {
      const user = await User.findOne({ email: mail('faisal') });
      const reset = await request(app).post(`/api/users/${user._id}/reset-password`).set('Authorization', admin());
      expect(reset.status).toBe(200);
      const signIn = await login(mail('faisal'), reset.body.data.temporaryPassword);
      expect(signIn.body.data.user.mustChangePassword).toBe(true);
      expect((await request(app).get('/api/students').set('Authorization', `Bearer ${signIn.body.data.accessToken}`)).status).toBe(403);
    });
  });
});
