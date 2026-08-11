'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/bookController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const upload = requireCoreModule('MVC/middleware/upload');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const bookMutationActionState = {
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

const bookStagedUploadActionState = {
  ...bookMutationActionState,
  keepActive: true
};

router.post('/api/upload-cover',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE),
  upload('school-books', true).single('coverPhoto'),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE, bookStagedUploadActionState),
  ctrl.uploadCoverPhoto);

router.post('/api/upload-pdf',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE),
  upload('school-books-pdf', true).single('digitalPdf'),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE, bookStagedUploadActionState),
  ctrl.uploadDigitalPdf);

router.get('/api/template/:id',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.READ_ALL),
  ctrl.getBookTemplate);

router.get('/',  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.READ_ALL),
  ctrl.listBooks);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE, bookMutationActionState),
  ctrl.saveBook);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.UPDATE, bookMutationActionState),
  ctrl.saveBook);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.DELETE),
  ctrl.deleteBook);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_BOOKS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteBook);

module.exports = router;
