const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/academicLedgerController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listLedger);

router.get('/student/:studentId',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  ctrl.showStudentStatement);

router.get('/student-overview',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  ctrl.showStudentOverview);

router.get('/student-overview/:studentId',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  ctrl.showStudentOverviewForStudent);

router.get('/student-overview/:studentId/enrollment-detail/:enrollmentId',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.READ_ALL),
  ctrl.getStudentEnrollmentDetail);

router.post('/program-registration',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.postProgramRegistration);

router.post('/term-registration',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.postTermRegistration);

router.post('/class-enrollment',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.postClassEnrollment);

router.post('/score',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.postScore);

router.post('/rebuild-snapshot',
  requireAccess(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACADEMIC_LEDGER, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.rebuildSnapshot);

module.exports = router;
