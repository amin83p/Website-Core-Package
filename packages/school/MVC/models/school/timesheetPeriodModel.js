const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
// MVC/models/school/timesheetPeriodModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/timesheetPeriods.json');

if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
}

const TIMESHEET_PERIOD_STATUSES = new Set(['open', 'locked', 'processed']);

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

function cleanDate(v, { fieldLabel = 'Date', allowEmpty = false } = {}) {
    if (v === undefined || v === null || String(v).trim() === '') {
        if (allowEmpty) return null;
        throw new Error(`${fieldLabel} is required.`);
    }

    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${fieldLabel}. Use YYYY-MM-DD.`);
    return d.toISOString().slice(0, 10);
}

function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sanitizeTimesheetPeriodInput(input, { isUpdate = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid timesheet period payload.');
    }

    const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
    const name = cleanString(input.name, { max: 120, allowEmpty: false });
    const startDate = cleanDate(input.startDate, { fieldLabel: 'Start Date' });
    const endDate = cleanDate(input.endDate, { fieldLabel: 'End Date' });
    const submissionDeadline = cleanDate(input.submissionDeadline, { fieldLabel: 'Submission Deadline' });

    if (startDate > endDate) throw new Error('Start Date cannot be after End Date.');

    const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'open';
    if (!TIMESHEET_PERIOD_STATUSES.has(status)) throw new Error('Invalid status.');

    const out = {
        orgId: String(orgId),
        name,
        startDate,
        endDate,
        submissionDeadline,
        status,
        notes: cleanString(input.notes, { max: 1000, allowEmpty: true })
    };

    if (!isUpdate && input.id) {
        out.id = cleanId(input.id, { max: 40, allowEmpty: false });
    }

    return out;
}

function assertUniqueInOrg(periods, candidate, { excludeId = null } = {}) {
    const duplicateName = periods.some((p) => {
        if (excludeId && String(p.id) === String(excludeId)) return false;
        return (
            String(p.orgId || '') === String(candidate.orgId || '') &&
            normalizeName(p.name) === normalizeName(candidate.name)
        );
    });

    if (duplicateName) {
        throw new Error('Timesheet period name already exists in this organization.');
    }

    const duplicateRange = periods.some((p) => {
        if (excludeId && String(p.id) === String(excludeId)) return false;
        return (
            String(p.orgId || '') === String(candidate.orgId || '') &&
            String(p.startDate || '') === String(candidate.startDate || '') &&
            String(p.endDate || '') === String(candidate.endDate || '')
        );
    });

    if (duplicateRange) {
        throw new Error('A timesheet period with the same date range already exists in this organization.');
    }
}

async function getAllTimesheetPeriods() {
    try {
        const data = await fs.readFile(dataPath, 'utf8');
        return JSON.parse(data || '[]');
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw new Error('Failed to retrieve Timesheet Periods');
    }
}

async function getTimesheetPeriodById(id) {
    const all = await getAllTimesheetPeriods();
    return all.find((p) => String(p.id) === String(id)) || null;
}

async function addTimesheetPeriod(data) {
    return queueWrite(async () => {
        const all = await getAllTimesheetPeriods();
        const sanitized = sanitizeTimesheetPeriodInput(data, { isUpdate: false });
        assertUniqueInOrg(all, sanitized);

        const newPeriod = {
            id: sanitized.id || `TSP_${Date.now()}`,
            ...sanitized,
            audit: {
                createDateTime: new Date().toISOString()
            }
        };

        all.push(newPeriod);
        await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
        return newPeriod;
    });
}

async function updateTimesheetPeriod(id, data) {
    return queueWrite(async () => {
        const all = await getAllTimesheetPeriods();
        const index = all.findIndex((p) => String(p.id) === String(id));
        if (index === -1) throw new Error('Timesheet Period not found');

        const existing = all[index];
        const sanitized = sanitizeTimesheetPeriodInput(
            { ...data, orgId: existing.orgId || data?.orgId },
            { isUpdate: true }
        );

        if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
            throw new Error('Security Violation: orgId mismatch.');
        }

        assertUniqueInOrg(all, { ...existing, ...sanitized }, { excludeId: existing.id });

        delete sanitized.id;
        sanitized.orgId = existing.orgId || sanitized.orgId;

        all[index] = {
            ...existing,
            ...sanitized,
            audit: {
                ...existing.audit,
                lastUpdateDateTime: new Date().toISOString()
            }
        };

        await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
        return all[index];
    });
}

async function deleteTimesheetPeriod(id) {
    return queueWrite(async () => {
        let all = await getAllTimesheetPeriods();
        const initialLength = all.length;
        all = all.filter((p) => String(p.id) !== String(id));

        if (all.length !== initialLength) {
            await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
            return true;
        }
        return false;
    });
}

module.exports = {
    getAllTimesheetPeriods,
    getTimesheetPeriodById,
    addTimesheetPeriod,
    updateTimesheetPeriod,
    deleteTimesheetPeriod,
    TIMESHEET_PERIOD_STATUSES: Object.freeze([...TIMESHEET_PERIOD_STATUSES])
};

