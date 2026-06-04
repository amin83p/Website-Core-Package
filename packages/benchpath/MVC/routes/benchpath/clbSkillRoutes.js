const express = require('express');
const router = express.Router();
const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');
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
