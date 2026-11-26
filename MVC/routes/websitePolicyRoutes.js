const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/websitePolicyController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const adminApproval = require('../middleware/adminApproval');

router.get('/',
  requireAuth,
  requireAccess(SECTIONS.WEBSITE_POLICY, OPERATIONS.READ),
  trackActionState(SECTIONS.WEBSITE_POLICY, OPERATIONS.READ, { keepActive: true }),
  ctrl.showPolicyForm);
router.post('/',
  requireAuth,
  requireAccess(SECTIONS.WEBSITE_POLICY, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.WEBSITE_POLICY, OPERATIONS.UPDATE),
  adminApproval,
  ctrl.updatePolicy);

module.exports = router;