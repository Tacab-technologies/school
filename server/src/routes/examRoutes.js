import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import {
  listExams, createExam, updateExam, deleteExam, setPublished,
  markingOptions, getMarksheet, saveMarks, getClassResults, getReportCard,
  teachingClasses, getMarkingProgress,
  submitSheet, requestSheetEdit, reopenSheet, listHolds, setHolds, listEditRequests, decideEditRequest,
} from '../controllers/examController.js';

const router = express.Router();
router.use(authenticate);

// Who does what: the academic office sets exams up and publishes them;
// teachers enter marks for their own lessons; the principal reads results.
const manage = authorize('admin', 'academic_officer');
const mark = authorize('admin', 'academic_officer', 'teacher');
const read = authorize('admin', 'principal', 'academic_officer', 'teacher');

router.get('/results', read, getClassResults);
router.get('/teaching', read, teachingClasses);
router.get('/report-card/:studentId', read, getReportCard);
// Teachers save drafts and submit; changing a submitted sheet needs the office's permission.
router.get('/edit-requests', manage, listEditRequests);
router.patch('/edit-requests/:sheetId', manage, decideEditRequest);

router.route('/')
  .get(read, listExams)
  .post(manage, createExam);
router.route('/:id')
  .put(manage, updateExam)
  .delete(manage, deleteExam);
router.patch('/:id/publish', manage, setPublished);
router.get('/:id/options', read, markingOptions);
router.get('/:id/marksheet', read, getMarksheet);
router.get('/:id/progress', read, getMarkingProgress);
router.put('/:id/marks', mark, saveMarks);
router.post('/:id/sheet/submit', mark, submitSheet);
router.post('/:id/sheet/request-edit', authorize('teacher'), requestSheetEdit);
router.post('/:id/sheet/reopen', manage, reopenSheet);
// The office can hide some students' results (unpaid fees, discipline), before or after publishing.
router.get('/:id/holds', manage, listHolds);
router.put('/:id/holds', manage, setHolds);

export default router;
