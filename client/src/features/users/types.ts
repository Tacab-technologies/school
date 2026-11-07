// A built-in role key or a custom role made on the Roles page.
export type UserRole = string;

export interface AppUser {
  _id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  role: UserRole;
  status: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface UserListResult {
  total: number;
  page: number;
  limit: number;
  users: AppUser[];
}

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  password?: string;
}

export interface CreateUserResult {
  user: AppUser;
  temporaryPassword: string;
}

export interface BulkUserInput {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  /** The optional fifth column: a phone (teacher, parent) or an admission number (student). */
  extra?: string;
}

/** One created login, with the password it was given (shown once). */
export interface BulkCreatedUser {
  row: number;
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  /** The profile that goes with the login, e.g. "Linked to registered parent Hodan Ali". */
  detail?: string;
  temporaryPassword: string;
}

export interface BulkCreateResult {
  count: number;
  users: BulkCreatedUser[];
}

/** Returned with a 400 when any row is wrong; nothing was created. */
export interface BulkRowProblem {
  row: number;
  email: string;
  problems: string[];
}
