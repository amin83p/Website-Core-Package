'use strict';

const crypto = require('crypto');
const schoolDataService = require('./schoolDataService');
const enrollmentMoveService = require('./enrollmentMoveService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

let dependencies = {
  schoolDataService,
  enrollmentMoveService,
  schoolPersonAccessService
};

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function periodCoversCloseDate(period, closeEffectiveDate) {
  const close = normalizeDateOnly(closeEffectiveDate);
  const start = normalizeDateOnly(period?.startDate);
  const end = normalizeDateOnly(period?.endDate) || '9999-12-31';
  if (!close || !start) return false;
  return start <= close && end >= close;
}

function isOpenMovePeriod(period) {
  const status = String(period?.status || '').trim().toLowerCase();
  return enrollmentMoveService.OPEN_STATUSES.has(status);
}

function buildMoveCloseReason(targetClassTitle, userReason = '') {
  const target = String(targetClassTitle || '').trim();
  const reason = String(userReason || '').trim();
  if (target && reason) return `Moved to ${target}: ${reason}`;
  if (target) return `Moved to ${target}`;
  return reason;
}

function buildDefaultMovePayloadFromPeriod({
  period,
  sourceClassTitle = '',
  closeEffectiveDate = '',
  closeUserReason = '',
  targetClassId = '',
  targetClassTitle = ''
} = {}) {
  const closeDate = normalizeDateOnly(closeEffectiveDate);
  const funder = rollingEnrollmentFunderService.normalizeEnrollmentFunderSelection({
    funderId: period?.funderId,
    funderType: period?.funderType
  });
  const endDate = normalizeDateOnly(period?.endDate);
  const sessionCount = Number(period?.targetSessionCount || 0);
  const targetHours = Number(period?.targetHours || 0);
  const sourceTitle = String(sourceClassTitle || '').trim();
  return {
    close: {
      effectiveDate: closeDate,
      targetStatus: 'completed',
      reason: buildMoveCloseReason(targetClassTitle, closeUserReason)
    },
    target: {
      classId: toPublicId(targetClassId),
      studentId: toPublicId(period?.studentId),
      startDate: closeDate,
      endDate,
      targetSessionCount: Number.isFinite(sessionCount) && sessionCount > 0 ? sessionCount : 0,
      targetHours: Number.isFinite(targetHours) && targetHours > 0 ? targetHours : 0,
      funder,
      reasonStart: sourceTitle ? `Moved from ${sourceTitle}.` : 'Moved from source class.',
      notes: String(period?.notes || '').trim(),
      status: String(period?.status || 'active').trim().toLowerCase() || 'active',
      sessionCapacityType: String(period?.sessionCapacityType || 'group').trim() || 'group',
      claimNumber: String(period?.claimNumber || '').trim(),
      claimNumberId: String(period?.claimNumberId || '').trim(),
      sessionCountPolicy: String(period?.sessionCountPolicy || 'all_non_na').trim() || 'all_non_na',
      programId: toPublicId(period?.programId),
      termId: toPublicId(period?.termId),
      programRegistrationId: toPublicId(period?.programRegistrationId)
    }
  };
}

function mergeMovePayload(defaults = {}, overrides = {}) {
  const base = defaults && typeof defaults === 'object' ? defaults : {};
  const patch = overrides && typeof overrides === 'object' ? overrides : {};
  const closePatch = patch.close && typeof patch.close === 'object' ? patch.close : {};
  const targetPatch = patch.target && typeof patch.target === 'object' ? patch.target : {};
  return enrollmentMoveService.normalizeMovePayload({
    close: { ...base.close, ...closePatch },
    target: { ...base.target, ...targetPatch }
  }, {
    studentId: toPublicId(targetPatch.studentId || base.target?.studentId),
    sessionCountPolicy: targetPatch.sessionCountPolicy || base.target?.sessionCountPolicy,
    claimNumber: targetPatch.claimNumber || base.target?.claimNumber,
    claimNumberId: targetPatch.claimNumberId || base.target?.claimNumberId,
    sessionCapacityType: targetPatch.sessionCapacityType || base.target?.sessionCapacityType,
    programId: targetPatch.programId || base.target?.programId,
    termId: targetPatch.termId || base.target?.termId,
    programRegistrationId: targetPatch.programRegistrationId || base.target?.programRegistrationId
  });
}

function buildBatchPreviewHash({ sourceClassId, targetClassId, closeUserReason, rows = [] } = {}) {
  const normalized = {
    sourceClassId: toPublicId(sourceClassId),
    targetClassId: toPublicId(targetClassId),
    closeUserReason: String(closeUserReason || '').trim(),
    rows: (Array.isArray(rows) ? rows : []).map((row) => ({
      periodId: toPublicId(row?.periodId),
      payload: row?.payload || {}
    })).sort((a, b) => String(a.periodId).localeCompare(String(b.periodId)))
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function buildEnrollmentStudentLabelLookup(students = [], personById = new Map()) {
  const byStudentId = new Map();
  const byPersonId = new Map();
  (Array.isArray(students) ? students : []).forEach((student) => {
    const studentId = toPublicId(student?.id);
    const personId = toPublicId(student?.personId);
    if (!studentId) return;
    const person = personById.get(personId);
    const name = dependencies.schoolPersonAccessService.formatPersonName(person, studentId);
    const studentNumber = String(student?.studentNumber || '').trim();
    const label = studentNumber ? `${name} (${studentNumber})` : name;
    const entry = { label, studentRecordId: studentId };
    byStudentId.set(studentId, entry);
    if (personId) byPersonId.set(personId, entry);
  });
  return { byStudentId, byPersonId };
}

function resolvePeriodStudentLabel(studentId, lookup = {}) {
  const token = toPublicId(studentId);
  if (!token) return '';
  const direct = lookup.byStudentId?.get(token);
  if (direct?.label) return direct.label;
  const byPerson = lookup.byPersonId?.get(token);
  if (byPerson?.label) return byPerson.label;
  return token;
}

async function buildEnrollmentStudentLabelLookupForUser(reqUser) {
  const students = await dependencies.schoolDataService.fetchAllData('students', {}, reqUser).catch(() => []);
  const personById = await dependencies.schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: (Array.isArray(students) ? students : []).map((student) => student?.personId)
  });
  return buildEnrollmentStudentLabelLookup(students, personById);
}

async function listEligibleMoveCandidates({
  classId,
  closeEffectiveDate,
  reqUser,
  orgId,
  sourceClassTitle = ''
} = {}) {
  const normalizedClassId = toPublicId(classId);
  const closeDate = normalizeDateOnly(closeEffectiveDate);
  if (!normalizedClassId) throw new Error('classId is required.');
  if (!closeDate) throw new Error('closeEffectiveDate is required.');

  const periods = await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(normalizedClassId, reqUser);
  const eligible = (Array.isArray(periods) ? periods : [])
    .filter((row) => isOpenMovePeriod(row))
    .filter((row) => periodCoversCloseDate(row, closeDate));

  const labelLookup = await buildEnrollmentStudentLabelLookupForUser(reqUser);
  const title = String(sourceClassTitle || '').trim();

  return eligible.map((period) => {
    const studentId = toPublicId(period?.studentId);
    const defaultPayload = buildDefaultMovePayloadFromPeriod({
      period,
      sourceClassTitle: title,
      closeEffectiveDate: closeDate,
      closeUserReason: ''
    });
    return {
      periodId: toPublicId(period?.id),
      studentId,
      studentLabel: resolvePeriodStudentLabel(studentId, labelLookup),
      periodStatus: String(period?.status || '').trim(),
      periodStartDate: normalizeDateOnly(period?.startDate),
      periodEndDate: normalizeDateOnly(period?.endDate),
      sessionCapacityType: String(period?.sessionCapacityType || 'group').trim() || 'group',
      claimNumber: String(period?.claimNumber || '').trim(),
      claimNumberId: String(period?.claimNumberId || '').trim(),
      defaultPayload
    };
  }).sort((a, b) => String(a.studentLabel).localeCompare(String(b.studentLabel)));
}

async function previewClassMoveBatch({
  sourceClassId,
  targetClassId,
  closeUserReason = '',
  targetClassTitle = '',
  rows = [],
  reqUser,
  orgId,
  options = {}
} = {}) {
  const normalizedTargetClassId = toPublicId(targetClassId);
  if (!normalizedTargetClassId) throw new Error('targetClassId is required.');
  const batchPreviewHash = buildBatchPreviewHash({
    sourceClassId,
    targetClassId: normalizedTargetClassId,
    closeUserReason,
    rows
  });

  const items = [];
  const inputRows = Array.isArray(rows) ? rows : [];
  for (const row of inputRows) {
    const periodId = toPublicId(row?.periodId);
    if (!periodId) continue;
    const sourcePeriod = await dependencies.schoolDataService.getDataById('classEnrollmentPeriods', periodId, reqUser);
    if (!sourcePeriod) {
      items.push({
        periodId,
        studentId: '',
        studentLabel: '',
        canApply: false,
        blockers: [{ code: 'PERIOD_NOT_FOUND', message: 'Enrollment period not found.' }],
        warnings: [],
        previewHash: '',
        summaryLines: [],
        payload: null
      });
      continue;
    }
    const defaults = buildDefaultMovePayloadFromPeriod({
      period: sourcePeriod,
      sourceClassTitle: options.sourceClassTitle || '',
      closeEffectiveDate: row?.payload?.close?.effectiveDate || row?.closeEffectiveDate,
      closeUserReason,
      targetClassId: normalizedTargetClassId,
      targetClassTitle
    });
    const payload = mergeMovePayload(defaults, row?.payload || {});
    payload.close.reason = buildMoveCloseReason(targetClassTitle, closeUserReason || payload.close.reason);
    payload.target.classId = normalizedTargetClassId;

    const preview = await dependencies.enrollmentMoveService.previewMoveEnrollment({
      sourcePeriodId: periodId,
      payload,
      reqUser,
      orgId,
      options
    });
    const studentId = toPublicId(sourcePeriod?.studentId);
    items.push({
      periodId,
      studentId,
      studentLabel: String(row?.studentLabel || studentId || '').trim(),
      canApply: preview.canApply === true,
      blockers: preview.blockers || [],
      warnings: preview.warnings || [],
      previewHash: String(preview.previewHash || '').trim(),
      summaryLines: preview.summaryLines || [],
      payload: preview.normalizedPayload || payload,
      targetEnrollmentPreview: preview.targetEnrollmentPreview || null
    });
  }

  return {
    batchPreviewHash,
    items,
    canApplyAny: items.some((row) => row.canApply)
  };
}

async function applyClassMoveBatch({
  batchPreviewHash = '',
  rows = [],
  reqUser,
  orgId,
  engineHooks = {},
  options = {}
} = {}) {
  const expectedHash = String(batchPreviewHash || '').trim();
  if (!expectedHash) throw new Error('batchPreviewHash is required.');

  const results = [];
  const inputRows = Array.isArray(rows) ? rows : [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of inputRows) {
    const periodId = toPublicId(row?.periodId);
    const previewHash = String(row?.previewHash || '').trim();
    const payload = row?.payload;
    if (!periodId || !previewHash || !payload) {
      skipped += 1;
      results.push({
        periodId,
        ok: false,
        skipped: true,
        error: 'Missing periodId, previewHash, or payload.'
      });
      continue;
    }
    try {
      const outcome = await dependencies.enrollmentMoveService.applyMoveEnrollment({
        sourcePeriodId: periodId,
        payload,
        previewHash,
        reqUser,
        orgId,
        engineHooks,
        options
      });
      applied += 1;
      results.push({
        periodId,
        ok: true,
        studentId: toPublicId(payload?.target?.studentId),
        targetPeriodId: toPublicId(outcome?.targetPeriod?.id),
        requiresDraftReview: outcome.requiresDraftReview === true,
        message: outcome.requiresDraftReview
          ? 'Moved; review draft charges for the new enrollment.'
          : 'Moved successfully.'
      });
    } catch (error) {
      failed += 1;
      results.push({
        periodId,
        ok: false,
        error: error?.message || 'Move failed.',
        partial: error?.partial || null,
        preview: error?.preview || null
      });
    }
  }

  return {
    batchPreviewHash: expectedHash,
    applied,
    skipped,
    failed,
    results
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    schoolDataService,
    enrollmentMoveService,
    schoolPersonAccessService
  };
}

module.exports = {
  buildDefaultMovePayloadFromPeriod,
  buildMoveCloseReason,
  buildBatchPreviewHash,
  listEligibleMoveCandidates,
  previewClassMoveBatch,
  applyClassMoveBatch,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
