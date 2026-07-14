const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
// MVC/models/school/programModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { FEE_CATEGORIES, ALL_FEE_CATEGORIES_KEY } = require('./feeCategoryCatalog');
const { TERM_STATUSES, OPTIONAL_DATE_FIELDS } = require('./termModel');
const { normalizePostingPolicyRows } = require('./postingPolicyModel');

const dataPath = path.join(resolveCoreRoot(), 'data/school/programs.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const PROGRAM_STATUSES = new Set(['draft', 'active', 'inactive', 'archived', 'void']);
const { applyVoidMetadata } = require('./voidRecordMetadata');
const FEE_FREQUENCIES = new Set(['one_time', 'daily', 'weekly', 'monthly', 'term', 'yearly']);
const SUBJECT_TYPES = ['main', 'essential', 'optional'];
const PROGRAM_TERM_SNAPSHOT_FIELDS = [...OPTIONAL_DATE_FIELDS];
const REQUIRED_PROGRAM_TERM_DATE_FIELDS = Object.freeze([
  'registrationOpenDate',
  'registrationCloseDate',
  'classesStartDate',
  'classesEndDate',
  'addDropDeadline',
  'withdrawWithoutPenaltyDeadline',
  'withdrawDeadline',
  'censusDate'
]);

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
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format. Use only letters, numbers, underscore, dash.');
  return s;
}

function cleanNumber(v, { min = 0, max = Number.MAX_SAFE_INTEGER, allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Invalid number value.');
  if (n < min || n > max) throw new Error('Number value out of range.');
  return n;
}

function cleanInteger(v, { min = 0, max = Number.MAX_SAFE_INTEGER, allowEmpty = true } = {}) {
  const n = cleanNumber(v, { min, max, allowEmpty });
  if (n === null) return null;
  if (!Number.isInteger(n)) throw new Error('Integer value required.');
  return n;
}

function cleanDateISO(v, { allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date value.');
  return s;
}

function cleanDuration(v) {
  if (!isPlainObject(v)) throw new Error('duration is required and must be an object.');

  const years = cleanInteger(v.years, { min: 0, max: 50, allowEmpty: true }) || 0;
  const months = cleanInteger(v.months, { min: 0, max: 600, allowEmpty: true }) || 0;
  const days = cleanInteger(v.days, { min: 0, max: 20000, allowEmpty: true }) || 0;

  if (years === 0 && months === 0 && days === 0) {
    throw new Error('duration must contain at least one non-zero value.');
  }

  return { years, months, days };
}

function cleanFeeLine(line) {
  if (!isPlainObject(line)) throw new Error('Each fee line must be an object.');

  const transactionDefinitionId = cleanId(line.transactionDefinitionId, { max: 64, allowEmpty: true }) || '';
  const code = cleanString(line.code, { max: 40, allowEmpty: true }).toUpperCase();
  const label = cleanString(line.label, { max: 120, allowEmpty: true });
  const amount = cleanNumber(line.amount, { min: 0, max: 1000000000, allowEmpty: true });
  const currency = cleanString(line.currency, { max: 3, allowEmpty: true }).toUpperCase();
  const frequencyRaw = cleanString(line.frequency, { max: 20, allowEmpty: true }).toLowerCase();
  const frequency = frequencyRaw || 'one_time';
  const notes = cleanString(line.notes, { max: 500, allowEmpty: true });
  const isOptional = Boolean(line.isOptional);
  const transactionDefinitionCode = cleanString(line.transactionDefinitionCode, { max: 40, allowEmpty: true }).toUpperCase();
  const transactionDefinitionName = cleanString(line.transactionDefinitionName, { max: 120, allowEmpty: true });
  const validFrom = cleanDateISO(line.validFrom, { allowEmpty: true });
  const validTo = cleanDateISO(line.validTo, { allowEmpty: true });

  if (!transactionDefinitionId) {
    throw new Error('Each fee line must include a transaction template.');
  }
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error('Invalid currency format. Use ISO code like CAD or USD.');
  }
  if (frequency && !FEE_FREQUENCIES.has(frequency)) {
    throw new Error('Invalid fee frequency.');
  }
  if (validFrom && validTo && validFrom > validTo) {
    throw new Error('Fee line validTo cannot be earlier than validFrom.');
  }

  return {
    transactionDefinitionId,
    transactionDefinitionCode,
    transactionDefinitionName,
    code,
    label,
    amount,
    currency,
    frequency,
    validFrom,
    validTo,
    notes,
    isOptional
  };
}

function cleanFeeGroups(v) {
  const categories = Array.isArray(FEE_CATEGORIES) ? FEE_CATEGORIES : [];
  const allowedKeys = categories.concat([ALL_FEE_CATEGORIES_KEY]);
  const out = {};

  if (v === undefined || v === null || v === '') {
    allowedKeys.forEach((cat) => { out[cat] = []; });
    return out;
  }

  if (!isPlainObject(v)) throw new Error('feeGroups must be an object keyed by fee category.');

  const unknownKeys = Object.keys(v).filter((k) => !allowedKeys.includes(k));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown fee category key(s): ${unknownKeys.join(', ')}`);
  }

  allowedKeys.forEach((cat) => {
    const rows = v[cat] ?? [];
    if (!Array.isArray(rows)) throw new Error(`feeGroups.${cat} must be an array.`);
    if (rows.length > 200) throw new Error(`Too many fee rows for category ${cat}.`);
    out[cat] = rows.map(cleanFeeLine);
  });

  return out;
}

function validateSubjectGraph(subjects) {
  const subjectIds = new Set(subjects.map((s) => s.subjectId));

  for (const s of subjects) {
    for (const pre of s.prerequisites) {
      if (!subjectIds.has(pre)) {
        throw new Error(`Invalid prerequisite "${pre}" for subject "${s.subjectId}".`);
      }
      if (pre === s.subjectId) {
        throw new Error(`Subject "${s.subjectId}" cannot require itself.`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const map = new Map(subjects.map((s) => [s.subjectId, s.prerequisites]));

  function dfs(subjectId) {
    if (visiting.has(subjectId)) return true;
    if (visited.has(subjectId)) return false;

    visiting.add(subjectId);
    const prerequisites = map.get(subjectId) || [];
    for (const preId of prerequisites) {
      if (dfs(preId)) return true;
    }
    visiting.delete(subjectId);
    visited.add(subjectId);
    return false;
  }

  for (const id of subjectIds) {
    if (dfs(id)) throw new Error('Circular prerequisite dependency detected in subjects.');
  }
}

function calculateSubjectTypeTotals(subjects) {
  return (Array.isArray(subjects) ? subjects : []).reduce((acc, subject) => {
    const type = SUBJECT_TYPES.includes(subject?.subjectType) ? subject.subjectType : 'main';
    const credits = Number(subject?.programCredits);
    if (Number.isFinite(credits)) acc[type] += credits;
    return acc;
  }, { main: 0, essential: 0, optional: 0 });
}

function cleanSubjects(v) {
  if (!Array.isArray(v)) throw new Error('subjects must be an array.');
  if (v.length === 0) return [];
  if (v.length > 500) throw new Error('Too many subjects in one program.');

  const subjectIds = new Set();
  const orderSet = new Set();

  const normalized = v.map((item, idx) => {
    if (!isPlainObject(item)) throw new Error('Each subject entry must be an object.');

    const subjectId = cleanId(item.subjectId, { max: 64, allowEmpty: false });
    if (!subjectId) throw new Error('subjectId is required for each subject entry.');
    if (subjectIds.has(subjectId)) throw new Error(`Duplicate subjectId in program subjects: ${subjectId}`);
    subjectIds.add(subjectId);

    const order = cleanInteger(item.order, { min: 1, max: 5000, allowEmpty: true }) || (idx + 1);
    if (orderSet.has(order)) throw new Error(`Duplicate subject order detected: ${order}`);
    orderSet.add(order);

    const prerequisitesRaw = item.prerequisites ?? [];
    if (!Array.isArray(prerequisitesRaw)) throw new Error(`prerequisites must be an array for subject ${subjectId}.`);

    const prerequisites = [...new Set(prerequisitesRaw.map((p) => cleanId(p, { max: 64, allowEmpty: false })))];
    const subjectTypeRaw = cleanString(item.subjectType, { max: 20, allowEmpty: true }).toLowerCase();
    const subjectType = subjectTypeRaw || (item.isRequired === false ? 'essential' : 'main');
    if (!SUBJECT_TYPES.includes(subjectType)) throw new Error(`Invalid subjectType for subject ${subjectId}.`);

    return {
      subjectId,
      order,
      isRequired: subjectType === 'main' ? true : (item.isRequired === undefined ? false : Boolean(item.isRequired)),
      subjectType,
      programCredits: cleanNumber(item.programCredits ?? item.credits, { min: 0, max: 1000, allowEmpty: false }),
      minPassingScore: cleanNumber(item.minPassingScore, { min: 0, max: 100, allowEmpty: true }),
      minPassingAverage: cleanNumber(item.minPassingAverage, { min: 0, max: 100, allowEmpty: true }),
      mustPass: item.mustPass === undefined ? subjectType === 'main' : Boolean(item.mustPass),
      allowCompensation: item.allowCompensation === undefined ? false : Boolean(item.allowCompensation),
      prerequisites,
      notes: cleanString(item.notes, { max: 500, allowEmpty: true })
    };
  });

  validateSubjectGraph(normalized);
  return normalized.sort((a, b) => a.order - b.order);
}

function cleanAcademicRules(v, subjects) {
  const rules = isPlainObject(v) ? v : {};
  const totals = calculateSubjectTypeTotals(subjects);
  const requiredMainCredits = cleanNumber(
    rules.requiredMainCredits === undefined || rules.requiredMainCredits === null || rules.requiredMainCredits === ''
      ? totals.main
      : rules.requiredMainCredits,
    { min: 0, max: 100000, allowEmpty: false }
  );
  const requiredEssentialCredits = cleanNumber(rules.requiredEssentialCredits, { min: 0, max: 100000, allowEmpty: true }) || 0;
  const requiredOptionalCredits = cleanNumber(rules.requiredOptionalCredits, { min: 0, max: 100000, allowEmpty: true }) || 0;
  const allowEssentialCreditsTowardOptional = rules.allowEssentialCreditsTowardOptional !== false && String(rules.allowEssentialCreditsTowardOptional) !== 'false';

  if (Math.abs(requiredMainCredits - totals.main) > 0.000001) {
    throw new Error('Required main credits must equal the total credits of all main subjects.');
  }
  if (requiredEssentialCredits > totals.essential) {
    throw new Error('Required essential credits cannot exceed the total available essential credits.');
  }

  const optionalCapacity = allowEssentialCreditsTowardOptional
    ? totals.optional + Math.max(0, totals.essential - requiredEssentialCredits)
    : totals.optional;
  if (requiredOptionalCredits > optionalCapacity) {
    throw new Error('Required optional credits exceed the available optional credit capacity under the current academic rule.');
  }

  return {
    requiredMainCredits: Number(requiredMainCredits.toFixed(2)),
    requiredEssentialCredits: Number(requiredEssentialCredits.toFixed(2)),
    requiredOptionalCredits: Number(requiredOptionalCredits.toFixed(2)),
    allowEssentialCreditsTowardOptional
  };
}

function cleanTermAcademicRules(v) {
  const rules = isPlainObject(v) ? v : {};
  const minimumPassingAverage = cleanNumber(rules.minimumPassingAverage, { min: 0, max: 100, allowEmpty: true });
  const minimumPassingScore = cleanNumber(rules.minimumPassingScore, { min: 0, max: 100, allowEmpty: true });
  const totalAllowedCredits = cleanNumber(rules.totalAllowedCredits, { min: 0, max: 100000, allowEmpty: true });
  const minimumRequiredCredits = cleanNumber(rules.minimumRequiredCredits, { min: 0, max: 100000, allowEmpty: true });
  const allowOverload = rules.allowOverload === true || String(rules.allowOverload) === 'true';
  const mustCompleteRequiredSubjects = rules.mustCompleteRequiredSubjects === undefined
    ? true
    : (rules.mustCompleteRequiredSubjects === true || String(rules.mustCompleteRequiredSubjects) === 'true');
  const notes = cleanString(rules.notes, { max: 500, allowEmpty: true });

  if (totalAllowedCredits !== null && minimumRequiredCredits !== null && minimumRequiredCredits > totalAllowedCredits) {
    throw new Error('Term minimum required credits cannot exceed total allowed credits.');
  }

  return {
    minimumPassingAverage,
    minimumPassingScore,
    totalAllowedCredits,
    minimumRequiredCredits,
    allowOverload,
    mustCompleteRequiredSubjects,
    notes
  };
}

function cleanProgramTermSnapshot(item, context = {}) {
  const snapshot = {
    termCode: cleanString(item.termCode || item.code, { max: 40, allowEmpty: true }).toUpperCase(),
    termName: cleanString(item.termName || item.name || item.title, { max: 120, allowEmpty: true }),
    status: cleanString(item.status, { max: 20, allowEmpty: true }).toLowerCase(),
    termDescription: cleanString(item.termDescription || item.description, { max: 5000, allowEmpty: true })
  };

  if (snapshot.status && !TERM_STATUSES.includes(snapshot.status)) {
    throw new Error('Invalid term status in program term snapshot.');
  }

  PROGRAM_TERM_SNAPSHOT_FIELDS.forEach((field) => {
    snapshot[field] = cleanDateISO(item[field], { allowEmpty: true });
  });

  const missingRequiredDateFields = REQUIRED_PROGRAM_TERM_DATE_FIELDS.filter((field) => !snapshot[field]);
  if (missingRequiredDateFields.length > 0) {
    const termRef = String(context?.termId || snapshot.termCode || snapshot.termName || '').trim();
    const termLabel = termRef ? ` for term "${termRef}"` : '';
    throw new Error(
      `Program term${termLabel} is missing required date fields: ${missingRequiredDateFields.join(', ')}.`
    );
  }

  if (snapshot.registrationOpenDate && snapshot.registrationCloseDate && snapshot.registrationCloseDate < snapshot.registrationOpenDate) {
    throw new Error('Program term registration close date cannot be earlier than registration open date.');
  }
  if (snapshot.classesStartDate && snapshot.classesEndDate && snapshot.classesEndDate < snapshot.classesStartDate) {
    throw new Error('Program term classes end date cannot be earlier than classes start date.');
  }
  if (snapshot.finalExamStartDate && snapshot.finalExamEndDate && snapshot.finalExamEndDate < snapshot.finalExamStartDate) {
    throw new Error('Program term final exam end date cannot be earlier than final exam start date.');
  }
  if (snapshot.withdrawWithoutPenaltyDeadline && snapshot.withdrawDeadline && snapshot.withdrawDeadline < snapshot.withdrawWithoutPenaltyDeadline) {
    throw new Error('Program term withdraw deadline cannot be earlier than withdraw without penalty deadline.');
  }
  if (snapshot.classesStartDate && snapshot.addDropDeadline && snapshot.addDropDeadline < snapshot.classesStartDate) {
    throw new Error('Program term add/drop deadline cannot be earlier than classes start date.');
  }
  if (snapshot.classesStartDate && snapshot.swapDeadline && snapshot.swapDeadline < snapshot.classesStartDate) {
    throw new Error('Program term swap deadline cannot be earlier than classes start date.');
  }
  if (snapshot.classesStartDate && snapshot.classesEndDate && snapshot.censusDate) {
    if (snapshot.censusDate < snapshot.classesStartDate || snapshot.censusDate > snapshot.classesEndDate) {
      throw new Error('Program term census date must fall within the class period.');
    }
  }

  return snapshot;
}

function cleanTerms(v) {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v)) throw new Error('terms must be an array.');
  if (v.length > 100) throw new Error('Too many terms in one program.');

  const termIdSet = new Set();
  const orderSet = new Set();

  return v.map((item, idx) => {
    if (!isPlainObject(item)) throw new Error('Each term entry must be an object.');
    const termId = cleanId(item.termId, { max: 64, allowEmpty: false });
    if (!termId) throw new Error('termId is required for each term entry.');
    if (termIdSet.has(termId)) throw new Error(`Duplicate termId in program terms: ${termId}`);
    termIdSet.add(termId);

    const order = cleanInteger(item.order, { min: 1, max: 500, allowEmpty: true }) || (idx + 1);
    if (orderSet.has(order)) throw new Error(`Duplicate term order detected: ${order}`);
    orderSet.add(order);

    return {
      termId,
      order,
      isRequired: item.isRequired === undefined ? true : Boolean(item.isRequired),
      termCode: cleanString(item.termCode, { max: 40, allowEmpty: true }).toUpperCase(),
      termName: cleanString(item.termName, { max: 120, allowEmpty: true }),
      status: cleanString(item.status, { max: 20, allowEmpty: true }).toLowerCase(),
      termDescription: cleanString(item.termDescription || item.description, { max: 5000, allowEmpty: true }),
      notes: cleanString(item.notes, { max: 500, allowEmpty: true }),
      registrationOpenDate: cleanDateISO(item.registrationOpenDate, { allowEmpty: true }),
      registrationCloseDate: cleanDateISO(item.registrationCloseDate, { allowEmpty: true }),
      lateRegistrationDeadline: cleanDateISO(item.lateRegistrationDeadline, { allowEmpty: true }),
      paymentDueDate: cleanDateISO(item.paymentDueDate, { allowEmpty: true }),
      classesStartDate: cleanDateISO(item.classesStartDate, { allowEmpty: true }),
      classesEndDate: cleanDateISO(item.classesEndDate, { allowEmpty: true }),
      addDropDeadline: cleanDateISO(item.addDropDeadline, { allowEmpty: true }),
      swapDeadline: cleanDateISO(item.swapDeadline, { allowEmpty: true }),
      withdrawWithoutPenaltyDeadline: cleanDateISO(item.withdrawWithoutPenaltyDeadline, { allowEmpty: true }),
      withdrawDeadline: cleanDateISO(item.withdrawDeadline, { allowEmpty: true }),
      censusDate: cleanDateISO(item.censusDate, { allowEmpty: true }),
      finalExamStartDate: cleanDateISO(item.finalExamStartDate, { allowEmpty: true }),
      finalExamEndDate: cleanDateISO(item.finalExamEndDate, { allowEmpty: true }),
      gradeSubmissionDeadline: cleanDateISO(item.gradeSubmissionDeadline, { allowEmpty: true }),
      termResultReleaseDate: cleanDateISO(item.termResultReleaseDate, { allowEmpty: true }),
      termAcademicRules: cleanTermAcademicRules(item.termAcademicRules),
      termRegistrationFeeGroups: cleanFeeGroups(item.termRegistrationFeeGroups || item.registrationFeeGroups)
    };
  }).map((item) => ({
    ...item,
    ...cleanProgramTermSnapshot(item, { termId: item.termId })
  })).sort((a, b) => a.order - b.order);
}

function normalizeProgramName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sanitizeProgramInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid program payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required for program records.');

  const name = cleanString(input.name, { max: 120, allowEmpty: false });
  if (!name) throw new Error('name is required.');

  const code = cleanString(input.code, { max: 40, allowEmpty: true }).toUpperCase();
  if (code && !/^[A-Z0-9_-]+$/.test(code)) {
    throw new Error('Invalid code format. Use letters, numbers, underscore, dash.');
  }

  const programAdministratorPersonId = cleanId(input.programAdministratorPersonId, { max: 64, allowEmpty: false });
  if (!programAdministratorPersonId) throw new Error('programAdministratorPersonId is required.');

  const duration = cleanDuration(input.duration);
  const credits = cleanNumber(input.credits, { min: 0, max: 10000, allowEmpty: false });
  const minimumPassingScore = cleanNumber(input.minimumPassingScore, { min: 0, max: 100, allowEmpty: false });
  const minimumPassingAverage = cleanNumber(input.minimumPassingAverage, { min: 0, max: 100, allowEmpty: false });
  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'active';

  if (!PROGRAM_STATUSES.has(status)) {
    throw new Error('Invalid status.');
  }

  const subjects = cleanSubjects(input.subjects);
  const academicRules = cleanAcademicRules(input.academicRules, subjects);

  const out = {
    orgId: String(orgId),
    name,
    code,
    description: cleanString(input.description, { max: 5000, allowEmpty: true }),
    departmentId: cleanId(input.departmentId, { max: 64, allowEmpty: true }) || '',
    departmentCode: cleanString(input.departmentCode, { max: 40, allowEmpty: true }).toUpperCase(),
    departmentName: cleanString(input.departmentName, { max: 160, allowEmpty: true }),
    programAdministratorPersonId: String(programAdministratorPersonId),
    duration,
    credits,
    minimumPassingScore,
    minimumPassingAverage,
    academicRules,
    feeGroups: cleanFeeGroups(input.feeGroups),
    postingPolicies: normalizePostingPolicyRows(input.postingPolicies),
    terms: cleanTerms(input.terms),
    subjects,
    status,
    notes: cleanString(input.notes, { max: 5000, allowEmpty: true })
  };

  const minimumRequiredCredits =
    academicRules.requiredMainCredits +
    academicRules.requiredEssentialCredits +
    academicRules.requiredOptionalCredits;
  if (credits < minimumRequiredCredits) {
    throw new Error('Program credits cannot be lower than the total required credits defined in Academic Rules.');
  }

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 40, allowEmpty: false });
  }

  return applyVoidMetadata(out, input);
}

function generateProgramId(existingIds) {
  for (let i = 0; i < 50; i++) {
    const candidate = `PRG${Math.floor(10000 + Math.random() * 90000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `PRG${Date.now()}`;
}

async function getAllPrograms() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve Programs');
  }
}

async function getProgramById(id) {
  const all = await getAllPrograms();
  return all.find((p) => String(p.id) === String(id)) || null;
}

async function addProgram(data) {
  return queueWrite(async () => {
    const all = await getAllPrograms();
    const sanitized = sanitizeProgramInput(data, { isUpdate: false });

    const duplicateName = all.some((p) => String(p.status || '').toLowerCase() !== 'void' &&
      String(p.orgId || '') === String(sanitized.orgId) &&
      normalizeProgramName(p.name) === normalizeProgramName(sanitized.name)
    );
    if (duplicateName) throw new Error('Program name already exists in this organization.');

    if (sanitized.code) {
      const duplicateCode = all.some((p) => String(p.status || '').toLowerCase() !== 'void' &&
        String(p.orgId) === String(sanitized.orgId) &&
        String(p.code || '').toUpperCase() === String(sanitized.code).toUpperCase()
      );
      if (duplicateCode) throw new Error('Program code already exists in this organization.');
    }

    const existingIds = new Set(all.map((p) => String(p.id)));
    const finalId = sanitized.id ? String(sanitized.id) : generateProgramId(existingIds);
    if (existingIds.has(finalId)) throw new Error('Program id already exists.');

    const newProgram = {
      ...sanitized,
      id: finalId,
      audit: { createDateTime: new Date().toISOString() }
    };

    all.push(newProgram);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return newProgram;
  });
}

async function updateProgram(id, data) {
  return queueWrite(async () => {
    const all = await getAllPrograms();
    const index = all.findIndex((p) => String(p.id) === String(id));
    if (index === -1) throw new Error('Program not found');

    const existing = all[index];
    const sanitized = sanitizeProgramInput(
      { ...data, orgId: existing.orgId || data?.orgId },
      { isUpdate: true }
    );

    if (existing.orgId && String(sanitized.orgId) !== String(existing.orgId)) {
      throw new Error('Security Violation: orgId mismatch.');
    }

    const duplicateName = all.some((p, i) => String(p.status || '').toLowerCase() !== 'void' &&
      i !== index &&
      String(p.orgId || '') === String(existing.orgId || sanitized.orgId) &&
      normalizeProgramName(p.name) === normalizeProgramName(sanitized.name)
    );
    if (duplicateName) throw new Error('Program name already exists in this organization.');

    if (sanitized.code) {
      const duplicateCode = all.some((p, i) => String(p.status || '').toLowerCase() !== 'void' &&
        i !== index &&
        String(p.orgId) === String(existing.orgId) &&
        String(p.code || '').toUpperCase() === String(sanitized.code).toUpperCase()
      );
      if (duplicateCode) throw new Error('Program code already exists in this organization.');
    }

    delete sanitized.id;
    sanitized.orgId = existing.orgId || sanitized.orgId;

    all[index] = {
      ...existing,
      ...sanitized,
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteProgram(id) {
  return queueWrite(async () => {
    let all = await getAllPrograms();
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
  getAllPrograms,
  getProgramById,
  addProgram,
  updateProgram,
  deleteProgram,
  PROGRAM_STATUSES: Object.freeze([...PROGRAM_STATUSES]),
  FEE_FREQUENCIES: Object.freeze([...FEE_FREQUENCIES]),
  ALL_FEE_CATEGORIES_KEY,
  SUBJECT_TYPES: Object.freeze([...SUBJECT_TYPES])
};


