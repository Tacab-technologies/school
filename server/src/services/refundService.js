import mongoose from 'mongoose';
import Refund from '../models/Refund.js';
import FeeReceipt from '../models/FeeReceipt.js';
import PaymentMethod from '../models/PaymentMethod.js';
import StudentFee from '../models/StudentFee.js';
import StudentInvoice from '../models/StudentInvoice.js';
import Counter from '../models/Counter.js';
import { moneyAccountCode, postJournalEntry, reverseJournalEntry } from './journalService.js';
import { abortTransaction, commitTransaction, startTransaction } from '../utils/transaction.js';
import { round2, schoolMonthRange } from '../utils/schoolMonth.js';

/** REF-<year>-<seq>, via the same atomic per-year Counter every other document number in this app uses. */
const generateRefundNumber = async () => {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { year },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `REF-${year}-${String(counter.seq).padStart(4, '0')}`;
};

const POPULATE = [
  { path: 'student', select: 'firstName lastName admissionNumber classId', populate: { path: 'classId', select: 'cl_name' } },
  { path: 'invoice_no', select: 'invoice_no invoice_amount paid_amount balance status' },
  { path: 'student_fee_no', select: 'student_fee_no paid_amount registerDate' },
  { path: 'payment_method_no', select: 'payment_method_name' },
  { path: 'authorisedBy', select: 'username firstName lastName' }
];

export class RefundError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Moves an invoice's paid_amount by `delta` and recomputes its balance and status. */
const applyInvoiceDelta = async (invoiceId, delta, session) => {
  const invoice = await StudentInvoice.findById(invoiceId).session(session);
  if (!invoice) return;
  invoice.paid_amount = round2(invoice.paid_amount + delta);
  invoice.balance = round2(invoice.invoice_amount - invoice.paid_amount);
  if (invoice.paid_amount >= invoice.invoice_amount) invoice.status = 'Paid';
  else if (invoice.paid_amount > 0) invoice.status = 'Partially_Paid';
  else invoice.status = 'Unpaid';
  await invoice.save({ session });
};

const refundedSoFar = async (feeIds, session = null) => {
  const rows = await Refund.aggregate([
    { $match: { student_fee_no: { $in: feeIds }, status: 'issued' } },
    { $group: { _id: '$student_fee_no', total: { $sum: '$amount' } } }
  ]).session(session);
  return new Map(rows.map((r) => [String(r._id), round2(r.total)]));
};

/**
 * Issue a refund against a specific payment (StudentFee record).
 *
 * The refundable amount is that payment's own amount minus whatever has
 * already been refunded from it — a payment can be partially refunded more
 * than once, but never refunded past what was actually paid. Reverses the
 * matching amount off the invoice's paid_amount/balance/status, the same
 * adjustment studentFeeController.deleteStudentFee makes for a removed
 * payment, so the invoice ledger stays consistent either way: that month is
 * owed again. The journal undoes the payment's: debit Accounts Receivable,
 * credit the Cash or Bank the money left from.
 */
export const issueRefund = async ({ student_fee_no, amount, reason, payment_method_no }, authorisedBy) => {
  const session = await mongoose.startSession();
  await startTransaction(session);
  try {
    const fee = await StudentFee.findById(student_fee_no).populate({
      path: 'invoice_no',
      select: 'student invoice_amount paid_amount balance status'
    }).session(session);
    if (!fee) throw new RefundError('Payment record not found', 404);

    const invoice = fee.invoice_no;
    if (!invoice) throw new RefundError('The invoice for this payment no longer exists', 404);

    const refunded = (await refundedSoFar([fee._id], session)).get(String(fee._id)) ?? 0;
    const refundable = round2(fee.paid_amount - refunded);
    const value = round2(amount);

    if (value > refundable) {
      throw new RefundError(
        `Refund amount (${value}) exceeds what remains refundable on this payment (${refundable})`
      );
    }

    // Unless told otherwise, the money goes back the way it came.
    const methodId = payment_method_no ?? fee.payment_method_no;
    const method = await PaymentMethod.findById(methodId).select('payment_method_name').session(session);
    if (!method) throw new RefundError('Choose how the refund was paid');

    const refund_no = await generateRefundNumber();
    const refund = new Refund({
      refund_no,
      student_fee_no: fee._id,
      invoice_no: invoice._id,
      student: invoice.student,
      amount: value,
      reason,
      payment_method_no: methodId,
      authorisedBy,
      refundDate: new Date()
    });

    // The invoice was paid down by this fee; a refund against it reverses that
    // same amount, mirroring deleteStudentFee's reversal.
    await applyInvoiceDelta(invoice._id, -value, session);

    const journal = await postJournalEntry({
      date: refund.refundDate,
      referenceType: 'Refund',
      referenceId: refund._id,
      journalNumber: `JRN-${refund_no}`,
      description: `Refund ${refund_no}: ${reason}`,
      lines: [
        { accountCode: '1200', debit: value, credit: 0, studentId: invoice.student },
        { accountCode: moneyAccountCode(method.payment_method_name), debit: 0, credit: value, studentId: invoice.student }
      ],
      session
    });
    refund.journalEntryId = journal._id;
    await refund.save({ session });

    await commitTransaction(session);
    return Refund.findById(refund._id).populate(POPULATE);
  } catch (err) {
    await abortTransaction(session);
    // Two refunds racing on one bill: the transaction stopped this one.
    if (err?.code === 112) throw new RefundError('Someone else just changed this payment. Refresh and check.', 409);
    throw err;
  } finally {
    session.endSession();
  }
};

/** Everything a student has paid, newest first, with what can still be refunded. */
export const listRefundablePayments = async (studentId) => {
  if (!mongoose.isValidObjectId(studentId)) throw new RefundError('Student not found', 404);
  const invoices = await StudentInvoice.find({ student: studentId })
    .select('period fee_struc_no')
    .populate({ path: 'fee_struc_no', select: 'fee_type_no', populate: { path: 'fee_type_no', select: 'fee_name' } });
  const invoiceOf = new Map(invoices.map((i) => [String(i._id), i]));

  const fees = await StudentFee.find({ invoice_no: { $in: invoices.map((i) => i._id) } })
    .populate('payment_method_no', 'payment_method_name')
    .sort({ registerDate: -1 });
  const feeIds = fees.map((f) => f._id);
  const [refunded, receipts] = await Promise.all([
    refundedSoFar(feeIds),
    FeeReceipt.find({ 'lines.student_fee': { $in: feeIds } }).select('receipt_no lines.student_fee'),
  ]);
  const receiptOf = new Map(receipts.flatMap((r) => r.lines.map((l) => [String(l.student_fee), r.receipt_no])));

  return fees.map((f) => {
    const invoice = invoiceOf.get(String(f.invoice_no));
    const done = refunded.get(String(f._id)) ?? 0;
    return {
      _id: f._id,
      receipt_no: receiptOf.get(String(f._id)) ?? f.student_fee_no,
      period: invoice?.period ?? null,
      description: invoice?.fee_struc_no?.fee_type_no?.fee_name ?? 'Fee',
      paidOn: f.registerDate,
      paid: f.paid_amount,
      refunded: done,
      refundable: round2(f.paid_amount - done),
      method: f.payment_method_no?.payment_method_name ?? '',
      methodId: f.payment_method_no?._id ?? null,
    };
  });
};

export const listRefunds = async (query = {}) => {
  const filter = {};
  if (query.student_id) filter.student = query.student_id;
  if (query.status) filter.status = query.status;
  if (query.period) {
    filter.refundDate = schoolMonthRange(query.period);
  } else if (query.from || query.to) {
    filter.refundDate = {};
    if (query.from) filter.refundDate.$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      to.setUTCHours(23, 59, 59, 999);
      filter.refundDate.$lte = to;
    }
  }
  return Refund.find(filter).populate(POPULATE).sort({ refundDate: -1 });
};

export const getRefundById = async (id) => Refund.findById(id).populate(POPULATE);

/**
 * Reverse a refund itself — a correction for a refund issued in error. Puts
 * the money back onto the invoice's paid_amount, the exact inverse of
 * issueRefund's adjustment, and reverses its journal. Refused if the reopened
 * bill has since been paid again: reversing would then overpay it.
 */
export const reverseRefund = async (id, updateBy) => {
  const session = await mongoose.startSession();
  await startTransaction(session);
  try {
    const existing = await Refund.findById(id).session(session);
    if (!existing) throw new RefundError('Refund not found', 404);
    if (existing.status === 'reversed') {
      throw new RefundError('This refund has already been reversed');
    }
    const invoice = await StudentInvoice.findById(existing.invoice_no).select('balance').session(session);
    if (invoice && invoice.balance < existing.amount) {
      throw new RefundError('This bill has been paid again since the refund, so the refund can no longer be reversed');
    }

    // Claiming the status first means a double click can't reverse it twice.
    const refund = await Refund.findOneAndUpdate(
      { _id: id, status: 'issued' },
      { $set: { status: 'reversed', updateBy, updateDate: new Date() } },
      { new: true, session }
    );
    if (!refund) throw new RefundError('This refund has already been reversed');

    await applyInvoiceDelta(refund.invoice_no, refund.amount, session);

    const journal = await reverseJournalEntry(refund.journalEntryId, {
      description: `Refund ${refund.refund_no} reversed`,
      session
    });
    if (journal) {
      refund.reversalJournalEntryId = journal._id;
      await refund.save({ session });
    }

    await commitTransaction(session);
    return Refund.findById(refund._id).populate(POPULATE);
  } catch (err) {
    await abortTransaction(session);
    throw err;
  } finally {
    session.endSession();
  }
};
