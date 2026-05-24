const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/teacherController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./pteRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.listActiveTeachers);

router.get('/archived',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.listArchivedTeachers);

router.post('/recover/:id',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverTeacher);

router.get('/picker/persons',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.pickerPersons);

router.get('/picker/courses',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.pickerCourses);

router.get('/picker/teachers',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.pickerTeachers);

router.get('/new',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTeacher);

router.get('/edit/:id',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTeacher);

router.get('/delete/:id',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.DELETE),
  ctrl.archiveTeacher);

router.delete('/delete/:id',
  requireAccess(SECTIONS.PTE_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_TEACHERS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archiveTeacher);

module.exports = router;
