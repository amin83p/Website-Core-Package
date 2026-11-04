const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/conductMatrixController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const conductMatrixMutationActionState = Object.freeze({
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
});

router.get(
  '/',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.showConductMatrixPage
);

router.get(
  '/api/data',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  ctrl.getConductMatrixData
);

router.post(
  '/api/session-visibility',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.UPDATE, conductMatrixMutationActionState),
  ctrl.postSessionConductVisibility
);

router.get(
  '/assignment-wizard',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.showConductAssignmentWizard
);

router.post(
  '/assignment-wizard/program-count',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  ctrl.postConductAssignmentProgramCount
);

router.post(
  '/assignment-wizard/preview',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  ctrl.postConductAssignmentPreview
);

router.post(
  '/assignment-wizard/apply',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.UPDATE, conductMatrixMutationActionState),
  ctrl.postConductAssignmentApply
);

module.exports = router;
