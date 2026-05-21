const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const ctrl = require('../../controllers/benchpath/clbFrameworkController');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.READ_ALL),
  ctrl.listFrameworks);
router.get('/new',
  requireAccess(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.CREATE),
  ctrl.showAddForm);
router.post('/new',
  requireAccess(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addFramework);
router.get('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editFramework);
router.get('/delete/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.DELETE),
  trackActionState(SECTIONS.BENCHPATH_CLB_FRAMEWORK, OPERATIONS.DELETE),
  ctrl.deleteFramework);

module.exports = router;
