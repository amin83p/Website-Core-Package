const express = require('express');
const router = express.Router();
const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');

const ctrl = require('../../controllers/benchpath/sourceController');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.READ_ALL),
  ctrl.listSources);
router.get('/new',
  requireAccess(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.CREATE),
  ctrl.showAddForm);
router.post('/new',
  requireAccess(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addSource);
router.get('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editSource);
router.get('/delete/:id',
  requireAccess(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.BENCHPATH_SOURCES, OPERATIONS.DELETE),
  ctrl.deleteSource);

module.exports = router;
