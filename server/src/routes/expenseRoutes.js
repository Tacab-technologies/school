import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { auditLogger } from '../middleware/auditLogger.js';
import {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '../controllers/expenseController.js';
import { expenseSchema, expenseUpdateSchema } from '../validators/financeOpsValidator.js';

const router = express.Router();

// The school's spending is for the finance office; the principal may look.
const canRecord = authorize('admin', 'accountant');
const canView = authorize('admin', 'accountant', 'principal');

router.use(authenticate);

// GET    /api/expenses?period=YYYY-MM&category=  - the list, totals and categories
router.get('/', canView, getExpenses);
// POST   /api/expenses                           - record money spent (posts a journal)
router.post('/', canRecord, validate(expenseSchema), auditLogger('Expense', 'CREATE'), createExpense);

// Supplier routes
router.get('/suppliers', canView, getSuppliers);
router.post('/suppliers', authorize('admin'), createSupplier);
router.put('/suppliers/:id', authorize('admin'), updateSupplier);
router.delete('/suppliers/:id', authorize('admin'), deleteSupplier);

// After the supplier routes, so '/suppliers' is never read as an expense id.
// PUT    /api/expenses/:id                       - correct it (reverses and re-posts the journal)
router.put('/:id', canRecord, validate(expenseUpdateSchema), auditLogger('Expense', 'UPDATE'), updateExpense);
// DELETE /api/expenses/:id                       - cancel it (reverses the journal)
router.delete('/:id', canRecord, auditLogger('Expense', 'DELETE'), deleteExpense);

export default router;
