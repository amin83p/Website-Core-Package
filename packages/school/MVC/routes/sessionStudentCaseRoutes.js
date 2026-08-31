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

  requireCaseStatusMutationAccess,

  requireCaseRoutingAdmin

} = require('./sessionStudentCaseRouteGuards');



const mutationActionState = {

  requireToken: true,

  keepActive: true,

  allowOperationTokenFallback: true,

  allowInactiveTokenFallback: true

};



router.use(requireAuth);



router.get('/',

  requireCaseSectionOperationAny([OPERATIONS.READ, OPERATIONS.READ_ALL]),

  trackActionState(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.UPDATE, {

    requireToken: false,

    keepActive: true,

    allowOperationTokenFallback: true,

    allowInactiveTokenFallback: true

  }),

  ctrl.listSessionStudentCases);



router.get('/routing',

  requireCaseRoutingAdmin,

  trackActionState(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.CONFIGURE, {

    requireToken: false,

    keepActive: true,

    allowOperationTokenFallback: true,

    allowInactiveTokenFallback: true

  }),

  ctrl.showRouting);



router.get('/api/routing/eligible-persons',

  requireCaseRoutingAdmin,

  ctrl.listRoutingEligiblePersons);



router.post('/api/routing',

  requireCaseRoutingAdmin,

  trackActionState(SECTIONS.SCHOOL_SESSION_STUDENT_CASES, OPERATIONS.CONFIGURE, {

    requireToken: true,

    keepActive: true,

    allowOperationTokenFallback: true,

    allowInactiveTokenFallback: true

  }),

  ctrl.saveRouting);



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

