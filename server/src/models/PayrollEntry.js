import mongoose from 'mongoose';

// One person's pay for one month. The amounts are fixed by the first payment;
// each payment made against them (the whole net, or parts of it) is one line
// with its own payslip and journal.
const payrollEntrySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  // Kept here so old payslips still read correctly if the login is removed.
  staff_name: { type: String, required: true },
  staff_id: { type: String },
  basic: { type: Number, required: true, min: 0 },
  allowance: { type: Number, default: 0, min: 0 },
  deduction: { type: Number, default: 0, min: 0 },
  net: { type: Number, required: true, min: 0 },
  paid: { type: Number, default: 0, min: 0 },
  note: { type: String, trim: true },
  payments: [{
    payslip_no: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paid_on: { type: Date, required: true },
    payment_method: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMethod', required: true },
    payment_method_name: { type: String },
    paid_by: { type: String },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  }],
}, { timestamps: true });

// One entry per person per month: this is what stops a month being paid twice.
payrollEntrySchema.index({ user: 1, period: 1 }, { unique: true });
payrollEntrySchema.index({ period: 1 });
payrollEntrySchema.index({ 'payments.paid_on': 1 });

const PayrollEntry = mongoose.model('PayrollEntry', payrollEntrySchema);
export default PayrollEntry;
