import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { auditLogger } from '../middleware/auditLogger.js';
import {
  createRefund,
  getRefunds,
  getRefundById,
  getStudentPayments,
  reverseRefund
} from '../controllers/refundController.js';
import { createRefundSchema } from '../validators/refundValidator.js';

const router = express.Router();

// Refunds sit in the same access model as the rest of the finance department
// (see FINANCE_ROLES in src/reports/financeReports.js): accountant is the role
// that actually issues them day to day, so — unlike the sibling
// /student-fees routes, which are admin-only — accountant is authorized here
// too rather than being able to read every finance report but never act on one.
const FINANCE_STAFF = ['admin', 'accountant'];

router.post('/', authenticate, authorize(...FINANCE_STAFF), validate(createRefundSchema), auditLogger('Refund', 'CREATE'), createRefund);
router.get('/', authenticate, authorize(...FINANCE_STAFF, 'principal'), getRefunds);
// What a student has paid, and how much of each payment can still be refunded.
router.get('/student/:studentId/payments', authenticate, authorize(...FINANCE_STAFF), getStudentPayments);
router.get('/:id', authenticate, authorize(...FINANCE_STAFF, 'principal'), getRefundById);
router.post('/:id/reverse', authenticate, authorize(...FINANCE_STAFF), auditLogger('Refund', 'UPDATE'), reverseRefund);

export default router;
