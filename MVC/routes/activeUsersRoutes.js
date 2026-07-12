const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/activeUsersController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.get('/active-users',
  requireAuth,
  requireAccess(SECTIONS.ACTIVE_USERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVE_USERS, OPERATIONS.READ_ALL),
  ctrl.viewActiveUsers
);

router.get('/active-users/data',
  requireAuth,
  requireAccess(SECTIONS.ACTIVE_USERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVE_USERS, OPERATIONS.READ_ALL),
  ctrl.fetchActiveUsersData
);

module.exports = router;
