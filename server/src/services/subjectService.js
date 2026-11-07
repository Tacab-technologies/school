import mongoose from 'mongoose';
import Subject from '../models/Subject.js';
import Class from '../models/Class.js';
import AppError from '../utils/AppError.js';

/*
 * Which classes take a subject.
 *
 * `Subject.classIds` lists the classes; an empty list means the subject is
 * taught in every class. Older records only have the single `classId` field:
 * a subject with `classId` set and no `classIds` is read as `classIds: [classId]`.
 * Nothing is migrated up front — any write through the subject endpoints saves
 * the explicit `classIds` and drops the old `classId`, so data moves over as
 * people edit it and nothing is lost in the meantime.
 */

const str = (id) => (id && typeof id === 'object' && id._id ? String(id._id) : String(id));

/** The classes a subject is taught in, as strings. Empty = every class. */
export const classIdsOf = (subject) => {
  if (!subject) return [];
  if (Array.isArray(subject.classIds) && subject.classIds.length) return subject.classIds.map(str);
  return subject.classId ? [str(subject.classId)] : [];
};

/** True when the subject is taught in that class (an "every class" subject always is). */
export const subjectTaughtIn = (subject, classId) => {
  const ids = classIdsOf(subject);
  return ids.length === 0 || ids.includes(str(classId));
};

/** Mongo filter for subjects taught in a class — works for both new and old records. */
export const taughtInClassFilter = (classId) => {
  const id = new mongoose.Types.ObjectId(String(classId));
  const noList = { 'classIds.0': { $exists: false } };
  return {
    $or: [
      { classIds: id },
      { ...noList, classId: id },
      { ...noList, classId: null },
    ],
  };
};

/** Subjects taught in a class (optionally only active ones), sorted by name, as lean docs. */
export const subjectsForClass = (classId, { activeOnly = false } = {}) =>
  Subject.find({ ...taughtInClassFilter(classId), ...(activeOnly ? { status: 'active' } : {}) })
    .sort({ sub_name: 1 })
    .lean();

/** A subject as the API sends it: always with `classIds`, never the old `classId`. */
export const shapeSubject = (subject) => {
  if (!subject) return subject;
  const plain = typeof subject.toObject === 'function' ? subject.toObject() : { ...subject };
  plain.classIds = classIdsOf(plain);
  delete plain.classId;
  return plain;
};

/** Throws a plain 400 unless every id is an existing class. Returns the unique ids. */
export const assertClassesExist = async (classIds) => {
  const unique = [...new Set(classIds.map(String))];
  if (!unique.length) return unique;
  const found = await Class.countDocuments({ _id: { $in: unique } });
  if (found !== unique.length) throw new AppError('One of the chosen classes no longer exists. Refresh the page and try again.', 400);
  return unique;
};

/** Next free automatic subject number: SUB-001, SUB-002, … */
export const nextSubjectNo = async () => {
  let n = (await Subject.countDocuments()) + 1;
  // Numbers can have gaps or have been typed by hand, so skip any already used.
  while (await Subject.exists({ sub_no: `SUB-${String(n).padStart(3, '0')}` })) n += 1;
  return `SUB-${String(n).padStart(3, '0')}`;
};

/**
 * Set exactly which subjects a class takes.
 *
 * - A ticked subject with an explicit list gets the class added.
 * - A ticked "every class" subject is left alone (it already covers the class).
 * - An unticked subject with an explicit list has the class removed.
 * - An unticked "every class" subject becomes an explicit list of every
 *   OTHER class, so the other classes keep taking it.
 * - Removing the only class a subject is taught in would leave an empty list,
 *   which means "every class" — the opposite of what was meant — so that is
 *   refused with a plain message (mark the subject inactive or delete it instead).
 *
 * Returns the subjects now taught in the class.
 */
export const setClassSubjects = async (classId, subjectIds) => {
  const cls = await Class.findById(classId).select('_id cl_name').lean();
  if (!cls) throw new AppError('Class not found', 404);

  const wanted = new Set(subjectIds.map(String));
  const subjects = await Subject.find().lean();
  const known = new Set(subjects.map((s) => String(s._id)));
  if ([...wanted].some((id) => !known.has(id))) {
    throw new AppError('One of the chosen subjects no longer exists. Refresh the page and try again.', 400);
  }

  const target = String(classId);
  const allClassIds = (await Class.find().select('_id').lean()).map((c) => String(c._id));
  const ops = [];
  const stranded = [];

  for (const subject of subjects) {
    const current = classIdsOf(subject);
    const everyClass = current.length === 0;
    const taught = everyClass || current.includes(target);
    const shouldTeach = wanted.has(String(subject._id));
    const legacy = subject.classId !== undefined && subject.classId !== null;

    let next = null;
    if (shouldTeach && !taught) next = [...current, target];
    else if (!shouldTeach && taught) {
      next = everyClass ? allClassIds.filter((id) => id !== target) : current.filter((id) => id !== target);
      if (next.length === 0) { stranded.push(subject.sub_name); continue; }
    } else if (legacy) next = current; // unchanged, but move it onto classIds

    if (next) {
      ops.push({
        updateOne: {
          filter: { _id: subject._id },
          update: { $set: { classIds: next }, $unset: { classId: 1 } },
        },
      });
    }
  }

  if (stranded.length) {
    const names = stranded.join(', ');
    throw new AppError(
      `${names} ${stranded.length === 1 ? 'is' : 'are'} only taught in ${cls.cl_name}. To stop teaching ${stranded.length === 1 ? 'it' : 'them'}, mark ${stranded.length === 1 ? 'it' : 'them'} inactive or delete ${stranded.length === 1 ? 'it' : 'them'} in the subject list instead.`,
      400
    );
  }

  if (ops.length) await Subject.bulkWrite(ops);
  const list = await subjectsForClass(classId);
  return list.map(shapeSubject);
};
