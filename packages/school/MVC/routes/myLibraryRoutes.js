'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/myLibraryController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ),
  ctrl.showMyLibrary);

router.get('/api/loans',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ),
  ctrl.apiMyLoans);

router.get('/api/digital/:loanId',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ, { requireToken: false, keepActive: true }),
  ctrl.apiOpenDigital);

module.exports = router;
