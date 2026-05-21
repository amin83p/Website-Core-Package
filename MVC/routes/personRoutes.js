// MVC/routes/personRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/personController');
const personsImportCtrl = require('../controllers/personImportController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware'); 
const { trackActionState } = require('../middleware/actionStateMiddleware'); 
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants'); 
const adminApproval = require('../middleware/adminApproval');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');

// Public registration
router.get('/register', ctrl.showRegisterForm);
router.post('/register', ctrl.registerSelf);

// 1. Show the Sign Up Form
router.get('/join', ctrl.showPublicJoinForm);

// 2. Process the Sign Up
router.post('/join', ctrl.processPublicJoin);

// CRUD

// List
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.READ_ALL), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.READ_ALL), 
    ctrl.listPersons
);

// New Form (View)
// ✅ REMOVED { keepActive: true } - Middleware reads it from DB 'CREATE' operation
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.CREATE), 
    ctrl.showAddPersonForm
);

// New Action (Save)
// Middleware enforces Token check because DB 'CREATE' has keepActive=true
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.CREATE), 
    ctrl.addPerson
);

// Edit Form (View)
// ✅ REMOVED { keepActive: true } - Middleware reads it from DB 'UPDATE' operation
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.UPDATE), 
    ctrl.showEditPersonForm
);

// Edit Action (Save)
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.UPDATE), 
    ctrl.editPerson
);

// Delete
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.DELETE), 
    ctrl.deletePerson
);

// Unlink User
// ✅ KEEP { requireToken: false }: This is a direct button click using 'UPDATE'.
// Since 'UPDATE' is configured as Active in DB, middleware expects a token by default.
// We must explicitly exempt this route.
router.post('/:personId/users/unlink/:userId', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.UPDATE, { requireToken: false }), 
    ctrl.unlinkUserFromPerson
);

// Import
// ✅ KEEP { requireToken: false }: Direct upload action.
router.post('/import', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.IMPORT), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.IMPORT, { requireToken: false }), 
    adminApproval, 
    upload('imports').single('importFile'), 
    personsImportCtrl.startImport
);

router.get('/import/stream/:jobId', requireAuth, personsImportCtrl.streamImportStatus);
router.post('/import/abort/:jobId', requireAuth, personsImportCtrl.abortImport);
router.get('/import/report/:jobId', requireAuth, personsImportCtrl.downloadImportReport);

// Export
// ✅ CLEAN: Removed { requireToken: false } 
// DB says 'EXPORT' has keepActive=false. 
// Middleware automatically skips token check.
router.post('/export', 
    requireAuth, 
    requireAccess(SECTIONS.PERSONS, OPERATIONS.EXPORT), 
    trackActionState(SECTIONS.PERSONS, OPERATIONS.EXPORT), 
    adminApproval, 
    generalExportCtrl.performExport
);

module.exports = router;