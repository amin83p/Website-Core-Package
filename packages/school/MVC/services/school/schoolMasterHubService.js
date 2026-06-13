const dataService = require('./schoolDataService');
const notificationService = require('./notificationService');
const personDisplayNameService = require('./personDisplayNameService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const accessService = requireCoreModule('MVC/services/security');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

const PEOPLE_MODULES = Object.freeze([
  {
    type: 'teachers',
    label: 'Teachers',
    singular: 'Teacher',
    sectionId: SECTIONS.SCHOOL_TEACHERS,
    entityType: 'teachers',
    icon: 'bi bi-person-workspace',
    color: 'text-success',
    directoryUrl: '/school/teachers'
  },
  {
    type: 'students',
    label: 'Students',
    singular: 'Student',
    sectionId: SECTIONS.SCHOOL_STUDENTS,
    entityType: 'students',
    icon: 'bi bi-person-vcard-fill',
    color: 'text-primary',
    directoryUrl: '/school/students'
  },
  {
    type: 'staff',
    label: 'Staff',
    singular: 'Staff',
    sectionId: SECTIONS.SCHOOL_STAFF,
    entityType: 'staff',
    icon: 'bi bi-people-fill',
    color: 'text-info',
    directoryUrl: '/school/staff'
  }
]);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function isArchived(moduleType, row) {
  const statusValue = moduleType === 'students'
    ? row?.academicStatus
    : row?.status;
  return lower(statusValue) === 'archived';
}

function buildPersonName(person) {
  const firstName = normalizeText(person?.name?.first || 'Unknown');
  const lastName = normalizeText(person?.name?.last || 'Person');
  return `${firstName} ${lastName}`.trim();
}

function enrichRows(moduleConfig, rows, persons, departments) {
  const personRows = Array.isArray(persons) ? persons : [];
  const deptById = new Map((Array.isArray(departments) ? departments : []).map((row) => [
    String(row?.id || ''),
    normalizeText(row?.name || row?.id || '-')
  ]));

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const person = personRows.find((candidate) => idsEqual(candidate?.id, row?.personId));
    const firstName = normalizeText(person?.name?.first || 'Unknown');
    const lastName = normalizeText(person?.name?.last || 'Person');
    const base = {
      id: normalizeText(row?.id),
      personId: normalizeText(row?.personId),
      firstName,
      lastName,
      name: buildPersonName(person),
      email: normalizeText(person?.contact?.email || 'N/A'),
      phone: normalizeText(person?.contact?.phones?.[0]?.number || 'N/A'),
      orgId: normalizeText(row?.orgId),
      directoryUrl: `${moduleConfig.directoryUrl}/edit/${encodeURIComponent(normalizeText(row?.id))}`,
      actions: [
        {
          label: 'Edit',
          icon: 'bi bi-pencil-square',
          tone: 'secondary',
          href: `${moduleConfig.directoryUrl}/edit/${encodeURIComponent(normalizeText(row?.id))}`
        },
        {
          label: 'Archive',
          icon: 'bi bi-archive',
          tone: 'warning',
          href: `${moduleConfig.directoryUrl}/archive/${encodeURIComponent(normalizeText(row?.id))}`
        },
        {
          label: 'Delete',
          icon: 'bi bi-trash',
          tone: 'danger',
          href: `${moduleConfig.directoryUrl}/delete/${encodeURIComponent(normalizeText(row?.id))}`
        }
      ]
    };

    if (moduleConfig.type === 'students') {
      return {
        ...base,
        status: normalizeText(row?.academicStatus || 'Active'),
        detail: normalizeText(row?.feeCategory || row?.studentAccountId || '-'),
        detailLabel: 'Fee / Account'
      };
    }

    return {
      ...base,
      status: normalizeText(row?.status || 'Active'),
      detail: deptById.get(String(row?.departmentId || '')) || '-',
      detailLabel: 'Department'
    };
  });
}

function rowMatchesSearch(row, searchTerm) {
  if (!searchTerm) return true;
  const haystack = [
    row.id,
    row.personId,
    row.firstName,
    row.lastName,
    row.name,
    row.email,
    row.phone,
    row.status,
    row.detail,
    row.orgId
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(searchTerm);
}

async function evaluateModuleAccess(req, moduleConfig) {
  const user = req?.user;
  if (!user || !moduleConfig?.sectionId) return { allowed: false, scopeId: '' };

  if (await adminAuthorityService.isAdminForRequestAsync(user, moduleConfig.sectionId, OPERATIONS.READ_ALL, {
    section: { id: moduleConfig.sectionId }
  })) {
    return { allowed: true, scopeId: '' };
  }

  const evaluation = await accessService.evaluateAccess({
    user,
    sectionId: moduleConfig.sectionId,
    operationId: OPERATIONS.READ_ALL,
    ipAddress: req?.ip
  });

  return {
    allowed: evaluation?.allowed === true,
    scopeId: normalizeText(evaluation?.scopeId)
  };
}

async function resolveAccessibleModules(req) {
  const modules = [];
  for (const moduleConfig of PEOPLE_MODULES) {
    // eslint-disable-next-line no-await-in-loop
    const access = await evaluateModuleAccess(req, moduleConfig);
    if (access.allowed) {
      modules.push({
        type: moduleConfig.type,
        label: moduleConfig.label,
        singular: moduleConfig.singular,
        sectionId: moduleConfig.sectionId,
        icon: moduleConfig.icon,
        color: moduleConfig.color,
        directoryUrl: moduleConfig.directoryUrl,
        scopeId: access.scopeId
      });
    }
  }
  return modules;
}

function findModule(type) {
  return PEOPLE_MODULES.find((item) => item.type === lower(type)) || null;
}

async function getPeoplePanelRows(type, queryInput, req) {
  const moduleConfig = findModule(type);
  if (!moduleConfig) {
    const error = new Error('Unknown people list requested.');
    error.statusCode = 400;
    throw error;
  }

  const access = await evaluateModuleAccess(req, moduleConfig);
  if (!access.allowed) {
    const error = new Error(`You do not have access to ${moduleConfig.label}.`);
    error.statusCode = 403;
    throw error;
  }

  const query = await buildDataServiceQuery(queryInput || {});
  const searchTerm = lower(query.q);
  if (searchTerm.length < 2) {
    const empty = paginate([], query);
    return {
      module: {
        type: moduleConfig.type,
        label: moduleConfig.label,
        singular: moduleConfig.singular,
        sectionId: moduleConfig.sectionId,
        icon: moduleConfig.icon,
        directoryUrl: moduleConfig.directoryUrl
      },
      rows: [],
      pagination: empty.pagination,
      total: 0,
      refreshedAt: new Date().toISOString(),
      minimumSearchLength: 2
    };
  }
  const fetchQuery = { ...query };
  delete fetchQuery.q;
  delete fetchQuery.type;
  delete fetchQuery.searchFields;
  delete fetchQuery.page;
  delete fetchQuery.limit;

  const [peopleRows, persons, departments] = await Promise.all([
    dataService.fetchData(moduleConfig.entityType, fetchQuery, req.user, { scopeId: access.scopeId }),
    dataServiceGlobal.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS),
    moduleConfig.type === 'students'
      ? Promise.resolve([])
      : dataService.fetchData('departments', {}, req.user)
  ]);

  const enriched = enrichRows(moduleConfig, peopleRows, persons, departments)
    .filter((row) => !isArchived(moduleConfig.type, row))
    .filter((row) => rowMatchesSearch(row, searchTerm));
  const { data, pagination } = paginate(enriched, {
    ...query,
    page: Number(query.page || 1),
    limit: Number(query.limit || 25)
  });

  return {
    module: {
      type: moduleConfig.type,
      label: moduleConfig.label,
      singular: moduleConfig.singular,
      sectionId: moduleConfig.sectionId,
      icon: moduleConfig.icon,
      directoryUrl: moduleConfig.directoryUrl
    },
    rows: data,
    pagination,
    total: enriched.length,
    refreshedAt: new Date().toISOString()
  };
}

const COMPLETE_NOTIFICATION_STATUSES = new Set(['resolved', 'dismissed']);
const COMPLETE_TASK_STATUSES = new Set(['done', 'cancelled']);

function hasIncompleteNotificationWork(notification) {
  if (!notification || typeof notification !== 'object') {
    return false;
  }

  if (!COMPLETE_NOTIFICATION_STATUSES.has(lower(notification.status || 'open'))) {
    return true;
  }

  const tasks = Array.isArray(notification.tasks) ? notification.tasks : [];
  return tasks.some((task) => !COMPLETE_TASK_STATUSES.has(lower(task?.status || 'open')));
}

function buildNotificationActionLinks(row) {
  const id = normalizeText(row?.id);
  const detailUrl = `/school/notifications/detail/${encodeURIComponent(id)}`;
  const status = lower(row?.status || 'open');
  const actions = [
    { label: 'Details', href: detailUrl, icon: 'bi bi-eye', tone: 'secondary' },
    { label: 'Tasks', href: detailUrl, icon: 'bi bi-list-task', tone: 'primary' }
  ];

  if (status === 'open') {
    actions.push({ label: 'Start', href: detailUrl, icon: 'bi bi-play-circle', tone: 'primary' });
  } else if (status === 'in_progress') {
    actions.push({ label: 'Resolve', href: detailUrl, icon: 'bi bi-check2-circle', tone: 'success' });
  } else {
    actions.push({ label: 'Reopen', href: detailUrl, icon: 'bi bi-arrow-counterclockwise', tone: 'warning' });
  }

  return actions;
}

function buildClassActionLinks(row) {
  const id = normalizeText(row?.id);
  const encodedId = encodeURIComponent(id);
  const lifecycleMode = lower(row?.registrationMode || 'term_based') === 'rolling' ? 'rolling' : 'term_based';
  const actions = [
    { label: 'Wizard', href: `/school/classes/edit-wizard/${encodedId}`, icon: 'bi bi-magic', tone: 'info' },
    { label: 'Edit', href: `/school/classes/edit/${encodedId}`, icon: 'bi bi-pencil-square', tone: 'primary' }
  ];

  if (lifecycleMode === 'rolling') {
    actions.unshift(
      { label: 'Enrollment', href: `/school/classes/${encodedId}/rolling-enrollment`, icon: 'bi bi-person-check', tone: 'primary' },
      { label: 'Rollover', href: `/school/classes/${encodedId}/cycle-rollover`, icon: 'bi bi-arrow-repeat', tone: 'warning' }
    );
  }

  return actions;
}

function normalizeScheduleLabel(schedule) {
  const current = schedule && typeof schedule === 'object' ? schedule.current : null;
  if (!current || typeof current !== 'object') return 'Not scheduled';
  const startDate = normalizeText(current.startDate);
  const endDate = normalizeText(current.endDate);
  const startTime = normalizeText(current.startTime);
  const endTime = normalizeText(current.endTime);
  const days = Array.isArray(current.daysOfWeek) ? current.daysOfWeek : [];
  const datePart = startDate || endDate ? `${startDate || '?'} -> ${endDate || 'Open'}` : '';
  const dayPart = days.length ? days.map((day) => normalizeText(day).slice(0, 3)).filter(Boolean).join(', ') : '';
  const timePart = startTime || endTime ? `${startTime || '?'} - ${endTime || '?'}` : '';
  return [datePart, dayPart, timePart].filter(Boolean).join(' | ') || 'Not scheduled';
}

function normalizeClassRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const lifecycleMode = lower(row?.registrationMode || 'term_based') === 'rolling' ? 'rolling' : 'term_based';
    const subjects = Array.isArray(row?.curriculum?.subjects) ? row.curriculum.subjects : [];
    return {
      id: normalizeText(row?.id),
      title: normalizeText(row?.title || row?.name || row?.id || 'Class'),
      status: normalizeText(row?.status || 'unknown'),
      orgId: normalizeText(row?.orgId),
      deliveryDepartmentName: normalizeText(row?.deliveryDepartmentName || row?.deliveryDepartmentId || ''),
      lifecycleMode,
      activePeriodCount: Number(row?.activePeriodCount || 0),
      openPeriodCount: Number(row?.openPeriodCount || 0),
      cycleNo: Number(row?.cycleNo || 1),
      cycleStartDate: normalizeText(row?.cycleStartDate),
      cycleEndDate: normalizeText(row?.cycleEndDate),
      isClosedForNewEnrollment: Boolean(row?.isClosedForNewEnrollment),
      scheduleLabel: normalizeScheduleLabel(row?.schedule),
      subjectLabels: subjects.map((subject) => normalizeText(subject?.code || subject?.subjectId)).filter(Boolean),
      totalHours: Number(row?.curriculum?.totalHours || 0),
      actions: buildClassActionLinks(row)
    };
  });
}

function objectSearchText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(objectSearchText).join(' ');
  if (typeof value === 'object') return Object.values(value).map(objectSearchText).join(' ');
  return normalizeText(value);
}

function rowMatchesWorkspaceSearch(row, searchTerm) {
  const term = lower(searchTerm);
  if (!term) return true;
  return lower(objectSearchText(row)).includes(term);
}

function normalizeNotificationRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id),
    title: normalizeText(row?.title || row?.id || 'Notification'),
    status: normalizeText(row?.status || 'open'),
    severity: normalizeText(row?.severity || 'info'),
    sourceType: normalizeText(row?.sourceType || ''),
    sourceId: normalizeText(row?.sourceId || ''),
    assignedRole: normalizeText(row?.assignedRole || ''),
    assignedPersonName: normalizeText(row?.assignedPersonName || row?.assignedPersonId || ''),
    dueDate: normalizeText(row?.dueDate || ''),
    taskCount: Array.isArray(row?.tasks) ? row.tasks.length : 0,
    incompleteTaskCount: (Array.isArray(row?.tasks) ? row.tasks : [])
      .filter((task) => !COMPLETE_TASK_STATUSES.has(lower(task?.status || 'open'))).length,
    actions: buildNotificationActionLinks(row)
  }));
}

function addRoleTokens(target, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => addRoleTokens(target, item));
    return;
  }
  const token = lower(value);
  if (!token) return;
  target.add(token);
  if (token.startsWith('member') && token.length > 'member'.length) {
    target.add(token.slice('member'.length));
  }
}

function getActiveUserRoleTokens(user) {
  const tokens = new Set();
  addRoleTokens(tokens, user?.roles);
  addRoleTokens(tokens, user?.role);

  const activeOrgId = normalizeText(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId);
  const memberships = Array.isArray(user?.organizations) ? user.organizations : [];
  memberships.forEach((membership) => {
    const membershipOrgId = normalizeText(membership?.orgId || membership?.organizationId || membership?.id);
    if (activeOrgId && membershipOrgId && !idsEqual(activeOrgId, membershipOrgId)) return;
    addRoleTokens(tokens, membership?.roles);
    addRoleTokens(tokens, membership?.role);
  });

  return tokens;
}

function isNotificationRelatedToActiveUser(row, user) {
  const personId = normalizeText(personDisplayNameService.getUserPersonId(user));
  const assignedPersonId = normalizeText(row?.assignedPersonId);
  if (personId && assignedPersonId && idsEqual(personId, assignedPersonId)) {
    return true;
  }

  const assignedRole = lower(row?.assignedRole);
  if (assignedRole && getActiveUserRoleTokens(user).has(assignedRole)) {
    return true;
  }

  return false;
}

async function getActiveUserNotifications(req, filters = {}) {
  const query = { ...(filters || {}) };
  delete query.assignment;
  const visibleNotifications = await notificationService.listVisibleNotifications(req.user, query);
  return (Array.isArray(visibleNotifications) ? visibleNotifications : [])
    .filter((row) => isNotificationRelatedToActiveUser(row, req.user));
}

async function getNotificationSummary(req) {
  const rows = await getActiveUserNotifications(req, { limit: 5000 });

  return {
    totalCount: rows.length,
    unresolvedCount: rows.filter(hasIncompleteNotificationWork).length,
    checkedAt: new Date().toISOString()
  };
}

async function getWorkspaceSection(sectionKey, queryInput, req) {
  const key = lower(sectionKey);
  const query = await buildDataServiceQuery(queryInput || {});

  if (key === 'classes') {
    const access = await evaluateModuleAccess(req, {
      label: 'Classes',
      sectionId: SECTIONS.SCHOOL_CLASSES
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Classes.');
      error.statusCode = 403;
      throw error;
    }
    const fetchQuery = {
      ...query,
      searchFields: query.searchFields || 'id,title,status,deliveryDepartmentName,deliveryDepartmentId,registrationMode,curriculum.subjects.code,curriculum.subjects.subjectId'
    };
    delete fetchQuery.page;
    delete fetchQuery.limit;
    const rows = await dataService.fetchData('classes', fetchQuery, req.user, { scopeId: access.scopeId });
    return {
      section: {
        key: 'classes',
        label: 'Classes',
        icon: 'bi bi-easel-fill',
        sourceUrl: '/school/classes'
      },
      rows: normalizeClassRows(rows),
      total: Array.isArray(rows) ? rows.length : 0,
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key !== 'notifications') {
    const error = new Error('This Master Hub section is not available on-page yet.');
    error.statusCode = 404;
    throw error;
  }

  const access = await evaluateModuleAccess(req, {
    label: 'Notifications',
    sectionId: SECTIONS.SCHOOL_NOTIFICATIONS
  });
  if (!access.allowed) {
    const error = new Error('You do not have access to Notifications.');
    error.statusCode = 403;
    throw error;
  }

  const notificationRows = await getActiveUserNotifications(req, queryInput || {});
  const rows = notificationRows.filter((row) => rowMatchesWorkspaceSearch(row, query.q || ''));

  return {
    section: {
      key: 'notifications',
      label: 'Notifications',
      icon: 'bi bi-bell-fill',
      sourceUrl: '/school/notifications'
    },
    rows: normalizeNotificationRows(rows),
    total: rows.length,
    unresolvedCount: rows.filter(hasIncompleteNotificationWork).length,
    searchQuery: normalizeText(query.q || ''),
    refreshedAt: new Date().toISOString()
  };
}

module.exports = {
  resolveAccessibleModules,
  getPeoplePanelRows,
  getNotificationSummary,
  getWorkspaceSection
};
