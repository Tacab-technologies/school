import api from '../../../lib/axios';
import type { UserListResult, CreateUserPayload, CreateUserResult, BulkUserInput, BulkCreateResult } from '../types';

export const usersApi = {
  getAll: async (params?: unknown): Promise<UserListResult> =>
    (await api.get('/users', { params })).data.data,
  create: async (data: CreateUserPayload): Promise<CreateUserResult> =>
    (await api.post('/users', data)).data.data,
  /** All or nothing: a 400 lists each row's problems (response.data.problems). */
  createMany: async (users: BulkUserInput[]): Promise<BulkCreateResult> =>
    (await api.post('/users/bulk', { users })).data.data,
  updateRole: (id: string, role: string) => api.patch(`/users/${id}/role`, { role }),
  updateStatus: (id: string, status: boolean) => api.patch(`/users/${id}/status`, { status }),
  resetPassword: async (id: string): Promise<{ email: string; temporaryPassword: string }> =>
    (await api.post(`/users/${id}/reset-password`)).data.data,
};
