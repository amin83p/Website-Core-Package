// MVC/routes/accessRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accessController');
const importCtrl = require('../controllers/accessImportController');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');

// Import
router.post('/import', upload('imports').single('importFile'), importCtrl.startImport);
router.get('/import/stream/:jobId', importCtrl.streamImportStatus);
router.post('/import/abort/:jobId', importCtrl.abortImport);
router.get('/import/report/:jobId', importCtrl.downloadImportReport);

// Export
router.post('/export', requireAuth, adminApproval, generalExportCtrl.performExport);

// CRUD
router.get('/', requireAuth, ctrl.listAccesses);
router.get('/new', requireAuth, ctrl.showAddAccessForm);
router.post('/new', requireAuth, ctrl.addAccess);
router.get('/edit/:id', requireAuth, ctrl.showEditAccessForm);
router.post('/edit/:id', requireAuth, ctrl.editAccess);
router.get('/delete/:id', requireAuth, ctrl.deleteAccess);

module.exports = router;