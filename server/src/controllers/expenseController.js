import Supplier from '../models/Supplier.js';
import * as Expenses from '../services/expenseService.js';

// ─── SUPPLIER CONTROLLERS ──────────────────────────────────────────────────
export const getSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.find({ status: 'Active' }).sort({ supplierName: 1 });
    res.json({ success: true, data: suppliers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.create(req.body);
    res.status(201).json({ success: true, data: supplier });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    res.json({ success: true, data: supplier });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, { status: 'Inactive' }, { new: true });
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    res.json({ success: true, message: 'Supplier deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── EXPENSE CONTROLLERS ───────────────────────────────────────────────────
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

export const getExpenses = handle((req) => Expenses.listExpenses(req.query));

export const createExpense = handle((req) => Expenses.createExpense(req.body, req.user));

export const updateExpense = handle((req) => Expenses.updateExpense(req.params.id, req.body));

export const deleteExpense = handle((req) => Expenses.deleteExpense(req.params.id));
