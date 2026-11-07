import mongoose from 'mongoose';
import PaymentMethod from '../models/PaymentMethod.js';
import PayrollEntry from '../models/PayrollEntry.js';
import SequenceCounter from '../models/SequenceCounter.js';
import StaffSalary from '../models/StaffSalary.js';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';
import { moneyAccountCode, postJournalEntry } from './journalService.js';
import { PERIOD_RE, currentPeriod } from './monthlyFeeService.js';
import { abortTransaction, commitTransaction, startTransaction } from '../utils/transaction.js';
import { dayToDate, round2 } from '../utils/schoolMonth.js';
import { schoolToday } from '../utils/schoolTime.js';

/*
 * Salaries. Each teacher or office user has a monthly salary (StaffSalary).
 * Paying a month creates one PayrollEntry for that person and month; the entry
 * holds what is due, and every payment against it posts its own journal:
 * debit Salaries Expense, credit Cash or Bank.
 */

const SALARIES_EXPENSE = '5000';
const NON_STAFF_ROLES = ['student', 'parent', 'teacher'];

const fail = (statusCode, message) => ({ statusCode, message });
const fullName = (u) => `${u.firstName} ${u.lastName}`.trim();

const generatePayslipNumber = async (session) => {
  const year = new Date().getFullYear();
  const counter = await SequenceCounter.findOneAndUpdate({ name: 'payslip', year }, { $inc: { seq: 1 } }, { new: true, upsert: true, session });
  return `PS-${year}-${String(counter.seq).padStart(4, '0')}`;
};

const statusOf = (net, paid) => (paid <= 0 ? 'Not paid' : paid >= net ? 'Paid' : 'Part paid');

// `index` is the payment's place in the entry: what was left after it depends on
// the payments up to that one.
const payslipOf = (entry, index) => {
  const payment = entry.payments[index];
  const paidSoFar = entry.payments.slice(0, index + 1).reduce((s, p) => s + p.amount, 0);
  return {
    _id: payment._id,
    payslip_no: payment.payslip_no,
    period: entry.period,
    name: entry.staff_name,
    staffId: entry.staff_id ?? '',
    basic: entry.basic,
    allowance: entry.allowance,
    deduction: entry.deduction,
    net: entry.net,
    amount: payment.amount,
    remaining: round2(entry.net - paidSoFar),
    paid_on: payment.paid_on,
    method: payment.payment_method_name ?? '',
    paid_by: payment.paid_by ?? '',
    note: entry.note ?? '',
  };
};

/** Everyone who can be on the payroll: teachers, then office staff. */
const loadStaff = async () => {
  const [teachers, others] = await Promise.all([
    Teacher.find({ status: { $ne: 'Inactive' } }).select('userId staffId').populate('userId', 'firstName lastName status'),
    User.find({ role: { $nin: NON_STAFF_ROLES }, status: true }).select('firstName lastName role'),
  ]);
  return [
    ...teachers.filter((t) => t.userId && t.userId.status !== false).map((t) => ({ user: t.userId._id, name: fullName(t.userId), staffId: t.staffId, kind: 'teacher' })),
    ...others.map((u) => ({ user: u._id, name: fullName(u), staffId: '', kind: 'staff', role: u.role })),
  ];
};

/** The month's payroll: one row per person, with what is due, paid and left. */
export const getPayroll = async (period = currentPeriod()) => {
  if (!PERIOD_RE.test(period)) throw fail(400, 'Month must look like 2026-07.');

  const [staff, salaries, entries] = await Promise.all([
    loadStaff(),
    StaffSalary.find(),
    PayrollEntry.find({ period }),
  ]);
  const salaryOf = new Map(salaries.map((s) => [String(s.user), s]));
  const entryOf = new Map(entries.map((e) => [String(e.user), e]));

  // Someone who has left still shows in the months they were paid.
  const known = new Set(staff.map((s) => String(s.user)));
  const former = entries.filter((e) => !known.has(String(e.user)))
    .map((e) => ({ user: e.user, name: e.staff_name, staffId: e.staff_id ?? '', kind: 'staff' }));

  const rows = [...staff, ...former].map((s) => {
    const salary = salaryOf.get(String(s.user));
    const entry = entryOf.get(String(s.user));
    const net = entry?.net ?? salary?.amount ?? 0;
    const paid = entry?.paid ?? 0;
    return {
      ...s,
      salary: salary?.amount ?? null,
      salaryHistory: salary?.history ?? [],
      basic: entry?.basic ?? salary?.amount ?? 0,
      allowance: entry?.allowance ?? 0,
      deduction: entry?.deduction ?? 0,
      net,
      paid,
      remaining: round2(net - paid),
      status: statusOf(net, paid),
      note: entry?.note ?? '',
      payslips: entry ? entry.payments.map((_, i) => payslipOf(entry, i)) : [],
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind, 'en') * -1 || a.name.localeCompare(b.name));

  const onPayroll = rows.filter((r) => r.net > 0);
  const sum = (key) => round2(onPayroll.reduce((t, r) => t + r[key], 0));
  return {
    period,
    rows,
    summary: {
      people: onPayroll.length,
      due: sum('net'),
      paid: sum('paid'),
      remaining: sum('remaining'),
      fullyPaid: onPayroll.filter((r) => r.status === 'Paid').length,
    },
  };
};

export const setSalary = async (userId, amount, changedBy) => {
  const user = await User.findById(userId).select('role');
  if (!user || ['student', 'parent'].includes(user.role)) throw fail(404, 'Staff member not found.');
  const existing = await StaffSalary.findOne({ user: userId });
  if (existing?.amount === amount) return existing;
  return StaffSalary.findOneAndUpdate(
    { user: userId },
    { $set: { amount }, $push: { history: { amount, changed_by: changedBy, changed_at: new Date() } } },
    { new: true, upsert: true }
  );
};

// The entry for this person and month, created from their salary on first use.
const entryFor = async (userId, period, session) => {
  const existing = await PayrollEntry.findOne({ user: userId, period }).session(session);
  if (existing) return existing;

  // One at a time: a session can't run operations side by side.
  const salary = await StaffSalary.findOne({ user: userId }).session(session);
  const user = await User.findById(userId).select('firstName lastName').session(session);
  const teacher = await Teacher.findOne({ userId }).select('staffId').session(session);
  if (!user) throw fail(404, 'Staff member not found.');
  if (!(salary?.amount > 0)) throw fail(400, `Set ${fullName(user)}'s monthly salary first.`);
  return new PayrollEntry({
    user: userId, period, staff_name: fullName(user), staff_id: teacher?.staffId, basic: salary.amount, net: salary.amount,
  });
};

const paySalary = async ({ user, amount, allowance, deduction, note }, { period, method, paidOn, paidBy }) => {
  const session = await mongoose.startSession();
  await startTransaction(session);
  try {
    const entry = await entryFor(user, period, session);

    if (entry.paid > 0) {
      // What was agreed for the month is settled once money has gone out.
      if ((allowance ?? entry.allowance) !== entry.allowance || (deduction ?? entry.deduction) !== entry.deduction) {
        throw fail(400, `${entry.staff_name} is already part paid for this month, so the allowance and deduction can't change.`);
      }
    } else {
      entry.allowance = allowance ?? entry.allowance;
      entry.deduction = deduction ?? entry.deduction;
      entry.net = round2(entry.basic + entry.allowance - entry.deduction);
      if (entry.net <= 0) throw fail(400, `The deduction is more than ${entry.staff_name}'s pay.`);
    }

    const remaining = round2(entry.net - entry.paid);
    if (remaining <= 0) throw fail(400, `${entry.staff_name} has already been paid for this month.`);
    const pay = round2(amount ?? remaining);
    if (!(pay > 0)) throw fail(400, 'Enter the amount to pay.');
    if (pay > remaining) throw fail(400, `Only ${remaining} is left to pay ${entry.staff_name} for this month.`);

    const paidBefore = entry.paid;
    const payment = {
      _id: new mongoose.Types.ObjectId(),
      payslip_no: await generatePayslipNumber(session),
      amount: pay,
      paid_on: paidOn,
      payment_method: method._id,
      payment_method_name: method.payment_method_name,
      paid_by: paidBy,
    };
    entry.paid = round2(paidBefore + pay);
    entry.note = note ?? entry.note;
    entry.payments.push(payment);
    if (entry.isNew) {
      await entry.save({ session });
    } else {
      // Only if nobody else paid this person in the meantime: a second click or
      // a second accountant must not pay the same month again.
      const claimed = await PayrollEntry.findOneAndUpdate(
        { _id: entry._id, paid: paidBefore },
        { $set: { paid: entry.paid, allowance: entry.allowance, deduction: entry.deduction, net: entry.net, note: entry.note ?? '' }, $push: { payments: payment } },
        { session }
      );
      if (!claimed) throw fail(409, `${entry.staff_name} was just paid by someone else. Refresh and check.`);
    }

    const journal = await postJournalEntry({
      date: paidOn,
      referenceType: 'Salary',
      referenceId: entry._id,
      journalNumber: `JRN-${payment.payslip_no}`,
      description: `Salary ${period} - ${entry.staff_name}`,
      lines: [
        { accountCode: SALARIES_EXPENSE, debit: pay, credit: 0 },
        { accountCode: moneyAccountCode(method.payment_method_name), debit: 0, credit: pay },
      ],
      session,
    });
    await PayrollEntry.updateOne(
      { _id: entry._id, 'payments._id': payment._id },
      { $set: { 'payments.$.journalEntryId': journal._id } },
      { session }
    );

    await commitTransaction(session);
    return payslipOf(entry, entry.payments.length - 1);
  } catch (err) {
    await abortTransaction(session);
    // Two payments racing for the same month: the unique index or the
    // transaction stopped this one, and nothing was paid.
    if (err?.code === 11000 || err?.code === 112) throw fail(409, 'This person was just paid by someone else. Refresh and check.');
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Pay one or many people for `period`. Each person stands alone, so one who
 * can't be paid doesn't hold up the rest: they come back in `failed`.
 */
export const paySalaries = async ({ period, items, payment_method, paid_on }, user) => {
  if (period > currentPeriod()) throw fail(400, "A month that hasn't started yet can't be paid.");
  const day = paid_on ?? schoolToday();
  if (day > schoolToday()) throw fail(400, "The payment date can't be in the future.");
  const method = await PaymentMethod.findById(payment_method);
  if (!method) throw fail(400, 'Choose how the salary was paid.');

  const context = { period, method, paidOn: dayToDate(day), paidBy: user?.name || user?.email || 'system' };
  const payslips = [];
  const failed = [];
  for (const item of items) {
    try {
      payslips.push(await paySalary(item, context));
    } catch (err) {
      if (!err?.statusCode || err instanceof Error) throw err;
      failed.push({ user: item.user, message: err.message, statusCode: err.statusCode });
    }
  }
  if (!payslips.length) throw fail(failed[0].statusCode, failed[0].message);
  return { payslips, failed: failed.map(({ user: id, message }) => ({ user: id, message })) };
};
