const express = require('express');
const router = express.Router();
const rollingCtrl = require('../controllers/school/classRollingEnrollmentController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const SECTION = SECTIONS.SCHOOL_ROLLING_ENROLLMENT;

router.get('/',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  rollingCtrl.listRollingEnrollmentClasses);

module.exports = router;
