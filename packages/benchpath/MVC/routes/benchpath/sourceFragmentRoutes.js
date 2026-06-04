const express = require('express');
const router = express.Router();
const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');

const ctrl = require('../../controllers/benchpath/sourceFragmentController');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.READ_ALL),
  ctrl.listFragments);
router.get('/new',
  requireAccess(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.CREATE),
  ctrl.showAddForm);
router.post('/new',
  requireAccess(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addFragment);
router.get('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editFragment);
router.get('/delete/:id',
  requireAccess(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.BENCHPATH_SOURCE_FRAGMENTS, OPERATIONS.DELETE),
  ctrl.deleteFragment);

module.exports = router;
