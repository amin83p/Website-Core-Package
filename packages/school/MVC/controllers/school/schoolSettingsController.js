'use strict';

const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const conductRatingScalePolicyModel = require('../../models/school/conductRatingScalePolicyModel');
const attendanceMarkAppearancePolicyModel = require('../../models/school/attendanceMarkAppearancePolicyModel');
const attendanceMarkAppearanceService = require('../../services/school/attendanceMarkAppearanceService');
const autosavePolicyModel = require('../../models/school/autosavePolicyModel');
const sessionAccessPolicyTaskSyncService = require('../../services/school/sessionAccessPolicyTaskSyncService');
const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
const sessionAccessPolicyService = require('../../services/school/sessionAccessPolicyService');
const sessionUncompletedNotificationService = require('../../services/school/sessionUncompletedNotificationService');
const sessionNotificationDeliveryService = require('../../services/school/sessionNotificationDeliveryService');
const {
  validateSessionNotificationEmailWrapperTemplate,
  WRAPPER_PLACEHOLDER_DEFINITIONS
} = require('../../services/school/sessionNotificationEmailWrapperPlaceholders');
const {
  listBuiltinMappingRows,
  getWrapperContextSources
} = require('../../services/school/sessionNotificationEmailPlaceholderMappingService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const { requireCoreModule } = require('../../services/school/schoolCoreModuleResolver');
const emailManagementService = requireCoreModule('MVC/services/emailManagementService');
const {
  getTodayDateKeyInTimezone,
  resolveDefaultTimezone,
  resolveOrganizationTimezoneFromRow
} = requireCoreModule('MVC/utils/timezoneUtils');
const studentAttendanceReportPolicyModel = require('../../models/school/studentAttendanceReportPolicyModel');
const timesheetParametersPolicyModel = require('../../models/school/timesheetParametersPolicyModel');
const schoolDataService = require('../../services/school/schoolDataService');
const studentAttendanceReportPolicyService = require('../../services/school/studentAttendanceReportPolicyService');
const timesheetParametersPolicyService = require('../../services/school/timesheetParametersPolicyService');
const reportFunderDocxService = require('../../services/school/reportFunderDocxService');
const reportFunderPdfService = require('../../services/school/reportFunderPdfService');
const overallReportService = require('../../services/school/overallReportService');
const { listSchoolSettingsGroups } = require('../../config/schoolSettingsCatalog');
const { listAutosaveSections } = require('../../config/autosaveSectionCatalog');
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

function defaultAttendanceRollupFormula() {
  return { ...attendanceMatrixPolicyModel.DEFAULT_ROLLUP_FORMULA };
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

function validateRollupGraceItemsInput(items) {
  if (!Array.isArray(items) || !items.length) {
    const error = new Error('At least one session duration row is required for rollup grace settings.');
    error.statusCode = 400;
    throw error;
  }
  items.forEach((item, index) => {
    const rowLabel = `Rollup grace row ${index + 1}`;
    const scheduledMinutes = Number(item?.scheduledMinutes);
    if (!Number.isInteger(scheduledMinutes) || scheduledMinutes < 1 || scheduledMinutes > 1440) {
      const error = new Error(`${rowLabel} must reference a whole-number duration from 1 to 1440 minutes.`);
      error.statusCode = 400;
      throw error;
    }
    const lateGrace = Number(item?.rollupLateGraceMinutes);
    if (!Number.isFinite(lateGrace) || lateGrace < 0 || lateGrace > 1440) {
      const error = new Error(`${rowLabel} must have a late grace from 0 to 1440 minutes.`);
      error.statusCode = 400;
      throw error;
    }
    const earlyGrace = Number(item?.rollupEarlyLeaveGraceMinutes);
    if (!Number.isFinite(earlyGrace) || earlyGrace < 0 || earlyGrace > 1440) {
      const error = new Error(`${rowLabel} must have an early-leave grace from 0 to 1440 minutes.`);
      error.statusCode = 400;
      throw error;
    }
  });
  return items;
}

function parseGraceItemsFromBody(body = {}) {
  let rawItems = body?.graceItems;
  if (typeof rawItems === 'string' && rawItems.trim()) {
    try {
      rawItems = JSON.parse(rawItems);
    } catch (_) {
      throw new Error('Rollup grace items must be valid JSON.');
    }
  }
  if (!Array.isArray(rawItems)) {
    rawItems = attendanceMatrixPolicyModel.parsePolicyItemsFromBody(body);
  }
  return rawItems;
}

async function mergeThresholdItemsPreservingGrace(activeOrgId, rawItems) {
  const existingConfig = await attendanceMatrixPolicyModel.getPolicyCatalogForOrg(activeOrgId);
  const existingItems = Array.isArray(existingConfig.items) ? existingConfig.items : [];
  const graceByDuration = new Map(
    existingItems.map((row) => [Number(row.scheduledMinutes), row])
  );
  const graceById = new Map(
    existingItems.map((row) => [String(row.id || '').trim(), row]).filter(([id]) => id)
  );
  return rawItems.map((item) => {
    const id = String(item?.id || '').trim();
    const mins = Number(item.scheduledMinutes);
    const existing = (id && graceById.get(id)) || graceByDuration.get(mins) || null;
    return {
      ...item,
      rollupLateGraceMinutes: Number(existing?.rollupLateGraceMinutes) || 0,
      rollupEarlyLeaveGraceMinutes: Number(existing?.rollupEarlyLeaveGraceMinutes) || 0
    };
  });
}

async function resolveStudentAttendanceReportLabels(policy = {}, reqUser) {
  const reportTemplate = policy.reportTemplateId
    ? await schoolDataService.getDataById('reportTemplates', policy.reportTemplateId, reqUser)
    : null;
  const overallIds = studentAttendanceReportPolicyService.normalizeIdList(
    policy.overallReportTemplateIds,
    policy.overallReportTemplateId
  );
  const overallReportTemplateLabels = [];
  for (const overallId of overallIds) {
    // eslint-disable-next-line no-await-in-loop
    const template = await schoolDataService.getDataById('overallReportTemplates', overallId, reqUser);
    overallReportTemplateLabels.push({
      id: overallId,
      label: studentAttendanceReportPolicyService.formatTemplateLabel(template, overallId),
      hasDocx: overallReportService.templateHasAttachedDocx(template),
      hasPdf: overallReportService.templateHasAttachedPdf(template)
    });
  }
  return {
    reportTemplateLabel: studentAttendanceReportPolicyService.formatTemplateLabel(
      reportTemplate,
      policy.reportTemplateId
    ),
    reportTemplateCapabilities: {
      hasDocx: reportFunderDocxService.templateHasAnyDocx(reportTemplate),
      hasPdf: reportFunderPdfService.templateHasAnyPdf(reportTemplate)
    },
    overallReportTemplateLabel: overallReportTemplateLabels[0]?.label || '',
    overallReportTemplateLabels
  };
}

function emailTemplateHasBodyContentSlot(template = {}) {
  return validateSessionNotificationEmailWrapperTemplate(template).hasBodyContentSlot;
}

async function resolveEmailTemplateWrapperWarnings(templateId = '', reqUser = null) {
  const normalizedTemplateId = String(templateId || '').trim();
  if (!normalizedTemplateId) return [];
  try {
    const template = await emailManagementService.getTemplateById(normalizedTemplateId, reqUser);
    if (!template) return [];
    return validateSessionNotificationEmailWrapperTemplate(template).warnings;
  } catch (_) {
    return [];
  }
}

async function resolveEmailTemplateBodyContentWarning(templateId = '', reqUser = null) {
  const warnings = await resolveEmailTemplateWrapperWarnings(templateId, reqUser);
  return warnings.length ? warnings.join(' ') : null;
}

async function enrichSessionAccessPolicyForView(policy = {}, reqUser = null) {
  const resolved = sessionAccessPolicyService.resolvePolicy(policy);
  const emailChannel = resolved?.uncompletedSessionNotification?.channels?.email || {};
  const templateId = String(emailChannel.emailTemplateId || '').trim();
  const bodyContentWarning = await resolveEmailTemplateBodyContentWarning(templateId, reqUser);
  if (!templateId) {
    return {
      ...resolved,
      uncompletedSessionNotification: {
        ...resolved.uncompletedSessionNotification,
        channels: {
          ...resolved.uncompletedSessionNotification.channels,
          email: {
            ...emailChannel,
            emailTemplateMissingBodyContentSlot: false,
            emailTemplateBodyContentWarning: bodyContentWarning || ''
          }
        }
      }
    };
  }
  try {
    const template = await emailManagementService.getTemplateById(templateId, reqUser);
    if (!template) {
      return {
        ...resolved,
        uncompletedSessionNotification: {
          ...resolved.uncompletedSessionNotification,
          channels: {
            ...resolved.uncompletedSessionNotification.channels,
            email: {
              ...emailChannel,
              emailTemplateMissingBodyContentSlot: true,
              emailTemplateBodyContentWarning: bodyContentWarning || ''
            }
          }
        }
      };
    }
    return {
      ...resolved,
      uncompletedSessionNotification: {
        ...resolved.uncompletedSessionNotification,
        channels: {
          ...resolved.uncompletedSessionNotification.channels,
          email: {
            ...emailChannel,
            emailTemplateLabel: String(template.eventLabel || template.subjectTemplate || template.id || templateId).trim(),
            emailTemplateMissingBodyContentSlot: !emailTemplateHasBodyContentSlot(template),
            emailTemplateBodyContentWarning: bodyContentWarning || ''
          }
        }
      }
    };
  } catch (_) {
    return {
      ...resolved,
      uncompletedSessionNotification: {
        ...resolved.uncompletedSessionNotification,
        channels: {
          ...resolved.uncompletedSessionNotification.channels,
          email: {
            ...emailChannel,
            emailTemplateMissingBodyContentSlot: false,
            emailTemplateBodyContentWarning: bodyContentWarning || ''
          }
        }
      }
    };
  }
}

async function loadSettingsPageData(req) {
  const activeOrgId = activeOrgIdOrThrow(req.user);
  const [
    conductPolicy,
    attendancePolicy,
    attendanceConfig,
    attendanceMarkAppearancePolicy,
    autosavePolicy,
    sessionAccessPolicy,
    studentAttendanceReportPolicy,
    timesheetParametersPolicy,
    canUpdate
  ] = await Promise.all([
    conductRatingScalePolicyModel.getPolicyForOrg(activeOrgId),
    attendanceMatrixPolicyModel.getPolicyForOrg(activeOrgId),
    attendanceMatrixPolicyModel.getPolicyCatalogForOrg(activeOrgId),
    attendanceMarkAppearancePolicyModel.getPolicyForOrg(activeOrgId),
    autosavePolicyModel.getPolicyForOrg(activeOrgId),
    sessionAccessPolicyModel.getPolicyForOrg(activeOrgId),
    studentAttendanceReportPolicyModel.getPolicyForOrg(activeOrgId),
    timesheetParametersPolicyModel.getPolicyForOrg(activeOrgId),
    userCanUpdateSchoolSettings(req.user, req.ip)
  ]);
  const studentAttendanceReportLabels = await resolveStudentAttendanceReportLabels(
    studentAttendanceReportPolicy,
    req.user
  );
  const enrichedSessionAccessPolicy = await enrichSessionAccessPolicyForView(sessionAccessPolicy, req.user);

  return {
    activeOrgId,
    activeOrgName: resolveActiveOrgName(req.user, activeOrgId),
    groups: listSchoolSettingsGroups(),
    canUpdate,
    conductPolicy,
    attendancePolicy,
    attendanceThresholdsEnabled: attendanceConfig.thresholdsEnabled,
    attendanceItems: attendanceConfig.items.length ? attendanceConfig.items : defaultAttendanceItems(),
    attendanceMarkAppearancePolicy,
    attendanceMarkCuratedIcons: attendanceMarkAppearanceService.CURATED_ICONS,
    rollupFormula: attendanceConfig.rollupFormula || defaultAttendanceRollupFormula(),
    autosavePolicy,
    sessionAccessPolicy: enrichedSessionAccessPolicy,
    sessionNotificationEmailTokens: sessionAccessPolicyService.TEMPLATE_TOKENS,
    sessionNotificationEmailWrapperTokens: WRAPPER_PLACEHOLDER_DEFINITIONS,
    sessionNotificationEmailWrapperBuiltinMappings: listBuiltinMappingRows(),
    sessionNotificationEmailContextSources: getWrapperContextSources(),
    sessionNotificationEmailDefaultBody: sessionAccessPolicyService.DEFAULT_POLICY
      .uncompletedSessionNotification.channels.email.bodyTemplate,
    autosaveSections: listAutosaveSections(),
    studentAttendanceReportPolicy,
    timesheetParametersPolicy,
    studentAttendanceReportTemplateLabel: studentAttendanceReportLabels.reportTemplateLabel,
    studentAttendanceReportTemplateCapabilities: studentAttendanceReportLabels.reportTemplateCapabilities,
    studentAttendanceReportOverallLabel: studentAttendanceReportLabels.overallReportTemplateLabel,
    studentAttendanceReportOverallLabels: studentAttendanceReportLabels.overallReportTemplateLabels
  };
}

async function showSchoolSettings(req, res) {
  try {
    const pageData = await loadSettingsPageData(req);
    return res.render('school/settings/index', {
      title: 'School Settings',
      includeModal: true,
      includeGenericPicker: true,
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

function showAttendanceRollupFormula(_req, res) {
  return res.redirect('/school/settings#attendance-rollup');
}

async function saveAttendanceRollupFormula(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    const rollupFormula = attendanceMatrixPolicyModel.parseRollupFormulaFromBody(req.body || {});
    let graceItems;
    try {
      graceItems = parseGraceItemsFromBody(req.body || {});
      validateRollupGraceItemsInput(graceItems);
    } catch (validationError) {
      validationError.statusCode = 400;
      throw validationError;
    }
    const config = await attendanceMatrixPolicyModel.saveRollupFormulaForOrg(
      activeOrgId,
      rollupFormula,
      graceItems,
      req.user?.id
    );
    return res.json({
      status: 'success',
      message: 'Attendance rollup formula settings were updated.',
      rollupFormula: config.rollupFormula,
      graceItems: config.items
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to save attendance rollup formula settings.'
    });
  }
}

async function saveAttendanceMarkAppearance(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    const policy = await attendanceMarkAppearancePolicyModel.savePolicyForOrg(
      activeOrgId,
      req.body || {},
      req.user?.id
    );
    return res.json({
      status: 'success',
      message: 'Attendance mark settings were updated.',
      policy
    });
  } catch (error) {
    const validationErrors = Array.isArray(error?.validationErrors) ? error.validationErrors : [];
    return res.status(validationErrors.length ? 400 : (Number(error?.statusCode) || 500)).json({
      status: 'error',
      message: validationErrors.length
        ? validationErrors.join(' ')
        : (error?.message || 'Failed to save attendance mark settings.'),
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
      rawItems = await mergeThresholdItemsPreservingGrace(activeOrgId, rawItems);
      attendanceMatrixPolicyModel.normalizePolicyItemsForSave(rawItems);
    } catch (validationError) {
      validationError.statusCode = 400;
      throw validationError;
    }
    const hasThresholdsEnabled = Object.prototype.hasOwnProperty.call(req.body || {}, 'thresholdsEnabled');
    const saveOptions = {};
    if (hasThresholdsEnabled) {
      saveOptions.thresholdsEnabled = attendanceFlag(req.body.thresholdsEnabled);
    }
    await attendanceMatrixPolicyModel.savePolicyItemsForOrg(
      activeOrgId,
      rawItems,
      req.user?.id,
      saveOptions
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

async function saveStudentAttendanceReportSettings(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    const normalized = await studentAttendanceReportPolicyService.validatePolicyInput(req.body || {}, req.user);
    const policy = await studentAttendanceReportPolicyModel.savePolicyForOrg(
      activeOrgId,
      normalized,
      req.user?.id
    );
    const labels = await resolveStudentAttendanceReportLabels(policy, req.user);
    return res.json({
      status: 'success',
      message: 'Student Attendance Report settings were updated.',
      policy,
      reportTemplateLabel: labels.reportTemplateLabel,
      reportTemplateCapabilities: labels.reportTemplateCapabilities,
      overallReportTemplateLabel: labels.overallReportTemplateLabel,
      overallReportTemplateLabels: labels.overallReportTemplateLabels
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to save Student Attendance Report settings.'
    });
  }
}

async function resolveOrgTimeZone(orgId) {
  try {
    const organizationModel = requireCoreModule('MVC/models/organizationModel');
    const row = await organizationModel.getOrganizationById(orgId);
    if (row) return resolveOrganizationTimezoneFromRow(row);
  } catch (_) {
    // Fall back to default timezone when organization lookup is unavailable.
  }
  return resolveDefaultTimezone();
}

async function saveSessionAccessPolicy(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    const policy = await sessionAccessPolicyModel.savePolicyForOrg(
      activeOrgId,
      req.body || {},
      req.user?.id
    );
    await sessionAccessPolicyTaskSyncService.syncSessionAccessPolicyTasks(activeOrgId, policy);
    const enrichedPolicy = await enrichSessionAccessPolicyForView(policy, req.user);
    return res.json({
      status: 'success',
      message: 'Session access settings were updated.',
      policy: enrichedPolicy
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to save session access settings.'
    });
  }
}

async function buildSessionAccessTestNotificationRequest(req) {
  const activeOrgId = activeOrgIdOrThrow(req.user);
  const teacherId = String(req.body?.teacherId || '').trim();
  if (!teacherId) {
    const error = new Error('Select a teacher before sending a test email.');
    error.statusCode = 400;
    throw error;
  }

  const policy = req.body?.policy
    ? sessionAccessPolicyService.validatePolicyInput(req.body)
    : await sessionAccessPolicyModel.getPolicyForOrg(activeOrgId);
  if (policy?.uncompletedSessionNotification?.channels?.email?.enabled !== true) {
    const error = new Error('Enable email notifications before sending a test email.');
    error.statusCode = 400;
    throw error;
  }

  const teacher = await schoolPersonAccessService.getPersonById({
    reqUser: req.user,
    personId: teacherId
  }).catch(() => null);
  if (!teacher) {
    const error = new Error('Selected teacher was not found.');
    error.statusCode = 404;
    throw error;
  }

  const orgTimeZone = await resolveOrgTimeZone(activeOrgId);
  const throughDate = getTodayDateKeyInTimezone(orgTimeZone, Date.now());
  const emailChannel = policy?.uncompletedSessionNotification?.channels?.email || {};
  const sessionDateRange = emailChannel.sessionDateRange || {};
  const { fromDate } = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId: activeOrgId,
    throughDate,
    rangeType: sessionDateRange.type,
    daysBeforeToday: sessionDateRange.daysBeforeToday
  });
  const rangeLabel = sessionUncompletedNotificationService.describeSessionDateRange(sessionDateRange);
  const { sessions, usedSampleData } = await sessionUncompletedNotificationService.resolveTeacherSessionsForDigest({
    orgId: activeOrgId,
    teacherId,
    fromDate,
    throughDate,
    reqUser: req.user
  });

  const orgName = resolveActiveOrgName(req.user, activeOrgId);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const context = sessionUncompletedNotificationService.buildDigestContext({
    teacher,
    sessions,
    orgName,
    baseUrl
  });

  const bodyContentWarning = await resolveEmailTemplateBodyContentWarning(
    emailChannel.emailTemplateId,
    req.user
  );
  const warnings = bodyContentWarning ? [bodyContentWarning] : [];

  return {
    activeOrgId,
    teacherId,
    policy,
    teacher,
    context,
    sessions,
    usedSampleData,
    warnings,
    fromDate,
    throughDate,
    rangeLabel
  };
}

function assertSessionAccessTestEmailOutcome(outcome) {
  if (outcome?.status === 'skipped_email_not_configured') {
    const error = new Error('Email delivery is not configured. Configure Resend before sending test emails.');
    error.statusCode = 503;
    throw error;
  }
  if (outcome?.status === 'skipped_no_contact') {
    const error = new Error('Selected teacher does not have an email address on file.');
    error.statusCode = 400;
    throw error;
  }
}

function buildSessionAccessTestEmailPreviewMessage(usedSampleData, rangeLabel) {
  return usedSampleData
    ? `This preview uses sample session data because this teacher has no uncompleted sessions for ${rangeLabel}.`
    : `This preview uses this teacher's uncompleted sessions for ${rangeLabel}.`;
}

function buildSessionAccessTestEmailSentMessage(usedSampleData, rangeLabel) {
  return usedSampleData
    ? `Test email sent using sample session data because this teacher has no uncompleted sessions for ${rangeLabel}.`
    : `Test email sent using this teacher's uncompleted sessions for ${rangeLabel}.`;
}

async function previewSessionAccessTestNotification(req, res) {
  try {
    const data = await buildSessionAccessTestNotificationRequest(req);
    const outcome = await sessionNotificationDeliveryService.previewDigestEmailNotification({
      policy: data.policy,
      teacher: data.teacher,
      context: data.context,
      orgId: data.activeOrgId,
      subjectPrefix: '[TEST] '
    });
    assertSessionAccessTestEmailOutcome(outcome);
    if (outcome.status !== 'preview') {
      const error = new Error('Unable to build the test email preview.');
      error.statusCode = 500;
      throw error;
    }

    return res.json({
      status: 'success',
      message: buildSessionAccessTestEmailPreviewMessage(data.usedSampleData, data.rangeLabel),
      recipient: outcome.recipient,
      subject: outcome.subject,
      preview: {
        html: outcome.html,
        text: outcome.text
      },
      sessionCount: data.sessions.length,
      usedSampleData: data.usedSampleData,
      dateRange: { fromDate: data.fromDate, throughDate: data.throughDate, label: data.rangeLabel },
      warnings: data.warnings
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to preview session access test email.'
    });
  }
}

async function sendSessionAccessTestNotification(req, res) {
  try {
    const data = await buildSessionAccessTestNotificationRequest(req);

    const outcome = await sessionNotificationDeliveryService.sendDigestEmailNotification({
      policy: data.policy,
      teacher: data.teacher,
      context: data.context,
      orgId: data.activeOrgId,
      subjectPrefix: '[TEST] '
    });

    assertSessionAccessTestEmailOutcome(outcome);
    if (outcome.status !== 'sent') {
      const error = new Error('Unable to send the test email.');
      error.statusCode = 500;
      throw error;
    }

    return res.json({
      status: 'success',
      message: buildSessionAccessTestEmailSentMessage(data.usedSampleData, data.rangeLabel),
      sessionCount: data.sessions.length,
      usedSampleData: data.usedSampleData,
      recipient: outcome.recipient
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to send session access test email.'
    });
  }
}

async function checkSessionNotificationEmailTemplate(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    const templateId = String(req.query?.templateId || '').trim();
    const policy = await sessionAccessPolicyModel.getPolicyForOrg(activeOrgId);
    const customMappings = policy?.uncompletedSessionNotification?.channels?.email?.wrapperPlaceholderMappings || [];
    let validation = {
      hasBodyContentSlot: false,
      warnings: [],
      unsupportedTokens: []
    };
    if (templateId) {
      const template = await emailManagementService.getTemplateById(templateId, req.user);
      if (template) {
        validation = validateSessionNotificationEmailWrapperTemplate(template, { customMappings });
      }
    }
    const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
    return res.json({
      status: 'success',
      templateId,
      hasBodyContentSlot: validation.hasBodyContentSlot === true,
      warnings,
      unsupportedTokens: Array.isArray(validation.unsupportedTokens) ? validation.unsupportedTokens : [],
      warning: warnings.join(' ')
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Unable to check email template.'
    });
  }
}

async function saveTimesheetParametersPolicy(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    const normalized = timesheetParametersPolicyService.validatePolicyInput(req.body || {});
    const policy = await timesheetParametersPolicyModel.savePolicyForOrg(
      activeOrgId,
      normalized,
      req.user?.id
    );
    return res.json({
      status: 'success',
      message: 'Timesheet Parameters settings were updated.',
      policy
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to save Timesheet Parameters settings.'
    });
  }
}

async function saveAutosavePolicy(req, res) {
  try {
    const activeOrgId = activeOrgIdOrThrow(req.user);
    const policy = await autosavePolicyModel.savePolicyForOrg(
      activeOrgId,
      req.body || {},
      req.user?.id
    );
    return res.json({
      status: 'success',
      message: 'Autosave settings were updated.',
      policy
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      status: 'error',
      message: error?.message || 'Failed to save autosave settings.'
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
  validateRollupGraceItemsInput,
  loadSettingsPageData,
  showSchoolSettings,
  showAttendanceRollupFormula,
  saveConductRatingScale,
  saveAttendanceMarkAppearance,
  saveAttendanceMatrix,
  saveAttendanceRollupFormula,
  saveStudentAttendanceReportSettings,
  saveTimesheetParametersPolicy,
  saveAutosavePolicy,
  saveSessionAccessPolicy,
  previewSessionAccessTestNotification,
  sendSessionAccessTestNotification,
  checkSessionNotificationEmailTemplate,
  redirectLegacyConductSettings,
  redirectLegacyAttendanceSettings
};
