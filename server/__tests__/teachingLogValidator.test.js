import { createTeachingLogSchema, updateTeachingLogSchema } from '../src/validators/teachingLogValidator.js';

// The teacher only types a lesson title (required) and an optional objective;
// everything else on the payload is picked from their timetable.
const session = {
  assignmentId: '0123456789abcdef01234567',
  periodId: '0123456789abcdef01234568',
  date: '2026-08-17',
  subject: 'Physics',
  classId: 'Grade 11',
  section: 'A',
  period: 'First Period (08:00 - 09:00)',
};

describe('teaching log validator', () => {
  it('accepts a lesson title with no other content fields', () => {
    expect(createTeachingLogSchema.safeParse({ ...session, topicTaught: 'Motion' }).success).toBe(true);
  });

  it('accepts empty or null optional fields', () => {
    const result = createTeachingLogSchema.safeParse({
      ...session,
      topicTaught: 'Motion',
      lessonObjective: '',
      teachingSummary: null,
      learningOutcomes: '',
      status: 'completed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing or blank lesson title', () => {
    expect(createTeachingLogSchema.safeParse(session).success).toBe(false);
    const blank = createTeachingLogSchema.safeParse({ ...session, topicTaught: '  ' });
    expect(blank.success).toBe(false);
    expect(blank.error.errors[0].message).toBe('Lesson title is required');
  });

  it('lets an update change only the status', () => {
    expect(updateTeachingLogSchema.safeParse({ status: 'completed' }).success).toBe(true);
    expect(updateTeachingLogSchema.safeParse({ topicTaught: '' }).success).toBe(false);
  });
});
