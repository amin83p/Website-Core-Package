const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolStudentManagementController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_STUDENT_MANAGEMENT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STUDENT_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.showStudentManagementPage);

router.get('/api/students/search',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STUDENT_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.searchHubStudents);

router.get('/api/students/summary',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STUDENT_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.getHubStudentPopulationSummary);

router.get('/api/students/:studentId/profile',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STUDENT_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.getHubStudentProfile);

router.get('/api/students/:studentId/timeline',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STUDENT_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.getHubStudentTimeline);

module.exports = router;