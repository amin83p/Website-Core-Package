'use strict';

const crypto = require('crypto');
const schoolRepositories = require('../../repositories/school');
const schoolDataService = require('./schoolDataService');
const classEnrollmentPeriodService = require('./classEnrollmentPeriodService');
const classCycleEnrollmentPolicyService = require('./classCycleEnrollmentPolicyService');
const classSessionCapacityService = require('./classSessionCapacityService');
const registrationStatusLifecycleService = require('./registrationStatusLifecycleService');
const rollingEnrollmentEngineService = require('./rollingEnrollmentEngineService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const OPEN_STATUSES = new Set(['draft', 'planned', 'to_be_confirmed', 'waiting_list', 'active']);
const CLOSE_STATUSES = new Set(['completed']);

let dependencies = {
  repositories: schoolRepositories,
  enrollmentPeriodService: classEnrollmentPeriodService,
  schoolDataService,
  registrationStatusLifecycleService,
  rollingEnrollmentEngineService
};

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeClassBillingMode(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'no_charge' || token === 'chargeable') return token;
  return 'chargeable';
}

function isRollingClass(classRow) {
  return classSessionCapacityService.getClassRegistrationModeKey(classRow) === 'rolling';
}

function isClosedForNewEnrollment(classRow) {
  return classRow?.isClosedForNewEnrollment === true
    || String(classRow?.isClosedForNewEnrollment || '').trim().toLowerCase() === 'true';
}

function buildPreviewHash(normalizedPayload) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizedPayload)).digest('hex');
}

function normalizeMovePayload(raw = {}, sourcePeriod = {}) {
  const funder = rollingEnrollmentFunderService.normalizeEnrollmentFunderSelection(
    raw?.target?.funder && typeof raw.target.funder === 'object'
      ? raw.target.funder
      : { funderId: raw?.target?.funderId || raw?.funderId, funderType: raw?.target?.funderType || raw?.funderType }
  );
  const targetClassId = toPublicId(raw?.target?.classId || raw?.targetClassId || '');
  const closeEffectiveDate = normalizeDateOnly(raw?.close?.effectiveDate || raw?.closeEffectiveDate || raw?.effectiveDate || '');
  const closeReason = String(raw?.close?.reason || raw?.closeReason || raw?.reasonEnd || '').trim();
  const targetStartDate = normalizeDateOnly(raw?.target?.startDate || raw?.targetStartDate || raw?.startDate || '');
  const targetEndDate = normalizeDateOnly(raw?.target?.endDate || raw?.targetEndDate || raw?.endDate || '');
  const targetReasonStart = String(raw?.target?.reasonStart || raw?.reasonStart || '').trim();
  const targetNotes = String(raw?.target?.notes || raw?.notes || '').trim();
  const targetStatus = String(raw?.target?.status || raw?.targetStatus || 'active').trim().toLowerCase() || 'active';
  const claimNumber = String(raw?.target?.claimNumber || raw?.claimNumber || sourcePeriod?.claimNumber || '').trim();
  const sessionCountPolicy = classEnrollmentSessionApplicabilityService.normalizeSessionCountPolicy(
    raw?.target?.sessionCountPolicy || raw?.sessionCountPolicy || sourcePeriod?.sessionCountPolicy || 'all_non_na'
  );

  return {
    close: {
      effectiveDate: closeEffectiveDate,
      targetStatus: 'completed',
      reason: closeReason
    },
    target: {
      classId: targetClassId,
      studentId: toPublicId(sourcePeriod?.studentId || raw?.target?.studentId || raw?.studentId || ''),
      startDate: targetStartDate,
      endDate: targetEndDate,
      targetSessionCount: raw?.target?.targetSessionCount ?? raw?.targetSessionCount ?? 0,
      targetHours: raw?.target?.targetHours ?? raw?.targetHours ?? 0,
      funder,
      reasonStart: targetReasonStart,
      notes: targetNotes,
      status: targetStatus,
      claimNumber,
      sessionCountPolicy,
      programId: toPublicId(raw?.target?.programId || raw?.programId || sourcePeriod?.programId || ''),
      termId: toPublicId(raw?.target?.termId || raw?.termId || sourcePeriod?.termId || ''),
      programRegistrationId: toPublicId(raw?.target?.programRegistrationId || raw?.programRegistrationId || sourcePeriod?.programRegistrationId || ''),
      sessionCapacityType: raw?.target?.sessionCapacityType || raw?.sessionCapacityType || sourcePeriod?.sessionCapacityType || 'group'
    }
  };
}

function assertMovePayloadBasics(normalized, sourcePeriod, sourceClass, targetClass) {
  const blockers = [];
  if (!normalized.close.effectiveDate) blockers.push({ code: 'CLOSE_DATE_REQUIRED', message: 'Close end date is required.' });
  if (!normalized.close.reason) blockers.push({ code: 'CLOSE_REASON_REQUIRED', message: 'Close reason is required.' });
  if (!CLOSE_STATUSES.has(normalized.close.targetStatus)) {
    blockers.push({ code: 'CLOSE_STATUS_INVALID', message: 'Move enrollment always closes the source enrollment as completed.' });
  }
  if (!normalized.target.classId) blockers.push({ code: 'TARGET_CLASS_REQUIRED', message: 'Target class is required.' });
  if (!normalized.target.startDate) blockers.push({ code: 'TARGET_START_REQUIRED', message: 'Target enrollment start date is required.' });
  if (!normalized.target.reasonStart) blockers.push({ code: 'TARGET_REASON_REQUIRED', message: 'Target enrollment reason is required.' });
  if (normalized.target.classId && idsEqual(normalized.target.classId, sourcePeriod?.classId)) {
    blockers.push({ code: 'SAME_CLASS', message: 'Target class must be different from the current class.' });
  }
  const sourceStart = normalizeDateOnly(sourcePeriod?.startDate);
  if (normalized.close.effectiveDate && sourceStart && normalized.close.effectiveDate < sourceStart) {
    blockers.push({ code: 'CLOSE_BEFORE_START', message: 'Close end date cannot be before the enrollment start date.' });
  }
  if (normalized.target.startDate && normalized.close.effectiveDate && normalized.target.startDate < normalized.close.effectiveDate) {
    blockers.push({ code: 'TARGET_BEFORE_CLOSE', message: 'Target enrollment start date cannot be before the close end date.' });
  }
  if (!OPEN_STATUSES.has(String(sourcePeriod?.status || '').trim().toLowerCase())) {
    blockers.push({ code: 'SOURCE_NOT_OPEN', message: 'Only open enrollment periods can be moved.' });
  }
  if (targetClass && !isRollingClass(targetClass)) {
    blockers.push({ code: 'TARGET_NOT_ROLLING', message: 'Target class must use rolling enrollment.' });
  }
  if (targetClass && sourceClass && !idsEqual(targetClass.orgId, sourceClass.orgId)) {
    blockers.push({ code: 'ORG_MISMATCH', message: 'Target class must belong to the same organization.' });
  }
  if (targetClass && isClosedForNewEnrollment(targetClass)) {
    blockers.push({ code: 'TARGET_CLOSED', message: 'Target class cycle is closed for new enrollment.' });
  }
  return blockers;
}

async function listMoveTargetClasses({
  sourceClassId,
  studentId = '',
  orgId,
  reqUser
} = {}) {
  const normalizedSourceClassId = toPublicId(sourceClassId);
  const normalizedOrgId = toPublicId(orgId);
  if (!normalizedSourceClassId || !normalizedOrgId) return [];

  const classes = await dependencies.schoolDataService.fetchAllData('classes', {}, reqUser);
  return (Array.isArray(classes) ? classes : [])
    .filter((row) => idsEqual(row?.orgId, normalizedOrgId))
    .filter((row) => isRollingClass(row))
    .filter((row) => !idsEqual(row?.id, normalizedSourceClassId))
    .filter((row) => !isClosedForNewEnrollment(row))
    .map((row) => {
      const billingMode = normalizeClassBillingMode(row?.billingMode);
      let enrollmentMode = 'date_window';
      const targetSessionCount = Number(row?.defaultTargetSessionCount || 0);
      const targetHours = Number(row?.defaultTargetHours || 0);
      if (targetHours > 0) enrollmentMode = 'hour_cap';
      else if (targetSessionCount > 0) enrollmentMode = 'session_cap';
      return {
        id: toPublicId(row.id),
        title: String(row?.title || row.id || '').trim(),
        enrollmentMode,
        isChargeable: billingMode === 'chargeable',
        maxCapacity: classSessionCapacityService.resolveClassMaxCapacity(row),
        cycleStartDate: normalizeDateOnly(row?.cycleStartDate),
        cycleEndDate: normalizeDateOnly(row?.cycleEndDate)
      };
    })
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

async function getSourcePeriodOrThrow(periodId, options = {}) {
  const id = toPublicId(periodId);
  if (!id) throw new Error('sourcePeriodId is required.');
  const period = await dependencies.repositories.classEnrollmentPeriods.getById(id, options);
  if (!period) throw new Error('Source enrollment period not found.');
  return period;
}

async function previewSourceClose(normalized, sourcePeriod, orgId, options = {}) {
  const close = normalized.close;
  const preview = await dependencies.registrationStatusLifecycleService.previewTransition({
    registrationType: 'class',
    registrationId: sourcePeriod.id,
    targetStatus: close.targetStatus,
    effectiveDate: close.effectiveDate,
    reason: close.reason,
    orgId
  }, options);
  const blockers = (preview.blockers || []).map((row) => ({
    code: String(row?.code || 'CLOSE_BLOCKED').trim(),
    message: String(row?.message || 'Close transition is blocked.').trim()
  }));
  if (!preview.canApply) {
    if (!blockers.length && preview.unresolvedFinancialOperations) {
      blockers.push({ code: 'FINANCE_UNRESOLVED', message: 'Resolve financial reconciliation issues before closing this enrollment.' });
    } else if (!blockers.length) {
      blockers.push({ code: 'CLOSE_BLOCKED', message: 'This enrollment cannot be closed with the selected status.' });
    }
  }
  return {
    ...preview,
    blockers,
    summary: `Complete enrollment on ${close.effectiveDate} (moved).`
  };
}

async function previewTargetEnrollment(normalized, sourcePeriod, targetClass, reqUser, options = {}) {
  const warnings = [];
  const blockers = [];
  const target = normalized.target;
  const rawRequest = {
    classId: target.classId,
    studentId: target.studentId,
    startDate: target.startDate,
    endDate: target.endDate,
    targetSessionCount: target.targetSessionCount,
    targetHours: target.targetHours,
    funderId: target.funder.funderId,
    funderType: target.funder.funderType,
    status: target.status,
    reasonStart: target.reasonStart,
    notes: target.notes,
    programId: target.programId,
    termId: target.termId,
    programRegistrationId: target.programRegistrationId,
    sessionCapacityType: target.sessionCapacityType,
    claimNumber: target.claimNumber,
    sessionCountPolicy: target.sessionCountPolicy,
    enrollmentSource: 'enrollment_move'
  };

  let engineRequest;
  try {
    engineRequest = dependencies.rollingEnrollmentEngineService.normalizeEnrollmentEngineRequest(rawRequest, targetClass);
  } catch (error) {
    blockers.push({ code: 'TARGET_PAYLOAD_INVALID', message: error.message || 'Target enrollment fields are invalid.' });
    return { blockers, warnings, engineRequest: null, draftRequired: false };
  }

  try {
    classCycleEnrollmentPolicyService.assertEnrollmentDatesWithinCycle({
      classRow: targetClass,
      startDate: engineRequest.startDate,
      endDate: engineRequest.endDate
    });
    classCycleEnrollmentPolicyService.assertNewEnrollmentAllowed({
      classRow: targetClass,
      targetStatus: engineRequest.status
    });
  } catch (error) {
    blockers.push({ code: 'TARGET_CYCLE_POLICY', message: error.message });
  }

  try {
    const overlap = await dependencies.enrollmentPeriodService.checkOverlap({
      classId: target.classId,
      studentId: target.studentId,
      startDate: engineRequest.startDate,
      endDate: engineRequest.endDate
    }, options);
    if (overlap?.hasOverlap) {
      blockers.push({ code: 'TARGET_OVERLAP', message: 'Student already has an overlapping enrollment period in the target class.' });
    }
  } catch (error) {
    blockers.push({ code: 'TARGET_OVERLAP', message: error.message });
  }

  if (typeof options.assertPrerequisites === 'function') {
    try {
      const student = await dependencies.schoolDataService.getDataById('students', target.studentId, reqUser);
      await options.assertPrerequisites(student, target.programId, target.termId, engineRequest.startDate);
    } catch (error) {
      blockers.push({ code: 'PREREQUISITES', message: error.message || 'Prerequisite requirements are not met.' });
    }
  }

  let alignment = null;
  try {
    await dependencies.rollingEnrollmentEngineService.assertEnrollmentAlignmentForCreate(targetClass, engineRequest, reqUser);
    alignment = await dependencies.rollingEnrollmentEngineService.buildAlignmentPayload(
      targetClass,
      dependencies.rollingEnrollmentEngineService.buildAlignmentBodyFromRequest(engineRequest),
      reqUser
    );
  } catch (error) {
    blockers.push({ code: 'TARGET_ALIGNMENT', message: error.message || 'Target enrollment session alignment failed.' });
  }

  let scheduleConflicts = null;
  if (typeof options.detectScheduleConflicts === 'function') {
    try {
      const student = await dependencies.schoolDataService.getDataById('students', target.studentId, reqUser);
      if (!student) {
        blockers.push({ code: 'STUDENT_NOT_FOUND', message: 'Student not found for schedule conflict review.' });
      } else {
        scheduleConflicts = await options.detectScheduleConflicts({
          targetClass,
          student,
          startDate: engineRequest.startDate,
          endDate: engineRequest.endDate,
          sourcePeriod,
          sourceClass: options.sourceClass || null
        });
        if (scheduleConflicts?.hasConflicts) {
          blockers.push({
            code: 'TARGET_SCHEDULE_CONFLICT',
            message: scheduleConflicts.message || "Scheduling conflicts detected with the student's existing schedule."
          });
        }
      }
    } catch (error) {
      blockers.push({
        code: 'TARGET_SCHEDULE_CONFLICT',
        message: error.message || 'Unable to evaluate target enrollment schedule conflicts.'
      });
    }
  }

  const billingMode = normalizeClassBillingMode(targetClass?.billingMode);
  const draftRequired = billingMode === 'chargeable';
  if (draftRequired) {
    warnings.push({ code: 'DRAFT_REQUIRED', message: 'Target class is chargeable. A draft enrollment will be created for finance review after the move is applied.' });
  }

  return {
    blockers,
    warnings,
    engineRequest,
    alignment,
    draftRequired,
    scheduleConflicts,
    classTitle: String(targetClass?.title || target.classId || '').trim(),
    summary: `Enroll in ${String(targetClass?.title || target.classId || '').trim()} starting ${engineRequest.startDate}.`
  };
}

async function previewMoveEnrollment({
  sourcePeriodId,
  payload = {},
  reqUser,
  orgId,
  options = {}
} = {}) {
  const sourcePeriod = await getSourcePeriodOrThrow(sourcePeriodId, options);
  const sourceClass = await dependencies.repositories.classes.getById(sourcePeriod.classId, options);
  const normalized = normalizeMovePayload(payload, sourcePeriod);
  const targetClass = normalized.target.classId
    ? await dependencies.repositories.classes.getById(normalized.target.classId, options)
    : null;

  const blockers = assertMovePayloadBasics(normalized, sourcePeriod, sourceClass, targetClass);
  const warnings = [];
  let sourceClosePreview = null;
  let targetEnrollmentPreview = null;

  if (!blockers.length) {
    sourceClosePreview = await previewSourceClose(normalized, sourcePeriod, orgId, { ...options, requestingUser: reqUser });
    blockers.push(...(sourceClosePreview.blockers || []));
  }

  if (!blockers.length && targetClass) {
    targetEnrollmentPreview = await previewTargetEnrollment(normalized, sourcePeriod, targetClass, reqUser, {
      ...options,
      sourceClass
    });
    blockers.push(...(targetEnrollmentPreview.blockers || []));
    warnings.push(...(targetEnrollmentPreview.warnings || []));
  }

  const previewHash = buildPreviewHash(normalized);
  const summaryLines = [];
  if (sourceClosePreview?.summary) summaryLines.push(sourceClosePreview.summary);
  if (targetEnrollmentPreview?.summary) summaryLines.push(targetEnrollmentPreview.summary);

  return {
    canApply: blockers.length === 0,
    blockers,
    warnings,
    previewHash,
    normalizedPayload: normalized,
    sourceClosePreview,
    scheduleConflicts: targetEnrollmentPreview?.scheduleConflicts || null,
    targetEnrollmentPreview: targetEnrollmentPreview ? {
      classId: normalized.target.classId,
      classTitle: targetEnrollmentPreview.classTitle,
      startDate: normalized.target.startDate,
      endDate: normalized.target.endDate,
      status: normalized.target.status,
      draftRequired: targetEnrollmentPreview.draftRequired,
      alignment: targetEnrollmentPreview.alignment || null,
      scheduleConflicts: targetEnrollmentPreview.scheduleConflicts || null
    } : null,
    summaryLines
  };
}

async function applySourceClose(normalized, sourcePeriod, orgId, reqUser, options = {}) {
  const close = normalized.close;
  const result = await dependencies.registrationStatusLifecycleService.applyTransition({
    registrationType: 'class',
    registrationId: sourcePeriod.id,
    targetStatus: close.targetStatus,
    effectiveDate: close.effectiveDate,
    reason: close.reason,
    orgId
  }, { ...options, requestingUser: reqUser });
  return result.registration || result;
}

async function applyMoveEnrollment({
  sourcePeriodId,
  payload = {},
  previewHash = '',
  reqUser,
  orgId,
  engineHooks = {},
  options = {}
} = {}) {
  const preview = await previewMoveEnrollment({
    sourcePeriodId,
    payload,
    reqUser,
    orgId,
    options
  });
  if (!preview.canApply) {
    const message = preview.blockers[0]?.message || 'Move enrollment preview is blocked.';
    const error = new Error(message);
    error.preview = preview;
    throw error;
  }
  if (!previewHash || previewHash !== preview.previewHash) {
    throw new Error('Preview is stale. Preview the move again before applying.');
  }

  const sourcePeriod = await getSourcePeriodOrThrow(sourcePeriodId, options);
  const normalized = preview.normalizedPayload;
  const targetClass = await dependencies.repositories.classes.getById(normalized.target.classId, options);
  if (!targetClass) throw new Error('Target class not found.');

  const closedSource = await applySourceClose(normalized, sourcePeriod, orgId, reqUser, options);

  const engineResult = await dependencies.rollingEnrollmentEngineService.execute({
    classData: targetClass,
    reqUser,
    rawRequest: {
      classId: normalized.target.classId,
      studentId: normalized.target.studentId,
      startDate: normalized.target.startDate,
      endDate: normalized.target.endDate,
      targetSessionCount: normalized.target.targetSessionCount,
      targetHours: normalized.target.targetHours,
      funderId: normalized.target.funder.funderId,
      funderType: normalized.target.funder.funderType,
      status: normalized.target.status,
      reasonStart: normalized.target.reasonStart,
      notes: normalized.target.notes,
      programId: normalized.target.programId,
      termId: normalized.target.termId,
      programRegistrationId: normalized.target.programRegistrationId,
      sessionCapacityType: normalized.target.sessionCapacityType,
      claimNumber: normalized.target.claimNumber,
      sessionCountPolicy: normalized.target.sessionCountPolicy,
      enrollmentSource: 'enrollment_move'
    },
    hooks: engineHooks
  });

  const firstResult = (Array.isArray(engineResult.results) ? engineResult.results : [])[0];
  if (!firstResult?.ok) {
    const message = firstResult?.error || 'Target enrollment failed after closing the source period.';
    const error = new Error(`${message} Source enrollment was already closed; review the student record and create the target enrollment manually if needed.`);
    error.partial = { closedSource, engineResult };
    throw error;
  }

  const targetPeriod = firstResult.period || null;
  const requiresDraftReview = Boolean(
    preview.targetEnrollmentPreview?.draftRequired
    && targetPeriod
    && ['draft', 'to_be_confirmed', 'waiting_list'].includes(String(targetPeriod.status || '').trim().toLowerCase())
  );

  return {
    closedSource,
    targetPeriod,
    engineResult,
    requiresDraftReview,
    preview
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    repositories: schoolRepositories,
    enrollmentPeriodService: classEnrollmentPeriodService,
    schoolDataService,
    registrationStatusLifecycleService,
    rollingEnrollmentEngineService
  };
}

module.exports = {
  CLOSE_STATUSES,
  OPEN_STATUSES,
  normalizeMovePayload,
  buildPreviewHash,
  listMoveTargetClasses,
  previewMoveEnrollment,
  applyMoveEnrollment,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
