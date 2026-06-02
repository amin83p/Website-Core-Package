const { requireCoreModule, resolveCoreRoot } = requireCoreModule('MVC/services/school/schoolCoreModuleResolver');
// MVC/models/school/subjectModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/MVC/models/fileQueue'); 
const { isValidFeeCategory } = require('./feeCategoryCatalog');
const fileAssetStorage = requireCoreModule('MVC/MVC/services/fileAssetStorageService');
const uploadFolderSettingsService = requireCoreModule('MVC/MVC/services/uploadFolderSettingsService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/subjects.json');
const legacyStorageBasePath = path.join(resolveCoreRoot(), 'data/school/subjects_storage');

async function getAllSubjects() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve subjects');
  }
}

async function getSubjectById(id) {
  const list = await getAllSubjects();
  return list.find(s => String(s.id) === String(id));
}

// UPDATED: Now generates ID strictly based on the Department Code
function generateSubjectId(deptCode) {
  const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
  const dCode = (deptCode || 'XXX').toUpperCase();
  return `SUB-${dCode}-${randomStr}`;
}

async function createSubjectWorkspace(subject) {
  const scopeKey = subject.orgId || 'GLOBAL';
  const relativeDir = uploadFolderSettingsService.resolveUploadFolder('school.subjectWorkspace', {
    subjectId: subject.id
  });
  subject.uploadWorkspace = {
    scopeKey: fileAssetStorage.normalizeScopeKey(scopeKey),
    relativePath: relativeDir
  };
  
  await fileAssetStorage.ensureDirectory(scopeKey, relativeDir);
  await fileAssetStorage.ensureDirectory(scopeKey, `${relativeDir}/sessions`);
  await fileAssetStorage.ensureDirectory(scopeKey, `${relativeDir}/media`);
  await fileAssetStorage.ensureDirectory(scopeKey, `${relativeDir}/attachments`);

  const initialStructure = {
    subjectId: subject.id,
    code: subject.code,
    title: subject.title,
    createdOn: subject.audit.createDateTime,
    folders: {
      "sessions": "Contains session-specific materials",
      "media": "Contains images, videos, and global subject media",
      "attachments": "Contains general syllabi and reading lists"
    },
    files: []
  };

  await fileAssetStorage.saveJson({ scopeKey, relativeDir, fileName: 'structure.json', data: initialStructure });
}

function getSubjectWorkspaceCandidates(subject = {}) {
  const subjectId = String(subject?.id || '').trim();
  const stored = String(subject?.uploadWorkspace?.relativePath || '').trim();
  const candidates = [
    stored,
    subjectId ? uploadFolderSettingsService.resolveDefaultUploadFolder('school.subjectWorkspace', { subjectId }) : '',
    subjectId ? uploadFolderSettingsService.resolveUploadFolder('school.subjectWorkspace', { subjectId }) : ''
  ].filter(Boolean);
  return [...new Set(candidates)];
}

// UPDATED: Validates against the selected Department
function validateData(item) {
  const errors = [];
  if (!item.orgId) errors.push('Organization Association (orgId) is required.');
  if (!item.title) errors.push('Subject Title is required.');
  if (!item.academicUnit || !item.academicUnit.departmentId) errors.push('Department selection is required.');
  
  return errors.length ? { isValid: false, errors } : { isValid: true };
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) throw new Error('Fee amount must be a valid non-negative number.');
  return Number(num.toFixed(2));
}

function cleanDateOnly(value, { allowEmpty = false } = {}) {
  const s = String(value || '').trim();
  if (!s) {
    if (allowEmpty) return '';
    throw new Error('Fee rule date is required.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Fee rule dates must use YYYY-MM-DD.');
  return s;
}

function normalizeDefaultScoreRules(inputRules) {
  const rules = (inputRules && typeof inputRules === 'object' && !Array.isArray(inputRules)) ? inputRules : {};
  const minPassingScore = rules.minPassingScore === '' || rules.minPassingScore === undefined || rules.minPassingScore === null
    ? null
    : Number(rules.minPassingScore);
  const minPassingAverage = rules.minPassingAverage === '' || rules.minPassingAverage === undefined || rules.minPassingAverage === null
    ? null
    : Number(rules.minPassingAverage);

  if (minPassingScore !== null && (!Number.isFinite(minPassingScore) || minPassingScore < 0 || minPassingScore > 100)) {
    throw new Error('Default minimum passing score must be between 0 and 100.');
  }
  if (minPassingAverage !== null && (!Number.isFinite(minPassingAverage) || minPassingAverage < 0 || minPassingAverage > 100)) {
    throw new Error('Default minimum passing average must be between 0 and 100.');
  }

  return {
    minPassingScore,
    minPassingAverage,
    mustPass: rules.mustPass === true || String(rules.mustPass) === 'true',
    allowCompensation: rules.allowCompensation === true || String(rules.allowCompensation) === 'true',
    notes: String(rules.notes || '').trim()
  };
}

function normalizeFeeRules(inputRules) {
  if (!Array.isArray(inputRules)) return [];

  return inputRules
    .map((rule, index) => {
      if (!rule || typeof rule !== 'object') return null;
      const feeCategory = String(rule.feeCategory || '').trim();
      const amountRaw = String(rule.amount ?? '').trim();
      const validFromRaw = String(rule.validFrom || '').trim();
      const validToRaw = String(rule.validTo || '').trim();
      const currency = String(rule.currency || 'CAD').trim().toUpperCase() || 'CAD';
      const notes = String(rule.notes || '').trim();
      const active = rule.active !== false && String(rule.active) !== 'false';

      if (!feeCategory && !amountRaw && !validFromRaw && !validToRaw && !notes) return null;
      if (!feeCategory) throw new Error(`Fee rule #${index + 1}: fee category is required.`);
      if (!isValidFeeCategory(feeCategory, { includeAll: true })) throw new Error(`Fee rule #${index + 1}: invalid fee category.`);

      const amount = cleanMoney(amountRaw);
      const validFrom = cleanDateOnly(validFromRaw);
      const validTo = cleanDateOnly(validToRaw, { allowEmpty: true });
      if (validTo && validTo < validFrom) throw new Error(`Fee rule #${index + 1}: validTo cannot be before validFrom.`);

      return {
        feeCategory,
        amount,
        currency,
        validFrom,
        validTo,
        notes,
        active
      };
    })
    .filter(Boolean);
}

function assertUniqueInOrg(allSubjects, candidate, { excludeId = null } = {}) {
  const candidateOrgId = String(candidate.orgId || '');
  const candidateCode = normalizeCode(candidate.code);
  const candidateTitle = normalizeTitle(candidate.title);

  if (candidateCode) {
    const duplicateCode = allSubjects.some((s) => {
      if (excludeId && String(s.id) === String(excludeId)) return false;
      return String(s.orgId || '') === candidateOrgId && normalizeCode(s.code) === candidateCode;
    });
    if (duplicateCode) throw new Error('Subject code already exists in this organization.');
  }

  const duplicateTitle = allSubjects.some((s) => {
    if (excludeId && String(s.id) === String(excludeId)) return false;
    return String(s.orgId || '') === candidateOrgId && normalizeTitle(s.title) === candidateTitle;
  });
  if (duplicateTitle) throw new Error('Subject title already exists in this organization.');
}

async function addSubject(item) {
  return await queueWrite(async () => {
    const list = await getAllSubjects();
    
    // Generate the academic-aware ID using the linked Department Code
    const dCode = item.academicUnit?.departmentCode;
    item.id = generateSubjectId(dCode);
    item.feeRules = normalizeFeeRules(item.feeRules);
    item.defaultScoreRules = normalizeDefaultScoreRules(item.defaultScoreRules);
    
    const validity = validateData(item);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));
    assertUniqueInOrg(list, item);

    await createSubjectWorkspace(item);

    list.push(item);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return item;
  });
}

async function updateSubject(id, updates) {
  return await queueWrite(async () => {
    const list = await getAllSubjects();
    const index = list.findIndex(s => String(s.id) === String(id));
    if (index === -1) throw new Error('Subject not found');

    const current = list[index];
    const merged = { ...current, ...updates };
    merged.feeRules = normalizeFeeRules(merged.feeRules);
    merged.defaultScoreRules = normalizeDefaultScoreRules(merged.defaultScoreRules);

    const validity = validateData(merged);
    if (!validity.isValid) throw new Error(validity.errors.join('\n'));
    assertUniqueInOrg(list, merged, { excludeId: current.id });

    list[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return list[index];
  });
}

async function deleteSubject(id) {
  await queueWrite(async () => {
    const list = await getAllSubjects();
    const filtered = list.filter(s => String(s.id) !== String(id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

/**
 * Deletes subject upload workspaces for every subject row in this org.
 * Does not remove subject definitions from subjects.json.
 */
async function clearStorageByOrg(orgId, options = {}) {
  void options;
  return await queueWrite(async () => {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId) throw new Error('orgId is required to clear subject storage.');

    const subjects = await getAllSubjects();
    let removedDirs = 0;
    const errors = [];

    for (const s of subjects) {
      if (String(s?.orgId || '') !== targetOrgId) continue;
      try {
        for (const relativePath of getSubjectWorkspaceCandidates(s)) {
          // eslint-disable-next-line no-await-in-loop
          if (await fileAssetStorage.deleteRelativePath({ scopeKey: targetOrgId, relativePath })) {
            removedDirs += 1;
          }
        }
      } catch (err) {
        errors.push(`${s.id}: ${String(err?.message || err)}`);
      }
      try {
        const legacyDir = path.join(legacyStorageBasePath, String(s.id));
        await fs.rm(legacyDir, { recursive: true, force: true });
      } catch (_) {
        // Legacy cleanup is best effort.
      }
    }

    return { removedDirs, errors };
  });
}

module.exports = {
  getAllSubjects,
  getSubjectById,
  addSubject,
  updateSubject,
  deleteSubject,
  clearStorageByOrg,
  normalizeDefaultScoreRules
};
