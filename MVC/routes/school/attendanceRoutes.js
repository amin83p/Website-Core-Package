// MVC/routes/school/attendanceRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/attendanceController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { requireAttendanceMatrixPolicyAdmin } = require('../../middleware/attendanceMatrixPolicyAdminMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/settings',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showAttendanceMatrixSettings);

router.post('/settings',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveAttendanceMatrixSettings);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  ctrl.showAttendancePage);

router.get('/api/data',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  ctrl.getAttendanceData);

// NEW: Save an interactive comment/note
router.post('/api/comment',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.addAttendanceComment);

router.post('/api/update-roster-cell',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.updateAttendanceRosterCell);

module.exports = router;
