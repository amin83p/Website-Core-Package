// MVC/routes/school/classRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/classController');
const programRegistrationCtrl = require('../controllers/school/programRegistrationController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security/index');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const upload = requireCoreModule('MVC/middleware/upload');
const { SECTIONS, OPERATIONS } = require('./schoolRouteDependencies');

router.use(requireAuth);

const sessionManagerMutationActionState = {
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

const rollingEnrollmentMutationActionState = {
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

/** Final grades: teachers (gradebook), dept admins, or class admins — OR access. */
function requireAnyOfAccess(pairs) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ status: 'error', message: 'Authentication required before access check.' });
      }
      let granted = null;
      for (const { sectionId, operationId } of pairs) {
        // eslint-disable-next-line no-await-in-loop
        const evaluation = await accessService.evaluateAccess({
          user: req.user,
          sectionId,
          operationId,
          ipAddress: req.ip
        });
        if (evaluation?.allowed) {
          granted = evaluation;
          break;
        }
      }
      if (!granted) {
        const msg = 'Access Denied: You do not have permission for this final grades workflow.';
        if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
          return res.status(403).json({ status: 'error', message: msg });
        }
        return res.status(403).render('error', {
          title: 'Access Denied',
          message: msg,
          user: req.user
        });
      }
      req.accessLimits = granted.limits || {};
      req.accessScope = granted.scopeId;
      next();
    } catch (error) {
      console.error('requireAnyOfAccess error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal Security Error' });
    }
  };
}

function requireAnyClassMutationAccess() {
  const operations = [OPERATIONS.CREATE, OPERATIONS.UPDATE, OPERATIONS.READ_ALL];
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ status: 'error', message: 'Authentication required before access check.' });
      }

      let granted = null;
      for (const operationId of operations) {
        // eslint-disable-next-line no-await-in-loop
        const evaluation = await accessService.evaluateAccess({
          user: req.user,
          sectionId: SECTIONS.SCHOOL_CLASSES,
          operationId,
          ipAddress: req.ip
        });
        if (evaluation?.allowed) {
          granted = evaluation;
          break;
        }
      }

      if (!granted) {
        if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
          return res.status(403).json({ status: 'error', message: 'Access Denied: You do not have permission to validate class conflicts.' });
        }
        return res.status(403).render('error', {
          title: 'Access Denied',
          message: 'You do not have permission to validate class conflicts.',
          user: req.user
        });
      }

      req.accessLimits = granted.limits || {};
      req.accessScope = granted.scopeId;
      next();
    } catch (error) {
      console.error('Class conflict access middleware error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal Security Error' });
    }
  };
}

// List Classes
router.get('/',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.READ_ALL),
  ctrl.listClasses);

router.get('/api/template/:id',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.READ_ALL),
  ctrl.getClassTemplate);

router.get('/new-wizard',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.CREATE),
  ctrl.showAddWizardForm);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);

router.get('/:id/rolling-enrollment',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showRollingEnrollmentPage);

router.get('/:id/cycle-rollover',
  requireAccess(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showCycleRolloverWizard);

router.get('/:id/final-grades',
  requireAnyOfAccess([
    { sectionId: SECTIONS.SCHOOL_GRADEBOOK, operationId: OPERATIONS.READ_ALL },
    { sectionId: SECTIONS.SCHOOL_DEPARTMENTS, operationId: OPERATIONS.READ_ALL },
    { sectionId: SECTIONS.SCHOOL_CLASSES, operationId: OPERATIONS.READ_ALL }
  ]),
  trackActionState(SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.READ_ALL),
  ctrl.showFinalGradesPage);

router.post('/api/:id/official-final-grades',
  requireAnyOfAccess([
    { sectionId: SECTIONS.SCHOOL_GRADEBOOK, operationId: OPERATIONS.UPDATE },
    { sectionId: SECTIONS.SCHOOL_DEPARTMENTS, operationId: OPERATIONS.UPDATE },
    { sectionId: SECTIONS.SCHOOL_CLASSES, operationId: OPERATIONS.UPDATE }
  ]),
  trackActionState(SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.postOfficialFinalGradesWorkflow);

router.get('/:id/enrollment-outcomes',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEnrollmentOutcomesPage);

router.post('/api/enrollment-periods/:periodId/completion-decision',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }),
  ctrl.saveEnrollmentCompletionDecision);

// Add Class
router.get('/new',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.CREATE),
  ctrl.showAddForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addClass);

// Edit Class
router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editClass);

// Delete Class (Support both GET and DELETE for compatibility)
router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.DELETE),
  ctrl.deleteClass);
router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_CLASSES, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteClass);

// --- Validation Routes ---
router.post('/api/check-conflicts',
  requireAnyClassMutationAccess(),
  ctrl.checkConflicts);

router.post('/api/:classId/teacher-assignment-impact',
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  ctrl.previewTeacherAssignmentImpact);

// --- Class Enrollment Periods & Rolling Cycle API ---
router.get('/api/:classId/enrollment-periods',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.listClassEnrollmentPeriods);

router.get('/api/:classId/rolling-eligibility',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.previewRollingEnrollmentEligibility);

router.post('/api/:classId/rolling-program-registration/preview',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.assertRollingProgramRegistrationShortcutContext,
  programRegistrationCtrl.previewBatchRegistration);

router.post('/api/:classId/rolling-program-registration/apply',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.assertRollingProgramRegistrationShortcutContext,
  programRegistrationCtrl.applyBatchRegistration);

router.post('/api/:classId/rolling-program-registration/approve/:registrationId',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.assertRollingProgramRegistrationShortcutContext,
  programRegistrationCtrl.approveRegistration);

router.post('/api/enrollment-periods/preview-create',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.previewClassEnrollmentWithTransactions);

router.post('/api/enrollment-periods/create-with-transactions',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.createClassEnrollmentWithTransactions);

router.post('/api/enrollment-periods/:periodId/draft',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.saveClassEnrollmentDraft);

router.post('/api/enrollment-periods/:periodId/approve',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.approveClassEnrollmentDraft);

router.post('/api/enrollment-periods/:periodId/sync-academic-ledger',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.syncAcademicLedgerForEnrollmentPeriod);

router.post('/api/enrollment-periods/:periodId/edit',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.editClassEnrollmentPeriod);

router.post('/api/enrollment-periods/:periodId/remove',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.DELETE, rollingEnrollmentMutationActionState),
  ctrl.removeOrRollbackClassEnrollmentPeriod);

router.post('/api/enrollment-periods/create',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.createClassEnrollmentPeriod);

router.post('/api/enrollment-periods/:periodId/close',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.closeClassEnrollmentPeriod);

router.post('/api/enrollment-periods/:periodId/reopen',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.reopenClassEnrollmentPeriod);

router.post('/api/enrollment-periods/check-overlap',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.checkClassEnrollmentPeriodOverlap);

router.post('/api/enrollment-periods/evaluate-reentry',
  requireAccess(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.evaluateClassEnrollmentReentry);

router.post('/api/:classId/cycles/close',
  requireAccess(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.closeClassCycle);

router.post('/api/:classId/cycles/create-next',
  requireAccess(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.createNextClassCycleFromTemplate);

router.post('/api/:classId/cycles/preview-rollover',
  requireAccess(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.previewCycleRollover);

router.post('/api/cycles/carry-forward',
  requireAccess(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.carryForwardClassCycleStudents);

router.post('/api/cycles/split-boundary',
  requireAccess(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_CYCLES, OPERATIONS.UPDATE, rollingEnrollmentMutationActionState),
  ctrl.splitClassEnrollmentPeriodsForCycleBoundary);

// --- Session Execution Routes ---
router.get('/:id/sessions/:sessionId',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL),
  // Session manager posts to session UPDATE; mint the matching token on page load.
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  ctrl.manageSession);
router.get('/:id/sessions/:sessionId/cases',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL),
  ctrl.listSessionStudentCases);
router.post('/:id/sessions/:sessionId/files/upload',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  upload('school-class-workspace', true).single('file'),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, sessionManagerMutationActionState),
  ctrl.uploadSessionFile);
router.post('/:id/sessions/:sessionId/makeup',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.createMakeupSession);
router.post('/:id/sessions/:sessionId/cases',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: true,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveSessionStudentCase);
router.post('/:id/sessions/:sessionId/cases/:caseId',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: true,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveSessionStudentCase);
router.post('/:id/sessions/:sessionId/cases/:caseId/status',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: true,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.updateSessionStudentCaseStatus);
router.post('/:id/sessions/:sessionId/gradebooks/save',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveSessionGradebooks);
router.post('/:id/sessions/:sessionId/save',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveSession);

module.exports = router;
