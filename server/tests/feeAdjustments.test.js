import request from 'supertest';
import app from '../src/server.js';
import User from '../src/models/User.js';
import Level from '../src/models/Level.js';
import Year from '../src/models/Year.js';
import Class from '../src/models/Class.js';
import Family from '../src/models/Family.js';
import Guardian from '../src/models/Guardian.js';
import Student from '../src/models/Student.js';
import PaymentMethod from '../src/models/PaymentMethod.js';
import StudentInvoice from '../src/models/StudentInvoice.js';
import FeeStructure from '../src/models/FeeStructure.js';
import StudentScholarship from '../src/models/StudentScholarship.js';
import PaymentClaim from '../src/models/PaymentClaim.js';
import FeeReceipt from '../src/models/FeeReceipt.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import { currentPeriod, ensureFeeIndexes } from '../src/services/monthlyFeeService.js';

// Changing a discount, scholarships, and parents paying from home.
describe('Fee discounts, scholarships and parent payments', () => {
  const now = currentPeriod();
  const tag = `FA${Date.now()}`;
  const tokens = {};
  const c = {};

  const as = (role) => ({ Authorization: `Bearer ${tokens[role]}` });
  const post = (url, body, role = 'admin') => request(app).post(url).set(as(role)).send(body);
  const put = (url, body, role = 'admin') => request(app).put(url).set(as(role)).send(body);
  const get = (url, role = 'admin') => request(app).get(url).set(as(role));
  const bill = (student) => StudentInvoice.findOne({ student, period: now });

  beforeAll(async () => {
    await ensureFeeIndexes();
    for (const role of ['admin', 'accountant', 'teacher', 'parent', 'otherparent']) {
      const u = await User.create({ firstName: 'FA', lastName: role, email: `${role}.${tag}@fees.test`, password: 'password123', role: role === 'otherparent' ? 'parent' : role });
      c[role] = u;
      tokens[role] = generateAccessToken(u);
    }
    const level = await Level.create({ lev_no: `${tag}-L`, lev_name: 'FA level' });
    if (!(await Year.exists({}))) c.year = await Year.create({ y_no: `${tag}-Y`, y_name: now.slice(0, 4) });
    c.cls = await Class.create({ cl_no: `${tag}-C`, cl_name: `FA class ${tag}`, lev_no: level._id });
    c.evc = await PaymentMethod.create({ payment_method_no: `${tag}-EVC`, payment_method_name: `EVC Plus ${tag}` });
    c.family = await Family.create({ familyName: `FA family ${tag}`, primaryContactPhone: '0617770001' });
    c.guardian = await Guardian.create({ familyId: c.family._id, userId: c.parent._id, name: 'FA Parent', relationship: 'Mother', phone: '0617770001', isPrimary: true });
    c.otherGuardian = await Guardian.create({ familyId: c.family._id, userId: c.otherparent._id, name: 'Other Parent', relationship: 'Father', phone: '0617770009', isPrimary: true });
    const mk = (firstName, extra = {}) => Student.create({
      firstName, lastName: 'Fees', admissionNumber: `${tag}-${firstName}`, gender: 'Female', birthDate: new Date('2014-01-01'),
      classId: c.cls._id, phoneNumber: '0617770002', address: 'Hodan', parentName: 'FA Parent', parentPhoneNumber: '0617770001', ...extra,
    });
    c.hodan = await mk('Hodan', { familyId: c.family._id, guardians: [{ guardianId: c.guardian._id, isPrimary: true }] });
    c.ayan = await mk('Ayan');
    c.legacy = await mk('Legacy');
    // A student registered before address and parent details were required.
    await Student.collection.updateOne({ _id: c.legacy._id }, { $unset: { address: '', parentName: '', phoneNumber: '' } });

    expect((await put(`/api/fees/class-fees/${c.cls._id}`, { amount: 50 })).status).toBe(200);
    expect((await post('/api/fees/charge', { period: now, class_id: String(c.cls._id) })).status).toBe(201);
  }, 120000);

  afterAll(async () => {
    const ids = [c.hodan, c.ayan, c.legacy].filter(Boolean).map((s) => s._id);
    await Promise.all([
      StudentInvoice.deleteMany({ student: { $in: ids } }),
      StudentScholarship.deleteMany({ st_no: { $in: ids } }),
      PaymentClaim.deleteMany({ student: { $in: ids } }),
      FeeReceipt.deleteMany({ students: { $in: ids } }),
      Student.deleteMany({ _id: { $in: ids } }),
      Guardian.deleteMany({ _id: { $in: [c.guardian?._id, c.otherGuardian?._id] } }),
      Family.deleteMany({ _id: c.family?._id }),
      Class.deleteMany({ cl_no: `${tag}-C` }),
      Level.deleteMany({ lev_no: `${tag}-L` }),
      Year.deleteMany({ y_no: `${tag}-Y` }),
      PaymentMethod.deleteMany({ payment_method_no: `${tag}-EVC` }),
      User.deleteMany({ email: new RegExp(`${tag}@fees\\.test$`) }),
    ]);
  }, 120000);

  describe('moving class mid-month', () => {
    it('does not bill the same month twice', async () => {
      const level = await Level.findOne({ lev_no: `${tag}-L` });
      const other = await Class.create({ cl_no: `${tag}-C2`, cl_name: `FA other ${tag}`, lev_no: level._id });
      expect((await put(`/api/fees/class-fees/${other._id}`, { amount: 70 })).status).toBe(200);
      await Student.updateOne({ _id: c.ayan._id }, { $set: { classId: other._id } });

      expect((await post('/api/fees/charge', { period: now })).status).toBe(201);
      expect(await StudentInvoice.countDocuments({ student: c.ayan._id, period: now })).toBe(1);
      expect((await bill(c.ayan._id)).original_amount).toBe(50);

      await Student.updateOne({ _id: c.ayan._id }, { $set: { classId: c.cls._id } });
      await FeeStructure.deleteMany({ class_id: other._id });
      await Class.deleteOne({ _id: other._id });
    });
  });

  describe('changing a discount', () => {
    it('saves for a student whose old record lacks now-required fields', async () => {
      const res = await put(`/api/fees/students/${c.legacy._id}/discount`, { kind: 'percent', value: 10, reason: 'Staff child' });
      expect(res.status).toBe(200);
      expect((await Student.findById(c.legacy._id).lean()).fee_discount).toMatchObject({ kind: 'percent', value: 10 });
    });

    it('changes this month\'s unpaid bill, and changes again on edit', async () => {
      expect((await bill(c.legacy._id)).invoice_amount).toBe(45);
      await put(`/api/fees/students/${c.legacy._id}/discount`, { kind: 'amount', value: 20 });
      expect((await bill(c.legacy._id)).invoice_amount).toBe(30);
      await put(`/api/fees/students/${c.legacy._id}/discount`, { kind: 'amount', value: 0 });
      const b = await bill(c.legacy._id);
      expect(b.invoice_amount).toBe(50);
      expect(b.balance).toBe(50);
      expect((await Student.findById(c.legacy._id).lean()).fee_discount).toBeUndefined();
    });

    it('is admin only', async () => {
      expect((await put(`/api/fees/students/${c.legacy._id}/discount`, { kind: 'percent', value: 5 }, 'accountant')).status).toBe(403);
    });
  });

  describe('scholarships', () => {
    it('gives a full scholarship that clears this month\'s bill', async () => {
      const res = await post(`/api/fees/students/${c.ayan._id}/scholarship`, { type: 'Orphan', percent: 100, reason: 'Lost both parents' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ type: 'Orphan', percent: 100, state: 'active' });
      c.scholarshipId = res.body.data._id;
      const b = await bill(c.ayan._id);
      expect(b.invoice_amount).toBe(0);
      expect(b.status).toBe('Paid');
    });

    it('refuses a second scholarship and bad percentages', async () => {
      expect((await post(`/api/fees/students/${c.ayan._id}/scholarship`, { type: 'Merit', percent: 50 })).status).toBe(409);
      expect((await post(`/api/fees/students/${c.hodan._id}/scholarship`, { type: 'Merit', percent: 150 })).status).toBe(400);
      expect((await post(`/api/fees/students/${c.hodan._id}/scholarship`, { type: 'Merit', percent: 50 }, 'accountant')).status).toBe(403);
    });

    it('shows on the student\'s fee account and in the list', async () => {
      const acc = await get(`/api/fees/students/${c.ayan._id}/account`, 'accountant');
      expect(acc.body.data.students[0].scholarship).toMatchObject({ type: 'Orphan', percent: 100 });
      const list = await get('/api/fees/scholarships?state=current', 'accountant');
      expect(list.body.data.some((r) => r._id === c.scholarshipId && r.student.name === 'Ayan Fees')).toBe(true);
    });

    it('can be changed and ended; ending keeps it in the history', async () => {
      const upd = await put(`/api/fees/scholarships/${c.scholarshipId}`, { type: 'Needy family', percent: 50 });
      expect(upd.status).toBe(200);
      expect(upd.body.data).toMatchObject({ type: 'Needy family', percent: 50 });

      const end = await post(`/api/fees/scholarships/${c.scholarshipId}/end`, {});
      expect(end.status).toBe(201);
      const all = await get('/api/fees/scholarships');
      expect(all.body.data.find((r) => r._id === c.scholarshipId).state).toBe('ended');
      const acc = await get(`/api/fees/students/${c.ayan._id}/account`);
      expect(acc.body.data.students[0].scholarship).toBeNull();
    });
  });

  describe('parents paying from home', () => {
    it('lists the ways to pay, without cash', async () => {
      const res = await get('/api/portal/parent/payment-methods', 'parent');
      expect(res.status).toBe(200);
      expect(res.body.data.some((m) => m.name === `EVC Plus ${tag}`)).toBe(true);
      expect(res.body.data.some((m) => /cash/i.test(m.name))).toBe(false);
    });

    it('lets a parent send a payment for their own child only', async () => {
      const body = { amount: 50, method: String(c.evc._id), reference: `TX-${tag}`, paidOn: new Date().toISOString() };
      expect((await post(`/api/portal/parent/children/${c.hodan._id}/payments`, body, 'otherparent')).status).toBe(403);
      const res = await post(`/api/portal/parent/children/${c.hodan._id}/payments`, body, 'parent');
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'pending', amount: 50 });
      c.claimId = res.body.data._id;
      expect((await post(`/api/portal/parent/children/${c.hodan._id}/payments`, body, 'parent')).status).toBe(409);
    });

    it('shows pending payments to the accountant, not to a teacher', async () => {
      expect((await get('/api/fees/payment-claims?status=pending', 'teacher')).status).toBe(403);
      const res = await get('/api/fees/payment-claims?status=pending', 'accountant');
      expect(res.body.data.pending).toBeGreaterThan(0);
      expect(res.body.data.claims.some((x) => x._id === c.claimId)).toBe(true);
    });

    it('confirming makes a receipt and pays the bill', async () => {
      const res = await post(`/api/fees/payment-claims/${c.claimId}/confirm`, {}, 'accountant');
      expect(res.status).toBe(201);
      expect(res.body.data.claim.status).toBe('confirmed');
      expect(res.body.data.receipt.receipt_no).toBeTruthy();
      expect((await bill(c.hodan._id)).status).toBe('Paid');

      const mine = await get(`/api/portal/parent/children/${c.hodan._id}/payments`, 'parent');
      expect(mine.body.data[0]).toMatchObject({ status: 'confirmed' });
      expect(mine.body.data[0].receipt.receipt_no).toBeTruthy();
      expect((await post(`/api/fees/payment-claims/${c.claimId}/confirm`, {}, 'accountant')).status).toBe(409);
    });

    it('rejecting needs a reason the parent can read', async () => {
      const sent = await post(`/api/portal/parent/children/${c.hodan._id}/payments`,
        { amount: 10, method: String(c.evc._id), reference: `TX2-${tag}` }, 'parent');
      expect((await post(`/api/fees/payment-claims/${sent.body.data._id}/reject`, { reason: '' }, 'accountant')).status).toBe(400);
      const res = await post(`/api/fees/payment-claims/${sent.body.data._id}/reject`, { reason: 'No money arrived with this reference' }, 'accountant');
      expect(res.body.data).toMatchObject({ status: 'rejected', rejectReason: 'No money arrived with this reference' });
    });

    it('shows the child\'s timetable to the parent', async () => {
      const res = await get(`/api/portal/parent/children/${c.hodan._id}/timetable`, 'parent');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect((await get(`/api/portal/parent/children/${c.ayan._id}/timetable`, 'parent')).status).toBe(403);
    });
  });
});
