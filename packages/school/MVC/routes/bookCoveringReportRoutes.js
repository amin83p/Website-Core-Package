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
const { requireBookCoveringOperationAny } = require('./bookCoveringReportRouteGuards');

router.use(requireAuth);

const mutationActionState = {
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

const readOperations = [OPERATIONS.READ, OPERATIONS.READ_ALL];
const viewOperations = [OPERATIONS.READ, OPERATIONS.READ_ALL, OPERATIONS.UPDATE];

router.get('/api/assigned-books/:classId',
  requireBookCoveringOperationAny(viewOperations),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiAssignedBooks);

router.get('/api/book-toc/:bookId',
  requireBookCoveringOperationAny(viewOperations),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiBookToc);

router.get('/api/resolve-period',
  requireBookCoveringOperationAny(viewOperations),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.apiResolvePeriod);

router.get('/',
  requireBookCoveringOperationAny(readOperations),
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
  requireBookCoveringOperationAny(viewOperations),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, OPERATIONS.READ_ALL),
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
