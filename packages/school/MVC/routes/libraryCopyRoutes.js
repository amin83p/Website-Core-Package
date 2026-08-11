'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/libraryCopyController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const copyMutationActionState = {
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

router.get('/api/available',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiListAvailableCopies);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.READ_ALL),
  ctrl.listCopies);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.CREATE, copyMutationActionState),
  ctrl.saveCopy);

router.post('/duplicate/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.CREATE, copyMutationActionState),
  ctrl.duplicateCopy);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.UPDATE, copyMutationActionState),
  ctrl.saveCopy);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.DELETE),
  ctrl.deleteCopy);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteCopy);

module.exports = router;
