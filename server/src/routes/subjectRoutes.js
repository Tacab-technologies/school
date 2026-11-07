import express from 'express';
import { createSubject, getSubjects, getSubjectById, updateSubject, deleteSubject, setClassSubjects } from '../controllers/subjectController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { createSubjectSchema, updateSubjectSchema, setClassSubjectsSchema } from '../validators/subjectValidator.js';

const router = express.Router();
const editors = authorize('admin', 'principal', 'academic_officer');

router.route('/')
  .post(authenticate, editors, validate(createSubjectSchema), createSubject)
  .get(authenticate, getSubjects);

// Set exactly which subjects a class takes.
router.put('/class/:classId', authenticate, editors, validate(setClassSubjectsSchema), setClassSubjects);

router.route('/:id')
  .get(authenticate, getSubjectById)
  .put(authenticate, editors, validate(updateSubjectSchema), updateSubject)
  .delete(authenticate, editors, deleteSubject);

export default router;
