import StudentScholarship from '../models/StudentScholarship.js';
import Student from '../models/Student.js';
import Class from '../models/Class.js';
import Scholarship from '../models/Scholarship.js';
import ScholarshipType from '../models/ScholarshipType.js';
import DiscountType from '../models/DiscountType.js';
import Status from '../models/Status.js';
import { repriceOpenInvoices } from './invoiceService.js';

/*
 * Scholarships, the simple way: a student gets a type (orphan, staff child, ...)
 * and a percentage off their monthly fee (100 = free) for a date range. Under
 * the hood this is the existing StudentScholarship record, which
 * invoiceService.computeStudentDiscount already applies to every bill.
 * The lookup rows (types, statuses, the scholarship %) are found or created by
 * name so nobody has to set them up first.
 */

export const SCHOLARSHIP_TYPES = ['Orphan', 'Staff child', 'Needy family', 'Merit', 'Other'];

const fail = (statusCode, message) => ({ statusCode, message });
const status = (name, no) => Status.findOneAndUpdate({ st_name: name }, { $setOnInsert: { st_no: no } }, { new: true, upsert: true });
const activeStatus = () => status('Active', 'S-ACTIVE');
const endedStatus = () => status('Ended', 'S-ENDED');

async function scholarshipFor(type, percent, reason) {
  const scholarshipType = await ScholarshipType.findOneAndUpdate(
    { scholarship_name: type },
    { $setOnInsert: { schola_type_no: `ST-${Date.now()}-${Math.round(Math.random() * 1e4)}` } },
    { new: true, upsert: true },
  );
  const discountType = await DiscountType.findOneAndUpdate(
    { discount_type_name: 'Percentage' },
    { $setOnInsert: { discount_type_id: 'DT-PERCENTAGE', description: 'A flat percentage taken off the invoice amount' } },
    { new: true, upsert: true },
  );
  return Scholarship.findOneAndUpdate(
    { scholar_type_no: scholarshipType._id, discount_type_id: discountType._id, discount_value: percent },
    { $setOnInsert: { scholarship_id: `SCH-${Date.now()}-${Math.round(Math.random() * 1e4)}`, description: reason, is_active: true } },
    { new: true, upsert: true },
  );
}

function checkInput({ type, percent, from, to }, partial = false) {
  if (!partial || type !== undefined) {
    if (!type || !String(type).trim()) throw fail(400, 'Choose who the scholarship is for.');
  }
  if (!partial || percent !== undefined) {
    const p = Number(percent);
    if (!Number.isFinite(p) || p <= 0 || p > 100) throw fail(400, 'The scholarship must be between 1% and 100% of the fee.');
  }
  if (from && to && new Date(to) < new Date(from)) throw fail(400, 'The end date must be after the start date.');
}

const populated = (q) => q
  .populate({ path: 'st_no', select: 'firstName lastName admissionNumber classId status' })
  .populate('status_no')
  .populate({ path: 'scholarship_id', populate: ['scholar_type_no'] });

function toRow(a, classNames = new Map()) {
  const now = new Date();
  const isActive = a.status_no?.st_name === 'Active' && a.startDate <= now && a.endDate >= now;
  const st = a.st_no;
  return {
    _id: a._id,
    student: st ? { _id: st._id, name: `${st.firstName} ${st.lastName}`, admissionNumber: st.admissionNumber, className: classNames.get(String(st.classId)) ?? '' } : null,
    type: a.scholarship_id?.scholar_type_no?.scholarship_name ?? 'Scholarship',
    percent: a.scholarship_id?.discount_value ?? 0,
    from: a.startDate,
    to: a.endDate,
    reason: a.remarks ?? '',
    state: a.status_no?.st_name === 'Active' ? (a.startDate > now ? 'upcoming' : isActive ? 'active' : 'expired') : 'ended',
  };
}

/** The student's current scholarship (or the one about to start), or null. */
export async function activeScholarshipFor(studentId) {
  const active = await Status.findOne({ st_name: 'Active' });
  if (!active) return null;
  const a = await populated(StudentScholarship.findOne({ st_no: studentId, status_no: active._id, scholarship_id: { $exists: true }, endDate: { $gte: new Date() } }));
  return a ? toRow(a) : null;
}

export async function listScholarships({ state } = {}) {
  const rows = await populated(StudentScholarship.find({ scholarship_id: { $exists: true } }).sort({ createdAt: -1 }));
  const classIds = [...new Set(rows.map((r) => r.st_no?.classId).filter(Boolean).map(String))];
  const classes = await Class.find({ _id: { $in: classIds } }).select('cl_name');
  const names = new Map(classes.map((c) => [String(c._id), c.cl_name]));
  const out = rows.filter((r) => r.st_no).map((r) => toRow(r, names));
  return state === 'current' ? out.filter((r) => r.state === 'active' || r.state === 'upcoming') : out;
}

export async function grantScholarship(studentId, input, userName) {
  checkInput(input);
  const student = await Student.exists({ _id: studentId, isDeleted: false });
  if (!student) throw fail(404, 'Student not found');
  const active = await activeStatus();
  const existing = await StudentScholarship.findOne({ st_no: studentId, status_no: active._id, endDate: { $gte: new Date() } });
  if (existing) throw fail(409, 'This student already has a scholarship. Change or end that one instead.');

  const from = input.from ? new Date(input.from) : new Date();
  const to = input.to ? new Date(input.to) : new Date(from.getFullYear() + 1, from.getMonth(), from.getDate());
  const scholarship = await scholarshipFor(String(input.type).trim(), Number(input.percent), input.reason);
  const created = await StudentScholarship.create({
    student_scholarship_id: `SSCH-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
    st_no: studentId,
    scholarship_id: scholarship._id,
    startDate: from,
    endDate: to,
    status_no: active._id,
    remarks: input.reason?.trim() || undefined,
    registerBy: userName,
  });
  await repriceOpenInvoices(studentId);
  return toRow(await populated(StudentScholarship.findById(created._id)));
}

export async function updateScholarship(id, input, userName) {
  checkInput(input, true);
  const a = await populated(StudentScholarship.findById(id));
  if (!a || !a.scholarship_id) throw fail(404, 'Scholarship not found');
  const type = input.type !== undefined ? String(input.type).trim() : a.scholarship_id.scholar_type_no?.scholarship_name;
  const percent = input.percent !== undefined ? Number(input.percent) : a.scholarship_id.discount_value;
  const scholarship = await scholarshipFor(type, percent, input.reason ?? a.remarks);
  a.scholarship_id = scholarship._id;
  if (input.from) a.startDate = new Date(input.from);
  if (input.to) a.endDate = new Date(input.to);
  if (a.endDate < a.startDate) throw fail(400, 'The end date must be after the start date.');
  if (input.reason !== undefined) a.remarks = input.reason.trim() || undefined;
  a.updateBy = userName;
  a.updateDate = new Date();
  await a.save();
  await repriceOpenInvoices(a.st_no._id ?? a.st_no);
  return toRow(await populated(StudentScholarship.findById(id)));
}

/** Stops a scholarship today; the record stays for the history. */
export async function endScholarship(id, userName) {
  const a = await StudentScholarship.findById(id);
  if (!a) throw fail(404, 'Scholarship not found');
  const ended = await endedStatus();
  a.status_no = ended._id;
  if (a.endDate > new Date()) a.endDate = new Date();
  a.updateBy = userName;
  a.updateDate = new Date();
  await a.save();
  await repriceOpenInvoices(a.st_no);
  return { _id: a._id, state: 'ended' };
}
