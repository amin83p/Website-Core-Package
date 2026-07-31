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

router.post('/attendance-matrix',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, settingsMutationActionState),
  ctrl.saveAttendanceMatrix);

module.exports = router;
