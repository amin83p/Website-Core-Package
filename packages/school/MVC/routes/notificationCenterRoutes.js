const express = require('express');
const router = express.Router();
const notificationCenterController = require('../controllers/school/notificationCenterController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const SECTION = SECTIONS.SCHOOL_NOTIFICATION_CENTER;

router.get('/',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  notificationCenterController.showHome
);

router.get('/outbox',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  notificationCenterController.showOutbox
);

router.post('/outbox/:id/cancel',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPLOAD),
  trackActionState(SECTION, OPERATIONS.UPLOAD, { requireToken: false, keepActive: true }),
  notificationCenterController.cancelOutboxEntry
);

router.post('/outbox/:id/delete',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.DELETE),
  trackActionState(SECTION, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  notificationCenterController.deleteOutboxEntry
);

router.get('/rules/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CONFIGURE),
  trackActionState(SECTION, OPERATIONS.CONFIGURE),
  notificationCenterController.showRuleForm
);

router.post('/rules/save',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CONFIGURE),
  trackActionState(SECTION, OPERATIONS.CONFIGURE, { requireToken: false, keepActive: true }),
  notificationCenterController.saveRule
);

router.post('/rules/:id/run',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationCenterController.runRuleNow
);

router.get('/runs/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  notificationCenterController.showRun
);

router.post('/runs/:id/delete',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  notificationCenterController.deleteRun
);

router.get('/runs/:id/compose',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPLOAD),
  trackActionState(SECTION, OPERATIONS.UPLOAD),
  notificationCenterController.showComposeEmail
);

router.post('/runs/:id/schedule-email',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPLOAD),
  trackActionState(SECTION, OPERATIONS.UPLOAD, { requireToken: false, keepActive: true }),
  notificationCenterController.scheduleEmail
);

module.exports = router;
