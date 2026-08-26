'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/bookCoveringReportController');
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

router.get('/api/assigned-books/:classId',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiAssignedBooks);

router.get('/api/book-toc/:bookId',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiBookToc);

router.get('/api/resolve-period',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiResolvePeriod);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL),
  ctrl.listReports);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.CREATE, mutationActionState),
  ctrl.saveReport);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.UPDATE, mutationActionState),
  ctrl.saveReport);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.DELETE),
  ctrl.deleteReport);

module.exports = router;
