'use strict';

const sessionStudentCaseWorkspaceService = require('../../services/school/sessionStudentCaseWorkspaceService');
const sessionStudentCaseReviewService = require('../../services/school/sessionStudentCaseReviewService');
const sessionStudentCaseAccessService = require('../../services/school/sessionStudentCaseAccessService');
const sessionStudentCaseService = require('../../services/school/sessionStudentCaseService');
const sessionStudentCaseRoutingService = require('../../services/school/sessionStudentCaseRoutingService');
const sessionStudentCaseResultVisibilityService = require('../../services/school/sessionStudentCaseResultVisibilityService');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const { getPresetConfig } = require('../../services/school/sessionStudentCasePresetService');
const schoolDataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const settingService = requireCoreModule('MVC/services/settingService');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');

function normalizeSearchKeyword(value = '') {
  return String(value || '').trim();
}

function parseAllowedSchoolRoles(query = {}) {
  const raw = String(query.allowedSchoolRoles || query.schoolRoles || '').trim();
  if (!raw) return ['staff', 'teacher'];
  return raw.split(',').map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
}

function formatSessionDateTime(row = {}) {
  const date = String(row.sessionDate || '').trim();
  const start = String(row.sessionStartTime || '').trim();
  const end = String(row.sessionEndTime || '').trim();
  if (!date) return '-';
  if (start && end) return `${date} ${start}-${end}`;
  if (start) return `${date} ${start}`;
  return date;
}

function severityBadgeClass(severity = '') {
  const token = String(severity || '').trim().toLowerCase();
  if (token === 'urgent') return 'bg-danger';
  if (token === 'warning') return 'bg-warning text-dark';
  return 'bg-info text-dark';
}

function statusBadgeClass(status = '') {
  const token = String(status || '').trim().toLowerCase();
  if (['open', 'in_progress', 'reopened'].includes(token)) return 'bg-warning text-dark';
  if (token === 'resolved') return 'bg-success';
  if (token === 'cancelled') return 'bg-secondary';
  return 'bg-light text-dark border';
}

exports.listSessionStudentCases = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const workspace = await sessionStudentCaseWorkspaceService.listSessionStudentCasesForRequest(req, {
      queryInput: req.query || {},
      searchQuery: query.q || '',
      applyAccessScope: true,
      accessContext
    });

    const { data, pagination } = paginate(workspace.rows, query.page, query.limit);
    const rows = data.map((row) => ({
      ...row,
      sessionDateTimeLabel: formatSessionDateTime(row),
      severityBadgeClass: severityBadgeClass(row.severity),
      statusBadgeClass: statusBadgeClass(row.status),
      reviewHref: row.actions?.[0]?.href || ''
    }));

    const hasFiltersApplied = Boolean(
      workspace.filters.severity
      || workspace.filters.category
      || workspace.filters.statusGroup
      || workspace.filters.classId
      || workspace.filters.teacherPersonId
      || workspace.filters.studentPersonId
      || workspace.filters.startDate
      || workspace.filters.endDate
      || String(query.q || '').trim()
    );

    const caseCapabilities = await sessionStudentCaseAccessService.resolveListCapabilities(req);
    const canConfigureRouting = sessionStudentCaseRoutingService.isRoutingAdminViewer(req.user);

    if (isAjax(req)) {
      return res.json({ status: 'success', results: rows, pagination });
    }

    return res.render('school/sessionStudentCase/sessionStudentCaseList', {
      title: 'Student Cases',
      tableName: 'School_SessionStudentCases',
      data: rows,
      searchableFields: ['classTitle', 'studentName', 'teacherName', 'summary', 'category', 'status', 'severity', 'id'],
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      hasFiltersApplied,
      severityOptions: workspace.severityOptions,
      categoryOptions: workspace.categoryOptions,
      statusGroupOptions: workspace.statusGroupOptions,
      classOptions: workspace.classOptions,
      studentCaseDetailPresets: getPresetConfig(),
      user: req.user,
      actionStateId: req.actionStateId,
      canCreateCases: caseCapabilities.canCreate,
      canReadCases: caseCapabilities.canRead || caseCapabilities.canReadAll,
      canUpdateCases: caseCapabilities.canUpdate,
      canResolveCases: caseCapabilities.canResolve,
      canDeleteCases: caseCapabilities.canDelete,
      canConfigureRouting
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.getReviewContext = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const context = await sessionStudentCaseReviewService.getReviewContext(req, req.params.caseId);
    return res.json({ status: 'success', context });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 400;
    return res.status(statusCode).json({ status: 'error', message: error.message });
  }
};

exports.saveCase = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const { caseId } = req.params;
    const { existing, classData, session, capabilities } = await sessionStudentCaseReviewService.assertCanMutate(req, caseId, 'edit');
    const shouldResolve = String(req.body?.status || '').trim().toLowerCase() === 'resolved';
    if (shouldResolve) {
      await sessionStudentCaseAccessService.assertCanResolve(req, classData, session, existing);
    }
    const resolvedCapabilities = capabilities || await sessionStudentCaseAccessService.resolveCaseCapabilities(req, { classData, session });
    const saved = await sessionStudentCaseService.saveCase({
      classId: existing.classId,
      sessionId: existing.sessionId,
      caseId,
      input: req.body || {},
      reqUser: req.user,
      canManageResultFields: resolvedCapabilities.canResolve === true,
      capabilities: resolvedCapabilities
    });
    const message = String(saved?.status || '').toLowerCase() === 'resolved'
      ? 'Student case saved and resolved.'
      : 'Student case saved.';
    const redacted = sessionStudentCaseResultVisibilityService.redactCaseForViewer(saved, {
      reqUser: req.user,
      capabilities: resolvedCapabilities
    });
    return res.json({ status: 'success', message, case: redacted });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 400;
    return res.status(statusCode).json({ status: 'error', message: error.message });
  }
};

exports.updateCaseStatus = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const { caseId } = req.params;
    const status = String(req.body?.status || '').trim().toLowerCase();
    const action = status === 'resolved' ? 'resolve' : (status === 'reopened' ? 'reopen' : 'edit');
    const { existing, classData, session, capabilities } = await sessionStudentCaseReviewService.assertCanMutate(req, caseId, action);
    const resolvedCapabilities = capabilities || await sessionStudentCaseAccessService.resolveCaseCapabilities(req, { classData, session });
    const saved = await sessionStudentCaseService.updateStatus({
      classId: existing.classId,
      sessionId: existing.sessionId,
      caseId,
      status: req.body?.status,
      note: req.body?.note || '',
      resultNote: req.body?.resultNote,
      revealResultToCreator: req.body?.revealResultToCreator,
      locked: req.body?.locked,
      reqUser: req.user,
      canManageResultFields: resolvedCapabilities.canResolve === true,
      capabilities: resolvedCapabilities
    });
    const redacted = sessionStudentCaseResultVisibilityService.redactCaseForViewer(saved, {
      reqUser: req.user,
      capabilities: resolvedCapabilities
    });
    return res.json({ status: 'success', message: 'Student case updated.', case: redacted });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 400;
    return res.status(statusCode).json({ status: 'error', message: error.message });
  }
};

exports.deleteCase = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const { caseId } = req.params;
    const { existing, capabilities } = await sessionStudentCaseReviewService.assertCanMutate(req, caseId, 'delete');
    const deleted = await sessionStudentCaseService.deleteCase({
      classId: existing.classId,
      sessionId: existing.sessionId,
      caseId,
      reqUser: req.user,
      capabilities
    });
    return res.json({ status: 'success', message: 'Student case deleted.', deleted });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 400;
    return res.status(statusCode).json({ status: 'error', message: error.message });
  }
};

exports.showRouting = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const pageData = await sessionStudentCaseRoutingService.getRoutingPageData(req.user);
    return res.render('school/sessionStudentCase/sessionStudentCaseRouting', {
      title: 'Student Cases Routing',
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId,
      categories: pageData.categories,
      routingPolicy: pageData.policy,
      canConfigureRouting: true
    });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 400;
    return res.status(statusCode).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveRouting = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const policy = await sessionStudentCaseRoutingService.saveRoutingFromRequest(req.user, req.body || {});
    return res.json({ status: 'success', message: 'Student case routing saved.', policy });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 400;
    return res.status(statusCode).json({ status: 'error', message: error.message });
  }
};

exports.listRoutingEligiblePersons = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    const payload = await schoolIdentityLookupService.listSchoolPersons({
      reqUser: req.user,
      q: query.q || '',
      query,
      requireSchoolRole: true,
      allowedSchoolRoles: parseAllowedSchoolRoles(req.query || {})
    });
    const data = (payload.rows || []).map((row) => ({
      ...row,
      name: {
        first: row.firstName || '',
        last: row.lastName || '',
        preferred: row.preferredName || ''
      }
    }));
    return res.json({
      status: 'success',
      data,
      results: data,
      items: data,
      pagination: payload.pagination || {}
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.formatSessionDateTime = formatSessionDateTime;
exports.severityBadgeClass = severityBadgeClass;
exports.statusBadgeClass = statusBadgeClass;
