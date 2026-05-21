// MVC/routes/operationRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/operationController');
const operationsImport = require('../controllers/operationsImportController');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware'); // ✅ Added
const { trackActionState } = require('../middleware/actionStateMiddleware'); // ✅ Added
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants'); // ✅ Added

// Import
router.post('/import', 
    requireAuth, // Ensure Auth check
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.IMPORT), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.IMPORT), 
    adminApproval, 
    upload('imports').single('importFile'), 
    operationsImport.startImport
);

router.get('/import/stream/:jobId', operationsImport.streamImportStatus);
router.post('/import/abort/:jobId', operationsImport.abortImport);
router.get('/import/report/:jobId', operationsImport.downloadImportReport);

// Export
router.post('/export', 
    requireAuth, 
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.EXPORT), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.EXPORT), 
    adminApproval, 
    generalExportCtrl.performExport
);

// CRUD

// List
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.READ), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.READ), 
    ctrl.listOperations
);

// New Form (GET) -> Keep Active
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.CREATE, { keepActive: true }), // ✅ Keep Active
    ctrl.showAddOperationForm
);

// New Action (POST)
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.CREATE, { requireToken: true }), 
    ctrl.addOperation
);

// Edit Form (GET) -> Keep Active
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.UPDATE, { keepActive: true }), // ✅ Keep Active
    ctrl.showEditOperationForm
);

// Edit Action (POST)
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.UPDATE, { requireToken: true }), 
    ctrl.editOperation
);

// Delete
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.OPERATIONS, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.OPERATIONS, OPERATIONS.DELETE), 
    ctrl.deleteOperation
);

module.exports = router;
