const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/userMembershipController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.get(
  '/',
  requireAuth,
  requireAccess(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.READ),
  trackActionState(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.READ),
  ctrl.listMemberships
);

router.get(
  '/new',
  requireAuth,
  requireAccess(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showAddForm
);

router.post(
  '/new',
  requireAuth,
  requireAccess(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.CREATE),
  ctrl.addMembership
);

router.get(
  '/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditForm
);

router.post(
  '/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.UPDATE),
  ctrl.editMembership
);

router.get(
  '/delete/:id',
  requireAuth,
  requireAccess(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.USER_MEMBERSHIPS, OPERATIONS.DELETE),
  ctrl.deleteMembership
);

module.exports = router;
