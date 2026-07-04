const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/activityQuota/overviewController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../packages/activityQuota/config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_OVERVIEW, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_OVERVIEW, OPERATIONS.READ_ALL),
  ctrl.showOverview);

module.exports = router;
