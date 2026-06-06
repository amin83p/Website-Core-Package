const express = require('express');
const router = express.Router();
const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');

const ctrl = require('../../controllers/benchpath/sourceController');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.get('/',
  requireAuth,
  requireAccess(SECTIONS.BENCHPATH, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH, OPERATIONS.READ_ALL),
  ctrl.showDashboard);

module.exports = router;
