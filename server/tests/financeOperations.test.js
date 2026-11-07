import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/server.js';
import User from '../src/models/User.js';
import Teacher from '../src/models/Teacher.js';
import Level from '../src/models/Level.js';
import Year from '../src/models/Year.js';
import Class from '../src/models/Class.js';
import Student from '../src/models/Student.js';
import PaymentMethod from '../src/models/PaymentMethod.js';
import FeeStructure from '../src/models/FeeStructure.js';
import StudentFee from '../src/models/StudentFee.js';
import StudentInvoice from '../src/models/StudentInvoice.js';
import Expense from '../src/models/Expense.js';
import Refund from '../src/models/Refund.js';
import StaffSalary from '../src/models/StaffSalary.js';
import PayrollEntry from '../src/models/PayrollEntry.js';
import JournalEntry from '../src/models/JournalEntry.js';
import JournalLine from '../src/models/JournalLine.js';
import ChartOfAccount from '../src/models/ChartOfAccount.js';
import AuditLog from '../src/models/auditLog.model.js';
import AuditModule from '../src/models/auditModule.model.js';
import { generateAccessToken } from '../src/utils/tokenService.js';
import { addMonths, currentPeriod, ensureFeeIndexes } from '../src/services/monthlyFeeService.js';
import { schoolToday } from '../src/utils/schoolTime.js';

// The accountant's money screens: the overview per class, salaries, expenses
// and refunds, and that every one of them keeps the ledger balanced.
const tag = `fo${Date.now()}`;
const now = currentPeriod();
const prev = addMonths(now, -1);
const today = schoolToday();

describe('Finance operations', () => {
  const tokens = {};
  const c = {};

  const as = (role) => ({ Authorization: `Bearer ${tokens[role]}` });
  const get = (url, role = 'accountant') => request(app).get(url).set(as(role));
  const post = (url, body, role = 'accountant') => request(app).post(url).set(as(role)).send(body);
  const put = (url, body, role = 'accountant') => request(app).put(url).set(as(role)).send(body);
  const del = (url, role = 'accountant') => request(app).delete(url).set(as(role));

  const makeStudent = (firstName, classId) => Student.create({
    firstName, lastName: tag, admissionNumber: `${tag}-${firstName}`, gender: 'Male', birthDate: new Date('2015-01-01'), classId,
    phoneNumber: '0610000000', address: 'Test', parentName: 'Parent', parentPhoneNumber: '0619999999',
  });

  const overview = async (period) => {
    const res = await get(`/api/fees/overview${period ? `?period=${period}` : ''}`);
    expect(res.status).toBe(200);
    return res.body.data;
  };

  // Every journal for this document, with its lines.
  const journalsFor = async (referenceId) => {
    const entries = await JournalEntry.find({ referenceId }).sort({ createdAt: 1 });
    const lines = await JournalLine.find({ journalEntryId: { $in: entries.map((e) => e._id) } }).populate('accountId', 'accountCode');
    return { entries, lines };
  };
  const sum = (lines, key) => Math.round(lines.reduce((s, l) => s + l[key], 0) * 100) / 100;
  const netOn = (lines, code) => sum(lines.filter((l) => l.accountId.accountCode === code), 'debit')
    - sum(lines.filter((l) => l.accountId.accountCode === code), 'credit');

  beforeAll(async () => {
    await ensureFeeIndexes();
    await PayrollEntry.syncIndexes();
    await StaffSalary.syncIndexes();

    for (const role of ['admin', 'accountant', 'principal', 'teacher']) {
      const u = await User.create({ firstName: 'Fo', lastName: role, email: `${role}.${tag}@test.com`, password: 'password123', role });
      tokens[role] = generateAccessToken(u);
      c[role] = u;
    }
    c.teacherUser = await User.create({ firstName: 'Asha', lastName: tag, email: `asha.${tag}@test.com`, password: 'password123', role: 'teacher' });
    c.teacher = await Teacher.create({ userId: c.teacherUser._id, staffId: `${tag}-T1` });
    c.teacher2User = await User.create({ firstName: 'Bile', lastName: tag, email: `bile.${tag}@test.com`, password: 'password123', role: 'teacher' });
    await Teacher.create({ userId: c.teacher2User._id, staffId: `${tag}-T2` });

    const level = await Level.create({ lev_no: `${tag}-L`, lev_name: `${tag} level` });
    await Year.create({ y_no: `${tag}-Y`, y_name: now.slice(0, 4) });
    c.g2 = await Class.create({ cl_no: `${tag}-G2`, cl_name: `${tag} Grade 2`, lev_no: level._id });
    c.g10 = await Class.create({ cl_no: `${tag}-G10`, cl_name: `${tag} Grade 10`, lev_no: level._id });
    c.cash = await PaymentMethod.create({ payment_method_no: `${tag}-CASH`, payment_method_name: 'Cash' });
    c.bank = await PaymentMethod.create({ payment_method_no: `${tag}-BANK`, payment_method_name: 'Bank Transfer' });

    c.amina = await makeStudent('Amina', c.g2._id);
    c.bashir = await makeStudent('Bashir', c.g2._id);
    c.cali = await makeStudent('Cali', c.g2._id);
    c.deqa = await makeStudent('Deqa', c.g10._id);

    expect((await put(`/api/fees/class-fees/${c.g2._id}`, { amount: 30 }, 'admin')).status).toBe(200);
    expect((await put(`/api/fees/class-fees/${c.g10._id}`, { amount: 50 }, 'admin')).status).toBe(200);
    await post('/api/fees/charge', { period: prev, class_id: String(c.g2._id) });
    await post('/api/fees/charge', { period: now, class_id: String(c.g2._id) });
    await post('/api/fees/charge', { period: now, class_id: String(c.g10._id) });

    const invoice = (student, period) => StudentInvoice.findOne({ student: student._id, period });
    const pay = async (student, period, amount) => {
      const res = await post('/api/fees/collect', {
        student_ids: [String(student._id)], invoice_ids: [String((await invoice(student, period))._id)], amount, payment_method: String(c.cash._id),
      });
      expect(res.status).toBe(201);
      return res.body.data;
    };
    c.receipt = await pay(c.amina, now, 30); // fully paid this month
    await pay(c.bashir, now, 10);            // part paid; Cali has paid nothing
    await pay(c.amina, prev, 30);            // and last month
  }, 60000);

  describe('Overview', () => {
    const row = (data, klass) => data.classes.find((r) => r.classId === String(klass._id));

    it('shows each class: students, billed, collected, owed, who paid and who owes', async () => {
      const data = await overview(now);
      expect(row(data, c.g2)).toMatchObject({
        students: 3, billed: 90, collected: 40, owed: 50, fullyPaid: 1, owing: 2, notCharged: 0, rate: 44.4,
      });
      expect(row(data, c.g10)).toMatchObject({ students: 1, billed: 50, collected: 0, owed: 50, fullyPaid: 0, owing: 1, rate: 0 });
    });

    it('sorts classes so Grade 2 comes before Grade 10, and the totals add up', async () => {
      const data = await overview(now);
      const names = data.classes.map((r) => r.name);
      expect(names.indexOf(`${tag} Grade 2`)).toBeLessThan(names.indexOf(`${tag} Grade 10`));
      expect(data.totals.billed).toBeCloseTo(data.classes.reduce((s, r) => s + r.billed, 0), 2);
      expect(data.totals.owed).toBeCloseTo(data.classes.reduce((s, r) => s + r.owed, 0), 2);
      expect(data.totals.students).toBe(data.classes.reduce((s, r) => s + r.students, 0));
    });

    it('counts students who have not been charged for the month', async () => {
      const data = await overview(prev);
      expect(row(data, c.g2)).toMatchObject({ billed: 90, collected: 30, fullyPaid: 1, owing: 2 });
      expect(row(data, c.g10)).toMatchObject({ students: 1, billed: 0, notCharged: 1 });
    });

    it('adds every month together when no month is chosen', async () => {
      const data = await overview();
      expect(data.period).toBeNull();
      expect(row(data, c.g2)).toMatchObject({ billed: 180, collected: 70, owed: 110, fullyPaid: 1, owing: 2 });
    });

    it('rejects a bad month and keeps it from teachers', async () => {
      expect((await get('/api/fees/overview?period=2026-13')).status).toBe(400);
      expect((await get('/api/fees/overview', 'teacher')).status).toBe(403);
    });
  });

  describe('Salaries', () => {
    const asha = () => String(c.teacherUser._id);
    const bile = () => String(c.teacher2User._id);
    const payload = (items, extra) => ({ period: now, items, payment_method: String(c.cash._id), paid_on: today, ...extra });
    const payrollRow = async (user, period = now) => (await get(`/api/fees/payroll?period=${period}`)).body.data.rows.find((r) => String(r.user) === user);

    it('keeps salaries away from teachers and the principal', async () => {
      expect((await get(`/api/fees/payroll?period=${now}`, 'teacher')).status).toBe(403);
      expect((await get(`/api/fees/payroll?period=${now}`, 'principal')).status).toBe(403);
      expect((await put(`/api/fees/payroll/salaries/${asha()}`, { amount: 900 }, 'teacher')).status).toBe(403);
      expect((await post('/api/fees/payroll/pay', payload([{ user: asha() }]), 'teacher')).status).toBe(403);
    });

    it('sets a salary and keeps the earlier amounts', async () => {
      expect((await put(`/api/fees/payroll/salaries/${asha()}`, { amount: 300 })).status).toBe(200);
      const res = await put(`/api/fees/payroll/salaries/${asha()}`, { amount: 400 });
      expect(res.status).toBe(200);
      expect(res.body.data.history.map((h) => h.amount)).toEqual([300, 400]);
      await put(`/api/fees/payroll/salaries/${bile()}`, { amount: 250 });

      expect(await payrollRow(asha())).toMatchObject({ kind: 'teacher', salary: 400, net: 400, paid: 0, remaining: 400, status: 'Not paid' });
    });

    it('will not pay someone with no salary, or a month that has not started', async () => {
      const someone = await User.create({ firstName: 'No', lastName: 'Salary', email: `nosalary.${tag}@test.com`, password: 'password123', role: 'accountant' });
      const res = await post('/api/fees/payroll/pay', payload([{ user: String(someone._id) }]));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/salary first/);
      expect((await post('/api/fees/payroll/pay', payload([{ user: asha() }], { period: addMonths(now, 1) }))).status).toBe(400);
    });

    it('pays a whole month once, with an allowance and deduction, and posts a balanced journal', async () => {
      const res = await post('/api/fees/payroll/pay', payload([{ user: bile(), allowance: 50, deduction: 20, note: 'Transport' }]));
      expect(res.status).toBe(201);
      expect(res.body.data.payslips[0]).toMatchObject({ amount: 280, net: 280, basic: 250, allowance: 50, deduction: 20, remaining: 0, method: 'Cash', note: 'Transport' });
      expect(await payrollRow(bile())).toMatchObject({ status: 'Paid', paid: 280, remaining: 0 });

      const entry = await PayrollEntry.findOne({ user: bile(), period: now });
      const { lines } = await journalsFor(entry._id);
      expect(sum(lines, 'debit')).toBe(280);
      expect(sum(lines, 'credit')).toBe(280);
      expect(netOn(lines, '5000')).toBe(280);
      expect(netOn(lines, '1000')).toBe(-280);

      const again = await post('/api/fees/payroll/pay', payload([{ user: bile() }]));
      expect(again.status).toBe(400);
      expect(again.body.message).toMatch(/already been paid/);
      expect((await PayrollEntry.findOne({ user: bile(), period: now })).paid).toBe(280);
    });

    it('pays part of a month, then only what is left', async () => {
      const first = await post('/api/fees/payroll/pay', payload([{ user: asha(), amount: 150 }], { payment_method: String(c.bank._id) }));
      expect(first.status).toBe(201);
      expect(first.body.data.payslips[0]).toMatchObject({ amount: 150, remaining: 250 });
      expect(await payrollRow(asha())).toMatchObject({ status: 'Part paid', paid: 150, remaining: 250 });

      expect((await post('/api/fees/payroll/pay', payload([{ user: asha(), amount: 300 }]))).status).toBe(400);
      expect((await post('/api/fees/payroll/pay', payload([{ user: asha(), amount: 10, allowance: 5 }]))).status).toBe(400);

      const rest = await post('/api/fees/payroll/pay', payload([{ user: asha() }]));
      expect(rest.status).toBe(201);
      expect(rest.body.data.payslips[0]).toMatchObject({ amount: 250, remaining: 0 });

      const row = await payrollRow(asha());
      expect(row).toMatchObject({ status: 'Paid', paid: 400 });
      expect(row.payslips.map((p) => p.remaining)).toEqual([250, 0]);

      const entry = await PayrollEntry.findOne({ user: asha(), period: now });
      expect(entry.payments).toHaveLength(2);
      expect(entry.payments.every((p) => p.journalEntryId)).toBe(true);
      const { lines } = await journalsFor(entry._id);
      expect(netOn(lines, '5000')).toBe(400);
      expect(netOn(lines, '1010')).toBe(-150);
      expect(netOn(lines, '1000')).toBe(-250);
    });

    it('never pays a month twice when two payments land together', async () => {
      const results = await Promise.all([
        post('/api/fees/payroll/pay', payload([{ user: bile() }], { period: prev })),
        post('/api/fees/payroll/pay', payload([{ user: bile() }], { period: prev })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await PayrollEntry.findOne({ user: bile(), period: prev })).paid).toBe(250);
    });

    it('pays several people at once and reports whoever could not be paid', async () => {
      const period = addMonths(now, -2);
      const res = await post('/api/fees/payroll/pay', payload([{ user: asha() }, { user: String(c.accountant._id) }, { user: bile() }], { period }));
      expect(res.status).toBe(201);
      expect(res.body.data.payslips).toHaveLength(2);
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.failed[0].message).toMatch(/salary first/);
    });

    it('writes paying to the audit log', async () => {
      const moduleDoc = await AuditModule.findOne({ module_name: 'PayrollEntry' });
      expect(moduleDoc).toBeTruthy();
      expect(await AuditLog.countDocuments({ module_no: moduleDoc._id })).toBeGreaterThan(0);
    });
  });

  describe('Expenses', () => {
    const body = (extra) => ({
      date: today, category: 'Electricity', amount: 120.5, paid_to: 'BECO', payment_method: String(c.cash._id), receipt_no: 'B-1', ...extra,
    });

    it('records one and posts a balanced journal to the right accounts', async () => {
      const res = await post('/api/expenses', body());
      expect(res.status).toBe(201);
      c.expense = res.body.data;
      expect(c.expense).toMatchObject({ category: 'Electricity', amount: 120.5, paidTo: 'BECO', paymentMethod: 'Cash', receiptNo: 'B-1' });

      const { lines } = await journalsFor(c.expense._id);
      expect(sum(lines, 'debit')).toBe(120.5);
      expect(sum(lines, 'credit')).toBe(120.5);
      expect(netOn(lines, '5300')).toBe(120.5);
      expect(netOn(lines, '1000')).toBe(-120.5);
    });

    it('takes a typed category, and rejects an empty amount or a future date', async () => {
      const res = await post('/api/expenses', body({ category: 'Exam printing', amount: 40, payment_method: String(c.bank._id) }));
      expect(res.status).toBe(201);
      const { lines } = await journalsFor(res.body.data._id);
      expect(netOn(lines, '5500')).toBe(40);
      expect(netOn(lines, '1010')).toBe(-40);

      expect((await post('/api/expenses', body({ amount: 0 }))).status).toBe(400);
      expect((await post('/api/expenses', body({ date: '2999-01-01' }))).status).toBe(400);
    });

    it('lists by month and category with totals', async () => {
      const data = (await get(`/api/expenses?period=${now}`)).body.data;
      expect(data.total).toBeGreaterThanOrEqual(160.5);
      expect(data.categories).toEqual(expect.arrayContaining(['Rent', 'Exam printing']));
      const one = (await get(`/api/expenses?period=${now}&category=Electricity`)).body.data;
      expect(one.rows.every((r) => r.category === 'Electricity')).toBe(true);
      expect((await get(`/api/expenses?period=${prev}&category=Electricity`)).body.data.total).toBe(0);
    });

    it('reposts the journal when the money changes, and leaves it alone otherwise', async () => {
      const noteOnly = await put(`/api/expenses/${c.expense._id}`, { note: 'October bill' });
      expect(noteOnly.status).toBe(200);
      expect((await journalsFor(c.expense._id)).entries).toHaveLength(1);

      const res = await put(`/api/expenses/${c.expense._id}`, { amount: 100, category: 'Rent' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ amount: 100, category: 'Rent', note: 'October bill' });

      const { entries, lines } = await journalsFor(c.expense._id);
      expect(entries).toHaveLength(3); // the original, its reversal, the corrected one
      expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
      expect(netOn(lines, '5300')).toBe(0);
      expect(netOn(lines, '5600')).toBe(100);
      expect(netOn(lines, '1000')).toBe(-100);
    });

    it('deletes by cancelling and reversing the journal, once', async () => {
      expect((await del(`/api/expenses/${c.expense._id}`, 'teacher')).status).toBe(403);
      expect((await del(`/api/expenses/${c.expense._id}`, 'principal')).status).toBe(403);

      const res = await del(`/api/expenses/${c.expense._id}`);
      expect(res.status).toBe(200);
      expect((await Expense.findById(c.expense._id)).status).toBe('Cancelled');

      const { lines } = await journalsFor(c.expense._id);
      expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
      for (const code of ['5300', '5600', '1000']) expect(netOn(lines, code)).toBe(0);

      expect((await del(`/api/expenses/${c.expense._id}`)).status).toBe(404);
      const rows = (await get(`/api/expenses?period=${now}`)).body.data.rows;
      expect(rows.some((r) => r._id === c.expense._id)).toBe(false);

      const moduleDoc = await AuditModule.findOne({ module_name: 'Expense' });
      expect(await AuditLog.countDocuments({ module_no: moduleDoc._id })).toBeGreaterThanOrEqual(3);
    });

    it('keeps the list from teachers', async () => {
      expect((await get('/api/expenses', 'teacher')).status).toBe(403);
      expect((await post('/api/expenses', body(), 'teacher')).status).toBe(403);
      expect((await get('/api/expenses/suppliers', 'teacher')).status).toBe(403);
    });
  });

  describe('Refunds', () => {
    const payments = async (student) => (await get(`/api/refunds/student/${student._id}/payments`)).body.data;
    const nowPayment = async () => (await payments(c.amina)).find((p) => p.period === now);

    it('lists what a student paid and what can be refunded', async () => {
      const rows = await payments(c.amina);
      expect(rows).toHaveLength(2);
      expect(await nowPayment()).toMatchObject({ paid: 30, refunded: 0, refundable: 30, receipt_no: c.receipt.receipt_no, method: 'Cash' });
      expect((await get(`/api/refunds/student/${c.amina._id}/payments`, 'teacher')).status).toBe(403);
    });

    it('cannot refund more than was paid', async () => {
      const res = await post('/api/refunds', { student_fee_no: (await nowPayment())._id, amount: 31, reason: 'Too much' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/exceeds/);
      expect(await Refund.countDocuments({ student: c.amina._id })).toBe(0);
    });

    it('refunds part of a payment: the bill reopens and the journal balances', async () => {
      const res = await post('/api/refunds', { student_fee_no: (await nowPayment())._id, amount: 10, reason: 'Left early' });
      expect(res.status).toBe(201);
      c.refund = res.body.data;

      const invoice = await StudentInvoice.findOne({ student: c.amina._id, period: now });
      expect(invoice).toMatchObject({ paid_amount: 20, balance: 10, status: 'Partially_Paid' });

      const { lines } = await journalsFor(c.refund._id);
      expect(sum(lines, 'debit')).toBe(10);
      expect(sum(lines, 'credit')).toBe(10);
      expect(netOn(lines, '1200')).toBe(10);
      expect(netOn(lines, '1000')).toBe(-10);

      expect(await nowPayment()).toMatchObject({ refunded: 10, refundable: 20 });
      const over = await post('/api/refunds', { student_fee_no: (await nowPayment())._id, amount: 25, reason: 'Again' });
      expect(over.status).toBe(400);
    });

    it('shows the refund as money out, and the overview follows the bills', async () => {
      const data = await overview(now);
      expect(data.cash.refunds).toBeGreaterThanOrEqual(10);
      expect(data.cash.salaries).toBeGreaterThanOrEqual(680);
      expect(data.cash.balance).toBeCloseTo(data.cash.feesCollected - data.cash.salaries - data.cash.expenses - data.cash.refunds, 2);
      expect(data.classes.find((r) => r.classId === String(c.g2._id))).toMatchObject({ collected: 30, owed: 60, fullyPaid: 0, owing: 3 });
      // The cash taken stays as it was: the refund is counted once, as money out.
      expect(data.cash.feesCollected).toBeGreaterThanOrEqual(70);
    });

    it('reverses a refund, undoing the bill and the journal, only once', async () => {
      const res = await post(`/api/refunds/${c.refund._id}/reverse`, {});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reversed');
      expect(await StudentInvoice.findOne({ student: c.amina._id, period: now })).toMatchObject({ paid_amount: 30, balance: 0, status: 'Paid' });

      const { lines } = await journalsFor(c.refund._id);
      expect(netOn(lines, '1200')).toBe(0);
      expect(netOn(lines, '1000')).toBe(0);
      expect((await post(`/api/refunds/${c.refund._id}/reverse`, {})).status).toBe(400);
    });

    it('will not reverse a refund once the reopened bill has been paid again', async () => {
      const payment = (await payments(c.amina)).find((p) => p.period === prev);
      const refund = (await post('/api/refunds', { student_fee_no: payment._id, amount: 30, reason: 'Mistake' })).body.data;
      const invoice = await StudentInvoice.findOne({ student: c.amina._id, period: prev });
      expect(invoice.status).toBe('Unpaid');

      await post('/api/fees/collect', { student_ids: [String(c.amina._id)], invoice_ids: [String(invoice._id)], amount: 30, payment_method: String(c.cash._id) });
      const res = await post(`/api/refunds/${refund._id}/reverse`, {});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/paid again/);
      expect(await StudentInvoice.findById(invoice._id)).toMatchObject({ paid_amount: 30, balance: 0 });
    });

    it('filters the list by month and keeps recording from teachers', async () => {
      expect((await get(`/api/refunds?period=${now}&student_id=${c.amina._id}`)).body.data.length).toBe(2);
      expect((await get(`/api/refunds?period=${addMonths(now, -6)}&student_id=${c.amina._id}`)).body.data.length).toBe(0);
      expect((await get('/api/refunds', 'teacher')).status).toBe(403);
      expect((await post('/api/refunds', { student_fee_no: String(new mongoose.Types.ObjectId()), amount: 1, reason: 'x' }, 'teacher')).status).toBe(403);
    });
  });

  it('posts a journal for each fee payment, so cash and receivables stay right', async () => {
    const { lines } = await journalsFor(c.receipt._id);
    expect(netOn(lines, '1000')).toBe(30);
    expect(netOn(lines, '1200')).toBe(-30);
  });

  it('leaves every journal in this run balanced', async () => {
    const totals = await JournalLine.aggregate([
      { $group: { _id: '$journalEntryId', debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
    ]);
    expect(totals.length).toBeGreaterThan(0);
    for (const t of totals) expect(Math.round((t.debit - t.credit) * 100)).toBe(0);
    expect(await ChartOfAccount.findOne({ accountCode: '5000' })).toMatchObject({ accountName: 'Salaries Expense' });
    expect(await StudentFee.countDocuments()).toBeGreaterThan(0);
    expect(await FeeStructure.countDocuments({ class_id: c.g2._id })).toBe(1);
  });
});
