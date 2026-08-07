'use strict';

const crypto = require('node:crypto');

/**
 * Compares a payroll-final timesheet snapshot with current source data and builds
 * signed correction rows for the next timesheet period.
 */
const dataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const deadlineReconciliationService = require('./timesheetDeadlineReconciliationService');
const makeupReconciliationService = require('./timesheetMakeupReconciliationService');
const { buildReportReflectionLiveSessions } = require('./reportTimesheetReflectionService');
const activityService = require('./activityService');
const { sanitizeSnapshotEntry } = require('../../models/school/timesheetModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
    return String(value || '').trim();
}

function roundHours(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function buildAdjustmentSessionId(priorPeriodId, sourceSessionId) {
    const periodPart = normalizeId(priorPeriodId).replace(/[^A-Za-z0-9_-]/g, '_');
    const sessionPart = normalizeId(sourceSessionId).replace(/[^A-Za-z0-9_-]/g, '_');
    return `adj-${periodPart}-${sessionPart}`;
}

function resolveSnapshotEntries(priorTimesheet) {
    const snapshot = priorTimesheet?.submissionSnapshot;
    if (snapshot && Array.isArray(snapshot.entries) && snapshot.entries.length > 0) {
        return snapshot.entries.filter((entry) => (
            entry && entry.isDeleted !== true && entry.isPriorPeriodAdjustment !== true
        ));
    }
    return (Array.isArray(priorTimesheet?.entries) ? priorTimesheet.entries : [])
        .filter((entry) => entry && entry.isDeleted !== true && entry.isPriorPeriodAdjustment !== true);
}

function dateInRange(dateStr, startDate, endDate) {
    const date = normalizeId(dateStr);
    return Boolean(date && date >= normalizeId(startDate) && date <= normalizeId(endDate));
}

function formatHours(value) {
    return roundHours(value).toFixed(2);
}

function isPriorTimesheetPayrollFinal(priorTimesheet = {}, priorPeriod = {}) {
    return String(priorTimesheet?.status || '').trim().toLowerCase() === 'processed'
        || String(priorPeriod?.status || '').trim().toLowerCase() === 'processed';
}

function buildChangeSummary({ snapshotEntry, snapshotHours, currentHours, currentStatus, sessionMissing }) {
    const classLabel = String(snapshotEntry?.className || 'Session').trim() || 'Session';
    const sessionDate = String(snapshotEntry?.date || '').trim();
    const snapshotStatus = String(snapshotEntry?.status || '').trim();

    if (sessionMissing) {
        return `${classLabel} removed or reassigned after payment (was ${formatHours(snapshotHours)} hrs on ${sessionDate})`;
    }
    if (normalizeId(currentStatus) !== normalizeId(snapshotStatus) && snapshotHours !== currentHours) {
        return `${classLabel} status changed ${snapshotStatus || 'unknown'} -> ${currentStatus || 'unknown'} after payment (${formatHours(snapshotHours)} -> ${formatHours(currentHours)} hrs, session ${sessionDate})`;
    }
    if (snapshotHours !== currentHours) {
        return `${classLabel} hours changed after payment (${formatHours(snapshotHours)} -> ${formatHours(currentHours)} hrs on ${sessionDate})`;
    }
    return `${classLabel} changed after payment (session ${sessionDate})`;
}

async function buildCurrentClassSessionIndex({ teacherId, activeOrgId, reqUser }) {
    const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
    const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
    const classes = await dataService.fetchAllData('classes', {}, reqUser);
    const index = new Map();

    for (const classRow of Array.isArray(classes) ? classes : []) {
        if (activeOrgId && !idsEqual(classRow?.orgId, activeOrgId)) continue;
        // eslint-disable-next-line no-await-in-loop
        const sessions = await dataService.getClassSessions(classRow.id, reqUser);
        (Array.isArray(sessions) ? sessions : []).forEach((sessionRow) => {
            const sessionId = normalizeId(sessionRow?.sessionId || sessionRow?.id);
            if (!sessionId) return;
            const assignedToTeacher = sessionDeliveryTeamService.isPersonOnSessionDelivery(sessionRow, teacherId);
            const isFinalStatus = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
                status: sessionRow?.status,
                notes: sessionRow?.notes
            });
            const rawDurationHours = Number.parseFloat(sessionRow?.durationHours) || 0;
            const hours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
                status: sessionRow?.status,
                notes: sessionRow?.notes,
                durationHours: rawDurationHours,
                session: sessionRow
            });
            const row = {
                sessionId,
                date: String(sessionRow?.date || ''),
                classId: String(classRow?.id || ''),
                className: String(classRow?.title || classRow?.name || ''),
                status: sessionStatusPolicyService.normalizeSessionStatus(sessionRow?.status, sessionRow?.notes),
                hours: roundHours(hours),
                isFinalStatus,
                assignedToTeacher,
                sourceType: 'class_session'
            };
            const existing = index.get(sessionId);
            if (!existing || (!existing.assignedToTeacher && assignedToTeacher)) index.set(sessionId, row);
        });
    }
    return index;
}

async function buildCurrentPayableIndex({ teacherId, periodStartDate, periodEndDate, activeOrgId, reqUser }) {
    const classIndex = await buildCurrentClassSessionIndex({ teacherId, activeOrgId, reqUser });
    const index = new Map();
    classIndex.forEach((row, sessionId) => {
        if (!row.assignedToTeacher || !row.isFinalStatus) return;
        index.set(sessionId, {
            ...row,
            inPriorPeriod: dateInRange(row.date, periodStartDate, periodEndDate),
            inCurrentPeriod: false
        });
    });

    const reportSessions = await buildReportReflectionLiveSessions({
        teacherPersonId: teacherId,
        periodStartDate,
        periodEndDate,
        activeOrgId,
        reqUser
    });
    (Array.isArray(reportSessions) ? reportSessions : []).forEach((row) => {
        const sessionId = normalizeId(row?.sessionId);
        if (!sessionId) return;
        index.set(sessionId, {
            sessionId,
            date: String(row?.date || ''),
            classId: String(row?.classId || ''),
            className: String(row?.className || ''),
            hours: roundHours(row.hours ?? row.timesheetHours ?? row.durationHours),
            status: String(row?.status || 'completed'),
            inPriorPeriod: dateInRange(row?.date, periodStartDate, periodEndDate),
            inCurrentPeriod: false
        });
    });

    const activityEntries = await activityService.getTimesheetEntriesForPerson({
        orgId: activeOrgId,
        personId: teacherId,
        periodStartDate,
        periodEndDate,
        reqUser
    });
    (Array.isArray(activityEntries) ? activityEntries : []).forEach((row) => {
        const sessionId = normalizeId(row?.sessionId);
        if (!sessionId) return;
        index.set(sessionId, {
            sessionId,
            date: String(row?.date || ''),
            classId: String(row?.classId || ''),
            className: String(row?.className || ''),
            hours: roundHours(row.hours ?? row.timesheetHours ?? row.durationHours),
            status: String(row?.status || 'activity'),
            inPriorPeriod: dateInRange(row?.date, periodStartDate, periodEndDate),
            inCurrentPeriod: false
        });
    });
    return index;
}

async function findPriorSubmittedTimesheet({ teacherId, currentPeriod, activeOrgId, reqUser }) {
    const currentStart = normalizeId(currentPeriod?.startDate);
    if (!currentStart) return null;

    const [allPeriods, allTimesheets] = await Promise.all([
        dataService.fetchData('timesheetPeriods', { orgId__eq: activeOrgId }, reqUser),
        dataService.fetchAllData('timesheets', {}, reqUser)
    ]);
    const teacherTimesheets = (Array.isArray(allTimesheets) ? allTimesheets : [])
        .filter((row) => idsEqual(row?.teacherId, teacherId));
    const eligiblePeriods = (Array.isArray(allPeriods) ? allPeriods : [])
        .filter((period) => idsEqual(period?.orgId, activeOrgId))
        .filter((period) => normalizeId(period?.endDate) < currentStart)
        .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));

    for (const priorPeriod of eligiblePeriods) {
        const priorTimesheet = teacherTimesheets.find((row) => idsEqual(row?.periodId, priorPeriod.id));
        if (!priorTimesheet) continue;
        const status = String(priorTimesheet?.status || '').trim().toLowerCase();
        const periodStatus = String(priorPeriod?.status || '').trim().toLowerCase();
        if (!['submitted', 'approved', 'processed'].includes(status) && periodStatus !== 'processed') continue;
        return {
            priorPeriod,
            priorTimesheet,
            isPayrollFinal: isPriorTimesheetPayrollFinal(priorTimesheet, priorPeriod)
        };
    }
    return null;
}

function buildReconciliationAdjustment({ snapshotEntry, live, priorPeriod, currentPeriod }) {
    const sourceSessionId = normalizeId(snapshotEntry?.sessionId);
    const baselineHours = roundHours(snapshotEntry?.hours);
    const baselineStatus = String(snapshotEntry?.provisionalMeta?.baselineStatus || snapshotEntry?.status || '').trim().toLowerCase();
    const base = {
        sourceSessionId,
        sourceType: String(snapshotEntry?.provisionalMeta?.sourceType || 'class_session'),
        sourcePeriodId: normalizeId(priorPeriod?.id),
        sourcePeriodName: String(priorPeriod?.name || ''),
        sourceSessionDate: String(snapshotEntry?.date || ''),
        currentSessionDate: String(live?.date || ''),
        classId: String(live?.classId || snapshotEntry?.classId || ''),
        className: String(live?.className || snapshotEntry?.className || ''),
        baselineStatus,
        currentStatus: String(live?.status || ''),
        finalStatus: live?.isFinalStatus === true ? String(live?.status || '') : '',
        baselineHours,
        currentHours: 0,
        deltaHours: 0,
        adjustmentHours: 0,
        state: 'resolved',
        resolutionReason: '',
        movedIntoCurrentPeriod: false
    };

    if (!live || live.assignedToTeacher !== true) {
        base.deltaHours = roundHours(-baselineHours);
        base.adjustmentHours = base.deltaHours;
        base.resolutionReason = 'removed_or_reassigned';
    } else if (live.isFinalStatus !== true) {
        base.currentStatus = String(live.status || 'scheduled');
        base.state = 'unresolved';
        base.resolutionReason = 'source_not_final';
        return base;
    } else if (dateInRange(live.date, currentPeriod?.startDate, currentPeriod?.endDate)) {
        base.currentHours = roundHours(live.hours);
        base.deltaHours = roundHours(base.currentHours - baselineHours);
        base.adjustmentHours = roundHours(-baselineHours);
        base.movedIntoCurrentPeriod = true;
        base.resolutionReason = 'moved_into_current_period';
    } else if (dateInRange(live.date, priorPeriod?.startDate, priorPeriod?.endDate)) {
        base.currentHours = roundHours(live.hours);
        base.deltaHours = roundHours(base.currentHours - baselineHours);
        base.adjustmentHours = base.deltaHours;
        base.resolutionReason = 'finalized_in_prior_period';
    } else {
        base.deltaHours = roundHours(-baselineHours);
        base.adjustmentHours = base.deltaHours;
        base.resolutionReason = 'moved_outside_review_periods';
    }
    return base;
}

function listMakeupChains(result = {}) {
    if (Array.isArray(result?.makeupChains)) return result.makeupChains;
    if (Array.isArray(result?.chains)) return result.chains;
    return [];
}

function countBlockingCrossPeriodNetting(result = {}) {
    return listMakeupChains(result)
        .filter((chain) => chain?.crossPeriodNetting?.requiresFinalization === true).length;
}

function listCrossPeriodNettingSummaries(result = {}) {
    return listMakeupChains(result)
        .map((chain) => chain?.crossPeriodNetting)
        .filter(Boolean);
}

function buildCrossPeriodNettingPreview(result = {}, currentPeriod = {}) {
    const applyDate = normalizeId(currentPeriod?.startDate);
    return listCrossPeriodNettingSummaries(result).flatMap((netting) => {
        const rows = [{
            sourceSessionDate: applyDate,
            className: netting.className,
            changeSummary: `Prior-period difference for session ${netting.rootSessionId}${netting.rootSessionDate ? ` (${netting.rootSessionDate})` : ''} posts on the first day of this timesheet.`,
            adjustmentHours: netting.priorDifferenceHours,
            deltaHours: netting.priorDifferenceHours,
            isCrossPeriodNetting: true,
            nettingKind: 'first_day_prior_difference',
            rootSessionId: netting.rootSessionId,
            rootClassId: netting.rootClassId
        }];
        (Array.isArray(netting.currentPeriodMakeupSessions) ? netting.currentPeriodMakeupSessions : []).forEach((makeup) => {
            rows.push({
                sourceSessionDate: makeup.date,
                className: netting.className,
                changeSummary: `Make-up for prior session ${netting.rootSessionId}${netting.rootSessionDate ? ` (${netting.rootSessionDate})` : ''}.`,
                adjustmentHours: makeup.isFinalStatus ? roundHours(makeup.finalHours) : 0,
                deltaHours: makeup.isFinalStatus ? roundHours(makeup.finalHours) : 0,
                currentHours: makeup.isFinalStatus ? roundHours(makeup.finalHours) : 0,
                isCrossPeriodNetting: true,
                nettingKind: 'current_period_makeup',
                makeupSessionId: makeup.sessionId,
                isFinalStatus: makeup.isFinalStatus === true,
                manageUrl: makeup.manageUrl || ''
            });
        });
        rows.push({
            changeSummary: netting.label,
            netHours: netting.netHours,
            uncoveredHours: netting.uncoveredHours,
            satisfied: netting.satisfied === true,
            requiresFinalization: netting.requiresFinalization === true,
            isCrossPeriodNetting: true,
            nettingKind: 'net_summary'
        });
        return rows;
    });
}

function buildReconciliationChangeSummary(item = {}) {
    const classLabel = String(item.className || 'Session').trim() || 'Session';
    if (item.resolutionReason === 'moved_into_current_period') {
        return `${classLabel} moved into the current period; reverse ${formatHours(item.baselineHours)} prior-period hrs to avoid duplicate payment`;
    }
    if (item.resolutionReason === 'moved_outside_review_periods') {
        return `${classLabel} moved outside the reviewed periods; reverse ${formatHours(item.baselineHours)} prior-period hrs`;
    }
    if (item.resolutionReason === 'removed_or_reassigned') {
        return `${classLabel} removed or reassigned after payment; reverse ${formatHours(item.baselineHours)} hrs`;
    }
    return buildChangeSummary({
        snapshotEntry: {
            className: item.className,
            date: item.sourceSessionDate,
            status: item.baselineStatus
        },
        snapshotHours: item.baselineHours,
        currentHours: item.currentHours,
        currentStatus: item.currentStatus,
        sessionMissing: false
    });
}

async function detectLegacyAdjustments({ snapshotEntries, priorPeriod, currentPeriod, teacherId, activeOrgId, reqUser }) {
    if (!snapshotEntries.length) return [];
    const priorIndex = await buildCurrentPayableIndex({
        teacherId,
        periodStartDate: priorPeriod?.startDate,
        periodEndDate: priorPeriod?.endDate,
        activeOrgId,
        reqUser
    });
    const currentIndex = await buildCurrentPayableIndex({
        teacherId,
        periodStartDate: currentPeriod?.startDate,
        periodEndDate: currentPeriod?.endDate,
        activeOrgId,
        reqUser
    });
    const allSessionIds = new Set([...priorIndex.keys(), ...currentIndex.keys()]);
    const fullIndex = new Map();
    allSessionIds.forEach((sessionId) => {
        const priorRow = priorIndex.get(sessionId);
        const currentRow = currentIndex.get(sessionId);
        fullIndex.set(sessionId, {
            date: String(currentRow?.date || priorRow?.date || ''),
            classId: String(currentRow?.classId || priorRow?.classId || ''),
            className: String(currentRow?.className || priorRow?.className || ''),
            priorHours: priorRow ? roundHours(priorRow.hours) : 0,
            currentHours: currentRow ? roundHours(currentRow.hours) : 0,
            status: String(currentRow?.status || priorRow?.status || ''),
            exists: Boolean(priorRow || currentRow)
        });
    });

    const adjustments = [];
    snapshotEntries.forEach((rawEntry) => {
        const snapshotEntry = sanitizeSnapshotEntry(rawEntry) || rawEntry;
        const sessionId = normalizeId(snapshotEntry?.sessionId);
        if (!sessionId) return;
        const snapshotHours = roundHours(snapshotEntry?.hours);
        const live = fullIndex.get(sessionId);
        let currentHours = 0;
        let sessionMissing = false;
        if (!live || !live.exists) {
            sessionMissing = true;
        } else if (dateInRange(live.date, currentPeriod?.startDate, currentPeriod?.endDate)) {
            currentHours = live.currentHours;
        } else if (dateInRange(live.date, priorPeriod?.startDate, priorPeriod?.endDate)) {
            currentHours = live.priorHours;
        } else {
            sessionMissing = true;
        }
        const deltaHours = roundHours(currentHours - snapshotHours);
        if (deltaHours === 0) return;
        const changeSummary = buildChangeSummary({
            snapshotEntry,
            snapshotHours,
            currentHours,
            currentStatus: live?.status || '',
            sessionMissing
        });
        adjustments.push({
            sourceSessionId: sessionId,
            sourceType: snapshotEntry?.isSchoolActivity ? 'school_activity' : 'legacy',
            sourcePeriodId: normalizeId(priorPeriod?.id),
            sourcePeriodName: String(priorPeriod?.name || ''),
            sourceSessionDate: String(snapshotEntry?.date || ''),
            classId: String(snapshotEntry?.classId || live?.classId || ''),
            className: String(snapshotEntry?.className || live?.className || ''),
            baselineStatus: String(snapshotEntry?.status || ''),
            currentStatus: String(live?.status || ''),
            finalStatus: String(live?.status || ''),
            snapshotHours,
            currentHours,
            deltaHours,
            adjustmentHours: deltaHours,
            reconciliationReason: sessionMissing ? 'removed_or_reassigned' : 'legacy_drift',
            changeSummary,
            comment: `Prior period adjustment (${priorPeriod?.name || priorPeriod?.id}): ${changeSummary}`,
            adjustmentSessionId: buildAdjustmentSessionId(priorPeriod?.id, sessionId)
        });
    });
    return adjustments;
}

async function detectReconciliation({ priorTimesheet, priorPeriod, currentPeriod, teacherId, activeOrgId, reqUser }) {
    const snapshotEntries = resolveSnapshotEntries(priorTimesheet);
    const carriedRootRefs = priorTimesheet?.priorPeriodReconciliation?.openMakeupRootRefs || [];
    const reconciliationEntries = deadlineReconciliationService.resolveReconciliationSnapshotEntries({
        submissionSnapshot: { entries: snapshotEntries }
    });
    const reconciliationEntryKeys = new Set(reconciliationEntries.map((entry) => (
        makeupReconciliationService.buildSessionKey(entry?.classId, entry?.sessionId)
        || normalizeId(entry?.sessionId)
    )));
    const legacyEntries = snapshotEntries.filter((entry) => {
        const key = makeupReconciliationService.buildSessionKey(entry?.classId, entry?.sessionId)
            || normalizeId(entry?.sessionId);
        return !reconciliationEntryKeys.has(key);
    });
    const [statusMeta, classes, allPeriods, allTimesheets] = await Promise.all([
        sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true }),
        dataService.fetchAllData('classes', {}, reqUser),
        dataService.fetchData('timesheetPeriods', { orgId__eq: activeOrgId }, reqUser),
        dataService.fetchAllData('timesheets', {}, reqUser)
    ]);
    const scopedClasses = (Array.isArray(classes) ? classes : [])
        .filter((row) => !activeOrgId || idsEqual(row?.orgId, activeOrgId));
    const sessionRows = await Promise.all(scopedClasses.map(async (classRow) => ([
        normalizeId(classRow?.id),
        await dataService.getClassSessions(classRow.id, reqUser)
    ])));
    const sessionsByClassId = new Map(sessionRows);
    const sessionGraph = makeupReconciliationService.buildSessionGraph({
        classes: scopedClasses,
        sessionsByClassId,
        statusMeta,
        teacherId
    });
    const baselineKeys = new Set();
    const baselineHoursByKey = new Map();
    const identityConflicts = [];
    const items = reconciliationEntries.map((rawEntry) => {
        const snapshotEntry = sanitizeSnapshotEntry(rawEntry) || rawEntry;
        const resolved = makeupReconciliationService.resolveGraphNode(sessionGraph, {
            classId: snapshotEntry?.classId,
            sessionId: snapshotEntry?.sessionId
        });
        if (resolved.conflict?.code === 'ambiguous_legacy_session_identity') {
            identityConflicts.push(resolved.conflict);
        }
        if (resolved.node) {
            baselineKeys.add(resolved.node.key);
            baselineHoursByKey.set(resolved.node.key, roundHours(snapshotEntry?.hours));
        }
        return buildReconciliationAdjustment({
            snapshotEntry,
            live: resolved.node,
            priorPeriod,
            currentPeriod
        });
    });
    const unresolved = items.filter((item) => item.state === 'unresolved').map((item) => ({
        ...item,
        changeSummary: `${item.className || 'Session'} is still in a non-final status (${item.currentStatus || 'scheduled'}).`,
        manageUrl: item.classId && item.sourceSessionId
            ? `/school/classes/${encodeURIComponent(item.classId)}/sessions/${encodeURIComponent(item.sourceSessionId)}`
            : ''
    }));
    const reconciliationAdjustments = items
        .filter((item) => item.state === 'resolved' && item.adjustmentHours !== 0)
        .map((item) => {
            const changeSummary = buildReconciliationChangeSummary(item);
            return {
                ...item,
                snapshotHours: item.baselineHours,
                deltaHours: item.adjustmentHours,
                reconciliationReason: item.resolutionReason,
                changeSummary,
                comment: `Prior period reconciliation (${priorPeriod?.name || priorPeriod?.id}): ${changeSummary}`,
                adjustmentSessionId: buildAdjustmentSessionId(priorPeriod?.id, item.sourceSessionId)
            };
        });
    const rootRefs = reconciliationEntries.map((rawEntry) => {
        const snapshotEntry = sanitizeSnapshotEntry(rawEntry) || rawEntry;
        const resolved = makeupReconciliationService.resolveGraphNode(sessionGraph, {
            classId: snapshotEntry?.classId,
            sessionId: snapshotEntry?.sessionId
        });
        if (!resolved.node?.isFinalStatus || !resolved.node?.makeUpRequired) return null;
        return {
            classId: resolved.node.classId,
            sessionId: resolved.node.sessionId,
            sourcePeriodId: normalizeId(priorPeriod?.id)
        };
    }).filter(Boolean);
    const scopedPeriodIds = new Set((Array.isArray(allPeriods) ? allPeriods : [])
        .map((period) => normalizeId(period?.id))
        .filter(Boolean));
    const scopedTimesheets = (Array.isArray(allTimesheets) ? allTimesheets : []).filter((row) => (
        (!activeOrgId || idsEqual(row?.orgId, activeOrgId))
        || (!normalizeId(row?.orgId) && scopedPeriodIds.has(normalizeId(row?.periodId)))
    ));
    const paymentCoverage = makeupReconciliationService.buildPaymentCoverage({
        timesheets: scopedTimesheets
            .filter((row) => !idsEqual(row?.periodId, currentPeriod?.id)),
        periods: allPeriods,
        teacherId
    });
    const prunedCarriedRootRefs = (Array.isArray(carriedRootRefs) ? carriedRootRefs : [])
        .filter((ref) => {
            const resolved = makeupReconciliationService.resolveGraphNode(sessionGraph, ref);
            return Boolean(resolved?.node) && !resolved?.conflict;
        });
    const makeupResult = makeupReconciliationService.analyzeMakeupChains({
        graph: sessionGraph,
        rootRefs,
        carriedRootRefs: prunedCarriedRootRefs,
        currentPeriod,
        coverage: paymentCoverage,
        baselineKeys,
        baselineHoursByKey,
        teacherId,
        sourcePeriodId: normalizeId(priorPeriod?.id)
    });
    if (identityConflicts.length) {
        makeupResult.makeupState = 'conflict';
        makeupResult.conflicts.push(...identityConflicts);
        makeupResult.summary.conflictCount = makeupResult.conflicts.length;
    }
    const periodNameById = new Map((Array.isArray(allPeriods) ? allPeriods : [])
        .map((period) => [normalizeId(period?.id), String(period?.name || '')]));
    const makeupAdjustments = (Array.isArray(makeupResult.adjustments) ? makeupResult.adjustments : [])
        .map((row) => ({
            ...row,
            sourcePeriodName: periodNameById.get(normalizeId(row?.sourcePeriodId)) || String(priorPeriod?.name || '')
        }));
    const legacyAdjustments = await detectLegacyAdjustments({
        snapshotEntries: legacyEntries,
        priorPeriod,
        currentPeriod,
        teacherId,
        activeOrgId,
        reqUser
    });
    return {
        adjustments: [...reconciliationAdjustments, ...makeupAdjustments, ...legacyAdjustments],
        unresolved,
        items,
        reconciliationEntries,
        legacyEntryCount: legacyEntries.length,
        makeupState: makeupResult.makeupState,
        makeupChains: makeupResult.chains,
        makeupConflicts: makeupResult.conflicts,
        openMakeupRootRefs: makeupResult.openMakeupRootRefs,
        makeupSummary: makeupResult.summary
    };
}

async function detectAdjustments(options) {
    const result = await detectReconciliation(options);
    return result.adjustments;
}

function buildReconciliationReceipt({
    priorPeriod,
    result,
    state = '',
    confirmOpenMakeupChains = false,
    makeupConfirmedAt = ''
}) {
    const unresolved = Array.isArray(result?.unresolved) ? result.unresolved : [];
    const now = new Date().toISOString();
    const receipt = {
        sourcePeriodId: normalizeId(priorPeriod?.id),
        state: state || (unresolved.length ? 'unresolved' : 'resolved'),
        reviewedAt: now,
        lastCheckedAt: now,
        fingerprint: buildReconciliationFingerprint(result),
        items: (Array.isArray(result?.items) ? result.items : []).map((item) => ({ ...item })),
        makeupState: String(result?.makeupState || 'none'),
        makeupChains: (Array.isArray(result?.makeupChains) ? result.makeupChains : []).map((chain) => ({ ...chain })),
        openMakeupRootRefs: (Array.isArray(result?.openMakeupRootRefs) ? result.openMakeupRootRefs : []).map((ref) => ({ ...ref }))
    };
    if (receipt.makeupState === 'open' && (confirmOpenMakeupChains || makeupConfirmedAt)) {
        receipt.makeupConfirmedAt = normalizeId(makeupConfirmedAt) || now;
    }
    return receipt;
}

function buildReconciliationFingerprint(result = {}) {
    const rows = [
        ...(Array.isArray(result?.items) ? result.items : []).map((item) => ({
            kind: 'reconciliation',
            sourceSessionId: normalizeId(item?.sourceSessionId),
            sourceSessionDate: normalizeId(item?.sourceSessionDate),
            currentSessionDate: normalizeId(item?.currentSessionDate),
            baselineStatus: normalizeId(item?.baselineStatus),
            currentStatus: normalizeId(item?.currentStatus),
            finalStatus: normalizeId(item?.finalStatus),
            baselineHours: roundHours(item?.baselineHours),
            currentHours: roundHours(item?.currentHours),
            deltaHours: roundHours(item?.deltaHours),
            adjustmentHours: roundHours(item?.adjustmentHours),
            state: normalizeId(item?.state),
            reason: normalizeId(item?.resolutionReason)
        })),
        ...(Array.isArray(result?.adjustments) ? result.adjustments : [])
            .filter((item) => normalizeId(item?.sourceType) !== 'class_session')
            .map((item) => ({
                kind: 'legacy',
                sourceSessionId: normalizeId(item?.sourceSessionId),
                sourceSessionDate: normalizeId(item?.sourceSessionDate),
                baselineStatus: normalizeId(item?.baselineStatus),
                currentStatus: normalizeId(item?.currentStatus),
                finalStatus: normalizeId(item?.finalStatus),
                baselineHours: roundHours(item?.snapshotHours ?? item?.baselineHours),
                currentHours: roundHours(item?.currentHours),
                adjustmentHours: roundHours(item?.adjustmentHours ?? item?.deltaHours),
                reason: normalizeId(item?.reconciliationReason)
            })),
        ...(Array.isArray(result?.makeupChains) ? result.makeupChains : []).flatMap((chain) => {
            const netting = chain?.crossPeriodNetting;
            const nettingRows = netting ? [{
                kind: 'cross_period_netting',
                rootClassId: normalizeId(netting.rootClassId),
                rootSessionId: normalizeId(netting.rootSessionId),
                priorDifferenceHours: roundHours(netting.priorDifferenceHours),
                finalizedMakeupHours: roundHours(netting.finalizedMakeupHours),
                uncoveredHours: roundHours(netting.uncoveredHours),
                netHours: roundHours(netting.netHours),
                satisfied: netting.satisfied === true,
                requiresFinalization: netting.requiresFinalization === true
            }] : [];
            return [
                ...nettingRows,
                ...(Array.isArray(chain?.nodes) ? chain.nodes : []).map((node) => ({
                kind: 'makeup_chain',
                rootClassId: normalizeId(chain?.rootClassId),
                rootSessionId: normalizeId(chain?.rootSessionId),
                rootSourcePeriodId: normalizeId(chain?.rootSourcePeriodId),
                chainState: normalizeId(chain?.state),
                key: normalizeId(node?.key),
                parentKey: normalizeId(node?.parentKey),
                date: normalizeId(node?.date),
                status: normalizeId(node?.status),
                hours: roundHours(node?.hours),
                isFinalStatus: node?.isFinalStatus === true,
                makeUpRequired: node?.makeUpRequired === true,
                deliveryPersonIds: (Array.isArray(node?.deliveryPersonIds) ? node.deliveryPersonIds : []).map(normalizeId).sort(),
                periodDisposition: normalizeId(node?.periodDisposition),
                paymentDisposition: normalizeId(node?.paymentDisposition),
                baselineHours: roundHours(node?.baselineHours),
                finalHours: roundHours(node?.finalHours),
                hasFinalHours: node?.hasFinalHours === true,
                adjustmentHours: roundHours(node?.adjustmentHours),
                isProvisional: node?.isProvisional === true,
                allowedDurationHours: roundHours(node?.allowedDurationHours),
                allocatedDurationHours: roundHours(node?.allocatedDurationHours),
                remainingDurationHours: roundHours(node?.remainingDurationHours),
                openReasons: (Array.isArray(node?.openReasons) ? node.openReasons : []).map(normalizeId).sort()
            }))
            ];
        }),
        ...(Array.isArray(result?.makeupConflicts) ? result.makeupConflicts : []).map((conflict) => ({
            kind: 'makeup_conflict',
            code: normalizeId(conflict?.code),
            classId: normalizeId(conflict?.classId),
            sessionId: normalizeId(conflict?.sessionId),
            message: normalizeId(conflict?.message)
        }))
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function isReconciliationReceiptCurrent(receipt = {}, result = {}) {
    const fingerprint = normalizeId(receipt?.fingerprint);
    if (!fingerprint) return false;
    return fingerprint === buildReconciliationFingerprint(result);
}

function isMakeupConfirmationCurrent(receipt = {}, result = {}) {
    if (String(result?.makeupState || 'none') !== 'open') return true;
    return Boolean(normalizeId(receipt?.makeupConfirmedAt))
        && isReconciliationReceiptCurrent(receipt, result);
}

function buildAdjustmentEntries({ adjustments, applyDate }) {
    const date = normalizeId(applyDate);
    if (!date) throw new Error('Adjustment apply date is required.');
    return (Array.isArray(adjustments) ? adjustments : []).map((adj) => {
        const adjustmentHours = roundHours(adj.adjustmentHours ?? adj.deltaHours);
        return {
            sessionId: adj.adjustmentSessionId || buildAdjustmentSessionId(adj.sourcePeriodId, adj.sourceSessionId),
            date,
            className: adj.className || 'Prior period adjustment',
            classId: adj.classId || null,
            hours: adjustmentHours,
            durationHours: adjustmentHours,
            status: 'adjustment',
            comment: adj.comment || adj.changeSummary || '',
            isManual: true,
            isPriorPeriodAdjustment: true,
            adjustmentMeta: {
                sourcePeriodId: adj.sourcePeriodId,
                sourceSessionId: adj.sourceSessionId,
                sourceClassId: adj.sourceClassId || adj.classId || '',
                sourceSessionDate: adj.sourceSessionDate,
                sourceType: adj.sourceType || 'class_session',
                baselineStatus: adj.baselineStatus || '',
                currentStatus: adj.currentStatus || '',
                finalStatus: adj.finalStatus || adj.currentStatus || '',
                reconciliationReason: adj.reconciliationReason || adj.resolutionReason || '',
                snapshotHours: adj.snapshotHours ?? adj.baselineHours,
                currentHours: adj.currentHours,
                deltaHours: adjustmentHours,
                paymentDisposition: adj.paymentDisposition || '',
                makeupRootClassId: adj.makeupRootClassId || '',
                makeupRootSessionId: adj.makeupRootSessionId || '',
                makeupRootSourcePeriodId: adj.makeupRootSourcePeriodId || '',
                makeupDepth: Number(adj.makeupDepth || 0),
                assignedPersonId: adj.assignedPersonId || '',
                claimKey: adj.claimKey || ''
            }
        };
    });
}

function mergeAdjustmentEntries(existingEntries, adjustmentEntries) {
    const existing = Array.isArray(existingEntries) ? [...existingEntries] : [];
    const adjustmentIds = new Set((Array.isArray(adjustmentEntries) ? adjustmentEntries : [])
        .map((row) => normalizeId(row?.sessionId)).filter(Boolean));
    const kept = existing.filter((row) => !adjustmentIds.has(normalizeId(row?.sessionId)));
    return [...kept, ...(Array.isArray(adjustmentEntries) ? adjustmentEntries : [])];
}

function mergeAdjustmentEntriesForSource(existingEntries, adjustmentEntries, sourcePeriodId, makeupSourcePeriodIds = []) {
    const sourceId = normalizeId(sourcePeriodId);
    const prefix = `adj-${sourceId.replace(/[^A-Za-z0-9_-]/g, '_')}-`;
    const adjustmentIds = new Set((Array.isArray(adjustmentEntries) ? adjustmentEntries : [])
        .map((row) => normalizeId(row?.sessionId))
        .filter(Boolean));
    const makeupSourceIds = new Set((Array.isArray(makeupSourcePeriodIds) ? makeupSourcePeriodIds : [])
        .map(normalizeId)
        .filter(Boolean));
    const kept = (Array.isArray(existingEntries) ? existingEntries : []).filter((row) => {
        if (row?.isPriorPeriodAdjustment !== true) return true;
        if (adjustmentIds.has(normalizeId(row?.sessionId))) return false;
        const rowSource = normalizeId(row?.adjustmentMeta?.sourcePeriodId);
        if (rowSource && idsEqual(rowSource, sourceId)) return false;
        const reconciliationReason = normalizeId(row?.adjustmentMeta?.reconciliationReason);
        if (
            rowSource
            && makeupSourceIds.has(rowSource)
            && ['makeup_closed_period_catchup', 'reassigned_closed_period_catchup'].includes(reconciliationReason)
        ) {
            return false;
        }
        return !normalizeId(row?.sessionId).startsWith(prefix);
    });
    return [...kept, ...(Array.isArray(adjustmentEntries) ? adjustmentEntries : [])];
}

function buildResolvedSourceRefs(result = {}) {
    const reconciliationRefs = (Array.isArray(result?.items) ? result.items : [])
        .filter((item) => item?.state === 'resolved' && item?.classId && item?.sourceSessionId)
        .filter((item) => !['removed_or_reassigned', 'moved_outside_review_periods'].includes(String(item?.resolutionReason || '')))
        .map((item) => ({
            type: 'classSession',
            classId: String(item.classId),
            sessionId: String(item.sourceSessionId)
        }));
    const catchupRefs = (Array.isArray(result?.makeupChains) ? result.makeupChains : [])
        .flatMap((chain) => Array.isArray(chain?.nodes) ? chain.nodes : [])
        .filter((node) => node?.paymentDisposition === 'catch_up' && node?.classId && node?.sessionId)
        .map((node) => ({
            type: 'classSession',
            classId: String(node.classId),
            sessionId: String(node.sessionId)
        }));
    const unique = new Map();
    [...reconciliationRefs, ...catchupRefs].forEach((ref) => unique.set(`${ref.classId}::${ref.sessionId}`, ref));
    return [...unique.values()];
}

module.exports = {
    buildAdjustmentSessionId,
    buildAdjustmentEntries,
    buildCrossPeriodNettingPreview,
    buildCurrentClassSessionIndex,
    buildReconciliationAdjustment,
    buildReconciliationFingerprint,
    buildReconciliationReceipt,
    buildResolvedSourceRefs,
    countBlockingCrossPeriodNetting,
    detectAdjustments,
    detectReconciliation,
    findPriorSubmittedTimesheet,
    isPriorTimesheetPayrollFinal,
    isMakeupConfirmationCurrent,
    isReconciliationReceiptCurrent,
    listCrossPeriodNettingSummaries,
    mergeAdjustmentEntries,
    mergeAdjustmentEntriesForSource,
    resolveSnapshotEntries
};
