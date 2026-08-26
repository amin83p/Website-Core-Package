'use strict';

const schoolDataService = require('./schoolDataService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const classEnrollmentPeriodModel = require('../../models/school/classEnrollmentPeriodModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const ENROLLMENT_MODES = Object.freeze({
  DATE_WINDOW: 'date_window',
  SESSION_CAP: 'session_cap',
  HOUR_CAP: 'hour_cap'
});

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeClassBillingMode(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'no_charge' || token === 'chargeable') return token;
  return 'chargeable';
}

function inferEnrollmentModeFromFields(input = {}) {
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(input.targetSessionCount);
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(input.targetHours);
  if (targetSessionCount > 0 && targetHours > 0) {
    throw new Error('Set either a session target or an hour target, not both.');
  }
  if (targetHours > 0) return ENROLLMENT_MODES.HOUR_CAP;
  if (targetSessionCount > 0) return ENROLLMENT_MODES.SESSION_CAP;
  return ENROLLMENT_MODES.DATE_WINDOW;
}

function normalizeStudentEntries(input = {}) {
  const defaultSessionCapacityType = classEnrollmentPeriodModel.sanitizeSessionCapacityType(
    input.sessionCapacityType,
    { defaultValue: 'group' }
  );
  if (Array.isArray(input.students) && input.students.length) {
    return input.students.map((row) => {
      const studentId = toPublicId(row?.studentId || '');
      if (!studentId) return null;
      return {
        studentId,
        programId: toPublicId(row?.programId || ''),
        termId: toPublicId(row?.termId || ''),
        programRegistrationId: toPublicId(row?.programRegistrationId || ''),
        notes: String(row?.notes || '').trim(),
        sessionCapacityType: classEnrollmentPeriodModel.sanitizeSessionCapacityType(
          row?.sessionCapacityType || defaultSessionCapacityType,
          { defaultValue: 'group' }
        )
      };
    }).filter(Boolean);
  }
  const studentId = toPublicId(input.studentId || '');
  if (!studentId) return [];
  return [{
    studentId,
    programId: toPublicId(input.programId || ''),
    termId: toPublicId(input.termId || ''),
    programRegistrationId: toPublicId(input.programRegistrationId || ''),
    notes: String(input.notes || '').trim(),
    sessionCapacityType: defaultSessionCapacityType
  }];
}

/**
 * Normalize rolling enrollment engine input into a validated request contract.
 */
function normalizeEnrollmentEngineRequest(input = {}) {
  const classId = toPublicId(input.classId || '');
  const startDate = String(input.startDate || '').trim();
  if (!classId) throw new Error('classId is required.');
  if (!startDate) throw new Error('startDate is required.');

  const students = normalizeStudentEntries(input);
  if (!students.length) throw new Error('At least one student is required.');

  const explicitMode = String(input.enrollmentMode || '').trim().toLowerCase();
  const enrollmentMode = explicitMode && Object.values(ENROLLMENT_MODES).includes(explicitMode)
    ? explicitMode
    : inferEnrollmentModeFromFields(input);

  let targetSessionCount = 0;
  let targetHours = 0;
  if (enrollmentMode === ENROLLMENT_MODES.SESSION_CAP) {
    targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(input.targetSessionCount);
    if (!targetSessionCount) throw new Error('targetSessionCount is required for session_cap enrollment mode.');
  } else if (enrollmentMode === ENROLLMENT_MODES.HOUR_CAP) {
    targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(input.targetHours);
    if (!targetHours) throw new Error('targetHours is required for hour_cap enrollment mode.');
  } else if (
    classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(input.targetSessionCount) > 0
    || classEnrollmentSessionApplicabilityService.normalizeTargetHours(input.targetHours) > 0
  ) {
    throw new Error('date_window mode cannot include targetSessionCount or targetHours.');
  }

  const sessionsToCreate = rollingEnrollmentSessionAlignmentService.parsePendingStagedSessions({
    pendingStagedSessions: input.sessionsToCreate || input.pendingStagedSessions
  });
  const plannedNotApplicableSessionIds = rollingEnrollmentSessionAlignmentService.sanitizePlannedNaSessionIds(
    input.plannedNotApplicableSessionIds
      ?? input.plannedNaSessionIds
      ?? rollingEnrollmentSessionAlignmentService.parsePlannedNaSessionIdsFromBody(input)
  );

  const funder = rollingEnrollmentFunderService.normalizeEnrollmentFunderSelection(
    input.funder && typeof input.funder === 'object'
      ? input.funder
      : { funderId: input.funderId, funderType: input.funderType }
  );

  return {
    classId,
    students,
    enrollmentMode,
    startDate,
    endDate: String(input.endDate || '').trim(),
    targetSessionCount,
    targetHours,
    sessionsToCreate,
    plannedNotApplicableSessionIds,
    extendCycleEndDate: parseBoolean(input.extendCycleEndDate, false),
    pendingGapBatch: rollingEnrollmentSessionAlignmentService.parseGapBatchSpec(input),
    funder,
    status: String(input.status || 'active').trim(),
    reasonStart: String(input.reasonStart || '').trim(),
    reasonEnd: String(input.reasonEnd || '').trim(),
    sessionCountPolicy: classEnrollmentSessionApplicabilityService.normalizeSessionCountPolicy(input.sessionCountPolicy),
    notes: String(input.notes || '').trim(),
    enrollmentSource: String(input.enrollmentSource || 'rolling_enrollment').trim(),
    sessionCapacityType: classEnrollmentPeriodModel.sanitizeSessionCapacityType(input.sessionCapacityType, { defaultValue: 'group' }),
    allowOverlap: parseBoolean(input.allowOverlap, false),
    finance: input.finance && typeof input.finance === 'object' ? input.finance : null
  };
}

async function buildAlignmentPayload(classData, body = {}, reqUser) {
  const startDate = String(body?.startDate || '').trim();
  const endDate = String(body?.endDate || '').trim();
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(body?.targetSessionCount);
  const targetHours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(body?.targetHours);
  if (targetSessionCount > 0 && targetHours > 0) {
    throw new Error('Set either a session target or an hour target, not both.');
  }

  const pendingStagedSessions = rollingEnrollmentSessionAlignmentService.parsePendingStagedSessions(body);
  const pendingBatch = pendingStagedSessions.length
    ? null
    : rollingEnrollmentSessionAlignmentService.parseGapBatchSpec(body);

  const [sessions, statusMap] = await Promise.all([
    schoolDataService.getClassSessions(classData.id, reqUser),
    sessionStatusPolicyService.getStatusMap(classData?.orgId || reqUser?.activeOrgId || '', { includeInactive: true })
  ]);

  let mergedSessions = Array.isArray(sessions) ? sessions : [];
  if (pendingStagedSessions.length) {
    mergedSessions = [...mergedSessions, ...pendingStagedSessions];
  } else if (pendingBatch) {
    const preview = await rollingEnrollmentSessionAlignmentService.previewGapBatchSessions({
      classData,
      batchSpec: pendingBatch,
      reqUser
    });
    mergedSessions = [...mergedSessions, ...(preview.proposedSessions || [])];
  }

  const alignment = rollingEnrollmentSessionAlignmentService.evaluateAlignment({
    sessions: mergedSessions,
    startDate,
    endDate,
    targetSessionCount,
    targetHours,
    statusMap
  });

  return {
    ...alignment,
    startDate,
    endDate,
    targetSessionCount,
    targetHours
  };
}

function buildAlignmentBodyFromRequest(normalized, { includeSessionsToCreate = false } = {}) {
  const body = {
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    targetSessionCount: normalized.targetSessionCount,
    targetHours: normalized.targetHours,
    plannedNotApplicableSessionIds: normalized.plannedNotApplicableSessionIds
  };
  if (includeSessionsToCreate && normalized.sessionsToCreate.length) {
    body.pendingStagedSessions = normalized.sessionsToCreate;
  } else if (normalized.pendingGapBatch) {
    body.pendingGapBatch = normalized.pendingGapBatch;
  }
  return body;
}

function buildEnrollmentPayloadForStudent(classData, normalized, student, studentEntry = {}, resolution = {}) {
  return {
    orgId: classData.orgId,
    classId: classData.id,
    studentId: studentEntry.studentId || student.id,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    status: normalized.status,
    funderType: normalized.funder.funderType,
    funderId: normalized.funder.funderId,
    authorizationRef: '',
    reasonStart: normalized.reasonStart,
    reasonEnd: normalized.reasonEnd,
    targetSessionCount: normalized.targetSessionCount,
    targetHours: normalized.targetHours,
    sessionCountPolicy: normalized.sessionCountPolicy,
    plannedNotApplicableSessionIds: normalized.plannedNotApplicableSessionIds,
    personId: toPublicId(student?.personId || ''),
    programRegistrationId: toPublicId(
      resolution.programRegistrationId || studentEntry.programRegistrationId || ''
    ),
    programId: toPublicId(resolution.programId || studentEntry.programId || ''),
    termId: toPublicId(resolution.termId || studentEntry.termId || ''),
    enrollmentSource: normalized.enrollmentSource,
    sessionCapacityType: classEnrollmentPeriodModel.sanitizeSessionCapacityType(
      studentEntry.sessionCapacityType || normalized.sessionCapacityType,
      { defaultValue: 'group' }
    ),
    feeCategory: String(student?.feeCategory || '').trim(),
    notes: String(studentEntry.notes || normalized.notes || '').trim(),
    allowOverlap: normalized.allowOverlap
  };
}

async function commitSessionsBeforeEnrollment({
  classData,
  normalized,
  reqUser,
  enrollingStudentId = ''
} = {}) {
  const sessionsToCreate = Array.isArray(normalized?.sessionsToCreate) ? normalized.sessionsToCreate : [];
  if (sessionsToCreate.length) {
    const teacherId = toPublicId(
      sessionsToCreate[0]?.delivery?.deliveredBy
      || normalized?.pendingGapBatch?.teacherId
      || ''
    );
    const conflictResult = await sessionConflictDetectionService.evaluateEnrollmentGapBatchConflicts({
      classData,
      proposedSessions: sessionsToCreate,
      teacherId,
      enrollingStudentId: enrollingStudentId || normalized?.students?.[0]?.studentId || '',
      reqUser
    });
    if (conflictResult.hasConflicts) {
      throw new Error(sessionConflictDetectionService.buildConflictBlockingMessage(conflictResult.allConflicts));
    }

    const appendResult = await rollingEnrollmentSessionAlignmentService.commitStagedSessions({
      classData,
      sessionsToAdd: sessionsToCreate,
      extendCycleEndDate: normalized.extendCycleEndDate === true,
      reqUser
    });

    return {
      committed: appendResult.createdCount > 0,
      createdCount: Number(appendResult.createdCount || 0),
      cycleExtended: Boolean(appendResult.cycleEndDateExtended),
      classData: appendResult.classData || classData,
      appendResult
    };
  }

  const batchSpec = normalized?.pendingGapBatch;
  if (!batchSpec) {
    return {
      committed: false,
      createdCount: 0,
      cycleExtended: false,
      classData
    };
  }

  const preview = await rollingEnrollmentSessionAlignmentService.previewGapBatchSessions({
    classData,
    batchSpec,
    reqUser
  });
  const proposedSessions = preview.proposedSessions || [];
  if (!proposedSessions.length) {
    return {
      committed: false,
      createdCount: 0,
      cycleExtended: false,
      classData
    };
  }

  const resolvedTeacher = rollingEnrollmentSessionAlignmentService.resolveDefaultTeacherFromClass(classData, batchSpec);
  const conflictResult = await sessionConflictDetectionService.evaluateEnrollmentGapBatchConflicts({
    classData,
    proposedSessions,
    teacherId: resolvedTeacher.teacherId,
    enrollingStudentId: enrollingStudentId || normalized?.students?.[0]?.studentId || '',
    reqUser
  });
  if (conflictResult.hasConflicts) {
    throw new Error(sessionConflictDetectionService.buildConflictBlockingMessage(conflictResult.allConflicts));
  }

  const appendResult = await rollingEnrollmentSessionAlignmentService.commitGapBatchSessions({
    classData,
    batchSpec,
    extendCycleEndDate: batchSpec.extendCycleEndDate === true || normalized.extendCycleEndDate === true,
    reqUser
  });

  return {
    committed: true,
    createdCount: Number(appendResult.createdCount || 0),
    cycleExtended: Boolean(appendResult.cycleEndDateExtended),
    classData: appendResult.classData || classData,
    appendResult
  };
}

async function materializeEnrollmentPlannedNa({ classData, period, student, reqUser } = {}) {
  const sessionIds = rollingEnrollmentSessionAlignmentService.sanitizePlannedNaSessionIds(
    period?.plannedNotApplicableSessionIds
  );
  const personId = toPublicId(period?.personId || student?.personId || '');
  if (!sessionIds.length || !personId) return { updatedCount: 0, sessionIds: [] };
  return rollingEnrollmentSessionAlignmentService.materializePlannedNaAttendance({
    classId: classData?.id || period?.classId,
    personId,
    sessionIds,
    reqUser
  });
}

async function refreshTargetSessionEnrollmentProgress({ classData, period, reqUser } = {}) {
  if (!classData || !period) return [];
  const hasSessionCap = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(period.targetSessionCount) > 0;
  const hasHourCap = classEnrollmentSessionApplicabilityService.normalizeTargetHours(period.targetHours) > 0;
  if (!hasSessionCap && !hasHourCap) return [];
  if (String(period.status || '').trim().toLowerCase() !== 'active') return [];
  const sessions = await schoolDataService.getClassSessions(classData.id, reqUser);
  return classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass({
    classData,
    sessions,
    reqUser,
    activeOrgId: classData?.orgId || reqUser?.activeOrgId || ''
  });
}

async function assertEnrollmentAlignmentForCreate(classData, normalized, reqUser) {
  const payload = await buildAlignmentPayload(
    classData,
    buildAlignmentBodyFromRequest(normalized, { includeSessionsToCreate: false }),
    reqUser
  );
  return rollingEnrollmentSessionAlignmentService.assertEnrollmentSessionAlignmentForCreate({
    classData,
    payload,
    plannedNaSessionIds: normalized.plannedNotApplicableSessionIds
  });
}

async function enrollStudentNoCharge({
  classData,
  normalized,
  student,
  studentEntry,
  enrollmentPayload,
  reqUser,
  hooks = {}
} = {}) {
  const result = await schoolDataService.createClassEnrollmentPeriod(enrollmentPayload, reqUser);
  const createdPeriod = result?.period || null;
  let academicLedger = null;
  let classAfter = classData;

  if (createdPeriod && String(createdPeriod.status || '').trim().toLowerCase() === 'active') {
    if (hooks.postAcademicLedger) {
      academicLedger = await hooks.postAcademicLedger({
        period: createdPeriod,
        classData: classAfter,
        student,
        effectiveDate: enrollmentPayload.startDate,
        note: enrollmentPayload.notes
      });
    }
    await materializeEnrollmentPlannedNa({
      classData: classAfter,
      period: createdPeriod,
      student,
      reqUser
    });
    await refreshTargetSessionEnrollmentProgress({
      classData: classAfter,
      period: createdPeriod,
      reqUser
    });
  }

  return {
    period: createdPeriod,
    academicLedger,
    mode: 'no_charge'
  };
}

async function enrollStudentChargeable({
  classData,
  normalized,
  student,
  enrollmentPayload,
  reqUser,
  hooks = {}
} = {}) {
  if (!hooks.buildChargeableDraft) {
    throw new Error('Chargeable enrollment requires finance draft builder hook.');
  }
  const feeCategory = String(student?.feeCategory || '').trim();
  if (!feeCategory) throw new Error('Student fee category is required for chargeable enrollment.');

  const draftBundle = await hooks.buildChargeableDraft({
    classData,
    student,
    enrollmentPayload,
    finance: normalized.finance
  });

  const result = await schoolDataService.createClassEnrollmentPeriod({
    ...enrollmentPayload,
    feeCategory,
    pricing: draftBundle.pricing,
    notes: enrollmentPayload.notes || `Rolling enrollment with finance posting for class ${classData.id}.`
  }, reqUser);

  const draftPeriod = result?.period || null;
  const draftPeriodId = toPublicId(draftPeriod?.id || '');
  if (!draftPeriodId) throw new Error('Draft enrollment period was not created.');

  const draftFinance = await hooks.ensureDraftTransactions({
    period: draftPeriod,
    draftItems: draftBundle.items,
    classData
  });

  const requestedStatus = String(enrollmentPayload.status || '').trim().toLowerCase();
  const persistStatus = ['waiting_list', 'to_be_confirmed'].includes(requestedStatus)
    ? requestedStatus
    : 'draft';

  const updatedDraft = await schoolDataService.updateClassEnrollmentPeriod(draftPeriodId, {
    status: persistStatus,
    notes: enrollmentPayload.notes || `Draft rolling enrollment for class ${classData.id}.`,
    transactionSummary: {
      ...draftFinance.summary,
      mode: 'chargeable',
      currency: draftBundle.currency,
      totalAmount: draftBundle.totalAmount,
      transactionCount: draftBundle.previewRows.length,
      draftTransactionItems: draftFinance.items,
      draftPreviewRows: draftBundle.previewRows,
      draftTransactionIds: draftFinance.transactionIds,
      draftSavedAt: new Date().toISOString(),
      note: 'Draft generated before posting.',
      pendingGapBatch: null,
      pendingStagedSessions: null,
      extendCycleEndDate: false
    }
  }, reqUser);

  return {
    period: updatedDraft || draftPeriod,
    mode: 'chargeable',
    draft: {
      draftPreviewRows: draftBundle.previewRows,
      draftTransactionItems: draftFinance.items,
      totalAmount: draftBundle.totalAmount
    }
  };
}

/**
 * Execute rolling enrollment for one or more students.
 * Sessions in sessionsToCreate are committed before any enrollment period is created.
 */
async function execute({
  classData,
  reqUser,
  rawRequest = {},
  hooks = {}
} = {}) {
  if (!classData?.id) throw new Error('classData is required.');
  const normalized = normalizeEnrollmentEngineRequest({ ...rawRequest, classId: rawRequest.classId || classData.id });
  const billingMode = normalizeClassBillingMode(classData?.billingMode);

  const firstStudentId = normalized.students[0]?.studentId || '';
  let sessionCommit = await commitSessionsBeforeEnrollment({
    classData,
    normalized,
    reqUser,
    enrollingStudentId: firstStudentId
  });
  let classDataCurrent = sessionCommit.classData || classData;

  const results = [];
  for (const studentEntry of normalized.students) {
    const studentId = studentEntry.studentId;
    try {
      const student = await schoolDataService.getDataById('students', studentId, reqUser);
      if (!student) throw new Error('Student not found.');
      if (!idsEqual(student?.orgId, classDataCurrent?.orgId)) {
        throw new Error('Student organization does not match the class organization.');
      }

      let resolution = {
        programId: studentEntry.programId,
        termId: studentEntry.termId,
        programRegistrationId: studentEntry.programRegistrationId
      };
      if (hooks.applyResolution) {
        resolution = await hooks.applyResolution(student, studentEntry, resolution) || resolution;
      }

      const programId = toPublicId(resolution.programId || studentEntry.programId || '');
      const termId = toPublicId(resolution.termId || studentEntry.termId || '');
      if (hooks.assertPrerequisites) {
        await hooks.assertPrerequisites(student, programId, termId, normalized.startDate);
      }

      await assertEnrollmentAlignmentForCreate(classDataCurrent, normalized, reqUser);

      const enrollmentPayload = buildEnrollmentPayloadForStudent(
        classDataCurrent,
        normalized,
        student,
        studentEntry,
        resolution
      );

      let enrollResult;
      if (billingMode === 'no_charge') {
        enrollResult = await enrollStudentNoCharge({
          classData: classDataCurrent,
          normalized,
          student,
          studentEntry,
          enrollmentPayload,
          reqUser,
          hooks
        });
      } else {
        enrollResult = await enrollStudentChargeable({
          classData: classDataCurrent,
          normalized,
          student,
          enrollmentPayload,
          reqUser,
          hooks
        });
      }

      results.push({
        studentId,
        ok: true,
        period: enrollResult.period || null,
        academicLedger: enrollResult.academicLedger || null,
        mode: enrollResult.mode,
        draft: enrollResult.draft || null
      });
    } catch (error) {
      results.push({
        studentId,
        ok: false,
        error: String(error?.message || error || 'Enrollment failed.')
      });
    }
  }

  const succeeded = results.filter((row) => row.ok).length;
  const failed = results.length - succeeded;

  return {
    sessionCommit: {
      createdCount: sessionCommit.createdCount || 0,
      cycleExtended: sessionCommit.cycleExtended === true,
      committed: sessionCommit.committed === true
    },
    results,
    summary: {
      succeeded,
      failed,
      total: results.length
    },
    classData: classDataCurrent
  };
}

module.exports = {
  ENROLLMENT_MODES,
  normalizeEnrollmentEngineRequest,
  buildAlignmentPayload,
  buildAlignmentBodyFromRequest,
  commitSessionsBeforeEnrollment,
  assertEnrollmentAlignmentForCreate,
  execute
};
