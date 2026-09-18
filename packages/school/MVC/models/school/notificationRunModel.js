const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/notificationRuns.json');

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const RUN_STATUSES = Object.freeze(['pending', 'preview', 'completed', 'failed', 'cancelled']);
const RUN_TRIGGERS = Object.freeze(['manual', 'scheduled']);

function cleanString(value, { max = 8000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value) {
  const text = cleanString(value, { max: 120, allowEmpty: false });
  if (!text || !/^[A-Za-z0-9:_./-]+$/.test(text)) throw new Error('Invalid id format.');
  return text;
}

function generateRunId(existingIds = new Set()) {
  for (let i = 0; i < 50; i++) {
    const candidate = `SNRUN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SNRUN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function normalizeStatus(value, fallback = 'pending') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return RUN_STATUSES.includes(token) ? token : fallback;
}

function normalizeTrigger(value, fallback = 'manual') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return RUN_TRIGGERS.includes(token) ? token : fallback;
}

function sanitizeRunInput(input = {}, { isUpdate = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const now = new Date().toISOString();
  const out = {
    orgId: cleanString(source.orgId, { max: 120 }),
    ruleId: cleanString(source.ruleId, { max: 120 }),
    ruleType: cleanString(source.ruleType, { max: 80 }),
    ruleLabel: cleanString(source.ruleLabel, { max: 160 }),
    trigger: normalizeTrigger(source.trigger, 'manual'),
    status: normalizeStatus(source.status, 'pending'),
    asOfDate: cleanString(source.asOfDate, { max: 12 }),
    findingCount: Number(source.findingCount) || 0,
    batchCount: Number(source.batchCount) || 0,
    batches: Array.isArray(source.batches) ? source.batches.map(sanitizeBatchRow) : [],
    errorMessage: cleanString(source.errorMessage, { max: 2000, allowEmpty: true }),
    startedAt: source.startedAt || now,
    completedAt: cleanString(source.completedAt, { max: 40, allowEmpty: true })
  };
  if (!isUpdate) {
    out.audit = {
      createDateTime: now,
      createUserId: cleanString(source.auditUserId, { max: 120 })
    };
  }
  return out;
}

function sanitizeBatchRow(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanString(input.id, { max: 120, allowEmpty: true }) || `batch-${Math.random().toString(36).slice(2, 10)}`,
    recipientPersonId: cleanString(input.recipientPersonId, { max: 120 }),
    recipientName: cleanString(input.recipientName, { max: 160 }),
    itemCount: Number(input.itemCount) || (Array.isArray(input.items) ? input.items.length : 0),
    items: Array.isArray(input.items) ? input.items : [],
    preview: input.preview && typeof input.preview === 'object' ? input.preview : {},
    delivery: input.delivery && typeof input.delivery === 'object' ? input.delivery : {}
  };
}

async function getAllNotificationRuns() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const trimmed = String(data || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) return [];
    throw new Error('Failed to retrieve school notification runs.');
  }
}

async function saveAll(rows) {
  await queueWrite(async () => fs.writeFile(dataPath, JSON.stringify(Array.isArray(rows) ? rows : [], null, 2)));
}

async function getNotificationRunById(id) {
  const all = await getAllNotificationRuns();
  return all.find((row) => idsEqual(row?.id, id)) || null;
}

async function createNotificationRun(input = {}) {
  const all = await getAllNotificationRuns();
  const existingIds = new Set(all.map((row) => String(row?.id || '')));
  const row = {
    ...sanitizeRunInput(input, { isUpdate: false }),
    id: generateRunId(existingIds)
  };
  all.push(row);
  await saveAll(all);
  return row;
}

async function updateNotificationRun(id, patch = {}) {
  const targetId = cleanId(id);
  const all = await getAllNotificationRuns();
  const index = all.findIndex((row) => idsEqual(row?.id, targetId));
  if (index < 0) throw new Error('Notification run not found.');
  const prior = all[index];
  const row = {
    ...prior,
    ...patch,
    id: targetId,
    batches: Array.isArray(patch.batches) ? patch.batches.map(sanitizeBatchRow) : prior.batches
  };
  all[index] = row;
  await saveAll(all);
  return row;
}

async function deleteNotificationRun(id) {
  const targetId = cleanId(id);
  const all = await getAllNotificationRuns();
  const next = all.filter((row) => !idsEqual(row?.id, targetId));
  if (next.length === all.length) throw new Error('Notification run not found.');
  await saveAll(next);
  return true;
}

async function listNotificationRunsByOrg(orgId, { ruleId = '', limit = 50 } = {}) {
  const key = cleanString(orgId, { max: 120 });
  const all = await getAllNotificationRuns();
  let rows = all.filter((row) => idsEqual(row?.orgId, key));
  if (ruleId) rows = rows.filter((row) => idsEqual(row?.ruleId, ruleId));
  rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return rows.slice(0, max);
}

module.exports = {
  RUN_STATUSES,
  RUN_TRIGGERS,
  sanitizeRunInput,
  generateRunId,
  getAllNotificationRuns,
  getNotificationRunById,
  createNotificationRun,
  updateNotificationRun,
  deleteNotificationRun,
  listNotificationRunsByOrg,
  sanitizeBatchRow
};
