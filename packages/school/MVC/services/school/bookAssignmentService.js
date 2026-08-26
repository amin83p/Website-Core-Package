'use strict';

const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  ASSIGNMENT_STATUSES,
  BOOK_LINE_STATUSES,
  normalizeStatus,
  normalizeBookLineStatus
} = require('../../models/school/bookAssignmentModel');

function clean(value) {
  return String(value || '').trim();
}

function resolveCoverPhotoUrl(bookRow) {
  if (!bookRow || typeof bookRow !== 'object') return '';
  return clean(bookRow.coverPhotoUrl || bookRow.coverPhoto?.url);
}

async function assertClassInOrg(classId, orgId, reqUser) {
  const id = clean(classId);
  if (!id) throw new Error('Class is required.');
  const row = await schoolDataService.getDataById('classes', id, reqUser);
  if (!row || !idsEqual(row.orgId, orgId)) {
    throw new Error('Selected class is invalid for this organization.');
  }
  return row;
}

async function assertBookInOrg(bookId, orgId, reqUser) {
  const id = clean(bookId);
  if (!id) throw new Error('Book is required.');
  const row = await schoolDataService.getDataById('books', id, reqUser);
  if (!row || !idsEqual(row.orgId, orgId)) {
    throw new Error(`Book "${id}" is invalid for this organization.`);
  }
  return row;
}

async function assertBooksInOrg(bookIds, orgId, reqUser) {
  const ids = Array.isArray(bookIds) ? bookIds.map(clean).filter(Boolean) : [];
  if (!ids.length) throw new Error('At least one book is required.');
  for (const bookId of ids) {
    await assertBookInOrg(bookId, orgId, reqUser);
  }
  return ids;
}

async function listForOrg(orgId, reqUser) {
  const rows = await schoolDataService.fetchAllData('bookAssignments', {}, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
}

async function getForClass(classId, orgId, reqUser) {
  const id = clean(classId);
  const rows = await listForOrg(orgId, reqUser);
  return rows.find((row) => String(row.classId) === id) || null;
}

function expandBooksFromAssignment(assignment, { activeOnly = false } = {}) {
  if (!assignment) return [];
  const parentActive = normalizeStatus(assignment.status) === ASSIGNMENT_STATUSES.ACTIVE;
  if (activeOnly && !parentActive) return [];

  const books = Array.isArray(assignment.books) ? assignment.books : [];
  let lines = books.map((book) => ({
    bookAssignmentId: String(assignment.id || ''),
    orgId: String(assignment.orgId || ''),
    classId: String(assignment.classId || ''),
    assignmentStatus: normalizeStatus(assignment.status),
    assignmentNotes: String(assignment.notes || ''),
    bookId: String(book.bookId || ''),
    sortOrder: Number(book.sortOrder || 0),
    notes: String(book.notes || ''),
    status: normalizeBookLineStatus(book.status)
  }));

  if (activeOnly) {
    lines = lines.filter((line) => line.status === BOOK_LINE_STATUSES.ACTIVE);
  }
  return lines.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

async function expandAssignedBooksForClass(classId, orgId, reqUser, { activeOnly = false } = {}) {
  const assignment = await getForClass(classId, orgId, reqUser);
  if (!assignment) return [];
  const lines = expandBooksFromAssignment(assignment, { activeOnly });
  const bookIds = [...new Set(lines.map((line) => line.bookId).filter(Boolean))];
  const bookMap = new Map();
  for (const bookId of bookIds) {
    const book = await schoolDataService.getDataById('books', bookId, reqUser);
    if (book) bookMap.set(String(book.id), book);
  }
  return lines.map((line) => {
    const book = bookMap.get(String(line.bookId || ''));
    return {
      ...line,
      id: line.bookAssignmentId,
      bookTitle: book?.title || line.bookId,
      bookIsbn: book?.isbn || '',
      coverPhotoUrl: resolveCoverPhotoUrl(book),
      bookCoverPhoto: book?.coverPhoto || null,
      bookTotalPages: book?.totalPages ?? null,
      bookTableOfContents: Array.isArray(book?.tableOfContents) ? book.tableOfContents : []
    };
  });
}

async function enrichAssignments(rows, reqUser) {
  const list = Array.isArray(rows) ? rows : [];
  const classIds = [...new Set(list.map((row) => clean(row.classId)).filter(Boolean))];
  const bookIds = [...new Set(
    list.flatMap((row) => (Array.isArray(row.books) ? row.books : []).map((b) => clean(b.bookId)).filter(Boolean))
  )];
  const classMap = new Map();
  const bookMap = new Map();

  for (const classId of classIds) {
    const row = await schoolDataService.getDataById('classes', classId, reqUser);
    if (row) classMap.set(String(row.id), row);
  }
  for (const bookId of bookIds) {
    const row = await schoolDataService.getDataById('books', bookId, reqUser);
    if (row) bookMap.set(String(row.id), row);
  }

  return list.map((row) => {
    const classRow = classMap.get(String(row.classId || ''));
    const books = Array.isArray(row.books) ? row.books : [];
    const enrichedBooks = books.map((book) => {
      const bookRow = bookMap.get(String(book.bookId || ''));
      return {
        ...book,
        bookTitle: bookRow?.title || book.bookId,
        bookIsbn: bookRow?.isbn || '',
        coverPhotoUrl: resolveCoverPhotoUrl(bookRow)
      };
    }).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    const titleSummary = enrichedBooks
      .map((b) => b.bookTitle || b.bookId)
      .filter(Boolean)
      .join(', ');
    return {
      ...row,
      classTitle: classRow?.title || row.classId,
      books: enrichedBooks,
      bookCount: enrichedBooks.length,
      bookTitleSummary: titleSummary
    };
  });
}

async function upsertForClass(payload, reqUser) {
  const orgId = clean(payload.orgId);
  const classId = clean(payload.classId);
  await assertClassInOrg(classId, orgId, reqUser);
  const bookIds = (Array.isArray(payload.books) ? payload.books : []).map((b) => clean(b.bookId)).filter(Boolean);
  await assertBooksInOrg(bookIds, orgId, reqUser);

  const existing = await getForClass(classId, orgId, reqUser);
  if (existing) {
    return schoolDataService.updateData('bookAssignments', existing.id, payload, reqUser);
  }
  return schoolDataService.addData('bookAssignments', payload, reqUser);
}

async function createAssignment(payload, reqUser) {
  return upsertForClass(payload, reqUser);
}

async function updateAssignment(id, payload, reqUser) {
  const existing = await schoolDataService.getDataById('bookAssignments', id, reqUser);
  if (!existing) throw new Error('Book assignment not found.');
  const orgId = existing.orgId;
  if (payload.classId) await assertClassInOrg(payload.classId, orgId, reqUser);
  if (payload.books) {
    const bookIds = (Array.isArray(payload.books) ? payload.books : []).map((b) => clean(b.bookId)).filter(Boolean);
    await assertBooksInOrg(bookIds, orgId, reqUser);
  }
  return schoolDataService.updateData('bookAssignments', id, payload, reqUser);
}

async function archiveAssignment(id, reqUser) {
  return updateAssignment(id, { status: ASSIGNMENT_STATUSES.ARCHIVED }, reqUser);
}

/** @deprecated Use expandAssignedBooksForClass */
async function listForClass(classId, orgId, reqUser, { activeOnly = false } = {}) {
  const lines = await expandAssignedBooksForClass(classId, orgId, reqUser, { activeOnly });
  return lines.map((line) => ({
    id: line.bookAssignmentId,
    orgId: line.orgId,
    classId: line.classId,
    bookId: line.bookId,
    status: line.status,
    sortOrder: line.sortOrder,
    notes: line.notes,
    bookTitle: line.bookTitle,
    bookIsbn: line.bookIsbn,
    bookCoverPhoto: line.bookCoverPhoto,
    bookTotalPages: line.bookTotalPages,
    bookTableOfContents: line.bookTableOfContents
  }));
}

module.exports = {
  listForOrg,
  getForClass,
  expandBooksFromAssignment,
  expandAssignedBooksForClass,
  enrichAssignments,
  upsertForClass,
  createAssignment,
  updateAssignment,
  archiveAssignment,
  listForClass,
  assertClassInOrg,
  assertBookInOrg,
  assertBooksInOrg
};
