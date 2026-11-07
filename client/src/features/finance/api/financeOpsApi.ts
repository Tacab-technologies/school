import api from '../../../lib/axios';
import type {
  Expense, ExpenseInput, ExpenseList, FinanceOverview, PaySalariesInput, PaySalariesResult, Payroll, RefundablePayment,
} from '../opsTypes';

// The overview, salaries, expenses and refunds. Listing, issuing and reversing
// refunds themselves live in financeApi.
export const financeOpsApi = {
  /** Leave the month out for all months. */
  getOverview: async (period?: string): Promise<FinanceOverview> =>
    (await api.get('/fees/overview', { params: period ? { period } : {} })).data.data,

  getPayroll: async (period: string): Promise<Payroll> =>
    (await api.get('/fees/payroll', { params: { period } })).data.data,
  setSalary: async (userId: string, amount: number) =>
    (await api.put(`/fees/payroll/salaries/${userId}`, { amount })).data.data,
  paySalaries: async (data: PaySalariesInput): Promise<PaySalariesResult> =>
    (await api.post('/fees/payroll/pay', data)).data.data,

  listExpenses: async (params: { period?: string; category?: string }): Promise<ExpenseList> =>
    (await api.get('/expenses', { params })).data.data,
  createExpense: async (data: ExpenseInput): Promise<Expense> => (await api.post('/expenses', data)).data.data,
  updateExpense: async (id: string, data: ExpenseInput): Promise<Expense> => (await api.put(`/expenses/${id}`, data)).data.data,
  deleteExpense: async (id: string) => (await api.delete(`/expenses/${id}`)).data.data,

  getRefundablePayments: async (studentId: string): Promise<RefundablePayment[]> =>
    (await api.get(`/refunds/student/${studentId}/payments`)).data.data,
};
