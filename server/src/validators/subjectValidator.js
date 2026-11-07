import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Choose a class from the list.' });

// Blank text boxes arrive as "" — treat them as "not given".
const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v),
  z.string().max(60, 'Keep it under 60 characters.').optional()
);

const subjectFields = {
  sub_name: z.string({ required_error: 'Enter the subject name.', invalid_type_error: 'Enter the subject name.' })
    .trim()
    .min(1, 'Enter the subject name.')
    .max(100, 'Keep the subject name under 100 characters.'),
  // Left blank on create, the server numbers it (SUB-001, …).
  sub_no: optionalText,
  // Blank on update clears the display code.
  subjectCode: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().max(30, 'Keep the code under 30 characters.').optional().nullable()),
  // Classes that take the subject; empty or left out = every class.
  classIds: z.array(objectId, { invalid_type_error: 'Choose the classes from the list.' }).optional(),
  // Older clients send one class; read as classIds: [classId].
  classId: z.union([objectId, z.literal(''), z.null()]).optional(),
  status: z.enum(['active', 'inactive'], { errorMap: () => ({ message: 'Status must be active or inactive.' }) }).optional(),
};

export const createSubjectSchema = z.object(subjectFields);

export const updateSubjectSchema = z.object({
  ...subjectFields,
  sub_name: subjectFields.sub_name.optional(),
});

export const setClassSubjectsSchema = z.object({
  subjectIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Choose the subjects from the list.' }), {
    required_error: 'Tick the subjects this class takes.',
    invalid_type_error: 'Tick the subjects this class takes.',
  }),
});
