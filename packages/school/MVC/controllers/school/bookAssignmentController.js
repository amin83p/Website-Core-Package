'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const bookAssignmentService = require('../../services/school/bookAssignmentService');
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
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');
const {
  ASSIGNMENT_STATUSES,
  BOOK_LINE_STATUSES
} = require('../../models/school/bookAssignmentModel');

function assertOrgAccess(row, activeOrgId) {
  if (!row || !idsEqual(row.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function parseBooksFromBody(reqBody = {}) {
  const raw = reqBody?.books;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      throw new Error('Invalid books table data.');
    }
  }
  return [];
}

function buildPayload(reqBody, activeOrgId, userId) {
  return {
    orgId: activeOrgId,
    classId: String(reqBody?.classId || '').trim(),
    status: String(reqBody?.status || ASSIGNMENT_STATUSES.ACTIVE).trim(),
    notes: String(reqBody?.notes || '').trim(),
    books: parseBooksFromBody(reqBody),
    audit: {
      createUser: String(userId || 'SYSTEM'),
      lastUpdateUser: String(userId || 'SYSTEM')
    }
  };
}

function beginGuard(keyParts) {
  const key = idempotencyGuardService.createGuardKey(keyParts);
  const result = idempotencyGuardService.beginGuard({
    key,
    runningTtlMs: 90000,
    replayTtlMs: 12000
  });
  return { key, result };
}

function respondGuard(req, res, result, message) {
  if (!result || result.status === 'acquired') return false;
  const payload = result.status === 'replay' && result.payload
    ? { ...result.payload, idempotency: { state: 'replayed' } }
    : {
        status: 'warning',
        message,
        idempotency: { state: 'busy', retryAfterMs: Number(result.retryAfterMs || 0) }
      };
  if (isAjax(req)) res.status(result.status === 'busy' ? 409 : 200).json(payload);
  else res.redirect(payload.redirectTo || '/school/library/book-assignments');
  return true;
}

async function resolveClassDisplay(classId, reqUser) {
  const id = String(classId || '').trim();
  if (!id) return { classId: '', classTitle: '' };
  const row = await schoolDataService.getDataById('classes', id, reqUser);
  if (!row) return { classId: id, classTitle: id };
  return { classId: String(row.id), classTitle: String(row.title || row.id) };
}

function assignmentIncludesBook(row, bookId) {
  const needle = String(bookId || '').trim();
  if (!needle) return false;
  return (Array.isArray(row?.books) ? row.books : []).some((b) => String(b.bookId) === needle);
}

exports.listAssignments = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const canCreate = await canCreateOrgScopedItem(req.user, { scopeLabel: 'book assignments' });
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: ['classId', 'bookId', 'status'] });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    let rows = await bookAssignmentService.listForOrg(orgId, req.user);
    if (query.classId) rows = rows.filter((row) => String(row.classId) === String(query.classId));
    if (query.bookId) rows = rows.filter((row) => assignmentIncludesBook(row, query.bookId));
    if (query.status) rows = rows.filter((row) => String(row.status) === String(query.status));
    rows = await bookAssignmentService.enrichAssignments(rows, req.user);
    rows = rows.sort((a, b) => String(a.classTitle || '').localeCompare(String(b.classTitle || '')));

    const searchableFields = ['id', 'classTitle', 'bookTitleSummary', 'status', 'notes', 'bookCount'];
    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(rows, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/library/bookAssignmentList', {
      title: 'Book Assignments',
      tableName: 'School_Book_Assignments',
      data,
      newUrl: 'school/library/book-assignments',
      newLabel: canCreate ? 'New Assignment' : null,
      canCreate,
      filterClassId: String(query.classId || ''),
      filterBookId: String(query.bookId || ''),
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
    const orgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'book assignments' });
    const prefillClassId = String(req.query?.classId || '').trim();
    if (prefillClassId) {
      const existing = await bookAssignmentService.getForClass(prefillClassId, orgId, req.user);
      if (existing) {
        return res.redirect(`/school/library/book-assignments/edit/${encodeURIComponent(existing.id)}`);
      }
    }
    const classDisplay = await resolveClassDisplay(prefillClassId, req.user);
    return res.render('school/library/bookAssignmentForm', {
      title: 'New Book Assignment',
      assignmentItem: null,
      selectedClassId: classDisplay.classId,
      selectedClassTitle: classDisplay.classTitle,
      assignmentStatuses: Object.values(ASSIGNMENT_STATUSES),
      bookLineStatuses: Object.values(BOOK_LINE_STATUSES),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('bookAssignments', req.params.id, req.user);
    if (!row) throw new Error('Book assignment not found.');
    assertOrgAccess(row, orgId);
    const enriched = await bookAssignmentService.enrichAssignments([row], req.user);
    const assignmentItem = enriched[0] || row;
    const classDisplay = await resolveClassDisplay(row.classId, req.user);
    return res.render('school/library/bookAssignmentForm', {
      title: 'Edit Book Assignment',
      assignmentItem,
      selectedClassId: classDisplay.classId,
      selectedClassTitle: classDisplay.classTitle,
      assignmentStatuses: Object.values(ASSIGNMENT_STATUSES),
      bookLineStatuses: Object.values(BOOK_LINE_STATUSES),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveAssignment = async (req, res) => {
  let guardKey = '';
  try {
    const id = String(req.params?.id || '').trim();
    const orgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'book assignments' });
    const guard = beginGuard(['school_book_assignment_save', orgId, id, req.body || {}]);
    guardKey = guard.key;
    if (respondGuard(req, res, guard.result, 'Assignment save is already in progress.')) return;

    const payload = buildPayload(req.body, orgId, req.user?.id || 'SYSTEM');
    let saved;

    if (id) {
      const existing = await schoolDataService.getDataById('bookAssignments', id, req.user);
      if (!existing) throw new Error('Book assignment not found.');
      assertOrgAccess(existing, orgId);
      saved = await bookAssignmentService.updateAssignment(id, payload, req.user);
    } else {
      saved = await bookAssignmentService.upsertForClass(payload, req.user);
    }

    const response = {
      status: 'success',
      message: id ? 'Assignment updated successfully.' : 'Assignment saved successfully.',
      redirectTo: `/school/library/book-assignments/edit/${encodeURIComponent(saved.id)}`
    };
    idempotencyGuardService.completeGuard(guardKey, response);
    if (isAjax(req)) return res.json(response);
    return res.redirect(response.redirectTo);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('bookAssignments', req.params.id, req.user);
    if (!row) throw new Error('Book assignment not found.');
    assertOrgAccess(row, orgId);
    await schoolDataService.deleteData('bookAssignments', req.params.id, req.user);
    const response = { status: 'success', message: 'Assignment deleted successfully.', redirectTo: '/school/library/book-assignments' };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/book-assignments');
  } catch (error) {
    return respondSchoolDeleteError(req, res, error, { fallbackRedirect: '/school/library/book-assignments' });
  }
};

exports.apiListForClass = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const classId = String(req.params.classId || '').trim();
    if (!classId) throw new Error('Class id is required.');
    const results = await bookAssignmentService.expandAssignedBooksForClass(
      classId,
      orgId,
      req.user,
      { activeOnly: true }
    );
    return res.json({ status: 'success', results });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
