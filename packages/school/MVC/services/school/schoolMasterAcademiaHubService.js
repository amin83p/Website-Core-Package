const dataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const taskService = require('./taskService');
const leaveRequestService = require('./leaveRequestService');
const activityService = require('./activityService');
const reportViewService = require('./reportViewService');
const personDisplayNameService = require('./personDisplayNameService');
const sessionExplorerService = require('./sessionExplorerService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const schoolIndexService = require('./schoolIndexService');
const sessionStudentCaseModel = require('../../models/school/sessionStudentCaseModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const { buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const accessService = requireCoreModule('MVC/services/security');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

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

function normalizeDateOnly(value, label = 'date') {
  const token = normalizeText(value);
  if (!token) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`);
  return token;
}

function normalizeClock(value, label = 'time') {
  const token = normalizeText(value);
  if (!token) return '';
  if (!/^\d{2}:\d{2}$/.test(token)) throw new Error(`Invalid ${label}. Use HH:mm.`);
  return token;
}

function normalizeBooleanInput(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const token = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return Boolean(fallback);
}

function parseSessionRefs(input) {
  return (Array.isArray(input) ? input : [])
    .map((row) => ({
      classId: toPublicId(row?.classId),
      sessionId: toPublicId(row?.sessionId)
    }))
    .filter((row) => row.classId && row.sessionId);
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function getHubActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function isArchived(moduleType, row) {
  const statusValue = moduleType === 'students'
    ? row?.academicStatus
    : row?.status;
  return lower(statusValue) === 'archived';
}

function buildPersonName(person) {
  return schoolPersonAccessService.formatPersonName(person, 'Unknown Person');
}

function enrichRows(moduleConfig, rows, personById, departments) {
  const deptById = new Map((Array.isArray(departments) ? departments : []).map((row) => [
    String(row?.id || ''),
    normalizeText(row?.name || row?.id || '-')
  ]));

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const person = personById instanceof Map ? personById.get(toPublicId(row?.personId)) : null;
    const firstName = normalizeText(person?.name?.first || person?.firstName || 'Unknown');
    const lastName = normalizeText(person?.name?.last || person?.lastName || 'Person');
    const base = {
      id: normalizeText(row?.id),
      personId: normalizeText(row?.personId),
      firstName,
      lastName,
      name: buildPersonName(person),
      email: normalizeText(schoolPersonAccessService.readPersonEmail(person) || 'N/A'),
      phone: normalizeText(person?.contact?.phones?.[0]?.number || 'N/A'),
      orgId: normalizeText(row?.orgId),
      directoryUrl: `${moduleConfig.directoryUrl}/edit/${encodeURIComponent(normalizeText(row?.id))}`,
      actions: [
        {
          label: 'Current Month Schedule',
          icon: 'bi bi-calendar-month',
          tone: 'info',
          command: 'person-current-month-schedule',
          recordId: normalizeText(row?.id),
          personId: normalizeText(row?.personId),
          personName: buildPersonName(person),
          role: normalizeText(moduleConfig.singular).toLowerCase(),
          roleLabel: normalizeText(moduleConfig.singular)
        },
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
      const encodedStudentId = encodeURIComponent(normalizeText(row?.id));
      return {
        ...base,
        status: normalizeText(row?.academicStatus || 'Active'),
        detail: normalizeText(row?.feeCategory || row?.studentAccountId || '-'),
        detailLabel: 'Fee / Account',
        actions: [
          {
            label: 'Student Overview Ledger',
            icon: 'bi bi-journal-bookmark-fill',
            tone: 'primary',
            href: `/school/academic-ledger/student-overview/${encodedStudentId}`
          },
          ...base.actions
        ]
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
  const operationId = moduleConfig.operationId || OPERATIONS.READ_ALL;

  if (await adminAuthorityService.isAdminForRequestAsync(user, moduleConfig.sectionId, operationId, {
    section: { id: moduleConfig.sectionId }
  })) {
    return { allowed: true, scopeId: '' };
  }

  const evaluation = await accessService.evaluateAccess({
    user,
    sectionId: moduleConfig.sectionId,
    operationId,
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

  const [peopleRows, departments] = await Promise.all([
    dataService.fetchData(moduleConfig.entityType, fetchQuery, req.user, { scopeId: access.scopeId }),
    moduleConfig.type === 'students'
      ? Promise.resolve([])
      : dataService.fetchData('departments', {}, req.user)
  ]);
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser: req.user,
    personIds: (Array.isArray(peopleRows) ? peopleRows : []).map((row) => row.personId)
  });

  const enriched = enrichRows(moduleConfig, peopleRows, personById, departments)
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

const COMPLETE_TASK_STATUSES = new Set(['resolved', 'dismissed']);
const COMPLETE_TASK_ASSIGNMENT_STATUSES = new Set(['done', 'cancelled']);

function hasIncompleteTaskWork(task) {
  if (!task || typeof task !== 'object') {
    return false;
  }

  if (!COMPLETE_TASK_STATUSES.has(lower(task.status || 'open'))) {
    return true;
  }

  const assignments = Array.isArray(task.tasks) ? task.tasks : [];
  return assignments.some((assignment) => !COMPLETE_TASK_ASSIGNMENT_STATUSES.has(lower(assignment?.status || 'open')));
}

function buildTaskActionLinks(row) {
  const id = normalizeText(row?.id);
  const detailUrl = `/school/tasks/detail/${encodeURIComponent(id)}`;
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

function normalizeInstructorStatus(value = '') {
  return lower(value || 'active') || 'active';
}

function resolveDefaultTeacherName(row) {
  const instructors = Array.isArray(row?.instructors) ? row.instructors : [];
  const active = instructors.filter((instructor) => !['archived', 'inactive', 'deleted', 'removed'].includes(normalizeInstructorStatus(instructor?.status)));
  const candidates = active.length ? active : instructors;
  const selected = candidates.find((instructor) => {
    const role = lower(instructor?.role || instructor?.type || '');
    return instructor?.default === true
      || instructor?.isDefault === true
      || instructor?.primary === true
      || instructor?.isPrimary === true
      || role.includes('primary')
      || role.includes('default');
  }) || candidates[0] || null;
  return normalizeText(
    selected?.name
    || selected?.displayName
    || selected?.teacherName
    || selected?.personName
    || selected?.personId
    || row?.defaultTeacherName
    || row?.teacherName
    || row?.primaryTeacherName
    || row?.defaultTeacherId
    || row?.primaryTeacherId
  ) || 'Unassigned';
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
      defaultTeacherName: resolveDefaultTeacherName(row),
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

function normalizeTaskRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id),
    title: normalizeText(row?.title || row?.id || 'Task'),
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
    actions: buildTaskActionLinks(row)
  }));
}

function buildLeaveRequestActionLinks(row) {
  const id = normalizeText(row?.id);
  const encodedId = encodeURIComponent(id);
  const status = lower(row?.status || 'submitted');
  const actions = [
    { label: 'Details', href: `/school/leave-requests/detail/${encodedId}`, icon: 'bi bi-eye', tone: 'secondary' }
  ];

  if (!['rejected', 'cancelled'].includes(status)) {
    actions.push({ label: 'Edit', href: `/school/leave-requests/edit/${encodedId}`, icon: 'bi bi-pencil-square', tone: 'primary' });
  }

  return actions;
}

function buildHolidayActionLinks(row) {
  if (!row) return [];
  return [
    { label: 'Edit', action: 'edit', icon: 'bi bi-pencil-square', tone: 'primary' },
    { label: 'Delete', action: 'delete', icon: 'bi bi-trash', tone: 'danger' }
  ];
}

function buildTimesheetPeriodActionLinks(row) {
  const id = normalizeText(row?.id);
  const encodedId = encodeURIComponent(id);
  return [
    { label: 'Edit', href: `/school/timesheetPeriods/edit/${encodedId}`, icon: 'bi bi-pencil-square', tone: 'primary' },
    { label: 'Delete', href: `/school/timesheetPeriods/delete/${encodedId}`, icon: 'bi bi-trash', tone: 'danger' }
  ];
}

function buildActivityActionLinks(row) {
  const id = normalizeText(row?.id);
  if (!id) return [];
  const encodedId = encodeURIComponent(id);
  const actions = [
    { label: 'Edit', href: `/school/activities/edit/${encodedId}`, icon: 'bi bi-pencil-square', tone: 'primary' },
    { label: 'Open List', href: '/school/activities', icon: 'bi bi-box-arrow-up-right', tone: 'secondary' }
  ];
  if (String(row?.status || '').toLowerCase() === 'posted') {
    const entries = activityService.getActivityEntries(row);
    const hasPostedEntry = entries.some((entry) => String(entry.status || 'posted').toLowerCase() === 'posted');
    if (hasPostedEntry) {
      actions.unshift({
        label: 'Manage',
        href: `/school/activities/${encodedId}/work-sessions/manage`,
        icon: 'bi bi-kanban',
        tone: 'success'
      });
    }
  }
  return actions;
}

function normalizeActivityAssignee(row = {}) {
  return {
    personId: normalizeText(row.personId),
    personName: normalizeText(row.personName || row.displayName || row.name || row.personId || ''),
    role: normalizeText(row.role || ''),
    status: lower(row.status || 'attended'),
    paid: row.paid !== false,
    paidHours: Number(row.paidHours || 0)
  };
}

function normalizeActivityRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const entries = activityService.getActivityEntries(row);
    const allowedPersonIds = splitFilterIds(row?.allowedPersonIds || row?.allowedPersons || '');
    const excludedPersonIds = splitFilterIds(row?.excludedPersonIds || row?.excludedPersons || '');
    const entryExcludedCount = entries.reduce((sum, entry) => (
      sum + splitFilterIds(entry?.excludedPersonIds || entry?.excludedPersons || '').length
    ), 0);
    const dateValues = entries.map((entry) => normalizeText(entry.date)).filter(Boolean).sort();
    const firstDate = dateValues[0] || normalizeText(row?.date || '');
    const lastDate = dateValues[dateValues.length - 1] || firstDate;
    const entryAssignees = entries.flatMap((entry) => (
      Array.isArray(entry.assignees) ? entry.assignees : []
    ).map(normalizeActivityAssignee));
    const legacyAssignees = (Array.isArray(row?.attendees) ? row.attendees : []).map(normalizeActivityAssignee);
    const assigneeMap = new Map();
    [...legacyAssignees, ...entryAssignees].forEach((assignee) => {
      if (!assignee.personId) return;
      const existing = assigneeMap.get(assignee.personId);
      if (!existing) {
        assigneeMap.set(assignee.personId, assignee);
        return;
      }
      const paidHours = Number(existing.paidHours || 0) + Number(assignee.paidHours || 0);
      assigneeMap.set(assignee.personId, {
        ...existing,
        personName: existing.personName || assignee.personName,
        role: existing.role || assignee.role,
        paid: existing.paid || assignee.paid,
        paidHours: Number(paidHours.toFixed(2))
      });
    });
    const assignees = [...assigneeMap.values()];
    const totalDurationHours = Number((entries.reduce((sum, entry) => (
      sum + (Number(entry.durationHours) || activityService.calculateDurationHours(entry.startTime, entry.endTime) || 0)
    ), 0) || row?.totalDurationHours || row?.durationHours || 0).toFixed(2));
    const visibilityScope = activityService.normalizeActivityVisibilityScope(row?.visibilityScope || row?.scope || row?.calendarScope);
    const hasPersonControls = allowedPersonIds.length > 0 || excludedPersonIds.length > 0 || entryExcludedCount > 0;

    return {
      id: normalizeText(row?.id),
      title: normalizeText(row?.title || row?.name || row?.id || 'Activity'),
      categoryId: normalizeText(row?.categoryId),
      categoryName: normalizeText(row?.categoryName || row?.categoryId || ''),
      departmentId: normalizeText(row?.departmentId),
      departmentName: normalizeText(row?.departmentName || row?.departmentId || ''),
      location: normalizeText(row?.location || ''),
      status: lower(row?.status || 'draft'),
      paid: row?.paid === true,
      visibilityScope,
      allowedPersonIds,
      excludedPersonIds,
      allowedPersonCount: allowedPersonIds.length,
      excludedPersonCount: excludedPersonIds.length,
      entryExcludedCount,
      hasPersonControls,
      personControlState: hasPersonControls ? 'restricted' : 'open',
      firstDate,
      lastDate,
      dateLabel: firstDate && lastDate && firstDate !== lastDate ? `${firstDate} to ${lastDate}` : (firstDate || '-'),
      startTime: normalizeText(row?.startTime || entries[0]?.startTime || ''),
      endTime: normalizeText(row?.endTime || entries[0]?.endTime || ''),
      sessionCount: entries.length || 1,
      assigneeCount: assignees.length,
      assignees,
      assigneeNames: assignees.map((assignee) => assignee.personName || assignee.personId).filter(Boolean),
      totalDurationHours,
      notes: normalizeText(row?.notes || ''),
      editUrl: `/school/activities/edit/${encodeURIComponent(normalizeText(row?.id))}`,
      actions: buildActivityActionLinks(row)
    };
  });
}

function buildReportAssignmentActionLinks(row) {
  const id = normalizeText(row?.id);
  if (!id) return [];
  const encodedId = encodeURIComponent(id);
  const actions = [
    { label: 'Edit', href: `/school/reports/assignments/edit/${encodedId}`, icon: 'bi bi-pencil-square', tone: 'secondary' },
    { label: 'Instances', href: `/school/reports/instances?assignmentId=${encodedId}`, icon: 'bi bi-file-earmark-text', tone: 'primary' }
  ];
  const firstTeacherId = normalizeText(Array.isArray(row?.teacherIds) ? row.teacherIds[0] : '');
  if (firstTeacherId) {
    const firstTargetRow = reportViewService.getEffectiveAssignmentRows(row)[0] || null;
    const rowId = normalizeText(firstTargetRow?.rowId || row?.assignmentRowId || '');
    const params = new URLSearchParams();
    params.set('teacherId', firstTeacherId);
    if (rowId) params.set('rowId', rowId);
    actions.push({
      label: 'Start',
      href: `/school/reports/instances/start/${encodedId}?${params.toString()}`,
      icon: 'bi bi-play-circle',
      tone: 'success'
    });
  }
  return actions;
}

function normalizeReportAssignmentRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id),
    classId: normalizeText(row?.classId),
    classTitle: normalizeText(row?.classTitle || row?.classId || '-'),
    classLifecycle: row?.classLifecycle && typeof row.classLifecycle === 'object' ? row.classLifecycle : {},
    templateId: normalizeText(row?.templateId),
    templateTitle: normalizeText(row?.templateTitle || row?.templateId || '-'),
    templateVersion: Number(row?.templateVersion || 1) || 1,
    targetType: normalizeText(row?.targetType || 'date'),
    targetDate: normalizeText(row?.targetDate || row?.sessionDate || row?.dueDate || ''),
    reportScope: normalizeText(row?.reportScope || 'class'),
    targetStudentCount: Number(row?.targetStudentCount || 0),
    taskTimeRange: normalizeText(row?.taskTimeRange || ''),
    reportStartDate: normalizeText(row?.reportStartDate || ''),
    reportDueDate: normalizeText(row?.reportDueDate || ''),
    teacherIds: Array.isArray(row?.teacherIds) ? row.teacherIds.map((value) => normalizeText(value)).filter(Boolean) : [],
    status: lower(row?.status || 'active'),
    actions: buildReportAssignmentActionLinks(row)
  }));
}

function buildReportInstanceActionLinks(row) {
  const assignmentId = normalizeText(row?.assignmentId);
  const teacherId = normalizeText(row?.teacherId);
  const studentId = normalizeText(row?.studentId);
  const instanceId = normalizeText(row?.id);
  if (row?.isPendingAssignment === true) {
    const actions = [];
    if (assignmentId && teacherId) {
      const params = new URLSearchParams();
      params.set('teacherId', teacherId);
      if (row?.assignmentRowId) params.set('rowId', normalizeText(row.assignmentRowId));
      if (studentId) params.set('studentId', studentId);
      const startUrl = `/school/reports/instances/start/${encodeURIComponent(assignmentId)}?${params.toString()}`;
      actions.push({ label: 'Start', href: startUrl, icon: 'bi bi-play-circle', tone: 'primary' });
    }
    if (assignmentId) {
      actions.push({ label: 'Assignment', href: `/school/reports/assignments/edit/${encodeURIComponent(assignmentId)}`, icon: 'bi bi-pencil-square', tone: 'secondary' });
    }
    return actions;
  }

  if (!instanceId) return [];
  const encodedInstanceId = encodeURIComponent(instanceId);
  const actions = [
    { label: 'Open', href: `/school/reports/instances/edit/${encodedInstanceId}`, icon: 'bi bi-box-arrow-up-right', tone: 'secondary' },
    { label: 'Open V2', href: `/school/reports/instances/edit-v2/${encodedInstanceId}`, icon: 'bi bi-layout-text-window-reverse', tone: 'primary' },
    { label: 'Payload', href: `/school/reports/instances/export/${encodedInstanceId}?download=1`, icon: 'bi bi-download', tone: 'secondary' }
  ];
  if (row?.hasDocxTemplate) {
    actions.splice(1, 0, {
      label: 'DOCX',
      href: `/school/reports/instances/export/${encodedInstanceId}?format=docx&download=1`,
      icon: 'bi bi-filetype-docx',
      tone: 'primary'
    });
  }
  return actions;
}

function normalizeReportInstanceRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id),
    isPendingAssignment: row?.isPendingAssignment === true,
    assignmentId: normalizeText(row?.assignmentId),
    assignmentRowId: normalizeText(row?.assignmentRowId),
    classId: normalizeText(row?.classId),
    classTitle: normalizeText(row?.classTitle || row?.classId || '-'),
    classLifecycle: row?.classLifecycle && typeof row.classLifecycle === 'object' ? row.classLifecycle : {},
    sessionId: normalizeText(row?.sessionId || ''),
    sessionDate: normalizeText(row?.sessionDate || ''),
    reportDueDate: normalizeText(row?.reportDueDate || ''),
    templateId: normalizeText(row?.templateId),
    templateTitle: normalizeText(row?.templateTitle || row?.templateId || '-'),
    templateVersion: Number(row?.templateVersion || 1) || 1,
    teacherId: normalizeText(row?.teacherId),
    teacherName: normalizeText(row?.teacherName || row?.teacherId || '-'),
    studentId: normalizeText(row?.studentId),
    studentRecordId: normalizeText(row?.studentRecordId || ''),
    studentName: normalizeText(row?.studentName || (row?.studentId ? row.studentId : 'Whole class')),
    status: lower(row?.status || 'draft'),
    hasDocxTemplate: row?.hasDocxTemplate === true,
    actions: buildReportInstanceActionLinks(row)
  }));
}

function activityMatchesFilters(row, queryInput = {}, searchTerm = '') {
  const status = lower(queryInput.status || '');
  const categoryId = normalizeText(queryInput.categoryId || '');
  const departmentId = normalizeText(queryInput.departmentId || '');
  const rawScope = normalizeText(queryInput.visibilityScope || queryInput.scope || '');
  const visibilityScope = rawScope ? activityService.normalizeActivityVisibilityScope(rawScope) : '';
  const paid = lower(queryInput.paid || '');
  const dateFrom = normalizeText(queryInput.dateFrom || queryInput.startDate || '');
  const dateTo = normalizeText(queryInput.dateTo || queryInput.endDate || '');
  const assigneePersonId = normalizeText(queryInput.assigneePersonId || queryInput.personId || '');
  const personControl = lower(queryInput.personControl || '');

  if (status && lower(row.status) !== status) return false;
  if (categoryId && !idsEqual(row.categoryId, categoryId)) return false;
  if (departmentId && !idsEqual(row.departmentId, departmentId)) return false;
  if (visibilityScope && row.visibilityScope !== visibilityScope) return false;
  if (paid === 'paid' && row.paid !== true) return false;
  if (paid === 'unpaid' && row.paid === true) return false;
  if ((dateFrom || dateTo) && !row.firstDate) return false;
  if ((dateFrom || dateTo) && !dateRangeOverlaps(row.firstDate, row.lastDate || row.firstDate, dateFrom, dateTo)) return false;
  if (assigneePersonId && !row.assignees.some((assignee) => idsEqual(assignee.personId, assigneePersonId))) return false;
  if (personControl === 'restricted' && row.hasPersonControls !== true) return false;
  if (personControl === 'open' && row.hasPersonControls === true) return false;

  return rowMatchesWorkspaceSearch(row, searchTerm);
}

function sortActivityRows(rows) {
  const statusRank = new Map([
    ['posted', 0],
    ['draft', 1],
    ['cancelled', 2]
  ]);
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const dateDelta = String(b.firstDate || '').localeCompare(String(a.firstDate || ''));
    if (dateDelta) return dateDelta;
    const statusDelta = (statusRank.get(a.status) ?? 9) - (statusRank.get(b.status) ?? 9);
    if (statusDelta) return statusDelta;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function resolveHolidayYear(value, orgToday = '') {
  const candidate = normalizeText(value);
  if (/^\d{4}$/.test(candidate)) return candidate;
  const today = String(orgToday || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(today)) return today.slice(0, 4);
  return resolveOrgTodayFromContext({ orgToday }).slice(0, 4);
}

function buildHolidayYearOptions(selectedYear, orgToday = '') {
  const selected = Number(resolveHolidayYear(selectedYear, orgToday));
  const years = new Set();
  for (let year = selected - 2; year <= selected + 3; year += 1) {
    years.add(String(year));
  }
  years.add(String(resolveHolidayYear('', orgToday)));
  return Array.from(years).sort();
}

function normalizeLeaveRequestRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const startDate = normalizeText(row?.startDate);
    const endDate = normalizeText(row?.endDate || row?.startDate);
    const allDay = row?.allDay !== false;
    const timeLabel = allDay ? 'All day' : `${normalizeText(row?.startTime || '--:--')} - ${normalizeText(row?.endTime || '--:--')}`;
    return {
      id: normalizeText(row?.id),
      requesterName: normalizeText(row?.requesterName || row?.requesterPersonId || '-'),
      requesterPersonId: normalizeText(row?.requesterPersonId),
      requesterRole: normalizeText(row?.requesterRole || '-'),
      status: normalizeText(row?.status || 'submitted'),
      reason: normalizeText(row?.reason || '-'),
      requestDate: normalizeText(row?.requestDate || row?.audit?.createDateTime || ''),
      startDate,
      endDate,
      windowLabel: startDate && endDate && endDate !== startDate ? `${startDate} to ${endDate}` : (startDate || '-'),
      timeLabel,
      revisionNo: Number(row?.revisionNo || 1),
      actions: buildLeaveRequestActionLinks(row)
    };
  });
}

function normalizeHolidayRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: normalizeText(row?.id),
    date: normalizeText(row?.date),
    title: normalizeText(row?.title || row?.name || 'Holiday'),
    type: normalizeText(row?.type || 'Holiday'),
    notes: normalizeText(row?.notes || ''),
    orgId: normalizeText(row?.orgId || ''),
    actions: buildHolidayActionLinks(row)
  }));
}

function normalizeTimesheetPeriodRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const submissionDeadlineTime = normalizeText(row?.submissionDeadlineTime || '23:59');
    return {
      id: normalizeText(row?.id),
      name: normalizeText(row?.name || row?.title || row?.id || 'Timesheet Period'),
      startDate: normalizeText(row?.startDate),
      endDate: normalizeText(row?.endDate),
      submissionDeadline: normalizeText(row?.submissionDeadline),
      submissionDeadlineTime: /^\d{2}:\d{2}$/.test(submissionDeadlineTime) ? submissionDeadlineTime : '23:59',
      status: lower(row?.status || 'open'),
      notes: normalizeText(row?.notes || ''),
      orgId: normalizeText(row?.orgId || ''),
      actions: buildTimesheetPeriodActionLinks(row)
    };
  });
}

function dateRangeOverlaps(rowStart, rowEnd, filterStart, filterEnd) {
  const start = normalizeText(rowStart);
  const end = normalizeText(rowEnd || rowStart);
  const from = normalizeText(filterStart);
  const to = normalizeText(filterEnd);

  if (from && end && end < from) return false;
  if (to && start && start > to) return false;
  return true;
}

function timesheetPeriodMatchesFilters(row, queryInput = {}, searchTerm = '') {
  const status = lower(queryInput.status || '');
  const periodStartDate = normalizeText(queryInput.periodStartDate || queryInput.startDate || '');
  const periodEndDate = normalizeText(queryInput.periodEndDate || queryInput.endDate || '');
  const deadlineStartDate = normalizeText(queryInput.deadlineStartDate || '');
  const deadlineEndDate = normalizeText(queryInput.deadlineEndDate || '');
  const deadline = normalizeText(row?.submissionDeadline || '');

  if (status && lower(row?.status || '') !== status) return false;
  if ((periodStartDate || periodEndDate) && !dateRangeOverlaps(row?.startDate, row?.endDate, periodStartDate, periodEndDate)) return false;
  if (deadlineStartDate && deadline < deadlineStartDate) return false;
  if (deadlineEndDate && deadline > deadlineEndDate) return false;

  return rowMatchesWorkspaceSearch(row, searchTerm);
}

function sortTimesheetPeriodRows(rows) {
  const statusRank = new Map([
    ['open', 0],
    ['locked', 1],
    ['processed', 2]
  ]);
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const statusDelta = (statusRank.get(a.status) ?? 9) - (statusRank.get(b.status) ?? 9);
    if (statusDelta) return statusDelta;
    return String(b.startDate || '').localeCompare(String(a.startDate || ''));
  });
}

function buildSessionIssueActionLinks(row) {
  const classId = normalizeText(row?.classId);
  const sessionId = normalizeText(row?.sessionId);
  const caseId = normalizeText(row?.id);
  if (!classId || !sessionId || !caseId) return [];
  return [{
    label: 'Review',
    href: `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}?caseId=${encodeURIComponent(caseId)}`,
    icon: 'bi bi-box-arrow-in-right',
    tone: 'primary'
  }];
}

function normalizeSessionIssueRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const updatedAt = normalizeText(row?.audit?.lastUpdateDateTime || row?.audit?.createDateTime || '');
    return {
      id: normalizeText(row?.id),
      classId: normalizeText(row?.classId),
      classTitle: normalizeText(row?.classTitle || row?.className || row?.classId || 'Class'),
      sessionId: normalizeText(row?.sessionId),
      sessionDate: normalizeText(row?.sessionDate),
      sessionStartTime: normalizeText(row?.sessionStartTime),
      sessionEndTime: normalizeText(row?.sessionEndTime),
      studentPersonId: normalizeText(row?.studentPersonId),
      studentRecordId: normalizeText(row?.studentRecordId || ''),
      studentName: normalizeText(row?.studentName || row?.studentPersonId || '-'),
      teacherPersonId: normalizeText(row?.teacherPersonId),
      teacherName: normalizeText(row?.teacherName || row?.teacherPersonId || 'Unassigned'),
      category: lower(row?.category || 'other'),
      severity: lower(row?.severity || 'info'),
      status: lower(row?.status || 'open'),
      summary: normalizeText(row?.summary || '-'),
      updatedAt,
      actions: buildSessionIssueActionLinks(row)
    };
  });
}

function splitFilterIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function sessionIssueMatchesFilters(row, queryInput = {}, searchTerm = '') {
  const severity = lower(queryInput.severity || '');
  const category = lower(queryInput.category || '');
  const statusGroup = lower(queryInput.statusGroup || '');
  const startDate = normalizeText(queryInput.startDate || '');
  const endDate = normalizeText(queryInput.endDate || '');
  const classIds = splitFilterIds(queryInput.classId || queryInput.classIds);
  const teacherIds = splitFilterIds(queryInput.teacherPersonId || queryInput.teacherId || queryInput.teacherIds);
  const studentIds = splitFilterIds(queryInput.studentPersonId || queryInput.studentId || queryInput.studentIds);
  const rowStatus = lower(row?.status || '');

  if (severity && lower(row?.severity) !== severity) return false;
  if (category && lower(row?.category) !== category) return false;
  if (statusGroup === 'open' && !['open', 'in_progress', 'reopened'].includes(rowStatus)) return false;
  if (statusGroup === 'resolved' && !['resolved', 'cancelled'].includes(rowStatus)) return false;
  if (startDate && normalizeText(row?.sessionDate) < startDate) return false;
  if (endDate && normalizeText(row?.sessionDate) > endDate) return false;
  if (classIds.length && !classIds.some((id) => idsEqual(row?.classId, id))) return false;
  if (teacherIds.length && !teacherIds.some((id) => idsEqual(row?.teacherPersonId, id))) return false;
  if (studentIds.length && !studentIds.some((id) => idsEqual(row?.studentPersonId, id))) return false;

  return rowMatchesWorkspaceSearch(row, searchTerm);
}

function sortSessionIssueRows(rows) {
  const severityRank = new Map([
    ['urgent', 0],
    ['warning', 1],
    ['info', 2]
  ]);
  const statusRank = new Map([
    ['open', 0],
    ['in_progress', 0],
    ['reopened', 0],
    ['resolved', 1],
    ['cancelled', 2]
  ]);
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const statusDelta = (statusRank.get(a.status) ?? 9) - (statusRank.get(b.status) ?? 9);
    if (statusDelta) return statusDelta;
    const severityDelta = (severityRank.get(a.severity) ?? 9) - (severityRank.get(b.severity) ?? 9);
    if (severityDelta) return severityDelta;
    return String(b.sessionDate || b.updatedAt || '').localeCompare(String(a.sessionDate || a.updatedAt || ''));
  });
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

function isTaskRelatedToActiveUser(row, user) {
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

async function getActiveUserTasks(req, filters = {}) {
  const query = { ...(filters || {}) };
  const visibleTasks = await taskService.listVisibleTasks(req.user, query);
  return Array.isArray(visibleTasks) ? visibleTasks : [];
}

async function getTaskSummary(req) {
  const rows = await getActiveUserTasks(req, req.query || {});

  return {
    totalCount: rows.length,
    unresolvedCount: rows.filter(hasIncompleteTaskWork).length,
    checkedAt: new Date().toISOString()
  };
}

async function getWorkspaceSection(sectionKey, queryInput, req) {
  const key = lower(sectionKey) === 'notifications' ? 'tasks' : lower(sectionKey);
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

  if (key === 'sessions') {
    const access = await evaluateModuleAccess(req, {
      label: 'Sessions',
      sectionId: SECTIONS.SCHOOL_SESSIONS
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Sessions.');
      error.statusCode = 403;
      throw error;
    }
    const updateAccess = await evaluateModuleAccess(req, {
      label: 'Sessions',
      sectionId: SECTIONS.SCHOOL_SESSIONS,
      operationId: OPERATIONS.UPDATE
    });
    const result = await sessionExplorerService.listSessions(req, queryInput || {});
    const rows = Array.isArray(result.rows) ? result.rows : [];
    return {
      section: {
        key: 'sessions',
        label: 'Sessions',
        icon: 'bi bi-calendar2-week-fill',
        sourceUrl: '/school/sessions'
      },
      rows,
      total: rows.length,
      pagination: result.pagination,
      statusMeta: result.statusMeta,
      canUpdateSessions: updateAccess.allowed === true,
      filters: result.filters,
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'session-issues') {
    const access = await evaluateModuleAccess(req, {
      label: 'Session Issues',
      sectionId: SECTIONS.SCHOOL_SESSIONS
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Session Issues.');
      error.statusCode = 403;
      throw error;
    }
    const rawRows = await schoolRepositories.sessionStudentCases.list({
      query: {},
      scope: { activeOrgId: getHubActiveOrgId(req.user) }
    });
    const students = await dataService.fetchData('students', {}, req.user);
    const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(
      students,
      getHubActiveOrgId(req.user)
    );
    const rows = sortSessionIssueRows(normalizeSessionIssueRows(rawRows)
      .map((row) => ({
        ...row,
        studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
          personId: row.studentPersonId,
          personToStudentMap
        })
      }))
      .filter((row) => sessionIssueMatchesFilters(row, queryInput || {}, query.q || '')));
    return {
      section: {
        key: 'session-issues',
        label: 'Session Issues',
        icon: 'bi bi-exclamation-triangle-fill',
        sourceUrl: '/school/sessions'
      },
      rows,
      total: rows.length,
      filters: {
        severity: lower(queryInput?.severity || ''),
        category: lower(queryInput?.category || ''),
        statusGroup: lower(queryInput?.statusGroup || ''),
        classId: normalizeText(queryInput?.classId || queryInput?.classIds || ''),
        teacherPersonId: normalizeText(queryInput?.teacherPersonId || queryInput?.teacherId || queryInput?.teacherIds || ''),
        studentPersonId: normalizeText(queryInput?.studentPersonId || queryInput?.studentId || queryInput?.studentIds || ''),
        startDate: normalizeText(queryInput?.startDate || ''),
        endDate: normalizeText(queryInput?.endDate || '')
      },
      severityOptions: sessionStudentCaseModel.CASE_SEVERITIES || ['info', 'warning', 'urgent'],
      categoryOptions: sessionStudentCaseModel.CASE_CATEGORIES || ['learning', 'technology', 'engagement', 'behavior', 'support', 'resources', 'lesson_delivery', 'other'],
      statusGroupOptions: [
        { value: '', label: 'All Cases' },
        { value: 'open', label: 'Open / Active' },
        { value: 'resolved', label: 'Resolved / Cancelled' }
      ],
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }
  if (key === 'schedule') {
    const access = await evaluateModuleAccess(req, {
      label: 'Schedule',
      sectionId: SECTIONS.SCHOOL_SCHEDULES
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Schedule.');
      error.statusCode = 403;
      throw error;
    }
    return {
      section: {
        key: 'schedule',
        label: 'Schedule',
        icon: 'bi bi-calendar-check-fill',
        sourceUrl: '/school/schedules'
      },
      rows: [],
      total: 0,
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'attendance') {
    const access = await evaluateModuleAccess(req, {
      label: 'Attendance',
      sectionId: SECTIONS.SCHOOL_ATTENDANCES
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Attendance.');
      error.statusCode = 403;
      throw error;
    }
    return {
      section: {
        key: 'attendance',
        label: 'Attendance',
        icon: 'bi bi-clipboard-check-fill',
        sourceUrl: '/school/attendances'
      },
      rows: [],
      total: 0,
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'academic-ledger') {
    const access = await evaluateModuleAccess(req, {
      label: 'Academic Ledger',
      sectionId: SECTIONS.SCHOOL_ACADEMIC_LEDGER
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Academic Ledger.');
      error.statusCode = 403;
      throw error;
    }
    return {
      section: {
        key: 'academic-ledger',
        label: 'Academic Ledger',
        icon: 'bi bi-journal-bookmark-fill',
        sourceUrl: '/school/academic-ledger'
      },
      rows: [],
      total: 0,
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'activities') {
    const access = await evaluateModuleAccess(req, {
      label: 'Activities',
      sectionId: SECTIONS.SCHOOL_ACTIVITIES
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Activities.');
      error.statusCode = 403;
      throw error;
    }
    const orgId = getHubActiveOrgId(req.user);
    const fetchQuery = {
      ...query,
      searchFields: query.searchFields || 'id,title,status,categoryName,categoryId,departmentName,departmentId,location,visibilityScope,notes'
    };
    ['categoryId', 'departmentId', 'status', 'visibilityScope', 'scope', 'paid', 'dateFrom', 'dateTo', 'startDate', 'endDate', 'assigneePersonId', 'assigneePersonName', 'personId', 'personName', 'personControl', 'page', 'limit'].forEach((keyName) => {
      delete fetchQuery[keyName];
    });
    const [activities, categories, departments] = await Promise.all([
      activityService.listActivities({ orgId, reqUser: req.user, query: fetchQuery }),
      activityService.listActivityCategories({ orgId, reqUser: req.user, includeInactive: true }),
      dataService.fetchData('departments', {}, req.user, { scopeId: access.scopeId })
    ]);
    const normalizedRows = sortActivityRows(normalizeActivityRows(activities)
      .filter((row) => activityMatchesFilters(row, queryInput || {}, query.q || '')));
    const activeDepartments = (Array.isArray(departments) ? departments : [])
      .filter((row) => !normalizeText(row?.orgId) || idsEqual(row?.orgId, orgId))
      .map((row) => ({
        id: normalizeText(row?.id),
        name: normalizeText(row?.name || row?.code || row?.id || 'Department')
      }))
      .filter((row) => row.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      section: {
        key: 'activities',
        label: 'Activities',
        icon: 'bi bi-list-check',
        sourceUrl: '/school/activities'
      },
      rows: normalizedRows,
      total: normalizedRows.length,
      filters: {
        categoryId: normalizeText(queryInput?.categoryId || ''),
        departmentId: normalizeText(queryInput?.departmentId || ''),
        status: lower(queryInput?.status || ''),
        visibilityScope: normalizeText(queryInput?.visibilityScope || queryInput?.scope || '')
          ? activityService.normalizeActivityVisibilityScope(queryInput?.visibilityScope || queryInput?.scope)
          : '',
        paid: lower(queryInput?.paid || ''),
        dateFrom: normalizeText(queryInput?.dateFrom || queryInput?.startDate || ''),
        dateTo: normalizeText(queryInput?.dateTo || queryInput?.endDate || ''),
        assigneePersonId: normalizeText(queryInput?.assigneePersonId || queryInput?.personId || ''),
        assigneePersonName: normalizeText(queryInput?.assigneePersonName || queryInput?.personName || ''),
        personControl: lower(queryInput?.personControl || '')
      },
      categoryOptions: (Array.isArray(categories) ? categories : []).map((row) => ({
        id: normalizeText(row?.id),
        name: normalizeText(row?.name || row?.code || row?.id || 'Category'),
        active: row?.active !== false
      })).filter((row) => row.id),
      departmentOptions: activeDepartments,
      statusOptions: [
        { value: '', label: 'All Statuses' },
        { value: 'draft', label: 'Draft' },
        { value: 'posted', label: 'Posted' },
        { value: 'cancelled', label: 'Cancelled' }
      ],
      scopeOptions: [
        { value: '', label: 'All Scopes' },
        { value: 'school', label: 'School / Public' },
        { value: 'individual', label: 'Individual / Assigned only' }
      ],
      paidOptions: [
        { value: '', label: 'All Pay Types' },
        { value: 'paid', label: 'Payable' },
        { value: 'unpaid', label: 'Unpaid' }
      ],
      personControlOptions: [
        { value: '', label: 'All Person Controls' },
        { value: 'restricted', label: 'Has Controls' },
        { value: 'open', label: 'No Controls' }
      ],
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'timesheet-periods') {
    const access = await evaluateModuleAccess(req, {
      label: 'Timesheet Periods',
      sectionId: SECTIONS.SCHOOL_TIMESHEET_PERIODS
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Timesheet Periods.');
      error.statusCode = 403;
      throw error;
    }
    const fetchQuery = {
      ...query,
      searchFields: query.searchFields || 'id,name,startDate,endDate,submissionDeadline,submissionDeadlineTime,status,notes,orgId'
    };
    ['status', 'periodStartDate', 'periodEndDate', 'deadlineStartDate', 'deadlineEndDate', 'quickRange', 'page', 'limit'].forEach((keyName) => {
      delete fetchQuery[keyName];
    });
    const rows = await dataService.fetchData('timesheetPeriods', fetchQuery, req.user, { scopeId: access.scopeId });
    const normalizedRows = sortTimesheetPeriodRows(normalizeTimesheetPeriodRows(rows)
      .filter((row) => timesheetPeriodMatchesFilters(row, queryInput || {}, query.q || '')));
    return {
      section: {
        key: 'timesheet-periods',
        label: 'Timesheet Periods',
        icon: 'bi bi-calendar-week-fill',
        sourceUrl: '/school/timesheetPeriods'
      },
      rows: normalizedRows,
      total: normalizedRows.length,
      filters: {
        status: lower(queryInput?.status || ''),
        periodStartDate: normalizeText(queryInput?.periodStartDate || queryInput?.startDate || ''),
        periodEndDate: normalizeText(queryInput?.periodEndDate || queryInput?.endDate || ''),
        deadlineStartDate: normalizeText(queryInput?.deadlineStartDate || ''),
        deadlineEndDate: normalizeText(queryInput?.deadlineEndDate || '')
      },
      statusOptions: [
        { value: '', label: 'All Statuses' },
        { value: 'open', label: 'Open' },
        { value: 'locked', label: 'Locked' },
        { value: 'processed', label: 'Processed' }
      ],
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'timesheet-management') {
    const access = await evaluateModuleAccess(req, {
      label: 'Timesheet Management',
      sectionId: SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Timesheet Management.');
      error.statusCode = 403;
      throw error;
    }
    return {
      section: {
        key: 'timesheet-management',
        label: 'Timesheet Management',
        icon: 'bi bi-table',
        sourceUrl: '/school/timesheets/manage'
      },
      rows: [],
      total: 0,
      filters: {},
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'report-assignments') {
    const access = await evaluateModuleAccess(req, {
      label: 'Report Assignments',
      sectionId: SECTIONS.SCHOOL_REPORTS_ASSIGNMENT
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Report Assignments.');
      error.statusCode = 403;
      throw error;
    }
    const searchTerm = lower(query.q || '');
    const classIds = splitFilterIds(queryInput?.classIds || queryInput?.classId || '');
    const teacherPersonId = normalizeText(queryInput?.teacherPersonId || '');
    const reportScope = lower(queryInput?.reportScope || '');
    const assignmentContext = await reportViewService.buildAssignmentListContext({
      reqUser: req.user,
      classFilter: classIds[0] || '',
      classIds,
      teacherPersonId,
      reportScope,
      q: searchTerm
    });
    const rows = normalizeReportAssignmentRows(assignmentContext?.rows || []);
    return {
      section: {
        key: 'report-assignments',
        label: 'Report Assignments',
        icon: 'bi bi-clipboard2-check-fill',
        sourceUrl: '/school/reports/assignments'
      },
      rows,
      total: rows.length,
      filters: {
        classIds: normalizeText((assignmentContext?.selectedClassIds || classIds).join(',')),
        classId: normalizeText((assignmentContext?.selectedClassIds || classIds)[0] || ''),
        teacherPersonId: normalizeText(assignmentContext?.selectedTeacherPersonId || teacherPersonId),
        reportScope: lower(assignmentContext?.selectedReportScope || reportScope)
      },
      selectedClasses: Array.isArray(assignmentContext?.selectedClasses) ? assignmentContext.selectedClasses : [],
      selectedTeacherName: normalizeText(assignmentContext?.selectedTeacherName || ''),
      selectedTeacherPersonId: normalizeText(assignmentContext?.selectedTeacherPersonId || teacherPersonId),
      selectedReportScope: lower(assignmentContext?.selectedReportScope || reportScope),
      selectedClassTitle: normalizeText(assignmentContext?.selectedClassTitle || ''),
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'report-instances') {
    const access = await evaluateModuleAccess(req, {
      label: 'Report Instances',
      sectionId: SECTIONS.SCHOOL_REPORTS_INSTANCES
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Report Instances.');
      error.statusCode = 403;
      throw error;
    }
    const assignmentFilter = normalizeText(queryInput?.assignmentId || '');
    const assignmentRowFilter = normalizeText(queryInput?.assignmentRowId || queryInput?.rowId || '');
    const sessionFilter = normalizeText(queryInput?.sessionId || '');
    const sessionDateFilter = normalizeText(queryInput?.sessionDate || '');
    const templateId = normalizeText(queryInput?.templateId || '');
    const classIds = splitFilterIds(queryInput?.classIds || queryInput?.classId || '');
    const teacherIds = splitFilterIds(queryInput?.teacherIds || queryInput?.teacherPersonId || queryInput?.teacherId || '');
    const studentIds = splitFilterIds(queryInput?.studentIds || queryInput?.studentPersonId || queryInput?.studentId || '');
    const dueDateStart = normalizeText(queryInput?.dueDateStart || queryInput?.startDate || '');
    const dueDateEnd = normalizeText(queryInput?.dueDateEnd || queryInput?.endDate || '');
    const status = lower(queryInput?.status || '');
    const searchTerm = lower(query.q || '');
    const [instanceRows, allTemplates, classes] = await Promise.all([
      reportViewService.buildInstanceListRows({
        reqUser: req.user,
        assignmentFilter,
        assignmentRowFilter,
        sessionFilter,
        sessionDateFilter,
        teacherFilter: teacherIds[0] || '',
        studentFilter: studentIds[0] || '',
        templateId,
        classIds,
        teacherIds,
        studentIds,
        dueDateStart,
        dueDateEnd,
        status,
        q: searchTerm
      }),
      dataService.fetchData('reportTemplates', {}, req.user),
      dataService.fetchData('classes', {}, req.user)
    ]);
    const rows = normalizeReportInstanceRows(instanceRows);
    const classMap = new Map(
      (Array.isArray(classes) ? classes : [])
        .map((row) => [toPublicId(row?.id), row])
        .filter(([id]) => Boolean(id))
    );
    const selectedClasses = classIds.map((id) => {
      const classItem = classMap.get(toPublicId(id));
      return {
        id,
        title: normalizeText(classItem?.title || id)
      };
    });
    const templateOptions = (Array.isArray(allTemplates) ? allTemplates : [])
      .map((row) => ({
        id: normalizeText(row?.id),
        title: normalizeText(row?.title || row?.id || '-')
      }))
      .filter((row) => Boolean(row.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      section: {
        key: 'report-instances',
        label: 'Report Instances',
        icon: 'bi bi-file-earmark-text-fill',
        sourceUrl: '/school/reports/instances'
      },
      rows,
      total: rows.length,
      filters: {
        assignmentId: assignmentFilter,
        assignmentRowId: assignmentRowFilter,
        sessionId: sessionFilter,
        sessionDate: sessionDateFilter,
        templateId,
        classIds: normalizeText(classIds.join(',')),
        classId: normalizeText(classIds[0] || ''),
        teacherIds: normalizeText(teacherIds.join(',')),
        teacherPersonId: normalizeText(teacherIds.join(',')),
        teacherId: normalizeText(teacherIds[0] || ''),
        studentIds: normalizeText(studentIds.join(',')),
        studentPersonId: normalizeText(studentIds.join(',')),
        studentId: normalizeText(studentIds[0] || ''),
        dueDateStart,
        dueDateEnd,
        startDate: dueDateStart,
        endDate: dueDateEnd,
        status
      },
      templateOptions,
      selectedClasses,
      statusOptions: [
        { value: '', label: 'All Statuses' },
        { value: 'pending', label: 'Pending' },
        { value: 'draft', label: 'Draft' },
        { value: 'submitted', label: 'Submitted' },
        { value: 'locked', label: 'Locked' }
      ],
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'leave-requests') {
    const access = await evaluateModuleAccess(req, {
      label: 'Leave Requests',
      sectionId: SECTIONS.SCHOOL_LEAVE_REQUESTS
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Leave Requests.');
      error.statusCode = 403;
      throw error;
    }
    const rows = await leaveRequestService.listVisibleRequests(req.user, queryInput || {});
    const normalizedRows = normalizeLeaveRequestRows(rows)
      .filter((row) => rowMatchesWorkspaceSearch(row, query.q || ''));
    return {
      section: {
        key: 'leave-requests',
        label: 'Leave Requests',
        icon: 'bi bi-calendar-heart',
        sourceUrl: '/school/leave-requests'
      },
      rows: normalizedRows,
      total: normalizedRows.length,
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key === 'holidays') {
    const access = await evaluateModuleAccess(req, {
      label: 'Holidays',
      sectionId: SECTIONS.SCHOOL_HOLIDAYS
    });
    if (!access.allowed) {
      const error = new Error('You do not have access to Holidays.');
      error.statusCode = 403;
      throw error;
    }
    const orgToday = String(req?.orgToday || req?.user?.orgToday || '').trim();
    const targetYear = resolveHolidayYear(queryInput?.year || query.year, orgToday);
    const fetchQuery = {
      ...query,
      searchFields: query.searchFields || 'id,date,title,type,notes,orgId'
    };
    delete fetchQuery.year;
    delete fetchQuery.page;
    delete fetchQuery.limit;
    const rows = await dataService.fetchData('holidays', fetchQuery, req.user, { scopeId: access.scopeId });
    const normalizedRows = normalizeHolidayRows(rows)
      .filter((row) => row.date && String(row.date).startsWith(targetYear))
      .filter((row) => rowMatchesWorkspaceSearch(row, query.q || ''))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    return {
      section: {
        key: 'holidays',
        label: 'Holidays',
        icon: 'bi bi-calendar-event-fill',
        sourceUrl: '/school/holidays'
      },
      rows: normalizedRows,
      total: normalizedRows.length,
      currentYear: targetYear,
      yearOptions: buildHolidayYearOptions(targetYear, orgToday),
      searchQuery: normalizeText(query.q || ''),
      refreshedAt: new Date().toISOString()
    };
  }

  if (key !== 'tasks') {
    const error = new Error('This Master Academia Hub section is not available on-page yet.');
    error.statusCode = 404;
    throw error;
  }

  const access = await evaluateModuleAccess(req, {
    label: 'Tasks',
    sectionId: SECTIONS.SCHOOL_TASKS
  });
  if (!access.allowed) {
    const error = new Error('You do not have access to Tasks.');
    error.statusCode = 403;
    throw error;
  }

  const taskRows = await getActiveUserTasks(req, queryInput || {});
  const rows = taskRows.filter((row) => rowMatchesWorkspaceSearch(row, query.q || ''));
  const canManageAll = taskService.isAdminViewer(req.user);

  return {
    section: {
      key: 'tasks',
      label: 'School Tasks',
      icon: 'bi bi-list-task',
      sourceUrl: '/school/tasks'
    },
    rows: normalizeTaskRows(rows),
    total: rows.length,
    unresolvedCount: rows.filter(hasIncompleteTaskWork).length,
    canManageAll,
    selectedPersonId: canManageAll ? normalizeText(queryInput?.assignedPersonId || '') : '',
    selectedPersonName: canManageAll ? normalizeText(queryInput?.assignedPersonName || '') : '',
    searchQuery: normalizeText(query.q || ''),
    refreshedAt: new Date().toISOString()
  };
}

async function assertSessionsUpdateAccess(req) {
  const access = await evaluateModuleAccess(req, {
    label: 'Sessions',
    sectionId: SECTIONS.SCHOOL_SESSIONS,
    operationId: OPERATIONS.UPDATE
  });
  if (!access.allowed) {
    const error = new Error('You do not have permission to update sessions.');
    error.statusCode = 403;
    throw error;
  }
  return access;
}

async function lockWorkspaceSessions(input = {}, req = {}) {
  await assertSessionsUpdateAccess(req);
  const refs = parseSessionRefs(input.sessionRefs);
  if (!refs.length) throw new Error('Select at least one session to lock.');

  const grouped = new Map();
  refs.forEach((ref) => {
    if (!grouped.has(ref.classId)) grouped.set(ref.classId, new Set());
    grouped.get(ref.classId).add(ref.sessionId);
  });

  const summary = {
    requested: refs.length,
    locked: 0,
    alreadyLocked: 0,
    missing: [],
    classesUpdated: []
  };

  for (const [classId, sessionIds] of grouped.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const classRow = await dataService.getDataById('classes', classId, req.user);
    if (!classRow) {
      sessionIds.forEach((sessionId) => summary.missing.push({ classId, sessionId }));
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const sessions = await dataService.getClassSessions(classId, req.user);
    let changed = false;
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      const currentSessionId = toPublicId(session?.sessionId || session?.id);
      if (!sessionIds.has(currentSessionId)) return;
      if (session.locked === true || String(session.locked) === 'true') {
        summary.alreadyLocked += 1;
        return;
      }
      session.locked = true;
      session.lockedAt = new Date().toISOString();
      session.lockedBy = toPublicId(req.user?.id);
      summary.locked += 1;
      changed = true;
    });
    sessionIds.forEach((sessionId) => {
      const found = (Array.isArray(sessions) ? sessions : []).some((session) => idsEqual(session?.sessionId || session?.id, sessionId));
      if (!found) summary.missing.push({ classId, sessionId });
    });
    if (changed) {
      // eslint-disable-next-line no-await-in-loop
      await dataService.saveClassSessions(classId, sessions, req.user);
      // eslint-disable-next-line no-await-in-loop
      await schoolIndexService.rebuildIndexesForClass(classId);
      summary.classesUpdated.push(classId);
    }
  }

  return summary;
}

async function updateWorkspaceSession(input = {}, req = {}) {
  await assertSessionsUpdateAccess(req);
  const classId = toPublicId(input.classId);
  const sessionId = toPublicId(input.sessionId);
  if (!classId || !sessionId) throw new Error('classId and sessionId are required.');

  const classRow = await dataService.getDataById('classes', classId, req.user);
  if (!classRow) throw new Error('Class not found.');
  const sessions = await dataService.getClassSessions(classId, req.user);
  const index = (Array.isArray(sessions) ? sessions : []).findIndex((session) => idsEqual(session?.sessionId || session?.id, sessionId));
  if (index < 0) throw new Error('Session not found.');

  const session = sessions[index];
  const nextDate = normalizeDateOnly(input.date, 'date') || session.date;
  const nextStart = normalizeClock(input.startTime, 'startTime') || session.startTime || '';
  const nextEnd = normalizeClock(input.endTime, 'endTime') || session.endTime || '';
  if (nextStart && nextEnd && nextStart >= nextEnd) throw new Error('Start time must be before end time.');

  session.date = nextDate;
  session.startTime = nextStart;
  session.endTime = nextEnd;
  if (input.status !== undefined) session.status = normalizeText(input.status) || session.status;
  if (input.room !== undefined) session.room = normalizeText(input.room).slice(0, 200);
  if (input.notes !== undefined) session.notes = normalizeText(input.notes).slice(0, 2000);
  if (input.locked !== undefined) {
    const nextLocked = normalizeBooleanInput(input.locked, session.locked === true || String(session.locked) === 'true');
    const wasLocked = session.locked === true || String(session.locked) === 'true';
    session.locked = nextLocked;
    if (nextLocked && !wasLocked) {
      session.lockedAt = new Date().toISOString();
      session.lockedBy = toPublicId(req.user?.id);
    } else if (!nextLocked && wasLocked) {
      session.unlockedAt = new Date().toISOString();
      session.unlockedBy = toPublicId(req.user?.id);
    }
  }
  if (input.teacherId !== undefined || input.teacherName !== undefined) {
    const teacherId = toPublicId(input.teacherId);
    if (!session.delivery || typeof session.delivery !== 'object') session.delivery = {};
    session.delivery.deliveredBy = teacherId;
    session.delivery.deliveredByName = normalizeText(input.teacherName).slice(0, 180);
  }
  session.audit = {
    ...(session.audit || {}),
    lastUpdateUser: toPublicId(req.user?.id),
    lastUpdateDateTime: new Date().toISOString()
  };

  await dataService.saveClassSessions(classId, sessions, req.user);
  await schoolIndexService.rebuildIndexesForClass(classId);

  return { classId, sessionId, session };
}

module.exports = {
  resolveAccessibleModules,
  getPeoplePanelRows,
  getTaskSummary,
  getWorkspaceSection,
  lockWorkspaceSessions,
  updateWorkspaceSession
};
