import { z } from 'zod';

// A built-in role or a custom role key; the controller checks it exists.
const roleKey = z.string({ required_error: 'role is required' }).trim().min(1, 'role is required').max(40);

export const updateUserRoleSchema = z.object({
  role: roleKey
});

export const updateUserStatusSchema = z.object({
  status: z.boolean({
    required_error: 'status is required',
    invalid_type_error: 'status must be a boolean (true = active, false = deactivated)'
  })
});

export const createUserSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().trim().email('Please enter a valid email address.'),
  role: roleKey,
  password: z.string().min(8, 'Password must be at least 8 characters').optional()
});


// Each row is checked in the controller, so every problem can be reported
// against its own row. Here: only the shape and the size limit.
export const BULK_USER_LIMIT = 200;
const bulkCell = z.union([z.string(), z.number()]).optional().nullable();

export const bulkCreateUsersSchema = z.object({
  users: z.array(z.object({
    firstName: bulkCell,
    lastName: bulkCell,
    email: bulkCell,
    role: bulkCell,
    // The optional fifth column: a phone (teacher, parent) or an admission number (student).
    extra: bulkCell
  }), { required_error: 'Add at least one user.', invalid_type_error: 'Add at least one user.' })
    .min(1, 'Add at least one user.')
    .max(BULK_USER_LIMIT, `You can add at most ${BULK_USER_LIMIT} users at a time. Split the list and add the rest after.`)
});
