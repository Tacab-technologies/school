import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid MongoDB ObjectId' });
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Month must look like 2026-07' });
const daySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Pick a valid date' })
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Pick a valid date' });
const noteSchema = z.string().trim().max(500);

export const setSalarySchema = z.object({
  amount: z.number().min(0, 'The salary cannot be negative'),
});

export const paySalariesSchema = z.object({
  period: periodSchema,
  payment_method: objectIdSchema,
  paid_on: daySchema.optional(),
  items: z.array(z.object({
    user: objectIdSchema,
    amount: z.number().positive('Enter the amount to pay').optional(),
    allowance: z.number().min(0, 'The allowance cannot be negative').optional(),
    deduction: z.number().min(0, 'The deduction cannot be negative').optional(),
    note: noteSchema.optional(),
  })).min(1, 'Pick at least one person to pay'),
});

export const expenseSchema = z.object({
  date: daySchema,
  category: z.string().trim().min(1, 'Choose or type a category').max(60),
  amount: z.number().positive('Enter the amount spent'),
  paid_to: z.string().trim().max(120).optional(),
  payment_method: objectIdSchema,
  note: noteSchema.optional(),
  receipt_no: z.string().trim().max(60).optional(),
});

export const expenseUpdateSchema = expenseSchema.partial();
