const { requireCoreModule, resolveCoreRoot } = requireCoreModule('MVC/services/school/schoolCoreModuleResolver');
// MVC/models/school/staffModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/staff.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const STAFF_STATUSES = new Set(['Active', 'On Leave', 'Inactive', 'Archived']);
const EMPLOYMENT_TYPES = new Set(['Full-Time', 'Part-Time', 'Contract', 'Temporary']);
const COMPENSATION_METHODS = new Set(['hourly', 'salary_monthly', 'salary_annual', 'per_session', 'per_class', 'stipend', 'custom']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanDateISO(v, { allowEmpty = true } = {}) {
  const s = cleanString(v, { max: 20, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date value.');
  return d.toISOString().slice(0, 10);
}

function cleanMoney(v, { allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid monetary value.');
  if (n > 1000000) throw new Error('Monetary value out of range.');
  return Number(n.toFixed(2));
}

function buildRangeStart(value) {
  return value || '0001-01-01';
}

function buildRangeEnd(value) {
  return value || '9999-12-31';
}

function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  return buildRangeStart(aFrom) <= buildRangeEnd(bTo) && buildRangeStart(bFrom) <= buildRangeEnd(aTo);
}

function sanitizeCompensationProfiles(rawProfiles) {
  const list = Array.isArray(rawProfiles) ? rawProfiles : [];
  const sanitized = list.map((entry, idx) => {
    const id = cleanId(entry?.id || `CMP_${Date.now()}_${idx + 1}`, { max: 80, allowEmpty: false });
    const departmentId = cleanId(entry?.departmentId, { max: 64, allowEmpty: false });
    const paymentMethodRaw = cleanString(entry?.paymentMethod, { max: 40, allowEmpty: true }).toLowerCase() || 'hourly';
    const paymentMethod = COMPENSATION_METHODS.has(paymentMethodRaw) ? paymentMethodRaw : 'custom';
    const effectiveFrom = cleanDateISO(entry?.effectiveFrom, { allowEmpty: true });
    const effectiveTo = cleanDateISO(entry?.effectiveTo, { allowEmpty: true });
    if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
      throw new Error('Compensation Effective To cannot be earlier than Effective From.');
    }

    const hourlyRate = cleanMoney(entry?.hourlyRate, { allowEmpty: true });
    const paymentAmount = cleanMoney(entry?.paymentAmount, { allowEmpty: true });
    if (paymentMethod === 'hourly' && !(hourlyRate > 0)) {
      throw new Error('Hourly payment method requires hourlyRate > 0.');
    }
    if (paymentMethod !== 'hourly' && !(paymentAmount > 0)) {
      throw new Error('Selected payment method requires paymentAmount > 0.');
    }

    return {
      id: String(id),
      departmentId: String(departmentId),
      paymentMethod,
      hourlyRate: hourlyRate ?? null,
      paymentAmount: paymentAmount ?? null,
      effectiveFrom,
      effectiveTo,
      contractId: cleanString(entry?.contractId, { max: 80, allowEmpty: true }),
      notes: cleanString(entry?.notes, { max: 400, allowEmpty: true })
    };
  });

  for (let i = 0; i < sanitized.length; i++) {
    for (let j = i + 1; j < sanitized.length; j++) {
      const a = sanitized[i];
      const b = sanitized[j];
      if (String(a.departmentId) !== String(b.departmentId)) continue;
      if (rangesOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)) {
        throw new Error('Compensation date ranges conflict within the same department.');
      }
    }
  }
  return sanitized;
}

function sanitizeStaffInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid staff payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const personId = cleanId(input.personId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!personId) throw new Error('personId is required.');

  const status = cleanString(input.status, { max: 40, allowEmpty: true }) || 'Active';
  if (!STAFF_STATUSES.has(status)) throw new Error('Invalid staff status.');

  const employmentType = cleanString(input.employmentType, { max: 40, allowEmpty: true }) || 'Full-Time';
  if (!EMPLOYMENT_TYPES.has(employmentType)) throw new Error('Invalid employment type.');

  const out = {
    orgId: String(orgId),
    personId: String(personId),
    staffAccountId: cleanId(input.staffAccountId, { max: 64, allowEmpty: true }),
    employeeNumber: cleanString(input.employeeNumber, { max: 60, allowEmpty: true }),
    jobTitle: cleanString(input.jobTitle, { max: 120, allowEmpty: true }),
    departmentId: cleanId(input.departmentId, { max: 64, allowEmpty: true }),
    defaultPayRateId: cleanId(input.defaultPayRateId, { max: 64, allowEmpty: true }),
    compensationProfiles: sanitizeCompensationProfiles(input.compensationProfiles),
    employmentType,
    hireDate: cleanDateISO(input.hireDate, { allowEmpty: isUpdate }),
    contractEndDate: cleanDateISO(input.contractEndDate, { allowEmpty: true }),
    status,
    workLocation: cleanString(input.workLocation, { max: 160, allowEmpty: true }),
    responsibilities: cleanString(input.responsibilities, { max: 1200, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 5000, allowEmpty: true })
  };

  if (!isUpdate && input.id) out.id = cleanId(input.id, { max: 50, allowEmpty: false });
  return out;
}

function generateStaffId(existingIdsSet) {
  for (let i = 0; i < 50; i++) {
    const candidate = `STF${Math.floor(10000 + Math.random() * 90000)}`;
    if (!existingIdsSet.has(candidate)) return candidate;
  }
  return `STF${Date.now()}`;
}

async function getAllStaff() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve staff');
  }
}

async function getStaffById(id) {
  const all = await getAllStaff();
  return all.find((s) => String(s.id) === String(id)) || null;
}

async function addStaff(data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllStaff();
    const sanitized = sanitizeStaffInput(data, { isUpdate: false });

    if (all.some((s) => String(s.orgId) === String(sanitized.orgId) && String(s.personId) === String(sanitized.personId))) {
      throw new Error('This person is already registered as staff.');
    }

    const existingIds = new Set(all.map((s) => String(s.id)));
    const finalId = sanitized.id ? String(sanitized.id) : generateStaffId(existingIds);
    if (existingIds.has(finalId)) throw new Error('Staff id already exists.');

    const record = {
      ...sanitized,
      id: finalId,
      audit: { createDateTime: new Date().toISOString() }
    };

    all.push(record);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return record;
  });
}

async function updateStaff(id, data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllStaff();
    const index = all.findIndex((s) => String(s.id) === String(id));
    if (index === -1) throw new Error('Staff not found');

    const existing = all[index];
    const sanitized = sanitizeStaffInput(
      {
        ...data,
        orgId: existing.orgId || data?.orgId,
        personId: existing.personId || data?.personId
      },
      { isUpdate: true }
    );

    if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
      throw new Error('Security Violation: orgId mismatch.');
    }
    if (existing.personId && String(existing.personId) !== String(sanitized.personId)) {
      throw new Error('Security Violation: personId mismatch.');
    }

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

async function deleteStaff(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllStaff();
    const index = all.findIndex((s) => String(s.id) === String(id));
    if (index === -1) return false;

    const existing = all[index];
    if (String(existing.status || '') === 'Archived') return existing;

    const archived = {
      ...existing,
      status: 'Archived',
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };
    all[index] = archived;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return archived;
  });
}

async function purgeStaff(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllStaff();
    const index = all.findIndex((s) => String(s.id) === String(id));
    if (index === -1) return false;

    const [removed] = all.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return removed || false;
  });
}

module.exports = {
  getAllStaff,
  getStaffById,
  addStaff,
  updateStaff,
  deleteStaff,
  purgeStaff,
  STAFF_STATUSES: Object.freeze([...STAFF_STATUSES]),
  EMPLOYMENT_TYPES: Object.freeze([...EMPLOYMENT_TYPES]),
  COMPENSATION_METHODS: Object.freeze([...COMPENSATION_METHODS])
};
