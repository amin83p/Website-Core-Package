'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const bookAssignmentService = require('../../services/school/bookAssignmentService');
const bookCoveringReportService = require('../../services/school/bookCoveringReportService');
const bookCoveringAccessService = require('../../services/school/bookCoveringAccessService');
const bookCoveringPeriodService = require('../../services/school/bookCoveringPeriodService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const settingService = requireCoreModule('MVC/services/settingService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = requireCoreModule('MVC/utils/orgContextUtils');
const {
  PERIOD_TYPES,
  REPORT_STATUSES,
  UNIT_COVERAGE_MODES,
  PAGE_COVERAGE_MODES,
  USAGE_FREQUENCIES
} = require('../../models/school/bookCoveringReportModel');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');

const PERIOD_TYPE_HELP = {
  [PERIOD_TYPES.DAILY]: {
    label: 'Daily',
    description: 'Report coverage for a single class day. Best when tied to one session.'
  },
  [PERIOD_TYPES.WEEKLY]: {
    label: 'Weekly',
    description: 'Covers the calendar week (Monday through Sunday) that includes your anchor date.'
  },
  [PERIOD_TYPES.BIWEEKLY]: {
    label: 'Bi-weekly',
    description: 'Covers a 14-day block aligned to the class bi-weekly cycle from the anchor date.'
  },
  [PERIOD_TYPES.MONTHLY]: {
    label: 'Monthly',
    description: 'Covers the full calendar month that contains your anchor date.'
  }
};

async function resolveSessionSummaryForReport(classId, sessionId, reqUser) {
  const sid = String(sessionId || '').trim();
  const cid = String(classId || '').trim();
  if (!sid || !cid) return null;
  const sessions = await schoolDataService.getClassSessions(cid, reqUser);
  const list = Array.isArray(sessions) ? sessions : [];
  const session = list.find((row) => String(row?.sessionId || '') === sid);
  if (!session) {
    return { sessionId: sid, date: '', startTime: '', endTime: '', label: '' };
  }
  return {
    sessionId: sid,
    date: String(session.date || '').trim(),
    startTime: String(session.startTime || '').trim(),
    endTime: String(session.endTime || '').trim(),
    label: String(session.topic || session.title || session.label || '').trim()
  };
}

function buildFormViewLocals(options = {}) {
  const periodTypes = Object.values(PERIOD_TYPES);
  return {
    periodTypes,
    periodTypeHelp: PERIOD_TYPE_HELP,
    reportStatuses: Object.values(REPORT_STATUSES),
    unitModes: Object.values(UNIT_COVERAGE_MODES),
    pageModes: Object.values(PAGE_COVERAGE_MODES),
    usageFrequencies: Object.values(USAGE_FREQUENCIES),
    ...options
  };
}

function assertOrgAccess(row, activeOrgId) {
  if (!row || !idsEqual(row.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function parseEntriesFromBody(body = {}) {
  const raw = body.entries;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw || '[]');
    } catch (_) {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function buildSavePayload(reqBody, activeOrgId, userId, existing = null) {
  return {
    orgId: activeOrgId,
    classId: String(reqBody?.classId || existing?.classId || '').trim(),
    teacherId: String(reqBody?.teacherId || existing?.teacherId || '').trim(),
    teacherName: String(reqBody?.teacherName || existing?.teacherName || '').trim(),
    periodType: String(reqBody?.periodType || existing?.periodType || PERIOD_TYPES.DAILY).trim(),
    anchorDate: String(reqBody?.anchorDate || reqBody?.periodStartDate || existing?.periodStartDate || '').trim(),
    periodStartDate: String(reqBody?.periodStartDate || existing?.periodStartDate || '').trim(),
    periodEndDate: String(reqBody?.periodEndDate || existing?.periodEndDate || '').trim(),
    sessionId: String(reqBody?.sessionId || existing?.sessionId || '').trim(),
    status: String(reqBody?.status || existing?.status || REPORT_STATUSES.DRAFT).trim(),
    notes: String(reqBody?.notes || existing?.notes || '').trim(),
    entries: parseEntriesFromBody(reqBody),
    audit: {
      createUser: String(userId || 'SYSTEM'),
      lastUpdateUser: String(userId || 'SYSTEM')
    }
  };
}

exports.listReports = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const capabilities = await bookCoveringAccessService.resolveListCapabilities(req);
    const canCreate = capabilities.canCreate && await canCreateOrgScopedItem(req.user, { scopeLabel: 'book covering reports' });
    const canUpdate = capabilities.canUpdate;
    const canDelete = capabilities.canDelete;
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: ['classId', 'status', 'periodType'] });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    let rows = await bookCoveringReportService.listReportsForOrg(orgId, req.user, accessContext);
    if (query.classId) rows = rows.filter((row) => String(row.classId) === String(query.classId));
    if (query.status) rows = rows.filter((row) => String(row.status) === String(query.status));
    if (query.periodType) rows = rows.filter((row) => String(row.periodType) === String(query.periodType));
    rows = await bookCoveringReportService.enrichReports(rows, req.user, accessContext);
    rows = rows.sort((a, b) => String(b.periodStartDate || '').localeCompare(String(a.periodStartDate || '')));

    const searchableFields = ['id', 'classTitle', 'teacherName', 'periodType', 'status'];
    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(rows, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/library/bookCoveringList', {
      title: 'Book Covering Reports',
      tableName: 'School_Book_Covering_Reports',
      data,
      newUrl: 'school/library/book-covering',
      newLabel: canCreate ? 'New Report' : null,
      canCreate,
      canUpdate,
      canDelete,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showCreateForm = async (req, res) => {
  try {
    await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'book covering reports' });
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const prefillClassId = String(req.query?.classId || '').trim();
    const anchorDate = String(req.query?.anchorDate || '').trim();
    let classTitle = '';
    let assignedBooks = [];
    if (prefillClassId) {
      const orgId = getActiveOrgIdOrThrow(req.user);
      const classRow = await schoolDataService.getDataById('classes', prefillClassId, req.user, accessContext);
      if (classRow && idsEqual(classRow.orgId, orgId)) {
        classTitle = classRow.title || prefillClassId;
        assignedBooks = await bookAssignmentService.expandAssignedBooksForClass(
          prefillClassId,
          orgId,
          req.user,
          { activeOnly: true }
        );
      }
    }
    return res.render('school/library/bookCoveringReportForm', buildFormViewLocals({
      title: 'New Book Covering Report',
      reportItem: null,
      selectedClassId: prefillClassId,
      selectedClassTitle: classTitle,
      assignedBooks,
      sessionSummary: null,
      anchorDate,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    }));
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const capabilities = await bookCoveringAccessService.resolveListCapabilities(req);
    const row = await schoolDataService.getDataById('bookCoveringReports', req.params.id, req.user, accessContext);
    if (!row) throw new Error('Book covering report not found.');
    assertOrgAccess(row, orgId);
    bookCoveringAccessService.assertCanReadReport(req, row, accessContext, capabilities);
    const classRow = await schoolDataService.getDataById('classes', row.classId, req.user, accessContext);
    const assignedBooks = await bookAssignmentService.expandAssignedBooksForClass(
      row.classId,
      orgId,
      req.user,
      { activeOnly: true }
    );
    const bookMap = new Map(assignedBooks.map((b) => [String(b.bookId), b]));
    const entries = (Array.isArray(row.entries) ? row.entries : []).map((entry) => {
      const book = bookMap.get(String(entry.bookId)) || {};
      return { ...entry, bookTitle: book.bookTitle || entry.bookId, bookTableOfContents: book.bookTableOfContents || [] };
    });
    const sessionSummary = await resolveSessionSummaryForReport(row.classId, row.sessionId, req.user);
    const sessionLocked = await bookCoveringReportService.isReportSessionLocked(row, req.user);
    const reportReadOnly = !capabilities.canUpdate || sessionLocked;
    return res.render('school/library/bookCoveringReportForm', buildFormViewLocals({
      title: 'Book Covering Report',
      reportItem: { ...row, entries },
      selectedClassId: row.classId,
      selectedClassTitle: classRow?.title || row.classId,
      assignedBooks,
      sessionSummary,
      anchorDate: row.periodStartDate,
      reportReadOnly,
      canUpdate: capabilities.canUpdate,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    }));
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveReport = async (req, res) => {
  try {
    const id = String(req.params?.id || '').trim();
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const capabilities = await bookCoveringAccessService.resolveListCapabilities(req);
    const orgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'book covering reports' });
    const existing = id
      ? await schoolDataService.getDataById('bookCoveringReports', id, req.user, accessContext)
      : null;
    if (existing) {
      assertOrgAccess(existing, orgId);
      bookCoveringAccessService.assertCanMutateReport(req, existing, accessContext, capabilities);
    }
    const payload = buildSavePayload(req.body, orgId, req.user?.id || 'SYSTEM', existing);
    const scopedTeacherId = bookCoveringAccessService.resolveScopedTeacherIdForCreate(req, accessContext);
    if (scopedTeacherId) {
      payload.teacherId = scopedTeacherId;
    }
    if (!id) {
      bookCoveringAccessService.assertCanCreateForTeacher(req, payload.teacherId, accessContext);
    }
    const submitAction = String(req.body?.submitAction || '').trim() === 'submit';
    if (submitAction) payload.status = REPORT_STATUSES.SUBMITTED;

    let report;
    if (id) {
      report = await bookCoveringReportService.updateReport(id, payload, req.user, accessContext);
    } else {
      report = await bookCoveringReportService.createReport(payload, req.user, accessContext);
    }

    const response = {
      status: 'success',
      message: submitAction ? 'Report submitted successfully.' : 'Report saved successfully.',
      redirectTo: '/school/library/book-covering'
    };
    if (isAjax(req)) return res.json({ ...response, report });
    return res.redirect(response.redirectTo);
  } catch (error) {
    const statusCode = error?.statusCode || 400;
    if (isAjax(req)) return res.status(statusCode).json({ status: 'error', message: error.message });
    return res.status(statusCode).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.apiAssignedBooks = async (req, res) => {
  try {
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const orgId = getActiveOrgIdOrThrow(req.user);
    const classId = String(req.params.classId || '').trim();
    const enriched = await bookAssignmentService.expandAssignedBooksForClass(
      classId,
      orgId,
      req.user,
      { activeOnly: true }
    );
    return res.json({ status: 'success', results: enriched });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiBookToc = async (req, res) => {
  try {
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const orgId = getActiveOrgIdOrThrow(req.user);
    const bookId = String(req.params.bookId || '').trim();
    const book = await schoolDataService.getDataById('books', bookId, req.user, accessContext);
    if (!book || !idsEqual(book.orgId, orgId)) throw new Error('Book not found.');
    return res.json({
      status: 'success',
      bookId: book.id,
      title: book.title,
      totalPages: book.totalPages,
      tableOfContents: Array.isArray(book.tableOfContents) ? book.tableOfContents : []
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiResolvePeriod = async (req, res) => {
  try {
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const periodType = String(req.query?.periodType || '').trim();
    const anchorDate = String(req.query?.anchorDate || '').trim();
    const classId = String(req.query?.classId || '').trim();
    let cycleStartDate = '';
    if (classId) {
      const classRow = await schoolDataService.getDataById('classes', classId, req.user, accessContext);
      cycleStartDate = classRow?.cycleStartDate || '';
    }
    const window = bookCoveringPeriodService.resolvePeriodWindow({ periodType, anchorDate, cycleStartDate });
    return res.json({ status: 'success', ...window });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.deleteReport = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const accessContext = bookCoveringAccessService.buildRouteAccessContext(req);
    const capabilities = await bookCoveringAccessService.resolveListCapabilities(req);
    const row = await schoolDataService.getDataById('bookCoveringReports', req.params.id, req.user, accessContext);
    if (!row) throw new Error('Book covering report not found.');
    assertOrgAccess(row, orgId);
    bookCoveringAccessService.assertCanDeleteReport(req, row, accessContext, capabilities);
    await bookCoveringReportService.deleteReport(req.params.id, req.user, accessContext);
    const response = {
      status: 'success',
      message: 'Book covering report deleted successfully.',
      redirectTo: '/school/library/book-covering'
    };
    if (isAjax(req)) return res.json(response);
    return res.redirect(response.redirectTo);
  } catch (error) {
    return respondSchoolDeleteError(req, res, error, { fallbackRedirect: '/school/library/book-covering' });
  }
};
