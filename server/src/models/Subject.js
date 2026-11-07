import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema({
  sub_no:      { type: String, required: true, unique: true },
  sub_name:    { type: String, required: true },
  subjectCode: { type: String, unique: true, sparse: true },
  // The classes that take this subject. Empty = taught in every class.
  // Read it through services/subjectService.js (classIdsOf / subjectTaughtIn /
  // subjectsForClass), which also understands the old single `classId`.
  classIds:    { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }], default: [] },
  // Deprecated: the one class a subject used to belong to. Kept so older
  // records still read correctly; cleared whenever the subject is saved
  // through the subject endpoints.
  classId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, { timestamps: true });

subjectSchema.index({ classIds: 1 });

const Subject = mongoose.model('Subject', subjectSchema);
export default Subject;
