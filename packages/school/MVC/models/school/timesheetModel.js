const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
// MVC/models/school/timesheetModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/timesheets.json');

if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
}

const TIMESHEET_STATUSES = new Set(['draft', 'submitted', 'processed']);

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
    if (v === undefined || v === null) return allowEmpty ? '' : null;
    const s = String(v).replace(/\0/g, '').trim();
    if (!allowEmpty && !s) return null;
    return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
    const s = cleanString(v, { max, allowEmpty });
    if (s === null) return null;
    if (!s) return allowEmpty ? '' : null;
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format. Use only letters, numbers, underscore, dash.');
    return s;
}

function cleanDate(v, { allowEmpty = true } = {}) {
    if (v === undefined || v === null || String(v).trim() === '') {
        return allowEmpty ? '' : null;
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date value. Use YYYY-MM-DD.');
    return d.toISOString().slice(0, 10);
}

function cleanHours(v, { min = 0, max = 24 } = {}) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    if (n < min || n > max) throw new Error('Hours value is out of allowed range.');
    return Number(n.toFixed(2));
}

function sanitizeSnapshotEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.isDeleted === true) return null;
    const sessionId = cleanString(entry.sessionId, { max: 80, allowEmpty: false });
    if (!sessionId) return null;
    const row = {
        sessionId,
        date: cleanDate(entry.date, { allowEmpty: true }),
        className: cleanString(entry.className, { max: 200, allowEmpty: true }),
        classId: cleanString(entry.classId, { max: 64, allowEmpty: true }) || null,
        hours: cleanHours(entry.hours ?? entry.durationHours ?? 0, { min: 0, max: 24 }),
        status: cleanString(entry.status, { max: 40, allowEmpty: true }).toLowerCase() || 'manual',
        isManual: Boolean(entry.isManual)
    };
    if (entry.isReportReflection === true || sessionId.startsWith('rptref-')) row.isReportReflection = true;
    if (entry.isSchoolActivity === true || sessionId.startsWith('act-')) row.isSchoolActivity = true;
    return row;
}

function sanitizeSubmissionSnapshot(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const submittedAt = cleanString(input.submittedAt, { max: 40, allowEmpty: false });
    if (!submittedAt) return null;
    const sourcePeriodId = cleanId(input.sourcePeriodId, { max: 64, allowEmpty: false });
    const sourcePeriodName = cleanString(input.sourcePeriodName, { max: 120, allowEmpty: true });
    if (!sourcePeriodId) return null;
    const entries = (Array.isArray(input.entries) ? input.entries : [])
        .map(sanitizeSnapshotEntry)
        .filter(Boolean);
    return {
        submittedAt,
        sourcePeriodId: String(sourcePeriodId),
        sourcePeriodName: String(sourcePeriodName || ''),
        entries
    };
}

function sanitizeAdjustmentMeta(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return {
        sourcePeriodId: cleanString(input.sourcePeriodId, { max: 64, allowEmpty: true }),
        sourceSessionId: cleanString(input.sourceSessionId, { max: 80, allowEmpty: true }),
        sourceSessionDate: cleanDate(input.sourceSessionDate, { allowEmpty: true }),
        snapshotHours: cleanHours(input.snapshotHours ?? 0, { min: -24, max: 24 }),
        currentHours: cleanHours(input.currentHours ?? 0, { min: -24, max: 24 }),
        deltaHours: cleanHours(input.deltaHours ?? 0, { min: -24, max: 24 })
    };
}

function sanitizeEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Invalid timesheet entry payload.');
    }

    const sessionId = cleanString(entry.sessionId, { max: 80, allowEmpty: false });
    if (!sessionId) throw new Error('Timesheet entry sessionId is required.');

    const isReportReflection = entry.isReportReflection === true || sessionId.startsWith('rptref-');
    const isSchoolActivity = entry.isSchoolActivity === true || sessionId.startsWith('act-');
    const isPriorPeriodAdjustment = entry.isPriorPeriodAdjustment === true || sessionId.startsWith('adj-');

    if (entry.isDeleted === true) {
        return {
            sessionId,
            isDeleted: true
        };
    }

    const hoursMin = isPriorPeriodAdjustment ? -24 : 0;
    const hours = cleanHours(entry.hours ?? entry.durationHours ?? 0, { min: hoursMin, max: 24 });

    const row = {
        sessionId,
        date: cleanDate(entry.date, { allowEmpty: true }),
        className: cleanString(entry.className, { max: 200, allowEmpty: true }),
        classId: cleanString(entry.classId, { max: 64, allowEmpty: true }) || null,
        hours,
        status: cleanString(entry.status, { max: 40, allowEmpty: true }).toLowerCase() || 'manual',
        comment: cleanString(entry.comment, { max: 1000, allowEmpty: true }),
        isManual: Boolean(entry.isManual) || isPriorPeriodAdjustment
    };
    if (isPriorPeriodAdjustment) {
        row.isPriorPeriodAdjustment = true;
        row.adjustmentMeta = sanitizeAdjustmentMeta(entry.adjustmentMeta);
    }
    if (isReportReflection) row.isReportReflection = true;
    if (isSchoolActivity) {
        row.isSchoolActivity = true;
        row.activityId = cleanString(entry.activityId, { max: 80, allowEmpty: true });
        row.departmentId = cleanString(entry.departmentId, { max: 80, allowEmpty: true });
        row.departmentName = cleanString(entry.departmentName, { max: 180, allowEmpty: true });
        row.categoryName = cleanString(entry.categoryName, { max: 180, allowEmpty: true });
        row.compensationLookup = entry.compensationLookup && typeof entry.compensationLookup === 'object' && !Array.isArray(entry.compensationLookup)
            ? {
                personId: cleanString(entry.compensationLookup.personId, { max: 80, allowEmpty: true }),
                departmentId: cleanString(entry.compensationLookup.departmentId, { max: 80, allowEmpty: true }),
                activityId: cleanString(entry.compensationLookup.activityId, { max: 80, allowEmpty: true })
            }
            : {};
    }
    return row;
}

function sanitizeTimesheetPayload(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid timesheet payload.');
    }

    const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
    const periodId = cleanId(input.periodId, { max: 64, allowEmpty: false });
    const teacherId = cleanId(input.teacherId, { max: 64, allowEmpty: false });

    if (!orgId) throw new Error('orgId is required.');
    if (!periodId) throw new Error('periodId is required.');
    if (!teacherId) throw new Error('teacherId is required.');

    const status = cleanString(input.status, { max: 30, allowEmpty: true }).toLowerCase() || 'draft';
    if (!TIMESHEET_STATUSES.has(status)) throw new Error('Invalid timesheet status.');

    if (!Array.isArray(input.entries)) throw new Error('Timesheet entries must be an array.');
    if (input.entries.length > 3000) throw new Error('Timesheet contains too many entries.');

    const entries = input.entries.map(sanitizeEntry);
    const computedTotal = entries.reduce((sum, e) => {
        if (e.isDeleted) return sum;
        return sum + (Number(e.hours) || 0);
    }, 0);

    const result = {
        orgId: String(orgId),
        periodId: String(periodId),
        teacherId: String(teacherId),
        status,
        entries,
        totalHours: Number(computedTotal.toFixed(2))
    };

    if (input.submissionSnapshot !== undefined) {
        const snapshot = sanitizeSubmissionSnapshot(input.submissionSnapshot);
        if (snapshot) result.submissionSnapshot = snapshot;
    }

    if (input.priorPeriodAdjustmentsAppliedFrom !== undefined) {
        const appliedFrom = cleanId(input.priorPeriodAdjustmentsAppliedFrom, { max: 64, allowEmpty: true });
        if (appliedFrom) result.priorPeriodAdjustmentsAppliedFrom = String(appliedFrom);
    }

    return result;
}

async function getAllTimesheets() {
    try {
        const data = await fs.readFile(dataPath, 'utf8');
        return JSON.parse(data || '[]');
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw new Error('Failed to retrieve Timesheets');
    }
}

async function getTimesheetById(id) {
    const all = await getAllTimesheets();
    return all.find((t) => String(t.id) === String(id)) || null;
}

async function saveTimesheet(data) {
    return queueWrite(async () => {
        const all = await getAllTimesheets();
        const sanitized = sanitizeTimesheetPayload(data);

        const existingIndex = all.findIndex((t) =>
            String(t.periodId) === String(sanitized.periodId) &&
            String(t.teacherId) === String(sanitized.teacherId)
        );

        if (existingIndex > -1) {
            const existing = all[existingIndex];

            if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
                throw new Error('Security Violation: orgId mismatch.');
            }

            const merged = {
                ...existing,
                ...sanitized,
                orgId: existing.orgId || sanitized.orgId,
                audit: {
                    ...existing.audit,
                    lastUpdateDateTime: new Date().toISOString()
                }
            };
            if (sanitized.submissionSnapshot === undefined && existing.submissionSnapshot) {
                merged.submissionSnapshot = existing.submissionSnapshot;
            }
            if (sanitized.priorPeriodAdjustmentsAppliedFrom === undefined && existing.priorPeriodAdjustmentsAppliedFrom) {
                merged.priorPeriodAdjustmentsAppliedFrom = existing.priorPeriodAdjustmentsAppliedFrom;
            }
            all[existingIndex] = merged;

            await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
            return all[existingIndex];
        }

        const newTimesheet = {
            id: `TS_${Date.now()}`,
            ...sanitized,
            audit: { createDateTime: new Date().toISOString() }
        };

        all.push(newTimesheet);
        await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
        return newTimesheet;
    });
}

async function clearByOrg(orgId, options = {}) {
    void options;
    return queueWrite(async () => {
        const targetOrgId = toPublicId(orgId);
        if (!targetOrgId) throw new Error('orgId is required to clear timesheets.');
        const all = await getAllTimesheets();
        const kept = all.filter((t) => !idsEqual(t.orgId, targetOrgId));
        const removed = all.length - kept.length;
        await fs.writeFile(dataPath, JSON.stringify(kept, null, 2));
        return { removed, remaining: kept.length };
    });
}

module.exports = {
    getAllTimesheets,
    getTimesheetById,
    saveTimesheet,
    clearByOrg,
    sanitizeTimesheetPayload,
    sanitizeSubmissionSnapshot,
    sanitizeSnapshotEntry,
    TIMESHEET_STATUSES: Object.freeze([...TIMESHEET_STATUSES])
};



