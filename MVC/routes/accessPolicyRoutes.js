// MVC/routes/accessPolicyRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/accessPolicyController');
const importCtrl = require('../controllers/accessPolicyImportController');
const adminApproval = require('../middleware/adminApproval');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware'); 
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

// 1. AJAX Check (for Form UI)
router.get('/check-user/:userId', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.READ), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.READ), 
    ctrl.checkUserPolicy);

// 2. Access Checker Tool (Diagnostic Page)
router.get('/checker', requireAuth, ctrl.showAccessChecker);
router.post('/checker/test', requireAuth, ctrl.performAccessCheck);

// 3. Protected CRUD
router.get('/', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.READ_ALL), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.READ_ALL), 
    ctrl.listPolicies);

router.get('/new', requireAuth,
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.CREATE), 
    ctrl.showAddPolicyForm);
    
router.post('/new', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.CREATE), 
    ctrl.addPolicy);

router.get('/edit/:id', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.UPDATE), 
    ctrl.showEditPolicyForm);

router.post('/edit/:id', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.UPDATE), 
    ctrl.editPolicy);

router.get('/delete/:id', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.DELETE), 
    ctrl.deletePolicy);

// 4. Import/Export
router.post('/import', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.IMPORT), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.IMPORT), 
    adminApproval, upload('imports').single('importFile'), importCtrl.startImport);
router.get('/import/stream/:jobId', requireAuth, importCtrl.streamImportStatus);
router.post('/import/abort/:jobId', requireAuth, importCtrl.abortImport);
router.get('/import/report/:jobId', requireAuth, importCtrl.downloadImportReport);

router.post('/export', requireAuth, 
    requireAccess(SECTIONS.ACCESS_POLICIES, OPERATIONS.EXPORT), 
    trackActionState(SECTIONS.ACCESS_POLICIES, OPERATIONS.EXPORT), 
    adminApproval, generalExportCtrl.performExport);

module.exports = router;