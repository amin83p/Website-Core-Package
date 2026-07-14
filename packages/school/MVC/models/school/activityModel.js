const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/activities.json');
const ACTIVITY_STATUSES = new Set(['draft', 'posted', 'cancelled', 'void']);
const { applyVoidMetadata } = require('./voidRecordMetadata');
const ATTENDANCE_STATUSES = new Set(['attended', 'absent', 'excused']);
const COMPLETION_STATUSES = new Set(['pending', 'completed']);
const EVALUATION_TYPES = new Set(['attendance', 'completion']);
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

function normalizeEvaluationType(value) {
  const raw = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw || raw === 'attendance' || raw === 'attendance_based' || raw === 'presence') return 'attendance';
  if (raw === 'completion' || raw === 'completion_based' || raw === 'task') return 'completion';
  if (!EVALUATION_TYPES.has(raw)) throw new Error('Invalid activity evaluation type.');
  return raw;
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
  const completionStatusRaw = cleanString(input.completionStatus || 'pending', { max: 40, allowEmpty: true }).toLowerCase() || 'pending';
  const completionStatus = COMPLETION_STATUSES.has(completionStatusRaw) ? completionStatusRaw : 'pending';
  const locked = input.locked === true || input.locked === 'true';
  const lockReason = locked ? cleanString(input.lockReason, { max: 80, allowEmpty: true }) : '';
  const lockedTimesheetId = locked ? cleanId(input.lockedTimesheetId, { allowEmpty: true }) : '';
  const completedAt = completionStatus === 'completed'
    ? cleanString(input.completedAt || '', { max: 40, allowEmpty: true })
    : '';
  const completedBy = completionStatus === 'completed'
    ? cleanId(input.completedBy, { allowEmpty: true })
    : '';
  return {
    personId,
    personName,
    roles: roles.length ? roles : [role],
    role,
    status,
    paid,
    paidHours,
    notes: cleanString(input.notes, { max: 500, allowEmpty: true }),
    completionStatus,
    completedAt,
    completedBy,
    locked,
    lockedAt: locked ? cleanString(input.lockedAt, { max: 40, allowEmpty: true }) : '',
    lockedBy: locked ? cleanId(input.lockedBy, { allowEmpty: true }) : '',
    lockReason,
    lockedTimesheetId
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

function coercePersonIdList(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? parseJsonArray(value, 'Person list') : []);
  const seen = new Set();
  return source
    .map((item) => {
      const candidate = typeof item === 'string'
        ? item
        : (item?.personId || item?.id || item?.value || item?.person?.id || '');
      const token = cleanString(candidate, { max: 80, allowEmpty: true });
      if (!token || !/^[A-Za-z0-9_-]+$/.test(token) || seen.has(token)) return '';
      seen.add(token);
      return token;
    })
    .filter(Boolean);
}

function parsePersonIdArray(value, fieldName = 'Person list') {
  if (value === undefined || value === null || value === '') return [];
  let source = value;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) return [];
    source = trimmed.startsWith('[')
      ? parseJsonArray(trimmed, fieldName)
      : trimmed.split(',').map((part) => part.trim());
  }
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  return source.map((item) => {
    const candidate = typeof item === 'string'
      ? item
      : (item?.personId || item?.id || item?.value || item?.person?.id || '');
    try {
      return cleanId(candidate, { allowEmpty: true });
    } catch (_error) {
      throw new Error(`${fieldName} contains an invalid person id.`);
    }
  }).filter((token) => {
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function sanitizeAllowedExcludedLists(allowedInput = [], excludedInput = []) {
  const excludedSet = new Set(parsePersonIdArray(excludedInput, 'Excluded persons'));
  const allowed = parsePersonIdArray(allowedInput, 'Allowed persons')
    .filter((personId) => !excludedSet.has(personId));
  return {
    allowedPersonIds: allowed,
    excludedPersonIds: [...excludedSet]
  };
}

function collectLegacyAssigneeIds(activity = {}) {
  const attendeeIds = parsePersonIdArray(activity.attendees || [], 'Legacy attendees');
  const entryAssigneeIds = (Array.isArray(activity.entries) ? activity.entries : [])
    .flatMap((entry) => parsePersonIdArray(entry?.assignees || [], 'Entry assignees'));
  return [...new Set([...attendeeIds, ...entryAssigneeIds])];
}

function resolveActivityScopeAllowedSet(activity = {}, orgPersonPool = []) {
  const visibilityScope = normalizeActivityVisibilityScope(activity.visibilityScope || activity.calendarScope || activity.scope);
  const excludedSet = new Set(coercePersonIdList(activity.excludedPersonIds));
  if (visibilityScope === 'individual') {
    const explicitAllowed = coercePersonIdList(activity.allowedPersonIds);
    const fallbackAllowed = explicitAllowed.length ? [] : collectLegacyAssigneeIds(activity);
    return [...new Set([...explicitAllowed, ...fallbackAllowed])]
      .filter((personId) => !excludedSet.has(personId));
  }
  const poolIds = coercePersonIdList(orgPersonPool);
  return poolIds.filter((personId) => !excludedSet.has(personId));
}

function resolveEntryEligibleSet(activity = {}, entry = {}, orgPersonPool = []) {
  const activityAllowed = resolveActivityScopeAllowedSet(activity, orgPersonPool);
  const entryExcludedSet = new Set(coercePersonIdList(entry?.excludedPersonIds));
  return activityAllowed.filter((personId) => !entryExcludedSet.has(personId));
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
  const excludedPersonIds = parsePersonIdArray(input.excludedPersonIds || input.excludedPersons || [], 'Work session excluded persons');
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
    assignees,
    excludedPersonIds
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
    excludedPersonIds: [],
    activityPaid: context.activityPaid
  };
}

function flattenActivityAssignees(entries = []) {
  const byPersonId = new Map();
  entries.forEach((entry) => {
    (Array.isArray(entry?.assignees) ? entry.assignees : []).forEach((assignee) => {
      if (!assignee || typeof assignee !== 'object') return;
      const personId = cleanString(assignee.personId || assignee.id, { max: 80, allowEmpty: true });
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
  const evaluationType = normalizeEvaluationType(input.evaluationType || 'attendance');
  const visibilityScope = normalizeActivityVisibilityScope(input.visibilityScope || input.calendarScope || input.scope);
  const paid = input.paid === true || input.paid === 'true' || input.paid === 'on';
  const { allowedPersonIds, excludedPersonIds } = sanitizeAllowedExcludedLists(
    input.allowedPersonIds || input.allowedPersons || [],
    input.excludedPersonIds || input.excludedPersons || []
  );
  if (!orgId) throw new Error('Organization is required.');
  if (!title) throw new Error('Activity title is required.');
  if (!categoryId) throw new Error('Activity category is required.');
  if (!departmentId) throw new Error('Activity department is required.');
  if (!ACTIVITY_STATUSES.has(status)) throw new Error('Invalid activity status.');
  const entriesSource = parseJsonArray(input.entries, 'Activity entries');
  const rawEntries = entriesSource.length
    ? entriesSource
    : (input.allowEmptyEntries === true ? [] : [buildLegacyActivityEntry(input, { activityPaid: paid })]);
  if (!rawEntries.length && input.allowEmptyEntries !== true) throw new Error('At least one activity session is required.');
  const entries = rawEntries.map((entry, index) => sanitizeActivityEntry(entry, { activityPaid: paid, index }));
  const activityExcludedSet = new Set(excludedPersonIds);
  const sanitizedEntries = entries.map((entry) => ({
    ...entry,
    excludedPersonIds: parsePersonIdArray(entry.excludedPersonIds || [], 'Work session excluded persons')
      .filter((personId) => !activityExcludedSet.has(personId))
  }));
  const firstEntry = sanitizedEntries[0] || {
    date: '', startTime: '', endTime: '', durationHours: 0
  };
  const attendees = flattenActivityAssignees(sanitizedEntries);
  const totalDurationHours = Number(sanitizedEntries.reduce((sum, entry) => sum + (Number(entry.durationHours) || 0), 0).toFixed(2));
  return applyVoidMetadata({
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
    evaluationType,
    visibilityScope,
    allowedPersonIds,
    excludedPersonIds,
    location: cleanString(input.location, { max: 180, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 1200, allowEmpty: true }),
    attendees,
    entries: sanitizedEntries
  }, input);
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
    const existingEntries = new Map((Array.isArray(existing.entries) ? existing.entries : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => [String(entry.entryId), entry]));
    const mergeAssigneeLocks = (nextAssignees = [], priorAssignees = []) => {
      const priorByPerson = new Map((Array.isArray(priorAssignees) ? priorAssignees : [])
        .filter((row) => row && typeof row === 'object' && row.personId)
        .map((row) => [String(row.personId), row]));
      return (Array.isArray(nextAssignees) ? nextAssignees : [])
        .filter((assignee) => assignee && typeof assignee === 'object' && (assignee.personId || assignee.id))
        .map((assignee) => {
        const prior = priorByPerson.get(String(assignee.personId || assignee.id));
        if (!prior || prior.locked !== true) return assignee;
        return {
          ...assignee,
          completionStatus: prior.completionStatus || assignee.completionStatus,
          completedAt: prior.completedAt || assignee.completedAt,
          completedBy: prior.completedBy || assignee.completedBy,
          locked: prior.locked,
          lockedAt: prior.lockedAt,
          lockedBy: prior.lockedBy,
          lockReason: prior.lockReason,
          lockedTimesheetId: prior.lockedTimesheetId
        };
      });
    };
    const mergedEntries = (Array.isArray(sanitized.entries) ? sanitized.entries : []).map((entry) => {
      const prior = existingEntries.get(String(entry.entryId));
      if (!prior) return entry;
      const assignees = mergeAssigneeLocks(entry.assignees, prior.assignees);
      if (prior.locked !== true) return { ...entry, assignees };
      return {
        ...entry,
        assignees,
        locked: prior.locked,
        lockedAt: prior.lockedAt,
        lockedBy: prior.lockedBy,
        lockReason: prior.lockReason,
        lockedTimesheetId: prior.lockedTimesheetId
      };
    });
    rows[index] = {
      ...existing,
      ...sanitized,
      entries: mergedEntries,
      locked: existing.locked === true || mergedEntries.some((entry) => entry.locked === true),
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
  normalizeEvaluationType,
  normalizeActivityVisibilityScope,
  calculateDurationHours,
  resolveActivityScopeAllowedSet,
  resolveEntryEligibleSet
};
