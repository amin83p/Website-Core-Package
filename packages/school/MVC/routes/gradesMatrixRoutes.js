const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/gradesMatrixController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get(
  '/',
  requireAccess(SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.READ_ALL),
  ctrl.showGradesMatrixPage
);

router.get(
  '/api/data',
  requireAccess(SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_GRADEBOOK, OPERATIONS.READ_ALL),
  ctrl.getGradesMatrixData
);

module.exports = router;
