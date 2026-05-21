const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const ctrl = require('../../controllers/benchpath/clbStageController');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.READ_ALL),
  ctrl.listStages);
router.get('/new',
  requireAccess(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.CREATE),
  ctrl.showAddForm);
router.post('/new',
  requireAccess(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addStage);
router.get('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editStage);
router.get('/delete/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.BENCHPATH_CLB_STAGES, OPERATIONS.DELETE),
  ctrl.deleteStage);

module.exports = router;
