import { Readable } from 'stream';
import csv from 'csv-parser';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import Student from '../models/Student.js';
import SequenceCounter from '../models/SequenceCounter.js';
import SystemSetting from '../models/SystemSetting.js';
import Class from '../models/Class.js';
import Section from '../models/Section.js';
import Guardian from '../models/Guardian.js';
import Family from '../models/Family.js';
import User from '../models/User.js';
import Address from '../models/Address.js';
import Residence from '../models/Residence.js';
import StudentClass from '../models/StudentClass.js';
import AppError from '../utils/AppError.js';
import { activeStudentCounts, sectionHeadcount } from '../utils/classCounts.js';
import { resolveCurrentYearId } from '../utils/currentYear.js';
import { generatePassword } from '../utils/generatePassword.js';
import { recomputeFamilyDiscount } from './familyService.js';
import { transactionsSupported, withTransaction } from '../utils/transaction.js';
import { pageParams, searchRegex } from '../utils/query.js';
import { createStudentSchema } from '../validators/studentValidator.js';

export { resolveCurrentYearId };

// Admission numbers look like <school code>-<year>-<number>, e.g. HAA-2026-0001.
// The code is the School code in Settings › School profile (or, until one is
// set, the initials of the school's name). Admission numbers have their own
// running number per year, so they count students only.
export const admissionPrefix = async () => {
  const settings = await SystemSetting.findOne().select('schoolCode schoolName').lean();
  const code = String(settings?.schoolCode ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (code) return code.slice(0, 10);
  const initials = String(settings?.schoolName ?? '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0].toUpperCase()).join('');
  return initials.slice(0, 6) || 'STU';
};

const pad = (n) => String(n).padStart(4, '0');

// The highest number already used this year with this code (e.g. imported or
// from before admission numbers had their own counter), so numbering carries on.
const highestUsed = async (prefix, year, session = null) => {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const used = await Student.find({ admissionNumber: pattern }).select('admissionNumber').session(session).lean();
  return used.reduce((max, s) => Math.max(max, Number(pattern.exec(s.admissionNumber)?.[1] ?? 0)), 0);
};

/** The number the next registered student will get, without using it up. */
export const previewAdmissionNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = await admissionPrefix();
  const counter = await SequenceCounter.findOne({ name: `admission:${prefix}`, year }).lean();
  const next = Math.max(counter?.seq ?? 0, await highestUsed(prefix, year)) + 1;
  return `${prefix}-${year}-${pad(next)}`;
};

// Next admission number, taken atomically (works inside the registration transaction).
const generateAdmissionNumber = async (session = null) => {
  const year = new Date().getFullYear();
  const prefix = await admissionPrefix();
  const name = `admission:${prefix}`;
  if (!(await SequenceCounter.exists({ name, year }).session(session))) {
    await SequenceCounter.updateOne({ name, year }, { $max: { seq: await highestUsed(prefix, year, session) } }, { upsert: true, session });
  }
  const counter = await SequenceCounter.findOneAndUpdate({ name, year }, { $inc: { seq: 1 } }, { new: true, upsert: true, session });
  const candidate = `${prefix}-${year}-${pad(counter.seq)}`;
  // A school may have imported its own numbers; never hand out one already taken.
  if (await Student.exists({ admissionNumber: candidate }).session(session)) return generateAdmissionNumber(session);
  return candidate;
};

// An admission number the school already uses (spreadsheet import). Must be unused.
const claimAdmissionNumber = async (admissionNumber, session = null) => {
  const value = String(admissionNumber).trim();
  if (await Student.exists({ admissionNumber: value }).session(session)) {
    throw new AppError(`Admission number ${value} is already used by another student.`, 409);
  }
  return value;
};


// `joining` is set when a student joins the section (registration or a move): a
// section full in that school year (`yearId`, default the current one) refuses
// them. Students already in it are never refused. Last year's students, not yet
// promoted, don't take up places in the new year.
const validateClassAndSection = async (classId, sectionId, session = null, { joining = false, movingStudentId = null, yearId = null } = {}) => {
  const selectedClass = await Class.findById(classId).session(session);
  if (!selectedClass) throw new AppError('Selected class was not found.', 404);

  const sectionCount = await Section.countDocuments({ class: classId }).session(session);
  if (!sectionId) {
    if (sectionCount > 0) throw new AppError('Please select a section for this class.', 400);
    return null;
  }

  const selectedSection = await Section.findById(sectionId).session(session);
  if (!selectedSection || selectedSection.class.toString() !== classId.toString()) {
    throw new AppError('The selected section does not belong to this class.', 400);
  }
  if (joining && selectedSection.capacity) {
    const headcount = await sectionHeadcount(selectedSection, { yearId, exceptStudentId: movingStudentId, session });
    if (headcount >= selectedSection.capacity) {
      throw new AppError(`${selectedClass.cl_name} ${selectedSection.name} is full (${headcount} of ${selectedSection.capacity} places). Pick another section or raise its capacity.`, 409);
    }
  }
  return selectedSection._id;
};

// `options.admissionNumber`: keep a number the school already uses (import only;
// the POST /students validator does not accept one). Absent, one is generated.
export const createStudentService = async (bodyData, { admissionNumber: suppliedAdmissionNumber } = {}) => {
  const session = await mongoose.startSession();
  let student;
  let parentPortalCredentials = null;
  let familyId = null;
  // Records written by this attempt. On a database without transactions (a
  // standalone local MongoDB) a failure halfway would otherwise leave e.g. the
  // new guardian behind, and every retry would then fail with "this parent or
  // guardian already exists". So they are removed again on failure.
  let created = [];
  const track = (Model, docs) => { for (const d of docs) created.push([Model, d._id]); return docs; };

  try {
    await withTransaction(session, async () => {
      created = [];
      // Everything that can refuse the registration is checked before anything is written.
      const yearId = bodyData.yearId || (await resolveCurrentYearId());
      const sectionId = await validateClassAndSection(bodyData.classId, bodyData.sectionId, session, { joining: true, yearId });
      if (bodyData.email) {
        const existingStudent = await Student.findOne({ email: bodyData.email, isDeleted: false }).session(session);
        if (existingStudent) throw new AppError('A student with this email address already exists.', 409);
      }
      const admissionNumber = suppliedAdmissionNumber
        ? await claimAdmissionNumber(suppliedAdmissionNumber, session)
        : await generateAdmissionNumber(session);
      const guardianInput = bodyData.guardian || {
        mode: 'new',
        name: bodyData.parentName,
        relationship: 'Guardian',
        phone: bodyData.parentPhoneNumber,
      };

      let guardian;
      if (guardianInput.mode === 'existing') {
        guardian = await Guardian.findById(guardianInput.guardianId).session(session);
        if (!guardian) throw new AppError('Selected parent or guardian was not found.', 404);
      } else {
        const email = guardianInput.email?.trim().toLowerCase() || undefined;
        const phone = guardianInput.phone?.trim();
        const duplicateConditions = [{ phone }];
        if (email) duplicateConditions.push({ email });
        const existingGuardian = await Guardian.findOne({ $or: duplicateConditions }).session(session);
        if (existingGuardian) {
          throw new AppError('This parent or guardian already exists. Choose “Existing parent/guardian” and assign the student to that family.', 409);
        }
        if (guardianInput.createPortalUser) {
          if (!email) throw new AppError('Enter the parent\'s email to give them a portal login.', 400);
          const existingUser = await User.findOne({ email }).session(session);
          if (existingUser) throw new AppError('The parent portal email is already in use.', 409);
        }

        const [family] = track(Family, await Family.create([{
          familyName: `${guardianInput.name} Family`,
          primaryContactPhone: phone,
          primaryContactEmail: email,
        }], { session }));

        let userId = null;
        if (guardianInput.createPortalUser) {
          const temporaryPassword = generatePassword();
          const nameParts = String(guardianInput.name).trim().split(/\s+/);
          const [user] = track(User, await User.create([{
            firstName: nameParts[0] || 'Parent',
            lastName: nameParts.slice(1).join(' ') || 'Guardian',
            email,
            password: temporaryPassword,
            role: 'parent',
            mustChangePassword: true,
          }], { session }));
          userId = user._id;
          parentPortalCredentials = { email, temporaryPassword };
        }

        [guardian] = track(Guardian, await Guardian.create([{
          familyId: family._id,
          userId,
          name: guardianInput.name,
          relationship: guardianInput.relationship,
          phone,
          email,
          isPrimary: true,
        }], { session }));
      }

      familyId = guardian.familyId;
      const studentData = { ...bodyData };
      delete studentData.guardian;
      delete studentData.yearId;
      if (!studentData.phoneNumber) delete studentData.phoneNumber;
      Object.assign(studentData, {
        admissionNumber,
        sectionId,
        parentName: guardian.name,
        parentPhoneNumber: guardian.phone,
        familyId: guardian.familyId,
        guardians: [{ guardianId: guardian._id, isPrimary: true }],
      });

      [student] = track(Student, await Student.create([studentData], { session }));
      if (yearId) {
        track(StudentClass, await StudentClass.create([{
          sc_no: `SC-${student._id}-${yearId}`,
          student: student._id,
          class: student.classId,
          section: student.sectionId ?? null,
          year: yearId,
        }], { session }));
      }
    }).catch(async (error) => {
      if (!(await transactionsSupported())) {
        await Promise.all(created.reverse().map(([Model, id]) => Model.deleteOne({ _id: id }).catch(() => {})));
      }
      throw error;
    });

    await recomputeFamilyDiscount(familyId);
    student = await Student.findById(student._id)
      .populate('classId')
      .populate('sectionId')
      .populate('guardians.guardianId', 'name relationship phone email');
    return { student, parentPortalCredentials };
  } finally {
    await session.endSession();
  }
};

export const getAllStudentsService = async (filters) => {
  const {
    search,
    classId,
    sectionId,
    status,
    unassigned,
    yearId,
    page = 1,
    limit = 10
  } = filters;

  const query = {
    isDeleted: false
  };

  // Scope to whoever was actually enrolled that academic year — a student
  // graduated/created in a different year has no StudentClass row for this one.
  // Their class that year comes from the enrolment too, not from Student.classId,
  // which has moved on if they have been promoted since.
  if (yearId) {
    const placement = { year: yearId, ...(classId && { class: classId }) };
    const enrolled = [{ _id: { $in: await StudentClass.distinct('student', { ...placement, ...(sectionId && { section: sectionId }) }) } }];
    // An enrolment from before the section was stored: the student's own section stands in.
    if (sectionId) {
      enrolled.push({ _id: { $in: await StudentClass.distinct('student', { ...placement, section: null }) }, sectionId });
    }
    // Students with no enrolment at all (e.g. registered before the school year
    // was set up) belong to the current year, so they never vanish from the list.
    if (String(yearId) === String(await resolveCurrentYearId())) {
      enrolled.push({
        _id: { $nin: await StudentClass.distinct('student') },
        ...(classId && { classId }),
        ...(sectionId && { sectionId }),
      });
    }
    query.$and = [{ $or: enrolled }];
  }

  // Used by the Parents admin UI's "assign a student" picker, so it only offers
  // students who don't already have a guardian (enforces one-parent-per-student).
  if (unassigned === 'true' || unassigned === true) {
    query.guardians = { $size: 0 };
  }

  if (searchRegex(search)) {
    query.$or = [
      { firstName: searchRegex(search) },
      { lastName: searchRegex(search) },
      { email: searchRegex(search) },
      { admissionNumber: searchRegex(search) },
      { phoneNumber: searchRegex(search) }
    ];
  }

  if (classId && !yearId) {
    query.classId = classId;
  }

  if (sectionId && !yearId) {
    query.sectionId = sectionId;
  }

  if (status) {
    query.status = status;
  }

  const { page: currentPage, limit: pageSize } = pageParams({ page, limit }, { defaultLimit: 10, maxLimit: 1000 });

  const totalRecords = await Student.countDocuments(query);

  const students = await Student.find(query)
    .populate('classId')
    .populate('sectionId')
    .populate('guardians.guardianId', 'name phone email')
    .skip((currentPage - 1) * pageSize)
    .limit(pageSize)
    .sort({ createdAt: -1 });

  return {
    pagination: {
      page: currentPage,
      limit: pageSize,
      totalPages: Math.ceil(totalRecords / pageSize),
      totalRecords
    },
    students
  };
};

export const getStudentByIdService = async (id) => {
  const student = await Student.findOne({
    _id: id,
    isDeleted: false
  })
    .populate('classId')
    .populate({
      path: 'sectionId',
      populate: { path: 'classTeacherId', select: 'staffId userId', populate: { path: 'userId', select: 'firstName lastName' } }
    })
    .populate('guardians.guardianId', 'name phone email');

  if (!student) {
    throw new AppError('Student not found.', 404);
  }

  return student;
};

export const updateStudentService = async (id, bodyData) => {

  // The admission number is generated at registration, but a school with its
  // own register numbers may change it; it must stay unique.
  if (bodyData.admissionNumber !== undefined) {
    const next = String(bodyData.admissionNumber).trim();
    if (next.length < 2) throw new AppError('Enter an admission number.', 400);
    const taken = await Student.exists({ admissionNumber: next, _id: { $ne: id } });
    if (taken) throw new AppError(`Admission number ${next} is already used by another student.`, 409);
    bodyData.admissionNumber = next;
  }
  delete bodyData.guardian;
  delete bodyData.yearId;
  // Fields that have their own, more restricted endpoints (the per-student
  // discount is admin-only; logins, guardians and deletion have their own flows).
  for (const key of ['fee_discount', 'userId', 'isDeleted', 'deletedAt', 'guardians', 'familyId', '_id', 'createdAt', 'updatedAt']) {
    delete bodyData[key];
  }

  const currentStudent = await Student.findOne({ _id: id, isDeleted: false });
  if (!currentStudent) throw new AppError('Student not found.', 404);
  const nextClassId = bodyData.classId || currentStudent.classId;
  const nextSectionId = Object.prototype.hasOwnProperty.call(bodyData, 'sectionId')
    ? bodyData.sectionId
    : currentStudent.sectionId;
  if (bodyData.classId || Object.prototype.hasOwnProperty.call(bodyData, 'sectionId')) {
    const joining = String(nextSectionId ?? '') !== String(currentStudent.sectionId ?? '');
    bodyData.sectionId = await validateClassAndSection(nextClassId, nextSectionId, null, { joining, movingStudentId: currentStudent._id });
  }

  if (bodyData.email) {
    const existingStudent = await Student.findOne({
      email: bodyData.email,
      _id: { $ne: id },
      isDeleted: false
    });

    if (existingStudent) {
      throw new AppError(
        'A student with this email address already exists.',
        409
      );
    }
  }

  const student = await Student.findOneAndUpdate(
    {
      _id: id,
      isDeleted: false
    },
    {
      $set: bodyData
    },
    {
      new: true,
      runValidators: true
    }
  )
    .populate('classId')
    .populate('sectionId');

  if (!student) {
    throw new AppError('Student not found.', 404);
  }

  if (bodyData.status && bodyData.status !== currentStudent.status) await applyStatusChange(student, student.status);

  // A class move also moves this year's enrolment, so the student shows up on
  // the new class's attendance register (and leaves the old one).
  if (String(currentStudent.classId) !== String(student.classId?._id ?? student.classId)
    || String(currentStudent.sectionId ?? '') !== String(student.sectionId?._id ?? student.sectionId ?? '')) {
    const yearId = await resolveCurrentYearId();
    if (yearId) {
      await StudentClass.updateMany(
        { student: student._id, year: yearId },
        { class: student.classId?._id ?? student.classId, section: student.sectionId?._id ?? student.sectionId ?? null },
      );
    }
  }

  return student;
};

// Leaving the school (deletion, or a status other than Active) ends the
// student's login and gives siblings the discount their family now qualifies for.
const afterStudentLeaves = async (student) => {
  if (student.userId) await User.updateOne({ _id: student.userId }, { status: false, refreshTokens: [] });
  if (student.familyId) await recomputeFamilyDiscount(student.familyId);
};

const applyStatusChange = async (student, status) => {
  if (status === 'Active') {
    if (student.userId) await User.updateOne({ _id: student.userId }, { status: true });
    if (student.familyId) await recomputeFamilyDiscount(student.familyId);
  } else {
    await afterStudentLeaves(student);
  }
};

export const deleteStudentService = async (id) => {
  const student = await Student.findOneAndUpdate(
    {
      _id: id,
      isDeleted: false
    },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date()
      }
    },
    {
      new: true
    }
  );

  if (!student) {
    throw new AppError(
      'Student not found or has already been deleted.',
      404
    );
  }

  // Off every attendance register.
  await StudentClass.deleteMany({ student: student._id });
  await afterStudentLeaves(student);
  return student;
};

export const updateStudentStatusService = async (id, status) => {
  const student = await Student.findOneAndUpdate(
    {
      _id: id,
      isDeleted: false
    },
    {
      $set: { status }
    },
    {
      new: true,
      runValidators: true
    }
  );

  if (!student) {
    throw new AppError('Student not found.', 404);
  }

  await applyStatusChange(student, status);
  return student;
};

// ─── Importing students from a spreadsheet ──────────────────────────────────
// The school fills in the template (GET /students/import/template), uploads it
// (POST /students/import/read turns the file into rows), checks the preview
// (POST /students/import with dryRun) and then imports (dryRun: false). Each
// student is registered through createStudentService, exactly as the form does.

export const IMPORT_MAX_ROWS = 1000;

// The template's columns, in order. `aliases` also accepts common spellings.
export const IMPORT_COLUMNS = [
  { key: 'firstName', header: 'First name', required: true, example: 'Amina', aliases: ['firstname', 'first'] },
  { key: 'lastName', header: 'Last name', required: true, example: 'Hassan', aliases: ['lastname', 'surname', 'familyname'] },
  { key: 'gender', header: 'Gender', required: true, example: 'Female', aliases: ['sex'] },
  { key: 'birthDate', header: 'Date of birth', required: true, example: '25/03/2015', aliases: ['birthdate', 'dob', 'birthday'] },
  { key: 'className', header: 'Class', required: true, example: '', aliases: ['classname', 'grade'] },
  { key: 'sectionName', header: 'Section', required: false, example: '', aliases: ['sectionname', 'stream'] },
  { key: 'phoneNumber', header: 'Phone', required: false, example: '0612345678', aliases: ['phonenumber', 'studentphone', 'mobile'] },
  { key: 'address', header: 'Address', required: true, example: 'Hodan, Mogadishu', aliases: ['homeaddress'] },
  { key: 'parentName', header: 'Parent name', required: true, example: 'Hassan Ali', aliases: ['guardianname', 'parent', 'guardian'] },
  { key: 'parentPhone', header: 'Parent phone', required: true, example: '0619876543', aliases: ['parentphonenumber', 'guardianphone'] },
  { key: 'parentRelationship', header: 'Parent relationship', required: false, example: 'Father', aliases: ['relationship', 'guardianrelationship'] },
  { key: 'parentEmail', header: 'Parent email', required: false, example: '', aliases: ['guardianemail'] },
  { key: 'admissionNumber', header: 'Admission number', required: false, example: '', aliases: ['admissionno', 'admission'] },
  { key: 'email', header: 'Email', required: false, example: '', aliases: ['studentemail', 'emailaddress'] },
];

const headerKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const COLUMN_BY_HEADER = new Map(IMPORT_COLUMNS.flatMap((column) =>
  [column.header, column.key, ...column.aliases].map((name) => [headerKey(name), column.key])));

const nameKey = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
// Phone numbers are compared and stored without spaces, dashes, dots or brackets.
export const normalizeImportPhone = (value) => String(value ?? '').trim().replace(/[\s\-().]/g, '');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

const toIsoDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
};

/** YYYY-MM-DD, DD/MM/YYYY (also - or .), or an Excel serial number → 'YYYY-MM-DD'; null if not a date. */
export const parseImportDate = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw) return null;
  if (typeof value === 'number' || /^\d{4,5}(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial < 1000 || serial > 80000) return null;
    return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    let day = Number(match[1]);
    let month = Number(match[2]);
    // Day first, unless that cannot be (e.g. 03/25/2015 written month first).
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return toIsoDate(Number(match[3]), month, day);
  }
  return null;
};

export const parseImportGender = (value) => {
  const key = text(value).toLowerCase();
  if (['m', 'male', 'boy'].includes(key)) return 'Male';
  if (['f', 'female', 'girl'].includes(key)) return 'Female';
  return null;
};

/** One spreadsheet row (any header spelling) → the template's fields. */
const readImportRow = (raw) => {
  const row = {};
  for (const [header, value] of Object.entries(raw || {})) {
    const key = COLUMN_BY_HEADER.get(headerKey(header));
    if (key && row[key] === undefined) row[key] = key === 'birthDate' ? value : text(value);
  }
  return row;
};

const capitalise = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
const listNames = (items) => items.map((item) => item.name).join(', ');

/**
 * Checks every row against the database and the rest of the file, without
 * writing anything. Rows keep their spreadsheet row number (`rowNumber`, else
 * position + 2 for a header in row 1).
 */
const analyseImportRows = async (rawRows) => {
  const rows = rawRows.map((raw, index) => ({
    row: Number(raw?.rowNumber) || index + 2,
    data: readImportRow(raw),
  }));

  const phones = [...new Set(rows.map(({ data }) => normalizeImportPhone(data.parentPhone)).filter(Boolean))];
  const rawPhones = rows.map(({ data }) => text(data.parentPhone)).filter(Boolean);
  const allPhones = [...new Set([...phones, ...rawPhones])];
  const admissionNumbers = rows.map(({ data }) => data.admissionNumber).filter(Boolean);
  const studentEmails = rows.map(({ data }) => data.email?.toLowerCase()).filter(Boolean);
  const parentEmails = rows.map(({ data }) => data.parentEmail?.toLowerCase()).filter(Boolean);

  const [classes, sections, guardians, takenNumbers, takenEmails, emailGuardians, familyStudents, counts] = await Promise.all([
    Class.find().lean(),
    Section.find().lean(),
    Guardian.find({ phone: { $in: allPhones } }).lean(),
    Student.find({ admissionNumber: { $in: admissionNumbers } }).select('admissionNumber').lean(),
    Student.find({ email: { $in: studentEmails }, isDeleted: false }).select('email').lean(),
    Guardian.find({ email: { $in: parentEmails } }).select('email phone name').lean(),
    Student.find({ parentPhoneNumber: { $in: allPhones }, isDeleted: false })
      .select('firstName lastName birthDate parentPhoneNumber admissionNumber').lean(),
    activeStudentCounts(),
  ]);

  const classesByName = new Map();
  for (const item of classes) {
    for (const key of new Set([nameKey(item.cl_name), nameKey(item.cl_no)])) {
      classesByName.set(key, [...(classesByName.get(key) || []), item]);
    }
  }
  const sectionsByClass = new Map();
  for (const section of sections) {
    const key = String(section.class);
    sectionsByClass.set(key, [...(sectionsByClass.get(key) || []), section]);
  }
  const guardianByPhone = new Map(guardians.map((guardian) => [normalizeImportPhone(guardian.phone), guardian]));
  const takenNumberSet = new Set(takenNumbers.map((student) => student.admissionNumber));
  const takenEmailSet = new Set(takenEmails.map((student) => student.email?.toLowerCase()));
  const guardianByEmail = new Map(emailGuardians.map((guardian) => [guardian.email?.toLowerCase(), guardian]));
  const studentKey = (firstName, lastName, birthDate, parentPhone) =>
    [nameKey(firstName), nameKey(lastName), birthDate, normalizeImportPhone(parentPhone)].join('|');
  const existingStudentKeys = new Map(familyStudents.map((student) => [
    studentKey(student.firstName, student.lastName, student.birthDate?.toISOString().slice(0, 10), student.parentPhoneNumber),
    student.admissionNumber,
  ]));

  const seenNumbers = new Map();
  const seenEmails = new Map();
  const seenStudents = new Map();
  const firstRowForParent = new Map(); // parent phone → first row in this file that uses it
  const newParentEmails = new Map(); // parent email → phone of the new parent who claims it
  const plannedBySection = new Map();
  const today = new Date().toISOString().slice(0, 10);

  return rows.map(({ row, data }) => {
    const errors = [];
    const missing = (key, label) => {
      if (data[key] === undefined || text(data[key]) === '') { errors.push(`${label} is missing.`); return true; }
      return false;
    };

    if (!missing('firstName', 'First name') && data.firstName.length < 2) errors.push('First name must have at least 2 letters.');
    if (!missing('lastName', 'Last name') && data.lastName.length < 2) errors.push('Last name must have at least 2 letters.');

    let gender = null;
    if (!missing('gender', 'Gender')) {
      gender = parseImportGender(data.gender);
      if (!gender) errors.push(`Gender "${data.gender}" is not valid. Write Male or Female (or M / F).`);
    }

    let birthDate = null;
    if (!missing('birthDate', 'Date of birth')) {
      birthDate = parseImportDate(data.birthDate);
      if (!birthDate) errors.push(`Date of birth "${text(data.birthDate)}" is not a date we understand. Write it like 25/03/2015.`);
      else if (birthDate > today) { errors.push('Date of birth is in the future.'); birthDate = null; }
      else if (birthDate < '1900-01-01') { errors.push('Date of birth is too far in the past.'); birthDate = null; }
    }

    let classDoc = null;
    let sectionDoc = null;
    if (!missing('className', 'Class')) {
      const matches = classesByName.get(nameKey(data.className)) || [];
      if (matches.length === 0) errors.push(`Class "${data.className}" does not exist. Use a class name from the Instructions sheet, or add the class first.`);
      else if (matches.length > 1) errors.push(`More than one class is called "${data.className}". Write the class code instead.`);
      else classDoc = matches[0];
    }
    if (classDoc) {
      const classSections = sectionsByClass.get(String(classDoc._id)) || [];
      if (data.sectionName) {
        sectionDoc = classSections.find((section) => nameKey(section.name) === nameKey(data.sectionName)) || null;
        if (!sectionDoc) {
          errors.push(classSections.length
            ? `Section "${data.sectionName}" does not exist in ${classDoc.cl_name}. Its sections are: ${listNames(classSections)}.`
            : `${classDoc.cl_name} has no sections. Leave Section empty.`);
        }
      } else if (classSections.length) {
        errors.push(`Section is missing. ${classDoc.cl_name} has sections: ${listNames(classSections)}.`);
      }
    }

    const phoneNumber = normalizeImportPhone(data.phoneNumber);
    if (phoneNumber && phoneNumber.length < 7) errors.push(`Phone "${data.phoneNumber}" is too short.`);
    if (!missing('address', 'Address') && data.address.length < 3) errors.push('Address is too short.');

    const parentPhone = normalizeImportPhone(data.parentPhone);
    const existingParent = parentPhone ? guardianByPhone.get(parentPhone) : null;
    // A parent already in the system keeps their own name; the file's is not needed.
    if (!existingParent && !missing('parentName', 'Parent name') && data.parentName.length < 2) errors.push('Parent name is too short.');
    if (!missing('parentPhone', 'Parent phone') && parentPhone.length < 7) errors.push(`Parent phone "${data.parentPhone}" is too short.`);

    const parentEmail = data.parentEmail?.toLowerCase() || '';
    if (parentEmail && !EMAIL_PATTERN.test(parentEmail)) errors.push(`Parent email "${data.parentEmail}" is not a valid email address.`);
    else if (parentEmail && !existingParent && parentPhone) {
      const owner = guardianByEmail.get(parentEmail);
      const claimedBy = newParentEmails.get(parentEmail);
      if (owner) errors.push(`Parent email ${parentEmail} already belongs to another parent (${owner.name}, ${owner.phone}).`);
      else if (claimedBy && claimedBy !== parentPhone) errors.push(`Parent email ${parentEmail} is used for two different parent phones in this file.`);
    }

    const email = data.email?.toLowerCase() || '';
    if (email) {
      if (!EMAIL_PATTERN.test(email)) errors.push(`Email "${data.email}" is not a valid email address.`);
      else if (takenEmailSet.has(email)) errors.push(`Email ${email} is already used by another student.`);
      else if (seenEmails.has(email)) errors.push(`Email ${email} is also used in row ${seenEmails.get(email)}.`);
    }

    const admissionNumber = data.admissionNumber || '';
    if (admissionNumber) {
      if (takenNumberSet.has(admissionNumber)) errors.push(`Admission number ${admissionNumber} is already used by another student.`);
      else if (seenNumbers.has(admissionNumber)) errors.push(`Admission number ${admissionNumber} is also used in row ${seenNumbers.get(admissionNumber)}.`);
    }

    // The same child already registered, or twice in this file: same name, birthday and parent phone.
    if (data.firstName && data.lastName && birthDate && parentPhone) {
      const key = studentKey(data.firstName, data.lastName, birthDate, parentPhone);
      if (existingStudentKeys.has(key)) errors.push(`This student is already registered (admission number ${existingStudentKeys.get(key)}).`);
      else if (seenStudents.has(key)) errors.push(`The same student is also in row ${seenStudents.get(key)}.`);
    }

    if (sectionDoc?.capacity && errors.length === 0) {
      const key = String(sectionDoc._id);
      const headcount = (counts.bySection.get(key) ?? 0) + (plannedBySection.get(key) ?? 0);
      if (headcount >= sectionDoc.capacity) errors.push(`${classDoc.cl_name} ${sectionDoc.name} is full (${sectionDoc.capacity} places).`);
    }

    const body = {
      firstName: data.firstName,
      lastName: data.lastName,
      gender,
      birthDate,
      classId: classDoc ? String(classDoc._id) : undefined,
      sectionId: sectionDoc ? String(sectionDoc._id) : null,
      ...(phoneNumber && { phoneNumber }),
      address: data.address,
      parentName: existingParent?.name || data.parentName,
      parentPhoneNumber: existingParent?.phone || parentPhone,
      ...(email && { email }),
    };
    if (errors.length === 0) {
      // Last safety net: the same rules as the registration form.
      const check = createStudentSchema.safeParse(body);
      if (!check.success) errors.push(...new Set(check.error.errors.map((issue) => issue.message)));
    }

    const ok = errors.length === 0;
    const sameParentAsRow = parentPhone && !existingParent ? firstRowForParent.get(parentPhone) ?? null : null;
    if (ok) {
      if (admissionNumber) seenNumbers.set(admissionNumber, row);
      if (email) seenEmails.set(email, row);
      seenStudents.set(studentKey(data.firstName, data.lastName, birthDate, parentPhone), row);
      if (!firstRowForParent.has(parentPhone)) firstRowForParent.set(parentPhone, row);
      if (parentEmail && !existingParent && !newParentEmails.has(parentEmail)) newParentEmails.set(parentEmail, parentPhone);
      if (sectionDoc) plannedBySection.set(String(sectionDoc._id), (plannedBySection.get(String(sectionDoc._id)) ?? 0) + 1);
    }

    return {
      row,
      ok,
      errors,
      name: [data.firstName, data.lastName].filter(Boolean).join(' '),
      className: classDoc?.cl_name ?? data.className ?? '',
      sectionName: sectionDoc?.name ?? data.sectionName ?? '',
      parentName: existingParent?.name || data.parentName || '',
      willLinkToExistingParent: Boolean(existingParent),
      sameParentAsRow,
      // Internal: what the real run needs. Removed from the dry-run answer.
      _body: body,
      _admissionNumber: admissionNumber || null,
      _parent: {
        phone: parentPhone,
        guardianId: existingParent ? String(existingParent._id) : null,
        name: data.parentName,
        relationship: capitalise(data.parentRelationship) || 'Guardian',
        email: parentEmail || undefined,
      },
    };
  });
};

// eslint-disable-next-line no-unused-vars
const publicRow = ({ _body, _admissionNumber, _parent, ...rest }) => rest;

/**
 * dryRun (the default): per-row problems, nothing written.
 * Real run: every row without problems is registered, one by one; the others
 * come back in `failed`.
 */
export const importStudentsService = async (rawRows, { dryRun = true } = {}) => {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new AppError('The file has no students in it.', 400);
  if (rawRows.length > IMPORT_MAX_ROWS) {
    throw new AppError(`You can import at most ${IMPORT_MAX_ROWS} students at a time. This file has ${rawRows.length}; split it into smaller files.`, 400);
  }

  const results = await analyseImportRows(rawRows);
  if (dryRun) {
    const ok = results.filter((result) => result.ok);
    return {
      dryRun: true,
      total: results.length,
      ready: ok.length,
      withProblems: results.length - ok.length,
      newParents: new Set(ok.filter((result) => !result.willLinkToExistingParent).map((result) => result._parent.phone)).size,
      existingParents: new Set(ok.filter((result) => result.willLinkToExistingParent).map((result) => result._parent.phone)).size,
      rows: results.map(publicRow),
    };
  }

  const created = [];
  const failed = [];
  const createdGuardianByPhone = new Map(); // siblings in the file share the parent the first one created
  for (const result of results) {
    if (!result.ok) {
      failed.push({ row: result.row, name: result.name, error: result.errors.join(' ') });
      continue;
    }
    const parent = result._parent;
    const guardianId = parent.guardianId || createdGuardianByPhone.get(parent.phone);
    const guardian = guardianId
      ? { mode: 'existing', guardianId }
      : { mode: 'new', name: parent.name, relationship: parent.relationship, phone: parent.phone, email: parent.email, createPortalUser: false };
    try {
      const { student } = await createStudentService({ ...result._body, guardian }, { admissionNumber: result._admissionNumber });
      const linkedGuardian = student.guardians?.[0]?.guardianId;
      if (!guardianId && linkedGuardian) createdGuardianByPhone.set(parent.phone, String(linkedGuardian._id ?? linkedGuardian));
      created.push({ row: result.row, id: String(student._id), name: result.name, admissionNumber: student.admissionNumber });
    } catch (error) {
      failed.push({ row: result.row, name: result.name, error: error.message });
    }
  }
  return { dryRun: false, total: results.length, created: created.length, students: created, failed };
};

/** The uploaded .xlsx or .csv → rows keyed by its header row, each with its spreadsheet row number. */
export const readImportFileService = async (file) => {
  if (!file) throw new AppError('Please choose the filled-in spreadsheet.', 400);
  const extension = (file.originalname.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  let table = []; // [rowNumber, values[]]

  if (extension === '.csv') {
    const decoded = file.buffer.toString('utf-8');
    const content = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded; // Excel's byte-order mark
    const firstLine = content.split(/\r?\n/, 1)[0] || '';
    // Excel in many countries saves CSV with ; between the columns.
    const separator = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const records = [];
    await new Promise((resolve, reject) => {
      Readable.from(content).pipe(csv({ separator, headers: false }))
        .on('data', (record) => records.push(Object.values(record)))
        .on('end', resolve)
        .on('error', reject);
    });
    table = records.map((values, index) => [index + 1, values]);
  } else if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer);
    } catch {
      throw new AppError('This file could not be read. Open it in Excel and save it again as .xlsx.', 400);
    }
    const sheet = workbook.getWorksheet('Students') || workbook.worksheets[0];
    if (!sheet) throw new AppError('The file has no sheets.', 400);
    sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
      const values = [];
      excelRow.eachCell({ includeEmpty: true }, (cell, column) => {
        let value = cell.value;
        if (value && typeof value === 'object' && !(value instanceof Date)) {
          if ('result' in value) value = value.result; // formula
          else if ('text' in value) value = value.text; // hyperlink (emails)
          else if (Array.isArray(value.richText)) value = value.richText.map((part) => part.text).join('');
          else value = '';
        }
        values[column - 1] = value;
      });
      table.push([rowNumber, values]);
    });
  } else {
    throw new AppError(extension === '.xls'
      ? 'Old Excel files (.xls) cannot be read. In Excel choose File > Save As > Excel Workbook (.xlsx), then upload that file.'
      : 'Please upload the template as an Excel file (.xlsx) or a .csv file.', 400);
  }

  const blank = (value) => value === null || value === undefined || String(value).trim() === '';
  const nonEmpty = table.filter(([, values]) => Array.from(values).some((value) => !blank(value)));
  if (nonEmpty.length === 0) throw new AppError('The file is empty.', 400);
  const [[, headerValues], ...dataRows] = nonEmpty;
  const headers = Array.from(headerValues, (value) => text(value));
  if (!headers.some((header) => COLUMN_BY_HEADER.get(headerKey(header)) === 'firstName')) {
    throw new AppError('The first row must have the column titles from the template (First name, Last name, ...).', 400);
  }

  const exampleFirstName = IMPORT_COLUMNS.find((column) => column.key === 'firstName').example;
  const exampleParentPhone = IMPORT_COLUMNS.find((column) => column.key === 'parentPhone').example;
  const rows = dataRows.map(([rowNumber, values]) => {
    const row = { rowNumber };
    headers.forEach((header, index) => { if (header) row[header] = values[index] ?? ''; });
    return row;
  }).filter((row) => {
    // The template's example row, left in by mistake, is not a student.
    const data = readImportRow(row);
    return !(data.firstName === exampleFirstName && normalizeImportPhone(data.parentPhone) === exampleParentPhone);
  });
  if (rows.length === 0) throw new AppError('The file has no students in it. Add one student per row under the titles.', 400);
  return { rows, total: rows.length };
};

/** The template workbook: a Students sheet to fill in and an Instructions sheet with the school's classes. */
export const buildImportTemplateService = async () => {
  const [classes, sections] = await Promise.all([
    Class.find().sort({ cl_name: 1 }).lean(),
    Section.find().sort({ name: 1 }).lean(),
  ]);
  const sectionsByClass = new Map();
  for (const section of sections) {
    const key = String(section.class);
    sectionsByClass.set(key, [...(sectionsByClass.get(key) || []), section.name]);
  }
  const firstClass = classes[0];
  const firstSection = firstClass ? sectionsByClass.get(String(firstClass._id))?.[0] ?? '' : '';

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = IMPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.max(14, column.header.length + 4),
    // Phone numbers, dates and admission numbers as text, so Excel keeps leading zeros and the date as written.
    style: ['phoneNumber', 'parentPhone', 'birthDate', 'admissionNumber'].includes(column.key) ? { numFmt: '@' } : {},
  }));
  const header = sheet.getRow(1);
  IMPORT_COLUMNS.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column.required ? 'FF1E3A8A' : 'FF64748B' } };
  });
  sheet.addRow(Object.fromEntries(IMPORT_COLUMNS.map((column) => [column.key,
    column.key === 'className' ? firstClass?.cl_name ?? '' : column.key === 'sectionName' ? firstSection : column.example])));
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF64748B' } };

  const lists = workbook.addWorksheet('Lists', { state: 'hidden' });
  lists.getColumn(1).values = ['Classes', ...classes.map((item) => item.cl_name)];
  lists.getColumn(2).values = ['Gender', 'Male', 'Female'];
  const genderColumn = IMPORT_COLUMNS.findIndex((column) => column.key === 'gender') + 1;
  const classColumn = IMPORT_COLUMNS.findIndex((column) => column.key === 'className') + 1;
  for (let rowNumber = 2; rowNumber <= IMPORT_MAX_ROWS + 1; rowNumber += 1) {
    sheet.getCell(rowNumber, genderColumn).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['Lists!$B$2:$B$3'], showErrorMessage: true, errorStyle: 'warning', error: 'Choose Male or Female.',
    };
    if (classes.length) {
      sheet.getCell(rowNumber, classColumn).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`Lists!$A$2:$A$${classes.length + 1}`], showErrorMessage: true, errorStyle: 'warning', error: 'Choose a class from the list.',
      };
    }
  }

  const help = workbook.addWorksheet('Instructions');
  help.getColumn(1).width = 28;
  help.getColumn(2).width = 80;
  const line = (a = '', b = '', bold = false) => { const row = help.addRow([a, b]); if (bold) row.font = { bold: true }; };
  line('How to fill in this file', '', true);
  line('1.', 'Go to the "Students" sheet. Write one student per row, starting on row 2.');
  line('2.', 'Row 2 is an example. Type over it or delete it.');
  line('3.', 'Dark blue columns must be filled in. Grey columns may be left empty.');
  line('4.', 'Brothers and sisters: give them the same Parent phone and they are put in one family.');
  line('5.', 'Save the file, then upload it on the Students page (Import).');
  line();
  line('Column', 'What to write', true);
  const notes = {
    gender: 'Male or Female (M or F also works).',
    birthDate: 'Day/Month/Year, for example 25/03/2015.',
    className: 'One of the class names below.',
    sectionName: 'The section of that class (see below). Leave empty if the class has no sections.',
    phoneNumber: 'Student or home phone number. Leave empty if there is none.',
    parentPhone: 'If this parent is already in the system, the student is added to that family.',
    parentRelationship: 'Father, Mother, Uncle... (Guardian if empty).',
    admissionNumber: 'Only if the school already has its own numbers. Leave empty and one is given automatically.',
    email: 'Student email.',
  };
  for (const column of IMPORT_COLUMNS) line(column.header + (column.required ? ' (required)' : ''), notes[column.key] || '');
  line();
  line('Classes in the school', 'Sections', true);
  if (classes.length === 0) line('(no classes yet)', 'Add classes in Academic Structure before importing.');
  for (const item of classes) line(item.cl_name, (sectionsByClass.get(String(item._id)) || []).join(', ') || 'No sections: leave Section empty');

  return workbook.xlsx.writeBuffer();
};

export const getReferenceDataService = async () => {
  return {
    classes: await Class.find({}),
    sections: await Section.find({}),
    guardians: await Guardian.find({}),
    addresses: await Address.find({}),
    residences: await Residence.find({})
  };
};
