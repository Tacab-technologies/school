import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema(
  {
    expenseNumber: { type: String, required: true, unique: true },
    expenseDate: { type: Date, default: Date.now, required: true },
    categoryAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
      required: true,
    },
    paymentAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
      required: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
    },
    // What it was for, in the accountant's words (Rent, Electricity, ...). The
    // category decides categoryAccountId; older records only have a title.
    category: { type: String, trim: true },
    paidTo: { type: String, trim: true },
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    // The method's name when it was recorded, and the method itself.
    paymentMethod: { type: String, trim: true, default: 'Cash' },
    payment_method_no: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentMethod',
    },
    referenceNo: { type: String, trim: true },
    status: {
      type: String,
      enum: ['Draft', 'Approved', 'Paid', 'Cancelled'],
      default: 'Paid',
    },
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

expenseSchema.index({ expenseDate: -1 });

export default mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
