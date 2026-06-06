const express = require('express');
const router = express.Router();
const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');

const ctrl = require('../../controllers/benchpath/taskController');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ_ALL),
  ctrl.listTasks);

router.get('/new-wizard',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.CREATE),
  ctrl.redirectNewWizardRoot);

router.get('/new-wizard/:step',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.CREATE),
  ctrl.showNewWizardStep);

router.post('/new-wizard/:step',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.CREATE, { requireToken: true, keepActive: true }),
  ctrl.postNewWizardStep);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.UPDATE),
  ctrl.redirectEditWizardRoot);

router.get('/edit-wizard/:id/:step',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.UPDATE),
  ctrl.showEditWizardStep);

router.post('/edit-wizard/:id/:step',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }),
  ctrl.postEditWizardStep);

router.get('/view/:id',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  ctrl.viewTask);

router.get('/package/:id',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  ctrl.viewTaskPackage);

router.get('/package/:id/learner',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  ctrl.viewTaskPackageLearner);

router.get('/package/:id/assessment',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  ctrl.viewTaskPackageAssessment);

router.get('/package/:id/pbla-record',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.READ),
  ctrl.viewTaskPackagePblaRecord);

router.get('/delete/:id',
  requireAccess(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.DELETE),
  trackActionState(SECTIONS.BENCHPATH_TASK_AUTHORING, OPERATIONS.DELETE),
  ctrl.deleteTask);

module.exports = router;
