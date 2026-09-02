const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/workSessionExplorerController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_WORK_SESSIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_WORK_SESSIONS, OPERATIONS.READ_ALL),
  ctrl.showWorkSessionExplorerPage);
router.get('/api/data',
  requireAccess(SECTIONS.SCHOOL_WORK_SESSIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_WORK_SESSIONS, OPERATIONS.READ_ALL),
  ctrl.getWorkSessionsApi);

module.exports = router;
