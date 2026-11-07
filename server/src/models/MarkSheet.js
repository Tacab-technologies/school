import mongoose from 'mongoose';

// The state of one mark sheet: one exam, one class (and section), one subject.
// A teacher saves marks as a draft, and can keep changing them while the
// exam's entry dates are open. Submitting (every student needs a mark or
// Absent) locks the sheet: to change it, or to work after the entry dates,
// they need the academic office's permission (`unlocked`), which lasts until
// they submit again. Publishing the exam to students and parents stays a
// separate step for the office. No document yet means a sheet nobody saved.
const editRequestSchema = new mongoose.Schema({
  status: { type: String, enum: ['pending', 'approved', 'rejected'], required: true },
  reason: { type: String, trim: true, maxlength: 300, default: '' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  requestedAt: { type: Date, default: null },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
  note: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: false });

const markSheetSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  sectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  status: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  submittedAt: { type: Date, default: null },
  editRequest: { type: editRequestSchema, default: null },
  // The office allowed changes (cleared when the teacher submits again).
  unlocked: { type: Boolean, default: false },
}, { timestamps: true });

markSheetSchema.index({ examId: 1, classId: 1, sectionId: 1, subjectId: 1 }, { unique: true });
markSheetSchema.index({ 'editRequest.status': 1 });

const MarkSheet = mongoose.model('MarkSheet', markSheetSchema);
export default MarkSheet;
