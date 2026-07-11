const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/taskRoutingRules.json');

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const TASK_ROUTING_SOURCE_TYPES = Object.freeze(['leave_request', 'student_session_case', 'timesheet']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { max = 120, allowEmpty = false } = {}) {
  const text = cleanString(value, { max, allowEmpty });
  if (text === null) return null;
  if (!text) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_./-]+$/.test(text)) throw new Error('Invalid id format.');
  return text;
}

function normalizeSourceType(value, fallback = 'leave_request') {
  const token = cleanString(value, { max: 80, allowEmpty: true }).toLowerCase();
  return TASK_ROUTING_SOURCE_TYPES.includes(token) ? token : fallback;
}

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  const token = cleanString(value, { max: 20, allowEmpty: true }).toLowerCase();
  if (['true', '1', 'yes', 'on', 'active'].includes(token)) return true;
  if (['false', '0', 'no', 'off', 'inactive'].includes(token)) return false;
  return fallback;
}

function generateRoutingRuleId(existingIds = new Set()) {
  for (let i = 0; i < 50; i++) {
    const candidate = `SNR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SNR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sanitizeRoutingRuleInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid task routing rule payload.');
  const out = {
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: isUpdate }) || '',
    sourceType: normalizeSourceType(input.sourceType, 'leave_request'),
    active: normalizeBoolean(input.active, true),
    assigneePersonId: cleanId(input.assigneePersonId, { max: 120, allowEmpty: true }) || '',
    assigneePersonName: cleanString(input.assigneePersonName, { max: 160, allowEmpty: true }),
    label: cleanString(input.label, { max: 160, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true })
  };

  if (!isUpdate && !out.orgId) throw new Error('Organization is required.');
  if (!out.sourceType) throw new Error('Task source type is required.');
  if (input.id) out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  return out;
}

async function getAllTaskRoutingRules() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const trimmed = String(data || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      console.error('School task routing rules JSON parse error:', error.message);
      return [];
    }
    throw new Error('Failed to retrieve school task routing rules.');
  }
}

async function saveAll(rows) {
  const payload = JSON.stringify(Array.isArray(rows) ? rows : [], null, 2);
  await queueWrite(async () => fs.writeFile(dataPath, payload));
}

async function getTaskRoutingRuleById(id) {
  const all = await getAllTaskRoutingRules();
  return all.find((row) => idsEqual(row?.id, id)) || null;
}

async function addTaskRoutingRule(input) {
  const all = await getAllTaskRoutingRules();
  const existingIds = new Set(all.map((row) => cleanString(row?.id, { max: 120, allowEmpty: true })).filter(Boolean));
  const sanitized = sanitizeRoutingRuleInput(input, { isUpdate: false });
  const now = new Date().toISOString();
  const row = {
    ...sanitized,
    id: sanitized.id || generateRoutingRuleId(existingIds),
    audit: {
      createDateTime: now,
      lastUpdateDateTime: now,
      createdBy: cleanId(input?.audit?.createdBy || input?.createdBy, { max: 120, allowEmpty: true }) || '',
      updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { max: 120, allowEmpty: true }) || ''
    }
  };
  all.push(row);
  await saveAll(all);
  return row;
}

async function updateTaskRoutingRule(id, input) {
  const all = await getAllTaskRoutingRules();
  const idx = all.findIndex((row) => idsEqual(row?.id, id));
  if (idx === -1) return null;
  const existing = all[idx];
  const sanitized = sanitizeRoutingRuleInput(input, { isUpdate: true });
  const merged = {
    ...existing,
    ...Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== null && value !== undefined)),
    id: existing.id,
    audit: {
      ...(existing.audit || {}),
      lastUpdateDateTime: new Date().toISOString(),
      updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { max: 120, allowEmpty: true }) || existing.audit?.updatedBy || ''
    }
  };
  all[idx] = merged;
  await saveAll(all);
  return merged;
}

async function deleteTaskRoutingRule(id) {
  const all = await getAllTaskRoutingRules();
  const before = all.length;
  const kept = all.filter((row) => !idsEqual(row?.id, id));
  if (kept.length === before) return false;
  await saveAll(kept);
  return true;
}

async function clearTaskRoutingRulesByOrg(orgId) {
  const all = await getAllTaskRoutingRules();
  const kept = all.filter((row) => !idsEqual(row?.orgId, orgId));
  if (kept.length === all.length) return 0;
  await saveAll(kept);
  return all.length - kept.length;
}

module.exports = {
  TASK_ROUTING_SOURCE_TYPES,
  sanitizeRoutingRuleInput,
  getAllTaskRoutingRules,
  getTaskRoutingRuleById,
  addTaskRoutingRule,
  updateTaskRoutingRule,
  deleteTaskRoutingRule,
  clearTaskRoutingRulesByOrg
};
