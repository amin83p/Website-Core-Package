// MVC/routes/actionStateRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/actionStateController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware'); // ✅ Added
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const adminApproval = require('../middleware/adminApproval');

// 1. List View (Dashboard & Table)
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.ACTION_STATES, OPERATIONS.READ_ALL), 
    trackActionState(SECTIONS.ACTION_STATES, OPERATIONS.READ_ALL), 
    ctrl.listActionStates
);

// 2. Details API (For the Modal - Decrypts Data)
router.get('/details/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ACTION_STATES, OPERATIONS.READ), 
    trackActionState(SECTIONS.ACTION_STATES, OPERATIONS.READ), 
    ctrl.getActionStateDetails
);

router.get('/timeline',
    requireAuth,
    requireAccess(SECTIONS.ACTION_STATES, OPERATIONS.READ),
    trackActionState(SECTIONS.ACTION_STATES, OPERATIONS.READ),
    ctrl.getActionStateEntityTimeline
);

router.post('/cancel', requireAuth, ctrl.cancelAction);

// 3. Delete All
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ACTION_STATES, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.ACTION_STATES, OPERATIONS.DELETE), 
    ctrl.deleteActionState
);


router.get('/delete-all', 
    requireAuth, 
    requireAccess(SECTIONS.ACTION_STATES, OPERATIONS.DELETE_ALL), 
    trackActionState(SECTIONS.ACTION_STATES, OPERATIONS.DELETE_ALL), 
    adminApproval, 
    ctrl.deleteAllActionStates
);

router.post('/retention-cleanup',
    requireAuth,
    requireAccess(SECTIONS.ACTION_STATES, OPERATIONS.DELETE_ALL),
    trackActionState(SECTIONS.ACTION_STATES, OPERATIONS.DELETE_ALL),
    adminApproval,
    ctrl.runActionStateRetentionCleanup
);

module.exports = router;
