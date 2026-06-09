const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/school/notificationController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const SECTION = SECTIONS.SCHOOL_NOTIFICATIONS;

router.get('/',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  notificationController.showList
);

router.get('/list',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  notificationController.showList
);

router.get('/routing',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE),
  notificationController.showRouting
);

router.get('/detail/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  notificationController.showDetail
);

router.post('/api/:id/status',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationController.updateStatus
);

router.post('/api/:id/assign',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationController.reassignNotification
);

router.post('/api/routing',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationController.saveRoutingRule
);

router.post('/api/:id/tasks',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationController.addTask
);

router.post('/api/:id/tasks/:taskId',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationController.updateTask
);

module.exports = router;
