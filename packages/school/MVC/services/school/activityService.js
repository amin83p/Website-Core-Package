const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const activityModel = require('../../models/school/activityModel');
const activityCategoryModel = require('../../models/school/activityCategoryModel');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');

function normalizeId(value) {
  return String(value || '').trim();
}

function getActiveOrgId(reqUser = {}) {
  return normalizeId(reqUser.activeOrgId || reqUser.orgId || reqUser.organizationId);
}

function belongsToOrg(row = {}, orgId = '') {
  return !orgId || idsEqual(row?.orgId, orgId);
}

function normalizeStatus(value, fallback = '') {
  return String(value || fallback || '').trim().toLowerCase();
}

function normalizeActivityVisibilityScope(value) {
  return activityModel.normalizeActivityVisibilityScope(value);
}

function isActiveIdentity(row = {}) {
  const status = normalizeStatus(row.status || row.state || row.lifecycleStatus, 'active');
  return !['archived', 'deleted', 'inactive', 'disabled', 'removed'].includes(status);
}

function formatPersonName(person = {}, fallback = '') {
  const preferred = normalizeId(person.preferredName || person.name?.preferred);
  if (preferred) return preferred;
  const first = normalizeId(person.firstName || person.name?.first);
  const last = normalizeId(person.lastName || person.name?.last);
  return [first, last].filter(Boolean).join(' ') || normalizeId(person.displayName || person.name) || fallback;
}

async function enrichActivityAttendeeNames(activity = {}, reqUser) {
  const normalized = normalizeActivityRecord(activity);
  const entries = getActivityEntries(normalized);
  const attendees = Array.isArray(normalized.attendees) ? normalized.attendees : [];
  const entryAssignees = entries.flatMap((entry) => Array.isArray(entry.assignees) ? entry.assignees : []);
  if (!attendees.length && !entryAssignees.length) return normalized;
  const personIds = [...new Set([...attendees, ...entryAssignees].map((row) => normalizeId(row.personId)).filter(Boolean))];
  if (!personIds.length) return normalized;
  let persons = [];
  try {
    const payload = await schoolIdentityLookupService.listSchoolPersons({
      reqUser,
      requireSchoolRole: false,
      query: { limit: 1000 }
    });
    persons = payload.allRows || payload.rows || [];
  } catch (_error) {
    persons = [];
  }
  const personMap = new Map((Array.isArray(persons) ? persons : [])
    .map((person) => [normalizeId(person.id || person.personId), person])
    .filter(([id]) => personIds.includes(id)));
  const enrichAssignee = (assignee) => {
    const personId = normalizeId(assignee.personId);
    const person = personMap.get(personId);
    const personName = person ? formatPersonName(person, assignee.personName || personId) : (assignee.personName || personId);
    return { ...assignee, personName };
  };
  return {
    ...normalized,
    attendees: attendees.map(enrichAssignee),
    entries: entries.map((entry) => ({
      ...entry,
      assignees: (Array.isArray(entry.assignees) ? entry.assignees : []).map(enrichAssignee)
    }))
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function normalizePersonIdList(value) {
  const source = Array.isArray(value) ? value : parseJsonArray(value);
  const seen = new Set();
  return source
    .map((item) => normalizeId(
      typeof item === 'string'
        ? item
        : (item?.personId || item?.id || item?.value || item?.person?.id || '')
    ))
    .filter((personId) => {
      if (!personId || seen.has(personId)) return false;
      seen.add(personId);
      return true;
    });
}

function listAssigneePersonIds(entries = []) {
  return [...new Set((Array.isArray(entries) ? entries : [])
    .flatMap((entry) => (Array.isArray(entry?.assignees) ? entry.assignees : []))
    .map((assignee) => normalizeId(assignee?.personId))
    .filter(Boolean))];
}

function listLegacyAttendeePersonIds(activity = {}) {
  return normalizePersonIdList(activity?.attendees || []);
}

function getEffectiveActivityAllowedIds(activity = {}, orgPersonPool = []) {
  const visibilityScope = normalizeActivityVisibilityScope(activity.visibilityScope || activity.calendarScope || activity.scope);
  const normalizedEntries = getActivityEntries(activity);
  const normalizedActivity = {
    ...activity,
    entries: normalizedEntries,
    allowedPersonIds: normalizePersonIdList(activity.allowedPersonIds || activity.allowedPersons || []),
    excludedPersonIds: normalizePersonIdList(activity.excludedPersonIds || activity.excludedPersons || [])
  };
  if (visibilityScope === 'individual' && !normalizedActivity.allowedPersonIds.length) {
    normalizedActivity.allowedPersonIds = [...new Set([
      ...listAssigneePersonIds(normalizedEntries),
      ...listLegacyAttendeePersonIds(activity)
    ])];
  }
  return activityModel.resolveActivityScopeAllowedSet(normalizedActivity, orgPersonPool);
}

function getEffectiveEntryAllowedIds(activity = {}, entry = {}, orgPersonPool = []) {
  const normalizedEntry = {
    ...(entry || {}),
    excludedPersonIds: normalizePersonIdList(entry?.excludedPersonIds || entry?.excludedPersons || [])
  };
  return activityModel.resolveEntryEligibleSet({
    ...activity,
    allowedPersonIds: normalizePersonIdList(activity?.allowedPersonIds || activity?.allowedPersons || []),
    excludedPersonIds: normalizePersonIdList(activity?.excludedPersonIds || activity?.excludedPersons || []),
    entries: getActivityEntries(activity)
  }, normalizedEntry, orgPersonPool);
}

function isPersonEligibleForActivity(activity = {}, personId, orgPersonPool = []) {
  const targetPersonId = normalizeId(personId);
  if (!targetPersonId) return false;
  const pool = Array.isArray(orgPersonPool) && orgPersonPool.length
    ? orgPersonPool
    : [{ id: targetPersonId, personId: targetPersonId }];
  return new Set(getEffectiveActivityAllowedIds(activity, pool)).has(targetPersonId);
}

function isPersonEligibleForEntry(activity = {}, entry = {}, personId, orgPersonPool = []) {
  const targetPersonId = normalizeId(personId);
  if (!targetPersonId) return false;
  const pool = Array.isArray(orgPersonPool) && orgPersonPool.length
    ? orgPersonPool
    : [{ id: targetPersonId, personId: targetPersonId }];
  return new Set(getEffectiveEntryAllowedIds(activity, entry, pool)).has(targetPersonId);
}

function normalizeActivityEntry(entry = {}, activity = {}, index = 0) {
  const assignees = parseJsonArray(entry.assignees);
  const fallbackAssignees = parseJsonArray(entry.attendees);
  const startTime = normalizeId(entry.startTime || activity.startTime);
  const endTime = normalizeId(entry.endTime || activity.endTime);
  const durationHours = Number(entry.durationHours || calculateDurationHours(startTime, endTime) || 0);
  return {
    entryId: normalizeId(entry.entryId || entry.id || `ENTRY-${index + 1}`),
    title: normalizeId(entry.title),
    date: normalizeId(entry.date || entry.activityDate || entry.startDate || activity.date || activity.activityDate || activity.startDate),
    startTime,
    endTime,
    durationHours,
    location: normalizeId(entry.location || activity.location),
    notes: normalizeId(entry.notes),
    status: normalizeStatus(entry.status, 'posted') || 'posted',
    excludedPersonIds: normalizePersonIdList(entry.excludedPersonIds || entry.excludedPersons || []),
    assignees: assignees.length
      ? assignees
      : (fallbackAssignees.length ? fallbackAssignees : parseJsonArray(activity.attendees))
  };
}

function getActivityEntries(activity = {}) {
  const entries = parseJsonArray(activity.entries);
  if (entries.length) {
    return entries.map((entry, index) => normalizeActivityEntry(entry, activity, index));
  }
  return [normalizeActivityEntry({
    entryId: 'ENTRY-1',
    title: '',
    date: activity.date || activity.activityDate || activity.startDate,
    startTime: activity.startTime,
    endTime: activity.endTime,
    durationHours: activity.durationHours,
    location: activity.location,
    notes: '',
    status: 'posted',
    assignees: parseJsonArray(activity.attendees)
  }, activity, 0)];
}

function flattenActivityAssignees(entries = []) {
  const byPersonId = new Map();
  entries.forEach((entry) => {
    (Array.isArray(entry.assignees) ? entry.assignees : []).forEach((assignee) => {
      const personId = normalizeId(assignee.personId);
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

function normalizeActivityRecord(activity = {}) {
  const parsedAttendees = parseJsonArray(activity.attendees);
  const entries = getActivityEntries(activity);
  const firstEntry = entries[0] || {};
  const attendees = parsedAttendees.length ? parsedAttendees : flattenActivityAssignees(entries);
  const visibilityScope = normalizeActivityVisibilityScope(activity.visibilityScope || activity.calendarScope || activity.scope);
  const excludedPersonIds = normalizePersonIdList(activity.excludedPersonIds || activity.excludedPersons || []);
  let allowedPersonIds = normalizePersonIdList(activity.allowedPersonIds || activity.allowedPersons || []);
  if (visibilityScope === 'individual' && !allowedPersonIds.length) {
    allowedPersonIds = [...new Set([
      ...listAssigneePersonIds(entries),
      ...listLegacyAttendeePersonIds(activity)
    ])];
  }
  const excludedSet = new Set(excludedPersonIds);
  allowedPersonIds = allowedPersonIds.filter((personId) => !excludedSet.has(personId));
  return {
    ...activity,
    date: activity.date || firstEntry.date || '',
    startTime: activity.startTime || firstEntry.startTime || '',
    endTime: activity.endTime || firstEntry.endTime || '',
    durationHours: Number(activity.durationHours || firstEntry.durationHours || 0),
    totalDurationHours: Number(activity.totalDurationHours || entries.reduce((sum, entry) => sum + (Number(entry.durationHours) || 0), 0) || 0),
    visibilityScope,
    allowedPersonIds,
    excludedPersonIds,
    attendees,
    entries
  };
}

function calculateDurationHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const start = (sh * 60) + sm;
  const end = (eh * 60) + em;
  if (end <= start) return 0;
  return Number(((end - start) / 60).toFixed(2));
}

async function loadActivityLookups(reqUser) {
  const [categories, departments] = await Promise.all([
    schoolDataService.fetchData('activityCategories', {}, reqUser),
    schoolDataService.fetchData('departments', {}, reqUser)
  ]);
  const categoryMap = new Map((Array.isArray(categories) ? categories : []).map((row) => [normalizeId(row.id), row]));
  const departmentMap = new Map((Array.isArray(departments) ? departments : []).map((row) => [normalizeId(row.id), row]));
  return { categories, departments, categoryMap, departmentMap };
}

async function listActivitiesForOrg(orgId, reqUser, query = {}) {
  const rows = await schoolDataService.fetchData('activities', query, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => belongsToOrg(row, orgId));
}

function enrichActivity(activity = {}, lookups = {}) {
  const normalized = normalizeActivityRecord(activity);
  const category = lookups.categoryMap?.get(normalizeId(normalized.categoryId));
  const department = lookups.departmentMap?.get(normalizeId(normalized.departmentId));
  return {
    ...normalized,
    categoryName: normalized.categoryName || category?.name || normalized.categoryId || '',
    departmentName: normalized.departmentName || department?.name || department?.code || normalized.departmentId || '',
    durationHours: Number(normalized.durationHours || calculateDurationHours(normalized.startTime, normalized.endTime) || 0),
    totalDurationHours: Number(normalized.totalDurationHours || normalized.durationHours || 0)
  };
}

async function listActivityCategories({ orgId, reqUser, includeInactive = false } = {}) {
  const rows = await schoolDataService.fetchData('activityCategories', {}, reqUser);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => belongsToOrg(row, orgId))
    .filter((row) => includeInactive || row.active !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function listActivities({ orgId, reqUser, query = {} } = {}) {
  const lookups = await loadActivityLookups(reqUser);
  const rows = await listActivitiesForOrg(orgId, reqUser, query);
  return rows
    .map((row) => enrichActivity(row, lookups))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')));
}

async function getActivity(id, reqUser) {
  const activity = await schoolDataService.getDataById('activities', id, reqUser);
  if (!activity) return null;
  const lookups = await loadActivityLookups(reqUser);
  return enrichActivityAttendeeNames(enrichActivity(activity, lookups), reqUser);
}

async function saveActivity(payload = {}, reqUser) {
  const orgId = payload.orgId || getActiveOrgId(reqUser);
  const lookups = await loadActivityLookups(reqUser);
  const category = lookups.categoryMap.get(normalizeId(payload.categoryId));
  const department = lookups.departmentMap.get(normalizeId(payload.departmentId));
  const data = activityModel.sanitizeActivityPayload({
    ...payload,
    orgId,
    categoryName: category?.name || payload.categoryName || '',
    departmentName: department?.name || department?.code || payload.departmentName || ''
  });
  const normalized = normalizeActivityRecord(data);
  const eligiblePersons = await getEligiblePersons({ orgId, reqUser, q: '' });
  const eligiblePersonIds = [...new Set((Array.isArray(eligiblePersons) ? eligiblePersons : [])
    .map((row) => normalizeId(row?.personId || row?.id))
    .filter(Boolean))];
  const eligibleSet = new Set(eligiblePersonIds);
  const activityExcludedSet = new Set(normalized.excludedPersonIds || []);
  const activityAllowedIds = getEffectiveActivityAllowedIds(normalized, eligiblePersonIds);
  const activityAllowedSet = new Set(activityAllowedIds);
  const scopeLabel = normalized.visibilityScope === 'individual' ? 'individual' : 'school';
  const persistedAllowedPersonIds = scopeLabel === 'individual'
    ? activityAllowedIds
    : (normalized.allowedPersonIds || []).filter((personId) => !activityExcludedSet.has(personId));
  if (scopeLabel === 'individual' && !activityAllowedIds.length) {
    throw new Error('Individual scope activities must include at least one allowed person.');
  }
  const invalidActivityPersonIds = [...new Set([
    ...(normalized.allowedPersonIds || []),
    ...(normalized.excludedPersonIds || [])
  ])].filter((personId) => !eligibleSet.has(personId));
  if (invalidActivityPersonIds.length) {
    throw new Error('Activity person controls include unknown people. Please refresh and reselect.');
  }
  const validatedEntries = getActivityEntries(normalized).map((entry) => {
    const entryExcludedIds = normalizePersonIdList(entry.excludedPersonIds || []);
    const invalidEntryExcluded = entryExcludedIds.filter((personId) => !eligibleSet.has(personId));
    if (invalidEntryExcluded.length) {
      throw new Error('Work session exclusions include unknown people. Please refresh and reselect.');
    }
    const nonSubsetExclusions = entryExcludedIds.filter((personId) => !activityAllowedSet.has(personId));
    if (nonSubsetExclusions.length) {
      throw new Error('Work session exclusions must be selected from activity-level eligible people.');
    }
    const effectiveEntryAllowedSet = new Set(getEffectiveEntryAllowedIds({
      ...normalized,
      entries: normalized.entries
    }, {
      ...entry,
      excludedPersonIds: entryExcludedIds
    }, eligiblePersonIds));
    const assignees = (Array.isArray(entry.assignees) ? entry.assignees : []).map((assignee) => ({
      ...assignee,
      personId: normalizeId(assignee?.personId)
    })).filter((assignee) => assignee.personId);
    const invalidAssignees = assignees.filter((assignee) => !eligibleSet.has(assignee.personId));
    if (invalidAssignees.length) {
      throw new Error('Assigned people include unknown school identities. Please refresh and reselect.');
    }
    const blockedAssignees = assignees.filter((assignee) => !effectiveEntryAllowedSet.has(assignee.personId));
    if (blockedAssignees.length) {
      const blockedName = blockedAssignees[0]?.personName || blockedAssignees[0]?.personId || 'Selected person';
      throw new Error(`Assigned person "${blockedName}" is excluded from this activity scope/session.`);
    }
    return {
      ...entry,
      excludedPersonIds: entryExcludedIds.filter((personId) => !activityExcludedSet.has(personId)),
      assignees
    };
  });
  const firstEntry = validatedEntries[0] || {};
  const totalDurationHours = Number(validatedEntries.reduce((sum, entry) => {
    return sum + (Number(entry.durationHours) || 0);
  }, 0).toFixed(2));
  const normalizedData = {
    ...normalized,
    allowedPersonIds: persistedAllowedPersonIds,
    excludedPersonIds: [...activityExcludedSet],
    entries: validatedEntries,
    attendees: flattenActivityAssignees(validatedEntries),
    date: firstEntry.date || normalized.date || '',
    startTime: firstEntry.startTime || normalized.startTime || '',
    endTime: firstEntry.endTime || normalized.endTime || '',
    durationHours: Number(firstEntry.durationHours || normalized.durationHours || 0),
    totalDurationHours
  };
  if (payload.id) {
    return schoolDataService.updateData('activities', payload.id, normalizedData, reqUser);
  }
  return schoolDataService.addData('activities', normalizedData, reqUser);
}

async function saveActivityCategory(payload = {}, reqUser) {
  const orgId = payload.orgId || getActiveOrgId(reqUser);
  const data = activityCategoryModel.sanitizeCategoryPayload({ ...payload, orgId });
  if (payload.id) {
    return schoolDataService.updateData('activityCategories', payload.id, data, reqUser);
  }
  return schoolDataService.addData('activityCategories', data, reqUser);
}
async function getEligiblePersons({ orgId, reqUser, q = '' } = {}) {
  const [personPayload, students, teachers, staff] = await Promise.all([
    schoolIdentityLookupService.listSchoolPersons({
      reqUser,
      requireSchoolRole: false,
      query: { limit: 1000 }
    }),
    schoolDataService.fetchData('students', {}, reqUser),
    schoolDataService.fetchData('teachers', {}, reqUser),
    schoolDataService.fetchData('staff', {}, reqUser)
  ]);
  const persons = personPayload.allRows || personPayload.rows || [];
  const personMap = new Map((Array.isArray(persons) ? persons : []).map((person) => [normalizeId(person.id || person.personId), person]));
  const outputByPerson = new Map();
  const query = String(q || '').trim().toLowerCase();
  const add = (role, row) => {
    if (!belongsToOrg(row, orgId) || !isActiveIdentity(row)) return;
    const personId = normalizeId(row.personId);
    if (!personId) return;
    const person = personMap.get(personId) || {};
    const displayName = formatPersonName(person, row.personName || personId);
    const haystack = [personId, displayName, role, row.id].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) return;
    const existing = outputByPerson.get(personId);
    const roles = new Set([...(existing?.roles || []), role]);
    outputByPerson.set(personId, {
      id: personId,
      personId,
      displayName,
      firstName: person.firstName || person.name?.first || '',
      lastName: person.lastName || person.name?.last || '',
      preferredName: person.preferredName || person.name?.preferred || '',
      roles: [...roles],
      matchedRole: existing?.matchedRole || role
    });
  };
  (Array.isArray(students) ? students : []).forEach((row) => add('student', row));
  (Array.isArray(teachers) ? teachers : []).forEach((row) => add('teacher', row));
  (Array.isArray(staff) ? staff : []).forEach((row) => add('staff', row));
  return [...outputByPerson.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function getScheduleEventsForPerson({ orgId, personId, startDate, endDate, reqUser } = {}) {
  const activities = await listActivities({ orgId, reqUser });
  const targetPersonId = normalizeId(personId);
  return activities.flatMap((activity) => {
    if (normalizeStatus(activity.status) !== 'posted') return [];
    return getActivityEntries(activity).flatMap((entry) => {
      if (normalizeStatus(entry.status, 'posted') !== 'posted') return [];
      if (!entry.date || entry.date < startDate || entry.date > endDate) return [];
      if (!isPersonEligibleForEntry(activity, entry, targetPersonId)) return [];
      const assignees = Array.isArray(entry.assignees) ? entry.assignees : [];
      const entryTitle = entry.title && entry.title !== activity.title ? `${activity.title}: ${entry.title}` : activity.title;
      return assignees
        .filter((attendee) => idsEqual(attendee.personId, targetPersonId))
        .filter((attendee) => normalizeStatus(attendee.status, 'attended') === 'attended')
        .map((attendee) => ({
          id: `ACT-${activity.id}-${entry.entryId}-${targetPersonId}`,
          activityId: activity.id,
          activityEntryId: entry.entryId,
          targetType: 'activity',
          personId: targetPersonId,
          date: entry.date,
          start: entry.startTime,
          end: entry.endTime,
          title: entryTitle,
          className: entryTitle,
          categoryName: activity.categoryName,
          departmentId: activity.departmentId,
          departmentName: activity.departmentName,
          visibilityScope: activity.visibilityScope,
          duration: Number(entry.durationHours || attendee.paidHours || 0),
          paid: activity.paid === true && attendee.paid !== false,
          status: 'posted',
          roles: [attendee.role || 'Participant'],
          roleLabel: activity.paid === true && attendee.paid !== false ? 'Paid Activity' : 'Activity',
          detailsUrl: `/school/activities/edit/${encodeURIComponent(activity.id)}`,
          hasOverlap: false,
          eventType: 'school_activity'
        }));
    });
  });
}

async function getTimesheetEntriesForPerson({ orgId, personId, periodStartDate, periodEndDate, reqUser } = {}) {
  const activities = await listActivities({ orgId, reqUser });
  const targetPersonId = normalizeId(personId);
  return activities.flatMap((activity) => {
    if (normalizeStatus(activity.status) !== 'posted' || activity.paid !== true) return [];
    return getActivityEntries(activity).flatMap((entry) => {
      if (normalizeStatus(entry.status, 'posted') !== 'posted') return [];
      if (!entry.date || entry.date < periodStartDate || entry.date > periodEndDate) return [];
      if (!isPersonEligibleForEntry(activity, entry, targetPersonId)) return [];
      const assignees = Array.isArray(entry.assignees) ? entry.assignees : [];
      const entryTitle = entry.title && entry.title !== activity.title ? `${activity.title}: ${entry.title}` : activity.title;
      return assignees
        .filter((attendee) => idsEqual(attendee.personId, targetPersonId))
        .filter((attendee) => attendee.paid !== false && normalizeStatus(attendee.status, 'attended') === 'attended')
        .map((attendee) => {
          const hours = Number(attendee.paidHours || entry.durationHours || 0);
          return {
            sessionId: `act-${activity.id}-${entry.entryId}-${targetPersonId}`,
            activityId: activity.id,
            activityEntryId: entry.entryId,
            date: entry.date,
            startTime: entry.startTime,
            endTime: entry.endTime,
            className: entryTitle,
            classId: null,
            departmentId: activity.departmentId,
            departmentName: activity.departmentName,
            categoryName: activity.categoryName,
            visibilityScope: activity.visibilityScope,
            hours,
            durationHours: hours,
            timesheetHours: hours,
            status: 'activity',
            comment: entry.notes || activity.notes || '',
            isManual: false,
            isSchoolActivity: true,
            compensationLookup: {
              personId: targetPersonId,
              departmentId: activity.departmentId,
              activityId: activity.id,
              activityEntryId: entry.entryId
            }
          };
        });
    });
  });
}

module.exports = {
  listActivityCategories,
  listActivities,
  getActivity,
  saveActivity,
  saveActivityCategory,
  getEligiblePersons,
  getActivityEntries,
  normalizeActivityVisibilityScope,
  getEffectiveActivityAllowedIds,
  getEffectiveEntryAllowedIds,
  isPersonEligibleForActivity,
  isPersonEligibleForEntry,
  getScheduleEventsForPerson,
  getTimesheetEntriesForPerson,
  calculateDurationHours
};


