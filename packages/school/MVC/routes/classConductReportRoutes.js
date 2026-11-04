const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/classConductReportController');
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
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ, { keepActive: true }),
  ctrl.showClassConductReportPage
);

router.get(
  '/api/data',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ, { keepActive: true }),
  ctrl.getClassConductReportData
);

router.post(
  '/api/data-async',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ, { keepActive: true }),
  ctrl.startClassConductReportDataJob
);

router.get(
  '/api/report-jobs/:jobId',
  requireAccess(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, OPERATIONS.READ, { keepActive: true }),
  ctrl.getClassConductReportDataJob
);

module.exports = router;
