// MVC/routes/logRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/logReportController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware'); // ✅ Added
const { trackActionState } = require('../middleware/actionStateMiddleware'); // ✅ Added
const adminApproval = require('../middleware/adminApproval');
const generalExportCtrl = require('../controllers/generalExportController');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants'); // ✅ Added

// ...
// Route: GET /logs
router.get('/', 
            requireAuth, 
            requireAccess(SECTIONS.LOGS, OPERATIONS.READ_ALL), 
            trackActionState(SECTIONS.LOGS, OPERATIONS.READ_ALL), 
            ctrl.viewActivityLog);

router.get('/delete/:id', 
            requireAuth, 
            requireAccess(SECTIONS.LOGS, OPERATIONS.DELETE), 
            trackActionState(SECTIONS.LOGS, OPERATIONS.DELETE), 
            ctrl.deleteLog);
router.get('/delete-all', 
            requireAuth, 
            requireAccess(SECTIONS.LOGS, OPERATIONS.DELETE_ALL), 
            trackActionState(SECTIONS.LOGS, OPERATIONS.DELETE_ALL), 
            ctrl.deleteAllLog);

// ✅ EXPORT
// Added 'adminApproval' to protect this route just like import
//router.post('/export', requireAuth, adminApproval, ctrl.exportActivityLog);
router.post('/export', 
            requireAuth, 
            requireAccess(SECTIONS.SECTIONS, OPERATIONS.EXPORT), 
            trackActionState(SECTIONS.SECTIONS, OPERATIONS.EXPORT), 
            adminApproval, 
            generalExportCtrl.performExport);

module.exports = router;