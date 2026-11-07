import mongoose from 'mongoose';

export const HOLD_REASONS = ['Fees not paid', 'Discipline', 'Other'];

// The office hid one student's results for one exam, from the student and
// their parents, before or after publishing. Staff still see the marks.
// Deleting the record shows the results again.
const resultHoldSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  reason: { type: String, enum: HOLD_REASONS, default: 'Other' },
  note: { type: String, trim: true, maxlength: 200, default: '' },
  heldBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

resultHoldSchema.index({ examId: 1, studentId: 1 }, { unique: true });
resultHoldSchema.index({ studentId: 1 });

const ResultHold = mongoose.model('ResultHold', resultHoldSchema);
export default ResultHold;
