'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/sessionStudentCaseController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');
const {
  requireCaseSectionOperationAny,
  requireCaseStatusMutationAccess
} = require('./sessionStudentCaseRouteGuards');

const mutationActionState = {
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.listSessionStudentCases);

router.get('/:caseId/review-context',
  requireCaseSectionOperationAny([OPERATIONS.READ, OPERATIONS.READ_ALL]),
  ctrl.getReviewContext);

router.post('/:caseId',
  requireAccess(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.UPDATE, mutationActionState),
  ctrl.saveCase);

router.post('/:caseId/status',
  requireCaseStatusMutationAccess,
  trackActionState(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.UPDATE, mutationActionState),
  ctrl.updateCaseStatus);

router.delete('/:caseId',
  requireAccess(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.DELETE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.deleteCase);

module.exports = router;
