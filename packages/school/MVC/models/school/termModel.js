const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const dataPath = path.join(resolveCoreRoot(), 'data/school/terms.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const TERM_STATUSES = new Set(['draft', 'planned', 'active', 'started', 'finished', 'cancelled', 'archived']);

const OPTIONAL_DATE_FIELDS = [
  'registrationOpenDate',
  'registrationCloseDate',
  'lateRegistrationDeadline',
  'paymentDueDate',
  'classesStartDate',
  'classesEndDate',
  'addDropDeadline',
  'swapDeadline',
  'withdrawWithoutPenaltyDeadline',
  'withdrawDeadline',
  'censusDate',
  'finalExamStartDate',
  'finalExamEndDate',
  'gradeSubmissionDeadline',
  'termResultReleaseDate'
];

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

function cleanDateOnly(v, { allowEmpty = false } = {}) {
  const s = cleanString(v, { max: 10, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function normalizeTermName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function assertDateOrder(startValue, endValue, message) {
  if (!startValue || !endValue) return;
  if (String(endValue) < String(startValue)) throw new Error(message);
}

function sanitizeTermInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid term payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const code = cleanString(input.code, { max: 40, allowEmpty: false }).toUpperCase();
  const name = cleanString(input.name, { max: 120, allowEmpty: false });
  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';
  const startDate = cleanDateOnly(input.startDate, { allowEmpty: false });
  const endDate = cleanDateOnly(input.endDate, { allowEmpty: false });

  if (!TERM_STATUSES.has(status)) throw new Error('Invalid term status.');
  if (endDate < startDate) throw new Error('Term end date cannot be before start date.');
  if (!/^[A-Z0-9_-]+$/.test(code)) throw new Error('Invalid term code format.');

  const out = {
    orgId,
    code,
    name,
    status,
    startDate,
    endDate,
    description: cleanString(input.description, { max: 5000, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 5000, allowEmpty: true })
  };

  OPTIONAL_DATE_FIELDS.forEach((field) => {
    out[field] = cleanDateOnly(input[field], { allowEmpty: true });
  });

  assertDateOrder(out.registrationOpenDate, out.registrationCloseDate, 'Registration close date cannot be before registration open date.');
  assertDateOrder(out.classesStartDate, out.classesEndDate, 'Classes end date cannot be before classes start date.');
  assertDateOrder(out.finalExamStartDate, out.finalExamEndDate, 'Final exam end date cannot be before final exam start date.');
  assertDateOrder(out.withdrawWithoutPenaltyDeadline, out.withdrawDeadline, 'Withdraw deadline cannot be before withdraw without penalty deadline.');

  if (out.classesStartDate) {
    if (out.classesStartDate < startDate || out.classesStartDate > endDate) {
      throw new Error('Classes start date must fall within the term period.');
    }
  }
  if (out.classesEndDate) {
    if (out.classesEndDate < startDate || out.classesEndDate > endDate) {
      throw new Error('Classes end date must fall within the term period.');
    }
  }
  if (out.addDropDeadline && out.classesStartDate && out.addDropDeadline < out.classesStartDate) {
    throw new Error('Add/Drop deadline cannot be before classes start date.');
  }
  if (out.swapDeadline && out.classesStartDate && out.swapDeadline < out.classesStartDate) {
    throw new Error('Swap deadline cannot be before classes start date.');
  }
  if (out.censusDate && out.classesStartDate && out.classesEndDate) {
    if (out.censusDate < out.classesStartDate || out.censusDate > out.classesEndDate) {
      throw new Error('Census date must fall within the class period.');
    }
  }

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 40, allowEmpty: false });
  }

  return out;
}

function generateTermId(existingIds) {
  let id = '';
  do {
    id = `TRM-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  } while (existingIds.has(id));
  return id;
}

async function getAllTerms() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve terms');
  }
}

async function getTermById(id) {
  const all = await getAllTerms();
  return all.find((term) => String(term.id) === String(id));
}

function assertUniqueInOrg(list, candidate, { excludeId = null } = {}) {
  const candidateOrgId = String(candidate.orgId || '');
  const candidateCode = String(candidate.code || '').trim().toUpperCase();
  const candidateName = normalizeTermName(candidate.name);

  const duplicateCode = list.some((item) => {
    if (excludeId && String(item.id) === String(excludeId)) return false;
    return String(item.orgId || '') === candidateOrgId && String(item.code || '').trim().toUpperCase() === candidateCode;
  });
  if (duplicateCode) throw new Error('Term code already exists in this organization.');

  const duplicateName = list.some((item) => {
    if (excludeId && String(item.id) === String(excludeId)) return false;
    return String(item.orgId || '') === candidateOrgId && normalizeTermName(item.name) === candidateName;
  });
  if (duplicateName) throw new Error('Term name already exists in this organization.');
}

async function addTerm(input) {
  return await queueWrite(async () => {
    const list = await getAllTerms();
    const item = sanitizeTermInput(input);
    item.id = item.id || generateTermId(new Set(list.map((term) => String(term.id || ''))));
    assertUniqueInOrg(list, item);
    list.push(item);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return item;
  });
}

async function updateTerm(id, updates) {
  return await queueWrite(async () => {
    const list = await getAllTerms();
    const index = list.findIndex((term) => String(term.id) === String(id));
    if (index === -1) throw new Error('Term not found.');
    const merged = sanitizeTermInput({ ...list[index], ...updates }, { isUpdate: true });
    merged.id = list[index].id;
    assertUniqueInOrg(list, merged, { excludeId: id });
    list[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return merged;
  });
}

async function deleteTerm(id) {
  return await queueWrite(async () => {
    const list = await getAllTerms();
    const filtered = list.filter((term) => String(term.id) !== String(id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  TERM_STATUSES: Object.freeze([...TERM_STATUSES]),
  OPTIONAL_DATE_FIELDS: Object.freeze([...OPTIONAL_DATE_FIELDS]),
  getAllTerms,
  getTermById,
  addTerm,
  updateTerm,
  deleteTerm
};


