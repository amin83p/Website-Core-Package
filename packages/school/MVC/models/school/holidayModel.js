const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
// MVC/models/school/holidayModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/holidays.json');

async function getAllHolidays() {
    try {
        const data = await fs.readFile(dataPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            await fs.mkdir(path.dirname(dataPath), { recursive: true });
            await fs.writeFile(dataPath, JSON.stringify([]));
            return [];
        }
        throw new Error('Failed to retrieve holidays');
    }
}

function generateId() {
    return 'HOL-' + Math.floor(10000 + Math.random() * 90000).toString();
}

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

function cleanDate(v) {
    const s = cleanString(v, { max: 20, allowEmpty: false });
    if (!s) throw new Error('Holiday date is required.');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid holiday date.');
    return d.toISOString().slice(0, 10);
}

function normalizeHolidayTitle(v) {
    return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sanitizeHolidayInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid holiday payload.');
    }

    const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
    const title = cleanString(input.title, { max: 160, allowEmpty: false });
    const date = cleanDate(input.date);

    if (!orgId) throw new Error('orgId is required for holiday records.');
    if (!title) throw new Error('Holiday title is required.');

    return {
        orgId: String(orgId),
        date,
        title,
        type: cleanString(input.type, { max: 60, allowEmpty: true }) || 'Holiday',
        notes: cleanString(input.notes, { max: 1000, allowEmpty: true })
    };
}

function assertUniqueInOrg(holidays, candidate, { excludeId = null } = {}) {
    const candidateOrgId = String(candidate.orgId);
    const candidateDate = String(candidate.date);
    const candidateTitle = normalizeHolidayTitle(candidate.title);

    const duplicate = holidays.some((h) => {
        if (excludeId && String(h.id) === String(excludeId)) return false;
        return String(h.orgId || '') === candidateOrgId &&
            String(h.date || '') === candidateDate &&
            normalizeHolidayTitle(h.title) === candidateTitle;
    });

    if (duplicate) {
        throw new Error('This holiday already exists in this organization.');
    }
}

async function getHolidayById(id) {
    const holidays = await getAllHolidays();
    return holidays.find(h => String(h.id) === String(id)) || null;
}

async function addHoliday(holidayData) {
    let newHoliday = null;
    await queueWrite(async () => {
        const holidays = await getAllHolidays();
        const sanitized = sanitizeHolidayInput(holidayData);
        assertUniqueInOrg(holidays, sanitized);

        newHoliday = {
            id: generateId(),
            ...sanitized
        };
        holidays.push(newHoliday);
        // Sort chronologically before saving
        holidays.sort((a, b) => new Date(a.date) - new Date(b.date));
        await fs.writeFile(dataPath, JSON.stringify(holidays, null, 2));
    });
    return newHoliday;
}

async function updateHoliday(id, holidayData) {
    return await queueWrite(async () => {
        const holidays = await getAllHolidays();
        const idx = holidays.findIndex(h => String(h.id) === String(id));
        if (idx === -1) throw new Error('Holiday not found');

        const existing = holidays[idx];
        const sanitized = sanitizeHolidayInput({
            ...holidayData,
            orgId: existing.orgId || holidayData?.orgId
        });

        if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
            throw new Error('Security Violation: orgId mismatch.');
        }

        sanitized.orgId = existing.orgId || sanitized.orgId;
        assertUniqueInOrg(holidays, sanitized, { excludeId: existing.id });

        holidays[idx] = {
            ...holidays[idx],
            ...sanitized
        };
        holidays.sort((a, b) => new Date(a.date) - new Date(b.date));
        await fs.writeFile(dataPath, JSON.stringify(holidays, null, 2));
        return holidays[idx];
    });
}

async function deleteHoliday(id) {
    await queueWrite(async () => {
        const holidays = await getAllHolidays();
        const filtered = holidays.filter(h => String(h.id) !== String(id));
        await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    });
}

module.exports = {
    getAllHolidays,
    getHolidayById,
    addHoliday,
    updateHoliday,
    deleteHoliday
};
