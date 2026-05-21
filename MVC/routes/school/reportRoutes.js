const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/reportController');
const upload = require('../../middleware/upload');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const REPORT_NAV_SECTION = SECTIONS.SCHOOL_REPORTS;
const REPORT_TEMPLATE_SECTION = SECTIONS.SCHOOL_REPORTS_TEMPLATE;
const REPORT_ASSIGNMENT_SECTION = SECTIONS.SCHOOL_REPORTS_ASSIGNMENT;
const REPORT_INSTANCE_SECTION = SECTIONS.SCHOOL_REPORTS_INSTANCES;

router.use(requireAuth);

router.get('/',
  requireAccess(REPORT_NAV_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_NAV_SECTION, OPERATIONS.READ_ALL),
  ctrl.showHome);

// Template Designer
router.get('/templates',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.READ_ALL),
  ctrl.listTemplates);

router.get('/templates/new',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  ctrl.showTemplateForm);

router.post('/templates/new',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  upload('reports').single('docxTemplate'),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTemplate);

router.get('/templates/edit/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE),
  ctrl.showTemplateForm);

router.post('/templates/edit/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE),
  upload('reports').single('docxTemplate'),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTemplate);

router.get('/templates/delete/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE),
  ctrl.deleteTemplate);

router.delete('/templates/delete/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTemplate);

// Assignments
router.get('/assignments',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.READ_ALL),
  ctrl.listAssignments);

router.get('/assignments/new',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  ctrl.showAssignmentForm);

router.post('/assignments/new',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveAssignment);

router.get('/assignments/edit/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  ctrl.showAssignmentForm);

router.post('/assignments/edit/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveAssignment);

router.get('/assignments/delete/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE),
  ctrl.deleteAssignment);

router.delete('/assignments/delete/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteAssignment);

// Instances
router.get('/instances',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  ctrl.listInstances);

router.get('/person-reports',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  ctrl.listPersonReports);

router.get('/instances/start/:assignmentId',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.CREATE),
  ctrl.startInstance);

router.get('/instances/edit/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  ctrl.showInstanceEditor);

router.post('/instances/edit/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveInstance);

router.post('/instances/lock/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.lockInstance);

router.get('/instances/export/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  ctrl.exportInstance);

module.exports = router;
