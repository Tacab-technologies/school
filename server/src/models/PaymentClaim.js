import mongoose from 'mongoose';

/**
 * A fee payment a parent says they made (mobile money or bank), waiting for the
 * school to check it. Confirming it records the payment through the normal
 * counter flow, so the receipt, balances and ledger are exactly as if it had
 * been paid at the office.
 */
const paymentClaimSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  // A payment for several children of the family at once (student is the first).
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student', index: true }],
  // "YYYY-MM": the parent paid ahead up to and including this month.
  pay_through: { type: String, default: null },
  guardian: { type: mongoose.Schema.Types.ObjectId, ref: 'Guardian', required: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: { type: Number, required: true, min: 0.01 },
  method: { type: String, required: true, trim: true },
  reference: { type: String, required: true, trim: true },
  paidOn: { type: Date, required: true },
  payerPhone: { type: String, trim: true },
  note: { type: String, trim: true },
  status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending', index: true },
  receipt: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeReceipt' },
  reviewedBy: { type: String },
  reviewedAt: { type: Date },
  rejectReason: { type: String, trim: true },
}, { timestamps: true });

const PaymentClaim = mongoose.model('PaymentClaim', paymentClaimSchema);
export default PaymentClaim;
