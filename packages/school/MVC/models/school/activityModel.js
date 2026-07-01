const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/activities.json');
const ACTIVITY_STATUSES = new Set(['draft', 'posted', 'cancelled']);
const ATTENDANCE_STATUSES = new Set(['attended', 'absent', 'excused']);
const ACTIVITY_VISIBILITY_SCOPES = new Set(['school', 'individual']);

if (!fsSync.existsSync(dataPath)) {
  fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  fsSync.writeFileSync(dataPath, '[]');
}

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanId(value, { max = 80, allowEmpty = false } = {}) {
  const out = cleanString(value, { max, allowEmpty });
  if (out === null) return null;
  if (!out) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(out)) throw new Error('Invalid id format.');
  return out;
}

function cleanDate(value) {
  const out = cleanString(value, { max: 20, allowEmpty: false });
  if (!out) throw new Error('Activity date is required.');
  if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  const parsed = new Date(out);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid activity date.');
  return parsed.toISOString().slice(0, 10);
}

function cleanTime(value, { allowEmpty = false } = {}) {
  const out = cleanString(value, { max: 5, allowEmpty });
  if (!out) return allowEmpty ? '' : null;
  if (!/^\d{2}:\d{2}$/.test(out)) throw new Error('Time must use HH:mm.');
  const [hour, minute] = out.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new Error('Time must use HH:mm.');
  return out;
}

function cleanHours(value, { allowZero = true } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if ((!allowZero && n <= 0) || n < 0 || n > 24) throw new Error('Hours value is out of allowed range.');
  return Number(n.toFixed(2));
}

function generateId() {
  return `ACT-${Math.floor(100000 + Math.random() * 900000)}`;
}

function generateEntryId(index = 0) {
  return `ENTRY-${index + 1}`;
}

function calculateDurationHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = (sh * 60) + sm;
  const end = (eh * 60) + em;
  if (end <= start) return 0;
  return Number(((end - start) / 60).toFixed(2));
}

function normalizeActivityVisibilityScope(value) {
  const raw = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return 'school';
  if (['school', 'public', 'global', 'organization', 'org', 'all', 'school_scope', 'school_public', 'public_school', 'schoolwide', 'school_wide'].includes(raw)) return 'school';
  if (['individual', 'private', 'personal', 'assigned', 'assigned_only', 'attendee', 'attendees', 'attendees_only'].includes(raw)) return 'individual';
  if (!ACTIVITY_VISIBILITY_SCOPES.has(raw)) throw new Error('Invalid activity calendar scope.');
  return raw;
}

function sanitizeAttendee(input = {}, activityPaid = false, durationHours = 0) {
  const personId = cleanId(input.personId || input.id, { allowEmpty: false });
  const personName = cleanString(input.personName || input.displayName || input.name, { max: 180, allowEmpty: true });
  const role = cleanString(input.role || input.personRole || input.matchedRole || 'participant', { max: 40, allowEmpty: true }).toLowerCase() || 'participant';
  const rolesSource = Array.isArray(input.roles)
    ? input.roles
    : String(input.roles || input.availableRoles || role || '').split(',');
  const roles = [...new Set(rolesSource
    .map((value) => cleanString(
      typeof value === 'string' ? value : (value?.key || value?.role || value?.name || value?.label),
      { max: 40, allowEmpty: true }
    ).toLowerCase())
    .filter(Boolean))];
  if (role && !roles.includes(role)) roles.unshift(role);
  const status = cleanString(input.status || 'attended', { max: 40, allowEmpty: true }).toLowerCase() || 'attended';
  if (!personId) throw new Error('Attendee person is required.');
  if (!ATTENDANCE_STATUSES.has(status)) throw new Error('Invalid attendee status.');
  const paid = input.paid === undefined ? Boolean(activityPaid) : (input.paid === true || input.paid === 'true' || input.paid === 'on');
  const paidHours = cleanHours(input.paidHours === undefined || input.paidHours === '' ? durationHours : input.paidHours);
  return {
    personId,
    personName,
    roles: roles.length ? roles : [role],
    role,
    status,
    paid,
    paidHours,
    notes: cleanString(input.notes, { max: 500, allowEmpty: true })
  };
}

function parseJsonArray(value, fieldName = 'value') {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function sanitizeActivityEntry(input = {}, context = {}) {
  const activityPaid = Boolean(context.activityPaid);
  const index = Number.isInteger(context.index) ? context.index : 0;
  const date = cleanDate(input.date || input.activityDate || input.startDate);
  const startTime = cleanTime(input.startTime);
  const endTime = cleanTime(input.endTime);
  const derivedDuration = calculateDurationHours(startTime, endTime);
  const durationHours = cleanHours(input.durationHours || derivedDuration, { allowZero: false });
  const status = cleanString(input.status || 'posted', { max: 30, allowEmpty: true }).toLowerCase() || 'posted';
  if (!ACTIVITY_STATUSES.has(status)) throw new Error('Invalid activity session status.');
  const assigneesSource = Array.isArray(input.assignees)
    ? input.assignees
    : parseJsonArray(input.assignees, 'Activity session assignees');
  const fallbackAttendees = Array.isArray(input.attendees)
    ? input.attendees
    : parseJsonArray(input.attendees, 'Activity session attendees');
  const assignees = (assigneesSource.length ? assigneesSource : fallbackAttendees)
    .map((row) => sanitizeAttendee(row, activityPaid, durationHours));
  return {
    entryId: cleanId(input.entryId || input.id || generateEntryId(index), { allowEmpty: false }),
    title: cleanString(input.title, { max: 180, allowEmpty: true }),
    date,
    startTime,
    endTime,
    durationHours,
    location: cleanString(input.location, { max: 180, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 1200, allowEmpty: true }),
    status,
    assignees
  };
}

function buildLegacyActivityEntry(input = {}, context = {}) {
  const attendeesSource = Array.isArray(input.attendees)
    ? input.attendees
    : parseJsonArray(input.attendees, 'Activity attendees');
  return {
    entryId: 'ENTRY-1',
    title: '',
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    durationHours: input.durationHours,
    location: input.location,
    notes: '',
    status: 'posted',
    assignees: attendeesSource,
    attendees: attendeesSource,
    activityPaid: context.activityPaid
  };
}

function flattenActivityAssignees(entries = []) {
  const byPersonId = new Map();
  entries.forEach((entry) => {
    (Array.isArray(entry.assignees) ? entry.assignees : []).forEach((assignee) => {
      const personId = cleanString(assignee.personId, { max: 80, allowEmpty: true });
      if (!personId) return;
      const existing = byPersonId.get(personId);
      if (!existing) {
        byPersonId.set(personId, { ...assignee });
        return;
      }
      const roles = [...new Set([...(existing.roles || []), ...(assignee.roles || [])].filter(Boolean))];
      byPersonId.set(personId, {
        ...existing,
        personName: existing.personName || assignee.personName || personId,
        roles: roles.length ? roles : existing.roles,
        role: existing.role || assignee.role,
        paid: existing.paid !== false || assignee.paid !== false,
        paidHours: Number(((Number(existing.paidHours) || 0) + (Number(assignee.paidHours) || 0)).toFixed(2))
      });
    });
  });
  return [...byPersonId.values()];
}

function sanitizeActivityPayload(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid school activity payload.');
  }
  const orgId = cleanId(input.orgId, { allowEmpty: false });
  const title = cleanString(input.title, { max: 180, allowEmpty: false });
  const categoryId = cleanId(input.categoryId, { allowEmpty: false });
  const departmentId = cleanId(input.departmentId, { allowEmpty: false });
  const status = cleanString(input.status || 'draft', { max: 30, allowEmpty: true }).toLowerCase() || 'draft';
  const visibilityScope = normalizeActivityVisibilityScope(input.visibilityScope || input.calendarScope || input.scope);
  const paid = input.paid === true || input.paid === 'true' || input.paid === 'on';
  if (!orgId) throw new Error('Organization is required.');
  if (!title) throw new Error('Activity title is required.');
  if (!categoryId) throw new Error('Activity category is required.');
  if (!departmentId) throw new Error('Activity department is required.');
  if (!ACTIVITY_STATUSES.has(status)) throw new Error('Invalid activity status.');
  const entriesSource = parseJsonArray(input.entries, 'Activity entries');
  const rawEntries = entriesSource.length
    ? entriesSource
    : [buildLegacyActivityEntry(input, { activityPaid: paid })];
  if (!rawEntries.length) throw new Error('At least one activity session is required.');
  const entries = rawEntries.map((entry, index) => sanitizeActivityEntry(entry, { activityPaid: paid, index }));
  const firstEntry = entries[0];
  const attendees = flattenActivityAssignees(entries);
  const totalDurationHours = Number(entries.reduce((sum, entry) => sum + (Number(entry.durationHours) || 0), 0).toFixed(2));
  return {
    orgId,
    title,
    categoryId,
    categoryName: cleanString(input.categoryName, { max: 180, allowEmpty: true }),
    departmentId,
    departmentName: cleanString(input.departmentName, { max: 180, allowEmpty: true }),
    date: firstEntry.date,
    startTime: firstEntry.startTime,
    endTime: firstEntry.endTime,
    durationHours: firstEntry.durationHours,
    totalDurationHours,
    paid,
    status,
    visibilityScope,
    location: cleanString(input.location, { max: 180, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 1200, allowEmpty: true }),
    attendees,
    entries
  };
}

async function getAllActivities() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve school activities.');
  }
}

async function getActivityById(id) {
  const rows = await getAllActivities();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addActivity(payload) {
  return queueWrite(async () => {
    const rows = await getAllActivities();
    const sanitized = sanitizeActivityPayload(payload);
    const row = {
      id: generateId(),
      ...sanitized,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    rows.push(row);
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')));
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return row;
  });
}

async function updateActivity(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllActivities();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('School activity not found.');
    const existing = rows[index];
    const sanitized = sanitizeActivityPayload({ ...payload, orgId: existing.orgId || payload.orgId });
    rows[index] = {
      ...existing,
      ...sanitized,
      updatedAt: new Date().toISOString()
    };
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')));
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteActivity(id) {
  return queueWrite(async () => {
    const rows = await getAllActivities();
    await fs.writeFile(dataPath, JSON.stringify(rows.filter((row) => String(row.id) !== String(id)), null, 2));
  });
}

module.exports = {
  getAllActivities,
  getActivityById,
  addActivity,
  updateActivity,
  deleteActivity,
  sanitizeActivityPayload,
  sanitizeAttendee,
  sanitizeActivityEntry,
  normalizeActivityVisibilityScope,
  calculateDurationHours
};

