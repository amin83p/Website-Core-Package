const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/courseController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./pteRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.READ_ALL),
  ctrl.listCourses);

router.get('/new',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.CREATE),
  ctrl.showForm);

router.get('/edit/:id',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/save',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveCourse);

router.post('/update/:id',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveCourse);

router.post('/archive/:id',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archiveCourse);

router.post('/recover/:id',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverCourse);

router.get('/api/pickers/teachers',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.READ_ALL),
  ctrl.pickerTeachers);

router.get('/api/pickers/students',
  requireAccess(SECTIONS.PTE_COURSES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_COURSES, OPERATIONS.READ_ALL),
  ctrl.pickerStudents);

module.exports = router;
