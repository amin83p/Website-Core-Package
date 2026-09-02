const activityService = require('./activityService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const activityWorkSessionService = require('./activityWorkSessionService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeStatus(value, fallback = '') {
  return String(value || fallback || '').trim().toLowerCase();
}

function getUserPersonId(reqUser = {}) {
  return normalizeId(
    reqUser.personId
    || reqUser.person?.id
    || reqUser.person?._id
    || reqUser.profile?.personId
    || reqUser.account?.personId
  );
}

function isWorkSessionAdminViewer(reqUser) {
  return schoolAdminAccessService.isWorkSessionsAdminViewer(reqUser)
    || schoolAdminAccessService.isActivitiesAdminViewer(reqUser);
}

async function buildWorkSessionExplorerViewer(req) {
  const reqUser = req?.user || {};
  const isAdminViewer = isWorkSessionAdminViewer(reqUser);

  if (isAdminViewer) {
    return {
      isAdminViewer: true,
      canFilterByPerson: true,
      lockedPersonId: '',
      lockedPersonName: ''
    };
  }

  const personId = getUserPersonId(reqUser);
  let lockedPersonName = '';

  if (personId) {
    const personById = await schoolPersonAccessService.buildPersonByIdMap({ reqUser });
    const person = personById.get(personId);
    lockedPersonName = person
      ? schoolPersonAccessService.formatPersonName(person, '')
      : String(reqUser?.displayName || reqUser?.name || reqUser?.username || personId).trim();
  }

  return {
    isAdminViewer: false,
    canFilterByPerson: false,
    lockedPersonId: personId,
    lockedPersonName
  };
}

function parseIdList(value) {
  const source = Array.isArray(value) ? value : [value];
  return source
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDateOrNull(value, label) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`);
  }
  return normalized;
}

function normalizeFilters(query = {}) {
  const q = String(query.q || '').trim().toLowerCase();
  const startDate = normalizeDateOrNull(query.startDate, 'startDate');
  const endDate = normalizeDateOrNull(query.endDate, 'endDate');
  const activityId = query.activityId ? String(query.activityId).trim() : '';
  const evaluationType = normalizeStatus(query.evaluationType);
  const status = normalizeStatus(query.status);
  const personIds = parseIdList(query.personId);
  const personId = personIds.join(',');

  if (startDate && endDate && startDate > endDate) {
    throw new Error('startDate cannot be after endDate.');
  }

  return {
    q,
    startDate,
    endDate,
    activityId,
    evaluationType,
    status,
    personId,
    personIds
  };
}

function applyViewerPersonFilters(filters, viewer = {}) {
  if (viewer.isAdminViewer) return filters;

  if (viewer.lockedPersonId) {
    const lockedIds = [viewer.lockedPersonId];
    return {
      ...filters,
      personIds: lockedIds,
      personId: lockedIds.join(',')
    };
  }

  return {
    ...filters,
    personIds: [],
    personId: ''
  };
}

function rowMatchesSearch(row, q) {
  if (!q) return true;
  return [
    row.activityTitle,
    row.sessionTitle,
    row.personName,
    row.date,
    row.statusLabel,
    row.evaluationTypeLabel,
    row.activityId,
    row.entryId,
    row.personId
  ]
    .map((token) => String(token || '').toLowerCase())
    .some((token) => token.includes(q));
}

function rowMatchesStatusFilter(row, statusFilter) {
  if (!statusFilter) return true;
  const normalized = normalizeStatus(row.statusCode || row.statusLabel);
  if (statusFilter === 'completed') {
    return normalized === 'completed' || normalized === 'attendance_recorded';
  }
  if (statusFilter === 'pending') {
    return normalized === 'pending' || normalized === 'pending_attendance';
  }
  return normalized === statusFilter;
}

function buildRowStatusCode(activity, assignee) {
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  if (evaluationType === 'completion') {
    return normalizeStatus(assignee.completionStatus, 'pending');
  }
  return normalizeStatus(assignee.status) ? 'attendance_recorded' : 'pending_attendance';
}

function buildManageUrl(activityId, entryId) {
  return activityWorkSessionService.buildSessionManageUrl(activityId, entryId);
}

function buildCompleteUrl(activityId, entryId) {
  return `/school/activities/${encodeURIComponent(normalizeId(activityId))}/work-sessions/${encodeURIComponent(normalizeId(entryId))}/complete`;
}

function buildPendingUrl(activityId, entryId) {
  return `/school/activities/${encodeURIComponent(normalizeId(activityId))}/work-sessions/${encodeURIComponent(normalizeId(entryId))}/pending`;
}

async function listWorkSessions(req, query = {}) {
  const viewer = await buildWorkSessionExplorerViewer(req);
  const accessContext = schoolRecordAccessService.buildRouteAccessContext(req);
  const access = schoolRecordAccessService.resolveAccessFromRequest(req);
  const filters = applyViewerPersonFilters(normalizeFilters(query), viewer);
  const orgId = String(req?.user?.activeOrgId || '').trim();
  const scopedPersonId = normalizeId(access.personId || req?.user?.personId);

  const activities = await activityService.listActivities({
    orgId,
    reqUser: req.user,
    accessContext
  });

  let rows = [];

  for (const activity of (Array.isArray(activities) ? activities : [])) {
    if (normalizeStatus(activity.status) !== 'posted') continue;
    if (filters.activityId && !idsEqual(activity.id, filters.activityId)) continue;

    const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
    if (filters.evaluationType && evaluationType !== filters.evaluationType) continue;

    const entries = activityWorkSessionService.listAccessiblePostedEntries(activity, access);

    entries.forEach((entry, index) => {
      if (filters.startDate && String(entry.date || '') < filters.startDate) return;
      if (filters.endDate && String(entry.date || '') > filters.endDate) return;

      const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
      let visibleAssignees = assignees;

      if (viewer.lockedPersonId) {
        visibleAssignees = assignees.filter((assignee) => idsEqual(assignee.personId, viewer.lockedPersonId));
      } else if (filters.personIds.length) {
        visibleAssignees = assignees.filter((assignee) => (
          filters.personIds.some((personFilterId) => idsEqual(assignee.personId, personFilterId))
        ));
      } else if (!viewer.isAdminViewer) {
        visibleAssignees = [];
      }

      visibleAssignees.forEach((assignee) => {
        const enriched = activityWorkSessionService.enrichAssigneeRow(activity, assignee, {
          entry,
          reqUser: req.user,
          access,
          scopedPersonId
        });
        const statusCode = buildRowStatusCode(activity, assignee);
        const statusLabel = enriched.completionLabel;
        const row = {
          id: `${normalizeId(activity.id)}:${normalizeId(entry.entryId)}:${normalizeId(assignee.personId)}`,
          activityId: activity.id,
          activityTitle: activity.title || activity.name || activity.id,
          entryId: entry.entryId,
          sessionTitle: activityWorkSessionService.buildEntryDisplayTitle(entry, index),
          date: entry.date || '',
          startTime: entry.startTime || '',
          endTime: entry.endTime || '',
          evaluationType,
          evaluationTypeLabel: evaluationType === 'completion' ? 'Completion' : 'Attendance',
          statusCode,
          statusLabel,
          payable: enriched.readyForTimesheet === true,
          locked: enriched.locked === true,
          editable: enriched.editable === true,
          isSelf: enriched.isSelf === true,
          personId: assignee.personId,
          personName: assignee.personName || assignee.personId || 'Unknown',
          role: assignee.role || 'participant',
          manageUrl: buildManageUrl(activity.id, entry.entryId),
          completeUrl: buildCompleteUrl(activity.id, entry.entryId),
          pendingUrl: buildPendingUrl(activity.id, entry.entryId),
          canQuickComplete: evaluationType === 'completion'
            && enriched.editable === true
            && !enriched.locked
            && enriched.isSelf === true
        };

        if (!rowMatchesStatusFilter(row, filters.status)) return;
        if (!rowMatchesSearch(row, filters.q)) return;
        rows.push(row);
      });
    });
  }

  rows.sort((a, b) => {
    const first = new Date(`${a.date || '1970-01-01'}T${a.startTime || '00:00'}`);
    const second = new Date(`${b.date || '1970-01-01'}T${b.startTime || '00:00'}`);
    return first - second;
  });

  return {
    data: rows,
    rows,
    total: rows.length,
    pagination: {
      currentPage: 1,
      totalPages: 1,
      totalItems: rows.length,
      limit: rows.length
    },
    filters,
    viewer
  };
}

module.exports = {
  listWorkSessions,
  normalizeFilters,
  buildWorkSessionExplorerViewer,
  applyViewerPersonFilters,
  isWorkSessionAdminViewer
};
