import mongoose from 'mongoose';
import Subject from '../models/Subject.js';
import AppError from '../utils/AppError.js';
import ApiResponse from '../utils/ApiResponse.js';
import { assertNotInUse } from '../utils/inUse.js';
import {
  assertClassesExist,
  nextSubjectNo,
  setClassSubjects as saveClassSubjects,
  shapeSubject,
  subjectsForClass,
} from '../services/subjectService.js';

const duplicateMessage = (error) =>
  error.keyPattern?.sub_no ? 'That subject number is already used by another subject.' : 'That display code is already used by another subject.';

/** The class list from the body: classIds wins; the old single classId is still accepted. */
const classIdsFromBody = (body) => {
  if (Array.isArray(body.classIds)) return body.classIds;
  if (body.classId) return [body.classId];
  if (body.classId === '' || body.classId === null) return [];
  return undefined;
};

const trimOrEmpty = (v) => (typeof v === 'string' ? v.trim() : v);

export const createSubject = async (req, res, next) => {
  try {
    const { sub_name, sub_no, subjectCode, status } = req.body;
    const classIds = await assertClassesExist(classIdsFromBody(req.body) ?? []);
    const subject = await Subject.create({
      sub_name: sub_name.trim(),
      sub_no: trimOrEmpty(sub_no) || await nextSubjectNo(),
      ...(trimOrEmpty(subjectCode) ? { subjectCode: subjectCode.trim() } : {}),
      classIds,
      ...(status ? { status } : {}),
    });
    res.status(201).json(new ApiResponse(201, shapeSubject(subject), 'Subject created successfully'));
  } catch (error) {
    if (error.code === 11000) return next(new AppError(duplicateMessage(error), 400));
    next(error);
  }
};

// GET /api/subjects            — every subject
// GET /api/subjects?classId=X  — subjects taught in class X (including "every class" ones)
export const getSubjects = async (req, res, next) => {
  try {
    const { classId } = req.query;
    let subjects;
    if (classId) {
      if (!mongoose.isValidObjectId(classId)) return next(new AppError('Choose a class from the list.', 400));
      subjects = await subjectsForClass(classId, { activeOnly: req.query.status === 'active' });
    } else {
      subjects = await Subject.find(req.query.status === 'active' ? { status: 'active' } : {}).sort({ sub_name: 1 }).lean();
    }
    res.status(200).json(new ApiResponse(200, subjects.map(shapeSubject), 'Subjects retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

export const getSubjectById = async (req, res, next) => {
  try {
    const subject = await Subject.findById(req.params.id).lean();
    if (!subject) return next(new AppError('Subject not found', 404));
    res.status(200).json(new ApiResponse(200, shapeSubject(subject), 'Subject retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

export const updateSubject = async (req, res, next) => {
  try {
    const { sub_name, sub_no, subjectCode, status } = req.body;
    const $set = {};
    const $unset = {};
    if (sub_name !== undefined) $set.sub_name = sub_name.trim();
    if (trimOrEmpty(sub_no)) $set.sub_no = sub_no.trim();
    if (subjectCode !== undefined) {
      if (trimOrEmpty(subjectCode)) $set.subjectCode = subjectCode.trim();
      else $unset.subjectCode = 1;
    }
    if (status !== undefined) $set.status = status;
    const classIds = classIdsFromBody(req.body);
    if (classIds !== undefined) {
      $set.classIds = await assertClassesExist(classIds);
      $unset.classId = 1;
    }

    const update = { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
    const subject = await Subject.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).lean();
    if (!subject) return next(new AppError('Subject not found', 404));
    res.status(200).json(new ApiResponse(200, shapeSubject(subject), 'Subject updated successfully'));
  } catch (error) {
    if (error.code === 11000) return next(new AppError(duplicateMessage(error), 400));
    next(error);
  }
};

// PUT /api/subjects/class/:classId  { subjectIds: [] } — exactly the subjects this class takes.
export const setClassSubjects = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.classId)) return next(new AppError('Class not found', 404));
    const subjects = await saveClassSubjects(req.params.classId, req.body.subjectIds);
    res.status(200).json(new ApiResponse(200, subjects, 'Subjects for this class saved'));
  } catch (error) {
    next(error);
  }
};

export const deleteSubject = async (req, res, next) => {
  try {
    await assertNotInUse('subject', req.params.id);
    const subject = await Subject.findByIdAndDelete(req.params.id);
    if (!subject) return next(new AppError('Subject not found', 404));
    res.status(200).json(new ApiResponse(200, null, 'Subject deleted successfully'));
  } catch (error) {
    next(error);
  }
};
