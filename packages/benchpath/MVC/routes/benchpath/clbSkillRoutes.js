const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const ctrl = require('../../controllers/benchpath/clbSkillController');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.READ_ALL),
  ctrl.listSkills);
router.get('/new',
  requireAccess(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.CREATE),
  ctrl.showAddForm);
router.post('/new',
  requireAccess(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addSkill);
router.get('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editSkill);
router.get('/delete/:id',
  requireAccess(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.BENCHPATH_CLB_SKILLS, OPERATIONS.DELETE),
  ctrl.deleteSkill);

module.exports = router;
