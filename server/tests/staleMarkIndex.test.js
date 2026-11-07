import mongoose from 'mongoose';
import Mark from '../src/models/Mark.js';
import { dropStaleIndexes } from '../src/seed/bootstrap.js';

// A school database made by the old marks model still had a unique index on
// student + subject + term + year. Today's marks don't have those fields, so
// every mark after the first was refused as "duplicate". Start-up removes it.
describe('Old marks index', () => {
  const id = () => new mongoose.Types.ObjectId();
  const mark = () => ({ examId: id(), studentId: id(), subjectId: id(), classId: id(), score: 9 });

  beforeAll(async () => {
    await Mark.deleteMany({});
    await Mark.collection.createIndex({ student: 1, subject: 1, term: 1, academicYear: 1 }, { unique: true });
  });

  afterAll(async () => {
    await Mark.deleteMany({});
    await Mark.syncIndexes();
  });

  it('refuses the second mark while the old index is there', async () => {
    await Mark.create(mark());
    await expect(Mark.create(mark())).rejects.toMatchObject({ code: 11000 });
  });

  it('saves every mark once start-up has removed it', async () => {
    await dropStaleIndexes();
    const names = (await Mark.collection.indexes()).map((i) => i.name);
    expect(names).not.toContain('student_1_subject_1_term_1_academicYear_1');
    await expect(Mark.create(mark())).resolves.toBeTruthy();
    await expect(Mark.create(mark())).resolves.toBeTruthy();
    // The real rule still holds: one mark per exam, student and subject.
    const m = mark();
    await Mark.create(m);
    await expect(Mark.create(m)).rejects.toMatchObject({ code: 11000 });
  });
});
