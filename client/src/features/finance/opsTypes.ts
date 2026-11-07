// The accountant's overview, salaries, expenses and refunds — mirrors
// server/src/services/{financeOverviewService,payrollService,expenseService,refundService}.js.

export interface OverviewClass {
  /** null for the catch-all row of students and bills without a class. */
  classId: string | null;
  name: string;
  students: number;
  billed: number;
  collected: number;
  owed: number;
  fullyPaid: number;
  owing: number;
  notCharged: number;
  rate: number;
}

export interface FinanceOverview {
  /** The month shown, or null for all months. */
  period: string | null;
  currentPeriod: string;
  classes: OverviewClass[];
  totals: Omit<OverviewClass, 'classId' | 'name'>;
  /** Cash received in the chosen month, or in this month when showing all months. */
  receivedInMonth: number;
  cash: {
    feesCollected: number;
    salaries: number;
    expenses: number;
    refunds: number;
    moneyOut: number;
    balance: number;
  };
}

export interface Payslip {
  _id: string;
  payslip_no: string;
  period: string;
  name: string;
  staffId: string;
  basic: number;
  allowance: number;
  deduction: number;
  net: number;
  amount: number;
  /** What was still to pay after this payment. */
  remaining: number;
  paid_on: string;
  method: string;
  paid_by: string;
  note: string;
}

export type PayStatus = 'Not paid' | 'Part paid' | 'Paid';

export interface PayrollRow {
  user: string;
  name: string;
  staffId: string;
  kind: 'teacher' | 'staff';
  role?: string;
  /** The monthly salary now, or null if none has been set. */
  salary: number | null;
  salaryHistory: { amount: number; changed_by?: string; changed_at: string }[];
  basic: number;
  allowance: number;
  deduction: number;
  net: number;
  paid: number;
  remaining: number;
  status: PayStatus;
  note: string;
  payslips: Payslip[];
}

export interface Payroll {
  period: string;
  rows: PayrollRow[];
  summary: { people: number; due: number; paid: number; remaining: number; fullyPaid: number };
}

export interface PaySalariesInput {
  period: string;
  payment_method: string;
  paid_on: string;
  items: { user: string; amount?: number; allowance?: number; deduction?: number; note?: string }[];
}

export interface PaySalariesResult {
  payslips: Payslip[];
  failed: { user: string; message: string }[];
}

export interface Expense {
  _id: string;
  expenseNumber: string;
  date: string;
  category: string;
  amount: number;
  paidTo: string;
  paymentMethod: string;
  paymentMethodId: string | null;
  note: string;
  receiptNo: string;
}

export interface ExpenseInput {
  date: string;
  category: string;
  amount: number;
  paid_to?: string;
  payment_method: string;
  note?: string;
  receipt_no?: string;
}

export interface ExpenseList {
  rows: Expense[];
  total: number;
  byCategory: { category: string; total: number; count: number }[];
  /** Suggested and already-used categories, for the form and the filter. */
  categories: string[];
}

/** One payment a student made, and how much of it can still be refunded. */
export interface RefundablePayment {
  _id: string;
  receipt_no: string;
  period: string | null;
  description: string;
  paidOn: string;
  paid: number;
  refunded: number;
  refundable: number;
  method: string;
  methodId: string | null;
}

/** Today on this computer, as a date picker value ("2026-11-04"). */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "4 Nov 2026" */
export const dayLabel = (date: string) =>
  new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
