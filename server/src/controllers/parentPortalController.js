// Parent / guardian portal.
// The guardian is resolved from the authenticated user (Guardian.userId ===
// req.user._id). Every child-scoped endpoint verifies the requested student is
// actually linked to this guardian before returning anything, so a guardian
// cannot read another family's child by guessing an id (IDOR blocked).
import Guardian from '../models/Guardian.js';
import Student from '../models/Student.js';
import StudentAttendance from '../models/StudentAttendance.js';
import StudentInvoice from '../models/StudentInvoice.js';
// Imported so their schemas are registered for the .populate() calls below —
// otherwise the queries throw MissingSchemaError for these refs.
import '../models/Period.js';
import '../models/Subject.js';
import '../models/User.js';
import mongoose from 'mongoose';
import { buildReportCard } from '../services/resultService.js';
import { timetableFor } from './studentPortalController.js';
import * as Claims from '../services/paymentClaimService.js';
import AppError from '../utils/AppError.js';
import ApiResponse from '../utils/ApiResponse.js';

// Resolve the Guardian document linked to the logged-in user.
const getMyGuardian = async (userId) => {
  const guardian = await Guardian.findOne({ userId });
  if (!guardian) {
    throw new AppError('No guardian record is linked to this account', 404);
  }
  return guardian;
};

// Resolve which Guardian a request is for:
//  • admin/staff routes carry :guardianId in the path → look that guardian up
//  • parent self routes carry no id → resolve from the authenticated user
// The route layer (authorize(...)) guarantees only privileged roles reach a
// request carrying :guardianId. Child linkage is still verified per request, so
// this stays IDOR-safe for both.
const resolveGuardian = async (req) => {
  if (req.params.guardianId) {
    const guardian = await Guardian.findById(req.params.guardianId);
    if (!guardian) throw new AppError('Guardian not found', 404);
    return guardian;
  }
  return getMyGuardian(req.user._id);
};

// Return the student only if it is linked to this guardian, else 403.
const getLinkedChild = async (guardianId, studentId) => {
  const student = await Student.findOne({
    _id: studentId,
    isDeleted: false,
    'guardians.guardianId': guardianId
  });
  if (!student) {
    throw new AppError('You are not authorized to view this student', 403);
  }
  return student;
};

// GET /api/portal/parent/children
export const getMyChildren = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const children = await Student.find({
      isDeleted: false,
      'guardians.guardianId': guardian._id
    })
      .populate({ path: 'classId', populate: { path: 'lev_no' } })
      .populate('sectionId');
    res.status(200).json(new ApiResponse(200, children, 'Linked students retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/profile
export const getChildProfile = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    await getLinkedChild(guardian._id, req.params.studentId);
    const student = await Student.findById(req.params.studentId)
      .populate({ path: 'classId', populate: { path: 'lev_no' } })
      .populate('sectionId');
    res.status(200).json(new ApiResponse(200, student, 'Student profile retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/attendance
export const getChildAttendance = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const child = await getLinkedChild(guardian._id, req.params.studentId);

    const records = await StudentAttendance.find({ studentId: child._id })
      .populate('periodId', 'per_no per_name time_in time_out')
      .sort({ att_date: -1 });

    const summary = records.reduce((acc, rec) => {
      acc[rec.status] = (acc[rec.status] || 0) + 1;
      return acc;
    }, {});

    res.status(200).json(new ApiResponse(200, { total: records.length, summary, records }, 'Attendance retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/invoices
export const getChildInvoices = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const child = await getLinkedChild(guardian._id, req.params.studentId);
    const invoices = await StudentInvoice.find({ student: child._id })
      .populate('fee_struc_no')
      .sort({ registerDate: -1 });

    const totals = invoices.reduce((acc, inv) => {
      acc.invoiced += inv.invoice_amount;
      acc.paid += inv.paid_amount;
      acc.balance += inv.balance;
      return acc;
    }, { invoiced: 0, paid: 0, balance: 0 });

    res.status(200).json(new ApiResponse(200, { totals, invoices }, 'Invoices retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/results?termId=
// A child's report card; parents only see exams the school has published.
export const getChildResults = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const child = await getLinkedChild(guardian._id, req.params.studentId);
    const termId = mongoose.isValidObjectId(req.query.termId) ? req.query.termId : undefined;
    const publishedOnly = req.user?.role === 'parent';
    res.status(200).json(new ApiResponse(200, await buildReportCard(child._id, termId, { publishedOnly }), 'Results retrieved'));
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/timetable
export const getChildTimetable = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const child = await getLinkedChild(guardian._id, req.params.studentId);
    res.status(200).json(new ApiResponse(200, await timetableFor(child), 'Timetable retrieved'));
  } catch (error) {
    next(error);
  }
};

// Service errors are plain { statusCode, message } objects.
const claimError = (error, res, next) => (error?.statusCode && !(error instanceof Error)
  ? res.status(error.statusCode).json({ success: false, message: error.message })
  : next(error));

// GET /api/portal/parent/payment-methods — ways to pay from home (not cash)
export const getPaymentMethods = async (req, res, next) => {
  try {
    res.status(200).json(new ApiResponse(200, await Claims.homePaymentMethods(), 'Payment methods'));
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/children/:studentId/payments
export const getChildPayments = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const child = await getLinkedChild(guardian._id, req.params.studentId);
    res.status(200).json(new ApiResponse(200, await Claims.claimsForChild(child._id), 'Payments'));
  } catch (error) {
    next(error);
  }
};

// The family's children named in `ids` (all of them when empty); each must be linked to the guardian.
const linkedChildren = async (guardianId, ids) => {
  const list = (Array.isArray(ids) ? ids : String(ids ?? '').split(',')).map(String).filter(Boolean);
  const children = await Student.find({ isDeleted: false, 'guardians.guardianId': guardianId, ...(list.length && { _id: { $in: list } }) });
  if (list.length && children.length !== new Set(list).size) throw new AppError('You are not authorized to view this student', 403);
  return children;
};

// POST /api/portal/parent/children/:studentId/payments — tell the school about a payment
// Body may carry `students` (several children paid together) and `pay_through` (YYYY-MM).
export const submitChildPayment = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const child = await getLinkedChild(guardian._id, req.params.studentId);
    const others = req.body.students?.length ? await linkedChildren(guardian._id, req.body.students) : null;
    const children = others ? [child, ...others.filter((c) => String(c._id) !== String(child._id))] : null;
    const claim = await Claims.submitClaim({ guardian, child, children, userId: req.user._id }, req.body);
    res.status(201).json(new ApiResponse(201, claim, 'Payment sent to the school'));
  } catch (error) {
    claimError(error, res, next);
  }
};

// The newest term's result in a few words, for the family overview. Parents
// only see published exams, the same rule as the child's report card.
const latestResultOf = async (studentId, publishedOnly) => {
  const { card } = await buildReportCard(studentId, undefined, { publishedOnly });
  if (!card?.total) return null;
  const grade = card.total.grade;
  return {
    term: card.term,
    percent: card.total.percent ?? null,
    // { grade: 'B', label: 'Very good', passed: true }, or null when nothing is marked.
    grade: grade && typeof grade === 'object' ? grade : grade ? { grade, label: '', passed: null } : null,
    position: card.position ?? null,
    classSize: card.classSize ?? 0,
    subjects: card.subjects?.length ?? 0,
  };
};

// GET /api/portal/parent/family — every child at a glance: attendance, the last
// days missed, fees, the latest result and the family's totals, so a parent sees
// all their children on one page.
export const getFamilySummary = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const children = await Student.find({ isDeleted: false, 'guardians.guardianId': guardian._id })
      .populate('classId', 'cl_name').populate('sectionId', 'name').lean();
    const ids = children.map((c) => c._id);
    const publishedOnly = req.user?.role === 'parent';
    const [attendance, fees, absences, results] = await Promise.all([
      StudentAttendance.aggregate([{ $match: { studentId: { $in: ids } } }, { $group: { _id: { s: '$studentId', st: '$status' }, n: { $sum: 1 } } }]),
      StudentInvoice.aggregate([{ $match: { student: { $in: ids } } }, { $group: { _id: '$student', invoiced: { $sum: '$invoice_amount' }, paid: { $sum: '$paid_amount' }, balance: { $sum: '$balance' } } }]),
      Promise.all(ids.map((id) => StudentAttendance.find({ studentId: id, status: 'Absent' })
        .populate('periodId', 'per_name').sort({ att_date: -1 }).limit(3).lean())),
      Promise.all(ids.map((id) => latestResultOf(id, publishedOnly).catch(() => null))),
    ]);
    const feeOf = new Map(fees.map((f) => [String(f._id), f]));
    const rows = children.map((c, i) => {
      const mine = attendance.filter((a) => String(a._id.s) === String(c._id));
      const count = (st) => mine.find((a) => a._id.st === st)?.n ?? 0;
      const total = mine.reduce((n, a) => n + a.n, 0);
      const f = feeOf.get(String(c._id));
      return {
        _id: c._id,
        name: `${c.firstName} ${c.lastName}`,
        className: c.classId?.cl_name ?? null,
        sectionName: c.sectionId?.name ?? null,
        status: c.status,
        photoUrl: c.photoUrl ?? null,
        attendance: {
          total, absent: count('Absent'), late: count('Late'),
          rate: total ? Math.round(((count('Present') + count('Late')) / total) * 100) : null,
          recentAbsences: absences[i].map((a) => ({ date: a.att_date, lesson: a.periodId?.per_name ?? null })),
        },
        fees: { invoiced: f?.invoiced ?? 0, paid: f?.paid ?? 0, balance: f?.balance ?? 0 },
        latestResult: results[i],
      };
    });
    const totals = rows.reduce((t, r) => ({ invoiced: t.invoiced + r.fees.invoiced, paid: t.paid + r.fees.paid, balance: t.balance + r.fees.balance }), { invoiced: 0, paid: 0, balance: 0 });
    res.status(200).json(new ApiResponse(200, { children: rows, totals }, 'Family summary'));
  } catch (error) {
    next(error);
  }
};

// GET /api/portal/parent/pay-quote?students=a,b&through=YYYY-MM — what paying ahead would cost.
export const getPayQuote = async (req, res, next) => {
  try {
    const guardian = await resolveGuardian(req);
    const children = await linkedChildren(guardian._id, req.query.students);
    res.status(200).json(new ApiResponse(200, await Claims.payQuote(children, req.query.through), 'Payment quote'));
  } catch (error) {
    claimError(error, res, next);
  }
};
