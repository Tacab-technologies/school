import mongoose from 'mongoose';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';
import TeacherAssignment from '../models/TeacherAssignment.js';
import Subject from '../models/Subject.js';
import Class from '../models/Class.js';
import Section from '../models/Section.js';
import Period from '../models/Period.js';
import Term from '../models/Term.js';
import AppError from '../utils/AppError.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiFeatures from '../utils/ApiFeatures.js';
import { generatePassword } from '../utils/generatePassword.js';
import { CONFLICT, findConflict, slotsOverlap } from '../utils/assignmentConflict.js';
import { withTransaction } from '../utils/transaction.js';
import { escapeRegex } from '../utils/query.js';
import { subjectTaughtIn } from '../services/subjectService.js';

// The next free staff ids, for one teacher or for many added at once.
export const generateStaffIds = async (howMany, session = null) => {
  const taken = new Set(await Teacher.distinct('staffId').session(session));
  let number = await Teacher.countDocuments().session(session);
  const staffIds = [];
  while (staffIds.length < howMany) {
    number += 1;
    const staffId = `TCH-${String(number).padStart(4, '0')}`;
    if (!taken.has(staffId)) staffIds.push(staffId);
  }
  return staffIds;
};

const generateStaffId = async () => (await generateStaffIds(1))[0];

// Shared populate chain for assignments — resolves subject/class/level, section,
// term/academic-year, and each timetable slot's period (name + real times) in one
// shot so the client never has to make follow-up calls.
const populateAssignment = (query) =>
  query
    .populate('subjectId', 'sub_name subjectCode sub_no')
    .populate({
      path: 'classId',
      select: 'cl_name cl_no lev_no',
      populate: { path: 'lev_no', select: 'lev_name lev_no' },
    })
    .populate('sectionId', 'name')
    .populate({
      path: 'termId',
      select: 'name academicYearId',
      populate: { path: 'academicYearId', select: 'y_name y_no' },
    })
    .populate('timetableSlots.periodId', 'per_no per_name time_in time_out');

// Slots only carry {day, periodId} — resolve each to its period's real name/times,
// confirm the period actually belongs to the assignment's own term (a Term 1
// assignment can't be scheduled against a Term 2-only period), and confirm the day
// is actually a teaching day for that term (e.g. Friday might be off).
const resolveSlotTimes = async (slots, termId) => {
  const periodIds = [...new Set(slots.map((s) => s.periodId?.toString()).filter(Boolean))];
  const [periods, term] = await Promise.all([
    Period.find({ _id: { $in: periodIds } }),
    termId ? Term.findById(termId).select('workingDays') : null,
  ]);
  const periodMap = new Map(periods.map((p) => [p._id.toString(), p]));

  return slots.map((slot) => {
    if (!slot.day || !slot.periodId) {
      throw new AppError('Each timetable slot needs a day and a period.', 400);
    }
    if (term && term.workingDays?.length && !term.workingDays.includes(slot.day)) {
      throw new AppError(`${slot.day} is not a teaching day for this term.`, 400);
    }
    const period = periodMap.get(slot.periodId.toString());
    if (!period) {
      throw new AppError('One of the selected periods no longer exists.', 400);
    }
    if (termId && period.termId.toString() !== termId.toString()) {
      throw new AppError(`${period.per_name} does not belong to the selected term.`, 400);
    }
    return {
      day: slot.day,
      periodId: slot.periodId,
      periodName: period.per_name,
      startTime: period.time_in,
      endTime: period.time_out,
    };
  });
};

// Lessons on the timetable are optional: a teacher can be given a class
// before its timetable is made, and the lessons added later.
const validateSlots = async (slots, termId) => {
  if (slots === undefined || slots === null) return;
  if (!Array.isArray(slots)) throw new AppError('Timetable slots must be a list.', 400);
  if (slots.length === 0) return;
  const resolved = await resolveSlotTimes(slots, termId);

  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      if (resolved[i].day === resolved[j].day && resolved[i].periodId.toString() === resolved[j].periodId.toString()) {
        throw new AppError(`Duplicate slot: ${resolved[i].periodName} is already selected for ${resolved[i].day}.`, 400);
      }
      if (slotsOverlap(resolved[i], resolved[j])) {
        throw new AppError(
          `Timetable conflict: ${resolved[i].periodName} and ${resolved[j].periodName} overlap on ${resolved[i].day}.`,
          400
        );
      }
    }
  }
};

// Both conflict checks in one pass, using the shared rule engine in
// utils/assignmentConflict.js. A candidate assignment can clash with any
// assignment for the same class+section (whoever teaches it) or with any other
// assignment held by the same teacher, so both sets are fetched and evaluated
// together — see that file for the full rule list.
const assertNoAssignmentConflict = async (
  { teacherId, classId, sectionId, subjectId, termId },
  slots,
  excludeAssignmentId = null
) => {
  const candidate = {
    teacherId,
    classId,
    sectionId,
    subjectId,
    termId,
    slots: await resolveSlotTimes(slots, termId)
  };

  const query = {
    termId,
    $or: [{ classId, sectionId }, { teacherId }]
  };
  if (excludeAssignmentId) query._id = { $ne: excludeAssignmentId };

  const others = await TeacherAssignment.find(query)
    .populate('subjectId', 'sub_name')
    .populate('classId', 'cl_name')
    .populate({
      path: 'teacherId',
      select: 'userId',
      populate: { path: 'userId', select: 'firstName lastName' }
    })
    .populate('timetableSlots.periodId', 'per_name time_in time_out');

  const candidates = others.map((other) => ({
    teacherId: other.teacherId?._id ?? other.teacherId,
    classId: other.classId?._id ?? other.classId,
    sectionId: other.sectionId,
    subjectId: other.subjectId?._id ?? other.subjectId,
    termId: other.termId,
    // Slots whose period was deleted can't be compared — drop them rather
    // than letting an undefined time silently pass every overlap check.
    slots: other.timetableSlots
      .filter((slot) => slot.periodId)
      .map((slot) => ({
        day: slot.day,
        startTime: slot.periodId.time_in,
        endTime: slot.periodId.time_out,
        periodName: slot.periodId.per_name
      })),
    doc: other
  }));

  const conflict = findConflict(candidate, candidates);
  if (!conflict) return;

  const other = conflict.other.doc;
  const user = other.teacherId?.userId;
  const teacherName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'another teacher'
    : 'another teacher';
  const subjectName = other.subjectId?.sub_name || 'another subject';
  const className = other.classId?.cl_name || 'this class';
  const slot = conflict.otherSlot;
  const when = `${slot.day} ${slot.startTime}-${slot.endTime}`;

  const messages = {
    [CONFLICT.SUBJECT_DOUBLE_STAFFED]:
      `This subject is already assigned to another teacher for this class during this time ` +
      `(${subjectName}, ${className}, ${when}, ${teacherName}).`,
    [CONFLICT.CLASS_BUSY]:
      `${className} is already taking ${subjectName} with ${teacherName} on ${when}.`,
    [CONFLICT.TEACHER_BUSY]:
      `${teacherName} is already teaching ${subjectName} (${className}) on ${when}.`
  };

  throw new AppError(messages[conflict.reason], 409);
};

export const createTeacher = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    let newTeacher, newUser, temporaryPassword;

    await withTransaction(session, async () => {
      const { 
        name, 
        fullName, 
        email, 
        password, 
        department, 
        qualifications, 
        qualification, 
        phone, 
        experience, 
        status, 
        employeeId, 
        staffId,
        subject,
        assignedClass
      } = req.body;

      const emailToUse = email;
      if (!emailToUse) {
        throw new AppError('Email is required', 400);
      }

      const existingUser = await User.findOne({ email: emailToUse }).session(session);
      if (existingUser) {
        throw new AppError('Email already in use', 400);
      }

      const inputName = name || fullName || 'New Teacher';
      const parts = inputName.trim().split(/\s+/);
      const firstName = parts[0] || 'Teacher';
      const lastName = parts.slice(1).join(' ') || 'Staff';

      // Admin can supply a password, but the common path is admin-provisions-account:
      // generate one so the admin isn't forced to invent (and remember) it themselves.
      temporaryPassword = password || generatePassword();

      const createdUsers = await User.create([{
        firstName,
        lastName,
        email: emailToUse,
        password: temporaryPassword,
        role: 'teacher',
        mustChangePassword: true,
      }], { session });
      newUser = createdUsers[0];

      // Allow passing employeeId/staffId or auto-generate
      const staffIdToUse = staffId || employeeId || await generateStaffId();

      const createdTeachers = await Teacher.create([{
        userId: newUser._id,
        staffId: staffIdToUse,
        department,
        qualifications: qualifications || qualification,
        phone,
        experience,
        status: status || 'Active',
      }], { session });
      newTeacher = createdTeachers[0];

      // Auto-create teacher assignment if subject & class are passed
      if (subject && assignedClass) {
        const foundSub = await Subject.findOne({ sub_name: { $regex: new RegExp(`^${escapeRegex(subject.trim())}$`, 'i') } }).session(session);
        const classQuery = assignedClass.split('-')[0].trim();
        const foundClass = await Class.findOne({ cl_name: { $regex: new RegExp(escapeRegex(classQuery), 'i') } }).session(session);

        if (foundSub && foundClass) {
          await TeacherAssignment.create([{
            teacherId: newTeacher._id,
            subjectId: foundSub._id,
            classId: foundClass._id,
            timetableSlots: []
          }], { session });
        }
      }
    });

    const userResponse = newUser.toObject();
    delete userResponse.password;

    res.status(201).json(new ApiResponse(201, {
      teacher: newTeacher,
      user: userResponse,
      // Only returned once, at creation time — the hash is all that's stored after this.
      temporaryPassword,
    }, 'Teacher created successfully'));
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

export const getTeachers = async (req, res, next) => {
  try {
    const features = new ApiFeatures(Teacher.find().populate('userId', 'firstName lastName email role'), req.query, { filters: ['status', 'department'], defaultLimit: 1000 })
      .filter()
      .sort()
      .search(['staffId', 'department'])
      .paginate();

    const teachers = await features.query;

    // Fetch assignments for these teachers to avoid N+1 query overhead
    const teacherIds = teachers.map(t => t._id);
    const allAssignments = await TeacherAssignment.find({ teacherId: { $in: teacherIds } })
      .populate('subjectId', 'sub_name subjectCode')
      .populate('classId', 'cl_name cl_no');

    const teachersWithAssignments = teachers.map(t => {
      const assignments = allAssignments.filter(a => a.teacherId && a.teacherId.toString() === t._id.toString());
      return {
        ...t.toObject(),
        assignments: assignments.map(a => ({
          _id: a._id,
          subject: a.subjectId,
          class: a.classId,
          slots: a.timetableSlots
        }))
      };
    });

    res.status(200).json(new ApiResponse(200, teachersWithAssignments, 'Teachers retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

export const getTeacher = async (req, res, next) => {
  try {
    const teacher = await Teacher.findById(req.params.id).populate('userId', 'firstName lastName email role');
    if (!teacher) return next(new AppError('Teacher not found', 404));

    const assignments = await populateAssignment(TeacherAssignment.find({ teacherId: teacher._id }));

    res.status(200).json(new ApiResponse(200, { teacher, assignments }, 'Teacher retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

export const updateTeacher = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    let updatedTeacher;
    await withTransaction(session, async () => {
      const teacher = await Teacher.findById(req.params.id).session(session);
      if (!teacher) throw new AppError('Teacher not found', 404);

      // Update Teacher fields
      const teacherFields = ['department', 'qualifications', 'status', 'phone', 'experience'];
      teacherFields.forEach(f => {
        if (req.body[f] !== undefined) teacher[f] = req.body[f];
      });

      if (req.body.qualification !== undefined) {
        teacher.qualifications = req.body.qualification;
      }

      await teacher.save({ session });

      // Sync User fields if they are updated
      if (req.body.name || req.body.fullName || req.body.email) {
        const user = await User.findById(teacher.userId).session(session);
        if (user) {
          if (req.body.email) {
            if (req.body.email !== user.email) {
              const emailExists = await User.findOne({ email: req.body.email }).session(session);
              if (emailExists) throw new AppError('Email already in use', 400);
            }
            user.email = req.body.email;
          }
          const nameToUse = req.body.name || req.body.fullName;
          if (nameToUse) {
            const parts = nameToUse.trim().split(/\s+/);
            user.firstName = parts[0] || user.firstName;
            user.lastName = parts.slice(1).join(' ') || user.lastName;
          }
          await user.save({ session });
        }
      }

      updatedTeacher = teacher;
    });

    const populated = await Teacher.findById(updatedTeacher._id).populate('userId', 'firstName lastName email role');
    const assignments = await TeacherAssignment.find({ teacherId: populated._id })
      .populate('subjectId', 'sub_name subjectCode')
      .populate('classId', 'cl_name cl_no');

    const result = {
      ...populated.toObject(),
      assignments: assignments.map(a => ({
        _id: a._id,
        subject: a.subjectId,
        class: a.classId,
        slots: a.timetableSlots
      }))
    };

    res.status(200).json(new ApiResponse(200, result, 'Teacher profile updated successfully'));
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

export const deleteTeacher = async (req, res, next) => {
  try {
    const teacher = await Teacher.findByIdAndUpdate(req.params.id, { isDeleted: true }, { new: true });
    if (!teacher) return next(new AppError('Teacher not found', 404));
    // A removed teacher can no longer sign in, and their lessons leave the
    // timetable so the slots are free for whoever takes over.
    if (teacher.userId) await User.updateOne({ _id: teacher.userId }, { status: false, refreshTokens: [] });
    await TeacherAssignment.deleteMany({ teacherId: teacher._id });

    res.status(200).json(new ApiResponse(200, null, 'Teacher soft deleted successfully'));
  } catch (error) {
    next(error);
  }
};

// A teacher can only be given a subject the class actually takes
// (set in Academic Structure > Subjects).
const assertSubjectInClass = async (subjectId, classId) => {
  if (!subjectId || !classId || !mongoose.isValidObjectId(subjectId) || !mongoose.isValidObjectId(classId)) return;
  const [subject, cls] = await Promise.all([
    Subject.findById(subjectId).select('sub_name classIds classId').lean(),
    Class.findById(classId).select('cl_name').lean(),
  ]);
  if (!subject || !cls) return; // missing ids are reported by the usual checks
  if (!subjectTaughtIn(subject, classId)) {
    throw new AppError(`${subject.sub_name} is not taught in ${cls.cl_name}. Add it to this class's subjects in Academic Structure first, or choose another subject.`, 400);
  }
};

// A class split into sections needs one; a class without sections takes none.
const resolveAssignmentSection = async (classId, sectionId) => {
  if (!mongoose.isValidObjectId(classId)) throw new AppError('Choose a class.', 400);
  const sections = await Section.find({ class: classId }).select('_id').lean();
  if (!sections.length) return null;
  if (!sectionId) throw new AppError('This class has sections. Choose the section the teacher teaches.', 400);
  if (!sections.some((s) => String(s._id) === String(sectionId))) throw new AppError("That section isn't in this class.", 400);
  return sectionId;
};

export const addAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subjectId, classId, termId } = req.body;
    const timetableSlots = req.body.timetableSlots ?? [];
    const sectionId = await resolveAssignmentSection(classId, req.body.sectionId || null);

    const teacher = await Teacher.findById(id);
    if (!teacher) return next(new AppError('Teacher not found', 404));

    await assertSubjectInClass(subjectId, classId);
    await validateSlots(timetableSlots, termId);

    // The teacher already teaches this subject to this class this term (e.g. a
    // second Maths lesson added from the timetable grid): add the new lessons
    // to that assignment instead of refusing a "duplicate".
    const existing = await TeacherAssignment.findOne({ teacherId: teacher._id, subjectId, classId, sectionId, termId });
    if (existing) {
      const key = (s) => `${s.day}|${s.periodId}`;
      const known = new Set(existing.timetableSlots.map(key));
      const merged = [
        ...existing.timetableSlots.map((s) => ({ day: s.day, periodId: s.periodId })),
        ...(timetableSlots ?? []).filter((s) => !known.has(key(s))),
      ];
      await assertNoAssignmentConflict(
        { teacherId: teacher._id, classId, sectionId, subjectId, termId },
        merged,
        existing._id
      );
      existing.timetableSlots = merged;
      await existing.save();
      const populated = await populateAssignment(TeacherAssignment.findById(existing._id));
      return res.status(200).json(new ApiResponse(200, populated, 'Lessons added to this teacher\'s existing class'));
    }

    await assertNoAssignmentConflict(
      { teacherId: teacher._id, classId, sectionId, subjectId, termId },
      timetableSlots
    );

    const assignment = await TeacherAssignment.create({
      teacherId: teacher._id,
      subjectId,
      classId,
      sectionId,
      termId,
      timetableSlots,
    });

    const populatedAssignment = await populateAssignment(TeacherAssignment.findById(assignment._id));

    res.status(201).json(new ApiResponse(201, populatedAssignment, 'Assignment added successfully'));
  } catch (error) {
    if (error.code === 11000) {
      console.error('Duplicate TeacherAssignment key:', error.keyValue);
      return next(new AppError('Duplicate assignment: This teacher is already assigned to this subject, class, and section for this term.', 400));
    }
    next(error);
  }
};

const assignmentKey = (subjectId, classId, sectionId) => `${subjectId}|${classId}|${sectionId ?? ''}`;

// PUT /api/teachers/:id/assignments/bulk   { termId, items: [{ classId, sectionId, subjectId }] }
// The tick-box grid: `items` is everything the teacher should teach in this term.
// What is new is added with no lessons yet (they are set from the single
// assignment form or the timetable), under the same rules as addAssignment;
// what is left out is removed, with its lessons; the rest stays as it is.
export const saveAssignments = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { termId, items } = req.body;
    if (!mongoose.isValidObjectId(termId)) throw new AppError('Choose a term.', 400);
    if (!Array.isArray(items)) throw new AppError('Send the list of classes and subjects.', 400);
    if (items.some((item) => !mongoose.isValidObjectId(item?.subjectId) || !mongoose.isValidObjectId(item?.classId))) {
      throw new AppError('Each tick needs a class and a subject.', 400);
    }

    const [teacher, term, existing] = await Promise.all([
      Teacher.findById(req.params.id),
      Term.exists({ _id: termId }),
      TeacherAssignment.find({ teacherId: req.params.id, termId }).lean(),
    ]);
    if (!teacher) throw new AppError('Teacher not found', 404);
    if (!term) throw new AppError('That term no longer exists.', 400);

    const existingByKey = new Map(existing.map((a) => [assignmentKey(a.subjectId, a.classId, a.sectionId), a]));
    const keep = new Set();
    const toAdd = new Map();
    for (const { subjectId, classId, sectionId } of items) {
      // Boxes already saved stay, even if the class or subject has changed since.
      const key = assignmentKey(subjectId, classId, sectionId || null);
      if (existingByKey.has(key)) { keep.add(key); continue; }

      const resolvedSection = await resolveAssignmentSection(classId, sectionId || null);
      const resolvedKey = assignmentKey(subjectId, classId, resolvedSection);
      if (existingByKey.has(resolvedKey)) { keep.add(resolvedKey); continue; }
      if (toAdd.has(resolvedKey)) continue;

      const [subject, cls] = await Promise.all([Subject.exists({ _id: subjectId }), Class.exists({ _id: classId })]);
      if (!subject || !cls) throw new AppError('One of the classes or subjects no longer exists.', 400);
      await assertSubjectInClass(subjectId, classId);
      toAdd.set(resolvedKey, { teacherId: teacher._id, subjectId, classId, sectionId: resolvedSection, termId, timetableSlots: [] });
    }
    const toRemove = existing.filter((a) => !keep.has(assignmentKey(a.subjectId, a.classId, a.sectionId)));

    await withTransaction(session, async () => {
      if (toRemove.length) await TeacherAssignment.deleteMany({ _id: { $in: toRemove.map((a) => a._id) } }).session(session);
      if (toAdd.size) await TeacherAssignment.create([...toAdd.values()], { session, ordered: true });
    });

    const assignments = await populateAssignment(TeacherAssignment.find({ teacherId: teacher._id }));
    res.status(200).json(new ApiResponse(200, {
      added: toAdd.size,
      removed: toRemove.length,
      kept: keep.size,
      lessonsRemoved: toRemove.reduce((sum, a) => sum + (a.timetableSlots?.length ?? 0), 0),
      assignments,
    }, 'Classes and subjects saved'));
  } catch (error) {
    if (error.code === 11000) return next(new AppError('These classes changed while you were ticking. Open the list again and save.', 409));
    next(error);
  } finally {
    session.endSession();
  }
};

export const updateAssignment = async (req, res, next) => {
  try {
    const { id, assignmentId } = req.params;
    const { subjectId, classId, termId, timetableSlots } = req.body;

    const assignment = await TeacherAssignment.findOne({ _id: assignmentId, teacherId: id });
    if (!assignment) return next(new AppError('Assignment not found', 404));
    const sectionId = classId !== undefined || req.body.sectionId !== undefined
      ? await resolveAssignmentSection(classId ?? assignment.classId, req.body.sectionId || null)
      : undefined;

    // Moving an assignment to another class or term can create a clash even when
    // the slots themselves are untouched, so re-check whenever any part of
    // (class, section, subject, term, slots) changes — against the merged values.
    const effective = {
      classId: classId !== undefined ? classId : assignment.classId,
      sectionId: sectionId !== undefined ? sectionId : assignment.sectionId,
      subjectId: subjectId !== undefined ? subjectId : assignment.subjectId,
      termId: termId !== undefined ? termId : assignment.termId,
      timetableSlots: timetableSlots !== undefined ? timetableSlots : assignment.timetableSlots,
    };

    const touchesSchedule = [subjectId, classId, sectionId, termId, timetableSlots].some(
      (value) => value !== undefined
    );

    if (subjectId !== undefined || classId !== undefined) {
      await assertSubjectInClass(effective.subjectId, effective.classId);
    }

    if (touchesSchedule) {
      if (timetableSlots !== undefined) {
        await validateSlots(effective.timetableSlots, effective.termId);
      }
      await assertNoAssignmentConflict(
        { ...effective, teacherId: id },
        effective.timetableSlots,
        assignmentId
      );
    }

    if (subjectId !== undefined) assignment.subjectId = subjectId;
    if (classId !== undefined) assignment.classId = classId;
    if (sectionId !== undefined) assignment.sectionId = sectionId;
    if (termId !== undefined) assignment.termId = termId;
    if (timetableSlots !== undefined) assignment.timetableSlots = timetableSlots;

    await assignment.save();

    const populatedAssignment = await populateAssignment(TeacherAssignment.findById(assignment._id));

    res.status(200).json(new ApiResponse(200, populatedAssignment, 'Assignment updated successfully'));
  } catch (error) {
    if (error.code === 11000) {
      console.error('Duplicate TeacherAssignment key:', error.keyValue);
      return next(new AppError('Duplicate assignment: This teacher is already assigned to this subject, class, and section for this term.', 400));
    }
    next(error);
  }
};

export const removeAssignment = async (req, res, next) => {
  try {
    const { id, assignmentId } = req.params;

    const assignment = await TeacherAssignment.findOneAndDelete({ _id: assignmentId, teacherId: id });
    if (!assignment) return next(new AppError('Assignment not found', 404));

    res.status(200).json(new ApiResponse(200, null, 'Assignment removed successfully'));
  } catch (error) {
    next(error);
  }
};

export const getTimetable = async (req, res, next) => {
  try {
    let teacherId = req.params.id;

    // '/me' lets a logged-in teacher fetch their own timetable without needing
    // to already know their own Teacher document id.
    if (teacherId === 'me') {
      const ownTeacher = await Teacher.findOne({ userId: req.user._id });
      if (!ownTeacher) return next(new AppError('No teacher profile is linked to this account.', 400));
      teacherId = ownTeacher._id.toString();
    } else if (req.user.role === 'teacher') {
      const ownTeacher = await Teacher.findOne({ userId: req.user._id });
      if (!ownTeacher || ownTeacher._id.toString() !== teacherId) {
        return next(new AppError('You do not have access to this timetable.', 403));
      }
    }

    // Same shape as getTeacher()'s `assignments` and addAssignment()'s response,
    // so the client can use one TeacherAssignment type everywhere.
    const assignments = await populateAssignment(TeacherAssignment.find({ teacherId }));

    res.status(200).json(new ApiResponse(200, assignments, 'Teacher timetable retrieved'));
  } catch (error) {
    next(error);
  }
};

// GET /api/teacher-assignments — every assignment across every teacher, with
// the teacher's own name attached. Used to resolve "who teaches this
// class/subject/section/term" from the outside (e.g. the timetable view),
// as opposed to the teacher-scoped lookups above.
export const listAssignments = async (req, res, next) => {
  try {
    const assignments = await populateAssignment(
      TeacherAssignment.find().populate({
        path: 'teacherId',
        select: 'userId',
        populate: { path: 'userId', select: 'firstName lastName' },
      })
    );

    res.status(200).json(new ApiResponse(200, assignments, 'Assignments retrieved'));
  } catch (error) {
    next(error);
  }
};
