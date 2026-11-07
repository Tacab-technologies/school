import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId');

export const createTeachingLogSchema = z.object({
  assignmentId: objectIdSchema,
  periodId: objectIdSchema,
  date: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }),
  subject: z.string().min(1, 'Subject is required'),
  classId: z.string().min(1, 'Class is required'),
  section: z.string().min(1, 'Section is required'),
  period: z.string().min(1, 'Period is required'),

  topicTaught: z.string().trim().min(1, 'Lesson title is required'),
  lessonObjective: z.string().optional().nullable(),
  teachingSummary: z.string().optional().nullable(),
  learningOutcomes: z.string().optional().nullable(),

  studentParticipation: z.string().optional().nullable(),
  challengesFaced: z.string().optional().nullable(),
  extraNotes: z.string().optional().nullable(),

  homeworkGiven: z.string().optional().nullable(),
  submissionDeadline: z.string().optional().nullable()
    .refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid submission deadline format' }),

  status: z.enum(['draft', 'completed']).optional()
});

export const updateTeachingLogSchema = createTeachingLogSchema.partial();
