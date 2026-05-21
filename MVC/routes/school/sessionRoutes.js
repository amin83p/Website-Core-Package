// MVC/routes/school/sessionRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/sessionController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL),
  ctrl.showSessionListPage);
router.get('/api/data',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL),
  ctrl.getSessionsApi);

module.exports = router;
