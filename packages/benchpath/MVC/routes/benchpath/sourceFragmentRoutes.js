const express = require('express');
const router = express.Router();

const ctrl = require('../../controllers/benchpath/sourceFragmentController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

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
