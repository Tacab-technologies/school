import mongoose from 'mongoose';

// Models
import Student    from '../models/Student.js';
import Class      from '../models/Class.js';
import Section    from '../models/Section.js';
import Family     from '../models/Family.js';
import Guardian   from '../models/Guardian.js';
import Address    from '../models/Address.js';
import Residence  from '../models/Residence.js';
import User        from '../models/User.js';

// Utilities
import AppError     from '../utils/AppError.js';

// Services
import ApiResponse  from '../utils/ApiResponse.js';
import { activeStudentCounts, queryYearId } from '../utils/classCounts.js';
import * as studentService from '../services/studentService.js';
import { generatePassword } from '../utils/generatePassword.js';

// @desc   Create a new student
// @route  POST /api/students
export const createStudent = async (req, res, next) => {
  try {
    // A school with its own register numbers may type one; otherwise one is made.
    const ownNumber = typeof req.body.admissionNumber === 'string' ? req.body.admissionNumber.trim() : '';
    const { student, parentPortalCredentials } = await studentService.createStudentService(req.body, ownNumber ? { admissionNumber: ownNumber } : {});
    const data = student.toObject ? student.toObject() : student;
    if (parentPortalCredentials) data.parentPortalCredentials = parentPortalCredentials;
    res.status(201).json(new ApiResponse(201, data, 'Student and guardian registered successfully'));
  } catch (error) {
    next(error);
  }
};

// @desc   Get all students with search, filter & pagination
// @route  GET /api/students
export const getStudents = async (req, res, next) => {
  try {
    const { pagination, students } = await studentService.getAllStudentsService(req.query);
    res.status(200).json(new ApiResponse(200, { pagination, students }, 'Students retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// @desc   Get student by ID
// @route  GET /api/students/:id
export const getStudentById = async (req, res, next) => {
  try {
    const student = await studentService.getStudentByIdService(req.params.id);
    res.status(200).json(new ApiResponse(200, student, 'Student retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// @desc   Update student details
// @route  PUT /api/students/:id
export const updateStudent = async (req, res, next) => {
  try {
    const student = await studentService.updateStudentService(req.params.id, req.body);
    res.status(200).json(new ApiResponse(200, student, 'Student updated successfully'));
  } catch (error) {
    next(error);
  }
};

// @desc   Soft delete student
// @route  DELETE /api/students/:id
export const deleteStudent = async (req, res, next) => {
  try {
    await studentService.deleteStudentService(req.params.id);
    res.status(200).json(new ApiResponse(200, null, 'Student deleted successfully'));
  } catch (error) {
    next(error);
  }
};

// @desc   Update student enrollment status
// @route  PATCH /api/students/:id/status
export const updateStudentStatus = async (req, res, next) => {
  try {
    const student = await studentService.updateStudentStatusService(req.params.id, req.body.status);
    res.status(200).json(new ApiResponse(200, student, 'Student status updated successfully'));
  } catch (error) {
    next(error);
  }
};

// @desc   Check (dryRun, the default) or import spreadsheet rows
// @route  POST /api/students/import   { rows: [...], dryRun: boolean }
export const importStudents = async (req, res, next) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    const result = await studentService.importStudentsService(req.body?.rows, { dryRun });
    const message = dryRun
      ? `${result.ready} of ${result.total} students are ready to import`
      : `${result.created} students imported${result.failed.length ? `, ${result.failed.length} not imported` : ''}`;
    res.status(200).json(new ApiResponse(200, result, message));
  } catch (error) {
    next(error);
  }
};

// @desc   Read an uploaded .xlsx/.csv into rows for POST /api/students/import
// @route  POST /api/students/import/read   (multipart, field "file")
export const readImportFile = async (req, res, next) => {
  try {
    const result = await studentService.readImportFileService(req.file);
    res.status(200).json(new ApiResponse(200, result, 'File read'));
  } catch (error) {
    next(error);
  }
};

// @desc   The spreadsheet template to fill in
// @route  GET /api/students/import/template
export const downloadImportTemplate = async (req, res, next) => {
  try {
    const buffer = await studentService.buildImportTemplateService();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="students-import-template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
};

// @desc   Upload student profile photo
// @route  POST /api/students/:id/photo
export const uploadPhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError('Please upload an image file', 400));
    }
    const photoUrl = `/uploads/${req.file.filename}`;
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { $set: { photoUrl } },
      { new: true }
    );
    if (!student) return next(new AppError('Student not found', 404));
    res.status(200).json(new ApiResponse(200, student, 'Photo uploaded successfully'));
  } catch (error) {
    next(error);
  }
};

// @desc   Stream student photo from GridFS
// @route  GET /api/students/photo/:fileId
export const getPhoto = async (req, res, next) => {
  try {
    const db     = mongoose.connection.db;
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'student_photos' });
    const fileId = new mongoose.Types.ObjectId(req.params.fileId);
    const files  = await bucket.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return next(new AppError('Photo not found', 404));
    }

    res.setHeader('Content-Type', files[0].contentType);
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (error) {
    next(error);
  }
};

// @desc   Get reference data for student forms (classes, sections, etc.)
// @route  GET /api/students/reference-data
export const getReferenceData = async (req, res, next) => {
  try {
    const [classes, sections, guardians, families, addresses, residences] = await Promise.all([
      Class.find({}),
      Section.find({}),
      Guardian.find({}).populate('familyId', 'siblingCount discountTier').sort({ name: 1 }),
      Family.find({}),
      Address.find({}),
      Residence.find({})
    ]);
    const guardianIds = guardians.map((guardian) => guardian._id);
    const childCounts = await Student.aggregate([
      { $match: { isDeleted: false, 'guardians.guardianId': { $in: guardianIds } } },
      { $unwind: '$guardians' },
      { $group: { _id: '$guardians.guardianId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(childCounts.map((item) => [item._id.toString(), item.count]));
    const guardianOptions = guardians.map((guardian) => ({
      ...guardian.toObject(),
      childrenCount: countMap.get(guardian._id.toString()) || 0,
    }));
    // The form shows how full each section is, and that a full one can't be
    // picked. New students join the current year, so that is the default.
    const { bySection } = await activeStudentCounts(queryYearId(req.query.yearId));
    const sectionOptions = sections.map((section) => ({ ...section.toObject(), studentCount: bySection.get(String(section._id)) ?? 0 }));
    // Shown on the registration form, so staff know what number a new student gets.
    const nextAdmissionNumber = await studentService.previewAdmissionNumber();
    res.status(200).json(new ApiResponse(200, {
      classes, sections: sectionOptions, guardians: guardianOptions, families, addresses, residences, nextAdmissionNumber
    }, 'Reference data retrieved'));
  } catch (error) {
    next(error);
  }
};

// @desc   Create a login account for a student who has no account yet
// @route  POST /api/students/:id/account
export const createStudentAccount = async (req, res, next) => {
  try {
    const student = await Student.findOne({ _id: req.params.id, isDeleted: false });
    if (!student) return next(new AppError('Student not found', 404));

    if (student.userId) {
      return next(new AppError('This student already has a linked account', 400));
    }

    const { email, password } = req.body;
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return next(new AppError('Enter a valid email address for the login.', 400));
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
      return next(new AppError('The password must be at least 8 characters.', 400));
    }
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) return next(new AppError('Email already in use', 400));

    const temporaryPassword = password || generatePassword();

    const account = await User.create({
      firstName: student.firstName,
      lastName: student.lastName,
      email,
      password: temporaryPassword,
      role: 'student',
      mustChangePassword: true
    });

    student.userId = account._id;
    await student.save();

    const accountResponse = account.toObject();
    delete accountResponse.password;

    res.status(201).json(new ApiResponse(201, {
      account: accountResponse,
      student,
      // Only returned once, at creation time — the hash is all that's stored after this.
      temporaryPassword,
    }, 'Student account created successfully'));
  } catch (error) {
    next(error);
  }
};
