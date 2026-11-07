// Admin user & role management — the administrative half of the auth API.
// Lets an admin list users, change a user's role, and activate/deactivate an
// account. Deactivation (status: false) is enforced by the authenticate
// middleware and the login handler, so it takes effect immediately.
import mongoose from 'mongoose';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Guardian from '../models/Guardian.js';
import Family from '../models/Family.js';
import Student from '../models/Student.js';
import AppError from '../utils/AppError.js';
import ApiResponse from '../utils/ApiResponse.js';
import { generatePassword } from '../utils/generatePassword.js';
import { roleExists } from '../services/accessRoleService.js';
import AccessRole from '../models/AccessRole.js';
import { SYSTEM_ROLES } from '../config/access.js';
import { pageParams, searchRegex } from '../utils/query.js';
import { transactionsSupported, withTransaction } from '../utils/transaction.js';
import { normalizeImportPhone } from '../services/studentService.js';
import { generateStaffIds } from './teacherController.js';

const UNKNOWN_ROLE = 'That role does not exist. Pick a built-in role or one made on the Roles page.';

// Teachers, students and parents get their login from their own page, which
// also creates the profile the login needs, or from Add Many Users (below).
// Single logins made here: office staff and custom roles.
const PROFILE_ROLES = ['teacher', 'student', 'parent'];
const PROFILE_ROLE_MESSAGE = 'Teacher, student and parent logins are created from the Teachers, Students and Parents pages.';

const checkAssignableRole = async (role) => {
  if (PROFILE_ROLES.includes(role)) return PROFILE_ROLE_MESSAGE;
  if (!(await roleExists(role))) return UNKNOWN_ROLE;
  return null;
};

// The school must always keep at least one active admin.
const isLastActiveAdmin = async (user) => user.role === 'admin' && user.status !== false
  && (await User.countDocuments({ role: 'admin', status: { $ne: false } })) <= 1;

const SAFE_FIELDS = '-password -passwordResetToken -passwordResetExpires';

// POST /api/users — direct account creation for roles that have no dedicated
// profile-creation flow of their own (principal, accountant,
// academic_officer, admin). Teacher/Student/Parent already create their User
// row as part of their own richer creation flows (createTeacher, etc.).
export const createUser = async (req, res, next) => {
  try {
    const { firstName, lastName, email, role, password } = req.body;
    const roleProblem = await checkAssignableRole(role);
    if (roleProblem) return next(new AppError(roleProblem, 400));

    const existing = await User.findOne({ email });
    if (existing) return next(new AppError('Email already in use', 400));

    const temporaryPassword = password || generatePassword();

    // The person picks their own password the first time they sign in.
    const user = await User.create({ firstName, lastName, email, password: temporaryPassword, role, mustChangePassword: true, createBy: req.user._id });

    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(201).json(new ApiResponse(201, { user: userResponse, temporaryPassword }, 'User created successfully'));
  } catch (error) {
    next(error);
  }
};

// Rows for bulk creation may name a role by its key ("academic_officer") or by
// its name as staff see it ("Academic officer", or a custom role's name).
const normaliseRoleText = (text) => String(text ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

const roleLookup = async () => {
  const lookup = new Map();
  for (const key of SYSTEM_ROLES) {
    lookup.set(normaliseRoleText(key), key);
  }
  for (const role of await AccessRole.find().select('key name').lean()) {
    lookup.set(normaliseRoleText(role.key), role.key);
    lookup.set(normaliseRoleText(role.name), role.key);
  }
  return lookup;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sameText = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const MIN_PHONE_LENGTH = 7;

// A bulk teacher row: a new teacher profile. The fifth column is their phone.
const planTeacherRow = (r) => {
  r.phone = normalizeImportPhone(r.extra);
  return r.phone && r.phone.length < MIN_PHONE_LENGTH ? [`Phone "${r.extra}" is too short.`] : [];
};

// A bulk parent row: a registered parent without a login who matches by email
// or phone gets this login. Anyone else is a new parent, who needs a phone.
const planParentRow = (r, { guardians, usedLogins, rowForGuardian, rowForNewPhone }) => {
  const phone = normalizeImportPhone(r.extra);
  if (phone && phone.length < MIN_PHONE_LENGTH) return [`Phone "${r.extra}" is too short.`];

  const matches = guardians.filter((g) => sameText(g.email) === r.email || (phone && normalizeImportPhone(g.phone) === phone));
  const withoutLogin = matches.filter((g) => !usedLogins.has(String(g.userId)));
  if (withoutLogin.length > 1) {
    return [`This email or phone matches more than one parent (${withoutLogin.map((g) => g.name).join(', ')}). Give the login from the Parents page.`];
  }
  if (withoutLogin.length === 1) {
    const [guardian] = withoutLogin;
    const firstRow = rowForGuardian.get(String(guardian._id));
    if (firstRow) return [`Row ${firstRow} is already for this parent (${guardian.name}).`];
    rowForGuardian.set(String(guardian._id), r.row);
    r.guardian = guardian;
    return [];
  }
  if (matches.length) return [`${matches[0].name} already has a login. If it is lost, reset its password.`];

  if (!phone) return ['A new parent needs a phone. Add it as a fifth column.'];
  if (rowForNewPhone.has(phone)) return [`This phone is also on row ${rowForNewPhone.get(phone)}.`];
  rowForNewPhone.set(phone, r.row);
  r.phone = phone;
  return [];
};

// A bulk student row: a student needs a class, a date of birth and more, so a
// login can only be linked to a registered student: by the fifth column
// (admission number), else by name when that finds exactly one without a login.
const planStudentRow = (r, { students, rowForStudent }) => {
  const admission = sameText(r.extra);
  const fullName = sameText(`${r.firstName} ${r.lastName}`);
  const matches = admission
    ? students.filter((s) => sameText(s.admissionNumber) === admission)
    : students.filter((s) => sameText(`${s.firstName} ${s.lastName}`) === fullName);
  if (admission && !matches.length) return [`No student has admission number ${r.extra}. Register this student first, or check the number.`];

  const withoutLogin = matches.filter((s) => !s.userId);
  if (withoutLogin.length > 1) return [`${withoutLogin.length} students have this name. Add the admission number as a fifth column.`];
  if (!withoutLogin.length) {
    return [matches.length ? 'This student already has a login.' : 'Register this student first, or add their admission number as a fifth column.'];
  }
  const [student] = withoutLogin;
  const firstRow = rowForStudent.get(String(student._id));
  if (firstRow) return [`Row ${firstRow} is already for this student.`];
  rowForStudent.set(String(student._id), r.row);
  r.student = student;
  return [];
};

// What the row plans above need to look at, loaded once for the whole list.
const loadRowContext = async (roles) => {
  const context = { rowForGuardian: new Map(), rowForNewPhone: new Map(), rowForStudent: new Map() };
  if (roles.has('parent')) {
    context.guardians = await Guardian.find().select('name email phone userId').lean();
    const userIds = context.guardians.map((g) => g.userId).filter(Boolean);
    context.usedLogins = new Set((await User.find({ _id: { $in: userIds } }).select('_id').lean()).map((u) => String(u._id)));
  }
  if (roles.has('student')) {
    context.students = await Student.find({ isDeleted: false }).select('firstName lastName admissionNumber userId').lean();
  }
  return context;
};

const ROW_PLANS = { teacher: planTeacherRow, parent: planParentRow, student: planStudentRow };

// The profile a new login belongs to. `undo` collects how to take each write
// back, for a database without transactions. Returns a note for the results list.
const attachProfile = async (r, user, { session, staffIds, undo }) => {
  const name = `${r.firstName} ${r.lastName}`;
  if (r.role === 'teacher') {
    const staffId = staffIds.shift();
    const [teacher] = await Teacher.create([{ userId: user._id, staffId, phone: r.phone || undefined, status: 'Active' }], { session });
    undo.push(() => Teacher.deleteOne({ _id: teacher._id }));
    return `Staff ID ${staffId}`;
  }
  if (r.role === 'student') {
    await Student.updateOne({ _id: r.student._id }, { $set: { userId: user._id } }, { session });
    undo.push(() => Student.updateOne({ _id: r.student._id }, { $set: { userId: null } }));
    return `Linked to ${r.student.firstName} ${r.student.lastName} (${r.student.admissionNumber})`;
  }
  if (r.role === 'parent' && r.guardian) {
    const { _id, userId, email, name: guardianName } = r.guardian;
    await Guardian.updateOne({ _id }, { $set: { userId: user._id, ...(!email && { email: r.email }) } }, { session });
    undo.push(() => Guardian.updateOne({ _id }, { $set: { userId: userId ?? null }, ...(!email && { $unset: { email: 1 } }) }));
    return `Linked to registered parent ${guardianName}`;
  }
  if (r.role === 'parent') {
    const [family] = await Family.create([{ familyName: `${name} Family`, primaryContactPhone: r.phone, primaryContactEmail: r.email }], { session });
    undo.push(() => Family.deleteOne({ _id: family._id }));
    const [guardian] = await Guardian.create([{
      familyId: family._id, userId: user._id, name, relationship: 'Guardian', phone: r.phone, email: r.email, isPrimary: true,
    }], { session });
    undo.push(() => Guardian.deleteOne({ _id: guardian._id }));
    return 'New parent added';
  }
  return '';
};

// POST /api/users/bulk   body: { users: [{ firstName, lastName, email, role, extra }] }
// Many logins at once. Every row is checked first; if any row has a problem
// nothing is created and each problem is reported against its row (rows count
// from 1, as on the screen). Otherwise every login is created with its own
// temporary password, which is returned once, here. Teachers also get a teacher
// profile; parents and students are linked to their registered record (a parent
// not yet registered is added). `extra` is the optional fifth column: a phone
// for a teacher or parent, an admission number for a student.
export const bulkCreateUsers = async (req, res, next) => {
  try {
    const rows = req.body.users;
    const lookup = await roleLookup();

    const cleaned = rows.map((raw, index) => ({
      row: index + 1,
      firstName: String(raw.firstName ?? '').trim(),
      lastName: String(raw.lastName ?? '').trim(),
      email: String(raw.email ?? '').trim().toLowerCase(),
      roleText: String(raw.role ?? '').trim(),
      extra: String(raw.extra ?? '').trim(),
    }));
    for (const r of cleaned) r.role = lookup.get(normaliseRoleText(r.roleText));
    const rowContext = await loadRowContext(new Set(cleaned.map((r) => r.role)));

    // Emails already used by another login.
    const taken = new Set((await User.find({ email: { $in: cleaned.map((r) => r.email).filter(Boolean) } })
      .select('email').lean()).map((u) => u.email));
    const seen = new Map();

    const problems = [];
    for (const r of cleaned) {
      const rowProblems = [];
      if (!r.firstName) rowProblems.push('First name is missing.');
      if (!r.lastName) rowProblems.push('Last name is missing.');
      if (!r.email) rowProblems.push('Email is missing.');
      else if (!EMAIL_PATTERN.test(r.email)) rowProblems.push('Email is not a valid address.');
      else if (seen.has(r.email)) rowProblems.push(`This email is also on row ${seen.get(r.email)}.`);
      else if (taken.has(r.email)) rowProblems.push('This email is already used by another login.');
      if (r.email && !seen.has(r.email)) seen.set(r.email, r.row);

      if (!r.roleText) rowProblems.push('Role is missing.');
      else if (!r.role) rowProblems.push(`"${r.roleText}" is not a role. Use a built-in role or one made on the Roles page.`);
      else if (r.extra && !ROW_PLANS[r.role]) rowProblems.push('Only teacher, parent and student lines use a fifth column.');

      // The profile is looked at once the row itself is right.
      if (!rowProblems.length && ROW_PLANS[r.role]) rowProblems.push(...ROW_PLANS[r.role](r, rowContext));

      if (rowProblems.length) problems.push({ row: r.row, email: r.email, problems: rowProblems });
    }

    if (problems.length) {
      return res.status(400).json({
        success: false,
        message: `Nothing was created. ${problems.length} of ${cleaned.length} row${cleaned.length === 1 ? ' has' : 's have'} a problem — fix ${problems.length === 1 ? 'it' : 'them'} and try again.`,
        problems,
      });
    }

    const created = cleaned.map((r) => ({ ...r, temporaryPassword: generatePassword() }));
    // create() (not insertMany) so the save hook hashes every password. All
    // rows go in one transaction where the database supports it; where it
    // doesn't, a failure halfway is taken back by hand, so it stays all or nothing.
    const session = await mongoose.startSession();
    const users = [];
    const undo = [];
    try {
      await withTransaction(session, async () => {
        users.length = 0;
        undo.length = 0;
        const staffIds = await generateStaffIds(created.filter((r) => r.role === 'teacher').length, session);
        for (const r of created) {
          const [user] = await User.create([{
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            password: r.temporaryPassword,
            role: r.role,
            mustChangePassword: true,
            createBy: req.user._id,
          }], { session });
          undo.push(() => User.deleteOne({ _id: user._id }));
          users.push(user);
          r.detail = await attachProfile(r, user, { session, staffIds, undo });
        }
      }).catch(async (error) => {
        if (!(await transactionsSupported())) {
          for (const takeBack of undo.reverse()) await takeBack().catch(() => {});
        }
        throw error;
      });
    } finally {
      await session.endSession();
    }

    return res.status(201).json(new ApiResponse(201, {
      count: users.length,
      users: created.map((r, i) => ({
        row: r.row,
        _id: users[i]._id,
        email: r.email,
        name: users[i].name,
        role: r.role,
        detail: r.detail,
        temporaryPassword: r.temporaryPassword,
      })),
    }, `${users.length} user${users.length === 1 ? '' : 's'} created`));
  } catch (error) {
    next(error);
  }
};

// GET /api/users?role=&status=&search=&page=&limit=
export const listUsers = async (req, res, next) => {
  try {
    const { role, status, search } = req.query;
    const { page, limit, skip } = pageParams(req.query, { defaultLimit: 20, maxLimit: 200 });
    const filter = {};
    if (typeof role === 'string' && role) filter.role = role;
    if (status !== undefined) filter.status = status === 'true';
    const regex = searchRegex(search);
    if (regex) filter.$or = [{ firstName: regex }, { lastName: regex }, { email: regex }];

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).select(SAFE_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(Number(limit))
    ]);

    return res.status(200).json(new ApiResponse(200, {
      total,
      page: Number(page),
      limit: Number(limit),
      users
    }, 'Users retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// GET /api/users/:id
export const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select(SAFE_FIELDS);
    if (!user) return next(new AppError('User not found', 404));
    return res.status(200).json(new ApiResponse(200, user, 'User retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// PATCH /api/users/:id/role   body: { role }
export const updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const roleProblem = await checkAssignableRole(role);
    if (roleProblem) return next(new AppError(roleProblem, 400));
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));
    if (PROFILE_ROLES.includes(user.role)) {
      return next(new AppError(`This is a ${user.role} login. Change it from the ${user.role === 'teacher' ? 'Teachers' : user.role === 'student' ? 'Students' : 'Parents'} page.`, 400));
    }
    if (role !== 'admin' && await isLastActiveAdmin(user)) {
      return next(new AppError('This is the only active admin. Make someone else an admin first.', 400));
    }

    user.role = role;
    await user.save();

    return res.status(200).json(new ApiResponse(200, {
      id: user._id, email: user.email, role: user.role
    }, 'User role updated successfully'));
  } catch (error) {
    next(error);
  }
};

// PATCH /api/users/:id/status   body: { status }
export const updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    // An admin must not lock themselves out of their own account.
    if (req.params.id === req.user.id.toString() && status === false) {
      return next(new AppError('You cannot deactivate your own account.', 400));
    }

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));
    if (status === false && await isLastActiveAdmin(user)) {
      return next(new AppError('This is the only active admin. Make someone else an admin first.', 400));
    }

    user.status = status;
    // A deactivated account is signed out everywhere.
    if (status === false) user.refreshTokens = [];
    await user.save();

    return res.status(200).json(new ApiResponse(200, {
      id: user._id, email: user.email, status: user.status
    }, `User ${status ? 'activated' : 'deactivated'} successfully`));
  } catch (error) {
    next(error);
  }
};

// POST /api/users/:id/reset-password — sets a new temporary password, shown to
// the admin once, and signs the user out everywhere. This is how a forgotten
// password is fixed (the app sends no email).
export const resetUserPassword = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));

    const temporaryPassword = generatePassword();
    user.password = temporaryPassword;
    user.mustChangePassword = true;
    user.refreshTokens = [];
    await user.save();

    return res.status(200).json(new ApiResponse(200, { email: user.email, temporaryPassword }, 'Password reset'));
  } catch (error) {
    next(error);
  }
};
