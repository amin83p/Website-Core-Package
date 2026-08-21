'use strict';

const schoolDataService = require('./schoolDataService');
const timesheetEffectiveEntryService = require('./timesheetEffectiveEntryService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
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
  'classMaxCapacity',
  'singleStudentId',
  'singleStudentPersonId',
  'singleStudentName',
  'singleStudentAttendance',
  'makeUpRequired',
  'makeupDurationPercent',
  'allowedDurationHours',
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

function resolveOptionalScheduledBaseHours(entry = {}) {
  const duration = numberOrZero(entry.durationHours);
  if (duration > 0) return duration;
  const scheduled = calculateHoursFromRange(entry.startTime, entry.endTime);
  if (scheduled > 0) return scheduled;
  const payable = resolvePayableHours(entry);
  return payable > 0 ? payable : 0;
}

function resolveOptionalHours(entry = {}) {
  if (entry.showOptionalBadge !== true) return 0;
  const baseHours = resolveOptionalScheduledBaseHours(entry);
  if (baseHours <= 0) return 0;
  if (entry.makeUpRequired === true) {
    const allowed = numberOrZero(entry.allowedDurationHours);
    if (allowed > 0) return roundHours(allowed);
    return roundHours(sessionStatusPolicyService.calculateMakeupSessionDurationHours(
      baseHours,
      entry.makeupDurationPercent ?? 100
    ));
  }
  return roundHours(baseHours);
}

function resolveRegularDisplayHours(entry = {}, payableHours = 0) {
  if (resolveOptionalHours(entry) > 0) return 0;
  return roundHours(payableHours);
}

function parsePrintReviewType(value) {
  return cleanText(value).toLowerCase() === 'financial' ? 'financial' : 'managerial';
}

function resolvePrintReviewTitle(printReviewType = 'managerial') {
  return parsePrintReviewType(printReviewType) === 'financial'
    ? 'Financial Review'
    : 'Managerial Review';
}

function isWeekendDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(dateKey))) return false;
  const weekday = new Date(`${cleanText(dateKey)}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function filterDaysForPrintReview(days = [], printReviewType = 'managerial') {
  if (parsePrintReviewType(printReviewType) !== 'financial') {
    return Array.isArray(days) ? days.slice() : [];
  }
  return (Array.isArray(days) ? days : []).filter((day) => {
    const entries = Array.isArray(day?.entries) ? day.entries : [];
    if (entries.length > 0) return true;
    return !isWeekendDateKey(day?.date);
  });
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
  if (approval === 'pending_approval') payableNote = '0.00 payable (pending)';
  else if (approval === 'rejected') payableNote = '0.00 payable (rejected)';
  else if (approval === 'unpaid') payableNote = '0.00 payable (unpaid)';

  const regularDisplayHours = resolveRegularDisplayHours(entry, payableHours);
  const usesOptionalColumn = optionalHours > 0;
  let regularHoursLabel = '—';
  let hoursIsStruck = false;
  if (payableNote) {
    regularHoursLabel = requestedHours.toFixed(2);
    hoursIsStruck = true;
  } else if (!usesOptionalColumn) {
    regularHoursLabel = regularDisplayHours.toFixed(2);
  }
  const optionalHoursLabel = optionalHours > 0 ? optionalHours.toFixed(2) : '—';

  const isActivity = isActivityEntry(entry);
  const fallback = cleanText(entry.description || entry.className || entry.activityName || entry.classId || 'Activity');
  const name = cleanText(isActivity
    ? (entry.activityName || entry.className || entry.description)
    : (entry.className || entry.description));
  const primaryLabel = department.code || fallback;
  let timeLabel = '';
  if (entry.isPriorPeriodAdjustment === true) {
    const referenceDate = cleanText(entry?.adjustmentMeta?.sourceSessionDate || entry.date);
    const baselineStatus = titleCase(entry?.adjustmentMeta?.baselineStatus);
    const finalStatus = titleCase(entry?.adjustmentMeta?.finalStatus || entry?.adjustmentMeta?.currentStatus);
    const reason = titleCase(entry?.adjustmentMeta?.reconciliationReason);
    const auditParts = [
      referenceDate ? `Ref: ${referenceDate}` : '',
      baselineStatus || finalStatus ? `${baselineStatus || 'Unknown'} -> ${finalStatus || 'Removed'}` : '',
      reason
    ].filter(Boolean);
    timeLabel = `Prior period correction${auditParts.length ? ` - ${auditParts.join(' - ')}` : ''}`;
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
    regularDisplayHours,
    regularHoursLabel,
    optionalHoursLabel,
    scheduleLabel: timeLabel,
    payableNote,
    hoursIsStruck,
    timeLabel,
    statusLabel: resolveStatusLabel(entry),
    showReconciliationBadge: entry.reconciliationRequired === true,
    studentName: cleanText(entry.singleStudentName || entry.studentName),
    attendanceLabel: titleCase(entry.singleStudentAttendance || entry.attendance),
    commentLabel: cleanText(entry.comment),
    isOneOnOne: entry.isOneOnOne === true,
    showOptionalBadge: entry.showOptionalBadge === true,
    roleLabel: titleCase(entry.isCoTeacherSession ? entry.coTeacherRoleLabel : entry.personRole)
  };
}

function resolveClassMaxCapacity(classRow = {}) {
  const raw = classRow?.enrollment?.maxCapacity ?? classRow?.maxCapacity ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDepartmentOneOnOneEntry(entry = {}, classRow = {}) {
  if (entry?.isSchoolActivity === true || entry?.isActivity === true || cleanText(entry?.activityId)) return false;
  const sessionId = cleanText(entry?.sessionId).toLowerCase();
  if (sessionId.startsWith('act-')) return false;
  const capacity = Number(entry?.classMaxCapacity ?? resolveClassMaxCapacity(classRow));
  if (capacity === 1) return true;
  return entry.isOneOnOne === true;
}

function isDepartmentOptionalClassEntry(entry = {}, classRow = {}) {
  if (!isDepartmentOneOnOneEntry(entry, classRow)) return false;
  return entry.showOptionalBadge === true;
}

function resolveDepartmentOptionalHours(entry = {}, classRow = {}) {
  if (!isDepartmentOptionalClassEntry(entry, classRow)) return 0;
  return resolveOptionalHours(entry);
}

function buildDepartmentTotals(entries = [], lookups = {}) {
  const buckets = new Map();
  entries.forEach((entry) => {
    const pendingHours = cleanText(entry.approvalStatus).toLowerCase() === 'pending_approval'
      ? entry.requestedHours
      : 0;
    const payableHours = entry.payableHours || 0;
    const classRow = lookups.classMap?.get(cleanText(entry.classId)) || {};
    const departmentOptionalHours = resolveDepartmentOptionalHours(entry, classRow);
    if (payableHours === 0 && pendingHours === 0 && departmentOptionalHours === 0) return;
    const key = entry.department?.code || entry.department?.name || 'No Department';
    const isOneOnOne = isDepartmentOneOnOneEntry(entry, classRow);
    const bucket = buckets.get(key) || {
      departmentName: key,
      departmentCode: entry.department?.code || '',
      groupHours: 0,
      oneOnOneHours: 0,
      oneOnOneOptionalHours: 0,
      groupPendingHours: 0,
      oneOnOnePendingHours: 0
    };
    if (isOneOnOne) {
      const regularPayableHours = departmentOptionalHours > 0 ? 0 : payableHours;
      bucket.oneOnOneHours = roundHours(bucket.oneOnOneHours + regularPayableHours);
      bucket.oneOnOnePendingHours = roundHours(bucket.oneOnOnePendingHours + pendingHours);
    } else {
      bucket.groupHours = roundHours(bucket.groupHours + payableHours);
      bucket.groupPendingHours = roundHours(bucket.groupPendingHours + pendingHours);
    }
    if (departmentOptionalHours > 0) {
      bucket.oneOnOneOptionalHours = roundHours(bucket.oneOnOneOptionalHours + departmentOptionalHours);
    }
    buckets.set(key, bucket);
  });
  const rows = [...buckets.values()]
    .map((row) => ({
      ...row,
      totalHours: roundHours(
        row.groupHours
        + row.oneOnOneHours
        + row.oneOnOneOptionalHours
        + row.groupPendingHours
        + row.oneOnOnePendingHours
      )
    }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  const totals = rows.reduce((sum, row) => ({
    groupHours: roundHours(sum.groupHours + row.groupHours),
    oneOnOneHours: roundHours(sum.oneOnOneHours + row.oneOnOneHours),
    oneOnOneOptionalHours: roundHours(sum.oneOnOneOptionalHours + row.oneOnOneOptionalHours),
    groupPendingHours: roundHours(sum.groupPendingHours + row.groupPendingHours),
    oneOnOnePendingHours: roundHours(sum.oneOnOnePendingHours + row.oneOnOnePendingHours),
    totalHours: roundHours(sum.totalHours + row.totalHours)
  }), {
    groupHours: 0,
    oneOnOneHours: 0,
    oneOnOneOptionalHours: 0,
    groupPendingHours: 0,
    oneOnOnePendingHours: 0,
    totalHours: 0
  });
  return { rows, totals };
}

function buildShapedPrintEntriesFromEffective(effective = {}) {
  const authoritative = resolveAuthoritativeEntries(effective);
  const lookups = buildLookupMaps(effective);
  const entries = sortEntriesBySchedule(authoritative.entries)
    .map((entry) => shapePrintEntry(entry, lookups));
  return { authoritative, lookups, entries };
}

function buildDepartmentTotalsFromEffective(effective = {}) {
  const { lookups, entries } = buildShapedPrintEntriesFromEffective(effective);
  return buildDepartmentTotals(entries, lookups);
}

async function buildTimesheetPrintDocument({
  period,
  person,
  activeOrgId,
  reqUser,
  holidays = null,
  printReviewType = 'managerial'
}) {
  const normalizedReviewType = parsePrintReviewType(printReviewType);
  const personId = cleanText(person?.id || person?.personId);
  const effective = await timesheetEffectiveEntryService.buildEffectiveTimesheetEntries({
    period,
    personId,
    activeOrgId,
    reqUser
  });
  const { authoritative, entries } = buildShapedPrintEntriesFromEffective(effective);
  const entriesByDate = new Map();
  entries.forEach((entry) => {
    const date = cleanText(entry.date);
    if (!entriesByDate.has(date)) entriesByDate.set(date, []);
    entriesByDate.get(date).push(entry);
  });
  const holidayRows = Array.isArray(holidays)
    ? holidays
    : await schoolDataService.fetchAllData('holidays', {}, reqUser);
  const holidayMap = new Map((Array.isArray(holidayRows) ? holidayRows : [])
    .filter((row) => cleanText(row?.date) >= cleanText(period.startDate) && cleanText(row?.date) <= cleanText(period.endDate))
    .map((row) => [cleanText(row?.date), row]));
  const days = filterDaysForPrintReview(
    buildDateKeys(period.startDate, period.endDate).map((date) => {
      const shortMonth = formatDateKey(date, { month: 'short' });
      return {
        date,
        dayName: `${formatDateKey(date, { weekday: 'short' })}.`,
        dateLabel: `${shortMonth}. ${formatDateKey(date, { day: 'numeric' })}`,
        holidayName: cleanText(holidayMap.get(date)?.name || holidayMap.get(date)?.title),
        entries: entriesByDate.get(date) || []
      };
    }),
    normalizedReviewType
  );
  const timesheet = effective.timesheet || {};
  const departmentTotals = buildDepartmentTotalsFromEffective(effective);
  const reconciliationEntries = entries.filter((entry) => entry.reconciliationRequired === true);
  const provisionalEntries = reconciliationEntries.filter((entry) => entry.isProvisional === true);
  const makeupChains = Array.isArray(timesheet?.priorPeriodReconciliation?.makeupChains)
    ? timesheet.priorPeriodReconciliation.makeupChains
    : [];
  const openMakeupChains = makeupChains.filter((chain) => chain?.state === 'open');
  const openMakeupNodes = openMakeupChains
    .flatMap((chain) => Array.isArray(chain?.nodes) ? chain.nodes : [])
    .filter((node) => Array.isArray(node?.openReasons) && node.openReasons.length > 0);
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
    printReviewType: normalizedReviewType,
    days,
    entries,
    departmentTotals,
    reconciliationEntryCount: reconciliationEntries.length,
    provisionalEntryCount: provisionalEntries.length,
    provisionalHours: roundHours(provisionalEntries.reduce((sum, entry) => sum + entry.payableHours, 0)),
    makeupState: cleanText(timesheet?.priorPeriodReconciliation?.makeupState || 'none'),
    makeupChainCount: makeupChains.length,
    openMakeupChainCount: openMakeupChains.length,
    openMakeupNodeCount: openMakeupNodes.length,
    payableTotalHours: roundHours(entries.reduce((sum, entry) => sum + entry.payableHours, 0)),
    regularTotalHours: roundHours(entries.reduce((sum, entry) => sum + (entry.regularDisplayHours || 0), 0)),
    optionalTotalHours: roundHours(entries.reduce((sum, entry) => sum + (entry.optionalHours || 0), 0))
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
  orgTimeZone = '',
  printReviewType = 'managerial'
}) {
  const normalizedReviewType = parsePrintReviewType(printReviewType);
  const documents = [];
  const [holidays, organizationName] = await Promise.all([
    schoolDataService.fetchAllData('holidays', {}, reqUser),
    resolveOrganizationName(reqUser, activeOrgId)
  ]);
  for (const person of (Array.isArray(people) ? people : [])) {
    // Deliberately sequential to avoid multiplying class/enrollment reads for large batches.
    // eslint-disable-next-line no-await-in-loop
    documents.push(await buildTimesheetPrintDocument({
      period,
      person,
      activeOrgId,
      reqUser,
      holidays,
      printReviewType: normalizedReviewType
    }));
  }
  const printedAtIso = new Date().toISOString();
  return {
    organizationName,
    printedByName: cleanText(printedByName),
    printedAtIso,
    printedAtLabel: formatDateTime(printedAtIso, orgTimeZone),
    printReviewType: normalizedReviewType,
    printReviewTitle: resolvePrintReviewTitle(normalizedReviewType),
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
  buildDepartmentTotalsFromEffective,
  buildShapedPrintEntriesFromEffective,
  buildDateKeys,
  calculateHoursFromRange,
  fillLegacyDisplayMetadata,
  formatDateKey,
  isDepartmentOneOnOneEntry,
  isDepartmentOptionalClassEntry,
  resolveAuthoritativeEntries,
  resolveClassMaxCapacity,
  resolveDepartmentOptionalHours,
  resolveOptionalHours,
  resolveOrganizationNameFromContext,
  parsePrintReviewType,
  resolvePayableHours,
  resolvePrintReviewTitle,
  resolveRegularDisplayHours,
  filterDaysForPrintReview,
  isWeekendDateKey,
  shapePrintEntry,
  sortEntriesBySchedule
};
