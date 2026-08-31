'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolSettingsController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const settingsMutationActionState = Object.freeze({
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true,
  allowSectionTokenFallback: true
});

router.get('/',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showSchoolSettings);

router.post('/conduct-rating-scale',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveConductRatingScale);

router.get('/attendance-rollup',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showAttendanceRollupFormula);

router.post('/attendance-rollup',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveAttendanceRollupFormula);

router.post('/attendance-matrix',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveAttendanceMatrix);

router.post('/attendance-marks',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveAttendanceMarkAppearance);

router.post('/autosave',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveAutosavePolicy);

router.post('/session-access',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveSessionAccessPolicy);

router.post('/session-access/test-notification/preview',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.previewSessionAccessTestNotification);

router.post('/session-access/test-notification',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.sendSessionAccessTestNotification);

router.get('/session-access/email-template-check',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.checkSessionNotificationEmailTemplate);

router.post('/student-attendance-report',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveStudentAttendanceReportSettings);

module.exports = router;
