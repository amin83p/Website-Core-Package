// MVC/routes/school/teacherRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/teacherController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.listTeachers);

router.get('/archived',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.listArchivedTeachers);

router.post('/recover/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverTeacher);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTeacher);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTeacher);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  ctrl.deleteTeacher);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTeacher);

module.exports = router;
