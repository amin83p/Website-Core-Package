'use strict';

const crypto = require('node:crypto');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const makeupSessionAllocationService = require('./makeupSessionAllocationService');
const deadlineReconciliationService = require('./timesheetDeadlineReconciliationService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const MAX_CHAIN_DEPTH = 25;
const MAX_CHAIN_NODES = 500;
const NON_BLOCKING_MAKEUP_CONFLICT_CODES = new Set(['orphaned_makeup_parent']);

function isBlockingMakeupConflict(conflict = {}) {
  return !NON_BLOCKING_MAKEUP_CONFLICT_CODES.has(String(conflict?.code || '').trim());
}

function normalizeId(value) {
  return String(value || '').trim();
}

function roundHours(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function buildSessionKey(classId, sessionId) {
  const safeClassId = normalizeId(classId);
  const safeSessionId = normalizeId(sessionId);
  return safeClassId && safeSessionId ? `${safeClassId}::${safeSessionId}` : '';
}

function buildCatchupAdjustmentId(sourcePeriodId, classId, sessionId, personId) {
  const safe = (value) => normalizeId(value).replace(/[^A-Za-z0-9_-]/g, '_');
  return `adj-${safe(sourcePeriodId)}-makeup-${safe(classId)}-${safe(sessionId)}-${safe(personId)}`;
}

function classifyDate(date, currentPeriod = {}) {
  const token = normalizeId(date);
  const startDate = normalizeId(currentPeriod?.startDate);
  const endDate = normalizeId(currentPeriod?.endDate);
  if (!token) return 'undated';
  if (startDate && token < startDate) return 'closed_period';
  if (endDate && token > endDate) return 'future_period';
  if (startDate && endDate && token >= startDate && token <= endDate) {
    if (deadlineReconciliationService.isDateInReconciliationWindow(token, currentPeriod)) {
      return 'current_reconciliation_window';
    }
    return 'current_before_deadline';
  }
  return 'outside_period';
}

function buildStatusLabelMap(statusMeta = []) {
  return new Map((Array.isArray(statusMeta) ? statusMeta : []).map((row) => [
    sessionStatusPolicyService.normalizeStatusCode(row?.code),
    String(row?.label || row?.code || '').trim()
  ]));
}

function buildSessionGraph({ classes = [], sessionsByClassId = new Map(), statusMeta = [], teacherId = '' } = {}) {
  const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
  const statusLabelMap = buildStatusLabelMap(statusMeta);
  const nodes = new Map();
  const sessionIdBuckets = new Map();
  const childrenByParent = new Map();
  const conflicts = [];

  (Array.isArray(classes) ? classes : []).forEach((classRow) => {
    const classId = normalizeId(classRow?.id);
    if (!classId) return;
    const sessions = sessionsByClassId instanceof Map
      ? (sessionsByClassId.get(classId) || [])
      : (sessionsByClassId?.[classId] || []);
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      const sessionId = normalizeId(session?.sessionId || session?.id);
      const key = buildSessionKey(classId, sessionId);
      if (!key) return;
      if (nodes.has(key)) {
        conflicts.push({
          code: 'duplicate_session_identity',
          classId,
          sessionId,
          message: `Duplicate session identity ${key}.`
        });
        return;
      }
      const status = sessionStatusPolicyService.normalizeSessionStatus(session?.status, session?.notes);
      const durationHours = Number.parseFloat(session?.durationHours) || 0;
      const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
      });
      const makeUpRequired = sessionStatusPolicyService.isMakeUpRequiredByMap(statusMap, {
        status: session?.status,
        notes: session?.notes
      });
      const hours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
        status: session?.status,
        notes: session?.notes,
        durationHours,
        session
      });
      const originalClassId = normalizeId(session?.makeup?.originalClassId);
      const originalSessionId = normalizeId(session?.makeup?.originalSessionId);
      const parentKey = session?.makeup?.isMakeup === true
        ? buildSessionKey(originalClassId, originalSessionId)
        : '';
      const deliveryPersonIds = sessionDeliveryTeamService.getSessionDeliveryPersonIds(session);
      const node = {
        key,
        classId,
        className: String(classRow?.title || classRow?.name || classId).trim(),
        sessionId,
        date: normalizeId(session?.date),
        startTime: normalizeId(session?.startTime),
        endTime: normalizeId(session?.endTime),
        durationHours: roundHours(durationHours),
        status,
        statusLabel: statusLabelMap.get(status) || status || 'Unknown',
        hours: roundHours(hours),
        isFinalStatus,
        makeUpRequired,
        isMakeupSession: session?.makeup?.isMakeup === true,
        parentKey,
        deliveryPersonIds,
        assignedToTeacher: deliveryPersonIds.some((personId) => idsEqual(personId, teacherId)),
        teacherName: String(session?.delivery?.deliveredByName || session?.delivery?.deliveredBy || '').trim(),
        manageUrl: `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`,
        rawSession: session,
        classSessions: sessions,
        allocation: null
      };
      nodes.set(key, node);
      if (!sessionIdBuckets.has(sessionId)) sessionIdBuckets.set(sessionId, []);
      sessionIdBuckets.get(sessionId).push(node);
    });
  });

  nodes.forEach((node) => {
    if (!node.parentKey) return;
    if (!nodes.has(node.parentKey)) {
      conflicts.push({
        code: 'orphaned_makeup_parent',
        classId: node.classId,
        sessionId: node.sessionId,
        message: `The parent session for make-up ${node.sessionId} was removed. Delete this make-up session from Session Manager if it is still Scheduled, or fix its parent link.`
      });
      node.parentKey = '';
      node.isOrphanedMakeup = true;
    }
  });

  nodes.forEach((node) => {
    if (!node.parentKey) return;
    if (!childrenByParent.has(node.parentKey)) childrenByParent.set(node.parentKey, []);
    childrenByParent.get(node.parentKey).push(node.key);
  });

  nodes.forEach((node) => {
    if (!node.makeUpRequired) return;
    try {
      node.allocation = makeupSessionAllocationService.buildMakeupAllocationSummary({
        classId: node.classId,
        originalSession: node.rawSession,
        sessions: node.classSessions,
        statusDefinitions: statusMap
      });
    } catch (error) {
      conflicts.push({
        code: 'makeup_allocation_invalid',
        classId: node.classId,
        sessionId: node.sessionId,
        message: error.message
      });
    }
  });

  return { nodes, sessionIdBuckets, childrenByParent, conflicts, statusMap };
}

function resolveGraphNode(graph, reference = {}) {
  const classId = normalizeId(reference?.classId || reference?.rootClassId);
  const sessionId = normalizeId(reference?.sessionId || reference?.sourceSessionId || reference?.rootSessionId);
  const key = buildSessionKey(classId, sessionId);
  if (key && graph?.nodes?.has(key)) return { node: graph.nodes.get(key), conflict: null };
  const matches = graph?.sessionIdBuckets?.get(sessionId) || [];
  if (matches.length === 1) return { node: matches[0], conflict: null };
  if (matches.length > 1) {
    return {
      node: null,
      conflict: {
        code: 'ambiguous_legacy_session_identity',
        classId,
        sessionId,
        message: `Session ${sessionId} exists in more than one class; a class ID is required.`
      }
    };
  }
  return {
    node: null,
    conflict: {
      code: 'missing_makeup_chain_root',
      classId,
      sessionId,
      message: `The make-up reconciliation root ${sessionId || 'unknown'} could not be found.`
    }
  };
}

function resolveTopAncestor(graph, startNode) {
  let node = startNode;
  const seen = new Set();
  while (node?.parentKey) {
    if (seen.has(node.key)) {
      return { node, conflict: { code: 'makeup_cycle', classId: node.classId, sessionId: node.sessionId, message: 'A cycle was detected in the make-up session chain.' } };
    }
    seen.add(node.key);
    const parent = graph.nodes.get(node.parentKey);
    if (!parent) {
      return { node, conflict: { code: 'missing_makeup_parent', classId: node.classId, sessionId: node.sessionId, message: `The original session for make-up ${node.sessionId} could not be found.` } };
    }
    node = parent;
  }
  return { node, conflict: null };
}

function buildPaymentCoverage({ timesheets = [], periods = [], teacherId = '' } = {}) {
  const periodById = new Map((Array.isArray(periods) ? periods : []).map((row) => [normalizeId(row?.id), row]));
  const paidKeys = new Set();
  const paidSessionIds = new Set();
  const pendingKeys = new Set();
  const pendingSessionIds = new Set();
  const otherPaidKeys = new Set();
  const otherPaidSessionIds = new Set();
  const otherPaymentSourcesByKey = new Map();
  const otherPaymentSourcesBySessionId = new Map();

  function rememberOtherPaymentSource(map, key, source = {}) {
    if (!key) return;
    const candidate = {
      periodId: normalizeId(source.periodId),
      startDate: normalizeId(source.startDate)
    };
    const existing = map.get(key);
    if (
      !existing
      || `${candidate.startDate}:${candidate.periodId}`.localeCompare(`${existing.startDate}:${existing.periodId}`) < 0
    ) {
      map.set(key, candidate);
    }
  }

  (Array.isArray(timesheets) ? timesheets : [])
    .forEach((timesheet) => {
      const period = periodById.get(normalizeId(timesheet?.periodId));
      const payrollFinal = String(timesheet?.status || '').toLowerCase() === 'processed'
        || String(period?.status || '').toLowerCase() === 'processed';
      const pendingPayroll = ['submitted', 'approved'].includes(String(timesheet?.status || '').toLowerCase()) && !payrollFinal;
      if (!payrollFinal && !pendingPayroll) return;
      const entries = Array.isArray(timesheet?.submissionSnapshot?.entries)
        ? timesheet.submissionSnapshot.entries
        : [];
      entries.forEach((entry) => {
        if (!entry || entry.isDeleted === true) return;
        if (
          entry.isPriorPeriodAdjustment !== true
          && (entry.isManual === true || entry.isSchoolActivity === true || entry.isReportReflection === true)
        ) return;
        const sourceClassId = entry.isPriorPeriodAdjustment === true
          ? normalizeId(entry?.adjustmentMeta?.sourceClassId || entry?.classId)
          : normalizeId(entry?.classId);
        const sourceSessionId = entry.isPriorPeriodAdjustment === true
          ? normalizeId(entry?.adjustmentMeta?.sourceSessionId)
          : normalizeId(entry?.sessionId);
        if (!sourceSessionId) return;
        const key = buildSessionKey(sourceClassId, sourceSessionId);
        const belongsToTarget = idsEqual(timesheet?.teacherId, teacherId);
        if (!belongsToTarget) {
          if (!payrollFinal) return;
          const sourcePeriodId = entry.isPriorPeriodAdjustment === true
            ? normalizeId(
              entry?.adjustmentMeta?.makeupRootSourcePeriodId
              || entry?.adjustmentMeta?.sourcePeriodId
              || timesheet?.periodId
            )
            : normalizeId(timesheet?.periodId);
          const sourcePeriod = periodById.get(sourcePeriodId) || period || {};
          if (key) {
            otherPaidKeys.add(key);
            rememberOtherPaymentSource(otherPaymentSourcesByKey, key, {
              periodId: sourcePeriodId,
              startDate: sourcePeriod?.startDate
            });
          } else {
            otherPaidSessionIds.add(sourceSessionId);
            rememberOtherPaymentSource(otherPaymentSourcesBySessionId, sourceSessionId, {
              periodId: sourcePeriodId,
              startDate: sourcePeriod?.startDate
            });
          }
          return;
        }
        const keySet = payrollFinal ? paidKeys : pendingKeys;
        const idSet = payrollFinal ? paidSessionIds : pendingSessionIds;
        if (key) keySet.add(key);
        else idSet.add(sourceSessionId);
      });
    });

  return {
    isPaid(node) {
      return paidKeys.has(node.key) || paidSessionIds.has(node.sessionId);
    },
    isPending(node) {
      return pendingKeys.has(node.key) || pendingSessionIds.has(node.sessionId);
    },
    wasPaidToAnother(node) {
      return otherPaidKeys.has(node.key) || otherPaidSessionIds.has(node.sessionId);
    },
    hasLegacyOtherPayment(node) {
      return !otherPaidKeys.has(node.key) && otherPaidSessionIds.has(node.sessionId);
    },
    getOtherPaymentSourcePeriodId(node) {
      return normalizeId(
        otherPaymentSourcesByKey.get(node.key)?.periodId
        || otherPaymentSourcesBySessionId.get(node.sessionId)?.periodId
      );
    }
  };
}

function normalizeRootRef(ref = {}, fallbackSourcePeriodId = '') {
  return {
    classId: normalizeId(ref?.classId || ref?.rootClassId),
    sessionId: normalizeId(ref?.sessionId || ref?.sourceSessionId || ref?.rootSessionId),
    sourcePeriodId: normalizeId(ref?.sourcePeriodId || ref?.rootSourcePeriodId || fallbackSourcePeriodId)
  };
}

function buildNodeAudit(node, {
  depth = 0,
  currentPeriod = {},
  coverage,
  baselineKeys = new Set(),
  baselineHoursByKey = new Map(),
  teacherId = ''
} = {}) {
  const periodDisposition = classifyDate(node.date, currentPeriod);
  const hasBaseline = baselineKeys.has(node.key);
  const baselineHours = hasBaseline ? roundHours(baselineHoursByKey.get(node.key)) : 0;
  let paymentDisposition = 'assigned_elsewhere';
  if (hasBaseline) paymentDisposition = node.assignedToTeacher ? 'reconciled_baseline' : 'baseline_reversal';
  else if (node.assignedToTeacher) {
    if (coverage?.isPaid(node)) paymentDisposition = 'already_paid';
    else if (coverage?.isPending(node)) paymentDisposition = 'pending_payroll';
    else if (periodDisposition === 'closed_period') {
      if (!node.isFinalStatus) paymentDisposition = 'pending_finalization';
      else if (Math.abs(node.hours) < 0.005) paymentDisposition = 'resolved_zero';
      else paymentDisposition = 'catch_up';
    } else if (periodDisposition.startsWith('current_')) paymentDisposition = 'current_period';
    else if (periodDisposition === 'future_period') paymentDisposition = 'future_period';
    else paymentDisposition = 'pending_schedule';
  }
  const allocation = node.allocation || {};
  const openReasons = [];
  if (!node.isFinalStatus) openReasons.push('status_not_final');
  if (node.isFinalStatus && node.makeUpRequired) {
    if (Number(allocation.allowedDurationMinutes || 0) <= 0) openReasons.push('invalid_allowance');
    if (Number(allocation.remainingDurationMinutes || 0) > 0) openReasons.push('makeup_not_fully_scheduled');
  }
  if (paymentDisposition === 'pending_finalization' || paymentDisposition === 'future_period' || paymentDisposition === 'pending_payroll') {
    openReasons.push(paymentDisposition);
  }
  const finalHours = node.isFinalStatus ? roundHours(node.hours) : 0;
  const isProvisional = periodDisposition === 'current_reconciliation_window' && !node.isFinalStatus;
  let adjustmentHours = 0;
  if (paymentDisposition === 'catch_up') {
    adjustmentHours = finalHours;
  } else if (hasBaseline && node.isFinalStatus) {
    adjustmentHours = paymentDisposition !== 'baseline_reversal' && periodDisposition === 'closed_period'
      ? roundHours(finalHours - baselineHours)
      : roundHours(-baselineHours);
  }
  return {
    key: node.key,
    classId: node.classId,
    className: node.className,
    sessionId: node.sessionId,
    parentKey: node.parentKey,
    depth,
    date: node.date,
    startTime: node.startTime,
    endTime: node.endTime,
    durationHours: node.durationHours,
    status: node.status,
    statusLabel: node.statusLabel,
    hours: node.hours,
    baselineHours,
    finalHours,
    hasFinalHours: node.isFinalStatus,
    adjustmentHours,
    isProvisional,
    isFinalStatus: node.isFinalStatus,
    makeUpRequired: node.makeUpRequired,
    isMakeupSession: node.isMakeupSession,
    deliveryPersonIds: [...node.deliveryPersonIds],
    teacherName: node.teacherName,
    assignedToTeacher: node.assignedToTeacher,
    periodDisposition,
    paymentDisposition,
    allowedDurationHours: roundHours(allocation.allowedDurationHours),
    allocatedDurationHours: roundHours(allocation.allocatedDurationHours),
    remainingDurationHours: roundHours(allocation.remainingDurationHours),
    isFullyAllocated: allocation.isFullyAllocated === true,
    isOverAllocated: allocation.isOverAllocated === true,
    openReasons: [...new Set(openReasons)],
    manageUrl: node.manageUrl,
    targetPersonId: normalizeId(teacherId)
  };
}

function buildCatchupAdjustment({ node, audit, rootRef, sourcePeriodId, teacherId }) {
  const isMakeupCatchup = node.isMakeupSession || node.makeUpRequired;
  const reconciliationReason = isMakeupCatchup
    ? 'makeup_closed_period_catchup'
    : 'reassigned_closed_period_catchup';
  const changeSummary = `${node.className || (isMakeupCatchup ? 'Make-up session' : 'Session')} on ${node.date || 'an earlier date'} was not included in a payroll-final timesheet; add ${roundHours(node.hours).toFixed(2)} hrs for ${node.statusLabel || node.status}.`;
  return {
    sourceSessionId: node.sessionId,
    sourceClassId: node.classId,
    sourceType: isMakeupCatchup ? 'makeup_session' : 'class_session',
    sourcePeriodId: normalizeId(sourcePeriodId),
    sourcePeriodName: '',
    sourceSessionDate: node.date,
    classId: node.classId,
    className: node.className,
    baselineStatus: 'unpaid',
    currentStatus: node.status,
    finalStatus: node.status,
    baselineHours: 0,
    snapshotHours: 0,
    currentHours: roundHours(node.hours),
    deltaHours: roundHours(node.hours),
    adjustmentHours: roundHours(node.hours),
    reconciliationReason,
    resolutionReason: reconciliationReason,
    paymentDisposition: audit.paymentDisposition,
    makeupRootClassId: rootRef.classId,
    makeupRootSessionId: rootRef.sessionId,
    makeupRootSourcePeriodId: rootRef.sourcePeriodId,
    makeupDepth: audit.depth,
    assignedPersonId: normalizeId(teacherId),
    claimKey: crypto.createHash('sha256').update(`${node.key}::${normalizeId(teacherId)}`).digest('hex'),
    changeSummary,
    comment: `${isMakeupCatchup ? 'Make-up reconciliation' : 'Reassignment reconciliation'} catch-up: ${changeSummary}`,
    adjustmentSessionId: buildCatchupAdjustmentId(sourcePeriodId, node.classId, node.sessionId, teacherId)
  };
}

function analyzeMakeupChains({
  graph,
  rootRefs = [],
  carriedRootRefs = [],
  currentPeriod = {},
  coverage,
  baselineKeys = new Set(),
  baselineHoursByKey = new Map(),
  teacherId = '',
  sourcePeriodId = ''
} = {}) {
  const graphConflicts = Array.isArray(graph?.conflicts) ? graph.conflicts : [];
  const conflicts = [];
  const roots = new Map();
  [...(Array.isArray(rootRefs) ? rootRefs : []), ...(Array.isArray(carriedRootRefs) ? carriedRootRefs : [])]
    .map((ref) => normalizeRootRef(ref, sourcePeriodId))
    .filter((ref) => ref.sessionId)
    .forEach((ref) => roots.set(buildSessionKey(ref.classId, ref.sessionId) || ref.sessionId, ref));

  graph.nodes.forEach((node) => {
    if (!node.assignedToTeacher) return;
    const hasMakeupChildren = (graph.childrenByParent.get(node.key) || []).length > 0;
    const wasPaidToAnother = coverage?.wasPaidToAnother?.(node) === true;
    if (!node.isMakeupSession && !node.makeUpRequired && !hasMakeupChildren && !wasPaidToAnother) return;
    const disposition = classifyDate(node.date, currentPeriod);
    if (disposition !== 'closed_period' && disposition !== 'future_period') return;
    if (
      wasPaidToAnother
      && coverage?.hasLegacyOtherPayment?.(node) === true
      && (graph.sessionIdBuckets.get(node.sessionId) || []).length > 1
    ) {
      conflicts.push({
        code: 'ambiguous_legacy_session_identity',
        classId: node.classId,
        sessionId: node.sessionId,
        message: `Session ${node.sessionId} exists in more than one class; the historical payment has no class ID.`
      });
      return;
    }
    const top = resolveTopAncestor(graph, node);
    if (top.conflict) {
      conflicts.push(top.conflict);
      return;
    }
    if (!top.node) return;
    const ref = normalizeRootRef({
      classId: top.node.classId,
      sessionId: top.node.sessionId,
      sourcePeriodId: coverage?.getOtherPaymentSourcePeriodId?.(node) || sourcePeriodId
    }, sourcePeriodId);
    const rootKey = buildSessionKey(ref.classId, ref.sessionId);
    if (!roots.has(rootKey)) roots.set(rootKey, ref);
  });

  const resolvedRoots = new Map();
  roots.forEach((rootRef) => {
    const resolved = resolveGraphNode(graph, rootRef);
    if (resolved.conflict) {
      conflicts.push(resolved.conflict);
      return;
    }
    if (!resolvedRoots.has(resolved.node.key)) {
      resolvedRoots.set(resolved.node.key, { rootRef, rootNode: resolved.node });
    }
  });
  const effectiveRoots = [...resolvedRoots.values()].filter(({ rootNode }) => {
    let parentKey = rootNode.parentKey;
    const seen = new Set([rootNode.key]);
    while (parentKey) {
      if (resolvedRoots.has(parentKey)) return parentKey === rootNode.key;
      if (seen.has(parentKey)) return true;
      seen.add(parentKey);
      parentKey = graph.nodes.get(parentKey)?.parentKey || '';
    }
    return true;
  });

  const chains = [];
  const adjustments = [];
  const openMakeupRootRefs = [];
  let visitedCount = 0;

  effectiveRoots.forEach(({ rootRef, rootNode }) => {
    const chainNodes = [];
    const chainConflicts = [];
    const visited = new Set();
    const activePath = new Set();

    function visit(node, depth) {
      if (!node) return;
      if (activePath.has(node.key)) {
        chainConflicts.push({
          code: 'makeup_cycle',
          classId: node.classId,
          sessionId: node.sessionId,
          message: 'A cycle was detected in the make-up session chain.'
        });
        return;
      }
      if (visited.has(node.key)) return;
      if (depth > MAX_CHAIN_DEPTH || visitedCount >= MAX_CHAIN_NODES) {
        chainConflicts.push({
          code: 'makeup_graph_limit_exceeded',
          classId: node.classId,
          sessionId: node.sessionId,
          message: 'The make-up chain exceeds the supported review size.'
        });
        return;
      }
      activePath.add(node.key);
      visited.add(node.key);
      visitedCount += 1;
      const audit = buildNodeAudit(node, {
        depth,
        currentPeriod,
        coverage,
        baselineKeys,
        baselineHoursByKey,
        teacherId
      });
      chainNodes.push(audit);
      if (audit.isOverAllocated) {
        chainConflicts.push({
          code: 'makeup_over_allocated',
          classId: node.classId,
          sessionId: node.sessionId,
          message: `Make-up allocation for ${node.sessionId} exceeds its permitted duration.`
        });
      }
      if (node.isFinalStatus && node.makeUpRequired && Number(node.allocation?.allowedDurationMinutes || 0) <= 0) {
        chainConflicts.push({
          code: 'makeup_allowance_invalid',
          classId: node.classId,
          sessionId: node.sessionId,
          message: `Make-up allocation for ${node.sessionId} has no valid duration allowance.`
        });
      }
      if (audit.paymentDisposition === 'catch_up') {
        const catchupSourcePeriodId = rootRef.sourcePeriodId || sourcePeriodId;
        adjustments.push(buildCatchupAdjustment({
          node,
          audit,
          rootRef,
          sourcePeriodId: catchupSourcePeriodId,
          teacherId
        }));
      }
      const childKeys = graph.childrenByParent.get(node.key) || [];
      childKeys.forEach((childKey) => visit(graph.nodes.get(childKey), depth + 1));
      activePath.delete(node.key);
    }

    visit(rootNode, 0);
    const isOpen = chainNodes.some((node) => node.openReasons.length > 0);
    const hasCatchup = chainNodes.some((node) => node.paymentDisposition === 'catch_up');
    const isRelevant = isOpen || hasCatchup || baselineKeys.has(rootNode.key) || chainConflicts.length > 0;
    if (!isRelevant) return;
    const state = chainConflicts.length ? 'conflict' : (isOpen ? 'open' : 'complete');
    const chain = {
      rootClassId: rootNode.classId,
      rootSessionId: rootNode.sessionId,
      rootSourcePeriodId: rootRef.sourcePeriodId || sourcePeriodId,
      state,
      nodes: chainNodes
    };
    chains.push(chain);
    if (state === 'open') {
      openMakeupRootRefs.push({
        classId: rootNode.classId,
        sessionId: rootNode.sessionId,
        sourcePeriodId: rootRef.sourcePeriodId || sourcePeriodId
      });
    }
    conflicts.push(...chainConflicts);
  });

  const uniqueAdjustments = new Map();
  adjustments.forEach((row) => uniqueAdjustments.set(row.adjustmentSessionId, row));
  const relevantNodeKeys = new Set(chains.flatMap((chain) => chain.nodes.map((node) => node.key)));
  graphConflicts.forEach((conflict) => {
    const key = buildSessionKey(conflict?.classId, conflict?.sessionId);
    const node = graph.nodes.get(key);
    if (relevantNodeKeys.has(key) || node?.assignedToTeacher === true) conflicts.push(conflict);
  });
  const blockingConflicts = conflicts.filter(isBlockingMakeupConflict);
  const makeupState = blockingConflicts.length
    ? 'conflict'
    : (chains.some((chain) => chain.state === 'open') ? 'open' : (chains.length ? 'complete' : 'none'));
  const nodes = chains.flatMap((chain) => chain.nodes);
  return {
    makeupState,
    chains,
    conflicts,
    adjustments: [...uniqueAdjustments.values()],
    openMakeupRootRefs,
    summary: {
      chainCount: chains.length,
      openChainCount: chains.filter((chain) => chain.state === 'open').length,
      completeChainCount: chains.filter((chain) => chain.state === 'complete').length,
      conflictCount: conflicts.length,
      nodeCount: nodes.length,
      openNodeCount: nodes.filter((node) => node.openReasons.length > 0).length,
      catchupCount: [...uniqueAdjustments.values()].length,
      catchupHours: roundHours([...uniqueAdjustments.values()].reduce((sum, row) => sum + Number(row.adjustmentHours || 0), 0))
    }
  };
}

module.exports = {
  MAX_CHAIN_DEPTH,
  MAX_CHAIN_NODES,
  NON_BLOCKING_MAKEUP_CONFLICT_CODES,
  isBlockingMakeupConflict,
  analyzeMakeupChains,
  buildCatchupAdjustmentId,
  buildPaymentCoverage,
  buildSessionGraph,
  buildSessionKey,
  classifyDate,
  resolveGraphNode,
  resolveTopAncestor
};
