const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/examController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const upload = requireCoreModule('MVC/middleware/upload');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess, requireAccessAny } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('./schoolRouteDependencies');

const TPL = SECTIONS.SCHOOL_EXAMS_TEMPLATE;
const ALLOC = SECTIONS.SCHOOL_EXAMS_ALLOCATION;
const TAKE = SECTIONS.SCHOOL_EXAMS_TAKING;
const REV = SECTIONS.SCHOOL_EXAMS_REVIEW;

/** Exam hub: any leaf section with list/read access */
const ANY_EXAM_READ = [TPL, ALLOC, TAKE, REV];

router.use(requireAuth);

router.get('/',
  requireAccessAny(ANY_EXAM_READ, OPERATIONS.READ_ALL),
  trackActionState(TPL, OPERATIONS.READ_ALL),
  ctrl.showHome);

router.get('/templates',
  requireAccess(TPL, OPERATIONS.READ_ALL),
  trackActionState(TPL, OPERATIONS.READ_ALL),
  ctrl.listTemplates);

router.get('/api/subjects-by-department',
  requireAccess(TPL, OPERATIONS.READ_ALL),
  trackActionState(TPL, OPERATIONS.READ_ALL),
  ctrl.listTemplateSubjectsByDepartment);

router.get('/api/published-allocation-templates',
  requireAccess(ALLOC, OPERATIONS.READ_ALL),
  trackActionState(ALLOC, OPERATIONS.READ_ALL),
  ctrl.listPublishedAllocationTemplates);

router.get('/api/eligible-allocation-classes',
  requireAccess(ALLOC, OPERATIONS.READ_ALL),
  trackActionState(ALLOC, OPERATIONS.READ_ALL),
  ctrl.listEligibleAllocationClasses);

router.get('/api/class-scheduled-sessions',
  requireAccess(ALLOC, OPERATIONS.READ_ALL),
  trackActionState(ALLOC, OPERATIONS.READ_ALL),
  ctrl.listClassScheduledSessions);

router.get('/api/allocation-class-students',
  requireAccess(ALLOC, OPERATIONS.READ_ALL),
  trackActionState(ALLOC, OPERATIONS.READ_ALL),
  ctrl.listAllocationClassStudents);

router.get('/api/eligible-take-student-persons',
  requireAccess(TAKE, OPERATIONS.READ_ALL),
  trackActionState(TAKE, OPERATIONS.READ_ALL),
  ctrl.listEligibleTakeStudentPersons);

router.post('/api/upload-question-media',
  requireAccess(TPL, OPERATIONS.UPDATE),
  upload('school-exams', true).array('files', 10),
  trackActionState(TPL, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.uploadQuestionMedia);

router.get('/templates/new',
  requireAccess(TPL, OPERATIONS.CREATE),
  trackActionState(TPL, OPERATIONS.CREATE),
  ctrl.showTemplateForm);

router.post('/templates/new',
  requireAccess(TPL, OPERATIONS.CREATE),
  trackActionState(TPL, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTemplate);

router.get('/templates/edit/:templateId',
  requireAccess(TPL, OPERATIONS.UPDATE),
  trackActionState(TPL, OPERATIONS.UPDATE),
  ctrl.showTemplateForm);

router.post('/templates/edit/:templateId',
  requireAccess(TPL, OPERATIONS.UPDATE),
  trackActionState(TPL, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTemplate);

router.get('/templates/:templateId',
  requireAccess(TPL, OPERATIONS.READ),
  trackActionState(TPL, OPERATIONS.READ),
  ctrl.viewTemplate);

router.post('/templates/:templateId/publish',
  requireAccess(TPL, OPERATIONS.UPDATE),
  trackActionState(TPL, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.publishRevision);

router.post('/templates/:templateId/questions/new',
  requireAccess(TPL, OPERATIONS.CREATE),
  upload('school-exams', true).array('mediaFiles', 8),
  trackActionState(TPL, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveQuestion);

router.post('/templates/:templateId/questions/:questionId/edit',
  requireAccess(TPL, OPERATIONS.UPDATE),
  upload('school-exams', true).array('mediaFiles', 8),
  trackActionState(TPL, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveQuestion);

router.post('/templates/:templateId/questions/:questionId/delete',
  requireAccess(TPL, OPERATIONS.DELETE),
  trackActionState(TPL, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteQuestion);

router.post('/templates/:templateId/questions/reorder',
  requireAccess(TPL, OPERATIONS.UPDATE),
  trackActionState(TPL, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.reorderQuestions);

router.get('/templates/:templateId/allocate',
  requireAccess(ALLOC, OPERATIONS.CREATE),
  trackActionState(ALLOC, OPERATIONS.CREATE),
  ctrl.showAllocationForm);

router.post('/templates/:templateId/allocate',
  requireAccess(ALLOC, OPERATIONS.CREATE),
  trackActionState(ALLOC, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveAllocation);

router.post('/templates/:templateId/revisions/create-copy',
  requireAccess(TPL, OPERATIONS.CREATE),
  trackActionState(TPL, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.createTemplateRevisionCopy);

router.get('/allocations',
  requireAccess(ALLOC, OPERATIONS.READ_ALL),
  trackActionState(ALLOC, OPERATIONS.READ_ALL),
  ctrl.listAllocations);

router.get('/allocations/new',
  requireAccess(ALLOC, OPERATIONS.CREATE),
  trackActionState(ALLOC, OPERATIONS.CREATE),
  ctrl.showAllocationForm);

router.post('/allocations/new',
  requireAccess(ALLOC, OPERATIONS.CREATE),
  trackActionState(ALLOC, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveAllocation);

router.get('/allocations/:allocationId/simulate',
  requireAccess(ALLOC, OPERATIONS.READ),
  trackActionState(ALLOC, OPERATIONS.READ),
  ctrl.viewAllocationSimulate);

router.get('/allocations/:allocationId',
  requireAccess(ALLOC, OPERATIONS.READ),
  trackActionState(ALLOC, OPERATIONS.READ),
  ctrl.viewAllocation);

router.get('/allocations/:allocationId/edit',
  requireAccess(ALLOC, OPERATIONS.UPDATE),
  trackActionState(ALLOC, OPERATIONS.UPDATE),
  ctrl.showAllocationEditForm);

router.post('/allocations/:allocationId/edit',
  requireAccess(ALLOC, OPERATIONS.UPDATE),
  trackActionState(ALLOC, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveAllocationEdit);

router.post('/allocations/:allocationId/cancel',
  requireAccess(ALLOC, OPERATIONS.UPDATE),
  trackActionState(ALLOC, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.cancelAllocation);

// No client actionStateId: callers (e.g. Manage Session) mint a session-scoped token, not allocation-scoped.
router.post('/allocations/:allocationId/open',
  requireAccess(ALLOC, OPERATIONS.UPDATE),
  trackActionState(ALLOC, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.openAllocation);

router.post('/allocations/:allocationId/delete',
  requireAccess(ALLOC, OPERATIONS.DELETE),
  trackActionState(ALLOC, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteAllocation);

router.post('/allocations/:allocationId/assignments/generate',
  requireAccess(ALLOC, OPERATIONS.CREATE),
  trackActionState(ALLOC, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.generateAllocationAssignments);

router.post('/allocations/:allocationId/assignments/add-students',
  requireAccess(ALLOC, OPERATIONS.CREATE),
  trackActionState(ALLOC, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addAllocationStudents);

router.post('/allocations/:allocationId/assignments/exempt-students',
  requireAccess(ALLOC, OPERATIONS.UPDATE),
  trackActionState(ALLOC, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.exemptAllocationStudents);

router.get('/teacher-assignments',
  requireAccess(REV, OPERATIONS.READ_ALL),
  trackActionState(REV, OPERATIONS.READ_ALL),
  ctrl.listTeacherAssignments);

router.get('/teacher-assignments/:allocationId',
  requireAccess(REV, OPERATIONS.READ),
  trackActionState(REV, OPERATIONS.READ),
  ctrl.viewTeacherAssignment);

router.get('/teacher-assignments/review/:assignmentId',
  requireAccess(REV, OPERATIONS.READ),
  trackActionState(REV, OPERATIONS.READ),
  ctrl.viewTeacherAttemptReview);

router.post('/teacher-assignments/review/:assignmentId/attempts/:attemptId/answers/:answerId/grade',
  requireAccess(REV, OPERATIONS.UPDATE),
  trackActionState(REV, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.gradeTeacherAttemptAnswer);

router.post('/teacher-assignments/review/:assignmentId/attempts/:attemptId/delete',
  requireAccess(REV, OPERATIONS.UPDATE),
  trackActionState(REV, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.deleteTeacherReviewAttempt);

router.get('/take',
  requireAccess(TAKE, OPERATIONS.READ_ALL),
  trackActionState(TAKE, OPERATIONS.READ_ALL),
  ctrl.listTakeAssignments);

router.get('/take/:assignmentId',
  requireAccess(TAKE, OPERATIONS.READ),
  trackActionState(TAKE, OPERATIONS.READ),
  ctrl.viewTakeAssignment);

router.post('/take/:assignmentId/start',
  requireAccess(TAKE, OPERATIONS.START),
  trackActionState(TAKE, OPERATIONS.START, { requireToken: true }),
  ctrl.startTakeAssignment);

router.post('/take/:assignmentId/status',
  requireAccess(TAKE, OPERATIONS.CONFIGURE),
  trackActionState(TAKE, OPERATIONS.CONFIGURE, { requireToken: true }),
  ctrl.updateTakeAssignmentStatus);

router.post('/take/:assignmentId/attempts/:attemptId/save-answer',
  requireAccess(TAKE, OPERATIONS.SAVE),
  trackActionState(TAKE, OPERATIONS.SAVE, { requireToken: true }),
  ctrl.saveTakeAssignmentAnswer);

router.post('/take/:assignmentId/attempts/:attemptId/submit',
  requireAccess(TAKE, OPERATIONS.UPDATE),
  trackActionState(TAKE, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.submitTakeAssignment);

module.exports = router;
