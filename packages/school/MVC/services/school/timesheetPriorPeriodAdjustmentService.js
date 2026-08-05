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
    const classes = await dataService.fetchData('classes', {}, reqUser);
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
        dataService.fetchData('timesheets', {}, reqUser)
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
    if (!snapshotEntries.length) {
        return { adjustments: [], unresolved: [], items: [], reconciliationEntries: [], legacyEntryCount: 0 };
    }
    const reconciliationEntries = deadlineReconciliationService.resolveReconciliationSnapshotEntries({
        submissionSnapshot: { entries: snapshotEntries }
    });
    const reconciliationSessionIds = new Set(reconciliationEntries.map((entry) => normalizeId(entry?.sessionId)));
    const legacyEntries = snapshotEntries.filter((entry) => !reconciliationSessionIds.has(normalizeId(entry?.sessionId)));
    const classIndex = reconciliationEntries.length
        ? await buildCurrentClassSessionIndex({ teacherId, activeOrgId, reqUser })
        : new Map();
    const items = reconciliationEntries.map((rawEntry) => {
        const snapshotEntry = sanitizeSnapshotEntry(rawEntry) || rawEntry;
        return buildReconciliationAdjustment({
            snapshotEntry,
            live: classIndex.get(normalizeId(snapshotEntry?.sessionId)),
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
    const legacyAdjustments = await detectLegacyAdjustments({
        snapshotEntries: legacyEntries,
        priorPeriod,
        currentPeriod,
        teacherId,
        activeOrgId,
        reqUser
    });
    return {
        adjustments: [...reconciliationAdjustments, ...legacyAdjustments],
        unresolved,
        items,
        reconciliationEntries,
        legacyEntryCount: legacyEntries.length
    };
}

async function detectAdjustments(options) {
    const result = await detectReconciliation(options);
    return result.adjustments;
}

function buildReconciliationReceipt({ priorPeriod, result, state = '' }) {
    const unresolved = Array.isArray(result?.unresolved) ? result.unresolved : [];
    const now = new Date().toISOString();
    return {
        sourcePeriodId: normalizeId(priorPeriod?.id),
        state: state || (unresolved.length ? 'unresolved' : 'resolved'),
        reviewedAt: now,
        lastCheckedAt: now,
        fingerprint: buildReconciliationFingerprint(result),
        items: (Array.isArray(result?.items) ? result.items : []).map((item) => ({ ...item }))
    };
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
            }))
    ].sort((left, right) => `${left.kind}:${left.sourceSessionId}`.localeCompare(`${right.kind}:${right.sourceSessionId}`));
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function isReconciliationReceiptCurrent(receipt = {}, result = {}) {
    const fingerprint = normalizeId(receipt?.fingerprint);
    if (!fingerprint) return false;
    return fingerprint === buildReconciliationFingerprint(result);
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
                sourceSessionDate: adj.sourceSessionDate,
                sourceType: adj.sourceType || 'class_session',
                baselineStatus: adj.baselineStatus || '',
                currentStatus: adj.currentStatus || '',
                finalStatus: adj.finalStatus || adj.currentStatus || '',
                reconciliationReason: adj.reconciliationReason || adj.resolutionReason || '',
                snapshotHours: adj.snapshotHours ?? adj.baselineHours,
                currentHours: adj.currentHours,
                deltaHours: adjustmentHours
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

function mergeAdjustmentEntriesForSource(existingEntries, adjustmentEntries, sourcePeriodId) {
    const sourceId = normalizeId(sourcePeriodId);
    const prefix = `adj-${sourceId.replace(/[^A-Za-z0-9_-]/g, '_')}-`;
    const kept = (Array.isArray(existingEntries) ? existingEntries : []).filter((row) => {
        if (row?.isPriorPeriodAdjustment !== true) return true;
        const rowSource = normalizeId(row?.adjustmentMeta?.sourcePeriodId);
        if (rowSource && idsEqual(rowSource, sourceId)) return false;
        return !normalizeId(row?.sessionId).startsWith(prefix);
    });
    return [...kept, ...(Array.isArray(adjustmentEntries) ? adjustmentEntries : [])];
}

function buildResolvedSourceRefs(result = {}) {
    return (Array.isArray(result?.items) ? result.items : [])
        .filter((item) => item?.state === 'resolved' && item?.classId && item?.sourceSessionId)
        .filter((item) => !['removed_or_reassigned', 'moved_outside_review_periods'].includes(String(item?.resolutionReason || '')))
        .map((item) => ({
            type: 'classSession',
            classId: String(item.classId),
            sessionId: String(item.sourceSessionId)
        }));
}

module.exports = {
    buildAdjustmentSessionId,
    buildAdjustmentEntries,
    buildCurrentClassSessionIndex,
    buildReconciliationAdjustment,
    buildReconciliationFingerprint,
    buildReconciliationReceipt,
    buildResolvedSourceRefs,
    detectAdjustments,
    detectReconciliation,
    findPriorSubmittedTimesheet,
    isPriorTimesheetPayrollFinal,
    isReconciliationReceiptCurrent,
    mergeAdjustmentEntries,
    mergeAdjustmentEntriesForSource,
    resolveSnapshotEntries
};
