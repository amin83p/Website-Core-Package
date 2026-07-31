'use strict';

const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const conductRatingScalePolicyModel = require('../../models/school/conductRatingScalePolicyModel');
const { listSchoolSettingsGroups } = require('../../config/schoolSettingsCatalog');
const { userCanUpdateSchoolSettings } = require('../../services/school/schoolSettingsAccessService');

const CONDUCT_LEVEL_CODES = Object.freeze(
  (conductRatingScalePolicyModel.DEFAULT_POLICY?.levels || []).map((row) => String(row.code))
);

function activeOrgIdOrThrow(user) {
  const activeOrgId = String(user?.activeOrgId || '').trim();
  if (!activeOrgId) {
    const error = new Error('Select an active organization before managing School Settings.');
    error.statusCode = 400;
    throw error;
  }
  return activeOrgId;
}

function resolveActiveOrgName(user, activeOrgId) {
  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  const activeOrg = allowedOrgs.find((row) => String(row?.orgId || row?.id || '').trim() === activeOrgId);
  return String(
    activeOrg?.name
    || activeOrg?.orgName
    || activeOrg?.organizationName
    || user?.activeOrgName
    || activeOrgId
  ).trim();
}

function defaultAttendanceItems() {
  return [{
    scheduledMinutes: attendanceMatrixPolicyModel.DEFAULT_POLICY.scheduledMinutes,
    disqualifyLateMinutes: attendanceMatrixPolicyModel.DEFAULT_POLICY.disqualifyLateMinutes,
    disqualifyEarlyLeaveMinutes: attendanceMatrixPolicyModel.DEFAULT_POLICY.disqualifyEarlyLeaveMinutes,
    disqualifyCombinedMissedMinutes: attendanceMatrixPolicyModel.DEFAULT_POLICY.disqualifyCombinedMissedMinutes,
    id: '',
    isDefault: true
  }];
}

function attendanceFlag(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function validateConductLevelsInput(body = {}) {
  let levels = body?.levels;
  if (typeof levels === 'string') {
    try {
      levels = JSON.parse(levels);
    } catch (_) {
      const error = new Error('Conduct rating levels must be valid JSON.');
      error.statusCode = 400;
      throw error;
    }
  }
  if (!Array.isArray(levels) || levels.length !== CONDUCT_LEVEL_CODES.length) {
    const error = new Error(`Conduct rating levels must include the fixed codes: ${CONDUCT_LEVEL_CODES.join(', ')}.`);
    error.statusCode = 400;
    throw error;
  }
  const submittedCodes = levels.map((row) => String(row?.code || '').trim());
  if (
    new Set(submittedCodes).size !== CONDUCT_LEVEL_CODES.length
    || CONDUCT_LEVEL_CODES.some((code) => !submittedCodes.includes(code))
  ) {
    const error = new Error(`Conduct rating codes are fixed and must be: ${CONDUCT_LEVEL_CODES.join(', ')}.`);
    error.statusCode = 400;
    throw error;
  }
  return levels;
}

function validateAttendanceItemsInput(items) {
  if (!Array.isArray(items) || !items.length) {
    const error = new Error('At least one attendance duration row is required.');
    error.statusCode = 400;
    throw error;
  }
  const defaultCount = items.filter((item) => attendanceFlag(item?.isDefault)).length;
  if (defaultCount !== 1) {
    const error = new Error('Select exactly one default attendance duration row.');
    error.statusCode = 400;
    throw error;
  }
  items.forEach((item, index) => {
    const rowLabel = `Attendance duration row ${index + 1}`;
    const scheduledMinutes = Number(item?.scheduledMinutes);
    const lateMinutes = Number(item?.disqualifyLateMinutes);
    const earlyMinutes = Number(item?.disqualifyEarlyLeaveMinutes);
    if (!Number.isInteger(scheduledMinutes) || scheduledMinutes < 1 || scheduledMinutes > 1440) {
      const error = new Error(`${rowLabel} must have a whole-number duration from 1 to 1440 minutes.`);
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isFinite(lateMinutes) || lateMinutes < 0 || lateMinutes > 1440) {
      const error = new Error(`${rowLabel} must have a late threshold from 0 to 1440 minutes.`);
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isFinite(earlyMinutes) || earlyMinutes < 0 || earlyMinutes > 1440) {
      const error = new Error(`${rowLabel} must have an early-leave threshold from 0 to 1440 minutes.`);
      error.statusCode = 400;
      throw error;
    }
    const combined = item?.disqualifyCombinedMissedMinutes;
    if (combined !== null && combined !== undefined && combined !== '') {
      const combinedMinutes = Number(combined);
      if (!Number.isFinite(combinedMinutes) || combinedMinutes <= 0 || combinedMinutes > 1440) {
        const error = new Error(`${rowLabel} must have a combined threshold from 1 to 1440 minutes.`);
        error.statusCode = 400;
        throw error;
      }
    }
  });
  return items;
}

async function loadSettingsPageData(req) {
  const activeOrgId = activeOrgIdOrThrow(req.user);
  const [
    conductPolicy,
    attendancePolicy,
    attendanceConfig,
    canUpdate
  ] = await Promise.all([
    conductRatingScalePolicyModel.getPolicyForOrg(activeOrgId),
    attendanceMatrixPolicyModel.getPolicyForOrg(activeOrgId),
    attendanceMatrixPolicyModel.getPolicyCatalogForOrg(activeOrgId),
    userCanUpdateSchoolSettings(req.user, req.ip)
  ]);

  return {
    activeOrgId,
    activeOrgName: resolveActiveOrgName(req.user, activeOrgId),
    groups: listSchoolSettingsGroups(),
    canUpdate,
    conductPolicy,
    attendancePolicy,
    attendanceThresholdsEnabled: attendanceConfig.thresholdsEnabled,
    attendanceItems: attendanceConfig.items.length ? attendanceConfig.items : defaultAttendanceItems()
  };
}

async function showSchoolSettings(req, res) {
  try {
    const pageData = await loadSettingsPageData(req);
    return res.render('school/settings/index', {
      title: 'School Settings',
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId,
      ...pageData
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).render('error', {
      title: 'School Settings',
      message: error.message || 'Unable to load School Settings.',
      user: req.user
    });
  }
}

async function saveConductRatingScale(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    validateConductLevelsInput(req.body || {});
    const policy = await conductRatingScalePolicyModel.savePolicyForOrg(
      activeOrgId,
      req.body || {},
      req.user?.id
    );
    return res.json({
      status: 'success',
      message: 'Conduct rating scale settings were updated.',
      policy
    });
  } catch (error) {
    const validationErrors = Array.isArray(error?.validationErrors) ? error.validationErrors : [];
    return res.status(validationErrors.length ? 400 : (Number(error?.statusCode) || 500)).json({
      status: 'error',
      message: validationErrors.length
        ? validationErrors.join(' ')
        : (error?.message || 'Failed to save conduct rating scale settings.'),
      validationErrors
    });
  }
}

async function saveAttendanceMatrix(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    let rawItems;
    try {
      rawItems = attendanceMatrixPolicyModel.parsePolicyItemsFromBody(req.body || {});
      validateAttendanceItemsInput(rawItems);
      attendanceMatrixPolicyModel.normalizePolicyItemsForSave(rawItems);
    } catch (validationError) {
      validationError.statusCode = 400;
      throw validationError;
    }
    const hasThresholdsEnabled = Object.prototype.hasOwnProperty.call(req.body || {}, 'thresholdsEnabled');
    await attendanceMatrixPolicyModel.savePolicyItemsForOrg(
      activeOrgId,
      rawItems,
      req.user?.id,
      hasThresholdsEnabled ? { thresholdsEnabled: attendanceFlag(req.body.thresholdsEnabled) } : {}
    );
    const [config, policy] = await Promise.all([
      attendanceMatrixPolicyModel.getPolicyCatalogForOrg(activeOrgId),
      attendanceMatrixPolicyModel.getPolicyForOrg(activeOrgId)
    ]);
    return res.json({
      status: 'success',
      message: 'Attendance matrix threshold settings were updated.',
      thresholdsEnabled: config.thresholdsEnabled,
      items: config.items,
      policy
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to save attendance matrix threshold settings.'
    });
  }
}

function redirectLegacyConductSettings(_req, res) {
  return res.redirect('/school/settings#conduct-rating-scale');
}

function redirectLegacyAttendanceSettings(_req, res) {
  return res.redirect('/school/settings#attendance-matrix');
}

module.exports = {
  activeOrgIdOrThrow,
  validateConductLevelsInput,
  validateAttendanceItemsInput,
  loadSettingsPageData,
  showSchoolSettings,
  saveConductRatingScale,
  saveAttendanceMatrix,
  redirectLegacyConductSettings,
  redirectLegacyAttendanceSettings
};
