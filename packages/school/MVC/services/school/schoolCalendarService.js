const { requireCoreModule } = require('./schoolCoreContracts');
const schoolDataService = require('./schoolDataService');
const activityService = require('./activityService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const scheduleController = require('../../controllers/school/scheduleController');

const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const LAYER_KEYS = Object.freeze({
  DAYS_OFF: 'school_days_off',
  PD_PAYABLE: 'pd_payable',
  PD_UNPAYABLE: 'pd_unpayable',
  SCHEDULE_TEACHER: 'schedule_teacher',
  SCHEDULE_STAFF: 'schedule_staff',
  SCHEDULE_STUDENT: 'schedule_student',
  TIMESHEET_DEADLINES: 'timesheet_deadlines'
});

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

function parseLayers(value) {
  if (Array.isArray(value)) return new Set(value.map(normalizeId).filter(Boolean));
  return new Set(String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean));
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

function activityLooksProfessionalDevelopment(activity = {}) {
  const haystack = [
    activity.categoryName,
    activity.category,
    activity.categoryId,
    activity.type,
    activity.title,
    activity.name,
    activity.description
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return /\b(pd|professional development|professional-development|professional_development|staff development|training)\b/i.test(haystack);
}

function compareEvents(a, b) {
  return String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.startTime || '').localeCompare(String(b.startTime || ''))
    || String(a.title || '').localeCompare(String(b.title || ''));
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

function normalizeActivityEvent(activity, subtype) {
  const date = normalizeDate(activity.date || activity.activityDate || activity.startDate);
  if (!date) return null;
  const id = normalizeId(activity.id || activity._id || activity.activityId || date);
  return {
    id: `activity-${id}`,
    sourceId: id,
    date,
    startTime: normalizeTime(activity.startTime),
    endTime: normalizeTime(activity.endTime),
    title: activity.title || activity.name || 'School Professional Development',
    type: 'school_activity',
    layer: 'professional_development',
    subtype,
    tone: subtype === 'payable' ? 'success' : 'info',
    detailsUrl: `/school/activities/edit/${encodeURIComponent(id)}`,
    meta: {
      source: 'activities',
      categoryName: activity.categoryName || '',
      departmentName: activity.departmentName || '',
      durationHours: activity.durationHours || '',
      paid: subtype === 'payable',
      notes: activity.notes || ''
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
  const tone = isActivity
    ? (event.paid === true ? 'success' : 'info')
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

async function getProfessionalDevelopmentEvents({ reqUser, orgId, startDate, endDate, includePayable, includeUnpayable } = {}) {
  const activities = await activityService.listActivities({ orgId, reqUser });
  return (Array.isArray(activities) ? activities : [])
    .filter((row) => rowBelongsToOrg(row, orgId))
    .filter((row) => normalizeDate(row.date || row.activityDate || row.startDate))
    .filter((row) => inDateRange(row.date || row.activityDate || row.startDate, startDate, endDate))
    .filter((row) => String(row.status || 'posted').toLowerCase() === 'posted')
    .filter(activityLooksProfessionalDevelopment)
    .map((row) => {
      const isPayable = normalizeBoolean(row.paid || row.isPaid || row.payable);
      if (isPayable && !includePayable) return null;
      if (!isPayable && !includeUnpayable) return null;
      return normalizeActivityEvent(row, isPayable ? 'payable' : 'unpayable');
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

  if (selectedLayers.has(LAYER_KEYS.DAYS_OFF)) {
    events.push(...await getHolidayEvents({ reqUser, orgId, startDate: safeStartDate, endDate: safeEndDate }));
  }

  if (selectedLayers.has(LAYER_KEYS.PD_PAYABLE) || selectedLayers.has(LAYER_KEYS.PD_UNPAYABLE)) {
    events.push(...await getProfessionalDevelopmentEvents({
      reqUser,
      orgId,
      startDate: safeStartDate,
      endDate: safeEndDate,
      includePayable: selectedLayers.has(LAYER_KEYS.PD_PAYABLE),
      includeUnpayable: selectedLayers.has(LAYER_KEYS.PD_UNPAYABLE)
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

  events.push(...await getScheduleEvents({
    reqUser,
    orgId,
    personId,
    startDate: safeStartDate,
    endDate: safeEndDate,
    selectedLayers
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
  getCalendarEvents
};
