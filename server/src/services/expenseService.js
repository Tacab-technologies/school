import mongoose from 'mongoose';
import Expense from '../models/Expense.js';
import PaymentMethod from '../models/PaymentMethod.js';
import SequenceCounter from '../models/SequenceCounter.js';
import { moneyAccountCode, postJournalEntry, resolveAccountsByCode, reverseJournalEntry } from './journalService.js';
import { PERIOD_RE } from './monthlyFeeService.js';
import { abortTransaction, commitTransaction, startTransaction } from '../utils/transaction.js';
import { dayToDate, round2, schoolMonthRange } from '../utils/schoolMonth.js';
import { schoolToday } from '../utils/schoolTime.js';

/*
 * Money the school spent. Each expense posts a journal (debit the category's
 * expense account, credit Cash or Bank). Changing the money on one reverses
 * that journal and posts a new one; deleting cancels it and reverses it, so the
 * ledger keeps the full story.
 */

export const SUGGESTED_CATEGORIES = ['Rent', 'Electricity', 'Stationery', 'Maintenance', 'Other'];

// Typed categories that don't match one of these land in General Expenses.
const ACCOUNT_FOR_CATEGORY = { rent: '5600', electricity: '5300', water: '5300', stationery: '5400', supplies: '5400', maintenance: '5700', repairs: '5700' };
const GENERAL_EXPENSES = '5500';

const fail = (statusCode, message) => ({ statusCode, message });

const generateExpenseNumber = async (session) => {
  const year = new Date().getFullYear();
  const counter = await SequenceCounter.findOneAndUpdate({ name: 'expense', year }, { $inc: { seq: 1 } }, { new: true, upsert: true, session });
  return `EXP-${year}-${String(counter.seq).padStart(4, '0')}`;
};

const checkDate = (date) => {
  if (date > schoolToday()) throw fail(400, "The date can't be in the future.");
};

const toRow = (e) => ({
  _id: e._id,
  expenseNumber: e.expenseNumber,
  date: e.expenseDate,
  category: e.category ?? e.title ?? 'Other',
  amount: e.amount,
  paidTo: e.paidTo ?? '',
  paymentMethod: e.paymentMethod ?? '',
  paymentMethodId: e.payment_method_no ?? null,
  note: e.description ?? '',
  receiptNo: e.referenceNo ?? '',
});

/** Sets the ledger side of an expense: accounts, and a journal for its amount. */
const postExpense = async (expense, session, { corrected = false } = {}) => {
  const code = ACCOUNT_FOR_CATEGORY[expense.category.trim().toLowerCase()] ?? GENERAL_EXPENSES;
  const money = moneyAccountCode(expense.paymentMethod);
  const accounts = await resolveAccountsByCode([code, money], session);
  expense.categoryAccountId = accounts.get(code)._id;
  expense.paymentAccountId = accounts.get(money)._id;

  const label = `${expense.category}${expense.paidTo ? ` - ${expense.paidTo}` : ''}`;
  const journal = await postJournalEntry({
    date: expense.expenseDate,
    referenceType: 'Expense',
    referenceId: expense._id,
    // Numbers are unique: a clash would abort the surrounding transaction.
    journalNumber: `JRN-${expense.expenseNumber}${corrected ? `-ADJ-${Date.now()}` : ''}`,
    description: `Expense: ${label}`,
    lines: [
      { accountCode: code, debit: expense.amount, credit: 0, description: `Expense: ${label}` },
      { accountCode: money, debit: 0, credit: expense.amount, description: `Paid: ${label}` },
    ],
    session,
    accounts,
  });
  expense.journalEntryId = journal._id;
};

const inTransaction = async (work) => {
  const session = await mongoose.startSession();
  await startTransaction(session);
  try {
    const result = await work(session);
    await commitTransaction(session);
    return result;
  } catch (err) {
    await abortTransaction(session);
    throw err;
  } finally {
    session.endSession();
  }
};

const methodName = async (id) => {
  const method = await PaymentMethod.findById(id).select('payment_method_name');
  if (!method) throw fail(400, 'Choose how it was paid.');
  return method.payment_method_name;
};

export const listExpenses = async ({ period, category } = {}) => {
  if (period && !PERIOD_RE.test(period)) throw fail(400, 'Month must look like 2026-07.');
  const scope = { status: { $ne: 'Cancelled' }, ...(period ? { expenseDate: schoolMonthRange(period) } : {}) };
  const [expenses, byCategory, used] = await Promise.all([
    Expense.find({ ...scope, ...(category ? { category } : {}) }).sort({ expenseDate: -1, createdAt: -1 }),
    Expense.aggregate([
      { $match: scope },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.distinct('category', { status: { $ne: 'Cancelled' } }),
  ]);
  return {
    rows: expenses.map(toRow),
    total: round2(expenses.reduce((s, e) => s + e.amount, 0)),
    byCategory: byCategory.map((c) => ({ category: c._id ?? 'Other', total: round2(c.total), count: c.count })),
    categories: [...new Set([...SUGGESTED_CATEGORIES, ...used.filter(Boolean)])],
  };
};

export const createExpense = async (input, user) => {
  checkDate(input.date);
  const paymentMethod = await methodName(input.payment_method);
  return inTransaction(async (session) => {
    const expense = new Expense({
      expenseNumber: await generateExpenseNumber(session),
      expenseDate: dayToDate(input.date),
      category: input.category,
      amount: round2(input.amount),
      paidTo: input.paid_to,
      payment_method_no: input.payment_method,
      paymentMethod,
      description: input.note,
      referenceNo: input.receipt_no,
      recordedBy: user?._id,
    });
    await postExpense(expense, session);
    await expense.save({ session });
    return toRow(expense);
  });
};

export const updateExpense = async (id, input) => {
  if (input.date) checkDate(input.date);
  const paymentMethod = input.payment_method ? await methodName(input.payment_method) : undefined;
  return inTransaction(async (session) => {
    const expense = await Expense.findOne({ _id: id, status: { $ne: 'Cancelled' } }).session(session);
    if (!expense) throw fail(404, 'Expense not found.');

    const before = [expense.amount, expense.category, expense.paymentMethod, expense.expenseDate.getTime()].join('|');
    if (input.date) expense.expenseDate = dayToDate(input.date);
    if (input.category) expense.category = input.category;
    if (input.amount !== undefined) expense.amount = round2(input.amount);
    if (paymentMethod) {
      expense.payment_method_no = input.payment_method;
      expense.paymentMethod = paymentMethod;
    }
    if (input.paid_to !== undefined) expense.paidTo = input.paid_to;
    if (input.note !== undefined) expense.description = input.note;
    if (input.receipt_no !== undefined) expense.referenceNo = input.receipt_no;

    const after = [expense.amount, expense.category, expense.paymentMethod, expense.expenseDate.getTime()].join('|');
    if (before !== after) {
      await reverseJournalEntry(expense.journalEntryId, { date: expense.expenseDate, description: `Expense ${expense.expenseNumber} changed`, session });
      await postExpense(expense, session, { corrected: true });
    }
    await expense.save({ session });
    return toRow(expense);
  });
};

/** Cancels an expense and reverses its journal. The record stays for the audit trail. */
export const deleteExpense = async (id) => inTransaction(async (session) => {
  // Claiming the status first means a double click can't reverse it twice.
  const expense = await Expense.findOneAndUpdate(
    { _id: id, status: { $ne: 'Cancelled' } },
    { $set: { status: 'Cancelled' } },
    { new: true, session }
  );
  if (!expense) throw fail(404, 'Expense not found.');
  await reverseJournalEntry(expense.journalEntryId, { date: expense.expenseDate, description: `Expense ${expense.expenseNumber} deleted`, session });
  return toRow(expense);
});
