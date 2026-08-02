const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/teachingOutlineController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  ctrl.listDashboard);

router.get('/levels',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  ctrl.listLevels);

router.get('/levels/new',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.CREATE),
  ctrl.showLevelForm);

router.get('/levels/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE),
  ctrl.showLevelForm);

router.post('/levels/new',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveLevel);

router.post('/levels/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveLevel);

router.get('/coverage/class/:classId/student/:personId',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  ctrl.studentCoverage);

router.get('/:skillId/sections',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  ctrl.showSectionTemplateEditor);

router.post('/:skillId/sections',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveSectionTemplate);

router.get('/:skillId/:levelId',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.READ_ALL),
  ctrl.showOutlineEditor);

router.post('/api/save-item',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveOutlineItem);

router.post('/api/toggle-active/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.toggleOutlineItem);

router.post('/api/import-seed',
  requireAccess(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHING_OUTLINES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.importSeed);

module.exports = router;
