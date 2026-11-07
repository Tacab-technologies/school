import PaymentClaim from '../models/PaymentClaim.js';
import PaymentMethod from '../models/PaymentMethod.js';
import Student from '../models/Student.js';
import Guardian from '../models/Guardian.js';
import Class from '../models/Class.js';
import FeeStructure from '../models/FeeStructure.js';
import StudentInvoice from '../models/StudentInvoice.js';
import { PERIOD_RE, collectPayment, currentPeriod, periodsBetween } from './monthlyFeeService.js';
import { computeStudentDiscount } from './invoiceService.js';

/*
 * Parents paying from home: the parent sends the school mobile money (EVC Plus,
 * Zaad, eDahab...) or a bank transfer, then records it in the portal with the
 * transaction reference. The accountant checks it arrived and confirms it,
 * which takes the payment through the normal counter flow (receipt, balances,
 * ledger). Or they reject it with a reason the parent can read.
 */

const fail = (statusCode, message) => ({ statusCode, message });
const round2 = (n) => Math.round(n * 100) / 100;

/** Payment methods a parent can use from home: everything except cash. */
export async function homePaymentMethods() {
  const methods = await PaymentMethod.find().sort({ payment_method_name: 1 }).lean();
  return methods
    .filter((m) => !/cash/i.test(m.payment_method_name))
    .map((m) => ({ _id: m._id, name: m.payment_method_name }));
}

function toRow(c) {
  const st = c.student;
  return {
    _id: c._id,
    student: st?._id ? { _id: st._id, name: `${st.firstName} ${st.lastName}`, admissionNumber: st.admissionNumber, className: st.classId?.cl_name ?? '' } : null,
    students: (c.students ?? []).filter((s) => s?._id).map((s) => ({ _id: s._id, name: `${s.firstName} ${s.lastName}` })),
    pay_through: c.pay_through ?? null,
    parent: c.guardian?._id ? { _id: c.guardian._id, name: c.guardian.name, phone: c.guardian.phone } : null,
    amount: c.amount,
    method: c.method,
    reference: c.reference,
    paidOn: c.paidOn,
    payerPhone: c.payerPhone ?? '',
    note: c.note ?? '',
    status: c.status,
    receipt: c.receipt?._id ? { _id: c.receipt._id, receipt_no: c.receipt.receipt_no } : null,
    reviewedBy: c.reviewedBy ?? '',
    reviewedAt: c.reviewedAt ?? null,
    rejectReason: c.rejectReason ?? '',
    createdAt: c.createdAt,
  };
}

const withRefs = (q) => q
  .populate({ path: 'student', select: 'firstName lastName admissionNumber classId', populate: { path: 'classId', model: Class, select: 'cl_name' } })
  .populate({ path: 'students', select: 'firstName lastName' })
  .populate({ path: 'guardian', model: Guardian, select: 'name phone' })
  .populate({ path: 'receipt', select: 'receipt_no' });

/**
 * A parent records a payment they made for one of their children, or for
 * several (`children`), optionally paying ahead up to `input.pay_through`.
 */
export async function submitClaim({ guardian, child, children = null, userId }, input) {
  const kids = children?.length ? children : [child];
  const payThrough = input.pay_through ? String(input.pay_through) : null;
  if (payThrough && (!PERIOD_RE.test(payThrough) || payThrough < currentPeriod())) throw fail(400, 'Choose this month or a later one to pay up to.');
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw fail(400, 'Enter the amount you paid.');
  const reference = String(input.reference ?? '').trim();
  if (reference.length < 3) throw fail(400, 'Enter the transaction reference from your payment message.');
  const method = await PaymentMethod.findById(input.method).lean();
  if (!method || /cash/i.test(method.payment_method_name)) throw fail(400, 'Choose how you paid.');
  const paidOn = input.paidOn ? new Date(input.paidOn) : new Date();
  if (Number.isNaN(paidOn.getTime()) || paidOn > new Date(Date.now() + 86400000)) throw fail(400, 'Pick the day you paid.');

  const dup = await PaymentClaim.exists({ reference: new RegExp(`^${reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), status: { $ne: 'rejected' } });
  if (dup) throw fail(409, 'A payment with this reference has already been sent to the school.');

  const claim = await PaymentClaim.create({
    student: kids[0]._id,
    students: kids.map((k) => k._id),
    pay_through: payThrough,
    guardian: guardian._id,
    submittedBy: userId,
    amount,
    method: method.payment_method_name,
    reference,
    paidOn,
    payerPhone: input.payerPhone?.trim() || guardian.phone,
    note: input.note?.trim() || undefined,
  });
  return toRow(await withRefs(PaymentClaim.findById(claim._id)));
}

/** A child's payments as their parent sees them, newest first. */
export async function claimsForChild(studentId) {
  return (await withRefs(PaymentClaim.find({ $or: [{ student: studentId }, { students: studentId }] }).sort({ createdAt: -1 }).limit(50))).map(toRow);
}

/** For the finance office: pending first, then the most recent decisions. */
export async function listClaims({ status } = {}) {
  const filter = status && ['pending', 'confirmed', 'rejected'].includes(status) ? { status } : {};
  const rows = await withRefs(PaymentClaim.find(filter).sort({ createdAt: -1 }).limit(200));
  return rows.map(toRow);
}

export async function countPending() {
  return PaymentClaim.countDocuments({ status: 'pending' });
}

/**
 * The money arrived: record it like a counter payment. `amount` and
 * `pay_through` let the accountant correct the figure or put extra towards
 * coming months.
 */
export async function confirmClaim(id, { amount, pay_through, payment_method } = {}, user) {
  const claim = await PaymentClaim.findById(id);
  if (!claim) throw fail(404, 'Payment not found');
  if (claim.status !== 'pending') throw fail(409, `This payment was already ${claim.status}.`);
  const methodId = payment_method
    ?? (await PaymentMethod.findOne({ payment_method_name: claim.method }).select('_id').lean())?._id;
  if (!methodId) throw fail(400, 'Choose the payment method the money came in through.');
  const [student, guardian] = await Promise.all([
    Student.findById(claim.student).select('firstName').lean(),
    Guardian.findById(claim.guardian).select('name phone').lean(),
  ]);
  if (!student) throw fail(404, 'The student on this payment no longer exists.');

  const receipt = await collectPayment({
    student_ids: (claim.students?.length ? claim.students : [claim.student]).map(String),
    amount: amount ?? claim.amount,
    pay_through: pay_through ?? claim.pay_through ?? undefined,
    payment_method: String(methodId),
    payer_name: guardian?.name,
    payer_phone: claim.payerPhone || guardian?.phone,
    reference: claim.reference,
    note: `Sent by the parent through the portal (${claim.method}, paid ${claim.paidOn.toISOString().slice(0, 10)})${claim.note ? `: ${claim.note}` : ''}`,
  }, user);

  claim.status = 'confirmed';
  claim.receipt = receipt._id;
  claim.reviewedBy = user?.name || user?.email || 'staff';
  claim.reviewedAt = new Date();
  if (amount !== undefined) claim.amount = round2(Number(amount));
  await claim.save();
  return { claim: toRow(await withRefs(PaymentClaim.findById(id))), receipt };
}

export async function rejectClaim(id, reason, user) {
  const claim = await PaymentClaim.findById(id);
  if (!claim) throw fail(404, 'Payment not found');
  if (claim.status !== 'pending') throw fail(409, `This payment was already ${claim.status}.`);
  const why = String(reason ?? '').trim();
  if (why.length < 3) throw fail(400, 'Say why, so the parent knows what to do.');
  claim.status = 'rejected';
  claim.rejectReason = why;
  claim.reviewedBy = user?.name || user?.email || 'staff';
  claim.reviewedAt = new Date();
  await claim.save();
  return toRow(await withRefs(PaymentClaim.findById(id)));
}

/**
 * What paying up to a month would cost, per child: what is owed now plus each
 * month not charged yet, at the child's fee after discounts. The parent can
 * still send a different amount; the office applies it oldest month first.
 */
export async function payQuote(children, through) {
  const from = currentPeriod();
  const upTo = through && PERIOD_RE.test(through) && through >= from ? through : from;
  const months = periodsBetween(from, upTo);
  const rows = await Promise.all(children.map(async (child) => {
    const [owedAgg, charged, fee] = await Promise.all([
      StudentInvoice.aggregate([{ $match: { student: child._id, status: { $ne: 'Paid' } } }, { $group: { _id: null, owed: { $sum: '$balance' } } }]),
      StudentInvoice.distinct('period', { student: child._id, period: { $in: months } }),
      FeeStructure.findOne({ class_id: child.classId, billing: 'monthly' }).lean(),
    ]);
    const monthly = fee ? (await computeStudentDiscount(child, fee.amount)).invoice_amount : 0;
    const ahead = months.filter((m) => !charged.includes(m));
    const owed = round2(owedAgg[0]?.owed ?? 0);
    return {
      _id: child._id,
      name: `${child.firstName} ${child.lastName}`,
      owed,
      monthly,
      monthsAhead: ahead,
      ahead: round2(monthly * ahead.length),
      total: round2(owed + monthly * ahead.length),
      hasFee: !!fee,
    };
  }));
  return { from, through: upTo, children: rows, total: round2(rows.reduce((n, r) => n + r.total, 0)) };
}
