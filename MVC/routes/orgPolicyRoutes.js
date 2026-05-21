// MVC/routes/orgPolicyRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/orgPolicyController');

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
// Define new constants for this section or reuse existing ones if suitable
// Assuming SECTIONS.ORG_POLICIES exists or mapped to 'ORG_POLICIES'
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

// 1. AJAX Check
router.get('/check-org/:orgId', requireAuth, ctrl.checkOrgPolicy);

// 2. CRUD
router.get('/', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.READ), 
    trackActionState(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.READ), 
    ctrl.listPolicies
);

// Add (View) - Middleware handles keepActive logic from DB
router.get('/new', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.CREATE), 
    ctrl.showAddPolicyForm
);

// Add (Save)
router.post('/new', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.CREATE), 
    ctrl.addPolicy
);

// Edit (View)
router.get('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.UPDATE), 
    ctrl.showEditPolicyForm
);

// Edit (Save)
router.post('/edit/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.UPDATE), 
    ctrl.editPolicy
);

// Delete
router.get('/delete/:id', 
    requireAuth, 
    requireAccess(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.ORGANIZATION_POLICIES, OPERATIONS.DELETE), 
    ctrl.deletePolicy
);

module.exports = router;