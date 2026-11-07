import mongoose from 'mongoose';

/** Two names that mean the same year get the same key: ' 2026-2027 ', '2026/2027', '2026 - 2027'. */
export const yearNameKey = (name) => String(name ?? '').trim().toLowerCase().replace(/[\s\-/–—_.]+/g, '-');

const yearSchema = new mongoose.Schema({
  y_no: { type: String, required: true, unique: true, trim: true },
  y_name: { type: String, required: true, trim: true },
  // yearNameKey(y_name), set by yearController. The unique index below stops two
  // requests adding the same year at once. Years saved before this field existed
  // have no key, so old duplicates can't stop the index building; the controller
  // compares against those by name.
  nameKey: { type: String, select: false }
}, { timestamps: true });

yearSchema.index({ nameKey: 1 }, { unique: true, partialFilterExpression: { nameKey: { $type: 'string' } } });

const Year = mongoose.model('Year', yearSchema);
export default Year;
// Student management module - Gabaxey
