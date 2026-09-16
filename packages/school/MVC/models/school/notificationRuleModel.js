const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/notificationRules.json');

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const SESSION_DATE_RANGE_TYPES = Object.freeze([
  'this_week',
  'two_weeks',
  'this_month',
  'days_before_today',
  'timesheet_period'
]);

function formatNotificationTokenLabel(value) {
  const text = cleanString(value, { max: 200, allowEmpty: true });
  if (!text) return '';
  return text
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const NOTIFICATION_RULE_TYPES = Object.freeze([
  'session_not_final',
  'session_attendance_incomplete',
  'timesheet_not_submitted'
]);

const LEGACY_SESSION_RULE_KEY = 'legacy_session_not_final';

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

function normalizeRuleType(value, fallback = 'session_not_final') {
  const token = cleanString(value, { max: 80, allowEmpty: true }).toLowerCase();
  return NOTIFICATION_RULE_TYPES.includes(token) ? token : fallback;
}

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  const token = cleanString(value, { max: 20, allowEmpty: true }).toLowerCase();
  if (['true', '1', 'yes', 'on', 'active'].includes(token)) return true;
  if (['false', '0', 'no', 'off', 'inactive'].includes(token)) return false;
  return fallback;
}

function normalizeChannelBlock(raw = {}) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    enabled: normalizeBoolean(input.enabled, false),
    sendWhen: cleanString(input.sendWhen, { max: 40, allowEmpty: true }) || 'same_day',
    prepareAtTime: cleanString(input.prepareAtTime || input.sendAtTime, { max: 8, allowEmpty: true }).slice(0, 5) || '17:00',
    sendAtTime: cleanString(input.sendAtTime, { max: 8, allowEmpty: true }).slice(0, 5) || '18:00',
    sessionDateRange: isPlainObject(input.sessionDateRange) ? {
      type: cleanString(input.sessionDateRange.type, { max: 40, allowEmpty: true }) || 'this_week',
      daysBeforeToday: input.sessionDateRange.daysBeforeToday
    } : { type: 'this_week', daysBeforeToday: null },
    emailTemplateId: cleanId(input.emailTemplateId, { max: 120, allowEmpty: true }) || '',
    emailTemplateName: cleanString(input.emailTemplateName, { max: 200, allowEmpty: true }),
    smsTemplateId: cleanId(input.smsTemplateId, { max: 120, allowEmpty: true }) || '',
    smsTemplateName: cleanString(input.smsTemplateName, { max: 200, allowEmpty: true })
  };
}

function normalizeChannels(raw = {}) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    email: normalizeChannelBlock(input.email),
    sms: normalizeChannelBlock(input.sms)
  };
}

function normalizeCriteria(raw = {}, ruleType = 'session_not_final') {
  const input = isPlainObject(raw) ? raw : {};
  const base = {
    sessionDateRange: isPlainObject(input.sessionDateRange) ? input.sessionDateRange : { type: 'this_week' },
    includeLockedSessions: normalizeBoolean(input.includeLockedSessions, false),
    timesheetPeriodId: cleanId(input.timesheetPeriodId, { max: 120, allowEmpty: true }) || '',
    submissionDeadlineDate: cleanString(input.submissionDeadlineDate, { max: 12, allowEmpty: true }),
    minUnmarkedCount: Number.isFinite(Number(input.minUnmarkedCount)) ? Math.max(1, Number(input.minUnmarkedCount)) : 1
  };
  if (ruleType === 'timesheet_not_submitted') {
    return {
      timesheetPeriodId: base.timesheetPeriodId,
      submissionDeadlineDate: base.submissionDeadlineDate,
      statuses: Array.isArray(input.statuses) ? input.statuses.map((s) => cleanString(s, { max: 40 })).filter(Boolean) : ['draft', 'not_started']
    };
  }
  if (ruleType === 'session_attendance_incomplete') {
    return {
      sessionDateRange: base.sessionDateRange,
      includeLockedSessions: base.includeLockedSessions,
      minUnmarkedCount: base.minUnmarkedCount
    };
  }
  return {
    sessionDateRange: base.sessionDateRange,
    includeLockedSessions: base.includeLockedSessions
  };
}

function generateRuleId(existingIds = new Set()) {
  for (let i = 0; i < 50; i++) {
    const candidate = `SNCR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SNCR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sanitizeRuleInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid notification rule payload.');
  const ruleType = normalizeRuleType(input.ruleType, 'session_not_final');
  const out = {
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: isUpdate }) || '',
    label: cleanString(input.label, { max: 160, allowEmpty: true }) || 'Notification rule',
    ruleType,
    enabled: normalizeBoolean(input.enabled, true),
    legacyKey: cleanString(input.legacyKey, { max: 80, allowEmpty: true }),
    criteria: normalizeCriteria(input.criteria, ruleType),
    channels: normalizeChannels(input.channels),
    schedule: {
      timezone: cleanString(input.schedule?.timezone, { max: 80, allowEmpty: true }),
      autoQueueOnSchedule: normalizeBoolean(input.schedule?.autoQueueOnSchedule, false)
    },
    alsoCreateTask: normalizeBoolean(input.alsoCreateTask, false)
  };
  if (!isUpdate && !out.orgId) throw new Error('Organization is required.');
  if (input.id) out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  return out;
}

async function getAllNotificationRules() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const trimmed = String(data || '').trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      console.error('School notification rules JSON parse error:', error.message);
      return [];
    }
    throw new Error('Failed to retrieve school notification rules.');
  }
}

async function saveAll(rows) {
  const payload = JSON.stringify(Array.isArray(rows) ? rows : [], null, 2);
  await queueWrite(async () => fs.writeFile(dataPath, payload));
}

async function getNotificationRuleById(id) {
  const all = await getAllNotificationRules();
  return all.find((row) => idsEqual(row?.id, id)) || null;
}

async function addNotificationRule(input, auditUserId = '') {
  const sanitized = sanitizeRuleInput(input, { isUpdate: false });
  const all = await getAllNotificationRules();
  const existingIds = new Set(all.map((row) => String(row?.id || '')));
  const now = new Date().toISOString();
  const row = {
    ...sanitized,
    id: generateRuleId(existingIds),
    audit: {
      createDateTime: now,
      createUserId: cleanString(auditUserId, { max: 120 }),
      lastUpdateDateTime: now,
      lastUpdateUserId: cleanString(auditUserId, { max: 120 })
    }
  };
  all.push(row);
  await saveAll(all);
  return row;
}

async function updateNotificationRule(id, input, auditUserId = '') {
  const targetId = cleanId(id, { max: 120, allowEmpty: false });
  const sanitized = sanitizeRuleInput({ ...input, id: targetId }, { isUpdate: true });
  const all = await getAllNotificationRules();
  const index = all.findIndex((row) => idsEqual(row?.id, targetId));
  if (index < 0) throw new Error('Notification rule not found.');
  const now = new Date().toISOString();
  const prior = all[index];
  const row = {
    ...prior,
    ...sanitized,
    id: targetId,
    orgId: sanitized.orgId || prior.orgId,
    audit: {
      ...(prior.audit || {}),
      lastUpdateDateTime: now,
      lastUpdateUserId: cleanString(auditUserId, { max: 120 })
    }
  };
  all[index] = row;
  await saveAll(all);
  return row;
}

async function deleteNotificationRule(id) {
  const targetId = cleanId(id, { max: 120, allowEmpty: false });
  const all = await getAllNotificationRules();
  const next = all.filter((row) => !idsEqual(row?.id, targetId));
  if (next.length === all.length) throw new Error('Notification rule not found.');
  await saveAll(next);
  return true;
}

async function listNotificationRulesByOrg(orgId) {
  const key = cleanId(orgId, { max: 120, allowEmpty: false });
  const all = await getAllNotificationRules();
  return all.filter((row) => idsEqual(row?.orgId, key));
}

module.exports = {
  NOTIFICATION_RULE_TYPES,
  SESSION_DATE_RANGE_TYPES,
  formatNotificationTokenLabel,
  LEGACY_SESSION_RULE_KEY,
  sanitizeRuleInput,
  normalizeChannels,
  normalizeCriteria,
  getAllNotificationRules,
  getNotificationRuleById,
  addNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
  listNotificationRulesByOrg
};
