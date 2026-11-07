import mongoose from 'mongoose';

// The monthly salary of one member of staff, keyed on their login so teachers
// and office staff work the same way. `history` keeps every earlier amount.
const staffSalarySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  amount: { type: Number, required: true, min: 0 },
  history: [{
    _id: false,
    amount: { type: Number, required: true },
    changed_by: { type: String },
    changed_at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

const StaffSalary = mongoose.model('StaffSalary', staffSalarySchema);
export default StaffSalary;
