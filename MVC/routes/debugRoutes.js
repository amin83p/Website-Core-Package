// MVC/routes/debugRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/debugController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccessAny } = require('../middleware/accessMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const multer = require('multer');

// Configure Multer (Memory Storage)
//RAM Updates which is good for limited usres
const upload_RAM = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 } // Limit to 20MB per file
});

const DEBUG_ACCESS_REQUIREMENTS = [
  SECTIONS.DEBUG_ACCESS_SIMULATOR,
  SECTIONS.DEBUG_ACCESS_AUDITOR,
  SECTIONS.DEBUG_INTEGRITY_AUDITOR,
  SECTIONS.DEBUG_USER_PERSON_CHECKER,
  SECTIONS.DEBUG_USER_SESSION_INSPECTOR,
  SECTIONS.DEBUG_HEIC_CONVERTER,
  SECTIONS.WEBSITE_POLICY
];

function requireDebugAccess() {
  return requireAccessAny(DEBUG_ACCESS_REQUIREMENTS, OPERATIONS.READ);
}

router.get('/', requireAuth, requireDebugAccess(), ctrl.showDebugHub);
// Route to display the debugger page
// Example URL: /debug/checker
router.get(['/thisuser', '/user-debug'], requireAuth, requireAccessAny([SECTIONS.DEBUG_USER_SESSION_INSPECTOR], OPERATIONS.READ), ctrl.showUserDebug);

router.get(['/user-person-checker', '/user-person-debug'], requireAuth, requireAccessAny([SECTIONS.DEBUG_USER_PERSON_CHECKER], OPERATIONS.READ), ctrl.showPersonUserChecker);


router.get('/heic-converter', requireAuth, requireAccessAny([SECTIONS.DEBUG_HEIC_CONVERTER], OPERATIONS.READ), ctrl.showHeicConverter);
// POST: Process Conversion (Allow up to 10 files at once)
router.post('/heic-convert', requireAuth, requireAccessAny([SECTIONS.DEBUG_HEIC_CONVERTER], OPERATIONS.CREATE), upload_RAM.array('heicFiles', 10), ctrl.processHeicConversion_HDD);
//router.post('/heic-convert', upload_RAM.array('heicFiles', 10), ctrl.processHeicConversion_RAM);


router.get('/access-debug', requireAuth, requireAccessAny([SECTIONS.DEBUG_ACCESS_SIMULATOR], OPERATIONS.READ), ctrl.showAccessDebugger);
router.post('/access-debug/run', requireAuth, requireAccessAny([SECTIONS.DEBUG_ACCESS_SIMULATOR], OPERATIONS.READ), ctrl.runAccessSimulation);

router.get('/access-audit', requireAuth, requireAccessAny([SECTIONS.DEBUG_ACCESS_AUDITOR], OPERATIONS.READ), ctrl.showUserAccessAuditor);
router.post('/access-audit/run', requireAuth, requireAccessAny([SECTIONS.DEBUG_ACCESS_AUDITOR], OPERATIONS.READ), ctrl.runUserAccessAudit);
router.get('/integrity-audit', requireAuth, requireAccessAny([SECTIONS.DEBUG_INTEGRITY_AUDITOR], OPERATIONS.READ), ctrl.showIntegrityAuditor);
router.post('/integrity-audit/run', requireAuth, requireAccessAny([SECTIONS.DEBUG_INTEGRITY_AUDITOR], OPERATIONS.READ), ctrl.runIntegrityAudit);

module.exports = router;
