const express = require('express');
const router = express.Router();

const ctrl = require('../../controllers/benchpath/sourceController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

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
