const schoolDataService = require('./schoolDataService');
const schoolDependencyService = require('./schoolDependencyService');
const classEnrollmentDeleteService = require('./classEnrollmentDeleteService');
const classDeletePreparationHrefs = require('./classDeletePreparationHrefs');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MAX_CHAIN_DEPTH = 50;

function normalizeCycleNo(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildSessionHref(classId, sessionId) {
  return `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`;
}

function resolveCurrentStep(cycles, recommendedOrder, targetClassId) {
  for (const classId of recommendedOrder) {
    const cycle = cycles.find((row) => idsEqual(row.id, classId));
    if (!cycle) continue;
    if (cycle.hasDownstream) return cycle;
    if (!idsEqual(classId, targetClassId) && cycle.canDeleteClass) return cycle;
    if (!cycle.canDeleteClass) return cycle;
  }
  return cycles.find((row) => idsEqual(row.id, targetClassId)) || cycles[0] || null;
}

async function getClassOrThrow(classId, reqUser) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) throw new Error('classId is required.');
  const classRow = await schoolDataService.getDataById('classes', normalizedClassId, reqUser);
  if (!classRow) throw new Error('Class not found or inaccessible.');
  return classRow;
}

function mapClassSummary(classRow) {
  const id = toPublicId(classRow?.id);
  return {
    id,
    title: String(classRow?.title || classRow?.name || id || '').trim(),
    cycleNo: normalizeCycleNo(classRow?.cycleNo),
    cycleStartDate: String(classRow?.cycleStartDate || '').trim(),
    cycleEndDate: String(classRow?.cycleEndDate || '').trim(),
    registrationMode: String(classRow?.registrationMode || '').trim().toLowerCase(),
    previousClassId: toPublicId(classRow?.previousClassId),
    nextClassId: toPublicId(classRow?.nextClassId),
    preparationHref: classDeletePreparationHrefs.buildDeletePreparationHref(id)
  };
}

async function walkDownstreamChain(startClassId, reqUser) {
  const chain = [];
  const visited = new Set();
  let currentId = toPublicId(startClassId);

  while (currentId && chain.length < MAX_CHAIN_DEPTH) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    // eslint-disable-next-line no-await-in-loop
    const classRow = await schoolDataService.getDataById('classes', currentId, reqUser);
    if (!classRow) break;
    chain.push(classRow);
    const nextId = toPublicId(classRow?.nextClassId);
    if (!nextId || idsEqual(nextId, currentId)) break;
    currentId = nextId;
  }

  return chain;
}

async function buildCycleChainFromClass(classId, reqUser) {
  const targetClass = await getClassOrThrow(classId, reqUser);
  const normalizedTargetId = toPublicId(targetClass.id);

  let headClass = targetClass;
  const visitedUpstream = new Set([normalizedTargetId]);
  for (let i = 0; i < MAX_CHAIN_DEPTH; i += 1) {
    const previousId = toPublicId(headClass?.previousClassId);
    if (!previousId || visitedUpstream.has(previousId)) break;
    visitedUpstream.add(previousId);
    // eslint-disable-next-line no-await-in-loop
    const previousClass = await schoolDataService.getDataById('classes', previousId, reqUser);
    if (!previousClass) break;
    headClass = previousClass;
  }

  const chainRows = await walkDownstreamChain(headClass.id, reqUser);
  const chain = chainRows.map(mapClassSummary);
  const targetIndex = chain.findIndex((row) => idsEqual(row.id, normalizedTargetId));

  return {
    targetClassId: normalizedTargetId,
    targetClass: mapClassSummary(targetClass),
    chain,
    targetIndex: targetIndex >= 0 ? targetIndex : chain.length - 1,
    tailClassId: chain.length ? chain[chain.length - 1].id : normalizedTargetId
  };
}

async function listLockedSessionsForClass(classId, reqUser) {
  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  return (Array.isArray(sessions) ? sessions : []).filter((session) =>
    schoolDependencyService.isSessionTimesheetLocked(session)
    && String(session?.lockReason || '') === 'timesheet_approved'
  ).map((session) => ({
    sessionId: toPublicId(session?.sessionId || session?.id),
    date: String(session?.date || '').trim(),
    startTime: String(session?.startTime || '').trim(),
    label: `${session?.date || 'Session'} ${session?.startTime || ''}`.trim(),
    href: buildSessionHref(classId, toPublicId(session?.sessionId || session?.id))
  }));
}

async function summarizeCycleForPreparation(classRow, reqUser) {
  const classId = toPublicId(classRow?.id);
  const enrollmentRows = await schoolDataService.fetchData(
    'classEnrollmentPeriods',
    { page: 1, classId__eq: classId },
    reqUser
  );
  const periods = Array.isArray(enrollmentRows) ? enrollmentRows : [];
  const enrollments = [];
  for (const period of periods) {
    // eslint-disable-next-line no-await-in-loop
    const eligibility = await classEnrollmentDeleteService.assessEnrollmentDeleteEligibility(period, classRow, reqUser);
    // eslint-disable-next-line no-await-in-loop
    const studentLabel = await classEnrollmentDeleteService.resolveStudentLabel(period?.studentId, reqUser);
    enrollments.push({
      periodId: toPublicId(period?.id),
      studentId: toPublicId(period?.studentId),
      studentLabel,
      startDate: String(period?.startDate || '').trim(),
      endDate: String(period?.endDate || '').trim(),
      status: String(period?.status || '').trim().toLowerCase(),
      origin: eligibility.origin,
      canDelete: eligibility.canDelete,
      blockReason: eligibility.blockReason,
      blockCode: eligibility.blockCode,
      warnings: eligibility.warnings,
      relatedCounts: eligibility.relatedCounts,
      upstreamSummary: eligibility.upstreamSummary,
      lockedSessions: eligibility.lockedSessions || [],
      enrollmentHref: `/school/classes/enrollment-periods/${encodeURIComponent(toPublicId(period?.id) || '')}`
    });
  }

  const lockedSessions = await listLockedSessionsForClass(classId, reqUser);
  const nextClassId = toPublicId(classRow?.nextClassId);
  let downstreamClass = null;
  if (nextClassId) {
    downstreamClass = await schoolDataService.getDataById('classes', nextClassId, reqUser);
  }

  const blockers = [];
  if (downstreamClass) {
    blockers.push({
      code: 'CLASS_DOWNSTREAM_CYCLE',
      message: 'Delete downstream cycles first (tail-first).',
      downstreamClassId: nextClassId,
      downstreamClassTitle: String(downstreamClass?.title || downstreamClass?.name || nextClassId).trim(),
      preparationHref: classDeletePreparationHrefs.buildDeletePreparationHref(classId, nextClassId)
    });
  }
  if (lockedSessions.length) {
    blockers.push({
      code: 'TIMESHEET_LOCKED_SESSION',
      message: 'Reopen approved timesheets that locked class sessions before deleting.',
      count: lockedSessions.length,
      sessions: lockedSessions
    });
  }

  const undeletableEnrollments = enrollments.filter((row) => !row.canDelete);
  if (undeletableEnrollments.length) {
    blockers.push({
      code: 'ENROLLMENT_BLOCKED',
      message: 'Resolve blocked enrollments before deleting this class.',
      count: undeletableEnrollments.length
    });
  }
  if (enrollments.length) {
    blockers.push({
      code: 'ENROLLMENT_PERIOD',
      message: 'Remove all enrollment periods on this class before deleting.',
      count: enrollments.length
    });
  }

  const hasDownstream = Boolean(downstreamClass);
  const enrollmentCount = enrollments.length;
  const ready = !hasDownstream && !lockedSessions.length && enrollmentCount === 0
    && undeletableEnrollments.length === 0;

  let status = 'in_progress';
  if (ready) status = 'ready';
  else if (hasDownstream) status = 'blocked';

  return {
    ...mapClassSummary(classRow),
    status,
    hasDownstream,
    downstreamClassId: hasDownstream ? nextClassId : '',
    downstreamClassTitle: hasDownstream
      ? String(downstreamClass?.title || downstreamClass?.name || nextClassId).trim()
      : '',
    lockedSessionCount: lockedSessions.length,
    lockedSessions,
    enrollmentCount,
    enrollments,
    blockers,
    canDeleteClass: ready
  };
}

async function buildDeletePreparationPlan(targetClassId, reqUser) {
  const chainInfo = await buildCycleChainFromClass(targetClassId, reqUser);
  const { chain, targetIndex, targetClassId: normalizedTargetId } = chainInfo;

  const tailFirstOrder = [...chain].reverse().map((row) => row.id);
  const cycles = [];
  for (const classId of tailFirstOrder) {
    // eslint-disable-next-line no-await-in-loop
    const classRow = await schoolDataService.getDataById('classes', classId, reqUser);
    if (!classRow) continue;
    // eslint-disable-next-line no-await-in-loop
    cycles.push(await summarizeCycleForPreparation(classRow, reqUser));
  }

  const currentStep = resolveCurrentStep(cycles, tailFirstOrder, normalizedTargetId);
  const targetCycle = cycles.find((cycle) => idsEqual(cycle.id, normalizedTargetId)) || cycles[targetIndex] || null;
  const canDeleteTarget = Boolean(targetCycle?.canDeleteClass);

  return {
    targetClassId: normalizedTargetId,
    targetClass: chainInfo.targetClass,
    chain: cycles,
    recommendedOrder: tailFirstOrder,
    currentStepClassId: currentStep?.id || normalizedTargetId,
    currentStep,
    canDeleteTarget,
    remainingBlockers: currentStep?.blockers || [],
    preparationHref: classDeletePreparationHrefs.buildDeletePreparationHref(normalizedTargetId)
  };
}

class ClassDeleteNotAllowedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ClassDeleteNotAllowedError';
    this.code = details.code || 'CLASS_DELETE_NOT_ALLOWED';
    this.preparationHref = details.preparationHref || '';
    this.blockers = Array.isArray(details.blockers) ? details.blockers : [];
  }
}

async function assertClassDeleteAllowed(classId, reqUser) {
  const plan = await buildDeletePreparationPlan(classId, reqUser);
  const targetCycle = plan.chain.find((cycle) => idsEqual(cycle.id, plan.targetClassId));
  if (!targetCycle) {
    throw new ClassDeleteNotAllowedError('Class delete preparation could not be built.', {
      preparationHref: plan.preparationHref
    });
  }

  const blockers = [];
  if (targetCycle.hasDownstream) {
    blockers.push({
      code: 'CLASS_DOWNSTREAM_CYCLE',
      message: `Delete downstream cycle "${targetCycle.downstreamClassTitle || targetCycle.downstreamClassId}" first (tail-first).`,
      preparationHref: classDeletePreparationHrefs.buildDeletePreparationHref(plan.targetClassId, targetCycle.downstreamClassId)
    });
  }
  if (targetCycle.lockedSessionCount > 0) {
    blockers.push({
      code: 'TIMESHEET_LOCKED_SESSION',
      message: 'Reopen approved timesheets that locked class sessions before deleting.'
    });
  }
  if (targetCycle.enrollmentCount > 0) {
    blockers.push({
      code: 'ENROLLMENT_PERIOD',
      message: 'Remove all enrollment periods on this class before deleting.',
      preparationHref: plan.preparationHref
    });
  }

  if (blockers.length) {
    throw new ClassDeleteNotAllowedError(blockers[0].message, {
      code: blockers[0].code,
      preparationHref: blockers[0].preparationHref || plan.preparationHref,
      blockers
    });
  }

  return plan;
}

module.exports = {
  buildDeletePreparationHref: classDeletePreparationHrefs.buildDeletePreparationHref,
  buildCycleChainFromClass,
  buildDeletePreparationPlan,
  summarizeCycleForPreparation,
  assertClassDeleteAllowed,
  ClassDeleteNotAllowedError
};
