// MVC/routes/sessionRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/sessionController');
const { requireAuth } = require('../middleware/authMiddleware');

// All routes require login
router.get('/', requireAuth, controller.listSessions);
router.get('/mySessions', requireAuth, controller.listMySessions);

// Actions
router.get('/:id/details', requireAuth, controller.getSessionDetails);


router.get('/delete/:id', requireAuth, controller.terminateSession);
router.delete('/delete/:id', requireAuth, controller.terminateSession);

module.exports = router;