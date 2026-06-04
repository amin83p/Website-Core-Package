const express = require('express');
const router = express.Router();

const ctrl = require('../../controllers/benchpath/sourceController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.get('/',
  requireAuth,
  requireAccess(SECTIONS.BENCHPATH, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH, OPERATIONS.READ_ALL),
  ctrl.showDashboard);

module.exports = router;
