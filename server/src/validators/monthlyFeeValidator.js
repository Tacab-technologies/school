import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid MongoDB ObjectId' });
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Month must look like 2026-07' });

export const setClassFeeSchema = z.object({
  amount: z.number().min(0, 'The monthly fee cannot be negative'),
});

export const chargeMonthSchema = z.object({
  period: periodSchema.optional(),
  class_id: objectIdSchema.optional(),
});

export const studentDiscountSchema = z.object({
  kind: z.enum(['percent', 'amount']),
  value: z.number().min(0),
  reason: z.string().trim().max(200).optional(),
});

export const collectPaymentSchema = z.object({
  student_ids: z.array(objectIdSchema).min(1, 'Pick at least one student'),
  amount: z.number().positive('Enter the amount received'),
  pay_through: periodSchema.optional(),
  invoice_ids: z.array(objectIdSchema).optional(),
  payment_method: objectIdSchema,
  payer_name: z.string().trim().max(120).optional(),
  payer_phone: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const dateSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Pick a valid date' });

export const scholarshipSchema = z.object({
  type: z.string().trim().min(1, 'Choose who the scholarship is for').max(60),
  percent: z.number().gt(0, 'The scholarship must be more than 0%').max(100, 'The scholarship cannot be over 100%'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  reason: z.string().trim().max(200).optional(),
});

export const scholarshipUpdateSchema = scholarshipSchema.partial();

export const confirmClaimSchema = z.object({
  amount: z.number().positive('Enter the amount received').optional(),
  pay_through: periodSchema.optional(),
  payment_method: objectIdSchema.optional(),
});

export const rejectClaimSchema = z.object({
  reason: z.string().trim().min(3, 'Say why, so the parent knows what to do').max(300),
});
