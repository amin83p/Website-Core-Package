// MVC/routes/sectionRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/sectionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware'); // ✅ Added
const { trackActionState } = require('../middleware/actionStateMiddleware'); // ✅ Added
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants'); // ✅ Added
const sectionsImportCtrl = require('../controllers/sectionImportController');
const adminApproval = require('../middleware/adminApproval');
const generalExportCtrl = require('../controllers/generalExportController');
const upload = require('../middleware/upload');

// List
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.READ), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.READ), 
    ctrl.listSections
);

// New Form (GET) -> Keep Active
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.CREATE, { keepActive: true }), // ✅ Keep Active
    ctrl.showAddSectionForm
);

// New Action (POST)
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.CREATE), 
    ctrl.addSection
);

// Edit Form (GET) -> Keep Active
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.UPDATE), // ✅ Keep Active
    ctrl.showEditSectionForm
);

// Edit Action (POST)
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.UPDATE), 
    ctrl.editSection
);

// Delete
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.DELETE), 
    ctrl.deleteSection
);

// Quick Menu (UI Helper)
router.get('/quick-menu', requireAuth, ctrl.getQuickMenu);
router.get('/start-menu', requireAuth, ctrl.getStartMenu);

// Template for Copy From Section (AJAX)
router.get('/api/template/:id',
  requireAuth,
  requireAccess(SECTIONS.SECTIONS, OPERATIONS.READ),
  ctrl.getSectionTemplate
);

// Import
router.post('/import', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.IMPORT), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.IMPORT), 
    adminApproval, 
    upload('imports').single('importFile'), 
    sectionsImportCtrl.startImport
);
  
router.get('/import/stream/:jobId', requireAuth, sectionsImportCtrl.streamImportStatus);
router.post('/import/abort/:jobId', requireAuth, sectionsImportCtrl.abortImport);
router.get('/import/report/:jobId', requireAuth, sectionsImportCtrl.downloadImportReport);
  
// Export
router.post('/export', 
    requireAuth, 
    requireAccess(SECTIONS.SECTIONS, OPERATIONS.EXPORT), 
    trackActionState(SECTIONS.SECTIONS, OPERATIONS.EXPORT), 
    adminApproval, 
    generalExportCtrl.performExport
);

module.exports = router;
