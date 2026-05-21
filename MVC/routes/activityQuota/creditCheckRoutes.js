const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/activityQuota/creditCheckController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, OPERATIONS.READ),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, OPERATIONS.READ),
  ctrl.showCreditCheck);

router.get('/picker/users',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, OPERATIONS.READ),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, OPERATIONS.READ),
  ctrl.pickerUsers);

module.exports = router;
