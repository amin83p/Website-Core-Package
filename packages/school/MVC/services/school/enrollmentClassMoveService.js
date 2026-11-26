'use strict';

const crypto = require('crypto');
const schoolDataService = require('./schoolDataService');
const enrollmentMoveService = require('./enrollmentMoveService');
const enrollmentMoveCompensationService = require('./enrollmentMoveCompensationService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { addDaysToDateKey } = require('./sessionAttendanceEditAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const PREVIEW_CONCURRENCY = 7;
const STUDENT_LOOKUP_CONCURRENCY = 8;

let dependencies = {
  schoolDataService,
  enrollmentMoveService,
  enrollmentMoveCompensationService,
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
      startDate: addDaysToDateKey(closeDate, 1) || closeDate,
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

async function mapWithConcurrency(values, concurrency, mapper) {
  const list = Array.isArray(values) ? values : [];
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(list.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return results;
}

async function buildStudentLookupForStudentIds(studentIds = [], reqUser) {
  const ids = [...new Set(
    (Array.isArray(studentIds) ? studentIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean)
  )];
  if (!ids.length) return new Map();
  const records = await mapWithConcurrency(
    ids,
    STUDENT_LOOKUP_CONCURRENCY,
    (id) => dependencies.schoolDataService.getDataById('students', id, reqUser).catch(() => null)
  );
  const lookup = new Map();
  (Array.isArray(records) ? records : []).forEach((student) => {
    if (!student) return;
    const id = toPublicId(student?.id);
    if (id) lookup.set(id, student);
  });
  return lookup;
}

async function buildStudentLookupForPeriods(periods = [], reqUser) {
  const studentIds = new Set();
  (Array.isArray(periods) ? periods : []).forEach((period) => {
    const token = toPublicId(period?.studentId);
    if (token) studentIds.add(token);
  });
  return buildStudentLookupForStudentIds([...studentIds], reqUser);
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

async function buildEnrollmentStudentLabelLookupForStudentIds(studentIds = [], reqUser) {
  const lookup = await buildStudentLookupForStudentIds(studentIds, reqUser);
  const students = [...lookup.values()];
  const personById = await dependencies.schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: students.map((student) => student?.personId).filter(Boolean)
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

  const labelLookup = await buildEnrollmentStudentLabelLookupForStudentIds(
    eligible.map((period) => period?.studentId),
    reqUser
  );
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

async function previewSingleClassMoveRow({
  row,
  normalizedTargetClassId,
  closeUserReason,
  targetClassTitle,
  periodById,
  previewOptions,
  reqUser,
  orgId
}) {
  const periodId = toPublicId(row?.periodId);
  if (!periodId) return null;
  const sourcePeriod = periodById.get(periodId);
  if (!sourcePeriod) {
    return {
      periodId,
      studentId: '',
      studentLabel: '',
      canApply: false,
      blockers: [{ code: 'PERIOD_NOT_FOUND', message: 'Enrollment period not found.' }],
      warnings: [],
      previewHash: '',
      summaryLines: [],
      payload: null
    };
  }
  const defaults = buildDefaultMovePayloadFromPeriod({
    period: sourcePeriod,
    sourceClassTitle: previewOptions.sourceClassTitle || '',
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
    options: previewOptions
  });
  const studentId = toPublicId(sourcePeriod?.studentId);
  return {
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
  };
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
  const normalizedSourceClassId = toPublicId(sourceClassId);
  const normalizedTargetClassId = toPublicId(targetClassId);
  if (!normalizedTargetClassId) throw new Error('targetClassId is required.');
  const inputRows = Array.isArray(rows) ? rows : [];
  const batchPreviewHash = buildBatchPreviewHash({
    sourceClassId: normalizedSourceClassId,
    targetClassId: normalizedTargetClassId,
    closeUserReason,
    rows: inputRows
  });

  const classPeriods = normalizedSourceClassId
    ? await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(normalizedSourceClassId, reqUser)
    : [];
  const periodById = new Map();
  (Array.isArray(classPeriods) ? classPeriods : []).forEach((period) => {
    const id = toPublicId(period?.id);
    if (id) periodById.set(id, period);
  });

  const studentLookup = await buildStudentLookupForPeriods(
    inputRows.map((row) => periodById.get(toPublicId(row?.periodId))).filter(Boolean),
    reqUser
  );

  const previewOptions = {
    ...options,
    prefetchedPeriods: periodById,
    studentLookup
  };

  const items = (await mapWithConcurrency(
    inputRows,
    PREVIEW_CONCURRENCY,
    (row) => previewSingleClassMoveRow({
      row,
      normalizedTargetClassId,
      closeUserReason,
      targetClassTitle,
      periodById,
      previewOptions,
      reqUser,
      orgId
    })
  )).filter(Boolean);

  const applyableCount = items.filter((row) => row.canApply === true).length;
  const blockedCount = items.length - applyableCount;
  const applyRows = items
    .filter((row) => row.canApply === true)
    .map((row) => ({ periodId: row.periodId, payload: row.payload }));
  const applyBatchHash = buildBatchPreviewHash({
    sourceClassId: normalizedSourceClassId,
    targetClassId: normalizedTargetClassId,
    closeUserReason,
    rows: applyRows
  });

  return {
    batchPreviewHash,
    applyBatchHash,
    items,
    canApplyAny: applyableCount > 0,
    canApplyAllSelected: items.length > 0 && blockedCount === 0,
    applyableCount,
    blockedCount
  };
}

function sealClassMovePreview({
  sourceClassId,
  targetClassId,
  closeUserReason = '',
  rows = [],
  items = []
} = {}) {
  const normalizedSourceClassId = toPublicId(sourceClassId);
  const normalizedTargetClassId = toPublicId(targetClassId);
  const inputRows = (Array.isArray(rows) && rows.length)
    ? rows
    : (Array.isArray(items) ? items : []).map((item) => ({
        periodId: item?.periodId,
        payload: item?.payload
      }));
  const batchPreviewHash = buildBatchPreviewHash({
    sourceClassId: normalizedSourceClassId,
    targetClassId: normalizedTargetClassId,
    closeUserReason,
    rows: inputRows
  });
  const applySource = (Array.isArray(items) && items.length)
    ? items
    : inputRows.map((row) => ({ ...row, canApply: true }));
  const applyRows = applySource
    .filter((row) => row.canApply !== false)
    .map((row) => ({ periodId: row.periodId, payload: row.payload }));
  const applyBatchHash = buildBatchPreviewHash({
    sourceClassId: normalizedSourceClassId,
    targetClassId: normalizedTargetClassId,
    closeUserReason,
    rows: applyRows
  });
  const applyableCount = applySource.filter((row) => row.canApply === true).length;
  const blockedCount = applySource.length - applyableCount;
  return {
    batchPreviewHash,
    applyBatchHash,
    applyableCount,
    blockedCount,
    canApplyAny: applyableCount > 0,
    canApplyAllSelected: applySource.length > 0 && blockedCount === 0
  };
}

async function assertApplyRowsStillValid({ rows, reqUser, orgId, options } = {}) {
  for (const row of rows) {
    const periodId = toPublicId(row?.periodId);
    const previewHash = String(row?.previewHash || '').trim();
    const payload = row?.payload;
    if (!periodId || !previewHash || !payload) {
      throw new Error('Each apply row must include periodId, previewHash, and payload.');
    }
    await dependencies.enrollmentMoveService.validateMovePreviewForApply({
      sourcePeriodId: periodId,
      payload,
      previewHash,
      reqUser,
      orgId,
      options
    });
  }
}

async function applyClassMoveBatch({
  batchPreviewHash = '',
  applyBatchHash = '',
  sourceClassId = '',
  targetClassId = '',
  closeUserReason = '',
  rows = [],
  reqUser,
  orgId,
  engineHooks = {},
  options = {}
} = {}) {
  const expectedHash = String(applyBatchHash || batchPreviewHash || '').trim();
  if (!expectedHash) throw new Error('applyBatchHash (or batchPreviewHash) is required.');

  const inputRows = Array.isArray(rows) ? rows : [];
  if (!inputRows.length) throw new Error('At least one enrollment move row is required.');

  const recomputedHash = buildBatchPreviewHash({
    sourceClassId,
    targetClassId,
    closeUserReason,
    rows: inputRows.map((row) => ({
      periodId: row?.periodId,
      payload: row?.payload
    }))
  });
  if (recomputedHash !== expectedHash) {
    throw new Error('Preview is stale. Preview again before applying.');
  }

  const periodById = new Map();
  const normalizedSourceClassId = toPublicId(sourceClassId);
  if (normalizedSourceClassId) {
    const classPeriods = await dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(
      normalizedSourceClassId,
      reqUser
    );
    (Array.isArray(classPeriods) ? classPeriods : []).forEach((period) => {
      const id = toPublicId(period?.id);
      if (id) periodById.set(id, period);
    });
  }

  const applyOptions = {
    ...options,
    prefetchedPeriods: periodById,
    studentLookup: await buildStudentLookupForPeriods(
      inputRows.map((row) => periodById.get(toPublicId(row?.periodId))).filter(Boolean),
      reqUser
    )
  };

  await assertApplyRowsStillValid({
    rows: inputRows,
    reqUser,
    orgId,
    options: applyOptions
  });

  const compensationRecords = [];
  const results = [];

  try {
    for (const row of inputRows) {
      const periodId = toPublicId(row?.periodId);
      const previewHash = String(row?.previewHash || '').trim();
      const payload = row?.payload;
      const outcome = await dependencies.enrollmentMoveService.applyMoveEnrollment({
        sourcePeriodId: periodId,
        payload,
        previewHash,
        reqUser,
        orgId,
        engineHooks,
        options: { ...applyOptions, trustPreviewHash: true }
      });
      compensationRecords.push(
        dependencies.enrollmentMoveCompensationService.buildCompensationRecordFromOutcome(outcome, {
          sourcePeriodId: periodId,
          targetClassId: toPublicId(payload?.target?.classId || targetClassId),
          sourceClassId: normalizedSourceClassId
        })
      );
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
    }
  } catch (error) {
    const rollback = await dependencies.enrollmentMoveCompensationService.rollbackCompensationRecordsLifo(
      compensationRecords,
      { reqUser, orgId, accessContext: options.accessContext }
    );
    const rolled = new Error(
      error.message || 'Class move failed partway through. Earlier moves in this batch were rolled back where possible.'
    );
    rolled.statusCode = 409;
    rolled.results = results;
    rolled.rollbackSummary = rollback;
    rolled.failedPeriodId = toPublicId(error?.preview?.normalizedPayload?.target?.studentId || '');
    throw rolled;
  }

  return {
    batchPreviewHash: expectedHash,
    applyBatchHash: expectedHash,
    status: 'success',
    applied: results.length,
    skipped: 0,
    failed: 0,
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
    enrollmentMoveCompensationService,
    schoolPersonAccessService
  };
}

module.exports = {
  buildDefaultMovePayloadFromPeriod,
  buildMoveCloseReason,
  buildBatchPreviewHash,
  listEligibleMoveCandidates,
  previewClassMoveBatch,
  sealClassMovePreview,
  applyClassMoveBatch,
  __setDependenciesForTest,
  __resetDependenciesForTest
};