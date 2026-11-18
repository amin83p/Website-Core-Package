'use strict';

const schoolDataService = require('./schoolDataService');
const schoolSemiMonthlyReportService = require('./schoolSemiMonthlyReportService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('./semiMonthlyReportPolicyService');
const reportViewService = require('./reportViewService');
const reportMatrixService = require('./reportMatrixService');
const reportIntegrityService = require('./reportIntegrityService');
const reportService = require('./reportService');
const sessionReportInstanceService = require('./sessionReportInstanceService');
const { requireCoreModule } = require('./schoolCoreContracts');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeDateOnly(value = '') {
  return schoolSemiMonthlyReportService.normalizeDateOnly(value);
}

function periodOverlaps(periodStart = '', periodEnd = '', rangeStart = '', rangeEnd = '') {
  const start = normalizeDateOnly(periodStart);
  const end = normalizeDateOnly(periodEnd);
  const from = normalizeDateOnly(rangeStart);
  const to = normalizeDateOnly(rangeEnd);
  if (!start || !end || !from || !to) return false;
  return start <= to && end >= from;
}

function targetRowOverlapsDateRange(targetRow = {}, rangeStart = '', rangeEnd = '') {
  const rowStart = normalizeDateOnly(targetRow?.reportStartDate);
  const rowEnd = normalizeDateOnly(targetRow?.reportDueDate);
  if (rowStart && rowEnd) return periodOverlaps(rowStart, rowEnd, rangeStart, rangeEnd);
  const sessionDate = normalizeDateOnly(
    targetRow?.sessionDate || targetRow?.reportDueDate || targetRow?.dueDate
  );
  if (!sessionDate) return false;
  const from = normalizeDateOnly(rangeStart);
  const to = normalizeDateOnly(rangeEnd);
  return sessionDate >= from && sessionDate <= to;
}

function isActiveClass(row = {}) {
  return String(row?.status || '').trim().toLowerCase() === 'active';
}

function classBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const scopedOrgId = String(activeOrgId || '').trim();
  if (!scopedOrgId) return true;
  const rowOrgId = String(row?.orgId || row?.organizationId || row?.schoolOrgId || '').trim();
  if (!rowOrgId) return true;
  return idsEqual(rowOrgId, scopedOrgId);
}

function templateIdMatches(templateId = '', templateIdSet = new Set()) {
  const token = String(templateId || '').trim().toLowerCase();
  if (!token || !templateIdSet.size) return false;
  return templateIdSet.has(token);
}

function tallyInstanceProgress(rows = []) {
  const progress = { pending: 0, draft: 0, submitted: 0, locked: 0, total: 0 };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    progress.total += 1;
    if (row?.isPendingAssignment) {
      progress.pending += 1;
      return;
    }
    const status = String(row?.status || 'draft').trim().toLowerCase();
    if (status === 'locked') progress.locked += 1;
    else if (status === 'submitted') progress.submitted += 1;
    else progress.draft += 1;
  });
  return progress;
}

function buildStatusSummary(progress = {}) {
  const parts = [];
  if (progress.locked) parts.push(`${progress.locked} locked`);
  if (progress.submitted) parts.push(`${progress.submitted} submitted`);
  if (progress.draft) parts.push(`${progress.draft} draft`);
  if (progress.pending) parts.push(`${progress.pending} not started`);
  return parts.length ? parts.join(' · ') : 'No instances';
}

function buildRowLifecycleMeta(relatedRows = [], canUnlock = false) {
  const lockStudentIds = [];
  const lockInstanceIds = [];
  const unlockInstanceIds = [];
  (Array.isArray(relatedRows) ? relatedRows : []).forEach((row) => {
    if (row?.isPendingAssignment) return;
    const status = String(row?.status || '').trim().toLowerCase();
    const instanceId = toPublicId(row?.id || row?.instanceId);
    const studentId = String(row?.studentId || row?.studentPersonId || '').trim();
    if (status === 'submitted' && instanceId) {
      if (studentId) lockStudentIds.push(studentId);
      else lockInstanceIds.push(instanceId);
    }
    if (status === 'locked' && instanceId && canUnlock) {
      unlockInstanceIds.push(instanceId);
    }
  });
  return {
    canLockSubmitted: lockStudentIds.length > 0 || lockInstanceIds.length > 0,
    canUnlockLocked: unlockInstanceIds.length > 0,
    lockStudentIds,
    lockInstanceIds,
    unlockInstanceIds
  };
}

function resolveSessionDelivererTeacherId(assignment = {}, targetRow = {}) {
  return toPublicId(targetRow?.teacherId)
    || toPublicId(assignment?.teacherId)
    || toPublicId((Array.isArray(assignment?.teacherIds) ? assignment.teacherIds[0] : ''))
    || '';
}

function resolvePrimaryInstructorForClass(classRow = {}) {
  const instructors = (Array.isArray(classRow?.instructors) ? classRow.instructors : [])
    .filter((row) => {
      const status = String(row?.status || 'active').trim().toLowerCase();
      return !status || status === 'active';
    });
  const primary = instructors.find((row) => row && (row.primary === true || row.isPrimary === true))
    || instructors.find((row) => {
      const role = String(row?.role || '').trim().toLowerCase();
      return role === 'primary' || role === 'primary instructor';
    })
    || instructors[0]
    || null;
  const teacherId = toPublicId(
    primary?.teacherId
    || primary?.personId
    || primary?.id
    || classRow?.teacherId
    || classRow?.instructorId
    || classRow?.teacherPersonId
  ) || '';
  const teacherName = String(
    primary?.name
    || primary?.displayName
    || classRow?.teacherName
    || teacherId
    || '—'
  ).trim();
  return { teacherId, teacherName };
}

function buildAssignmentEditUrl(assignmentId = '', assignmentRowId = '') {
  const id = toPublicId(assignmentId);
  if (!id) return '';
  const rowId = String(assignmentRowId || '').trim();
  const params = new URLSearchParams();
  if (rowId) params.set('rowId', rowId);
  const query = params.toString();
  return `/school/reports/assignments/edit/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

function buildSessionManageUrl(classId = '', sessionId = '') {
  const cid = toPublicId(classId);
  const sid = toPublicId(sessionId);
  if (!cid || !sid) return '';
  return `/school/classes/${encodeURIComponent(cid)}/sessions/${encodeURIComponent(sid)}`;
}

function resolveSessionManageUrl(assignment = {}, targetRow = {}, classId = '') {
  const applied = reportAssignmentSessionUtils.applyTargetRow(assignment, targetRow);
  const targetType = reportAssignmentSessionUtils.inferAssignmentTargetType(applied);
  const sessionId = toPublicId(applied?.sessionId);
  if (targetType !== 'session' || !sessionId) return '';
  return buildSessionManageUrl(classId, sessionId);
}

function resolveFillReportsUrl(assignment, targetRow, relatedRows, assignmentMap) {
  const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);
  const studentTargeted = scope === 'each_student' || scope === 'selected_students';
  const assignmentId = toPublicId(assignment?.id);
  const assignmentRowId = String(targetRow?.rowId || '').trim();
  const teacherId = resolveSessionDelivererTeacherId(assignment, targetRow);

  if (studentTargeted && assignmentId) {
    const matrixParams = new URLSearchParams();
    if (assignmentRowId) matrixParams.set('assignmentRowId', assignmentRowId);
    if (teacherId) matrixParams.set('teacherId', teacherId);
    const query = matrixParams.toString();
    return `/school/reports/instances/matrix/${encodeURIComponent(assignmentId)}${query ? `?${query}` : ''}`;
  }

  const sample = (Array.isArray(relatedRows) ? relatedRows : []).find((row) => (
    idsEqual(row?.assignmentId, assignmentId)
    && String(row?.assignmentRowId || '').trim() === assignmentRowId
  ));
  if (!sample) {
    if (!assignmentId) return '';
    const matrixParams = new URLSearchParams();
    if (assignmentRowId) matrixParams.set('assignmentRowId', assignmentRowId);
    if (teacherId) matrixParams.set('teacherId', teacherId);
    const query = matrixParams.toString();
    return `/school/reports/instances/matrix/${encodeURIComponent(assignmentId)}${query ? `?${query}` : ''}`;
  }
  const dto = sessionReportInstanceService.mapRowToDto(sample, assignmentMap);
  return String(dto.matrixHref || dto.href || '').trim();
}

function filterRelatedInstanceRows(instanceRows, assignment, targetRow) {
  const assignmentId = toPublicId(assignment?.id);
  const assignmentRowId = String(targetRow?.rowId || '').trim();
  return (Array.isArray(instanceRows) ? instanceRows : []).filter((row) => {
    if (!idsEqual(row?.assignmentId, assignmentId)) return false;
    if (assignmentRowId && String(row?.assignmentRowId || '').trim() !== assignmentRowId) return false;
    return true;
  });
}

async function buildReviewAssignmentsPayload(req) {
  const query = req?.query && typeof req.query === 'object' ? req.query : {};
  const startDate = normalizeDateOnly(query.startDate);
  const endDate = normalizeDateOnly(query.endDate);
  if (!startDate || !endDate) {
    throw new Error('Start date and end date are required.');
  }
  if (endDate < startDate) {
    throw new Error('End date must be on or after start date.');
  }

  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  const policy = semiMonthlyReportPolicyService.resolvePolicy(activeOrgId
    ? await semiMonthlyReportPolicyModel.getPolicyForOrg(activeOrgId)
    : {});
  const reportTemplateIds = policy.reportTemplateIds || [];
  if (!reportTemplateIds.length) {
    return {
      startDate,
      endDate,
      teachers: [],
      configurationWarning: 'Add report templates in School Settings → School Semi-Monthly Report before using Review Reports.'
    };
  }

  const templateIdSet = schoolSemiMonthlyReportService.buildTemplateIdSet(reportTemplateIds);
  const canUnlockReportInstance = await reportViewService.canUnlockReportInstance(req.user);
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const assignmentQuery = activeOrgId ? { orgId__eq: activeOrgId } : {};
  const [allAssignments, allClasses, instanceRows] = await Promise.all([
    schoolDataService.fetchAllData('reportAssignments', assignmentQuery, req.user, routeAccessContext),
    schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext),
    reportViewService.buildInstanceListRows({
      reqUser: req.user,
      dueDateStart: startDate,
      dueDateEnd: endDate
    })
  ]);

  const classMap = new Map(
    (Array.isArray(allClasses) ? allClasses : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );

  const matchingAssignments = (Array.isArray(allAssignments) ? allAssignments : [])
    .filter((row) => String(row?.status || '').trim().toLowerCase() === 'active')
    .filter((row) => templateIdMatches(row?.templateId, templateIdSet));

  const assignmentMap = new Map(
    matchingAssignments.map((row) => [toPublicId(row?.id), row]).filter(([id]) => Boolean(id))
  );

  const teachersByKey = new Map();
  const templateLabelCache = new Map();

  function teacherGroupKey(teacherId = '', teacherName = '') {
    const id = String(teacherId || '').trim();
    if (id) return `id:${id}`;
    const name = String(teacherName || '').trim().toLowerCase();
    if (name) return `name:${name}`;
    return 'unassigned';
  }

  for (const assignment of matchingAssignments) {
    const classId = toPublicId(assignment?.classId);
    if (!classId) continue;
    const classRow = classMap.get(classId);
    if (!classRow || !isActiveClass(classRow) || !classBelongsToActiveOrg(classRow, activeOrgId)) continue;

    const targetRows = reportAssignmentSessionUtils.getEffectiveTargetRows(assignment)
      .filter((row) => String(row?.status || 'active').trim().toLowerCase() === 'active')
      .filter((row) => targetRowOverlapsDateRange(row, startDate, endDate));

    const primaryInstructor = resolvePrimaryInstructorForClass(classRow);

    for (const targetRow of targetRows) {
      const assignmentRowId = String(targetRow?.rowId || '').trim();
      const teacherId = primaryInstructor.teacherId;
      const related = filterRelatedInstanceRows(instanceRows, assignment, targetRow)
        .filter((row) => templateIdMatches(row?.templateId, templateIdSet));
      const progress = tallyInstanceProgress(related);
      const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);
      const templateId = toPublicId(assignment?.templateId);
      let templateTitle = templateId ? templateLabelCache.get(templateId) : '';
      if (!templateTitle && templateId) {
        const template = await schoolDataService.getDataById('reportTemplates', templateId, req.user);
        templateTitle = semiMonthlyReportPolicyService.formatTemplateLabel(template, templateId);
        templateLabelCache.set(templateId, templateTitle);
      }
      const teacherName = primaryInstructor.teacherName;

      const className = String(classRow?.name || classRow?.title || classId).trim();

      const reviewRow = {
        assignmentId: toPublicId(assignment?.id),
        assignmentRowId,
        classId,
        className,
        templateId,
        templateTitle: templateTitle || templateId || 'Report',
        teacherId,
        teacherName,
        reportScope: scope,
        scopeLabel: reportAssignmentSessionUtils.scopeDisplayLabel(scope),
        reportStartDate: normalizeDateOnly(targetRow?.reportStartDate),
        reportDueDate: normalizeDateOnly(targetRow?.reportDueDate),
        sessionDate: normalizeDateOnly(targetRow?.sessionDate || targetRow?.reportDueDate || targetRow?.dueDate),
        progress,
        statusSummary: buildStatusSummary(progress),
        fillReportsUrl: resolveFillReportsUrl(assignment, targetRow, related, assignmentMap),
        assignmentEditUrl: buildAssignmentEditUrl(assignment?.id, assignmentRowId),
        sessionId: toPublicId(reportAssignmentSessionUtils.applyTargetRow(assignment, targetRow)?.sessionId),
        sessionManageUrl: resolveSessionManageUrl(assignment, targetRow, classId),
        reviewComplete: progress.total > 0 && progress.pending === 0 && progress.draft === 0
          && progress.submitted + progress.locked === progress.total,
        ...buildRowLifecycleMeta(related, canUnlockReportInstance)
      };

      const groupKey = teacherGroupKey(teacherId, teacherName);
      const sectionLabel = teacherName || (teacherId || 'Unassigned teacher');
      if (!teachersByKey.has(groupKey)) {
        teachersByKey.set(groupKey, {
          teacherId,
          teacherName: sectionLabel,
          rows: []
        });
      }
      teachersByKey.get(groupKey).rows.push(reviewRow);
    }
  }

  const teachers = [...teachersByKey.values()]
    .map((section) => {
      section.rows.sort((a, b) => {
        const classCmp = String(a.className || '').localeCompare(String(b.className || ''));
        if (classCmp) return classCmp;
        const dateCmp = String(a.reportDueDate || a.sessionDate || '')
          .localeCompare(String(b.reportDueDate || b.sessionDate || ''));
        if (dateCmp) return dateCmp;
        return String(a.templateTitle || '').localeCompare(String(b.templateTitle || ''));
      });
      return section;
    })
    .filter((section) => section.rows.length > 0)
    .sort((a, b) => String(a.teacherName || '').localeCompare(String(b.teacherName || '')));

  return {
    startDate,
    endDate,
    teachers,
    reportTemplateIds,
    canUnlockReportInstance
  };
}

function parseIdListParam(value = '') {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function lockSingleReportInstance(instanceId = '', reqUser) {
  const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(instanceId, reqUser);
  const status = String(instance.status || '').trim().toLowerCase();
  if (status === 'locked') {
    return { instanceId: toPublicId(instance.id), status: 'skipped', message: 'Report instance is already locked.' };
  }
  if (status !== 'submitted') {
    throw new Error('Only submitted reports can be locked from Review Reports.');
  }
  const [template, assignment] = await Promise.all([
    schoolDataService.getDataById('reportTemplates', instance.templateId, reqUser),
    schoolDataService.getDataById('reportAssignments', instance.assignmentId, reqUser)
  ]);
  if (!template) throw new Error('Template not found for this report instance.');
  const effectiveAssignment = reportViewService.applyAssignmentRow(
    assignment,
    reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
  );
  const lockSnapshot = await reportService.buildLockSnapshot({
    template,
    instance,
    assignment: effectiveAssignment,
    reqUser
  });
  const now = new Date().toISOString();
  await schoolDataService.updateData('reportInstances', instance.id, {
    status: 'locked',
    lockSnapshot,
    audit: {
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: now,
      lockedAt: instance.audit?.lockedAt || now
    }
  }, reqUser);
  return { instanceId: toPublicId(instance.id), status: 'success', reportStatus: 'locked' };
}

async function lockReviewAssignmentRow({ req, body = {} } = {}) {
  const assignmentId = toPublicId(body.assignmentId);
  const assignmentRowId = String(body.assignmentRowId || '').trim();
  const teacherId = String(body.teacherId || '').trim();
  const lockStudentIds = parseIdListParam(body.lockStudentIds);
  const lockInstanceIds = parseIdListParam(body.lockInstanceIds);
  if (!assignmentId) throw new Error('Assignment is required.');
  if (!lockStudentIds.length && !lockInstanceIds.length) {
    throw new Error('No submitted reports to lock.');
  }

  const results = [];
  let matrixSummary = null;
  if (lockStudentIds.length) {
    const matrixResult = await reportMatrixService.lockMatrixRows({
      assignmentId,
      assignmentRowId,
      teacherId,
      rows: lockStudentIds.map((studentId) => ({ studentId })),
      reqUser: req.user
    });
    matrixSummary = matrixResult.summary || null;
    (matrixResult.results || []).forEach((row) => results.push(row));
  }
  for (const instanceId of lockInstanceIds) {
    try {
      results.push(await lockSingleReportInstance(instanceId, req.user));
    } catch (error) {
      results.push({ instanceId, status: 'error', message: error.message });
    }
  }

  const summary = {
    total: results.length,
    succeeded: results.filter((row) => row.status === 'success').length,
    failed: results.filter((row) => row.status === 'error').length,
    skipped: results.filter((row) => row.status === 'skipped').length,
    matrix: matrixSummary
  };
  return {
    message: `${summary.succeeded} report(s) locked. ${summary.skipped} skipped. ${summary.failed} failed.`,
    summary,
    results
  };
}

async function unlockReviewAssignmentRow({ req, body = {} } = {}) {
  const canUnlock = await reportViewService.canUnlockReportInstance(req.user);
  if (!canUnlock) {
    throw new Error('Only a super user can unlock a locked report.');
  }
  const unlockInstanceIds = parseIdListParam(body.unlockInstanceIds);
  if (!unlockInstanceIds.length) throw new Error('No locked reports to unlock.');

  const results = [];
  for (const instanceId of unlockInstanceIds) {
    try {
      const instance = await reportIntegrityService.assertInstanceUnlockable(instanceId, req.user);
      const nextStatus = reportIntegrityService.resolveInstanceUnlockTargetStatus(instance);
      const now = new Date().toISOString();
      await schoolDataService.updateData('reportInstances', instance.id, {
        status: nextStatus,
        lockSnapshot: null,
        audit: {
          lastUpdateUser: req.user?.id || '',
          lastUpdateDateTime: now,
          unlockedAt: now,
          unlockedBy: toPublicId(req.user?.id || '')
        }
      }, req.user);
      results.push({ instanceId: toPublicId(instance.id), status: 'success', nextStatus });
    } catch (error) {
      results.push({ instanceId, status: 'error', message: error.message });
    }
  }

  const summary = {
    total: results.length,
    succeeded: results.filter((row) => row.status === 'success').length,
    failed: results.filter((row) => row.status === 'error').length
  };
  return {
    message: `${summary.succeeded} report(s) unlocked. ${summary.failed} failed.`,
    summary,
    results
  };
}

function sortReviewRowsForTeacherSection(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const classCmp = String(a.className || '').localeCompare(String(b.className || ''));
    if (classCmp) return classCmp;
    const dateCmp = String(a.reportDueDate || a.sessionDate || '')
      .localeCompare(String(b.reportDueDate || b.sessionDate || ''));
    if (dateCmp) return dateCmp;
    return String(a.templateTitle || '').localeCompare(String(b.templateTitle || ''));
  });
}

module.exports = {
  normalizeDateOnly,
  periodOverlaps,
  targetRowOverlapsDateRange,
  tallyInstanceProgress,
  buildStatusSummary,
  buildRowLifecycleMeta,
  buildAssignmentEditUrl,
  buildSessionManageUrl,
  resolveSessionManageUrl,
  sortReviewRowsForTeacherSection,
  resolvePrimaryInstructorForClass,
  filterRelatedInstanceRows,
  resolveSessionDelivererTeacherId,
  buildReviewAssignmentsPayload,
  parseIdListParam,
  lockReviewAssignmentRow,
  unlockReviewAssignmentRow
};