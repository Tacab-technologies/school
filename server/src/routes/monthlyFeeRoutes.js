import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { auditLogger } from '../middleware/auditLogger.js';
import AppError from '../utils/AppError.js';
import {
  getClassFees, setClassFee, chargeMonth, listStudentBalances, searchStudents, getAccount, setStudentDiscount,
  collectPayment, listReceipts, getReceipt, getClassStatus, getReport,
  listScholarships, grantScholarship, updateScholarship, endScholarship,
  listPaymentClaims, confirmPaymentClaim, rejectPaymentClaim,
  getOverview, getPayroll, setSalary, paySalaries,
} from '../controllers/monthlyFeeController.js';
import {
  setClassFeeSchema, chargeMonthSchema, studentDiscountSchema, collectPaymentSchema, scholarshipSchema, scholarshipUpdateSchema,
  confirmClaimSchema, rejectClaimSchema,
} from '../validators/monthlyFeeValidator.js';
import { paySalariesSchema, setSalarySchema } from '../validators/financeOpsValidator.js';

const router = express.Router();

// Collecting fees is front-office work for admins and accountants; the
// principal can see where things stand but not take money.
const canCollect = authorize('admin', 'accountant');
const canView = authorize('admin', 'accountant', 'principal');
// What people earn is private: admins and accountants only, and unlike the
// rest of this module a custom role can't be given it on the Roles page.
const canSeeSalaries = (req, _res, next) => (
  ['admin', 'accountant'].includes(req.user?.role) ? next() : next(new AppError('Not authorized to access this route', 403))
);

router.use(authenticate);

// GET  /api/fees/overview?period=YYYY-MM - per-class figures and money in/out; no month = all months
router.get('/overview', canCollect, getOverview);

// GET  /api/fees/class-fees              - every class with its monthly fee
router.get('/class-fees', canView, getClassFees);
// PUT  /api/fees/class-fees/:classId     - set a class's monthly fee
router.put('/class-fees/:classId', authorize('admin'), validate(setClassFeeSchema), auditLogger('ClassFee', 'UPDATE'), setClassFee);

// POST /api/fees/charge                  - charge a month (all classes or one); safe to repeat
router.post('/charge', canCollect, validate(chargeMonthSchema), chargeMonth);

// GET  /api/fees/students?class_id=&status=owing|paid&q=&page=  - students with what they owe
router.get('/students', canCollect, listStudentBalances);
// GET  /api/fees/students/search?q=      - find a student by name, admission no. or parent
router.get('/students/search', canCollect, searchStudents);
// GET  /api/fees/students/:id/account    - what the student and siblings owe
router.get('/students/:studentId/account', canCollect, getAccount);
// PUT  /api/fees/students/:id/discount   - standing discount on future monthly charges
router.put('/students/:studentId/discount', authorize('admin'), validate(studentDiscountSchema), auditLogger('Student', 'UPDATE'), setStudentDiscount);

// Scholarships: a type (orphan, staff child, ...) and a % off the monthly fee for a date range.
// GET  /api/fees/scholarships?state=current
router.get('/scholarships', canView, listScholarships);
// POST /api/fees/students/:id/scholarship  - give a student a scholarship
router.post('/students/:studentId/scholarship', authorize('admin'), validate(scholarshipSchema), auditLogger('StudentScholarship', 'CREATE'), grantScholarship);
// PUT  /api/fees/scholarships/:id          - change the type, %, dates or reason
router.put('/scholarships/:id', authorize('admin'), validate(scholarshipUpdateSchema), auditLogger('StudentScholarship', 'UPDATE'), updateScholarship);
// POST /api/fees/scholarships/:id/end      - stop it today (kept for the history)
router.post('/scholarships/:id/end', authorize('admin'), auditLogger('StudentScholarship', 'UPDATE'), endScholarship);

// POST /api/fees/collect                 - take one payment for one or more siblings
router.post('/collect', canCollect, validate(collectPaymentSchema), auditLogger('Payment', 'CREATE'), collectPayment);
// Payments parents sent from home (mobile money / bank), waiting to be checked.
// GET  /api/fees/payment-claims?status=pending
router.get('/payment-claims', canCollect, listPaymentClaims);
// POST /api/fees/payment-claims/:id/confirm  - the money arrived: record it and make the receipt
router.post('/payment-claims/:id/confirm', canCollect, validate(confirmClaimSchema), auditLogger('PaymentClaim', 'UPDATE'), confirmPaymentClaim);
// POST /api/fees/payment-claims/:id/reject   - it didn't arrive; the parent sees the reason
router.post('/payment-claims/:id/reject', canCollect, validate(rejectClaimSchema), auditLogger('PaymentClaim', 'UPDATE'), rejectPaymentClaim);

router.get('/receipts', canView, listReceipts);
router.get('/receipts/:id', canView, getReceipt);

// GET  /api/fees/classes/:classId/status?period=YYYY-MM  - who has paid this month
router.get('/classes/:classId/status', canView, getClassStatus);
// GET  /api/fees/report?from=&to=&level_id=&class_id=
router.get('/report', canView, getReport);

// GET  /api/fees/payroll?period=YYYY-MM  - everyone's pay for the month
router.get('/payroll', canSeeSalaries, getPayroll);
// PUT  /api/fees/payroll/salaries/:userId - set someone's monthly salary
router.put('/payroll/salaries/:userId', canSeeSalaries, validate(setSalarySchema), auditLogger('StaffSalary', 'UPDATE'), setSalary);
// POST /api/fees/payroll/pay             - pay one or many people for a month
router.post('/payroll/pay', canSeeSalaries, validate(paySalariesSchema), auditLogger('PayrollEntry', 'CREATE'), paySalaries);

export default router;
