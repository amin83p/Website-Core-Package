// MVC/routes/tableSettingsRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tableSettingsController');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware'); 
const { trackActionState } = require('../middleware/actionStateMiddleware'); 
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants'); 

const SETTING_SEC = SECTIONS.TABLE_SETTINGS || 'TABLE_SETTINGS';

// ------------------------------------------------------------------
// LIST VIEWS (Read-Only)
// ------------------------------------------------------------------
// Default behavior: Session completes immediately (keepActive=false)

router.get('/', 
    requireAuth,     
    requireAccess(SETTING_SEC, OPERATIONS.READ_ALL), 
    trackActionState(SETTING_SEC, OPERATIONS.READ_ALL), 
    ctrl.listAll
);

router.get('/:userId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.READ_ALL), 
    trackActionState(SETTING_SEC, OPERATIONS.READ_ALL), 
    ctrl.listUserAll
);

router.get('/:userId/:tableId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.READ), 
    trackActionState(SETTING_SEC, OPERATIONS.READ), 
    ctrl.getItem
);

// ==================================================================
// 1. STANDARD ROUTES (For Full Page Forms)
// ==================================================================
// These routes follow the strict security model (View -> Token -> Save).
// We rely on DB config (keepActive=true for CREATE/UPDATE) to handle the session lifecycle.

router.get('/new/:userId/:tableId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.CREATE), 
    trackActionState(SETTING_SEC, OPERATIONS.CREATE), 
    ctrl.showAddForm
);

router.post('/new/:userId/:tableId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.CREATE), 
    trackActionState(SETTING_SEC, OPERATIONS.CREATE), 
    ctrl.addItem
);

router.get('/edit/:userId/:tableId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.UPDATE), 
    trackActionState(SETTING_SEC, OPERATIONS.UPDATE), 
    ctrl.showEditForm
);

router.post('/edit/:userId/:tableId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.UPDATE), 
    trackActionState(SETTING_SEC, OPERATIONS.UPDATE), 
    ctrl.editItem
);

// ==================================================================
// 2. API ROUTES (For Modals / Background Tasks)
// ==================================================================
// These MUST override the default security because the DB says CREATE/UPDATE 
// requires a token (keepActive=true), but background calls don't have one.

router.post('/api/new/:userId/:tableId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.CREATE), 
    // ✅ Keep this! It overrides the DB's strict default for this specific route.
    trackActionState(SETTING_SEC, OPERATIONS.CREATE, { requireToken: false }), 
    ctrl.addItem 
);

router.post('/api/edit/:userId/:tableId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.UPDATE), 
    // ✅ Keep this! It overrides the DB's strict default.
    trackActionState(SETTING_SEC, OPERATIONS.UPDATE, { requireToken: false }), 
    ctrl.editItem 
);

router.get('/api/delete/:userId/:tableId/', 
    requireAuth,
    requireAccess(SETTING_SEC, OPERATIONS.DELETE), 
    trackActionState(SETTING_SEC, OPERATIONS.DELETE, { requireToken: false }), 
    ctrl.deleteItem
);

// ==================================================================
// 3. DELETE ROUTES
// ==================================================================

router.get('/delete/:userId/:tableId/', 
    requireAuth,
    requireAccess(SETTING_SEC, OPERATIONS.DELETE), 
    trackActionState(SETTING_SEC, OPERATIONS.DELETE), 
    ctrl.deleteItem
);

router.get('/delete/:userId', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.DELETE), 
    trackActionState(SETTING_SEC, OPERATIONS.DELETE), 
    ctrl.deleteUser
);

router.get('/delete', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.DELETE_ALL), 
    trackActionState(SETTING_SEC, OPERATIONS.DELETE_ALL), 
    ctrl.deleteAll
);

// ==================================================================
// 4. EXPORT
// ==================================================================

router.post('/export', 
    requireAuth, 
    requireAccess(SETTING_SEC, OPERATIONS.EXPORT), 
    trackActionState(SETTING_SEC, OPERATIONS.EXPORT), 
    adminApproval, 
    generalExportCtrl.performExport
);

module.exports = router;