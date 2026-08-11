'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const libraryLocationService = require('../../services/school/libraryLocationService');
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
const { COPY_TYPES, COPY_STATUSES } = require('../../models/school/libraryCopyModel');

function assertOrgAccess(row, activeOrgId) {
  if (!row || !idsEqual(row.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function buildPayload(reqBody, activeOrgId, userId) {
  return {
    orgId: activeOrgId,
    bookId: String(reqBody?.bookId || '').trim(),
    copyType: String(reqBody?.copyType || 'physical').trim(),
    copyCode: String(reqBody?.copyCode || '').trim(),
    status: String(reqBody?.status || COPY_STATUSES.AVAILABLE).trim(),
    locationId: String(reqBody?.locationId || '').trim(),
    location: String(reqBody?.location || '').trim(),
    notes: String(reqBody?.notes || '').trim(),
    audit: {
      createUser: String(userId || 'SYSTEM'),
      lastUpdateUser: String(userId || 'SYSTEM')
    }
  };
}

async function resolveLocationFields(locationId, orgId, reqUser) {
  const id = String(locationId || '').trim();
  if (!id) return { locationId: '', location: '' };
  const row = await schoolDataService.getDataById('libraryLocations', id, reqUser);
  if (!row || !idsEqual(row.orgId, orgId)) {
    throw new Error('Selected library location is invalid for this organization.');
  }
  if (String(row.locationType) !== 'spot') {
    throw new Error('Only spot locations can be assigned to copies.');
  }
  const orgRows = await libraryLocationService.listOrgLocations(orgId, reqUser);
  const path = libraryLocationService.buildLocationPath(id, orgRows);
  return { locationId: id, location: path };
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
  else res.redirect(payload.redirectTo || '/school/library/copies');
  return true;
}

async function listOrgCopies(orgId, reqUser) {
  const rows = await schoolDataService.fetchAllData('libraryCopies', {}, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
}

async function enrichCopiesWithBooks(copies, reqUser) {
  const bookIds = [...new Set(copies.map((row) => String(row.bookId || '').trim()).filter(Boolean))];
  const bookMap = new Map();
  for (const bookId of bookIds) {
    const book = await schoolDataService.getDataById('books', bookId, reqUser);
    if (book) bookMap.set(String(book.id), book);
  }
  const orgId = copies[0]?.orgId;
  let locationRows = [];
  if (orgId) {
    locationRows = await libraryLocationService.listOrgLocations(orgId, reqUser);
  }
  return copies.map((copy) => {
    const book = bookMap.get(String(copy.bookId || ''));
    const locationPath = copy.locationId
      ? libraryLocationService.buildLocationPath(copy.locationId, locationRows)
      : '';
    return {
      ...copy,
      bookTitle: book?.title || '',
      bookIsbn: book?.isbn || '',
      locationPath: locationPath || copy.location || ''
    };
  });
}

async function resolveBookDisplay(bookId, reqUser) {
  const id = String(bookId || '').trim();
  if (!id) return { bookId: '', bookTitle: '', bookIsbn: '' };
  const book = await schoolDataService.getDataById('books', id, reqUser);
  if (!book) return { bookId: id, bookTitle: id, bookIsbn: '' };
  return {
    bookId: String(book.id),
    bookTitle: String(book.title || book.id),
    bookIsbn: String(book.isbn || '')
  };
}

function suggestDuplicateCopyCode(sourceCode, existingCopies = []) {
  const base = String(sourceCode || '').trim() || 'COPY';
  const taken = new Set(
    (Array.isArray(existingCopies) ? existingCopies : [])
      .map((row) => String(row?.copyCode || '').trim().toLowerCase())
      .filter(Boolean)
  );
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-COPY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

exports.listCopies = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const canCreate = await canCreateOrgScopedItem(req.user, { scopeLabel: 'library copies' });
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: ['bookId'] });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    let rows = await listOrgCopies(orgId, req.user);
    if (query.bookId) {
      rows = rows.filter((row) => String(row.bookId) === String(query.bookId));
    }
    rows = await enrichCopiesWithBooks(rows, req.user);
    rows = rows.sort((a, b) => String(a.copyCode || '').localeCompare(String(b.copyCode || '')));

    const searchableFields = ['id', 'copyCode', 'bookTitle', 'bookIsbn', 'location', 'status', 'copyType'];
    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(rows, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    const duplicateNoticeId = String(req.query?.duplicateNotice || '').trim();
    let duplicateNoticeCopy = null;
    if (duplicateNoticeId) {
      duplicateNoticeCopy = await schoolDataService.getDataById('libraryCopies', duplicateNoticeId, req.user);
    }
    return res.render('school/library/copyList', {
      title: 'Library Copies',
      tableName: 'School_Library_Copies',
      data,
      newUrl: 'school/library/copies',
      newLabel: canCreate ? 'New Copy' : null,
      canCreate,
      filterBookId: String(query.bookId || ''),
      duplicateNoticeId,
      duplicateNoticeCopy,
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
    const orgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'library copies' });
    const prefillBookId = String(req.query?.bookId || '').trim();
    const copyFromId = String(req.query?.copyFrom || '').trim();
    let template = null;
    if (copyFromId) {
      const source = await schoolDataService.getDataById('libraryCopies', copyFromId, req.user);
      if (source && idsEqual(source.orgId, orgId)) {
        template = source;
      }
    }
    const bookId = prefillBookId || template?.bookId || '';
    const bookDisplay = await resolveBookDisplay(bookId, req.user);
    let selectedLocationPath = '';
    if (template?.locationId) {
      const locFields = await resolveLocationFields(template.locationId, orgId, req.user);
      selectedLocationPath = locFields.location;
    } else if (template?.location) {
      selectedLocationPath = template.location;
    }
    return res.render('school/library/copyForm', {
      title: 'New Library Copy',
      copyItem: template ? {
        bookId: template.bookId,
        copyType: template.copyType,
        copyCode: '',
        status: COPY_STATUSES.AVAILABLE,
        locationId: template.locationId || '',
        location: selectedLocationPath,
        notes: template.notes || ''
      } : null,
      selectedBookId: bookDisplay.bookId,
      selectedBookTitle: bookDisplay.bookTitle,
      selectedBookIsbn: bookDisplay.bookIsbn,
      selectedLocationPath,
      copyTypes: Object.values(COPY_TYPES),
      copyStatuses: Object.values(COPY_STATUSES),
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
    const row = await schoolDataService.getDataById('libraryCopies', req.params.id, req.user);
    if (!row) throw new Error('Library copy not found.');
    assertOrgAccess(row, orgId);
    const bookDisplay = await resolveBookDisplay(row.bookId, req.user);
    let selectedLocationPath = row.location || '';
    if (row.locationId) {
      const locFields = await resolveLocationFields(row.locationId, orgId, req.user);
      selectedLocationPath = locFields.location || selectedLocationPath;
    }
    return res.render('school/library/copyForm', {
      title: 'Edit Library Copy',
      copyItem: row,
      selectedBookId: bookDisplay.bookId,
      selectedBookTitle: bookDisplay.bookTitle,
      selectedBookIsbn: bookDisplay.bookIsbn,
      selectedLocationPath,
      copyTypes: Object.values(COPY_TYPES),
      copyStatuses: Object.values(COPY_STATUSES),
      includeModal: false,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveCopy = async (req, res) => {
  let guardKey = '';
  try {
    const id = String(req.params?.id || '').trim();
    const orgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'library copies' });
    const guard = beginGuard(['school_library_copy_save', orgId, id, req.body || {}]);
    guardKey = guard.key;
    if (respondGuard(req, res, guard.result, 'Copy save is already in progress.')) return;

    if (id) {
      const existing = await schoolDataService.getDataById('libraryCopies', id, req.user);
      if (!existing) throw new Error('Library copy not found.');
      assertOrgAccess(existing, orgId);
      if (String(existing.status) === COPY_STATUSES.LOANED) {
        throw new Error('Cannot edit a copy that is currently loaned.');
      }
      const payload = buildPayload(req.body, existing.orgId, req.user?.id || 'SYSTEM');
      if (String(payload.copyType) === COPY_TYPES.DIGITAL) {
        payload.locationId = '';
        payload.location = '';
      } else {
        const locFields = await resolveLocationFields(payload.locationId, existing.orgId, req.user);
        payload.locationId = locFields.locationId;
        payload.location = locFields.location;
      }
      await schoolDataService.updateData('libraryCopies', id, payload, req.user);
    } else {
      const payload = buildPayload(req.body, orgId, req.user?.id || 'SYSTEM');
      if (String(payload.copyType) === COPY_TYPES.DIGITAL) {
        payload.locationId = '';
        payload.location = '';
      } else {
        const locFields = await resolveLocationFields(payload.locationId, orgId, req.user);
        payload.locationId = locFields.locationId;
        payload.location = locFields.location;
      }
      await schoolDataService.addData('libraryCopies', payload, req.user);
    }

    const response = {
      status: 'success',
      message: id ? 'Copy updated successfully.' : 'Copy created successfully.',
      redirectTo: '/school/library/copies'
    };
    idempotencyGuardService.completeGuard(guardKey, response);
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/copies');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.duplicateCopy = async (req, res) => {
  let guardKey = '';
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const sourceId = String(req.params?.id || '').trim();
    if (!sourceId) throw new Error('Copy id is required.');
    const guard = beginGuard(['school_library_copy_duplicate', orgId, sourceId, req.user?.id || 'SYSTEM']);
    guardKey = guard.key;
    if (respondGuard(req, res, guard.result, 'Copy duplication is already in progress.')) return;
    const source = await schoolDataService.getDataById('libraryCopies', sourceId, req.user);
    if (!source) throw new Error('Library copy not found.');
    assertOrgAccess(source, orgId);

    const orgCopies = await listOrgCopies(orgId, req.user);
    const sameBookCopies = orgCopies.filter((row) => String(row.bookId) === String(source.bookId));
    const copyCode = suggestDuplicateCopyCode(source.copyCode, sameBookCopies);
    const userId = req.user?.id || 'SYSTEM';

    const created = await schoolDataService.addData('libraryCopies', {
      orgId,
      bookId: source.bookId,
      copyType: source.copyType,
      copyCode,
      status: COPY_STATUSES.AVAILABLE,
      locationId: source.locationId || '',
      location: source.location || '',
      notes: source.notes || '',
      audit: { createUser: userId, lastUpdateUser: userId }
    }, req.user);

    const response = {
      status: 'success',
      message: 'A similar copy was created.',
      copy: created,
      redirectTo: `/school/library/copies?duplicateNotice=${encodeURIComponent(created.id)}`
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

exports.deleteCopy = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('libraryCopies', req.params.id, req.user);
    if (!row) throw new Error('Library copy not found.');
    assertOrgAccess(row, orgId);
    if (String(row.status) === COPY_STATUSES.LOANED) {
      throw new Error('Cannot delete a copy that is currently loaned.');
    }
    await schoolDataService.deleteData('libraryCopies', req.params.id, req.user);
    const response = { status: 'success', message: 'Copy deleted successfully.', redirectTo: '/school/library/copies' };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/copies');
  } catch (error) {
    return respondSchoolDeleteError(req, res, error, { fallbackRedirect: '/school/library/copies' });
  }
};

exports.apiListAvailableCopies = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const bookId = String(req.query?.bookId || '').trim();
    const copyType = String(req.query?.copyType || '').trim().toLowerCase();
    let rows = await listOrgCopies(orgId, req.user);
    rows = rows.filter((row) => String(row.status) === COPY_STATUSES.AVAILABLE);
    if (bookId) rows = rows.filter((row) => String(row.bookId) === bookId);
    if (copyType) rows = rows.filter((row) => String(row.copyType) === copyType);
    rows = await enrichCopiesWithBooks(rows, req.user);
    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.ensureDigitalCopyForBook = libraryCirculationService.ensureDigitalCopyForBook;
