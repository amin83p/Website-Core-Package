const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
// MVC/models/school/payRateModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/payRates.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
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

function cleanMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Hourly rate must be a positive number.');
  if (n > 1000000) throw new Error('Hourly rate is out of allowed range.');
  return Number(n.toFixed(2));
}

function cleanDate(v, { allowEmpty = true } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') return allowEmpty ? null : '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date value. Use YYYY-MM-DD.');
  return d.toISOString().slice(0, 10);
}

function sanitizePeriodInput(input, { requireRate = true } = {}) {
  const hourlyRate = requireRate ? cleanMoney(input?.hourlyRate) : (input?.hourlyRate !== undefined ? cleanMoney(input.hourlyRate) : null);
  const effectiveFrom = cleanDate(input?.effectiveFrom, { allowEmpty: true });
  const effectiveTo = cleanDate(input?.effectiveTo, { allowEmpty: true });

  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    throw new Error('Effective To date cannot be earlier than Effective From date.');
  }

  return {
    id: cleanId(input?.id || `PRP_${Date.now()}`, { max: 64, allowEmpty: false }),
    hourlyRate,
    effectiveFrom,
    effectiveTo,
    contractId: cleanString(input?.contractId, { max: 60, allowEmpty: true }),
    updatedAt: new Date().toISOString()
  };
}

function sanitizePayRateInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid pay rate payload.');
  }

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const personId = cleanId(input.personId || input.teacherUserId, { max: 64, allowEmpty: false });
  const departmentId = cleanId(input.departmentId, { max: 64, allowEmpty: false });
  const personRoleRaw = cleanString(input.personRole, { max: 20, allowEmpty: true }).toLowerCase();
  const personRole = (personRoleRaw === 'staff') ? 'staff' : 'teacher';

  if (!orgId) throw new Error('orgId is required.');
  if (!personId) throw new Error('Person is required.');
  if (!departmentId) throw new Error('Department is required.');
  const periodsInput = Array.isArray(input.ratePeriods) ? input.ratePeriods : [];
  const ratePeriods = periodsInput.map((p) => sanitizePeriodInput(p, { requireRate: true }));

  const out = {
    orgId: String(orgId),
    personId: String(personId),
    personRole,
    departmentId: String(departmentId),
    ratePeriods
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 40, allowEmpty: false });
  }

  return out;
}

function normalizeStoredPayRate(record) {
  const orgId = cleanId(record?.orgId, { max: 64, allowEmpty: true }) || '';
  const personId = cleanId(record?.personId || record?.teacherUserId, { max: 64, allowEmpty: true }) || '';
  const departmentId = cleanId(record?.departmentId, { max: 64, allowEmpty: true }) || '';
  const roleRaw = cleanString(record?.personRole, { max: 20, allowEmpty: true }).toLowerCase();
  const personRole = roleRaw === 'staff' ? 'staff' : 'teacher';

  let ratePeriods = [];
  if (Array.isArray(record?.ratePeriods) && record.ratePeriods.length) {
    ratePeriods = record.ratePeriods.map((p) => sanitizePeriodInput(p, { requireRate: true }));
  } else if (record && (record.hourlyRate !== undefined || record.effectiveFrom || record.effectiveTo || record.contractId)) {
    ratePeriods = [sanitizePeriodInput({
      id: record.periodId || `PRP_${Date.now()}`,
      hourlyRate: record.hourlyRate,
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
      contractId: record.contractId
    }, { requireRate: true })];
  }

  return {
    id: cleanId(record?.id || `PR_${Date.now()}`, { max: 64, allowEmpty: false }),
    orgId,
    personId,
    personRole,
    departmentId,
    ratePeriods,
    createdAt: record?.createdAt || new Date().toISOString(),
    updatedAt: record?.updatedAt || null
  };
}

function periodsOverlap(a, b) {
  const aStart = a?.effectiveFrom || '0001-01-01';
  const aEnd = a?.effectiveTo || '9999-12-31';
  const bStart = b?.effectiveFrom || '0001-01-01';
  const bEnd = b?.effectiveTo || '9999-12-31';
  return aStart <= bEnd && bStart <= aEnd;
}

function assertNoPeriodConflict(ratePeriods, candidatePeriod, { excludePeriodId = null } = {}) {
  const hasConflict = (ratePeriods || []).some((p) => {
    if (excludePeriodId && String(p.id) === String(excludePeriodId)) return false;
    return periodsOverlap(p, candidatePeriod);
  });
  if (hasConflict) {
    throw new Error('Pay rate date range conflicts with an existing period for this person.');
  }
}

async function getAllPayRates() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(String(data || '[]').replace(/^\uFEFF/, '') || '[]');
    return (Array.isArray(parsed) ? parsed : []).map(normalizeStoredPayRate);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve Pay Rates');
  }
}

async function getPayRateById(id) {
  const all = await getAllPayRates();
  return all.find((r) => String(r.id) === String(id)) || null;
}

async function addPayRate(data) {
  return queueWrite(async () => {
    const all = await getAllPayRates();
    const sanitized = sanitizePayRateInput(data, { isUpdate: false });
    const newPeriod = sanitizePeriodInput(data, { requireRate: true });
    const existingProfile = all.find((r) =>
      String(r.orgId || '') === String(sanitized.orgId || '') &&
      String(r.personId || '') === String(sanitized.personId || '') &&
      String(r.departmentId || '') === String(sanitized.departmentId || '')
    );

    if (existingProfile) {
      assertNoPeriodConflict(existingProfile.ratePeriods, newPeriod);
      const merged = {
        ...existingProfile,
        personRole: sanitized.personRole || existingProfile.personRole || 'teacher',
        ratePeriods: [...(existingProfile.ratePeriods || []), { ...newPeriod, createdAt: new Date().toISOString() }],
        updatedAt: new Date().toISOString()
      };
      const idx = all.findIndex((r) => String(r.id) === String(existingProfile.id));
      all[idx] = merged;
      await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
      return merged;
    }

    const newRate = {
      id: sanitized.id || `PR_${Date.now()}`,
      ...sanitized,
      ratePeriods: [{ ...newPeriod, createdAt: new Date().toISOString() }],
      createdAt: new Date().toISOString()
    };

    all.push(newRate);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return newRate;
  });
}

async function updatePayRate(id, data) {
  return queueWrite(async () => {
    const all = await getAllPayRates();
    const index = all.findIndex((r) => String(r.id) === String(id));
    if (index === -1) throw new Error('Pay Rate not found');

    const existing = all[index];
    const normalizedExisting = normalizeStoredPayRate(existing);
    const periodId = cleanId(data.periodId || '', { max: 64, allowEmpty: true });
    const incomingPeriod = sanitizePeriodInput({
      id: periodId || `PRP_${Date.now()}`,
      hourlyRate: data.hourlyRate,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo,
      contractId: data.contractId
    }, { requireRate: true });

    if (normalizedExisting.orgId && String(normalizedExisting.orgId) !== String(data.orgId || normalizedExisting.orgId)) {
      throw new Error('Security Violation: orgId mismatch.');
    }

    const existingPeriods = Array.isArray(normalizedExisting.ratePeriods) ? normalizedExisting.ratePeriods.slice() : [];
    const targetPeriodIndex = existingPeriods.findIndex((p) => String(p.id) === String(periodId || incomingPeriod.id));

    if (targetPeriodIndex >= 0) {
      assertNoPeriodConflict(existingPeriods, incomingPeriod, { excludePeriodId: existingPeriods[targetPeriodIndex].id });
      existingPeriods[targetPeriodIndex] = {
        ...existingPeriods[targetPeriodIndex],
        ...incomingPeriod,
        updatedAt: new Date().toISOString()
      };
    } else {
      assertNoPeriodConflict(existingPeriods, incomingPeriod);
      existingPeriods.push({ ...incomingPeriod, createdAt: new Date().toISOString() });
    }

    const personRoleRaw = cleanString(data.personRole, { max: 20, allowEmpty: true }).toLowerCase();
    const personRole = personRoleRaw === 'staff' ? 'staff' : normalizedExisting.personRole || 'teacher';

    all[index] = {
      ...normalizedExisting,
      personRole,
      ratePeriods: existingPeriods,
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deletePayRate(id) {
  return queueWrite(async () => {
    let all = await getAllPayRates();
    const initialLength = all.length;
    all = all.filter((r) => String(r.id) !== String(id));

    if (all.length !== initialLength) {
      await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
      return true;
    }
    return false;
  });
}

module.exports = {
  getAllPayRates,
  getPayRateById,
  addPayRate,
  updatePayRate,
  deletePayRate,
  sanitizePeriodInput,
  assertNoPeriodConflict
};

