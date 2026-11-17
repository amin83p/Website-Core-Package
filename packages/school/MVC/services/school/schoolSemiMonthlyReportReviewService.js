'use strict';

const schoolDataService = require('./schoolDataService');
const schoolSemiMonthlyReportService = require('./schoolSemiMonthlyReportService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('./semiMonthlyReportPolicyService');
const reportViewService = require('./reportViewService');
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

function resolveTeacherId(assignment = {}, targetRow = {}) {
  return toPublicId(targetRow?.teacherId)
    || toPublicId(assignment?.teacherId)
    || toPublicId((Array.isArray(assignment?.teacherIds) ? assignment.teacherIds[0] : ''))
    || '';
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

function resolveFillReportsUrl(assignment, targetRow, relatedRows, assignmentMap) {
  const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);
  const studentTargeted = scope === 'each_student' || scope === 'selected_students';
  const assignmentId = toPublicId(assignment?.id);
  const assignmentRowId = String(targetRow?.rowId || '').trim();
  const teacherId = resolveTeacherId(assignment, targetRow);

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
  const teacherId = resolveTeacherId(assignment, targetRow);
  return (Array.isArray(instanceRows) ? instanceRows : []).filter((row) => {
    if (!idsEqual(row?.assignmentId, assignmentId)) return false;
    if (assignmentRowId && String(row?.assignmentRowId || '').trim() !== assignmentRowId) return false;
    if (teacherId && !idsEqual(row?.teacherId, teacherId)) return false;
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

    for (const targetRow of targetRows) {
      const assignmentRowId = String(targetRow?.rowId || '').trim();
      const teacherId = resolveTeacherId(assignment, targetRow);
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
      const teacherName = String(
        related.find((row) => String(row?.teacherName || '').trim())?.teacherName
        || classRow?.instructors?.[0]?.name
        || classRow?.teacherName
        || teacherId
        || '—'
      ).trim();

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
        reviewComplete: progress.total > 0 && progress.pending === 0 && progress.draft === 0
          && progress.submitted + progress.locked === progress.total
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
    reportTemplateIds
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
  buildAssignmentEditUrl,
  sortReviewRowsForTeacherSection,
  buildReviewAssignmentsPayload
};