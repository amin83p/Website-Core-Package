const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/notifications.json');

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const NOTIFICATION_STATUSES = Object.freeze(['open', 'in_progress', 'resolved', 'dismissed']);
const NOTIFICATION_SEVERITIES = Object.freeze(['info', 'warning', 'urgent', 'error']);
const NOTIFICATION_SOURCE_TYPES = Object.freeze(['leave_request', 'timesheet', 'manual']);
const NOTIFICATION_TASK_STATUSES = Object.freeze(['open', 'in_progress', 'done', 'cancelled']);

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

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return text;
}

function normalizeEnum(value, allowed, fallback) {
  const token = cleanString(value, { max: 80, allowEmpty: true }).toLowerCase();
  return allowed.includes(token) ? token : fallback;
}

function normalizeStatus(value, fallback = 'open') {
  return normalizeEnum(value, NOTIFICATION_STATUSES, fallback);
}

function normalizeSeverity(value, fallback = 'info') {
  return normalizeEnum(value, NOTIFICATION_SEVERITIES, fallback);
}

function normalizeSourceType(value, fallback = 'manual') {
  return normalizeEnum(value, NOTIFICATION_SOURCE_TYPES, fallback);
}

function normalizeTaskStatus(value, fallback = 'open') {
  return normalizeEnum(value, NOTIFICATION_TASK_STATUSES, fallback);
}

function generateNotificationId(existingIds = new Set()) {
  for (let i = 0; i < 50; i++) {
    const candidate = `SN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateTaskId(existingIds = new Set()) {
  for (let i = 0; i < 50; i++) {
    const candidate = `SNT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SNT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sanitizeLifecycleEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      at: cleanString(event?.at, { max: 40, allowEmpty: true }) || new Date().toISOString(),
      action: cleanString(event?.action, { max: 80, allowEmpty: true }),
      actorId: cleanId(event?.actorId, { max: 120, allowEmpty: true }) || '',
      actorName: cleanString(event?.actorName, { max: 160, allowEmpty: true }),
      oldStatus: cleanString(event?.oldStatus, { max: 40, allowEmpty: true }),
      newStatus: cleanString(event?.newStatus, { max: 40, allowEmpty: true }),
      note: cleanString(event?.note, { max: 1000, allowEmpty: true }),
      snapshot: isPlainObject(event?.snapshot) ? event.snapshot : {}
    }))
    .filter((event) => event.action || event.oldStatus || event.newStatus);
}

function sanitizeTasks(tasks, { existingTasks = [] } = {}) {
  const existingIds = new Set((existingTasks || []).map((task) => cleanString(task?.id, { max: 120, allowEmpty: true })).filter(Boolean));
  return (Array.isArray(tasks) ? tasks : [])
    .map((task) => {
      const id = cleanId(task?.id, { max: 120, allowEmpty: true }) || generateTaskId(existingIds);
      existingIds.add(id);
      return {
        id,
        title: cleanString(task?.title, { max: 220, allowEmpty: true }) || 'Review notification',
        description: cleanString(task?.description, { max: 2000, allowEmpty: true }),
        status: normalizeTaskStatus(task?.status, 'open'),
        assignedRole: cleanString(task?.assignedRole, { max: 120, allowEmpty: true }),
        assignedPersonId: cleanId(task?.assignedPersonId, { max: 120, allowEmpty: true }) || '',
        assignedPersonName: cleanString(task?.assignedPersonName, { max: 160, allowEmpty: true }),
        dueDate: cleanDateOnly(task?.dueDate, { allowEmpty: true }) || '',
        note: cleanString(task?.note, { max: 1000, allowEmpty: true }),
        createdAt: cleanString(task?.createdAt, { max: 40, allowEmpty: true }) || new Date().toISOString(),
        updatedAt: cleanString(task?.updatedAt, { max: 40, allowEmpty: true }),
        assignedAt: cleanString(task?.assignedAt, { max: 40, allowEmpty: true }),
        startedAt: cleanString(task?.startedAt, { max: 40, allowEmpty: true }),
        reassignedAt: cleanString(task?.reassignedAt, { max: 40, allowEmpty: true }),
        completedAt: cleanString(task?.completedAt, { max: 40, allowEmpty: true })
      };
    });
}

function sanitizeNotificationInput(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid notification payload.');

  const out = {
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: isUpdate }) || '',
    sourceType: normalizeSourceType(input.sourceType, 'manual'),
    sourceId: cleanId(input.sourceId, { max: 120, allowEmpty: true }) || '',
    sourceUrl: cleanString(input.sourceUrl, { max: 500, allowEmpty: true }),
    title: cleanString(input.title, { max: 220, allowEmpty: true }),
    message: cleanString(input.message, { max: 5000, allowEmpty: true }),
    severity: normalizeSeverity(input.severity, 'info'),
    status: normalizeStatus(input.status, 'open'),
    dueDate: cleanDateOnly(input.dueDate, { allowEmpty: true }) || '',
    assignedRole: cleanString(input.assignedRole, { max: 120, allowEmpty: true }),
    assignedPersonId: cleanId(input.assignedPersonId, { max: 120, allowEmpty: true }) || '',
    assignedPersonName: cleanString(input.assignedPersonName, { max: 160, allowEmpty: true }),
    visibilityScope: cleanString(input.visibilityScope, { max: 120, allowEmpty: true }) || 'section_access',
    lifecycle: sanitizeLifecycleEvents(input.lifecycle),
    tasks: sanitizeTasks(input.tasks, { existingTasks: existing?.tasks || [] }),
    metadata: isPlainObject(input.metadata) ? input.metadata : {},
    resolvedAt: cleanString(input.resolvedAt, { max: 40, allowEmpty: true }),
    resolvedBy: cleanId(input.resolvedBy, { max: 120, allowEmpty: true }) || '',
    resolvedByName: cleanString(input.resolvedByName, { max: 160, allowEmpty: true }),
    revisionNo: Number.isFinite(Number(input.revisionNo)) ? Math.max(1, Math.floor(Number(input.revisionNo))) : 1
  };

  if (!isUpdate) {
    if (!out.orgId) throw new Error('Organization is required.');
    if (!out.title) throw new Error('Notification title is required.');
  }

  if (input.id) out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  return out;
}

async function getAllNotifications() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const trimmed = String(data || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      console.error('School notification JSON parse error:', error.message);
      return [];
    }
    throw new Error('Failed to retrieve school notifications.');
  }
}

async function saveAll(rows) {
  const payload = JSON.stringify(Array.isArray(rows) ? rows : [], null, 2);
  await queueWrite(async () => fs.writeFile(dataPath, payload));
}

async function getNotificationById(id) {
  const all = await getAllNotifications();
  return all.find((row) => idsEqual(row?.id, id)) || null;
}

async function addNotification(input) {
  const all = await getAllNotifications();
  const existingIds = new Set(all.map((row) => cleanString(row?.id, { max: 120, allowEmpty: true })).filter(Boolean));
  const sanitized = sanitizeNotificationInput(input, { isUpdate: false });
  const now = new Date().toISOString();
  const row = {
    ...sanitized,
    id: sanitized.id || generateNotificationId(existingIds),
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

async function updateNotification(id, input) {
  const all = await getAllNotifications();
  const idx = all.findIndex((row) => idsEqual(row?.id, id));
  if (idx === -1) return null;
  const existing = all[idx];
  const sanitized = sanitizeNotificationInput(input, { isUpdate: true, existing });
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
  if (input?.status !== undefined) merged.status = normalizeStatus(input.status, existing.status || 'open');
  if (input?.tasks !== undefined) merged.tasks = sanitized.tasks;
  if (input?.lifecycle !== undefined) merged.lifecycle = sanitized.lifecycle;
  all[idx] = merged;
  await saveAll(all);
  return merged;
}

async function deleteNotification(id) {
  const all = await getAllNotifications();
  const before = all.length;
  const kept = all.filter((row) => !idsEqual(row?.id, id));
  if (kept.length === before) return false;
  await saveAll(kept);
  return true;
}

async function clearNotificationsByOrg(orgId) {
  const all = await getAllNotifications();
  const kept = all.filter((row) => !idsEqual(row?.orgId, orgId));
  if (kept.length === all.length) return 0;
  await saveAll(kept);
  return all.length - kept.length;
}

module.exports = {
  NOTIFICATION_STATUSES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SOURCE_TYPES,
  NOTIFICATION_TASK_STATUSES,
  sanitizeNotificationInput,
  sanitizeTasks,
  getAllNotifications,
  getNotificationById,
  addNotification,
  updateNotification,
  deleteNotification,
  clearNotificationsByOrg
};
