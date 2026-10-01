'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/bookController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const upload = requireCoreModule('MVC/middleware/upload');
const accessService = requireCoreModule('MVC/services/security/index');
const uploadLimitsPolicyService = require('../services/school/uploadLimitsPolicyService');
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

async function requireBookStagedMediaUpload(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Authentication required.' });
    }
    const operations = [OPERATIONS.CREATE, OPERATIONS.UPDATE];
    for (const operationId of operations) {
      // eslint-disable-next-line no-await-in-loop
      const evaluation = await accessService.evaluateAccess({
        user: req.user,
        sectionId: SECTIONS.SCHOOL_BOOKS,
        operationId,
        ipAddress: req.ip
      });
      if (evaluation.allowed) {
        req.accessLimits = evaluation.limits || {};
        req.accessScope = evaluation.scopeId;
        return next();
      }
    }
    return res.status(403).json({ status: 'error', message: 'Insufficient permissions to upload book media.' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function bookPdfUpload(req, res, next) {
  try {
    const orgId = req.user?.activeOrgId;
    const maxFileSizeMb = await uploadLimitsPolicyService.resolveMaxFileSizeMb(orgId, 'bookPdf');
    return upload('school-books-pdf', true, false, { maxFileSizeMb }).single('digitalPdf')(req, res, next);
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to prepare book PDF upload.' });
  }
}

router.post('/api/upload-cover',
  requireBookStagedMediaUpload,
  upload('school-books', true).single('coverPhoto'),
  trackActionState(SECTIONS.SCHOOL_BOOKS, OPERATIONS.CREATE, bookStagedUploadActionState),
  ctrl.uploadCoverPhoto);

router.post('/api/upload-pdf',
  requireBookStagedMediaUpload,
  bookPdfUpload,
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
