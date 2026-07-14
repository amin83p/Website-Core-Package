const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
// MVC/models/school/departmentModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue'); 
const { normalizePostingPolicyRows } = require('./postingPolicyModel');

const FILE_PATH = path.join(resolveCoreRoot(), 'data/school/departments.json');

// Ensure file exists
if (!fsSync.existsSync(FILE_PATH)) {
    fsSync.writeFileSync(FILE_PATH, '[]');
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
    if (v === undefined || v === null) return allowEmpty ? '' : null;
    const s = String(v).replace(/\0/g, '').trim();
    if (!allowEmpty && !s) return null;
    return s.length > max ? s.slice(0, max) : s;
}

function normalizeName(v) {
    return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeCode(v) {
    return String(v || '').trim().toUpperCase();
}

function sanitizeDepartmentInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid department payload.');
    }

    const orgId = cleanString(input.orgId, { max: 64, allowEmpty: false });
    if (!orgId) throw new Error('orgId is required for department records.');

    const code = normalizeCode(cleanString(input.code, { max: 40, allowEmpty: false }));
    const name = cleanString(input.name, { max: 160, allowEmpty: false });
    if (!code) throw new Error('Department code is required.');
    if (!name) throw new Error('Department name is required.');

    return {
        orgId: String(orgId),
        code,
        name,
        status: cleanString(input.status, { max: 20, allowEmpty: true }) || 'active',
        description: cleanString(input.description, { max: 2000, allowEmpty: true }),
        postingPolicies: normalizePostingPolicyRows(input.postingPolicies)
    };
}

function assertUniqueInOrg(all, candidate, { excludeId = null } = {}) {
    const candidateOrgId = String(candidate.orgId);
    const candidateCode = normalizeCode(candidate.code);
    const candidateName = normalizeName(candidate.name);

    const duplicateCode = all.some((d) => {
      if (String(d.status || '').toLowerCase() === 'void') return false;
        if (excludeId && String(d.id) === String(excludeId)) return false;
        return String(d.orgId || '') === candidateOrgId &&
            normalizeCode(d.code) === candidateCode;
    });
    if (duplicateCode) throw new Error('Department code already exists in this organization.');

    const duplicateName = all.some((d) => {
      if (String(d.status || '').toLowerCase() === 'void') return false;
        if (excludeId && String(d.id) === String(excludeId)) return false;
        return String(d.orgId || '') === candidateOrgId &&
            normalizeName(d.name) === candidateName;
    });
    if (duplicateName) throw new Error('Department name already exists in this organization.');
}

async function getAllDepartments() {
    try {
        const data = await fs.readFile(FILE_PATH, 'utf8');
        return JSON.parse(data || '[]');
    } catch (e) {
        return [];
    }
}

async function getDepartmentById(id) {
    const all = await getAllDepartments();
    return all.find(d => String(d.id) === String(id)) || null;
}

async function addDepartment(data) {
    return await queueWrite(async () => {
        const all = await getAllDepartments();
        const sanitized = sanitizeDepartmentInput(data);
        assertUniqueInOrg(all, sanitized);

        const newDept = {
            id: `DEP_${Date.now()}`,
            ...sanitized,
            createdAt: new Date().toISOString()
        };
        all.push(newDept);
        await fs.writeFile(FILE_PATH, JSON.stringify(all, null, 2));
        return newDept;
    });
}

async function updateDepartment(id, data) {
    return await queueWrite(async () => {
        const all = await getAllDepartments();
        const index = all.findIndex(d => String(d.id) === String(id));
        if (index === -1) throw new Error('Department not found');

        const existing = all[index];
        const sanitized = sanitizeDepartmentInput({ ...data, orgId: existing.orgId || data?.orgId });

        if (existing.orgId && String(sanitized.orgId) !== String(existing.orgId)) {
            throw new Error('Security Violation: orgId mismatch.');
        }

        sanitized.orgId = existing.orgId || sanitized.orgId;
        assertUniqueInOrg(all, sanitized, { excludeId: existing.id });

        all[index] = { ...existing, ...sanitized, updatedAt: new Date().toISOString() };
        await fs.writeFile(FILE_PATH, JSON.stringify(all, null, 2));
        return all[index];
    });
}

async function deleteDepartment(id) {
    return await queueWrite(async () => {
        let all = await getAllDepartments();
        const initialLength = all.length;
        all = all.filter(d => String(d.id) !== String(id));
        
        if (all.length !== initialLength) {
            await fs.writeFile(FILE_PATH, JSON.stringify(all, null, 2));
            return true;
        }
        return false;
    });
}

module.exports = {
    getAllDepartments,
    getDepartmentById,
    addDepartment,
    updateDepartment,
    deleteDepartment
};


