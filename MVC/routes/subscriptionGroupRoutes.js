// MVC/routes/subscriptionGroupRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/subscriptionGroupController');

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.get(
  '/dashboard',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.READ),
  ctrl.dashboard
);
// List Groups
router.get('/',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.READ),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.READ),
    ctrl.listGroups
);

// New Group
router.get('/new',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
    ctrl.showAddForm
);
router.post('/new',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
    ctrl.addGroup
);

// Edit Group
router.get('/edit/:id',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    ctrl.showEditForm
);
router.post('/edit/:id',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    ctrl.editGroup
);

// Delete Group
router.get('/delete/:id',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.DELETE),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.DELETE),
    ctrl.deleteGroup
);

// ✅ NEW: Manage Members Page
router.get('/:id/members',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.READ),
    ctrl.listGroupMembers
);

// ✅ NEW: Add Member Action
router.post('/:id/members/add',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    ctrl.addGroupMember
);

// ✅ NEW: Remove Member Action
router.post('/:id/members/remove',
    requireAuth,
    requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
    ctrl.removeGroupMember
);

module.exports = router;