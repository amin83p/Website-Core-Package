const { requireCoreModule } = require('./schoolCoreContracts');
const schoolDataService = require('./schoolDataService');
const activityService = require('./activityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const scheduleController = require('../../controllers/school/scheduleController');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const LAYER_KEYS = Object.freeze({
  DAYS_OFF: 'school_days_off',
  SCHEDULE_TEACHER: 'schedule_teacher',
  SCHEDULE_STAFF: 'schedule_staff',
  SCHEDULE_STUDENT: 'schedule_student',
  TIMESHEET_DEADLINES: 'timesheet_deadlines',
  SCHOOL_PUBLIC_ACTIVITIES: 'school_public_activities',
  MY_ASSIGNED_ACTIVITIES: 'my_assigned_activities'
});

const ACTIVITY_CATEGORY_LAYER_PREFIX = 'activity_category:';

const SCHEDULE_ROLE_BY_LAYER = Object.freeze({
  [LAYER_KEYS.SCHEDULE_TEACHER]: 'teacher',
  [LAYER_KEYS.SCHEDULE_STAFF]: 'staff',
  [LAYER_KEYS.SCHEDULE_STUDENT]: 'student'
});

function normalizeId(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (['true', 'yes', '1', 'paid', 'payable'].includes(raw)) return true;
  if (['false', 'no', '0', 'unpaid', 'unpayable'].includes(raw)) return false;
  return false;
}

function normalizeActivityVisibilityScope(value) {
  return activityService.normalizeActivityVisibilityScope(value);
}

function parseLayers(value) {
  if (Array.isArray(value)) return new Set(value.map(normalizeId).filter(Boolean));
  return new Set(String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean));
}

function buildActivityCategoryLayerKey(categoryId) {
  const safeCategoryId = normalizeId(categoryId);
  if (!safeCategoryId) return '';
  return `${ACTIVITY_CATEGORY_LAYER_PREFIX}${safeCategoryId}`;
}

function parseSelectedActivityCategoryIds(selectedLayers = new Set()) {
  const categoryIds = new Set();
  (selectedLayers instanceof Set ? Array.from(selectedLayers) : []).forEach((layer) => {
    const key = normalizeId(layer);
    if (!key.startsWith(ACTIVITY_CATEGORY_LAYER_PREFIX)) return;
    const categoryId = normalizeId(key.slice(ACTIVITY_CATEGORY_LAYER_PREFIX.length));
    if (categoryId) categoryIds.add(categoryId);
  });
  return categoryIds;
}

function inDateRange(date, startDate, endDate) {
  const normalized = normalizeDate(date);
  if (!normalized) return false;
  if (startDate && normalized < startDate) return false;
  if (endDate && normalized > endDate) return false;
  return true;
}

function rowBelongsToOrg(row, orgId) {
  if (!orgId) return true;
  const candidates = [
    row?.orgId,
    row?.organizationId,
    row?.activeOrgId,
    row?.scope?.orgId,
    row?.metadata?.orgId
  ].map(normalizeId).filter(Boolean);
  return candidates.length === 0 || candidates.some((candidate) => idsEqual(candidate, orgId));
}

function compareEvents(a, b) {
  return String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.startTime || '').localeCompare(String(b.startTime || ''))
    || String(a.title || '').localeCompare(String(b.title || ''));
}

function buildActivityDuplicateKey(activityId, activityEntryId) {
  const safeActivityId = normalizeId(activityId);
  const safeEntryId = normalizeId(activityEntryId);
  if (!safeActivityId || !safeEntryId) return '';
  return `${safeActivityId}:${safeEntryId}`;
}

function getActivityDuplicateKeyFromEvent(event = {}) {
  const activityId = event?.meta?.activityId || event?.activityId || '';
  const activityEntryId = event?.meta?.activityEntryId || event?.meta?.entryId || event?.activityEntryId || '';
  return buildActivityDuplicateKey(activityId, activityEntryId);
}

function isPublicActivityEvent(event = {}) {
  const type = normalizeId(event?.type || event?.eventType || event?.targetType).toLowerCase();
  const source = normalizeId(event?.meta?.source).toLowerCase();
  const activityScope = normalizeActivityVisibilityScope(event?.meta?.visibilityScope || event?.visibilityScope);
  return activityScope === 'school'
    && (type === 'school_activity' || type === 'activity' || source === 'activities');
}

function normalizeHolidayEvent(holiday) {
  const date = normalizeDate(holiday.date || holiday.holidayDate || holiday.startDate);
  if (!date) return null;
  const id = normalizeId(holiday.id || holiday._id || holiday.holidayId || date);
  return {
    id: `holiday-${id}`,
    sourceId: id,
    date,
    startTime: '',
    endTime: '',
    title: holiday.name || holiday.title || holiday.label || 'School Day Off',
    type: 'holiday',
    layer: LAYER_KEYS.DAYS_OFF,
    subtype: holiday.type || holiday.category || 'day_off',
    tone: 'danger',
    detailsUrl: '/school/holidays',
    meta: {
      allDay: true,
      source: 'holidays',
      description: holiday.description || holiday.notes || ''
    }
  };
}

function buildAssignedActivityTitle(activity = {}, entry = {}) {
  const activityName = String(activity.title || activity.name || 'School Activity').trim();
  const categoryName = String(activity.categoryName || '').trim();
  const entryTitle = String(entry.title || '').trim();
  const base = categoryName ? `${categoryName} · ${activityName}` : activityName;
  if (entryTitle && entryTitle !== activityName) {
    return `${base} · ${entryTitle}`;
  }
  return base;
}

function normalizeActivityEvent(activity = {}, {
  layerKey = '',
  subtype = '',
  entry = null,
  titleMode = 'default',
  tone = ''
} = {}) {
  const activityEntry = entry || {};
  const date = normalizeDate(activityEntry.date || activity.date || activity.activityDate || activity.startDate);
  if (!date) return null;
  const id = normalizeId(activity.id || activity._id || activity.activityId || date);
  const entryId = normalizeId(activityEntry.entryId);
  const categoryId = normalizeId(activity.categoryId || activity.category?.id);
  const resolvedSubtype = normalizeId(subtype || categoryId || 'activity') || 'activity';
  const resolvedLayerKey = normalizeId(layerKey) || buildActivityCategoryLayerKey(categoryId) || 'activity_category:unknown';
  const isPaid = normalizeBoolean(activity.paid || activity.isPaid || activity.payable);
  let title;
  if (titleMode === 'assigned') {
    title = buildAssignedActivityTitle(activity, activityEntry);
  } else {
    title = activityEntry.title && activityEntry.title !== activity.title
      ? `${activity.title || activity.name || 'School Activity'}: ${activityEntry.title}`
      : (activity.title || activity.name || 'School Professional Development');
  }
  const resolvedTone = normalizeId(tone)
    || (isPaid ? 'success' : 'info');
  const assignedToActivePerson = titleMode === 'assigned'
    || resolvedLayerKey === LAYER_KEYS.MY_ASSIGNED_ACTIVITIES;
  return {
    id: `activity-${id}${entryId ? `-${entryId}` : ''}${assignedToActivePerson ? '-assigned' : ''}`,
    sourceId: entryId ? `${id}:${entryId}` : id,
    date,
    startTime: normalizeTime(activityEntry.startTime || activity.startTime),
    endTime: normalizeTime(activityEntry.endTime || activity.endTime),
    title,
    type: 'school_activity',
    layer: resolvedLayerKey,
    subtype: resolvedSubtype,
    tone: resolvedTone,
    detailsUrl: `/school/activities/edit/${encodeURIComponent(id)}`,
    meta: {
      source: 'activities',
      activityId: id,
      activityEntryId: entryId,
      duplicateKey: buildActivityDuplicateKey(id, entryId),
      entryId,
      categoryId,
      categoryName: activity.categoryName || '',
      departmentName: activity.departmentName || '',
      visibilityScope: normalizeActivityVisibilityScope(activity.visibilityScope),
      durationHours: activityEntry.durationHours || activity.durationHours || '',
      paid: isPaid,
      notes: activityEntry.notes || activity.notes || '',
      assignedToActivePerson
    }
  };
}

function buildScheduleDetailsUrl(event = {}) {
  const directUrl = String(event.detailsUrl || event.url || '').trim();
  if (directUrl) return directUrl;
  const classId = normalizeId(event.classId);
  const sessionId = normalizeId(event.sessionId);
  if (classId && sessionId) {
    return `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`;
  }
  return '';
}

function normalizeScheduleEvent(event, role) {
  const date = normalizeDate(event.date || event.sessionDate || event.startDate);
  if (!date) return null;
  const id = normalizeId(event.id || event.sessionId || event.activityId || `${role}-${date}-${event.title || ''}`);
  const type = event.eventType || event.targetType || 'schedule';
  const title = event.title || event.className || event.name || 'Schedule Event';
  const isActivity = type === 'school_activity' || event.targetType === 'activity';
  const activityScope = isActivity ? normalizeActivityVisibilityScope(event.visibilityScope) : '';
  const tone = isActivity
    ? (activityScope === 'school' ? 'purple' : (event.paid === true ? 'success' : 'info'))
    : (role === 'teacher' ? 'primary' : role === 'staff' ? 'warning' : 'secondary');
  return {
    id: `schedule-${role}-${id}`,
    sourceId: id,
    date,
    startTime: normalizeTime(event.start || event.startTime),
    endTime: normalizeTime(event.end || event.endTime),
    title,
    type,
    layer: 'my_schedule',
    subtype: role,
    tone: event.caseSummary?.badgeTone || tone,
    detailsUrl: buildScheduleDetailsUrl(event),
    meta: {
      source: 'schedule',
      role,
      status: event.status || '',
      classId: event.classId || '',
      className: event.className || '',
      activityId: event.activityId || '',
      activityEntryId: event.activityEntryId || '',
      duplicateKey: isActivity ? buildActivityDuplicateKey(event.activityId, event.activityEntryId) : '',
      visibilityScope: activityScope,
      categoryName: event.categoryName || '',
      departmentName: event.departmentName || '',
      paid: event.paid === true,
      caseSummary: event.caseSummary || null,
      hasOverlap: Boolean(event.hasOverlap)
    }
  };
}

function normalizeTimesheetDeadlineEvent(period) {
  const date = normalizeDate(period.submissionDeadline);
  if (!date) return null;
  const id = normalizeId(period.id || period._id || period.periodId || date);
  const time = normalizeTime(period.submissionDeadlineTime || '23:59') || '23:59';
  const year = date.slice(0, 4);
  return {
    id: `timesheet-deadline-${id}`,
    sourceId: id,
    date,
    startTime: time,
    endTime: '',
    title: `Timesheet Deadline: ${period.name || period.title || id}`,
    type: 'timesheet_deadline',
    layer: LAYER_KEYS.TIMESHEET_DEADLINES,
    subtype: normalizeId(period.status || 'open') || 'open',
    tone: 'warning',
    detailsUrl: `/school/timesheets/my-timesheets?year=${encodeURIComponent(year)}`,
    meta: {
      source: 'timesheetPeriods',
      periodId: id,
      periodName: period.name || period.title || '',
      startDate: normalizeDate(period.startDate),
      endDate: normalizeDate(period.endDate),
      status: period.status || '',
      submissionDeadlineTime: time
    }
  };
}

async function getHolidayEvents({ reqUser, orgId, startDate, endDate } = {}) {
  const holidays = await schoolDataService.fetchData('holidays', {}, reqUser);
  return (Array.isArray(holidays) ? holidays : [])
    .filter((row) => rowBelongsToOrg(row, orgId))
    .map(normalizeHolidayEvent)
    .filter(Boolean)
    .filter((event) => inDateRange(event.date, startDate, endDate));
}

async function getPublicSchoolActivityEvents({ reqUser, orgId, startDate, endDate } = {}) {
  const activities = await activityService.listActivities({ orgId, reqUser });
  return (Array.isArray(activities) ? activities : [])
    .filter((row) => rowBelongsToOrg(row, orgId))
    .filter((row) => String(row.status || 'posted').toLowerCase() === 'posted')
    .filter((row) => normalizeActivityVisibilityScope(row.visibilityScope) === 'school')
    .flatMap((row) => activityService.getActivityEntries(row).map((entry) => ({ row, entry })))
    .filter(({ entry }) => String(entry.status || 'posted').toLowerCase() === 'posted')
    .filter(({ entry }) => normalizeDate(entry.date))
    .filter(({ entry }) => inDateRange(entry.date, startDate, endDate))
    .map(({ row, entry }) => normalizeActivityEvent(row, {
      entry,
      layerKey: LAYER_KEYS.SCHOOL_PUBLIC_ACTIVITIES,
      subtype: 'public',
      tone: 'purple'
    }))
    .filter(Boolean);
}

async function getAssignedActivityEventsForPerson({ reqUser, orgId, personId, startDate, endDate } = {}) {
  const targetPersonId = normalizeId(personId);
  if (!targetPersonId) return [];

  const activities = await activityService.listActivities({ orgId, reqUser });
  return (Array.isArray(activities) ? activities : [])
    .filter((row) => rowBelongsToOrg(row, orgId))
    .filter((row) => String(row.status || 'posted').toLowerCase() === 'posted')
    .flatMap((row) => activityService.getActivityEntries(row).map((entry) => ({ row, entry })))
    .filter(({ entry }) => String(entry.status || 'posted').toLowerCase() === 'posted')
    .filter(({ entry }) => normalizeDate(entry.date))
    .filter(({ row, entry }) => activityService.isPersonEligibleForEntry(row, entry, targetPersonId))
    .filter(({ entry }) => inDateRange(entry.date, startDate, endDate))
    .map(({ row, entry }) => normalizeActivityEvent(row, {
      entry,
      layerKey: LAYER_KEYS.MY_ASSIGNED_ACTIVITIES,
      subtype: 'assigned',
      titleMode: 'assigned',
      tone: normalizeActivityVisibilityScope(row.visibilityScope) === 'school' ? 'purple' : (normalizeBoolean(row.paid) ? 'success' : 'info')
    }))
    .filter(Boolean);
}

async function getActivityEventsByCategoryLayers({ reqUser, orgId, startDate, endDate, selectedCategoryIds = new Set(), personId = '' } = {}) {
  const categoryIdSet = selectedCategoryIds instanceof Set ? selectedCategoryIds : new Set();
  if (!categoryIdSet.size) return [];
  const targetPersonId = normalizeId(personId);

  const activities = await activityService.listActivities({ orgId, reqUser });
  return (Array.isArray(activities) ? activities : [])
    .filter((row) => rowBelongsToOrg(row, orgId))
    .filter((row) => String(row.status || 'posted').toLowerCase() === 'posted')
    .filter((row) => normalizeActivityVisibilityScope(row.visibilityScope) === 'school')
    .filter((row) => categoryIdSet.has(normalizeId(row.categoryId)))
    .flatMap((row) => activityService.getActivityEntries(row).map((entry) => ({ row, entry })))
    .filter(({ entry }) => String(entry.status || 'posted').toLowerCase() === 'posted')
    .filter(({ entry }) => normalizeDate(entry.date))
    .filter(({ row, entry }) => {
      if (!targetPersonId) return true;
      return activityService.isPersonEligibleForEntry(row, entry, targetPersonId);
    })
    .filter(({ entry }) => inDateRange(entry.date, startDate, endDate))
    .map(({ row, entry }) => {
      const categoryId = normalizeId(row.categoryId);
      return normalizeActivityEvent(row, {
        entry,
        layerKey: buildActivityCategoryLayerKey(categoryId),
        subtype: categoryId
      });
    })
    .filter(Boolean);
}

async function getScheduleEvents({ reqUser, orgId, personId, startDate, endDate, selectedLayers } = {}) {
  const effectivePersonId = normalizeId(personId);
  if (!effectivePersonId) return [];
  const requestedRoles = Object.entries(SCHEDULE_ROLE_BY_LAYER)
    .filter(([layer]) => selectedLayers.has(layer))
    .map(([, role]) => role);
  if (!requestedRoles.length) return [];

  const statusMap = await sessionStatusPolicyService.getStatusMap(orgId || '', { includeInactive: true });
  const scheduleResult = await scheduleController.buildEventsForPersonAndRange({
    personId: effectivePersonId,
    startDate,
    endDate,
    reqUser,
    activeOrgId: orgId,
    statusMap
  });
  const events = Array.isArray(scheduleResult?.events) ? scheduleResult.events : [];

  const seen = new Set();
  const normalizedEvents = requestedRoles.flatMap((role) => {
    const roleEvents = scheduleController.filterScheduleEventsForRole(events, role);
    return (Array.isArray(roleEvents) ? roleEvents : [])
      .map((event) => normalizeScheduleEvent(event, role))
      .filter(Boolean)
      .filter((event) => {
        const key = `${event.id}|${event.date}|${event.startTime}|${event.endTime}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });

  (Array.isArray(events) ? events : [])
    .filter((event) => event?.eventType === 'school_activity' || event?.targetType === 'activity')
    .map((event) => {
      const eventRoles = Array.isArray(event?.roles) ? event.roles : [];
      const matchingRole = requestedRoles.find((role) => eventRoles.some((eventRole) => String(eventRole || '').trim().toLowerCase() === role));
      return normalizeScheduleEvent(event, matchingRole || requestedRoles[0] || 'activity');
    })
    .filter(Boolean)
    .forEach((event) => {
      const key = `${event.id}|${event.date}|${event.startTime}|${event.endTime}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalizedEvents.push(event);
    });

  return normalizedEvents;
}

async function getTimesheetDeadlineEvents({ reqUser, orgId, startDate, endDate } = {}) {
  const periods = await schoolDataService.fetchData('timesheetPeriods', { orgId__eq: orgId }, reqUser);
  return (Array.isArray(periods) ? periods : [])
    .filter((row) => rowBelongsToOrg(row, orgId))
    .filter((row) => String(row.status || 'open').trim().toLowerCase() !== 'processed')
    .map(normalizeTimesheetDeadlineEvent)
    .filter(Boolean)
    .filter((event) => inDateRange(event.date, startDate, endDate));
}

async function getCalendarEvents({
  reqUser,
  startDate,
  endDate,
  layers,
  personId,
  selectedPerson = null
} = {}) {
  const orgId = normalizeId(reqUser?.activeOrgId || reqUser?.organizationId || reqUser?.orgId);
  const safeStartDate = normalizeDate(startDate);
  const safeEndDate = normalizeDate(endDate);
  const selectedLayers = parseLayers(layers);
  const events = [];
  let publicActivityEvents = [];

  if (selectedLayers.has(LAYER_KEYS.DAYS_OFF)) {
    events.push(...await getHolidayEvents({ reqUser, orgId, startDate: safeStartDate, endDate: safeEndDate }));
  }

  if (selectedLayers.has(LAYER_KEYS.SCHOOL_PUBLIC_ACTIVITIES)) {
    publicActivityEvents = await getPublicSchoolActivityEvents({
      reqUser,
      orgId,
      startDate: safeStartDate,
      endDate: safeEndDate
    });
    events.push(...publicActivityEvents);
  }

  if (selectedLayers.has(LAYER_KEYS.MY_ASSIGNED_ACTIVITIES)) {
    events.push(...await getAssignedActivityEventsForPerson({
      reqUser,
      orgId,
      personId: normalizeId(personId),
      startDate: safeStartDate,
      endDate: safeEndDate
    }));
  }

  if (selectedLayers.has(LAYER_KEYS.TIMESHEET_DEADLINES)) {
    events.push(...await getTimesheetDeadlineEvents({
      reqUser,
      orgId,
      startDate: safeStartDate,
      endDate: safeEndDate
    }));
  }

  const publicActivityKeys = new Set(publicActivityEvents
    .filter(isPublicActivityEvent)
    .map(getActivityDuplicateKeyFromEvent)
    .filter(Boolean));

  const scheduleEvents = await getScheduleEvents({
    reqUser,
    orgId,
    personId,
    startDate: safeStartDate,
    endDate: safeEndDate,
    selectedLayers
  });
  events.push(...scheduleEvents.filter((event) => {
    if (!isPublicActivityEvent(event)) return true;
    const duplicateKey = getActivityDuplicateKeyFromEvent(event);
    return !duplicateKey || !publicActivityKeys.has(duplicateKey);
  }));

  return {
    range: { startDate: safeStartDate, endDate: safeEndDate },
    selectedPerson,
    layers: Array.from(selectedLayers),
    events: events.sort(compareEvents)
  };
}

module.exports = {
  LAYER_KEYS,
  ACTIVITY_CATEGORY_LAYER_PREFIX,
  buildActivityCategoryLayerKey,
  buildActivityDuplicateKey,
  buildAssignedActivityTitle,
  getPublicSchoolActivityEvents,
  getAssignedActivityEventsForPerson,
  getCalendarEvents
};
