import api from '../../../lib/axios';
import type { ClassResults, EditRequest, ExamInput, ExamItem, HoldStudent, Marksheet, MarkingOptions, MarkingProgress, ReportCardResponse, SheetState } from '../types';

export interface SheetKey { classId: string; sectionId?: string | null; subjectId: string }

export const examsApi = {
  list: async (params: { termId?: string } = {}): Promise<ExamItem[]> => (await api.get('/exams', { params })).data.data,
  create: async (data: ExamInput) => (await api.post('/exams', data)).data.data,
  update: async (id: string, data: ExamInput) => (await api.put(`/exams/${id}`, data)).data.data,
  remove: (id: string) => api.delete(`/exams/${id}`),
  publish: async (id: string, published: boolean) => (await api.patch(`/exams/${id}/publish`, { published })).data,

  options: async (id: string): Promise<MarkingOptions> => (await api.get(`/exams/${id}/options`)).data.data,
  progress: async (id: string): Promise<MarkingProgress> => (await api.get(`/exams/${id}/progress`)).data.data,
  /** A teacher's classes and sections in a term (active term by default); pairs is null for staff. */
  teaching: async (termId?: string): Promise<{ pairs: { classId: string; sectionId: string }[] | null }> =>
    (await api.get('/exams/teaching', { params: { termId: termId || undefined } })).data.data,
  marksheet: async (id: string, key: SheetKey): Promise<Marksheet> =>
    (await api.get(`/exams/${id}/marksheet`, { params: { ...key, sectionId: key.sectionId || undefined } })).data.data,
  saveMarks: async (id: string, key: SheetKey, marks: { studentId: string; score: number | null; absent: boolean; remark: string }[]) =>
    (await api.put(`/exams/${id}/marks`, { ...key, sectionId: key.sectionId || null, marks })).data,
  /** Final: every student needs a mark or Absent, and the sheet locks. */
  submitSheet: async (id: string, key: SheetKey): Promise<SheetState> =>
    (await api.post(`/exams/${id}/sheet/submit`, { ...key, sectionId: key.sectionId || null })).data.data,
  requestEdit: async (id: string, key: SheetKey, reason: string): Promise<SheetState> =>
    (await api.post(`/exams/${id}/sheet/request-edit`, { ...key, sectionId: key.sectionId || null, reason })).data.data,
  /** The office lets the teacher change this sheet, until they submit again. */
  reopenSheet: async (id: string, key: SheetKey): Promise<SheetState> =>
    (await api.post(`/exams/${id}/sheet/reopen`, { ...key, sectionId: key.sectionId || null })).data.data,
  holds: async (id: string): Promise<{ reasons: string[]; students: HoldStudent[] }> => (await api.get(`/exams/${id}/holds`)).data.data,
  setHolds: async (id: string, data: { studentIds: string[]; hidden: boolean; reason: string; note: string }) => (await api.put(`/exams/${id}/holds`, data)).data,
  editRequests: async (): Promise<EditRequest[]> => (await api.get('/exams/edit-requests')).data.data,
  decideEditRequest: async (sheetId: string, approve: boolean, note = '') =>
    (await api.patch(`/exams/edit-requests/${sheetId}`, { approve, note })).data,

  results: async (params: { termId: string; classId: string; sectionId?: string }): Promise<ClassResults> =>
    (await api.get('/exams/results', { params: { ...params, sectionId: params.sectionId || undefined } })).data.data,
  reportCard: async (studentId: string, termId?: string): Promise<ReportCardResponse> =>
    (await api.get(`/exams/report-card/${studentId}`, { params: { termId } })).data.data,

  // Portals: a student's own results, or a staff member viewing that portal.
  studentPortalResults: async (studentId?: string, termId?: string): Promise<ReportCardResponse> =>
    (await api.get(studentId ? `/portal/student/${studentId}/results` : '/portal/student/results', { params: { termId } })).data.data,
  parentPortalResults: async (studentId: string, guardianId?: string, termId?: string): Promise<ReportCardResponse> =>
    (await api.get(guardianId ? `/portal/parent/${guardianId}/children/${studentId}/results` : `/portal/parent/children/${studentId}/results`, { params: { termId } })).data.data,
};

export const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
