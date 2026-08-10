'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/books.json');

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const cleaned = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function cleanId(value, { max = 80, allowEmpty = false } = {}) {
  const cleaned = cleanString(value, { max, allowEmpty });
  if (cleaned === null) return null;
  if (!cleaned) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) throw new Error('Invalid id format.');
  return cleaned;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(fallback);
}

function cleanSortOrder(value, fallback = 100) {
  if (value === undefined || value === null || value === '') return Number(fallback);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  if (parsed < 0 || parsed > 9999) throw new Error('Sort order must be between 0 and 9999.');
  return Math.round(parsed);
}

function cleanPositiveInt(value, { allowEmpty = false, fieldLabel = 'Value' } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowEmpty) return null;
    throw new Error(`${fieldLabel} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldLabel} must be a positive whole number.`);
  }
  return parsed;
}

function normalizeIsbn(value = '') {
  const cleaned = String(value || '').replace(/\0/g, '').trim();
  if (!cleaned) return '';
  return cleaned.replace(/[\s-]/g, '').toUpperCase();
}

function normalizeAuthors(value) {
  if (Array.isArray(value)) {
    return value
      .map((row) => cleanString(row, { max: 120, allowEmpty: false }))
      .filter(Boolean);
  }
  const text = cleanString(value, { max: 2000, allowEmpty: true });
  if (!text) return [];
  return text.split(',').map((part) => cleanString(part, { max: 120, allowEmpty: false })).filter(Boolean);
}

function generateBookId() {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BK-${year}-${random}`;
}

function generateTocEntryId() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TOC-${random}`;
}

function normalizePublicationYear(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 2100) {
    throw new Error('Publication year must be between 1000 and 2100.');
  }
  return Math.round(parsed);
}

function normalizeTotalPages(value) {
  if (value === undefined || value === null || value === '') return null;
  return cleanPositiveInt(value, { fieldLabel: 'Total pages' });
}

function normalizePdfBookPageOne(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('PDF page for book page 1 is required when a digital PDF is attached.');
    return null;
  }
  return cleanPositiveInt(value, { fieldLabel: 'PDF page for book page 1' });
}

function mapBookPageToPdfPage(bookPage, pdfBookPageOne = 1) {
  const bookPageNumber = Number(bookPage);
  const offset = Number(pdfBookPageOne || 1);
  if (!Number.isFinite(bookPageNumber) || bookPageNumber < 1) {
    throw new Error('Book page must be a positive whole number.');
  }
  if (!Number.isFinite(offset) || offset < 1) {
    throw new Error('PDF page for book page 1 must be a positive whole number.');
  }
  return bookPageNumber + offset - 1;
}

const MAX_TOC_LEVEL = 6;

function normalizeTocLevel(value, fallback = 1) {
  if (value === undefined || value === null || value === '') {
    const safeFallback = Number(fallback);
    if (!Number.isFinite(safeFallback)) return 1;
    return Math.min(MAX_TOC_LEVEL, Math.max(1, Math.round(safeFallback)));
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOC_LEVEL) {
    throw new Error(`TOC heading level must be between 1 and ${MAX_TOC_LEVEL}.`);
  }
  return parsed;
}

function assignTocHierarchy(entries = []) {
  const ancestors = [];
  return entries.map((entry, index) => {
    const level = normalizeTocLevel(entry.level, 1);
    if (level > 1 && !ancestors[level - 2]) {
      throw new Error(`TOC row ${index + 1}: heading level ${level} must follow a parent heading.`);
    }
    if (ancestors.length > 0 && level > ancestors.length + 1) {
      throw new Error(`TOC row ${index + 1}: heading level ${level} cannot skip more than one level deeper than the previous entry.`);
    }
    const parentId = level > 1 ? ancestors[level - 2] : null;
    ancestors[level - 1] = entry.id;
    ancestors.length = level;
    return {
      ...entry,
      level,
      parentId
    };
  });
}

function normalizeTableOfContents(entries = [], totalPages = null) {
  const rows = Array.isArray(entries) ? entries : [];
  const normalized = rows.map((entry, index) => {
    const label = cleanString(entry?.label, { max: 200, allowEmpty: false });
    if (!label) throw new Error(`Table of contents row ${index + 1}: label is required.`);
    const startPage = cleanPositiveInt(entry?.startPage, { fieldLabel: `TOC row ${index + 1} start page` });
    let endPage = null;
    if (entry?.endPage !== undefined && entry?.endPage !== null && String(entry.endPage).trim() !== '') {
      endPage = cleanPositiveInt(entry.endPage, { fieldLabel: `TOC row ${index + 1} end page` });
      if (endPage < startPage) {
        throw new Error(`TOC row ${index + 1}: end page must be greater than or equal to start page.`);
      }
    }
    if (totalPages !== null && startPage > totalPages) {
      throw new Error(`TOC row ${index + 1}: start page exceeds total pages (${totalPages}).`);
    }
    if (totalPages !== null && endPage !== null && endPage > totalPages) {
      throw new Error(`TOC row ${index + 1}: end page exceeds total pages (${totalPages}).`);
    }
    const level = normalizeTocLevel(entry?.level, 1);
    return {
      id: cleanId(entry?.id || generateTocEntryId(), { max: 80, allowEmpty: false }),
      label,
      startPage,
      endPage,
      level,
      sortOrder: cleanSortOrder(entry?.sortOrder, index + 1)
    };
  });
  normalized.sort((a, b) => {
    const orderA = Number(a.sortOrder || 0);
    const orderB = Number(b.sortOrder || 0);
    if (orderA !== orderB) return orderA - orderB;
    return Number(a.startPage || 0) - Number(b.startPage || 0);
  });
  return assignTocHierarchy(normalized);
}

function normalizeStoredBook(row = {}) {
  const now = new Date().toISOString();
  const totalPages = row.totalPages === null || row.totalPages === undefined || row.totalPages === ''
    ? null
    : cleanPositiveInt(row.totalPages, { fieldLabel: 'Total pages' });
  return {
    id: cleanId(row.id || generateBookId(), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    title: cleanString(row.title, { max: 300, allowEmpty: false }),
    subtitle: cleanString(row.subtitle, { max: 300, allowEmpty: true }),
    authors: normalizeAuthors(row.authors),
    publisher: cleanString(row.publisher, { max: 200, allowEmpty: true }),
    edition: cleanString(row.edition, { max: 80, allowEmpty: true }),
    publicationYear: row.publicationYear === null || row.publicationYear === undefined || row.publicationYear === ''
      ? null
      : normalizePublicationYear(row.publicationYear),
    isbn: normalizeIsbn(row.isbn),
    language: cleanString(row.language, { max: 80, allowEmpty: true }),
    subjectArea: cleanString(row.subjectArea, { max: 200, allowEmpty: true }),
    totalPages,
    description: cleanString(row.description, { max: 4000, allowEmpty: true }),
    active: cleanBoolean(row.active, true),
    sortOrder: cleanSortOrder(row.sortOrder, 100),
    tableOfContents: normalizeTableOfContents(row.tableOfContents || [], totalPages),
    coverPhoto: sanitizeBookFileAsset(row.coverPhoto),
    digitalPdf: sanitizeBookFileAsset(row.digitalPdf),
    pdfBookPageOne: row.pdfBookPageOne === null || row.pdfBookPageOne === undefined || row.pdfBookPageOne === ''
      ? null
      : normalizePdfBookPageOne(row.pdfBookPageOne),
    audit: {
      createUser: cleanString(row?.audit?.createUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      createDateTime: cleanString(row?.audit?.createDateTime, { max: 40, allowEmpty: true }) || now,
      lastUpdateUser: cleanString(row?.audit?.lastUpdateUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      lastUpdateDateTime: cleanString(row?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || now
    }
  };
}

function parseTableOfContentsInput(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    throw new Error('Invalid table of contents payload.');
  }
}

function parseBookFileInput(value, label = 'file') {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    throw new Error(`Invalid ${label} payload.`);
  }
}

function parseCoverPhotoInput(value) {
  return parseBookFileInput(value, 'cover photo');
}

function parseDigitalPdfInput(value) {
  return parseBookFileInput(value, 'digital PDF');
}

function sanitizeBookFileAsset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fileName = cleanString(value.fileName || value.filename, { max: 260, allowEmpty: false });
  const originalName = cleanString(value.originalName || value.name, { max: 260, allowEmpty: true });
  const pathValue = cleanString(value.path || value.storagePath, { max: 600, allowEmpty: true });
  const url = cleanString(value.url, { max: 600, allowEmpty: true });
  if (!fileName && !url && !pathValue) return null;
  const uploadedAt = cleanString(value.uploadedAt, { max: 40, allowEmpty: true }) || new Date().toISOString();
  const pathForName = pathValue || url || '';
  return {
    fileName: fileName || cleanString(path.basename(pathForName), { max: 260, allowEmpty: true }),
    originalName,
    path: pathValue,
    url,
    uploadedAt
  };
}

function sanitizeCoverPhoto(value) {
  return sanitizeBookFileAsset(value);
}

function sanitizeDigitalPdf(value) {
  return sanitizeBookFileAsset(value);
}

function sanitizeInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid book payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const title = cleanString(input.title, { max: 300, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!title) throw new Error('Book title is required.');

  const totalPages = input.totalPages === undefined || input.totalPages === null || input.totalPages === ''
    ? null
    : normalizeTotalPages(input.totalPages);
  const tableOfContents = normalizeTableOfContents(
    parseTableOfContentsInput(input.tableOfContents),
    totalPages
  );
  const removeCoverPhoto = cleanBoolean(input.removeCoverPhoto, false);
  const parsedCover = removeCoverPhoto ? null : sanitizeCoverPhoto(parseCoverPhotoInput(input.coverPhoto));
  const removeDigitalPdf = cleanBoolean(input.removeDigitalPdf, false);
  const parsedDigitalPdf = removeDigitalPdf ? null : sanitizeDigitalPdf(parseDigitalPdfInput(input.digitalPdf));
  const pdfBookPageOne = parsedDigitalPdf
    ? normalizePdfBookPageOne(input.pdfBookPageOne, { required: true })
    : null;

  const output = {
    orgId: String(orgId),
    title,
    subtitle: cleanString(input.subtitle, { max: 300, allowEmpty: true }),
    authors: normalizeAuthors(input.authors),
    publisher: cleanString(input.publisher, { max: 200, allowEmpty: true }),
    edition: cleanString(input.edition, { max: 80, allowEmpty: true }),
    publicationYear: input.publicationYear === undefined || input.publicationYear === null || input.publicationYear === ''
      ? null
      : normalizePublicationYear(input.publicationYear),
    isbn: normalizeIsbn(input.isbn),
    language: cleanString(input.language, { max: 80, allowEmpty: true }),
    subjectArea: cleanString(input.subjectArea, { max: 200, allowEmpty: true }),
    totalPages,
    description: cleanString(input.description, { max: 4000, allowEmpty: true }),
    active: cleanBoolean(input.active, true),
    sortOrder: cleanSortOrder(input.sortOrder, 100),
    tableOfContents,
    coverPhoto: parsedCover,
    digitalPdf: parsedDigitalPdf,
    pdfBookPageOne
  };
  if (!isUpdate && input.id) {
    output.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return output;
}

function assertUniqueIsbn(rows, candidate, { excludeId = null } = {}) {
  const candidateIsbn = normalizeIsbn(candidate.isbn);
  if (!candidateIsbn) return;
  const duplicate = (Array.isArray(rows) ? rows : []).some((row) => (
    (!excludeId || String(row.id) !== String(excludeId))
    && String(row.orgId || '') === String(candidate.orgId || '')
    && normalizeIsbn(row.isbn) === candidateIsbn
  ));
  if (duplicate) throw new Error(`ISBN "${candidate.isbn}" already exists for this organization.`);
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

async function getAllBooks() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredBook) : [];
}

async function getBookById(id) {
  const rows = await getAllBooks();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addBook(payload) {
  return queueWrite(async () => {
    const rows = await getAllBooks();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    assertUniqueIsbn(rows, sanitized);
    const now = new Date().toISOString();
    const created = {
      id: sanitized.id || generateBookId(),
      ...sanitized,
      audit: {
        createUser: String(payload?.audit?.createUser || 'SYSTEM'),
        createDateTime: now,
        lastUpdateUser: String(payload?.audit?.lastUpdateUser || payload?.audit?.createUser || 'SYSTEM'),
        lastUpdateDateTime: now
      }
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateBook(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllBooks();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Book not found.');
    const current = rows[index];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId
    }, { isUpdate: true });
    assertUniqueIsbn(rows, sanitized, { excludeId: current.id });
    const now = new Date().toISOString();
    rows[index] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      audit: {
        ...current.audit,
        lastUpdateUser: String(payload?.audit?.lastUpdateUser || 'SYSTEM'),
        lastUpdateDateTime: now
      }
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteBook(id) {
  return queueWrite(async () => {
    const rows = await getAllBooks();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) return false;
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return true;
  });
}

module.exports = {
  getAllBooks,
  getBookById,
  addBook,
  updateBook,
  deleteBook,
  normalizeStoredBook,
  sanitizeInput,
  normalizeAuthors,
  normalizeTableOfContents,
  normalizeTocLevel,
  MAX_TOC_LEVEL,
  normalizeIsbn,
  normalizePdfBookPageOne,
  mapBookPageToPdfPage,
  sanitizeBookFileAsset,
  sanitizeCoverPhoto,
  sanitizeDigitalPdf,
  parseCoverPhotoInput,
  parseDigitalPdfInput,
  generateBookId,
  generateTocEntryId,
  assertUniqueIsbn
};
