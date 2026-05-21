// MVC/routes/scopeRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scopeController');
const scopesImport = require('../controllers/scopesImportController');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
//

// Import
router.post('/import', requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.IMPORT), 
    trackActionState(SECTIONS.SCOPES, OPERATIONS.IMPORT), 
    adminApproval, 
    upload('imports').single('importFile'), 
    scopesImport.startImport);
router.get('/import/stream/:jobId', scopesImport.streamImportStatus);
router.post('/import/abort/:jobId', scopesImport.abortImport);
router.get('/import/report/:jobId', scopesImport.downloadImportReport);

// Export
router.post('/export', requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.EXPORT), 
    trackActionState(SECTIONS.SCOPES, OPERATIONS.EXPORT), 
    adminApproval, 
    generalExportCtrl.performExport);

// CRUD
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.READ_ALL), 
    trackActionState(SECTIONS.SCOPES, OPERATIONS.READ_ALL), 
    ctrl.listScopes
);
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.SCOPES, OPERATIONS.CREATE), 
    ctrl.showAddScopeForm);
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.CREATE),
    trackActionState(SECTIONS.SCOPES, OPERATIONS.CREATE), 
    ctrl.addScope
);
//
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.SCOPES, OPERATIONS.UPDATE), 
    ctrl.showEditScopeForm);
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.SCOPES, OPERATIONS.UPDATE), 
    ctrl.editScope);
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SCOPES, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.SCOPES, OPERATIONS.DELETE), 
    ctrl.deleteScope);

module.exports = router;