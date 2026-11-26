// MVC/routes/accessRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accessController');
const importCtrl = require('../controllers/accessImportController');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

// Import
router.post('/import',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.IMPORT),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.IMPORT),
  adminApproval,
  upload('imports').single('importFile'),
  importCtrl.startImport);
router.get('/import/stream/:jobId',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.IMPORT),
  importCtrl.streamImportStatus);
router.post('/import/abort/:jobId',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.IMPORT),
  importCtrl.abortImport);
router.get('/import/report/:jobId',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.IMPORT),
  importCtrl.downloadImportReport);

// Export
router.post('/export',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.EXPORT),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.EXPORT),
  adminApproval,
  generalExportCtrl.performExport);

// CRUD
router.get('/',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.READ_ALL),
  ctrl.listAccesses);
router.get('/new',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showAddAccessForm);
router.post('/new',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.CREATE),
  ctrl.addAccess);
router.get('/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditAccessForm);
router.post('/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.UPDATE),
  ctrl.editAccess);
router.get('/delete/:id',
  requireAuth,
  requireAccess(SECTIONS.ACCESS_PROFILES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACCESS_PROFILES, OPERATIONS.DELETE),
  ctrl.deleteAccess);

module.exports = router;