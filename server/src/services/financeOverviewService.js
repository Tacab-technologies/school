import Class from '../models/Class.js';
import Expense from '../models/Expense.js';
import PayrollEntry from '../models/PayrollEntry.js';
import Refund from '../models/Refund.js';
import Student from '../models/Student.js';
import StudentFee from '../models/StudentFee.js';
import StudentInvoice from '../models/StudentInvoice.js';
import { PERIOD_RE, currentPeriod } from './monthlyFeeService.js';
import { round2, schoolMonthRange } from '../utils/schoolMonth.js';

/*
 * The accountant's first screen, in one request: what each class was billed,
 * what has been collected and who still owes, then the money that came in and
 * went out. Billed/collected/owed follow the bills of the chosen month, so they
 * are net of refunds; money in and out follows the day the cash actually moved.
 */

const rate = (collected, billed) => (billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0);

const sumOf = async (Model, match, field) => {
  const [row] = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: field } } }]);
  return round2(row?.total ?? 0);
};

const feesReceived = (range) => sumOf(StudentFee, range ? { registerDate: range } : {}, '$paid_amount');

const salariesPaid = async (range) => {
  const [row] = await PayrollEntry.aggregate([
    ...(range ? [{ $match: { 'payments.paid_on': range } }] : []),
    { $unwind: '$payments' },
    ...(range ? [{ $match: { 'payments.paid_on': range } }] : []),
    { $group: { _id: null, total: { $sum: '$payments.amount' } } },
  ]);
  return round2(row?.total ?? 0);
};

const cashFlow = async (range) => {
  const [feesCollected, salaries, expenses, refunds] = await Promise.all([
    feesReceived(range),
    salariesPaid(range),
    sumOf(Expense, { status: 'Paid', ...(range ? { expenseDate: range } : {}) }, '$amount'),
    sumOf(Refund, { status: 'issued', ...(range ? { refundDate: range } : {}) }, '$amount'),
  ]);
  const moneyOut = round2(salaries + expenses + refunds);
  return { feesCollected, salaries, expenses, refunds, moneyOut, balance: round2(feesCollected - moneyOut) };
};

/** `period` is one month ('YYYY-MM'), or left out for all months. */
export const getOverview = async ({ period } = {}) => {
  if (period && !PERIOD_RE.test(period)) throw { statusCode: 400, message: 'Month must look like 2026-07.' };
  const thisMonth = currentPeriod();

  const [classes, enrolled, billedByStudent, cash, receivedThisMonth] = await Promise.all([
    Class.find().select('cl_name').lean(),
    Student.find({ isDeleted: false, status: 'Active' }).select('classId').lean(),
    StudentInvoice.aggregate([
      ...(period ? [{ $match: { period } }] : []),
      {
        $group: {
          _id: { student: '$student', classId: '$class_id' },
          billed: { $sum: '$invoice_amount' },
          collected: { $sum: '$paid_amount' },
          owed: { $sum: '$balance' },
        },
      },
    ]),
    cashFlow(period ? schoolMonthRange(period) : null),
    period ? null : feesReceived(schoolMonthRange(thisMonth)),
  ]);

  // One-off bills carry no class: they count under the student's class. Anyone
  // not in the active list (they have left) needs one extra lookup.
  const classOf = new Map(enrolled.map((s) => [String(s._id), s.classId ? String(s.classId) : null]));
  const unplaced = billedByStudent.filter((b) => !b._id.classId && !classOf.has(String(b._id.student))).map((b) => b._id.student);
  if (unplaced.length) {
    for (const s of await Student.find({ _id: { $in: unplaced } }).select('classId').lean()) {
      classOf.set(String(s._id), s.classId ? String(s.classId) : null);
    }
  }

  const names = new Map(classes.map((c) => [String(c._id), c.cl_name]));
  const rows = new Map();
  const rowFor = (id) => {
    const key = id && names.has(id) ? id : 'none';
    if (!rows.has(key)) {
      rows.set(key, {
        classId: key === 'none' ? null : key, name: names.get(key) ?? 'No class',
        students: 0, billed: 0, collected: 0, owed: 0, fullyPaid: 0, owing: 0, notCharged: 0,
      });
    }
    return rows.get(key);
  };
  for (const c of classes) rowFor(String(c._id));

  // A student who moved class has bills under both: each class counts the bills
  // it raised, so a student is judged per class.
  const perClassStudent = new Map();
  const billedStudents = new Set();
  for (const b of billedByStudent) {
    const studentId = String(b._id.student);
    billedStudents.add(studentId);
    const row = rowFor(b._id.classId ? String(b._id.classId) : classOf.get(studentId));
    row.billed += b.billed;
    row.collected += b.collected;
    row.owed += b.owed;
    const key = `${row.classId}:${studentId}`;
    perClassStudent.set(key, { row, owed: (perClassStudent.get(key)?.owed ?? 0) + b.owed });
  }
  for (const { row, owed } of perClassStudent.values()) {
    if (owed > 0) row.owing += 1;
    else row.fullyPaid += 1;
  }
  for (const s of enrolled) {
    const row = rowFor(s.classId ? String(s.classId) : null);
    row.students += 1;
    if (!billedStudents.has(String(s._id))) row.notCharged += 1;
  }

  const finished = [...rows.values()]
    // The catch-all row only appears when something is actually in it.
    .filter((r) => r.classId || r.students || r.billed)
    .map((r) => ({ ...r, billed: round2(r.billed), collected: round2(r.collected), owed: round2(r.owed), rate: rate(r.collected, r.billed) }))
    .sort((a, b) => (!a.classId) - (!b.classId) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  const total = (key) => finished.reduce((t, r) => t + r[key], 0);
  const totals = {
    students: total('students'), billed: round2(total('billed')), collected: round2(total('collected')), owed: round2(total('owed')),
    fullyPaid: total('fullyPaid'), owing: total('owing'), notCharged: total('notCharged'),
  };

  return {
    period: period ?? null,
    currentPeriod: thisMonth,
    classes: finished,
    totals: { ...totals, rate: rate(totals.collected, totals.billed) },
    // Received in the chosen month, or in this month when showing all months.
    receivedInMonth: period ? cash.feesCollected : receivedThisMonth,
    cash,
  };
};
