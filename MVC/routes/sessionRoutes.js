// MVC/routes/sessionRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/sessionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireFamilyAAdmin } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.get('/',
  requireAuth,
  requireFamilyAAdmin(SECTIONS.SESSIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SESSIONS, OPERATIONS.READ_ALL),
  controller.listSessions
);

router.get('/mySessions', requireAuth, controller.listMySessions);

router.get('/:id/details', requireAuth, controller.getSessionDetails);

router.get('/delete/:id', requireAuth, controller.terminateSession);
router.delete('/delete/:id', requireAuth, controller.terminateSession);

module.exports = router;
