import api from '../../../lib/axios';
import type { Student } from '../../students/types';
import type { PortalInvoicesResponse } from '../../student-portal/api/portalApi';
import type { PaymentClaim } from '../../finance/monthlyTypes';
import type { MyAttendanceResponse } from '../../student-portal/api/attendanceApi';

// guardianId is supplied when an admin views a specific parent's portal; omitted
// when a logged-in parent reads their own family's data. The child's studentId is
// always required. Child linkage is verified server-side either way.
const childrenBase = (guardianId?: string) =>
  guardianId ? `/portal/parent/${guardianId}/children` : '/portal/parent/children';
const childBase = (studentId: string, guardianId?: string) =>
  `${childrenBase(guardianId)}/${studentId}`;

export interface FamilyChild {
  _id: string;
  name: string;
  className: string | null;
  sectionName: string | null;
  status: string;
  photoUrl: string | null;
  attendance: { total: number; absent: number; late: number; rate: number | null; recentAbsences: { date: string; lesson: string | null }[] };
  fees: { invoiced: number; paid: number; balance: number };
  /** The newest term's result the parent may see (published only), or null. */
  latestResult: {
    term: { _id: string; name: string; year: string | null };
    percent: number | null;
    grade: { grade: string; label: string; passed: boolean | null } | null;
    position: number | null;
    classSize: number;
    subjects: number;
  } | null;
}
export interface FamilySummary { children: FamilyChild[]; totals: { invoiced: number; paid: number; balance: number } }
export interface PayQuote {
  from: string;
  through: string;
  children: { _id: string; name: string; owed: number; monthly: number; monthsAhead: string[]; ahead: number; total: number; hasFee: boolean }[];
  total: number;
}

export const parentPortalApi = {
  /** Every child at a glance, with the family's fee totals. */
  getFamily: async (guardianId?: string): Promise<FamilySummary> =>
    (await api.get(guardianId ? `/portal/parent/${guardianId}/family` : '/portal/parent/family')).data.data,
  /** What paying for these children up to a month would cost. */
  getPayQuote: async (students: string[], through: string): Promise<PayQuote> =>
    (await api.get('/portal/parent/pay-quote', { params: { students: students.join(','), through } })).data.data,

  getChildren: async (guardianId?: string): Promise<Student[]> =>
    (await api.get(childrenBase(guardianId))).data.data,

  getChildProfile: async (studentId: string, guardianId?: string): Promise<Student> =>
    (await api.get(`${childBase(studentId, guardianId)}/profile`)).data.data,

  getChildAttendance: async (studentId: string, guardianId?: string): Promise<MyAttendanceResponse> =>
    (await api.get(`${childBase(studentId, guardianId)}/attendance`)).data.data,

  getChildInvoices: async (studentId: string, guardianId?: string): Promise<PortalInvoicesResponse> =>
    (await api.get(`${childBase(studentId, guardianId)}/invoices`)).data.data,

  /** Ways to pay from home (mobile money, bank), as the school set them up. */
  getPaymentMethods: async (): Promise<{ _id: string; name: string }[]> =>
    (await api.get('/portal/parent/payment-methods')).data.data,

  getChildPayments: async (studentId: string, guardianId?: string): Promise<PaymentClaim[]> =>
    (await api.get(`${childBase(studentId, guardianId)}/payments`)).data.data,

  /** Tell the school about a payment made by mobile money or bank; the office confirms it. */
  sendPayment: async (studentId: string, data: { amount: number; method: string; reference: string; paidOn: string; payerPhone?: string; note?: string; students?: string[]; pay_through?: string }): Promise<PaymentClaim> =>
    (await api.post(`${childBase(studentId)}/payments`, data)).data.data,
};
