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
  const attendees = Array.isArray(activity.attendees) ? activity.attendees : [];
  if (!attendees.length) return activity;
  const personIds = [...new Set(attendees.map((row) => normalizeId(row.personId)).filter(Boolean))];
  if (!personIds.length) return activity;
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
  return {
    ...activity,
    attendees: attendees.map((attendee) => {
      const personId = normalizeId(attendee.personId);
      const person = personMap.get(personId);
      const personName = person ? formatPersonName(person, attendee.personName || personId) : (attendee.personName || personId);
      return { ...attendee, personName };
    })
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

function normalizeActivityRecord(activity = {}) {
  const parsedAttendees = parseJsonArray(activity.attendees);
  return {
    ...activity,
    attendees: parsedAttendees.length
      ? parsedAttendees
      : (Array.isArray(activity.attendees) ? activity.attendees : [])
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
    durationHours: Number(normalized.durationHours || calculateDurationHours(normalized.startTime, normalized.endTime) || 0)
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
  if (payload.id) {
    return schoolDataService.updateData('activities', payload.id, data, reqUser);
  }
  return schoolDataService.addData('activities', data, reqUser);
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
    if (!activity.date || activity.date < startDate || activity.date > endDate) return [];
    const attendees = Array.isArray(activity.attendees) ? activity.attendees : [];
    return attendees
      .filter((attendee) => idsEqual(attendee.personId, targetPersonId))
      .filter((attendee) => normalizeStatus(attendee.status, 'attended') === 'attended')
      .map((attendee) => ({
        id: `ACT-${activity.id}-${targetPersonId}`,
        activityId: activity.id,
        targetType: 'activity',
        personId: targetPersonId,
        date: activity.date,
        start: activity.startTime,
        end: activity.endTime,
        title: activity.title,
        className: activity.title,
        categoryName: activity.categoryName,
        departmentId: activity.departmentId,
        departmentName: activity.departmentName,
        duration: Number(activity.durationHours || attendee.paidHours || 0),
        paid: activity.paid === true && attendee.paid !== false,
        status: 'posted',
        roles: [attendee.role || 'Participant'],
        roleLabel: activity.paid === true && attendee.paid !== false ? 'Paid Activity' : 'Activity',
        detailsUrl: `/school/activities/edit/${encodeURIComponent(activity.id)}`,
        hasOverlap: false,
        eventType: 'school_activity'
      }));
  });
}

async function getTimesheetEntriesForPerson({ orgId, personId, periodStartDate, periodEndDate, reqUser } = {}) {
  const activities = await listActivities({ orgId, reqUser });
  const targetPersonId = normalizeId(personId);
  return activities.flatMap((activity) => {
    if (normalizeStatus(activity.status) !== 'posted' || activity.paid !== true) return [];
    if (!activity.date || activity.date < periodStartDate || activity.date > periodEndDate) return [];
    const attendees = Array.isArray(activity.attendees) ? activity.attendees : [];
    return attendees
      .filter((attendee) => idsEqual(attendee.personId, targetPersonId))
      .filter((attendee) => attendee.paid !== false && normalizeStatus(attendee.status, 'attended') === 'attended')
      .map((attendee) => {
        const hours = Number(attendee.paidHours || activity.durationHours || 0);
        return {
          sessionId: `act-${activity.id}-${targetPersonId}`,
          activityId: activity.id,
          date: activity.date,
          startTime: activity.startTime,
          endTime: activity.endTime,
          className: activity.title,
          classId: null,
          departmentId: activity.departmentId,
          departmentName: activity.departmentName,
          categoryName: activity.categoryName,
          hours,
          durationHours: hours,
          timesheetHours: hours,
          status: 'activity',
          comment: activity.notes || '',
          isManual: false,
          isSchoolActivity: true,
          compensationLookup: {
            personId: targetPersonId,
            departmentId: activity.departmentId,
            activityId: activity.id
          }
        };
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
  getScheduleEventsForPerson,
  getTimesheetEntriesForPerson,
  calculateDurationHours
};


