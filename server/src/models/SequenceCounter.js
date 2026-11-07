import mongoose from 'mongoose';

// A named running number per year, e.g. the school's admission numbers.
// (Invoices, receipts and refunds share the older Counter collection.)
const sequenceCounterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  year: { type: Number, required: true },
  seq: { type: Number, default: 0 },
});

sequenceCounterSchema.index({ name: 1, year: 1 }, { unique: true });

const SequenceCounter = mongoose.model('SequenceCounter', sequenceCounterSchema);
export default SequenceCounter;
