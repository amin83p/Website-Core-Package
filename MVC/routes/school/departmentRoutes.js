// MVC/routes/school/departmentRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/departmentController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.READ_ALL),
  ctrl.listDepartments);

router.get('/api/data',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.READ_ALL),
  ctrl.getDepartmentsApi);

router.get('/help',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.READ_ALL),
  ctrl.showHelp);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.get('/new-wizard',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.CREATE),
  ctrl.showCreateWizardForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveDepartment);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveDepartment);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.DELETE),
  ctrl.deleteDepartment);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_DEPARTMENTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteDepartment);

module.exports = router;
