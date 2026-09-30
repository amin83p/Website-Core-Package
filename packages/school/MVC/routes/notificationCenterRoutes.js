const express = require('express');
const router = express.Router();
const notificationCenterController = require('../controllers/school/notificationCenterController');
const {
  requireAuth,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');
const { requireNotificationCenterOperation } = require('./notificationCenterRouteGuards');

const SECTION = SECTIONS.SCHOOL_NOTIFICATION_CENTER;

router.get('/',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  notificationCenterController.showHome
);

router.get('/outbox',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  notificationCenterController.showOutbox
);

router.post('/outbox/:id/cancel',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.UPLOAD),
  trackActionState(SECTION, OPERATIONS.UPLOAD, { requireToken: false, keepActive: true }),
  notificationCenterController.cancelOutboxEntry
);

router.post('/outbox/:id/delete',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.DELETE),
  trackActionState(SECTION, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  notificationCenterController.deleteOutboxEntry
);

router.get('/rules/:id',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.CONFIGURE),
  trackActionState(SECTION, OPERATIONS.CONFIGURE),
  notificationCenterController.showRuleForm
);

router.post('/rules/save',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.CONFIGURE),
  trackActionState(SECTION, OPERATIONS.CONFIGURE, { requireToken: false, keepActive: true }),
  notificationCenterController.saveRule
);

router.post('/rules/:id/delete',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.CONFIGURE),
  trackActionState(SECTION, OPERATIONS.CONFIGURE, { requireToken: false, keepActive: true }),
  notificationCenterController.deleteRule
);

router.post('/rules/:id/run',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationCenterController.runRuleNow
);

router.get('/runs/:id',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  notificationCenterController.showRun
);

router.post('/runs/:id/delete',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.DELETE),
  trackActionState(SECTION, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  notificationCenterController.deleteRun
);

router.get('/runs/:id/compose',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.UPLOAD),
  trackActionState(SECTION, OPERATIONS.UPLOAD),
  notificationCenterController.showComposeEmail
);

router.post('/runs/:id/schedule-email',
  requireAuth,
  requireNotificationCenterOperation(OPERATIONS.UPLOAD),
  trackActionState(SECTION, OPERATIONS.UPLOAD, { requireToken: false, keepActive: true }),
  notificationCenterController.scheduleEmail
);

module.exports = router;
