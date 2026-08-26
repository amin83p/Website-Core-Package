'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/bookAssignmentController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const mutationActionState = {
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

router.get('/api/class/:classId',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiListForClass);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.READ_ALL),
  ctrl.listAssignments);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.CREATE, mutationActionState),
  ctrl.saveAssignment);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.UPDATE, mutationActionState),
  ctrl.saveAssignment);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, OPERATIONS.DELETE),
  ctrl.deleteAssignment);

module.exports = router;
