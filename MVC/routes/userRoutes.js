// MVC/routes/userRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/userController');
const usersImportCtrl = require('../controllers/userImportController');

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware'); // ✅ Added
const { trackActionState } = require('../middleware/actionStateMiddleware'); // ✅ Added
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants'); // ✅ Added
const adminApproval = require('../middleware/adminApproval');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');
const validateRequest = require('../middleware/validateRequest');
const userValidators = require('../validators/userValidators');

// CRUD

// List
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.READ), 
    // async (req, res, next)=>{
    //     console.log(req.accessLimits);
    //     console.log(req.accessScope);
    //     next();
    // },
    trackActionState(SECTIONS.USERS, OPERATIONS.READ), 
    ctrl.listUsers
);

// New Form (GET) -> Keep Active
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.USERS, OPERATIONS.CREATE, { keepActive: true }), // ✅ Keep Active
    ctrl.showAddUserForm
);

// New Action (POST)
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.USERS, OPERATIONS.CREATE), 
    validateRequest(userValidators.userSchema),
    ctrl.addUser
);

// Edit Form (GET) -> Keep Active
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.USERS, OPERATIONS.UPDATE, { keepActive: true }), // ✅ Keep Active
    ctrl.showEditUserForm
);

// Edit Action (POST)
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.USERS, OPERATIONS.UPDATE), 
    validateRequest(userValidators.editUserSchema),
    ctrl.editUser
);

// Delete
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.USERS, OPERATIONS.DELETE), 
    ctrl.deleteUser
);

// AJAX Check (UI Helper - Optional Tracking)
router.get('/check-person', requireAuth, 
  requireAccess(SECTIONS.USERS, OPERATIONS.USERS_CHECK_LINKEDPERSON), 
  trackActionState(SECTIONS.USERS, OPERATIONS.USERS_CHECK_LINKEDPERSON), 
  ctrl.checkUserPerson);

router.get('/check-person/:personId', requireAuth, 
  requireAccess(SECTIONS.USERS, OPERATIONS.USERS_CHECK_LINKEDPERSON), 
  trackActionState(SECTIONS.USERS, OPERATIONS.USERS_CHECK_LINKEDPERSON), 
  ctrl.checkUserPerson);

// Import
router.post('/import', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.IMPORT), 
    trackActionState(SECTIONS.USERS, OPERATIONS.IMPORT), 
    adminApproval, 
    upload('imports').single('importFile'), 
    usersImportCtrl.startImport
);

router.get('/import/stream/:jobId', usersImportCtrl.streamImportStatus);
router.post('/import/abort/:jobId', usersImportCtrl.abortImport);
router.get('/import/report/:jobId', usersImportCtrl.downloadImportReport);

// Export
router.post('/export', 
    requireAuth, 
    requireAccess(SECTIONS.USERS, OPERATIONS.EXPORT), 
    trackActionState(SECTIONS.USERS, OPERATIONS.EXPORT), 
    adminApproval, 
    generalExportCtrl.performExport
);

module.exports = router;