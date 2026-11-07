import Year, { yearNameKey } from '../models/Year.js';
import AppError from '../utils/AppError.js';
import ApiResponse from '../utils/ApiResponse.js';
import { resolveCurrentYearId } from '../utils/currentYear.js';
import { assertNotInUse } from '../utils/inUse.js';

// The academic year whose Term is currently marked active (same resolution
// studentService.js already uses to default a new student's enrollment
// year) — lets clients pick "the actually active year" instead of
// arbitrarily defaulting to whichever year happens to sort first.
export const getCurrentYear = async (req, res, next) => {
  try {
    const yearId = await resolveCurrentYearId();
    const year = yearId ? await Year.findById(yearId) : null;
    res.status(200).json(new ApiResponse(200, year, year ? 'Current year retrieved successfully' : 'No active term/year found'));
  } catch (error) {
    next(error);
  }
};

const yearNameTaken = (name) => new AppError(`The school year "${name}" already exists. Each school year can only be added once.`, 409);
const yearCodeTaken = (code) => new AppError(`The year code "${code}" is already used by another school year.`, 409);

// Only the fields a year has, trimmed. A field left out stays as it is on an edit.
const yearFields = (body) => {
  const fields = {};
  for (const key of ['y_no', 'y_name']) {
    if (body[key] === undefined) continue;
    fields[key] = String(body[key]).trim();
    if (!fields[key]) throw new AppError(key === 'y_no' ? 'Enter the year code.' : 'Enter the year name.', 400);
  }
  return fields;
};

// Compared here as well as by the indexes: the old rows have no nameKey, and
// codes must not differ only by capital letters.
const assertYearIsNew = async ({ y_no, y_name }, ownId = null) => {
  const others = await Year.find(ownId ? { _id: { $ne: ownId } } : {}).select('y_no y_name').lean();
  if (y_name && others.some((other) => yearNameKey(other.y_name) === yearNameKey(y_name))) throw yearNameTaken(y_name);
  if (y_no && others.some((other) => other.y_no.trim().toLowerCase() === y_no.toLowerCase())) throw yearCodeTaken(y_no);
};

// The same check losing a race: the database refused the second of two requests.
const duplicateYearError = (error, fields) => (error.keyPattern?.y_no ? yearCodeTaken(fields.y_no) : yearNameTaken(fields.y_name));

export const createYear = async (req, res, next) => {
  let fields = {};
  try {
    fields = yearFields(req.body);
    await assertYearIsNew(fields);
    const year = await Year.create({ ...fields, nameKey: yearNameKey(fields.y_name) });
    res.status(201).json(new ApiResponse(201, year, 'Year created successfully'));
  } catch (error) {
    if (error.code === 11000) return next(duplicateYearError(error, fields));
    next(error);
  }
};

export const getYears = async (req, res, next) => {
  try {
    const years = await Year.find();
    res.status(200).json(new ApiResponse(200, years, 'Years retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

export const getYearById = async (req, res, next) => {
  try {
    const year = await Year.findById(req.params.id);
    if (!year) return next(new AppError('Year not found', 404));
    res.status(200).json(new ApiResponse(200, year, 'Year retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

export const updateYear = async (req, res, next) => {
  let fields = {};
  try {
    const year = await Year.findById(req.params.id);
    if (!year) return next(new AppError('Year not found', 404));
    fields = yearFields(req.body);

    // Only a real change is checked, so a year that already has a duplicate
    // from before this rule can still be edited in other ways.
    const newName = fields.y_name !== undefined && yearNameKey(fields.y_name) !== yearNameKey(year.y_name);
    const newCode = fields.y_no !== undefined && fields.y_no.toLowerCase() !== year.y_no.trim().toLowerCase();
    await assertYearIsNew({ y_no: newCode ? fields.y_no : null, y_name: newName ? fields.y_name : null }, year._id);

    year.set(fields);
    if (newName) year.nameKey = yearNameKey(fields.y_name);
    await year.save();
    res.status(200).json(new ApiResponse(200, year, 'Year updated successfully'));
  } catch (error) {
    if (error.code === 11000) return next(duplicateYearError(error, fields));
    next(error);
  }
};

export const deleteYear = async (req, res, next) => {
  try {
    await assertNotInUse('year', req.params.id);
    const year = await Year.findByIdAndDelete(req.params.id);
    if (!year) return next(new AppError('Year not found', 404));
    res.status(200).json(new ApiResponse(200, null, 'Year deleted successfully'));
  } catch (error) {
    next(error);
  }
};
