'use strict';

const bookModel = require('../../models/school/bookModel');
const schoolDataService = require('../../services/school/schoolDataService');
const skillCatalogService = require('../../services/school/skillCatalogService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const settingService = requireCoreModule('MVC/services/settingService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = requireCoreModule('MVC/utils/orgContextUtils');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');

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
    title: String(reqBody?.title || '').trim(),
    subtitle: String(reqBody?.subtitle || '').trim(),
    authors: String(reqBody?.authors || '').trim(),
    publisher: String(reqBody?.publisher || '').trim(),
    edition: String(reqBody?.edition || '').trim(),
    publicationYear: reqBody?.publicationYear,
    isbn: String(reqBody?.isbn || '').trim(),
    language: String(reqBody?.language || '').trim(),
    subjectArea: String(reqBody?.subjectArea || '').trim(),
    totalPages: reqBody?.totalPages,
    description: String(reqBody?.description || '').trim(),
    active: toBoolean(reqBody?.active, true),
    sortOrder: Number(reqBody?.sortOrder || 0),
    tableOfContents: reqBody?.tableOfContents,
    coverPhoto: reqBody?.coverPhoto,
    removeCoverPhoto: toBoolean(reqBody?.removeCoverPhoto, false),
    digitalPdf: reqBody?.digitalPdf,
    removeDigitalPdf: toBoolean(reqBody?.removeDigitalPdf, false),
    pdfBookPageOne: reqBody?.pdfBookPageOne,
    audit: {
      createUser: String(userId || 'SYSTEM'),
      lastUpdateUser: String(userId || 'SYSTEM')
    }
  };
}

function buildBookFileFromUpload(file) {
  if (!file || !file.path && !file.filename) return null;
  const storedPath = String(uploadMiddleware.getStoredFilePath(file) || '').trim();
  const storedUrl = String(uploadMiddleware.getStoredFileUrl(file) || storedPath).trim();
  if (!storedPath && !storedUrl) return null;
  return {
    fileName: String(file.filename || '').trim(),
    originalName: String(file.originalname || file.filename || '').trim(),
    path: storedPath,
    url: storedUrl,
    uploadedAt: new Date().toISOString()
  };
}

function buildCoverPhotoFromUpload(file) {
  return buildBookFileFromUpload(file);
}

function buildDigitalPdfFromUpload(file) {
  return buildBookFileFromUpload(file);
}

function bookAssetNeedsRelocation(asset = {}) {
  const ref = String(asset?.path || asset?.storagePath || asset?.url || '').trim();
  if (!ref) return false;
  return /(_unsaved|book_unsaved)/i.test(ref);
}

async function relocateBookAssetIfNeeded(book, orgId, reqUser, { folderKey, fieldName }) {
  const asset = book?.[fieldName];
  if (!asset || !bookAssetNeedsRelocation(asset)) return book;
  const bookId = String(book?.id || '').trim();
  if (!bookId) return book;
  const sourceRef = String(asset.url || asset.path || '').trim();
  if (!sourceRef) return book;
  const targetRelativeDir = uploadFolderSettingsService.resolveUploadFolder(folderKey, { bookId });
  try {
    const moved = await fileAssetStorage.moveUploadReference({
      sourceRef,
      destinationScopeKey: orgId,
      destinationDir: targetRelativeDir
    });
    const relocated = {
      ...asset,
      path: moved.path,
      url: moved.url,
      fileName: String(moved.fileName || asset.fileName || '').trim()
    };
    await schoolDataService.updateData('books', bookId, {
      [fieldName]: relocated,
      audit: {
        lastUpdateUser: String(reqUser?.id || 'SYSTEM'),
        lastUpdateDateTime: new Date().toISOString()
      }
    }, reqUser);
    return { ...book, [fieldName]: relocated };
  } catch (_) {
    return book;
  }
}

async function relocateCoverPhotoIfNeeded(book, orgId, reqUser) {
  return relocateBookAssetIfNeeded(book, orgId, reqUser, {
    folderKey: 'school.bookCover',
    fieldName: 'coverPhoto'
  });
}

async function relocateDigitalPdfIfNeeded(book, orgId, reqUser) {
  return relocateBookAssetIfNeeded(book, orgId, reqUser, {
    folderKey: 'school.bookPdf',
    fieldName: 'digitalPdf'
  });
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
  else res.redirect(payload.redirectTo || '/school/library/books');
  return true;
}

function cloneTableOfContentsForCopy(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const stripped = rows.map((entry, index) => ({
    label: entry?.label,
    startPage: entry?.startPage,
    endPage: entry?.endPage,
    level: entry?.level,
    sortOrder: entry?.sortOrder || index + 1
  }));
  return bookModel.normalizeTableOfContents(stripped, null);
}

function buildBookCopyTemplate(source = {}) {
  const authors = Array.isArray(source.authors) ? source.authors.map((row) => String(row || '').trim()).filter(Boolean) : [];
  return {
    sourceId: String(source.id || '').trim(),
    sourceTitle: String(source.title || '').trim(),
    title: String(source.title || '').trim(),
    subtitle: String(source.subtitle || '').trim(),
    authors,
    publisher: String(source.publisher || '').trim(),
    edition: String(source.edition || '').trim(),
    publicationYear: source.publicationYear === null || source.publicationYear === undefined || source.publicationYear === ''
      ? null
      : Number(source.publicationYear),
    language: String(source.language || '').trim(),
    subjectArea: String(source.subjectArea || '').trim(),
    totalPages: source.totalPages === null || source.totalPages === undefined || source.totalPages === ''
      ? null
      : Number(source.totalPages),
    description: String(source.description || '').trim(),
    active: source.active !== false,
    sortOrder: Number(source.sortOrder || 0),
    tableOfContents: cloneTableOfContentsForCopy(source.tableOfContents || [])
  };
}

async function listOrgBooks(orgId, reqUser) {
  const rows = await schoolDataService.fetchAllData('books', {}, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
}

exports.listBooks = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const canCreateBooks = await canCreateOrgScopedItem(req.user, { scopeLabel: 'books' });
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    let rows = await listOrgBooks(orgId, req.user);
    rows = rows.sort((a, b) => {
      const orderA = Number(a?.sortOrder || 0);
      const orderB = Number(b?.sortOrder || 0);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.title || '').localeCompare(String(b?.title || ''));
    });

    const searchableFields = ['title', 'subtitle', 'authors', 'publisher', 'isbn', 'subjectArea', 'edition'];
    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(rows, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/book/bookList', {
      title: 'School Books',
      tableName: 'School_Books',
      data,
      newUrl: 'school/library/books',
      newLabel: canCreateBooks ? 'New Book' : null,
      canCreateBooks,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
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
    await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'books' });
    const copyFromId = String(req.query?.copyFrom || '').trim();
    return res.render('school/book/bookForm', {
      title: 'New Book',
      bookItem: null,
      copyFromId,
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
    const row = await schoolDataService.getDataById('books', req.params.id, req.user);
    if (!row) throw new Error('Book not found.');
    assertOrgAccess(row, orgId);
    return res.render('school/book/bookForm', {
      title: 'Edit Book',
      bookItem: row,
      copyFromId: '',
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.getBookTemplate = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const sourceBookId = String(req.params.id || '').trim();
    if (!sourceBookId) throw new Error('Book id is required.');
    const row = await schoolDataService.getDataById('books', sourceBookId, req.user);
    if (!row) throw new Error('Book not found.');
    assertOrgAccess(row, orgId);
    return res.json({
      status: 'success',
      template: buildBookCopyTemplate(row)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.saveBook = async (req, res) => {
  let guardKey = '';
  try {
    const id = String(req.params?.id || '').trim();
    const orgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'books' });
    const guard = beginGuard(['school_book_save', orgId, id, req.body || {}]);
    guardKey = guard.key;
    if (respondGuard(req, res, guard.result, 'Book save is already in progress. Please wait.')) return;
    if (id) {
      const existing = await schoolDataService.getDataById('books', id, req.user);
      if (!existing) throw new Error('Book not found.');
      assertOrgAccess(existing, orgId);
      const payload = buildPayload(req.body, existing.orgId, req.user?.id || 'SYSTEM');
      const updated = await schoolDataService.updateData('books', id, payload, req.user);
      let saved = updated || { ...existing, ...payload, id };
      saved = await relocateCoverPhotoIfNeeded(saved, existing.orgId, req.user);
      saved = await relocateDigitalPdfIfNeeded(saved, existing.orgId, req.user);
      await libraryCirculationService.ensureDigitalCopyForBook(saved, req.user?.id || 'SYSTEM', req.user);
    } else {
      const payload = buildPayload(req.body, orgId, req.user?.id || 'SYSTEM');
      const created = await schoolDataService.addData('books', payload, req.user);
      if (created?.id) {
        let saved = created;
        saved = await relocateCoverPhotoIfNeeded(saved, orgId, req.user);
        saved = await relocateDigitalPdfIfNeeded(saved, orgId, req.user);
        await libraryCirculationService.ensureDigitalCopyForBook(saved, req.user?.id || 'SYSTEM', req.user);
      }
    }
    const response = {
      status: 'success',
      message: id ? 'Book updated successfully.' : 'Book created successfully.',
      redirectTo: '/school/library/books'
    };
    idempotencyGuardService.completeGuard(guardKey, response);
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/books');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.uploadCoverPhoto = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const file = req.file;
    if (!file) throw new Error('No cover photo was uploaded.');
    const mime = String(file.mimetype || '').trim().toLowerCase();
    if (!mime.startsWith('image/')) {
      throw new Error('Cover photo must be an image file.');
    }
    const coverPhoto = buildCoverPhotoFromUpload(file);
    if (!coverPhoto) throw new Error('Cover photo upload failed.');
    return res.json({
      status: 'success',
      message: 'Cover photo uploaded.',
      coverPhoto
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.uploadDigitalPdf = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const file = req.file;
    if (!file) throw new Error('No PDF file was uploaded.');
    const mime = String(file.mimetype || '').trim().toLowerCase();
    const originalName = String(file.originalname || '').trim().toLowerCase();
    if (mime !== 'application/pdf' && !originalName.endsWith('.pdf')) {
      throw new Error('Digital copy must be a PDF file.');
    }
    const digitalPdf = buildDigitalPdfFromUpload(file);
    if (!digitalPdf) throw new Error('PDF upload failed.');
    return res.json({
      status: 'success',
      message: 'Digital PDF uploaded.',
      digitalPdf
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.deleteBook = async (req, res) => {
  let guardKey = '';
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    if (!skillCatalogService.isRealOrganizationId(orgId)) {
      throw new Error('<b>Organization Required</b><br>Switch to a valid organization before deleting books.');
    }
    const id = String(req.params?.id || '').trim();
    const guard = beginGuard(['school_book_delete', orgId, id]);
    guardKey = guard.key;
    if (respondGuard(req, res, guard.result, 'Book delete is already in progress. Please wait.')) return;
    const existing = await schoolDataService.getDataById('books', id, req.user);
    if (!existing) throw new Error('Book not found.');
    assertOrgAccess(existing, orgId);
    await schoolDataService.deleteData('books', id, req.user);
    const response = { status: 'success', message: 'Book deleted successfully.', redirectTo: '/school/library/books' };
    idempotencyGuardService.completeGuard(guardKey, response);
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/books');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return respondSchoolDeleteError(req, res, error, { user: req.user });
  }
};
