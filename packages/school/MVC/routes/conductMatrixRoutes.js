const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/conductMatrixController');
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
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.showConductMatrixPage
);

router.get(
  '/api/data',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX, OPERATIONS.READ_ALL),
  ctrl.getConductMatrixData
);

module.exports = router;
