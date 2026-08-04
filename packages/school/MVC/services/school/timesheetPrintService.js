'use strict';

const schoolDataService = require('./schoolDataService');
const timesheetEffectiveEntryService = require('./timesheetEffectiveEntryService');
const { requireCoreModule } = require('./schoolCoreContracts');
const coreDataService = requireCoreModule('MVC/services/dataService');

const LEGACY_DISPLAY_FIELDS = Object.freeze([
  'classId',
  'className',
  'description',
  'activityId',
  'activityName',
  'categoryName',
  'deliveryDepartmentId',
  'deliveryDepartmentName',
  'deliveryDepartmentCode',
  'departmentId',
  'departmentName',
  'departmentCode',
  'isOneOnOne',
  'singleStudentId',
  'singleStudentPersonId',
  'singleStudentName',
  'singleStudentAttendance',
  'makeUpRequired',
  'showOptionalBadge',
  'room',
  'personRole',
  'isCoTeacherSession',
  'coTeacherRoleLabel'
]);
const LEGACY_BOOLEAN_DISPLAY_FIELDS = new Set([
  'isOneOnOne',
  'makeUpRequired',
  'showOptionalBadge',
  'isCoTeacherSession'
]);

function cleanText(value) {
  return String(value ?? '').trim();
}

function titleCase(value) {
  return cleanText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeStatus(value) {
  const status = cleanText(value).toLowerCase();
  if (status === 'approved') return 'submitted';
  return ['draft', 'submitted', 'processed'].includes(status) ? status : 'draft';
}

function managerApprovalIsCurrent(timesheet = {}) {
  const review = timesheet?.managerReview || {};
  return cleanText(review.status).toLowerCase() === 'approved'
    && Number(review.reviewVersion || 0) === Number(timesheet?.reviewVersion || 0);
}

function numberOrZero(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundHours(value) {
  return Number(numberOrZero(value).toFixed(2));
}

function clockMinutes(value) {
  const match = cleanText(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return Number.MAX_SAFE_INTEGER;
  }
  return (hours * 60) + minutes;
}

function calculateHoursFromRange(startTime, endTime) {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start === Number.MAX_SAFE_INTEGER || end === Number.MAX_SAFE_INTEGER || end <= start) return 0;
  return roundHours((end - start) / 60);
}

function sortEntriesBySchedule(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const dateCompare = cleanText(left.entry?.date).localeCompare(cleanText(right.entry?.date));
      if (dateCompare) return dateCompare;
      const startCompare = clockMinutes(left.entry?.startTime) - clockMinutes(right.entry?.startTime);
      if (startCompare) return startCompare;
      const endCompare = clockMinutes(left.entry?.endTime) - clockMinutes(right.entry?.endTime);
      if (endCompare) return endCompare;
      const idCompare = cleanText(left.entry?.sessionId).localeCompare(cleanText(right.entry?.sessionId));
      return idCompare || (left.index - right.index);
    })
    .map(({ entry }) => entry);
}

function resolveRequestedHours(entry = {}) {
  return roundHours(entry.requestedHours ?? entry.durationHours ?? entry.hours ?? entry.timesheetHours ?? 0);
}

function resolvePayableHours(entry = {}) {
  if (!entry || entry.isDeleted === true) return 0;
  const approvalStatus = cleanText(entry.approvalStatus).toLowerCase();
  if (entry.excludeFromTotals === true || ['pending_approval', 'rejected', 'unpaid'].includes(approvalStatus)) return 0;
  if (entry.isManual === true || entry.isPriorPeriodAdjustment === true) return resolveRequestedHours(entry);
  const formulaHours = Number(entry.timesheetHours);
  if (Number.isFinite(formulaHours)) return roundHours(formulaHours);
  return roundHours(entry.durationHours ?? entry.hours ?? 0);
}

function resolveOptionalHours(entry = {}) {
  if (entry.showOptionalBadge !== true) return 0;
  const duration = numberOrZero(entry.durationHours);
  if (duration > 0) return roundHours(duration);
  const scheduled = calculateHoursFromRange(entry.startTime, entry.endTime);
  if (scheduled > 0) return scheduled;
  const payable = resolvePayableHours(entry);
  return payable > 0 ? payable : 0;
}

function fillLegacyDisplayMetadata(snapshotEntry = {}, liveEntry = {}) {
  const merged = { ...(liveEntry || {}), ...(snapshotEntry || {}) };
  const snapshotHasDisplayIdentity = Boolean(
    cleanText(snapshotEntry.deliveryDepartmentCode || snapshotEntry.departmentCode)
    || cleanText(snapshotEntry.singleStudentId || snapshotEntry.singleStudentPersonId || snapshotEntry.singleStudentName)
  );
  LEGACY_DISPLAY_FIELDS.forEach((field) => {
    const snapshotValue = snapshotEntry?.[field];
    const isMissing = snapshotValue === undefined || snapshotValue === null || snapshotValue === '';
    const isLegacyDefaultBoolean = !snapshotHasDisplayIdentity
      && LEGACY_BOOLEAN_DISPLAY_FIELDS.has(field)
      && snapshotValue === false
      && liveEntry?.[field] === true;
    if ((isMissing || isLegacyDefaultBoolean) && liveEntry?.[field] !== undefined) merged[field] = liveEntry[field];
  });
  return merged;
}

function resolveAuthoritativeEntries(effective = {}) {
  const timesheet = effective?.timesheet || null;
  const status = normalizeStatus(timesheet?.status || 'draft');
  const snapshotEntries = Array.isArray(timesheet?.submissionSnapshot?.entries)
    ? timesheet.submissionSnapshot.entries
    : [];
  const useFrozenSnapshot = ['submitted', 'processed'].includes(status) && snapshotEntries.length > 0;
  if (!useFrozenSnapshot) {
    return {
      status,
      source: 'live',
      entries: (Array.isArray(effective?.entries) ? effective.entries : []).filter((entry) => entry?.isDeleted !== true)
    };
  }

  const liveBySessionId = new Map((Array.isArray(effective?.liveEntries) ? effective.liveEntries : [])
    .map((entry) => [cleanText(entry?.sessionId), entry])
    .filter(([sessionId]) => Boolean(sessionId)));
  return {
    status,
    source: 'snapshot',
    entries: snapshotEntries
      .filter((entry) => entry?.isDeleted !== true)
      .map((entry) => fillLegacyDisplayMetadata(entry, liveBySessionId.get(cleanText(entry?.sessionId))))
  };
}

function buildDateKeys(startDate, endDate) {
  const start = cleanText(startDate);
  const end = cleanText(endDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return [];
  const cursor = new Date(`${start}T12:00:00.000Z`);
  const stop = new Date(`${end}T12:00:00.000Z`);
  const output = [];
  while (cursor <= stop && output.length < 400) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function formatDateKey(dateKey, options) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(dateKey))) return cleanText(dateKey);
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' })
    .format(new Date(`${dateKey}T12:00:00.000Z`));
}

function formatDateTime(value, timeZone = '') {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return cleanText(value);
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  if (cleanText(timeZone)) options.timeZone = cleanText(timeZone);
  try {
    return new Intl.DateTimeFormat('en-CA', options).format(parsed);
  } catch (_) {
    delete options.timeZone;
    return new Intl.DateTimeFormat('en-CA', options).format(parsed);
  }
}

function buildLookupMaps(effective = {}) {
  const classMap = new Map((Array.isArray(effective.classes) ? effective.classes : [])
    .map((row) => [cleanText(row?.id), row])
    .filter(([id]) => Boolean(id)));
  const departmentMap = new Map((Array.isArray(effective.departments) ? effective.departments : [])
    .map((row) => [cleanText(row?.id), row])
    .filter(([id]) => Boolean(id)));
  return { classMap, departmentMap };
}

function resolveDepartmentMeta(entry = {}, lookups = {}) {
  const classRow = lookups.classMap?.get(cleanText(entry.classId)) || {};
  const id = cleanText(
    entry.deliveryDepartmentId || entry.departmentId || classRow.deliveryDepartmentId || classRow.departmentId
  );
  const department = lookups.departmentMap?.get(id) || {};
  const code = cleanText(
    entry.deliveryDepartmentCode || entry.departmentCode || classRow.deliveryDepartmentCode
    || classRow.departmentCode || department.code
  );
  const name = cleanText(
    entry.deliveryDepartmentName || entry.departmentName || classRow.deliveryDepartmentName
    || classRow.departmentName || department.name || department.title || code || id
  );
  return { id, code, name: name || 'No Department' };
}

function isActivityEntry(entry = {}) {
  const sessionId = cleanText(entry.sessionId).toLowerCase();
  return entry.isSchoolActivity === true || Boolean(cleanText(entry.activityId)) || sessionId.startsWith('act-');
}

function resolveStatusLabel(entry = {}) {
  if (entry.isPriorPeriodAdjustment === true) return 'Prior Period Adjustment';
  if (entry.isReportReflection === true) return 'Report Task';
  const approval = cleanText(entry.approvalStatus).toLowerCase();
  if (approval === 'pending_approval') return 'Pending Approval';
  if (approval === 'rejected') return 'Rejected';
  if (approval === 'unpaid') return 'Unpaid';
  if (entry.isManual === true && approval === 'approved') return 'Approved';
  if (entry.isManual === true && !cleanText(entry.status)) return 'Manual';
  return titleCase(entry.status || (entry.isManual === true ? 'manual' : '')) || '-';
}

function shapePrintEntry(entry = {}, lookups = {}) {
  const department = resolveDepartmentMeta(entry, lookups);
  const requestedHours = resolveRequestedHours(entry);
  const payableHours = resolvePayableHours(entry);
  const optionalHours = resolveOptionalHours(entry);
  const approval = cleanText(entry.approvalStatus).toLowerCase();
  let payableNote = '';
  if (approval === 'pending_approval') payableNote = '0.00 hrs payable (pending)';
  else if (approval === 'rejected') payableNote = '0.00 hrs payable (rejected)';
  else if (approval === 'unpaid') payableNote = '0.00 hrs payable (unpaid)';

  const isActivity = isActivityEntry(entry);
  const fallback = cleanText(entry.description || entry.className || entry.activityName || entry.classId || 'Activity');
  const name = cleanText(isActivity
    ? (entry.activityName || entry.className || entry.description)
    : (entry.className || entry.description));
  const primaryLabel = department.code || fallback;
  let timeLabel = '';
  if (entry.isPriorPeriodAdjustment === true) {
    const referenceDate = cleanText(entry?.adjustmentMeta?.sourceSessionDate || entry.date);
    timeLabel = `Prior period correction${referenceDate ? ` · Ref: ${referenceDate}` : ''}`;
  } else {
    const startTime = cleanText(entry.startTime);
    const endTime = cleanText(entry.endTime);
    timeLabel = startTime ? `${startTime}${endTime ? ` – ${endTime}` : ''}` : 'Manual time';
  }

  return {
    ...entry,
    department,
    primaryLabel,
    secondaryLabel: name && name !== primaryLabel ? name : '',
    isActivity,
    requestedHours,
    payableHours,
    optionalHours,
    hoursLabel: `${(payableNote ? requestedHours : payableHours).toFixed(2)} hrs`,
    payableNote,
    hoursIsStruck: Boolean(payableNote),
    timeLabel,
    statusLabel: resolveStatusLabel(entry),
    studentName: cleanText(entry.singleStudentName || entry.studentName),
    attendanceLabel: titleCase(entry.singleStudentAttendance || entry.attendance),
    commentLabel: cleanText(entry.comment),
    isOneOnOne: entry.isOneOnOne === true,
    showOptionalBadge: entry.showOptionalBadge === true,
    roleLabel: titleCase(entry.isCoTeacherSession ? entry.coTeacherRoleLabel : entry.personRole)
  };
}

function buildDepartmentTotals(entries = []) {
  const buckets = new Map();
  entries.forEach((entry) => {
    const pendingHours = cleanText(entry.approvalStatus).toLowerCase() === 'pending_approval'
      ? entry.requestedHours
      : 0;
    if (entry.payableHours === 0 && pendingHours === 0 && entry.optionalHours === 0) return;
    const key = entry.department?.name || 'No Department';
    const bucket = buckets.get(key) || { departmentName: key, payableHours: 0, pendingHours: 0, optionalHours: 0 };
    bucket.payableHours = roundHours(bucket.payableHours + entry.payableHours);
    bucket.pendingHours = roundHours(bucket.pendingHours + pendingHours);
    bucket.optionalHours = roundHours(bucket.optionalHours + entry.optionalHours);
    buckets.set(key, bucket);
  });
  const rows = [...buckets.values()]
    .map((row) => ({ ...row, totalHours: roundHours(row.payableHours + row.pendingHours) }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  const totals = rows.reduce((sum, row) => ({
    payableHours: roundHours(sum.payableHours + row.payableHours),
    pendingHours: roundHours(sum.pendingHours + row.pendingHours),
    optionalHours: roundHours(sum.optionalHours + row.optionalHours),
    totalHours: roundHours(sum.totalHours + row.totalHours)
  }), { payableHours: 0, pendingHours: 0, optionalHours: 0, totalHours: 0 });
  return { rows, totals };
}

async function buildTimesheetPrintDocument({ period, person, activeOrgId, reqUser, holidays = null }) {
  const personId = cleanText(person?.id || person?.personId);
  const effective = await timesheetEffectiveEntryService.buildEffectiveTimesheetEntries({
    period,
    personId,
    activeOrgId,
    reqUser
  });
  const authoritative = resolveAuthoritativeEntries(effective);
  const lookups = buildLookupMaps(effective);
  const entries = sortEntriesBySchedule(authoritative.entries)
    .map((entry) => shapePrintEntry(entry, lookups));
  const entriesByDate = new Map();
  entries.forEach((entry) => {
    const date = cleanText(entry.date);
    if (!entriesByDate.has(date)) entriesByDate.set(date, []);
    entriesByDate.get(date).push(entry);
  });
  const holidayRows = Array.isArray(holidays)
    ? holidays
    : await schoolDataService.fetchData('holidays', {}, reqUser);
  const holidayMap = new Map((Array.isArray(holidayRows) ? holidayRows : [])
    .filter((row) => cleanText(row?.date) >= cleanText(period.startDate) && cleanText(row?.date) <= cleanText(period.endDate))
    .map((row) => [cleanText(row?.date), row]));
  const days = buildDateKeys(period.startDate, period.endDate).map((date) => ({
    date,
    dayName: formatDateKey(date, { weekday: 'long' }),
    dateLabel: formatDateKey(date, { month: 'long', day: 'numeric' }),
    holidayName: cleanText(holidayMap.get(date)?.name || holidayMap.get(date)?.title),
    entries: entriesByDate.get(date) || []
  }));
  const timesheet = effective.timesheet || {};
  const departmentTotals = buildDepartmentTotals(entries);
  return {
    person: {
      id: personId,
      name: cleanText(person?.name || person?.displayName) || personId
    },
    status: authoritative.status,
    statusLabel: titleCase(authoritative.status),
    isDraft: authoritative.status === 'draft',
    managerApproved: managerApprovalIsCurrent(timesheet),
    source: authoritative.source,
    submittedAt: cleanText(timesheet?.submissionSnapshot?.submittedAt),
    approvedAt: cleanText(timesheet?.managerReview?.approvedAt || timesheet?.approvedAt),
    processedAt: cleanText(timesheet?.processedAt),
    days,
    entries,
    departmentTotals,
    payableTotalHours: roundHours(entries.reduce((sum, entry) => sum + entry.payableHours, 0))
  };
}

function resolveOrganizationNameFromContext(reqUser = {}, activeOrgId = '') {
  const targetOrgId = cleanText(activeOrgId);
  const allowedOrg = (Array.isArray(reqUser.allowedOrgs) ? reqUser.allowedOrgs : [])
    .find((row) => cleanText(row?.orgId || row?.id) === targetOrgId);
  return cleanText(
    reqUser.activeOrgName
    || allowedOrg?.name
    || allowedOrg?.orgName
    || allowedOrg?.organizationName
    || allowedOrg?.identity?.displayName
    || reqUser.activeOrganization?.identity?.displayName
    || reqUser.activeOrganization?.identity?.legalName
    || reqUser.activeOrganization?.name
    || reqUser.activeOrg?.identity?.displayName
    || reqUser.activeOrg?.identity?.legalName
    || reqUser.activeOrg?.name
  );
}

function resolveOrganizationNameFromRow(organization = {}) {
  return cleanText(
    organization?.identity?.displayName
    || organization?.identity?.legalName
    || organization?.name
    || organization?.orgName
    || organization?.organizationName
  );
}

async function resolveOrganizationName(reqUser = {}, activeOrgId = '') {
  const contextName = resolveOrganizationNameFromContext(reqUser, activeOrgId);
  const targetOrgId = cleanText(activeOrgId);
  if (!targetOrgId || targetOrgId.toUpperCase() === 'SYSTEM') return contextName;
  try {
    const organization = await coreDataService.getDataById('organizations', targetOrgId, reqUser);
    return resolveOrganizationNameFromRow(organization) || contextName;
  } catch (_) {
    return contextName;
  }
}

async function buildTimesheetPrintContext({
  period,
  people,
  activeOrgId,
  reqUser,
  printedByName = '',
  orgTimeZone = ''
}) {
  const documents = [];
  const [holidays, organizationName] = await Promise.all([
    schoolDataService.fetchData('holidays', {}, reqUser),
    resolveOrganizationName(reqUser, activeOrgId)
  ]);
  for (const person of (Array.isArray(people) ? people : [])) {
    // Deliberately sequential to avoid multiplying class/enrollment reads for large batches.
    // eslint-disable-next-line no-await-in-loop
    documents.push(await buildTimesheetPrintDocument({ period, person, activeOrgId, reqUser, holidays }));
  }
  const printedAtIso = new Date().toISOString();
  return {
    organizationName,
    printedByName: cleanText(printedByName),
    printedAtIso,
    printedAtLabel: formatDateTime(printedAtIso, orgTimeZone),
    period: {
      id: cleanText(period?.id),
      name: cleanText(period?.name || period?.id),
      startDate: cleanText(period?.startDate),
      endDate: cleanText(period?.endDate),
      startDateLabel: formatDateKey(period?.startDate, { year: 'numeric', month: 'long', day: 'numeric' }),
      endDateLabel: formatDateKey(period?.endDate, { year: 'numeric', month: 'long', day: 'numeric' }),
      deadlineLabel: period?.submissionDeadline
        ? `${cleanText(period.submissionDeadline)} ${cleanText(period.submissionDeadlineTime || '23:59')}`
        : '-'
    },
    documents
  };
}

module.exports = {
  buildTimesheetPrintContext,
  buildTimesheetPrintDocument,
  buildDepartmentTotals,
  buildDateKeys,
  calculateHoursFromRange,
  fillLegacyDisplayMetadata,
  formatDateKey,
  resolveAuthoritativeEntries,
  resolveOptionalHours,
  resolveOrganizationNameFromContext,
  resolvePayableHours,
  shapePrintEntry,
  sortEntriesBySchedule
};
