/**
 * Central registry of school entity delete rules and reference scanners.
 */
const schoolDataService = require('./schoolDataService');
const schoolDependencyService = require('./schoolDependencyService');
const withdrawalRepository = require('../../repositories/school/withdrawalRepository');
const classCycleLinkResolutionService = require('./classCycleLinkResolutionService');
const classDeletePreparationHrefs = require('./classDeletePreparationHrefs');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const MAX_SAMPLES = 5;

const SECTION_HREFS = Object.freeze({
  programs: (id) => `/school/programs/edit/${encodeURIComponent(id)}`,
  departments: (id) => `/school/departments/edit/${encodeURIComponent(id)}`,
  subjects: (id) => `/school/subjects/edit/${encodeURIComponent(id)}`,
  terms: (id) => `/school/terms/edit/${encodeURIComponent(id)}`,
  classes: (id) => `/school/classes/edit/${encodeURIComponent(id)}`,
  resolveCycleLinks: (targetClassId, referringClassId = '') =>
    classDeletePreparationHrefs.buildDeletePreparationHref(targetClassId, referringClassId, 'delete'),
  deletePreparation: (targetClassId, focusClassId = '') =>
    classDeletePreparationHrefs.buildDeletePreparationHref(targetClassId, focusClassId, 'delete'),
  sessions: (classId, sessionId) => `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`,
  reports: {
    template: (id) => `/school/reports/templates/edit/${encodeURIComponent(id)}`,
    assignment: (id) => `/school/reports/assignments/edit/${encodeURIComponent(id)}`,
    instance: (id) => `/school/reports/instances/edit-v2/${encodeURIComponent(id)}`
  },
  timesheets: (periodId, teacherId) => {
    const params = new URLSearchParams();
    if (periodId) params.set('periodId', periodId);
    if (teacherId) params.set('teacherId', teacherId);
    const qs = params.toString();
    return qs ? `/school/timesheets?${qs}` : '/school/timesheets';
  },
  timesheetPeriods: (id) => `/school/timesheetPeriods/edit/${encodeURIComponent(id)}`,
  activities: (id) => `/school/activities/edit/${encodeURIComponent(id)}`,
  activityCategories: (id) => `/school/activities/categories/edit/${encodeURIComponent(id)}`,
  sessionStatuses: (id) => `/school/session-statuses/edit/${encodeURIComponent(id)}`,
  holidays: (id) => `/school/holidays/edit/${encodeURIComponent(id)}`,
  registrations: {
    program: (id) => `/school/students/program-registrations/${encodeURIComponent(id)}`,
    term: (id) => `/school/students/term-registrations/${encodeURIComponent(id)}`
  },
  enrollments: (id) => `/school/classes/enrollment-periods/${encodeURIComponent(id)}`,
  exams: {
    allocation: (id) => `/school/exams/allocations/${encodeURIComponent(id)}`,
    assignment: (id) => `/school/exams/assignments/${encodeURIComponent(id)}`
  },
  withdrawals: (id) => `/school/withdrawal/${encodeURIComponent(id)}`,
  academicLedger: (row = {}) => {
    const studentId = toPublicId(row?.studentId);
    if (studentId) {
      const programId = toPublicId(row?.programId);
      const base = `/school/academic-ledger/student/${encodeURIComponent(studentId)}`;
      return programId ? `${base}?programId=${encodeURIComponent(programId)}` : base;
    }
    return '/school/academic-ledger';
  },
  cases: (classId, sessionId) => `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}/cases`,
  leaveRequests: (id) => `/school/leave-requests/${encodeURIComponent(id)}`,
  students: (id) => `/school/students/edit/${encodeURIComponent(id)}`,
  teachers: (id) => `/school/teachers/edit/${encodeURIComponent(id)}`,
  staff: (id) => `/school/staff/edit/${encodeURIComponent(id)}`,
  payRates: (id) => `/school/payRates/edit/${encodeURIComponent(id)}`,
  schoolAccounts: (id) => `/school/accounts/edit/${encodeURIComponent(id)}`,
  transactionTemplates: (id) => `/school/transactionTemplates/edit/${encodeURIComponent(id)}`,
  transactions: (id) => `/school/transactions/edit/${encodeURIComponent(id)}`,
  examTemplates: (id) => `/school/exams/templates/edit/${encodeURIComponent(id)}`,
  examAllocations: (id) => `/school/exams/allocations/${encodeURIComponent(id)}`,
  tasks: (id) => `/school/tasks/${encodeURIComponent(id)}`,
  priorSubjects: (id) => `/school/students/prior-subjects/${encodeURIComponent(id)}`
});

function normalizeId(value) {
  return String(value || '').trim();
}

function recordLabel(record = {}, fallback = '') {
  return String(
    record?.title
    || record?.name
    || record?.label
    || record?.code
    || record?.id
    || fallback
    || ''
  ).trim();
}

function recordId(record = {}) {
  return toPublicId(record?.id) || toPublicId(record?.code) || '';
}

function scopeByOrg(rows = [], orgId) {
  if (!orgId) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, orgId));
}

function buildBlocker({
  code,
  label,
  count,
  samples = [],
  resolveHint,
  section,
  severity = 'error',
  childPolicy = '',
  actionHref = '',
  actionLabel = ''
}) {
  if (!count) return null;
  return {
    code,
    severity,
    childPolicy: childPolicy || undefined,
    message: `${label}: ${count} record(s) found`,
    count,
    samples,
    resolveHint: resolveHint || `Remove or update these ${label.toLowerCase()} references first.`,
    section: section || 'general',
    actionHref: sanitizeSampleHref(actionHref),
    actionLabel: String(actionLabel || '').trim() || undefined
  };
}

function samplesFromRows(rows = [], labelFn, hrefFn) {
  return rows.slice(0, MAX_SAMPLES).map((row) => ({
    id: recordId(row),
    label: typeof labelFn === 'function' ? labelFn(row) : recordLabel(row),
    href: sanitizeSampleHref(typeof hrefFn === 'function' ? hrefFn(row) : '')
  })).filter((row) => row.id || row.label);
}

function sectionHrefUsesRow(fn) {
  if (typeof fn !== 'function') return false;
  return /\(\s*row\b/.test(Function.prototype.toString.call(fn));
}

function sanitizeSampleHref(href = '') {
  const value = String(href || '').trim();
  if (!value) return '';
  if (value.includes('[object Object]') || value.includes('%5Bobject%20Object%5D')) return '';
  return value;
}

function resolveSectionHref(sectionHref, row) {
  if (typeof sectionHref !== 'function') return '';
  const href = sectionHrefUsesRow(sectionHref) ? sectionHref(row) : sectionHref(recordId(row));
  return sanitizeSampleHref(href);
}

async function fetchScoped(entityType, field, targetId, orgId, reqUser) {
  const query = { page: 1, [`${field}__eq`]: toPublicId(targetId) };
  if (orgId) query.orgId__eq = String(orgId);
  const rows = await schoolDataService.fetchData(entityType, query, reqUser);
  return Array.isArray(rows) ? rows : [];
}

async function scanFieldMatch(rule, targetId, orgId, reqUser) {
  let rows = await fetchScoped(rule.entityType, rule.field, targetId, orgId, reqUser);
  if (rule.entityType === 'academicLedger') {
    rows = rows.filter((row) => String(row?.status || '').trim().toLowerCase() !== 'void');
  }
  if (!rows.length) return null;
  const hrefFn = rule.href
    || ((row) => resolveSectionHref(rule.sectionHref, row));
  const resolvedActionHref = typeof rule.actionHref === 'function'
    ? sanitizeSampleHref(rule.actionHref({ id: toPublicId(targetId) }))
    : sanitizeSampleHref(rule.actionHref);
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: rows.length,
    samples: samplesFromRows(rows, rule.sampleLabel, hrefFn),
    resolveHint: rule.resolveHint,
    section: rule.section,
    severity: rule.severity,
    childPolicy: rule.childPolicy,
    actionHref: resolvedActionHref,
    actionLabel: rule.actionLabel
  });
}

const CYCLE_LINK_RESOLVE_HINT = 'Open delete preparation to remove downstream cycles, enrollments, and locked-session blockers before deleting this class.';
const DELETE_PREPARATION_ACTION_LABEL = 'Open delete preparation';

async function scanClassDownstreamCycle(classId, reqUser, rule) {
  const classRow = await schoolDataService.getDataById('classes', toPublicId(classId), reqUser);
  if (!classRow) return null;
  const nextClassId = toPublicId(classRow?.nextClassId);
  if (!nextClassId) return null;
  const nextClass = await schoolDataService.getDataById('classes', nextClassId, reqUser);
  if (!nextClass) return null;

  const normalizedTargetId = toPublicId(classId);
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: 1,
    samples: [{
      id: nextClassId,
      label: String(nextClass?.title || nextClass?.name || nextClassId).trim(),
      href: SECTION_HREFS.classes(nextClassId)
    }],
    resolveHint: rule.resolveHint || 'Delete downstream cycles first (tail-first).',
    section: rule.section || 'classes',
    actionHref: SECTION_HREFS.deletePreparation(normalizedTargetId, nextClassId),
    actionLabel: DELETE_PREPARATION_ACTION_LABEL
  });
}

async function scanClassCycleLinkField(rule, targetId, orgId, reqUser) {
  const rows = await fetchScoped(rule.entityType, rule.field, targetId, orgId, reqUser);
  if (!rows.length) return null;
  const normalizedTargetId = toPublicId(targetId);
  const hrefFn = (row) => SECTION_HREFS.deletePreparation(normalizedTargetId, recordId(row));
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: rows.length,
    samples: samplesFromRows(rows, rule.sampleLabel, hrefFn),
    resolveHint: rule.resolveHint || CYCLE_LINK_RESOLVE_HINT,
    section: rule.section,
    severity: rule.severity,
    childPolicy: rule.childPolicy,
    actionHref: SECTION_HREFS.deletePreparation(normalizedTargetId),
    actionLabel: DELETE_PREPARATION_ACTION_LABEL
  });
}

async function scanProgramsEmbeddingArray({ arrayField, idField, targetId, orgId, reqUser, rule }) {
  const programs = scopeByOrg(await schoolDataService.fetchData('programs', {}, reqUser), orgId);
  const matches = programs.filter((program) => {
    const items = Array.isArray(program?.[arrayField]) ? program[arrayField] : [];
    return items.some((item) => idsEqual(item?.[idField], targetId));
  });
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row), (row) => SECTION_HREFS.programs(recordId(row))),
    resolveHint: rule.resolveHint,
    section: rule.section,
    severity: rule.severity,
    childPolicy: rule.childPolicy
  });
}

async function scanProgramsEmbeddingSubjectWithPrereqs(targetId, orgId, reqUser, rule) {
  const programs = scopeByOrg(await schoolDataService.fetchData('programs', {}, reqUser), orgId);
  const matches = programs.filter((program) => {
    const subjects = Array.isArray(program?.subjects) ? program.subjects : [];
    const inSubjects = subjects.some((item) => idsEqual(item?.subjectId, targetId));
    const inPrereqs = subjects.some((item) =>
      (Array.isArray(item?.prerequisites) ? item.prerequisites : []).some((pre) => idsEqual(pre, targetId) || idsEqual(pre?.subjectId, targetId))
    );
    return inSubjects || inPrereqs;
  });
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row), (row) => SECTION_HREFS.programs(recordId(row))),
    resolveHint: rule.resolveHint,
    section: rule.section
  });
}

async function scanClassesEmbeddingSubject(targetId, orgId, reqUser, rule) {
  const classes = scopeByOrg(await schoolDataService.fetchData('classes', {}, reqUser), orgId);
  const matches = classes.filter((cls) => {
    const subjects = Array.isArray(cls?.curriculum?.subjects) ? cls.curriculum.subjects : [];
    return subjects.some((item) => idsEqual(item?.subjectId, targetId));
  });
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row), (row) => SECTION_HREFS.classes(recordId(row))),
    resolveHint: rule.resolveHint,
    section: rule.section
  });
}

async function scanWithdrawalsByField(field, targetId, orgId, reqUser, rule) {
  const query = { page: 1, [`${field}__eq`]: toPublicId(targetId) };
  if (orgId) query.orgId__eq = String(orgId);
  const rows = await withdrawalRepository.list({
    query,
    scope: { activeOrgId: orgId, canViewAll: !orgId }
  });
  const matches = Array.isArray(rows) ? rows : [];
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row, row.id), (row) => SECTION_HREFS.withdrawals(recordId(row))),
    resolveHint: rule.resolveHint,
    section: rule.section,
    severity: rule.severity,
    childPolicy: rule.childPolicy
  });
}

async function scanTimesheetSourceBlocker({ sourceType, sourceRef, orgId, reqUser, rule, label }) {
  const blockers = await schoolDependencyService.buildTimesheetBlockers({
    orgId,
    sourceType,
    sourceRef,
    reqUser
  });
  if (!blockers.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: blockers.length,
    samples: blockers.slice(0, MAX_SAMPLES).map((row) => ({
      id: row.timesheetId,
      label: `${row.periodName || row.periodId || 'Period'} — ${row.teacherLabel || row.teacherId || 'Teacher'} (${row.status || 'approved'})`,
      href: SECTION_HREFS.timesheets(row.periodId, row.teacherId)
    })),
    resolveHint: rule.resolveHint || 'This record is referenced by approved timesheet data. Reopen or adjust the timesheet before deleting.',
    section: rule.section || 'timesheets',
    severity: 'error'
  });
}

async function scanTimesheetPeriodAnyTimesheets(periodId, orgId, reqUser, rule) {
  const timesheets = scopeByOrg(await schoolDataService.fetchData('timesheets', {}, reqUser), orgId);
  const matches = timesheets.filter((row) => idsEqual(row?.periodId, periodId));
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(
      matches,
      (row) => `${row.teacherId || 'Teacher'} (${row.status || 'draft'})`,
      (row) => SECTION_HREFS.timesheets(row.periodId, row.teacherId)
    ),
    resolveHint: rule.resolveHint || 'Delete or reassign all timesheets for this period first.',
    section: 'timesheets'
  });
}

async function scanClassLockedSessions(classId, reqUser, rule) {
  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const locked = (Array.isArray(sessions) ? sessions : []).filter((session) =>
    schoolDependencyService.isSessionTimesheetLocked(session)
    && String(session?.lockReason || '') === 'timesheet_approved'
  );
  if (!locked.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: locked.length,
    samples: locked.slice(0, MAX_SAMPLES).map((session) => ({
      id: toPublicId(session?.sessionId || session?.id),
      label: `${session?.date || 'Session'} ${session?.startTime || ''}`.trim(),
      href: SECTION_HREFS.sessions(classId, toPublicId(session?.sessionId || session?.id))
    })),
    resolveHint: rule.resolveHint || 'Reopen the approved timesheet that locked these sessions first.',
    section: 'timesheets'
  });
}

async function scanClassAllSessionTimesheetRefs(classId, orgId, reqUser, rule) {
  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const blockers = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const sessionId = toPublicId(session?.sessionId || session?.id);
    if (!sessionId) continue;
    // eslint-disable-next-line no-await-in-loop
    const blocker = await scanTimesheetSourceBlocker({
      sourceType: 'classSession',
      sourceRef: { classId, sessionId },
      orgId,
      reqUser,
      rule: { ...rule, code: `${rule.code}_SESSION`, label: 'Approved timesheet session references' }
    });
    if (blocker) blockers.push(blocker);
  }
  if (!blockers.length) return null;
  const total = blockers.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const samples = blockers.flatMap((row) => row.samples || []).slice(0, MAX_SAMPLES);
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: total,
    samples,
    resolveHint: rule.resolveHint,
    section: 'timesheets'
  });
}

async function scanReportAssignmentsByTeacherId(teacherId, orgId, reqUser, rule) {
  const normalizedTeacherId = toPublicId(teacherId);
  if (!normalizedTeacherId) return null;
  const assignments = scopeByOrg(await schoolDataService.fetchData('reportAssignments', {}, reqUser), orgId);
  const matches = assignments.filter((row) =>
    (Array.isArray(row?.teacherIds) ? row.teacherIds : []).some((candidateId) => idsEqual(candidateId, normalizedTeacherId))
  );
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row), (row) => SECTION_HREFS.reports.assignment(recordId(row))),
    resolveHint: rule.resolveHint || 'Remove or reassign report assignments that include this teacher.',
    section: rule.section || 'reports'
  });
}

async function scanPayRatesByPersonRole(personId, personRole, orgId, reqUser, rule) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) return null;
  const query = { page: 1, personId__eq: normalizedPersonId };
  const role = String(personRole || '').trim();
  if (role) query.personRole__eq = role;
  if (orgId) query.orgId__eq = String(orgId);
  const rows = await schoolDataService.fetchData('payRates', query, reqUser);
  const matches = Array.isArray(rows) ? rows : [];
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row), (row) => SECTION_HREFS.payRates(recordId(row))),
    resolveHint: rule.resolveHint || 'Remove or reassign pay rates linked to this person first.',
    section: rule.section || 'payroll'
  });
}

async function scanAccountOwnerConflicts(accountId, orgId, reqUser, rule) {
  const targetAccountId = toPublicId(accountId);
  if (!targetAccountId) return null;

  const owners = [];
  const [students, teachers, staffRows] = await Promise.all([
    schoolDataService.fetchData('students', {}, reqUser),
    schoolDataService.fetchData('teachers', {}, reqUser),
    schoolDataService.fetchData('staff', {}, reqUser)
  ]);

  (Array.isArray(students) ? students : []).forEach((student) => {
    if (!idsEqual(student?.studentAccountId, targetAccountId)) return;
    owners.push({
      type: 'student',
      id: toPublicId(student?.id),
      status: student?.academicStatus || 'Unknown',
      href: SECTION_HREFS.students(toPublicId(student?.id))
    });
  });
  (Array.isArray(teachers) ? teachers : []).forEach((teacher) => {
    if (!idsEqual(teacher?.teacherAccountId, targetAccountId)) return;
    owners.push({
      type: 'teacher',
      id: toPublicId(teacher?.id),
      status: teacher?.status || 'Unknown',
      href: SECTION_HREFS.teachers(toPublicId(teacher?.id))
    });
  });
  (Array.isArray(staffRows) ? staffRows : []).forEach((member) => {
    if (!idsEqual(member?.staffAccountId, targetAccountId)) return;
    owners.push({
      type: 'staff',
      id: toPublicId(member?.id),
      status: member?.status || 'Unknown',
      href: SECTION_HREFS.staff(toPublicId(member?.id))
    });
  });

  const scopedOwners = orgId
    ? owners.filter((owner) => {
      const rows = owner.type === 'student' ? students : owner.type === 'teacher' ? teachers : staffRows;
      const row = (Array.isArray(rows) ? rows : []).find((item) => idsEqual(item?.id, owner.id));
      return !row?.orgId || idsEqual(row.orgId, orgId);
    })
    : owners;

  if (!scopedOwners.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: scopedOwners.length,
    samples: scopedOwners.slice(0, MAX_SAMPLES).map((owner) => ({
      id: owner.id,
      label: `${String(owner.type || '').toUpperCase()}: ${owner.id} (${owner.status})`,
      href: owner.href || ''
    })),
    resolveHint: rule.resolveHint || 'Archive or recover this account from the linked student, teacher, or staff record instead.',
    section: rule.section || 'people'
  });
}

async function scanJournalLinesReferencingAccount(accountId, orgId, reqUser, rule) {
  const targetAccountId = toPublicId(accountId);
  if (!targetAccountId) return null;
  const journals = scopeByOrg(await schoolDataService.fetchData('transactionJournals', {}, reqUser), orgId);
  const matches = (Array.isArray(journals) ? journals : []).filter((journal) =>
    (Array.isArray(journal?.lines) ? journal.lines : []).some((line) => idsEqual(line?.accountId, targetAccountId))
  );
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row, row.id), (row) => SECTION_HREFS.transactions(recordId(row))),
    resolveHint: rule.resolveHint || 'Remove or update journal lines that reference this account first.',
    section: rule.section || 'transactions'
  });
}

async function scanPostingPoliciesReferencingTransactionDefinition(transactionDefinitionId, orgId, reqUser, rule) {
  const targetId = toPublicId(transactionDefinitionId);
  if (!targetId) return null;

  const matches = [];
  const [programs, departments, classes] = await Promise.all([
    scopeByOrg(await schoolDataService.fetchData('programs', {}, reqUser), orgId),
    scopeByOrg(await schoolDataService.fetchData('departments', {}, reqUser), orgId),
    scopeByOrg(await schoolDataService.fetchData('classes', {}, reqUser), orgId)
  ]);

  (programs || []).forEach((program) => {
    const uses = (Array.isArray(program?.postingPolicies) ? program.postingPolicies : [])
      .some((row) => idsEqual(row?.transactionDefinitionId, targetId));
    if (uses) matches.push({ entityType: 'program', row: program });
  });
  (departments || []).forEach((department) => {
    const uses = (Array.isArray(department?.postingPolicies) ? department.postingPolicies : [])
      .some((row) => idsEqual(row?.transactionDefinitionId, targetId));
    if (uses) matches.push({ entityType: 'department', row: department });
  });
  (classes || []).forEach((classRow) => {
    const templateUses = (Array.isArray(classRow?.postingTemplates) ? classRow.postingTemplates : [])
      .some((row) => idsEqual(row?.transactionDefinitionId, targetId));
    const feeUses = (Array.isArray(classRow?.pricing?.feeRules) ? classRow.pricing.feeRules : [])
      .some((row) => idsEqual(row?.transactionDefinitionId, targetId));
    if (templateUses || feeUses) matches.push({ entityType: 'class', row: classRow });
  });

  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: matches.slice(0, MAX_SAMPLES).map((entry) => ({
      id: recordId(entry.row),
      label: `${String(entry.entityType || 'record')}: ${recordLabel(entry.row)}`,
      href: entry.entityType === 'program'
        ? SECTION_HREFS.programs(recordId(entry.row))
        : entry.entityType === 'department'
          ? SECTION_HREFS.departments(recordId(entry.row))
          : SECTION_HREFS.classes(recordId(entry.row))
    })),
    resolveHint: rule.resolveHint || 'Remove this transaction template from posting policies before deleting it.',
    section: rule.section || 'transactions'
  });
}

async function scanTransactionJournalDeletePolicy(ctx = {}) {
  const record = ctx.record || {};
  const status = String(record?.status || '').trim().toLowerCase();
  if (!status || status === 'draft') return null;
  return buildBlocker({
    code: 'JOURNAL_NOT_DRAFT',
    label: 'Journal status',
    count: 1,
    samples: [{
      id: recordId(record),
      label: `${recordLabel(record, recordId(record))} (${status})`,
      href: SECTION_HREFS.transactions(recordId(record))
    }],
    resolveHint: 'Only draft journals can be deleted. Void posted journals instead.',
    section: 'transactions'
  });
}

async function scanClassEnrollmentPeriodDeletePolicy(ctx = {}) {
  const record = ctx.record || {};
  const status = String(record?.status || '').trim().toLowerCase();
  const postedTransactionIds = Array.isArray(record?.transactionSummary?.postedTransactionIds)
    ? record.transactionSummary.postedTransactionIds.map((id) => toPublicId(id)).filter(Boolean)
    : [];
  if (status === 'draft' || !postedTransactionIds.length) return null;
  return buildBlocker({
    code: 'ENROLLMENT_POSTED',
    label: 'Posted enrollment transactions',
    count: postedTransactionIds.length,
    samples: postedTransactionIds.slice(0, MAX_SAMPLES).map((id) => ({
      id,
      label: id,
      href: SECTION_HREFS.transactions(id)
    })),
    resolveHint: 'Rollback posted enrollment transactions before deleting this period.',
    section: 'enrollments'
  });
}

async function scanExamAllocationDeletePolicy(ctx = {}) {
  const record = ctx.record || {};
  const status = String(record?.status || '').trim().toLowerCase();
  if (status !== 'cancelled') {
    return buildBlocker({
      code: 'ALLOCATION_NOT_CANCELLED',
      label: 'Allocation status',
      count: 1,
      samples: [{
        id: recordId(record),
        label: `${recordLabel(record, recordId(record))} (${status || 'active'})`,
        href: SECTION_HREFS.examAllocations(recordId(record))
      }],
      resolveHint: 'Cancel the allocation before deleting it.',
      section: 'exams'
    });
  }

  const assignments = await fetchScoped('examAssignments', 'allocationId', ctx.id, ctx.orgId, ctx.reqUser);
  const nonCancelled = assignments.filter((row) => String(row?.status || '').trim().toLowerCase() !== 'cancelled');
  if (!nonCancelled.length) return null;
  return buildBlocker({
    code: 'EXAM_ASSIGNMENT_ACTIVE',
    label: 'Linked Exam Assignments',
    count: nonCancelled.length,
    samples: samplesFromRows(nonCancelled, (row) => recordLabel(row), (row) => SECTION_HREFS.exams.assignment(recordId(row))),
    resolveHint: 'Cancel all linked exam assignments before deleting this allocation.',
    section: 'exams'
  });
}

async function scanReportAssignmentsBySession(sessionId, classId, orgId, reqUser, rule) {
  const assignments = scopeByOrg(await schoolDataService.fetchData('reportAssignments', {}, reqUser), orgId);
  const matches = assignments.filter((row) => {
    if (classId && !idsEqual(row?.classId, classId)) return false;
    if (idsEqual(row?.sessionId, sessionId)) return true;
    const targetRows = Array.isArray(row?.targetRows) ? row.targetRows : [];
    return targetRows.some((target) => idsEqual(target?.sessionId, sessionId));
  });
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row), (row) => SECTION_HREFS.reports.assignment(recordId(row))),
    resolveHint: rule.resolveHint || 'Remove or reassign report assignments that use this session.',
    section: 'reports'
  });
}

async function scanLeaveRequestsBySession(classId, sessionId, orgId, reqUser, rule) {
  const rows = scopeByOrg(await schoolDataService.fetchData('leaveRequests', {}, reqUser), orgId);
  const matches = rows.filter((row) => {
    const subs = Array.isArray(row?.sessionSubstitutions) ? row.sessionSubstitutions : [];
    return subs.some((sub) => idsEqual(sub?.classId, classId) && idsEqual(sub?.sessionId, sessionId));
  });
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: samplesFromRows(matches, (row) => recordLabel(row, row.id), (row) => SECTION_HREFS.leaveRequests(recordId(row))),
    resolveHint: rule.resolveHint || 'Update or remove leave requests that reference this session.',
    section: 'leaveRequests'
  });
}

async function scanSessionStatusUsage(statusCode, orgId, reqUser, rule) {
  const normalizedCode = String(statusCode || '').trim().toLowerCase();
  if (!normalizedCode) return null;
  const classes = scopeByOrg(await schoolDataService.fetchData('classes', {}, reqUser), orgId);
  const matches = [];
  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      const code = String(session?.status || '').trim().toLowerCase();
      if (code !== normalizedCode) return;
      matches.push({
        classId,
        classTitle: recordLabel(classRow),
        sessionId: toPublicId(session?.sessionId || session?.id),
        sessionDate: session?.date || ''
      });
    });
  }
  if (!matches.length) return null;
  return buildBlocker({
    code: rule.code,
    label: rule.label,
    count: matches.length,
    samples: matches.slice(0, MAX_SAMPLES).map((row) => ({
      id: row.sessionId,
      label: `${row.classTitle || row.classId} — ${row.sessionDate || row.sessionId}`,
      href: SECTION_HREFS.sessions(row.classId, row.sessionId)
    })),
    resolveHint: rule.resolveHint || 'Change session statuses or remove sessions using this status code first.',
    section: 'classes'
  });
}

async function scanActivityTimesheetLock(activity, rule) {
  try {
    schoolDependencyService.assertActivityNotTimesheetLocked(activity, recordLabel(activity));
    return null;
  } catch (error) {
    return buildBlocker({
      code: rule.code,
      label: rule.label,
      count: 1,
      samples: [{ id: recordId(activity), label: recordLabel(activity), href: SECTION_HREFS.activities(recordId(activity)) }],
      resolveHint: rule.resolveHint || error.message,
      section: 'timesheets'
    });
  }
}

async function scanSessionTimesheetLock(session, classId, sessionId, rule) {
  try {
    schoolDependencyService.assertSessionNotTimesheetLocked(session, 'This session');
    return null;
  } catch (error) {
    return buildBlocker({
      code: rule.code,
      label: rule.label,
      count: 1,
      samples: [{
        id: sessionId,
        label: `${session?.date || 'Session'} ${session?.startTime || ''}`.trim(),
        href: SECTION_HREFS.sessions(classId, sessionId)
      }],
      resolveHint: rule.resolveHint || error.message,
      section: 'timesheets'
    });
  }
}

async function runFieldRules(rules = [], targetId, orgId, reqUser) {
  const blockers = [];
  for (const rule of rules) {
    if (rule.type !== 'fieldMatch') continue;
    // eslint-disable-next-line no-await-in-loop
    const blocker = await scanFieldMatch(rule, targetId, orgId, reqUser);
    if (blocker) blockers.push(blocker);
  }
  return blockers;
}

const ENTITY_DEFINITIONS = Object.freeze({
  program: {
    entityKey: 'program',
    repositoryKey: 'programs',
    deleteMode: 'hard',
    labelFields: ['name', 'code', 'title'],
    fieldRules: [
      { type: 'fieldMatch', code: 'PROGRAM_REGISTRATION', entityType: 'studentProgramRegistrations', field: 'programId', label: 'Student Program Registrations', section: 'registrations', childPolicy: 'immutable_child', resolveHint: 'Complete withdrawal workflows instead of deleting registrations.' },
      { type: 'fieldMatch', code: 'TERM_REGISTRATION', entityType: 'studentTermRegistrations', field: 'programId', label: 'Student Term Registrations', section: 'registrations', childPolicy: 'immutable_child', resolveHint: 'Complete withdrawal workflows instead of deleting registrations.' },
      { type: 'fieldMatch', code: 'CLASS_ALLOWED_PROGRAM', entityType: 'classes', field: 'allowedProgramTerms.programId', label: 'Classes', section: 'classes', sectionHref: SECTION_HREFS.classes },
      { type: 'fieldMatch', code: 'ENROLLMENT_PERIOD', entityType: 'classEnrollmentPeriods', field: 'programId', label: 'Class Enrollment Periods', section: 'enrollments', sectionHref: SECTION_HREFS.enrollments },
      { type: 'fieldMatch', code: 'ACADEMIC_LEDGER', entityType: 'academicLedger', field: 'programId', label: 'Academic Ledger', section: 'academicLedger', childPolicy: 'immutable_child', sectionHref: (row) => SECTION_HREFS.academicLedger(row), resolveHint: 'Academic ledger entries cannot be deleted. Void entries if corrections are required.' },
      { type: 'fieldMatch', code: 'ACADEMIC_SNAPSHOT', entityType: 'academicSnapshots', field: 'programId', label: 'Academic Snapshots', section: 'academicLedger', childPolicy: 'immutable_child', resolveHint: 'Academic snapshots are derived records and cannot be removed directly.' },
      { type: 'fieldMatch', code: 'PRIOR_SUBJECT_CREDIT', entityType: 'studentProgramPriorSubjects', field: 'programId', label: 'Prior Subject Credits', section: 'registrations', sectionHref: (id) => `/school/students/prior-subjects/${encodeURIComponent(id)}` },
      { type: 'fieldMatch', code: 'GLOBAL_TRANSACTION', entityType: 'globalTransactions', field: 'party.programId', label: 'Global Transactions', section: 'transactions', childPolicy: 'immutable_child', resolveHint: 'Financial transactions are immutable. Use reversal or void workflows.' }
    ],
    customScanners: [
      async (ctx) => scanWithdrawalsByField('programId', ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'WITHDRAWAL',
        label: 'Withdrawals',
        section: 'withdrawals',
        childPolicy: 'immutable_child',
        resolveHint: 'Resolve open withdrawal records before deleting this program.'
      })
    ]
  },

  department: {
    entityKey: 'department',
    repositoryKey: 'departments',
    deleteMode: 'hard',
    labelFields: ['name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'PROGRAM', entityType: 'programs', field: 'departmentId', label: 'Programs', section: 'programs', sectionHref: SECTION_HREFS.programs },
      { type: 'fieldMatch', code: 'SUBJECT', entityType: 'subjects', field: 'academicUnit.departmentId', label: 'Subjects', section: 'subjects', sectionHref: SECTION_HREFS.subjects },
      { type: 'fieldMatch', code: 'CLASS', entityType: 'classes', field: 'deliveryDepartmentId', label: 'Classes', section: 'classes', sectionHref: SECTION_HREFS.classes },
      { type: 'fieldMatch', code: 'TEACHER', entityType: 'teachers', field: 'departmentId', label: 'Teachers', section: 'people', sectionHref: (id) => `/school/teachers/edit/${encodeURIComponent(id)}` },
      { type: 'fieldMatch', code: 'STAFF', entityType: 'staff', field: 'departmentId', label: 'Staff', section: 'people', sectionHref: (id) => `/school/staff/edit/${encodeURIComponent(id)}` },
      { type: 'fieldMatch', code: 'PAY_RATE', entityType: 'payRates', field: 'departmentId', label: 'Pay Rates', section: 'payroll', sectionHref: (id) => `/school/payRates/edit/${encodeURIComponent(id)}` },
      { type: 'fieldMatch', code: 'ACTIVITY', entityType: 'activities', field: 'departmentId', label: 'Activities', section: 'activities', sectionHref: SECTION_HREFS.activities },
      { type: 'fieldMatch', code: 'EXAM_TEMPLATE', entityType: 'examTemplates', field: 'departmentId', label: 'Exam Templates', section: 'exams', sectionHref: (id) => `/school/exams/templates/edit/${encodeURIComponent(id)}` }
    ]
  },

  subject: {
    entityKey: 'subject',
    repositoryKey: 'subjects',
    deleteMode: 'hard',
    labelFields: ['name', 'code', 'title'],
    fieldRules: [
      { type: 'fieldMatch', code: 'PRIOR_SUBJECT_CREDIT', entityType: 'studentProgramPriorSubjects', field: 'subjectId', label: 'Prior Subject Credits', section: 'registrations' },
      { type: 'fieldMatch', code: 'ACADEMIC_LEDGER', entityType: 'academicLedger', field: 'subjectId', label: 'Academic Ledger', section: 'academicLedger', childPolicy: 'immutable_child', sectionHref: (row) => SECTION_HREFS.academicLedger(row) },
      { type: 'fieldMatch', code: 'ACADEMIC_SNAPSHOT', entityType: 'academicSnapshots', field: 'subjectId', label: 'Academic Snapshots', section: 'academicLedger', childPolicy: 'immutable_child' },
      { type: 'fieldMatch', code: 'EXAM_TEMPLATE', entityType: 'examTemplates', field: 'subjectId', label: 'Exam Templates', section: 'exams', sectionHref: (id) => `/school/exams/templates/edit/${encodeURIComponent(id)}` }
    ],
    customScanners: [
      async (ctx) => scanProgramsEmbeddingSubjectWithPrereqs(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'PROGRAM_EMBED',
        label: 'Programs',
        section: 'programs',
        resolveHint: 'Remove this subject from program curricula and prerequisites first.'
      }),
      async (ctx) => scanClassesEmbeddingSubject(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'CLASS_CURRICULUM',
        label: 'Class Curricula',
        section: 'classes',
        resolveHint: 'Remove this subject from class curricula first.'
      })
    ]
  },

  term: {
    entityKey: 'term',
    repositoryKey: 'terms',
    deleteMode: 'hard',
    labelFields: ['name', 'code', 'title'],
    fieldRules: [
      { type: 'fieldMatch', code: 'TERM_REGISTRATION', entityType: 'studentTermRegistrations', field: 'termId', label: 'Student Term Registrations', section: 'registrations', childPolicy: 'immutable_child' },
      { type: 'fieldMatch', code: 'CLASS_ALLOWED_TERM', entityType: 'classes', field: 'allowedProgramTerms.termId', label: 'Classes', section: 'classes', sectionHref: SECTION_HREFS.classes },
      { type: 'fieldMatch', code: 'ENROLLMENT_PERIOD', entityType: 'classEnrollmentPeriods', field: 'termId', label: 'Class Enrollment Periods', section: 'enrollments', sectionHref: SECTION_HREFS.enrollments },
      { type: 'fieldMatch', code: 'ACADEMIC_LEDGER', entityType: 'academicLedger', field: 'termId', label: 'Academic Ledger', section: 'academicLedger', childPolicy: 'immutable_child', sectionHref: (row) => SECTION_HREFS.academicLedger(row) },
      { type: 'fieldMatch', code: 'ACADEMIC_SNAPSHOT', entityType: 'academicSnapshots', field: 'termId', label: 'Academic Snapshots', section: 'academicLedger', childPolicy: 'immutable_child' }
    ],
    customScanners: [
      async (ctx) => scanProgramsEmbeddingArray({
        arrayField: 'terms',
        idField: 'termId',
        targetId: ctx.id,
        orgId: ctx.orgId,
        reqUser: ctx.reqUser,
        rule: {
          code: 'PROGRAM_EMBED',
          label: 'Programs',
          section: 'programs',
          resolveHint: 'Remove this term from program structures first.'
        }
      }),
      async (ctx) => scanWithdrawalsByField('termId', ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'WITHDRAWAL',
        label: 'Withdrawals',
        section: 'withdrawals',
        childPolicy: 'immutable_child'
      })
    ]
  },

  class: {
    entityKey: 'class',
    repositoryKey: 'classes',
    deleteMode: 'hard',
    labelFields: ['title', 'name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'REPORT_ASSIGNMENT', entityType: 'reportAssignments', field: 'classId', label: 'Report Assignments', section: 'reports', sectionHref: SECTION_HREFS.reports.assignment },
      { type: 'fieldMatch', code: 'REPORT_INSTANCE', entityType: 'reportInstances', field: 'classId', label: 'Report Instances', section: 'reports', sectionHref: SECTION_HREFS.reports.instance },
      { type: 'fieldMatch', code: 'ENROLLMENT_PERIOD', entityType: 'classEnrollmentPeriods', field: 'classId', label: 'Class Enrollment Periods', section: 'enrollments', sectionHref: SECTION_HREFS.enrollments, resolveHint: 'Open delete preparation to remove enrollments before deleting this class.', actionHref: (ctx) => SECTION_HREFS.deletePreparation(ctx?.id), actionLabel: DELETE_PREPARATION_ACTION_LABEL },
      { type: 'fieldMatch', code: 'SESSION_CASE', entityType: 'sessionStudentCases', field: 'classId', label: 'Session Student Cases', section: 'cases', childPolicy: 'cascade_with_class', sectionHref: (row) => SECTION_HREFS.cases(row?.classId, row?.sessionId) },
      { type: 'fieldMatch', code: 'EXAM_ALLOCATION', entityType: 'examAllocations', field: 'classId', label: 'Exam Allocations', section: 'exams', sectionHref: SECTION_HREFS.exams.allocation },
      { type: 'fieldMatch', code: 'EXAM_ASSIGNMENT', entityType: 'examAssignments', field: 'classId', label: 'Exam Assignments', section: 'exams', sectionHref: SECTION_HREFS.exams.assignment },
      { type: 'fieldMatch', code: 'ACADEMIC_LEDGER', entityType: 'academicLedger', field: 'classId', label: 'Academic Ledger', section: 'academicLedger', childPolicy: 'immutable_child', sectionHref: (row) => SECTION_HREFS.academicLedger(row) }
    ],
    customScanners: [
      async (ctx) => scanClassDownstreamCycle(ctx.id, ctx.reqUser, {
        code: 'CLASS_DOWNSTREAM_CYCLE',
        label: 'Downstream rolling cycle',
        section: 'classes',
        resolveHint: 'Delete downstream cycles first (tail-first).'
      }),
      async (ctx) => scanClassLockedSessions(ctx.id, ctx.reqUser, {
        code: 'TIMESHEET_LOCKED_SESSION',
        label: 'Timesheet-locked sessions'
      }),
      async (ctx) => scanClassAllSessionTimesheetRefs(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'TIMESHEET_APPROVED_REF',
        label: 'Approved timesheet references',
        resolveHint: 'Reopen or adjust approved timesheets that reference class sessions before deleting this class.'
      }),
      async (ctx) => scanWithdrawalsByField('classId', ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'WITHDRAWAL',
        label: 'Withdrawals',
        section: 'withdrawals',
        childPolicy: 'immutable_child'
      })
    ]
  },

  session: {
    entityKey: 'session',
    repositoryKey: null,
    deleteMode: 'embedded',
    requiresContext: ['classId'],
    labelFields: ['date', 'sessionId'],
    fieldRules: [
      { type: 'fieldMatch', code: 'REPORT_INSTANCE', entityType: 'reportInstances', field: 'sessionId', label: 'Report Instances', section: 'reports', sectionHref: SECTION_HREFS.reports.instance },
      { type: 'fieldMatch', code: 'SESSION_CASE', entityType: 'sessionStudentCases', field: 'sessionId', label: 'Session Student Cases', section: 'cases' }
    ],
    customScanners: [
      async (ctx) => {
        const classId = normalizeId(ctx.context?.classId);
        const sessionId = normalizeId(ctx.id);
        if (!classId || !sessionId) return null;
        return scanReportAssignmentsBySession(sessionId, classId, ctx.orgId, ctx.reqUser, {
          code: 'REPORT_ASSIGNMENT',
          label: 'Report Assignments',
          section: 'reports'
        });
      },
      async (ctx) => {
        const classId = normalizeId(ctx.context?.classId);
        const sessionId = normalizeId(ctx.id);
        if (!classId || !sessionId) return null;
        return scanLeaveRequestsBySession(classId, sessionId, ctx.orgId, ctx.reqUser, {
          code: 'LEAVE_REQUEST',
          label: 'Leave Requests',
          section: 'leaveRequests'
        });
      },
      async (ctx) => {
        const classId = normalizeId(ctx.context?.classId);
        const sessionId = normalizeId(ctx.id);
        if (!classId || !sessionId) return null;
        const sessions = await schoolDataService.getClassSessions(classId, ctx.reqUser);
        const session = (Array.isArray(sessions) ? sessions : []).find((row) => idsEqual(row?.sessionId || row?.id, sessionId));
        if (!session) return null;
        return scanSessionTimesheetLock(session, classId, sessionId, {
          code: 'TIMESHEET_LOCK',
          label: 'Timesheet lock'
        });
      },
      async (ctx) => {
        const classId = normalizeId(ctx.context?.classId);
        const sessionId = normalizeId(ctx.id);
        if (!classId || !sessionId) return null;
        return scanTimesheetSourceBlocker({
          sourceType: 'classSession',
          sourceRef: { classId, sessionId },
          orgId: ctx.orgId,
          reqUser: ctx.reqUser,
          rule: {
            code: 'TIMESHEET_APPROVED_REF',
            label: 'Approved timesheet references',
            section: 'timesheets'
          }
        });
      }
    ]
  },

  reportTemplate: {
    entityKey: 'reportTemplate',
    repositoryKey: 'reportTemplates',
    deleteMode: 'hard',
    labelFields: ['name', 'title', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'REPORT_ASSIGNMENT', entityType: 'reportAssignments', field: 'templateId', label: 'Report Assignments', section: 'reports', sectionHref: SECTION_HREFS.reports.assignment },
      { type: 'fieldMatch', code: 'REPORT_INSTANCE', entityType: 'reportInstances', field: 'templateId', label: 'Report Instances', section: 'reports', sectionHref: SECTION_HREFS.reports.instance }
    ]
  },

  reportAssignment: {
    entityKey: 'reportAssignment',
    repositoryKey: 'reportAssignments',
    deleteMode: 'hard',
    labelFields: ['title', 'name'],
    fieldRules: [
      { type: 'fieldMatch', code: 'REPORT_INSTANCE', entityType: 'reportInstances', field: 'assignmentId', label: 'Report Instances', section: 'reports', sectionHref: SECTION_HREFS.reports.instance }
    ],
    customScanners: [
      async (ctx) => scanTimesheetSourceBlocker({
        sourceType: 'reportAssignment',
        sourceRef: { assignmentId: ctx.id },
        orgId: ctx.orgId,
        reqUser: ctx.reqUser,
        rule: {
          code: 'TIMESHEET_APPROVED_REF',
          label: 'Approved timesheet references',
          section: 'timesheets'
        }
      })
    ]
  },

  reportInstance: {
    entityKey: 'reportInstance',
    repositoryKey: 'reportInstances',
    deleteMode: 'hard',
    labelFields: ['title', 'name', 'id'],
    fieldRules: []
  },

  timesheetPeriod: {
    entityKey: 'timesheetPeriod',
    repositoryKey: 'timesheetPeriods',
    deleteMode: 'hard',
    labelFields: ['name', 'title'],
    fieldRules: [],
    customScanners: [
      async (ctx) => scanTimesheetPeriodAnyTimesheets(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'TIMESHEET',
        label: 'Timesheets',
        resolveHint: 'Delete or move all timesheets in this period before deleting the period.'
      })
    ]
  },

  activity: {
    entityKey: 'activity',
    repositoryKey: 'activities',
    deleteMode: 'hard',
    labelFields: ['title', 'name'],
    fieldRules: [],
    customScanners: [
      async (ctx) => {
        if (!ctx.record) return null;
        return scanActivityTimesheetLock(ctx.record, {
          code: 'TIMESHEET_LOCK',
          label: 'Timesheet lock'
        });
      },
      async (ctx) => scanTimesheetSourceBlocker({
        sourceType: 'activity',
        sourceRef: { activityId: ctx.id },
        orgId: ctx.orgId,
        reqUser: ctx.reqUser,
        rule: {
          code: 'TIMESHEET_APPROVED_REF',
          label: 'Approved timesheet references',
          section: 'timesheets'
        }
      })
    ]
  },

  activityCategory: {
    entityKey: 'activityCategory',
    repositoryKey: 'activityCategories',
    deleteMode: 'hard',
    labelFields: ['name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'ACTIVITY', entityType: 'activities', field: 'categoryId', label: 'Activities', section: 'activities', sectionHref: SECTION_HREFS.activities }
    ]
  },

  sessionStatus: {
    entityKey: 'sessionStatus',
    repositoryKey: 'sessionStatuses',
    deleteMode: 'hard',
    labelFields: ['label', 'code', 'name'],
    fieldRules: [],
    customScanners: [
      async (ctx) => {
        const statusCode = String(ctx.record?.code || ctx.record?.id || ctx.id || '').trim();
        const usageBlocker = await scanSessionStatusUsage(statusCode, ctx.orgId, ctx.reqUser, {
          code: 'CLASS_SESSION',
          label: 'Class sessions using this status',
          section: 'classes'
        });
        if (usageBlocker) return usageBlocker;
        const classes = scopeByOrg(await schoolDataService.fetchData('classes', {}, ctx.reqUser), ctx.orgId);
        for (const classRow of classes) {
          const classId = toPublicId(classRow?.id);
          if (!classId) continue;
          // eslint-disable-next-line no-await-in-loop
          const sessions = await schoolDataService.getClassSessions(classId, ctx.reqUser);
          for (const session of Array.isArray(sessions) ? sessions : []) {
            const code = String(session?.status || '').trim().toLowerCase();
            if (code !== statusCode.toLowerCase()) continue;
            const sessionId = toPublicId(session?.sessionId || session?.id);
            if (!sessionId) continue;
            // eslint-disable-next-line no-await-in-loop
            const tsBlocker = await scanTimesheetSourceBlocker({
              sourceType: 'classSession',
              sourceRef: { classId, sessionId },
              orgId: ctx.orgId,
              reqUser: ctx.reqUser,
              rule: {
                code: 'TIMESHEET_APPROVED_REF',
                label: 'Approved timesheet references',
                section: 'timesheets'
              }
            });
            if (tsBlocker) return tsBlocker;
          }
        }
        return null;
      }
    ]
  },

  student: {
    entityKey: 'student',
    repositoryKey: 'students',
    deleteMode: 'purge_only',
    labelFields: ['studentNumber', 'code', 'name'],
    fieldRules: [
      { type: 'fieldMatch', code: 'PROGRAM_REGISTRATION', entityType: 'studentProgramRegistrations', field: 'studentId', label: 'Student Program Registrations', section: 'registrations', childPolicy: 'immutable_child', resolveHint: 'Complete withdrawal workflows instead of deleting registrations.' },
      { type: 'fieldMatch', code: 'TERM_REGISTRATION', entityType: 'studentTermRegistrations', field: 'studentId', label: 'Student Term Registrations', section: 'registrations', childPolicy: 'immutable_child', resolveHint: 'Complete withdrawal workflows instead of deleting registrations.' },
      { type: 'fieldMatch', code: 'ENROLLMENT_PERIOD', entityType: 'classEnrollmentPeriods', field: 'studentId', label: 'Class Enrollment Periods', section: 'enrollments', sectionHref: SECTION_HREFS.enrollments },
      { type: 'fieldMatch', code: 'ACADEMIC_LEDGER', entityType: 'academicLedger', field: 'studentId', label: 'Academic Ledger', section: 'academicLedger', childPolicy: 'immutable_child', sectionHref: (row) => SECTION_HREFS.academicLedger(row), resolveHint: 'Academic ledger entries cannot be deleted. Void entries if corrections are required.' },
      { type: 'fieldMatch', code: 'GLOBAL_TRANSACTION', entityType: 'globalTransactions', field: 'party.studentId', label: 'Global Transactions', section: 'transactions', childPolicy: 'immutable_child', resolveHint: 'Financial transactions are immutable. Use reversal or void workflows.' },
      { type: 'fieldMatch', code: 'REPORT_INSTANCE', entityType: 'reportInstances', field: 'studentId', label: 'Report Instances', section: 'reports', sectionHref: SECTION_HREFS.reports.instance },
      { type: 'fieldMatch', code: 'EXAM_ASSIGNMENT', entityType: 'examAssignments', field: 'studentId', label: 'Exam Assignments', section: 'exams', sectionHref: SECTION_HREFS.exams.assignment },
      { type: 'fieldMatch', code: 'EXAM_ATTEMPT', entityType: 'examAttempts', field: 'studentId', label: 'Exam Attempts', section: 'exams' },
      { type: 'fieldMatch', code: 'EXAM_ANSWER', entityType: 'examAnswers', field: 'studentId', label: 'Exam Answers', section: 'exams' }
    ]
  },

  teacher: {
    entityKey: 'teacher',
    repositoryKey: 'teachers',
    deleteMode: 'purge_only',
    labelFields: ['employeeNumber', 'code', 'name'],
    fieldRules: [
      { type: 'fieldMatch', code: 'REPORT_INSTANCE', entityType: 'reportInstances', field: 'teacherId', label: 'Report Instances', section: 'reports', sectionHref: SECTION_HREFS.reports.instance },
      { type: 'fieldMatch', code: 'TIMESHEET', entityType: 'timesheets', field: 'teacherId', label: 'Timesheets', section: 'timesheets', sectionHref: (row) => SECTION_HREFS.timesheets(row.periodId, row.teacherId) },
      { type: 'fieldMatch', code: 'GLOBAL_TRANSACTION', entityType: 'globalTransactions', field: 'party.teacherId', label: 'Global Transactions', section: 'transactions', childPolicy: 'immutable_child', resolveHint: 'Financial transactions are immutable. Use reversal or void workflows.' }
    ],
    customScanners: [
      async (ctx) => scanReportAssignmentsByTeacherId(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'REPORT_ASSIGNMENT',
        label: 'Report Assignments',
        section: 'reports',
        resolveHint: 'Remove or reassign report assignments that include this teacher.'
      }),
      async (ctx) => scanPayRatesByPersonRole(ctx.record?.personId, 'teacher', ctx.orgId, ctx.reqUser, {
        code: 'PAY_RATE',
        label: 'Pay Rates',
        section: 'payroll'
      })
    ]
  },

  staff: {
    entityKey: 'staff',
    repositoryKey: 'staff',
    deleteMode: 'purge_only',
    labelFields: ['employeeNumber', 'code', 'name'],
    fieldRules: [
      { type: 'fieldMatch', code: 'GLOBAL_TRANSACTION', entityType: 'globalTransactions', field: 'party.staffId', label: 'Global Transactions', section: 'transactions', childPolicy: 'immutable_child', resolveHint: 'Financial transactions are immutable. Use reversal or void workflows.' }
    ],
    customScanners: [
      async (ctx) => scanPayRatesByPersonRole(ctx.record?.personId, 'staff', ctx.orgId, ctx.reqUser, {
        code: 'PAY_RATE',
        label: 'Pay Rates',
        section: 'payroll'
      })
    ]
  },

  schoolAccount: {
    entityKey: 'schoolAccount',
    repositoryKey: 'schoolAccounts',
    deleteMode: 'archive_only',
    labelFields: ['name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'CHILD_ACCOUNT', entityType: 'schoolAccounts', field: 'parentId', label: 'Child Accounts', section: 'accounts', sectionHref: SECTION_HREFS.schoolAccounts }
    ],
    customScanners: [
      async (ctx) => scanAccountOwnerConflicts(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'ACCOUNT_OWNER',
        label: 'Linked People Records',
        section: 'people',
        resolveHint: 'Archive or recover this account from the linked student, teacher, or staff record instead.'
      }),
      async (ctx) => scanJournalLinesReferencingAccount(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'JOURNAL_LINE',
        label: 'Transaction Journals',
        section: 'transactions'
      })
    ]
  },

  transactionDefinition: {
    entityKey: 'transactionDefinition',
    repositoryKey: 'transactionDefinitions',
    deleteMode: 'hard',
    labelFields: ['name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'GLOBAL_TRANSACTION', entityType: 'globalTransactions', field: 'transactionDefinitionId', label: 'Global Transactions', section: 'transactions', childPolicy: 'immutable_child', resolveHint: 'Financial transactions are immutable. Use reversal or void workflows.' }
    ],
    customScanners: [
      async (ctx) => scanPostingPoliciesReferencingTransactionDefinition(ctx.id, ctx.orgId, ctx.reqUser, {
        code: 'POSTING_POLICY',
        label: 'Posting Policies',
        section: 'transactions'
      })
    ]
  },

  transactionJournal: {
    entityKey: 'transactionJournal',
    repositoryKey: 'transactionJournals',
    deleteMode: 'hard',
    labelFields: ['name', 'code', 'title'],
    fieldRules: [],
    customScanners: [
      async (ctx) => scanTransactionJournalDeletePolicy(ctx)
    ]
  },

  examTemplate: {
    entityKey: 'examTemplate',
    repositoryKey: 'examTemplates',
    deleteMode: 'hard',
    labelFields: ['title', 'name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'EXAM_REVISION', entityType: 'examRevisions', field: 'templateId', label: 'Exam Revisions', section: 'exams', sectionHref: SECTION_HREFS.examTemplates },
      { type: 'fieldMatch', code: 'EXAM_ALLOCATION', entityType: 'examAllocations', field: 'templateId', label: 'Exam Allocations', section: 'exams', sectionHref: SECTION_HREFS.examAllocations }
    ]
  },

  examRevision: {
    entityKey: 'examRevision',
    repositoryKey: 'examRevisions',
    deleteMode: 'hard',
    labelFields: ['title', 'name', 'revisionNo'],
    fieldRules: [
      { type: 'fieldMatch', code: 'EXAM_QUESTION', entityType: 'examQuestions', field: 'revisionId', label: 'Exam Questions', section: 'exams' },
      { type: 'fieldMatch', code: 'EXAM_ALLOCATION', entityType: 'examAllocations', field: 'revisionId', label: 'Exam Allocations', section: 'exams', sectionHref: SECTION_HREFS.examAllocations },
      { type: 'fieldMatch', code: 'EXAM_ATTEMPT', entityType: 'examAttempts', field: 'revisionId', label: 'Exam Attempts', section: 'exams' }
    ]
  },

  examQuestion: {
    entityKey: 'examQuestion',
    repositoryKey: 'examQuestions',
    deleteMode: 'hard',
    labelFields: ['prompt', 'title', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'EXAM_ANSWER', entityType: 'examAnswers', field: 'questionId', label: 'Exam Answers', section: 'exams' }
    ]
  },

  examAllocation: {
    entityKey: 'examAllocation',
    repositoryKey: 'examAllocations',
    deleteMode: 'hard',
    labelFields: ['title', 'name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'EXAM_ASSIGNMENT', entityType: 'examAssignments', field: 'allocationId', label: 'Exam Assignments', section: 'exams', sectionHref: SECTION_HREFS.exams.assignment },
      { type: 'fieldMatch', code: 'EXAM_ATTEMPT', entityType: 'examAttempts', field: 'allocationId', label: 'Exam Attempts', section: 'exams' }
    ],
    customScanners: [
      async (ctx) => scanExamAllocationDeletePolicy(ctx)
    ]
  },

  examAssignment: {
    entityKey: 'examAssignment',
    repositoryKey: 'examAssignments',
    deleteMode: 'hard',
    labelFields: ['title', 'name', 'code'],
    fieldRules: [
      { type: 'fieldMatch', code: 'EXAM_ATTEMPT', entityType: 'examAttempts', field: 'assignmentId', label: 'Exam Attempts', section: 'exams' },
      { type: 'fieldMatch', code: 'EXAM_ANSWER', entityType: 'examAnswers', field: 'assignmentId', label: 'Exam Answers', section: 'exams' }
    ]
  },

  examAttempt: {
    entityKey: 'examAttempt',
    repositoryKey: 'examAttempts',
    deleteMode: 'hard',
    labelFields: ['title', 'name', 'attemptNo'],
    fieldRules: [
      { type: 'fieldMatch', code: 'EXAM_ANSWER', entityType: 'examAnswers', field: 'attemptId', label: 'Exam Answers', section: 'exams' }
    ]
  },

  examAnswer: {
    entityKey: 'examAnswer',
    repositoryKey: 'examAnswers',
    deleteMode: 'hard',
    labelFields: ['questionId', 'id'],
    fieldRules: []
  },

  classEnrollmentPeriod: {
    entityKey: 'classEnrollmentPeriod',
    repositoryKey: 'classEnrollmentPeriods',
    deleteMode: 'hard',
    labelFields: ['studentId', 'classId', 'status'],
    fieldRules: [],
    customScanners: [
      async (ctx) => scanClassEnrollmentPeriodDeletePolicy(ctx)
    ]
  },

  studentProgramPriorSubject: {
    entityKey: 'studentProgramPriorSubject',
    repositoryKey: 'studentProgramPriorSubjects',
    deleteMode: 'hard',
    labelFields: ['studentId', 'subjectId', 'programId'],
    fieldRules: []
  },

  leaveRequest: {
    entityKey: 'leaveRequest',
    repositoryKey: 'leaveRequests',
    deleteMode: 'hard',
    labelFields: ['title', 'personId', 'status'],
    fieldRules: []
  },

  task: {
    entityKey: 'task',
    repositoryKey: 'tasks',
    deleteMode: 'hard',
    labelFields: ['title', 'sourceType', 'status'],
    fieldRules: []
  },

  holiday: {
    entityKey: 'holiday',
    repositoryKey: 'holidays',
    deleteMode: 'hard',
    labelFields: ['name', 'title', 'date'],
    fieldRules: []
  }
});

const REPOSITORY_KEY_TO_ENTITY_KEY = Object.freeze({
  programs: 'program',
  departments: 'department',
  subjects: 'subject',
  terms: 'term',
  classes: 'class',
  reportTemplates: 'reportTemplate',
  reportAssignments: 'reportAssignment',
  reportInstances: 'reportInstance',
  timesheetPeriods: 'timesheetPeriod',
  activities: 'activity',
  activityCategories: 'activityCategory',
  sessionStatuses: 'sessionStatus',
  holidays: 'holiday',
  students: 'student',
  teachers: 'teacher',
  staff: 'staff',
  schoolAccounts: 'schoolAccount',
  transactionDefinitions: 'transactionDefinition',
  transactionTemplates: 'transactionDefinition',
  feeDefinitions: 'transactionDefinition',
  transactionJournals: 'transactionJournal',
  examTemplates: 'examTemplate',
  examRevisions: 'examRevision',
  examQuestions: 'examQuestion',
  examAllocations: 'examAllocation',
  examAssignments: 'examAssignment',
  examAttempts: 'examAttempt',
  examAnswers: 'examAnswer',
  classEnrollmentPeriods: 'classEnrollmentPeriod',
  studentProgramPriorSubjects: 'studentProgramPriorSubject',
  leaveRequests: 'leaveRequest',
  tasks: 'task'
});

function resolveEntityKeyFromRepositoryKey(repositoryKey) {
  const key = String(repositoryKey || '').trim();
  return REPOSITORY_KEY_TO_ENTITY_KEY[key] || '';
}

function getEntityDefinition(entityKey) {
  const key = String(entityKey || '').trim();
  return ENTITY_DEFINITIONS[key] || null;
}

function listEntityDefinitions() {
  return Object.values(ENTITY_DEFINITIONS);
}

async function scanEntityReferences(ctx = {}) {
  const def = getEntityDefinition(ctx.entityKey);
  if (!def) return [];

  if (Array.isArray(def.requiresContext)) {
    const missing = def.requiresContext.filter((field) => !normalizeId(ctx.context?.[field]));
    if (missing.length) {
      return [buildBlocker({
        code: 'MISSING_CONTEXT',
        label: 'Missing required context',
        count: 1,
        samples: [],
        resolveHint: `Provide required context: ${missing.join(', ')}`,
        section: 'general',
        severity: 'error'
      })];
    }
  }

  const blockers = [];
  const fieldBlockers = await runFieldRules(def.fieldRules || [], ctx.id, ctx.orgId, ctx.reqUser);
  blockers.push(...fieldBlockers);

  const customScanners = Array.isArray(def.customScanners) ? def.customScanners : [];
  for (const scanner of customScanners) {
    if (typeof scanner !== 'function') continue;
    // eslint-disable-next-line no-await-in-loop
    const blocker = await scanner(ctx);
    if (blocker) blockers.push(blocker);
  }

  return blockers.filter(Boolean);
}

module.exports = {
  MAX_SAMPLES,
  SECTION_HREFS,
  ENTITY_DEFINITIONS,
  REPOSITORY_KEY_TO_ENTITY_KEY,
  resolveEntityKeyFromRepositoryKey,
  getEntityDefinition,
  listEntityDefinitions,
  scanEntityReferences,
  recordLabel,
  recordId,
  buildBlocker,
  samplesFromRows,
  resolveSectionHref,
  sanitizeSampleHref
};
