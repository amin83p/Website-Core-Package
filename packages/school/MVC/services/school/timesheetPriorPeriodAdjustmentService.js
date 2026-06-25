/**
 * Detects schedule drift between a prior submitted timesheet snapshot and current live data,
 * and builds prior-period adjustment entries for the next timesheet period.
 */
const dataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const { buildReportReflectionLiveSessions } = require('./reportTimesheetReflectionService');
const activityService = require('./activityService');
const { sanitizeSnapshotEntry } = require('../../models/school/timesheetModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
    return String(value || '').trim();
}

function buildAdjustmentSessionId(priorPeriodId, sourceSessionId) {
    const periodPart = normalizeId(priorPeriodId).replace(/[^A-Za-z0-9_-]/g, '_');
    const sessionPart = normalizeId(sourceSessionId).replace(/[^A-Za-z0-9_-]/g, '_');
    return `adj-${periodPart}-${sessionPart}`;
}

function resolveSnapshotEntries(priorTimesheet) {
    const snapshot = priorTimesheet?.submissionSnapshot;
    if (snapshot && Array.isArray(snapshot.entries) && snapshot.entries.length > 0) {
        return snapshot.entries.filter((entry) => entry && entry.isDeleted !== true);
    }
    return (Array.isArray(priorTimesheet?.entries) ? priorTimesheet.entries : [])
        .filter((entry) => entry && entry.isDeleted !== true && entry.isPriorPeriodAdjustment !== true);
}

function dateInRange(dateStr, startDate, endDate) {
    const d = normalizeId(dateStr);
    if (!d) return false;
    return d >= normalizeId(startDate) && d <= normalizeId(endDate);
}

function formatHours(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.00';
    return n.toFixed(2);
}

function buildChangeSummary({ snapshotEntry, snapshotHours, currentHours, currentStatus, sessionMissing }) {
    const classLabel = String(snapshotEntry?.className || 'Session').trim() || 'Session';
    const sessionDate = String(snapshotEntry?.date || '').trim();
    const snapshotStatus = String(snapshotEntry?.status || '').trim();

    if (sessionMissing) {
        return `${classLabel} removed or reassigned after payment (was ${formatHours(snapshotHours)} hrs on ${sessionDate})`;
    }

    if (normalizeId(currentStatus) !== normalizeId(snapshotStatus) && snapshotHours !== currentHours) {
        return `${classLabel} status changed ${snapshotStatus || 'unknown'} → ${currentStatus || 'unknown'} after payment (${formatHours(snapshotHours)} → ${formatHours(currentHours)} hrs, session ${sessionDate})`;
    }

    if (snapshotHours !== currentHours) {
        return `${classLabel} hours changed after payment (${formatHours(snapshotHours)} → ${formatHours(currentHours)} hrs on ${sessionDate})`;
    }

    return `${classLabel} changed after payment (session ${sessionDate})`;
}

async function buildCurrentPayableIndex({ teacherId, periodStartDate, periodEndDate, activeOrgId, reqUser }) {
    const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(activeOrgId || '', { includeInactive: true });
    const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
    const index = new Map();

    const classes = await dataService.fetchData('classes', {}, reqUser);
    for (const classRow of Array.isArray(classes) ? classes : []) {
        if (activeOrgId && !idsEqual(classRow?.orgId, activeOrgId)) continue;
        // eslint-disable-next-line no-await-in-loop
        const sessions = await dataService.getClassSessions(classRow.id, reqUser);
        (Array.isArray(sessions) ? sessions : []).forEach((sessionRow) => {
            if (!idsEqual(sessionRow?.delivery?.deliveredBy, teacherId)) return;
            const sessionId = normalizeId(sessionRow?.sessionId);
            if (!sessionId) return;
            const rawDurationHours = parseFloat(sessionRow?.durationHours) || 0;
            const timesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
                status: sessionRow?.status,
                notes: sessionRow?.notes,
                durationHours: rawDurationHours
            });
            index.set(sessionId, {
                sessionId,
                date: String(sessionRow?.date || ''),
                classId: String(classRow?.id || ''),
                className: String(classRow?.title || classRow?.name || ''),
                hours: timesheetHours,
                status: sessionStatusPolicyService.normalizeSessionStatus(sessionRow?.status, sessionRow?.notes),
                inPriorPeriod: dateInRange(sessionRow?.date, periodStartDate, periodEndDate),
                inCurrentPeriod: false
            });
        });
    }

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
        const hours = Number(parseFloat(row.hours ?? row.timesheetHours ?? row.durationHours) || 0);
        index.set(sessionId, {
            sessionId,
            date: String(row?.date || ''),
            classId: String(row?.classId || ''),
            className: String(row?.className || ''),
            hours,
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
        const hours = Number(parseFloat(row.hours ?? row.timesheetHours ?? row.durationHours) || 0);
        index.set(sessionId, {
            sessionId,
            date: String(row?.date || ''),
            classId: String(row?.classId || ''),
            className: String(row?.className || ''),
            hours,
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
        const tsStatus = String(priorTimesheet?.status || '').trim().toLowerCase();
        const periodStatus = String(priorPeriod?.status || '').trim().toLowerCase();
        if (tsStatus === 'submitted' || tsStatus === 'processed' || periodStatus === 'processed') {
            return { priorPeriod, priorTimesheet };
        }
    }

    return null;
}

async function detectAdjustments({
    priorTimesheet,
    priorPeriod,
    currentPeriod,
    teacherId,
    activeOrgId,
    reqUser
}) {
    const snapshotEntries = resolveSnapshotEntries(priorTimesheet);
    if (!snapshotEntries.length) return [];

    const priorStart = normalizeId(priorPeriod?.startDate);
    const priorEnd = normalizeId(priorPeriod?.endDate);
    const currentStart = normalizeId(currentPeriod?.startDate);
    const currentEnd = normalizeId(currentPeriod?.endDate);

    const priorIndex = await buildCurrentPayableIndex({
        teacherId,
        periodStartDate: priorStart,
        periodEndDate: priorEnd,
        activeOrgId,
        reqUser
    });

    const currentIndex = await buildCurrentPayableIndex({
        teacherId,
        periodStartDate: currentStart,
        periodEndDate: currentEnd,
        activeOrgId,
        reqUser
    });

    const allSessionIds = new Set([...priorIndex.keys(), ...currentIndex.keys()]);
    const fullIndex = new Map();
    allSessionIds.forEach((sessionId) => {
        const priorRow = priorIndex.get(sessionId);
        const currentRow = currentIndex.get(sessionId);
        fullIndex.set(sessionId, {
            sessionId,
            date: String(currentRow?.date || priorRow?.date || ''),
            classId: String(currentRow?.classId || priorRow?.classId || ''),
            className: String(currentRow?.className || priorRow?.className || ''),
            priorHours: priorRow ? Number(priorRow.hours) : 0,
            currentHoursInPriorPeriod: priorRow ? Number(priorRow.hours) : 0,
            currentHoursInCurrentPeriod: currentRow ? Number(currentRow.hours) : 0,
            status: String(currentRow?.status || priorRow?.status || ''),
            exists: Boolean(priorRow || currentRow)
        });
    });

    const adjustments = [];

    snapshotEntries.forEach((rawEntry) => {
        const snapshotEntry = sanitizeSnapshotEntry(rawEntry) || rawEntry;
        const sessionId = normalizeId(snapshotEntry?.sessionId);
        if (!sessionId) return;

        const snapshotHours = Number(parseFloat(snapshotEntry?.hours) || 0);
        const live = fullIndex.get(sessionId);
        let currentHours = 0;
        let sessionMissing = false;

        if (!live || !live.exists) {
            sessionMissing = true;
            currentHours = 0;
        } else if (dateInRange(live.date, currentStart, currentEnd)) {
            currentHours = live.currentHoursInCurrentPeriod;
        } else if (dateInRange(live.date, priorStart, priorEnd)) {
            currentHours = live.currentHoursInPriorPeriod;
        } else {
            sessionMissing = true;
            currentHours = 0;
        }

        const deltaHours = Number((currentHours - snapshotHours).toFixed(2));
        if (!Number.isFinite(deltaHours) || deltaHours === 0) return;

        const changeSummary = buildChangeSummary({
            snapshotEntry,
            snapshotHours,
            currentHours,
            currentStatus: live?.status || '',
            sessionMissing
        });

        adjustments.push({
            sourceSessionId: sessionId,
            sourcePeriodId: normalizeId(priorPeriod?.id),
            sourcePeriodName: String(priorPeriod?.name || ''),
            sourceSessionDate: String(snapshotEntry?.date || ''),
            classId: String(snapshotEntry?.classId || live?.classId || ''),
            className: String(snapshotEntry?.className || live?.className || ''),
            snapshotHours,
            currentHours,
            deltaHours,
            changeSummary,
            comment: `Prior period adjustment (${priorPeriod?.name || priorPeriod?.id}): ${changeSummary}`,
            adjustmentSessionId: buildAdjustmentSessionId(priorPeriod?.id, sessionId)
        });
    });

    return adjustments;
}

function buildAdjustmentEntries({ adjustments, applyDate }) {
    const date = normalizeId(applyDate);
    if (!date) throw new Error('Adjustment apply date is required.');

    return (Array.isArray(adjustments) ? adjustments : []).map((adj) => ({
        sessionId: adj.adjustmentSessionId || buildAdjustmentSessionId(adj.sourcePeriodId, adj.sourceSessionId),
        date,
        className: adj.className || 'Prior period adjustment',
        classId: adj.classId || null,
        hours: adj.deltaHours,
        durationHours: adj.deltaHours,
        status: 'adjustment',
        comment: adj.comment || adj.changeSummary || '',
        isManual: true,
        isPriorPeriodAdjustment: true,
        adjustmentMeta: {
            sourcePeriodId: adj.sourcePeriodId,
            sourceSessionId: adj.sourceSessionId,
            sourceSessionDate: adj.sourceSessionDate,
            snapshotHours: adj.snapshotHours,
            currentHours: adj.currentHours,
            deltaHours: adj.deltaHours
        }
    }));
}

function mergeAdjustmentEntries(existingEntries, adjustmentEntries) {
    const existing = Array.isArray(existingEntries) ? [...existingEntries] : [];
    const adjustmentIds = new Set(
        adjustmentEntries.map((row) => normalizeId(row?.sessionId)).filter(Boolean)
    );
    const kept = existing.filter((row) => !adjustmentIds.has(normalizeId(row?.sessionId)));
    return [...kept, ...adjustmentEntries];
}

module.exports = {
    buildAdjustmentSessionId,
    resolveSnapshotEntries,
    findPriorSubmittedTimesheet,
    detectAdjustments,
    buildAdjustmentEntries,
    mergeAdjustmentEntries
};
