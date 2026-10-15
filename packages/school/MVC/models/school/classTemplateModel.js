const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { stripForbiddenSnapshotFields } = require('../../services/school/classTemplateSnapshotService');
const { assertTitlePatternAllowsNoDeliveryPlaceholder } = require('../../services/school/classTemplateNamingService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/classTemplates.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const TEMPLATE_STATUSES = new Set(['draft', 'active', 'archived']);

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

function sanitizeTemplateInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid class template payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const code = cleanString(input.code, { max: 40, allowEmpty: false }).toUpperCase();
  const name = cleanString(input.name, { max: 160, allowEmpty: false });
  const titlePattern = cleanString(input.titlePattern, { max: 160, allowEmpty: false });
  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';

  assertTitlePatternAllowsNoDeliveryPlaceholder(titlePattern);
  if (!TEMPLATE_STATUSES.has(status)) throw new Error('Invalid template status.');
  if (!/^[A-Z0-9_-]+$/.test(code)) throw new Error('Invalid template code format.');

  const snapshot = stripForbiddenSnapshotFields(input.snapshot || {});

  const out = {
    orgId,
    code,
    name,
    titlePattern,
    status,
    snapshot
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 40, allowEmpty: false });
  }

  if (input.audit && typeof input.audit === 'object') {
    out.audit = { ...input.audit };
  }

  return out;
}

function generateTemplateId(existingIds) {
  let id = '';
  do {
    id = `CLT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  } while (existingIds.has(id));
  return id;
}

async function getAllClassTemplates() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve class templates');
  }
}

async function getClassTemplateById(id) {
  const all = await getAllClassTemplates();
  return all.find((row) => String(row.id) === String(id));
}

function assertUniqueInOrg(list, candidate, { excludeId = null } = {}) {
  const orgId = String(candidate.orgId || '');
  const code = String(candidate.code || '').trim().toUpperCase();

  const duplicateCode = list.some((item) => {
    if (excludeId && String(item.id) === String(excludeId)) return false;
    return String(item.orgId || '') === orgId && String(item.code || '').trim().toUpperCase() === code;
  });
  if (duplicateCode) throw new Error('Template code already exists in this organization.');
}

async function addClassTemplate(input) {
  return await queueWrite(async () => {
    const list = await getAllClassTemplates();
    const item = sanitizeTemplateInput(input);
    item.id = item.id || generateTemplateId(new Set(list.map((row) => String(row.id || ''))));
    assertUniqueInOrg(list, item);
    list.push(item);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return item;
  });
}

async function updateClassTemplate(id, updates) {
  return await queueWrite(async () => {
    const list = await getAllClassTemplates();
    const index = list.findIndex((row) => String(row.id) === String(id));
    if (index === -1) throw new Error('Class template not found.');
    const merged = sanitizeTemplateInput({ ...list[index], ...updates, id: list[index].id }, { isUpdate: true });
    merged.id = list[index].id;
    if (list[index].audit) merged.audit = { ...list[index].audit, ...(updates.audit || {}) };
    assertUniqueInOrg(list, merged, { excludeId: id });
    list[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
    return merged;
  });
}

async function deleteClassTemplate(id) {
  return await queueWrite(async () => {
    const list = await getAllClassTemplates();
    const filtered = list.filter((row) => String(row.id) !== String(id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  TEMPLATE_STATUSES: Object.freeze([...TEMPLATE_STATUSES]),
  getAllClassTemplates,
  getClassTemplateById,
  addClassTemplate,
  updateClassTemplate,
  deleteClassTemplate,
  sanitizeTemplateInput
};
