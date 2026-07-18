const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
// MVC/models/school/studentModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue'); 
const { FEE_CATEGORIES, FEE_CATEGORY_SET } = require('./feeCategoryCatalog');
const { generateStudentSystemIdCandidate } = require('../../services/school/studentSystemIdGenerator');

const dataPath = path.join(resolveCoreRoot(), 'data/school/students.json');

if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
}

// -----------------------------
// Validation + Sanitization
// -----------------------------

const ACADEMIC_STATUSES = new Set(['Active', 'Probation', 'Graduated', 'Withdrawn', 'Archived']);
const CLB_SKILLS = Object.freeze(['listening', 'speaking', 'reading', 'writing']);
const CLB_LEVEL_HISTORY_MAX = 100;

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
    if (v === undefined || v === null) return allowEmpty ? '' : null;
    const s = String(v).replace(/\0/g, '').trim();
    if (!allowEmpty && !s) return null;
    return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 40, allowEmpty = false } = {}) {
    const s = cleanString(v, { max, allowEmpty });
    if (s === null) return null;
    // IDs should be safe to use in URLs/paths (avoid spaces and special chars)
    if (!s) return allowEmpty ? '' : null;
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format. Use only letters, numbers, underscore, dash.');
    return s;
}

function cleanDateISO(v, { allowEmpty = true } = {}) {
    const s = cleanString(v, { max: 20, allowEmpty });
    if (s === null) return null;
    if (!s) return allowEmpty ? '' : null;
    // Accept YYYY-MM-DD (preferred), but allow Date-parseable strings too.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid enrollmentDate.');
    return d.toISOString().slice(0, 10);
}

function cleanNumber(v, { min = 0, max = Number.MAX_SAFE_INTEGER, allowEmpty = true } = {}) {
    if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Invalid number value.');
    if (n < min || n > max) throw new Error('Number value out of range.');
    return n;
}

function cleanBoolean(v) {
    return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

function cleanAttachments(v) {
    if (v === undefined || v === null || v === '') return [];
    if (!Array.isArray(v)) throw new Error('attachments must be an array.');
    if (v.length > 200) throw new Error('Too many attachments.');

    return v.map((a) => {
        if (!isPlainObject(a)) throw new Error('Invalid attachment object.');
        return {
            id: cleanId(a.id, { max: 64, allowEmpty: true }) || undefined,
            originalName: cleanString(a.originalName, { max: 255, allowEmpty: true }),
            filename: cleanString(a.filename, { max: 255, allowEmpty: true }),
            path: cleanString(a.path, { max: 4096, allowEmpty: true }).replace(/\\/g, '/'),
            url: cleanString(a.url, { max: 2048, allowEmpty: true }),
            size: cleanNumber(a.size, { min: 0, max: 200 * 1024 * 1024, allowEmpty: true }),
            uploadDate: cleanString(a.uploadDate, { max: 40, allowEmpty: true }),
            comment: cleanString(a.comment, { max: 500, allowEmpty: true })
        };
    });
}

function cleanClbSkillLevels(value) {
    const src = isPlainObject(value) ? value : {};
    const out = {};
    CLB_SKILLS.forEach((skill) => {
        out[skill] = cleanString(src[skill], { max: 20, allowEmpty: true });
    });
    return out;
}

function cleanClbLevelHistory(value) {
    if (value === undefined || value === null || value === '') return [];
    if (!Array.isArray(value)) throw new Error('clbLevelHistory must be an array.');
    if (value.length > CLB_LEVEL_HISTORY_MAX) throw new Error('Too many CLB level history entries.');

    const cleaned = value.map((entry, index) => {
        if (!isPlainObject(entry)) throw new Error('Invalid CLB level history entry.');
        const recordedAt = cleanDateISO(entry.recordedAt, { allowEmpty: false });
        if (!recordedAt) throw new Error(`CLB level history entry ${index + 1} requires a valid recordedAt date.`);
        const id = cleanId(entry.id, { max: 64, allowEmpty: true }) || `clb_${Date.now()}_${index}`;
        return {
            id,
            recordedAt,
            goal: cleanClbSkillLevels(entry.goal),
            current: cleanClbSkillLevels(entry.current),
            result: cleanClbSkillLevels(entry.result)
        };
    });

    cleaned.sort((a, b) => {
        const dateCmp = String(b.recordedAt).localeCompare(String(a.recordedAt));
        if (dateCmp !== 0) return dateCmp;
        return String(b.id).localeCompare(String(a.id));
    });

    return cleaned;
}

function sanitizeStudentInput(input, { isUpdate = false } = {}) {
    if (!isPlainObject(input)) throw new Error('Invalid student payload.');

    // Required fields
    const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
    const personId = cleanId(input.personId, { max: 64, allowEmpty: false });
    if (!orgId) throw new Error('orgId is required for student records.');
    if (!personId) throw new Error('personId is required.');

    const feeCategory = cleanString(input.feeCategory, { max: 50, allowEmpty: true });
    if (feeCategory && !FEE_CATEGORY_SET.has(feeCategory)) {
        throw new Error('Invalid feeCategory.');
    }

    const academicStatus = cleanString(input.academicStatus, { max: 20, allowEmpty: true }) || 'Active';
    if (academicStatus && !ACADEMIC_STATUSES.has(academicStatus)) {
        throw new Error('Invalid academicStatus.');
    }

    const enrollmentDate = cleanDateISO(input.enrollmentDate, { allowEmpty: isUpdate });
    if (!isUpdate && !enrollmentDate) throw new Error('enrollmentDate is required.');

    const out = {
        // identifiers
        orgId: String(orgId),
        personId: String(personId),
        customStudentId: cleanId(input.customStudentId, { max: 40, allowEmpty: true }),

        // fields
        localId: cleanString(input.localId, { max: 80, allowEmpty: true }),
        countryOfOrigin: cleanString(input.countryOfOrigin, { max: 80, allowEmpty: true }),
        feeCategory: feeCategory,
        sendingOrganization: cleanString(input.sendingOrganization, { max: 120, allowEmpty: true }),
        studentAccountId: cleanId(input.studentAccountId, { max: 64, allowEmpty: true }),
        enrollmentDate,
        academicStatus,
        notes: cleanString(input.notes, { max: 5000, allowEmpty: true }),
        attachments: cleanAttachments(input.attachments),
        clbLevelHistory: cleanClbLevelHistory(input.clbLevelHistory)
    };

    // Optional id on create
    if (!isUpdate && input.id) {
        out.id = cleanId(input.id, { max: 40, allowEmpty: false });
    }

    return out;
}

async function getAllStudents() {
    try {
        const data = await fs.readFile(dataPath, 'utf8');
        return JSON.parse(data || '[]');
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw new Error('Failed to retrieve Students');
    }
}

async function getStudentById(id) {
    const all = await getAllStudents();
    return all.find(s => String(s.id) === String(id)) || null;
}

async function addStudent(data, options = {}) {
    void options;
    return await queueWrite(async () => {
        const all = await getAllStudents();

        const sanitized = sanitizeStudentInput(data, { isUpdate: false });
        
        // Prevent duplicate enrollments for the same person *within the same organization*
        if (all.some(s => String(s.personId) === String(sanitized.personId) && String(s.orgId) === String(sanitized.orgId))) {
            throw new Error('This person is already admitted as a student.');
        }

        if (sanitized.customStudentId && all.some((student) =>
            String(student.orgId) === String(sanitized.orgId) &&
            String(student.customStudentId || student.id || '').toLowerCase() === String(sanitized.customStudentId).toLowerCase()
        )) {
            throw new Error('Custom Student ID is already assigned within this organization.');
        }

        // Ensure ID is unique
        const existingIds = new Set(all.map(s => String(s.id)));
        const finalId = sanitized.id ? String(sanitized.id) : generateStudentSystemIdCandidate(existingIds);
        if (existingIds.has(finalId)) throw new Error('Student id already exists.');

        const newStudent = {
            ...sanitized,
            id: finalId,
            audit: { createDateTime: new Date().toISOString() }
        };
        all.push(newStudent);
        await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
        return newStudent;
    });
}

async function updateStudent(id, data, options = {}) {
    void options;
    return await queueWrite(async () => {
        const all = await getAllStudents();
        const index = all.findIndex(s => String(s.id) === String(id));
        if (index === -1) throw new Error('Student not found');

        const existing = all[index];

        // Sanitize incoming fields (but do NOT allow changing orgId/personId/id on update)
        // We still require orgId/personId present in payload for validation consistency, so we inject from existing.
        const sanitized = sanitizeStudentInput(
            {
                ...data,
                orgId: existing.orgId || data?.orgId,
                personId: existing.personId || data?.personId
            },
            { isUpdate: true }
        );

        // Prevent orgId/personId tampering
        if (existing.orgId && String(sanitized.orgId) !== String(existing.orgId)) {
            throw new Error('Security Violation: orgId mismatch.');
        }
        if (existing.personId && String(sanitized.personId) !== String(existing.personId)) {
            throw new Error('Security Violation: personId mismatch.');
        }

        if (sanitized.customStudentId && all.some((student, studentIndex) =>
            studentIndex !== index &&
            String(student.orgId) === String(existing.orgId) &&
            String(student.customStudentId || student.id || '').toLowerCase() === String(sanitized.customStudentId).toLowerCase()
        )) {
            throw new Error('Custom Student ID is already assigned within this organization.');
        }

        // Keep immutable fields
        delete sanitized.id;
        sanitized.orgId = existing.orgId || sanitized.orgId;
        sanitized.personId = existing.personId || sanitized.personId;
        
        all[index] = { 
            ...existing,
            ...sanitized,
            audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() } 
        };
        await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
        return all[index];
    });
}

async function deleteStudent(id, options = {}) {
    void options;
    return await queueWrite(async () => {
        const all = await getAllStudents();
        const index = all.findIndex(s => String(s.id) === String(id));
        if (index === -1) return false;

        const existing = all[index];
        if (String(existing.academicStatus || '') === 'Archived') {
            return existing;
        }

        const archived = {
            ...existing,
            academicStatus: 'Archived',
            audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
        };
        all[index] = archived;
        await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
        return archived;
    });
}

async function purgeStudent(id, options = {}) {
    void options;
    return await queueWrite(async () => {
        const all = await getAllStudents();
        const index = all.findIndex((s) => String(s.id) === String(id));
        if (index === -1) return false;

        const [removed] = all.splice(index, 1);
        await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
        return removed || false;
    });
}

module.exports = {
    getAllStudents,
    getStudentById,
    addStudent,
    updateStudent,
    deleteStudent,
    purgeStudent,
    sanitizeStudentInput,
    cleanClbLevelHistory,
    CLB_SKILLS,
    ACADEMIC_STATUSES: Object.freeze([...ACADEMIC_STATUSES]),
    FEE_CATEGORIES
};


