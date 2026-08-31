const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scheduledTaskController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess, requireAccessAny } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const scheduledTaskMutationActionState = Object.freeze({
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true,
  allowSectionTokenFallback: true
});

const managerReadSections = [
  SECTIONS.SCHEDULED_TASK_MANAGER,
  SECTIONS.AUTO_SCHEDULED_TASKS,
  SECTIONS.AUTO_SCHEDULED_TASK_RUNS
];

router.use(requireAuth);

router.get(
  '/api/manager-window',
  requireAccessAny(managerReadSections, OPERATIONS.READ_ALL),
  ctrl.getManagerWindow
);

router.get(
  '/manager',
  requireAccessAny(managerReadSections, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHEDULED_TASK_MANAGER, OPERATIONS.READ_ALL),
  ctrl.showManagerPage
);

router.get(
  '/',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.READ_ALL),
  ctrl.showDefinitionList
);

router.post(
  '/definitions/:id/pause',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.UPDATE, scheduledTaskMutationActionState),
  ctrl.pauseDefinition
);

router.post(
  '/definitions/:id/resume',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.UPDATE, scheduledTaskMutationActionState),
  ctrl.resumeDefinition
);

router.post(
  '/definitions/:id/delete',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.DELETE, {
    requireToken: false,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.deleteDefinition
);

router.post(
  '/definitions/:id/next-run',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.UPDATE, scheduledTaskMutationActionState),
  ctrl.updateDefinitionNextRun
);

router.post(
  '/definitions/:id/run-now',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.START),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASKS, OPERATIONS.START, scheduledTaskMutationActionState),
  ctrl.runDefinitionNow
);

router.get(
  '/runs',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASK_RUNS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASK_RUNS, OPERATIONS.READ_ALL),
  ctrl.showRunList
);

router.post(
  '/runs/:id/cancel',
  requireAccess(SECTIONS.AUTO_SCHEDULED_TASK_RUNS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.AUTO_SCHEDULED_TASK_RUNS, OPERATIONS.UPDATE, scheduledTaskMutationActionState),
  ctrl.cancelRun
);

router.get(
  '/outbox/prepare-conflicts',
  requireAccess(SECTIONS.EMAIL_OUTBOX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.EMAIL_OUTBOX, OPERATIONS.READ_ALL),
  ctrl.getPrepareConflicts
);

router.get(
  '/outbox',
  requireAccess(SECTIONS.EMAIL_OUTBOX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.EMAIL_OUTBOX, OPERATIONS.READ_ALL),
  ctrl.showOutboxList
);

router.post(
  '/outbox/bulk-cancel',
  requireAccess(SECTIONS.EMAIL_OUTBOX, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.EMAIL_OUTBOX, OPERATIONS.UPDATE, scheduledTaskMutationActionState),
  ctrl.bulkCancelOutbox
);

router.post(
  '/outbox/bulk-delete',
  requireAccess(SECTIONS.EMAIL_OUTBOX, OPERATIONS.DELETE),
  trackActionState(SECTIONS.EMAIL_OUTBOX, OPERATIONS.DELETE, scheduledTaskMutationActionState),
  ctrl.bulkDeleteOutbox
);

router.post(
  '/outbox/:id/cancel',
  requireAccess(SECTIONS.EMAIL_OUTBOX, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.EMAIL_OUTBOX, OPERATIONS.UPDATE, scheduledTaskMutationActionState),
  ctrl.cancelOutboxEntry
);

module.exports = router;
