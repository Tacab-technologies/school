import * as MonthlyFees from '../services/monthlyFeeService.js';
import * as Scholarships from '../services/scholarshipGrantService.js';
import * as Claims from '../services/paymentClaimService.js';
import * as Payroll from '../services/payrollService.js';
import { getOverview as buildOverview } from '../services/financeOverviewService.js';

// Service errors are plain { statusCode, message } objects; anything else is
// unexpected and goes to the global error handler.
const handle = (fn) => async (req, res, next) => {
  try {
    const data = await fn(req);
    res.status(req.method === 'POST' ? 201 : 200).json({ success: true, data });
  } catch (err) {
    if (err && err.statusCode && !(err instanceof Error)) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    next(err);
  }
};

const userName = (req) => req.user?.name || req.user?.email || 'system';

export const getClassFees = handle(() => MonthlyFees.getClassFees());

export const setClassFee = handle((req) => MonthlyFees.setClassFee(req.params.classId, req.body.amount, userName(req)));

export const chargeMonth = handle((req) => MonthlyFees.chargeMonth({ period: req.body.period, classId: req.body.class_id }));

export const listStudentBalances = handle((req) => MonthlyFees.listStudentBalances(req.query));

export const searchStudents = handle((req) => MonthlyFees.searchStudents(req.query.q));

export const getAccount = handle((req) => MonthlyFees.getAccount(req.params.studentId));

export const setStudentDiscount = handle((req) => MonthlyFees.setStudentDiscount(req.params.studentId, req.body));

export const collectPayment = handle((req) => MonthlyFees.collectPayment(req.body, req.user));

export const listReceipts = handle((req) => MonthlyFees.listReceipts(req.query));

export const getReceipt = handle((req) => MonthlyFees.getReceipt(req.params.id));

export const getClassStatus = handle((req) => {
  const period = req.query.period || MonthlyFees.currentPeriod();
  if (!MonthlyFees.PERIOD_RE.test(period)) throw { statusCode: 400, message: 'Month must look like 2026-07.' };
  return MonthlyFees.getClassStatus(req.params.classId, period);
});

export const getReport = handle((req) => {
  const now = MonthlyFees.currentPeriod();
  const from = req.query.from || `${now.slice(0, 4)}-01`;
  const to = req.query.to || now;
  if (!MonthlyFees.PERIOD_RE.test(from) || !MonthlyFees.PERIOD_RE.test(to) || from > to) {
    throw { statusCode: 400, message: 'Choose a valid month range.' };
  }
  return MonthlyFees.getReport({ from, to, level_id: req.query.level_id, class_id: req.query.class_id });
});

export const listScholarships = handle((req) => Scholarships.listScholarships(req.query));

export const grantScholarship = handle((req) => Scholarships.grantScholarship(req.params.studentId, req.body, userName(req)));

export const updateScholarship = handle((req) => Scholarships.updateScholarship(req.params.id, req.body, userName(req)));

export const endScholarship = handle((req) => Scholarships.endScholarship(req.params.id, userName(req)));

export const listPaymentClaims = handle(async (req) => ({ claims: await Claims.listClaims(req.query), pending: await Claims.countPending() }));

export const confirmPaymentClaim = handle((req) => Claims.confirmClaim(req.params.id, req.body, req.user));

export const rejectPaymentClaim = handle((req) => Claims.rejectClaim(req.params.id, req.body.reason, req.user));

export const getOverview = handle((req) => buildOverview({ period: req.query.period || undefined }));

export const getPayroll = handle((req) => Payroll.getPayroll(req.query.period || undefined));

export const setSalary = handle((req) => Payroll.setSalary(req.params.userId, req.body.amount, userName(req)));

export const paySalaries = handle((req) => Payroll.paySalaries(req.body, req.user));
