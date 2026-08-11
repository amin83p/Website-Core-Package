'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/libraryCirculationController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const circulationMutationActionState = {
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  ctrl.showCirculationDesk);

router.get('/loans',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  ctrl.listLoans);

router.get('/overdue',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  ctrl.listOverdueLoans);

router.get('/api/patrons/:patronId/summary',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiPatronDeskSummary);

router.get('/api/copies/search',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiSearchAvailableCopies);

router.get('/api/loans/:loanId/preview',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiPreviewLoans);

router.post('/api/checkout',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.CREATE, circulationMutationActionState),
  ctrl.apiCheckout);

router.post('/api/return',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.UPDATE, circulationMutationActionState),
  ctrl.apiReturn);

router.post('/api/renew',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.UPDATE, circulationMutationActionState),
  ctrl.apiRenew);

router.get('/api/digital-access/:loanId',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ, { requireToken: false, keepActive: true }),
  ctrl.apiDigitalAccess);

router.get('/api/digital-access',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ, { requireToken: false, keepActive: true }),
  ctrl.apiDigitalAccess);

module.exports = router;
