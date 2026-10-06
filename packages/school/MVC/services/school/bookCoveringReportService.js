'use strict';

const schoolDataService = require('./schoolDataService');
const bookAssignmentService = require('./bookAssignmentService');
const bookCoveringPeriodService = require('./bookCoveringPeriodService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  PERIOD_TYPES,
  normalizePeriodType,
  REPORT_STATUSES,
  validateTocEntryIdsAgainstBook,
  validatePageNumbersAgainstBookToc,
  sanitizeEntry
} = require('../../models/school/bookCoveringReportModel');
const { resolveTeacherId, resolveTeacherName } = require('./sessionReportAssignmentService');

function clean(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  const token = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isSessionRowLocked(session) {
  if (!session) return false;
  return session.locked === true || String(session.locked) === 'true';
}

async function findSessionForReport(report, reqUser) {
  const classId = clean(report?.classId);
  const sessionId = clean(report?.sessionId);
  if (!classId || !sessionId) return null;
  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const list = Array.isArray(sessions) ? sessions : [];
  return list.find((row) => String(row?.sessionId || '') === sessionId) || null;
}

async function isReportSessionLocked(report, reqUser) {
  const session = await findSessionForReport(report, reqUser);
  return isSessionRowLocked(session);
}

async function assertReportEditable(report, reqUser) {
  if (await isReportSessionLocked(report, reqUser)) {
    throw new Error('This report cannot be edited because the linked session is locked.');
  }
}

function buildWriteOptions(accessContext = {}) {
  return accessContext && Object.keys(accessContext).length ? { accessContext } : {};
}

async function findDuplicateReport({
  orgId,
  classId,
  teacherId,
  periodType,
  periodStartDate,
  periodEndDate,
  sessionId,
  reqUser,
  excludeId = null,
  accessContext = {}
}) {
  const rows = await schoolDataService.fetchAllData('bookCoveringReports', {}, reqUser, accessContext);
  const list = (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
  return list.find((row) => {
    if (excludeId && String(row.id) === String(excludeId)) return false;
    if (String(row.classId) !== String(classId)) return false;
    if (String(row.teacherId) !== String(teacherId)) return false;
    if (String(row.periodType) !== String(periodType)) return false;
    if (periodType === PERIOD_TYPES.DAILY && sessionId) {
      return String(row.sessionId || '') === String(sessionId);
    }
    return String(row.periodStartDate) === String(periodStartDate)
      && String(row.periodEndDate) === String(periodEndDate);
  }) || null;
}

async function assertNoDuplicateReport(options) {
  const duplicate = await findDuplicateReport(options);
  if (duplicate) {
    throw new Error('A covering report already exists for this class, teacher, and period.');
  }
}

function isCountValue(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

function formatPageNumbersBrief(pageNumbers = []) {
  const pages = (Array.isArray(pageNumbers) ? pageNumbers : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  if (!pages.length) return '';
  if (pages.length === 1) return `page ${pages[0]}`;
  const runs = [];
  let runStart = pages[0];
  let runEnd = pages[0];
  for (let i = 1; i < pages.length; i += 1) {
    if (pages[i] === runEnd + 1) {
      runEnd = pages[i];
    } else {
      runs.push(runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`);
      runStart = pages[i];
      runEnd = pages[i];
    }
  }
  runs.push(runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`);
  return `pages ${runs.join(', ')}`;
}

function formatEntryCoverageBrief(entry = {}) {
  const parts = [];
  const unitMode = String(entry.unitCoverage?.mode || '').trim();
  const pageMode = String(entry.pageCoverage?.mode || '').trim();
  if (unitMode === 'count' && isCountValue(entry.unitCoverage?.unitCount)) {
    parts.push(`${entry.unitCoverage.unitCount} unit(s)`);
  } else if (unitMode === 'toc_pick' && (entry.unitCoverage?.tocEntryIds || []).length) {
    parts.push(`${entry.unitCoverage.tocEntryIds.length} TOC unit(s)`);
  }
  if (pageMode === 'pages_text' && clean(entry.pageCoverage?.pagesText)) {
    parts.push(`pages ${clean(entry.pageCoverage.pagesText)}`);
  } else if (pageMode === 'page_count' && isCountValue(entry.pageCoverage?.pageCount)) {
    parts.push(`${entry.pageCoverage.pageCount} page(s)`);
  } else if (pageMode === 'toc_pick' && (entry.pageCoverage?.tocEntryIds || []).length) {
    parts.push(`${entry.pageCoverage.tocEntryIds.length} TOC page range(s)`);
  } else if (pageMode === 'page_numbers' && (entry.pageCoverage?.pageNumbers || []).length) {
    parts.push(formatPageNumbersBrief(entry.pageCoverage.pageNumbers));
  }
  return parts.join(', ') || 'No coverage recorded';
}

function entryHasCoverage(entry = {}) {
  return formatEntryCoverageBrief(entry) !== 'No coverage recorded';
}

async function resolveBookDisplayMetaForSummary(bookId, orgId, reqUser) {
  const token = clean(bookId);
  if (!token) return { title: '', coverPhotoUrl: '' };
  const scopedOrgId = clean(orgId);
  if (scopedOrgId) {
    try {
      const book = await bookAssignmentService.assertBookInOrg(token, scopedOrgId, reqUser);
      return {
        title: clean(book?.title) || token,
        coverPhotoUrl: resolveCoverPhotoUrl(book)
      };
    } catch (_) {
      // Fall back to org-scoped lookup without route access context.
    }
  }
  const book = await schoolDataService.getDataById('books', token, reqUser);
  if (book) {
    return {
      title: clean(book?.title) || token,
      coverPhotoUrl: resolveCoverPhotoUrl(book)
    };
  }
  return { title: token, coverPhotoUrl: '' };
}

async function buildReportSummary(report, reqUser, accessContext = {}) {
  const entries = Array.isArray(report?.entries) ? report.entries : [];
  const orgId = clean(report?.orgId || reqUser?.activeOrgId);
  const bookMetaMap = new Map();
  for (const entry of entries) {
    const bookId = clean(entry.bookId);
    if (!bookId || bookMetaMap.has(bookId)) continue;
    bookMetaMap.set(bookId, await resolveBookDisplayMetaForSummary(bookId, orgId, reqUser));
  }

  const entrySummaries = entries.map((entry) => {
    const bookId = clean(entry.bookId);
    const meta = bookMetaMap.get(bookId) || { title: bookId, coverPhotoUrl: '' };
    const coverageBrief = formatEntryCoverageBrief(entry);
    return {
      bookId,
      bookAssignmentId: clean(entry.bookAssignmentId),
      bookTitle: meta.title,
      coverPhotoUrl: meta.coverPhotoUrl,
      unitCoverage: entry.unitCoverage || null,
      pageCoverage: entry.pageCoverage || null,
      coverageBrief,
      hasCoverage: entryHasCoverage(entry),
      notePreview: clean(entry.note).slice(0, 80)
    };
  });

  const status = clean(report?.status || REPORT_STATUSES.DRAFT).toLowerCase();
  const coveredBookCount = entrySummaries.filter((row) => row.hasCoverage).length;

  return {
    id: report.id,
    status,
    statusLabel: status === REPORT_STATUSES.SUBMITTED ? 'Submitted' : 'Draft',
    periodStartDate: report.periodStartDate || '',
    periodEndDate: report.periodEndDate || '',
    bookCount: entries.length,
    coveredBookCount,
    notesPreview: clean(report.notes).slice(0, 160),
    editUrl: `/school/library/book-covering/edit/${report.id}`,
    entries: entrySummaries
  };
}

function findReportLinkedToSession(list, { classId, sessionId }) {
  const sessionToken = clean(sessionId);
  if (!sessionToken) return null;
  return (Array.isArray(list) ? list : []).find((row) => (
    String(row.classId) === String(classId)
    && String(row.sessionId || '') === sessionToken
  )) || null;
}

function isDailyPeriodType(periodType) {
  const normalized = clean(periodType).toLowerCase();
  return !normalized || normalized === PERIOD_TYPES.DAILY;
}

function findReportByDailyWindow(list, {
  classId,
  periodStartDate,
  periodEndDate,
  teacherId = '',
  sessionId = ''
}) {
  const sessionToken = clean(sessionId);
  const dailyRows = (Array.isArray(list) ? list : []).filter((row) => (
    String(row.classId) === String(classId)
    && isDailyPeriodType(row.periodType)
    && String(row.periodStartDate) === String(periodStartDate)
    && String(row.periodEndDate) === String(periodEndDate)
    && (
      !sessionToken
      || !clean(row.sessionId)
      || String(row.sessionId) === sessionToken
    )
  ));
  if (!dailyRows.length) return null;
  const teacherToken = clean(teacherId);
  if (teacherToken) {
    const teacherMatch = dailyRows.find((row) => String(row.teacherId) === String(teacherToken));
    if (teacherMatch) return teacherMatch;
  }
  return dailyRows[0];
}

function findReportForSessionFromOrgRows({
  classData,
  session,
  orgRows = [],
  reqUser
} = {}) {
  if (!classData?.id || !session?.sessionId) return null;

  const sessionDate = normalizeDate(session.date);
  if (!sessionDate) return null;

  const classId = clean(classData.id);
  const sessionId = clean(session.sessionId);
  const teacherId = resolveTeacherId(session, classData);
  const periodWindow = bookCoveringPeriodService.resolvePeriodWindow({
    periodType: PERIOD_TYPES.DAILY,
    anchorDate: sessionDate
  });

  const rows = Array.isArray(orgRows) ? orgRows : [];
  let matched = findReportLinkedToSession(rows, { classId, sessionId });
  if (!matched) {
    matched = findReportByDailyWindow(rows, {
      classId,
      periodStartDate: periodWindow.periodStartDate,
      periodEndDate: periodWindow.periodEndDate,
      teacherId,
      sessionId
    });
  }

  return matched || null;
}

function hasSubmittedBookReportForSession({ classData, session, orgRows = [], reqUser } = {}) {
  const report = findReportForSessionFromOrgRows({ classData, session, orgRows, reqUser });
  if (!report) return false;
  return clean(report.status || REPORT_STATUSES.DRAFT).toLowerCase() === REPORT_STATUSES.SUBMITTED;
}

async function findReportForSession({
  classData,
  session,
  reqUser,
  accessContext = {}
}) {
  if (!classData?.id || !session?.sessionId) return null;

  const sessionDate = normalizeDate(session.date);
  if (!sessionDate) return null;

  const orgId = clean(classData.orgId || reqUser?.activeOrgId);
  const classId = clean(classData.id);
  const sessionId = clean(session.sessionId);
  const teacherId = resolveTeacherId(session, classData);
  const periodWindow = bookCoveringPeriodService.resolvePeriodWindow({
    periodType: PERIOD_TYPES.DAILY,
    anchorDate: sessionDate
  });

  const rows = await schoolDataService.fetchAllData('bookCoveringReports', {}, reqUser, accessContext);
  const orgRows = (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));

  let matched = findReportForSessionFromOrgRows({ classData, session, orgRows, reqUser });
  if (!matched && teacherId) {
    matched = await findDuplicateReport({
      orgId,
      classId,
      teacherId,
      periodType: PERIOD_TYPES.DAILY,
      periodStartDate: periodWindow.periodStartDate,
      periodEndDate: periodWindow.periodEndDate,
      sessionId,
      reqUser,
      accessContext
    });
  }

  return matched || null;
}

async function getSessionBookCoveringSummary(classData, session, reqUser, accessContext = {}) {
  const report = await findReportForSession({ classData, session, reqUser, accessContext });
  if (!report) return null;
  return buildReportSummary(report, reqUser, accessContext);
}

async function validateEntriesAgainstBooks(entries, orgId, reqUser, accessContext = {}) {
  for (const entry of entries) {
    const book = await bookAssignmentService.assertBookInOrg(entry.bookId, orgId, reqUser);
    validateTocEntryIdsAgainstBook([entry], book.tableOfContents || []);
    validatePageNumbersAgainstBookToc(entry, book.tableOfContents || []);
  }
}

async function createReport(payload, reqUser, accessContext = {}) {
  const orgId = clean(payload.orgId);
  const classId = clean(payload.classId);
  const classData = await bookAssignmentService.assertClassInOrg(classId, orgId, reqUser);

  const periodType = clean(payload.periodType).toLowerCase() || PERIOD_TYPES.DAILY;
  const anchorDate = normalizeDate(payload.anchorDate || payload.periodStartDate);
  const cycleStartDate = normalizeDate(classData.cycleStartDate);
  const periodWindow = bookCoveringPeriodService.resolvePeriodWindow({
    periodType,
    anchorDate,
    cycleStartDate
  });

  const teacherId = clean(payload.teacherId) || resolveTeacherId(payload.session || {}, classData);
  const teacherName = clean(payload.teacherName) || resolveTeacherName(payload.session || {}, classData);

  await assertNoDuplicateReport({
    orgId,
    classId,
    teacherId,
    periodType,
    periodStartDate: periodWindow.periodStartDate,
    periodEndDate: periodWindow.periodEndDate,
    sessionId: payload.sessionId,
    reqUser,
    accessContext
  });

  const fullPayload = {
    ...payload,
    orgId,
    classId,
    teacherId,
    teacherName,
    periodType,
    periodStartDate: periodWindow.periodStartDate,
    periodEndDate: periodWindow.periodEndDate,
    status: payload.status || REPORT_STATUSES.DRAFT
  };

  await validateEntriesAgainstBooks(fullPayload.entries || [], orgId, reqUser, accessContext);
  return schoolDataService.addData('bookCoveringReports', fullPayload, reqUser, buildWriteOptions(accessContext));
}

async function updateReport(id, payload, reqUser, accessContext = {}) {
  const existing = await schoolDataService.getDataById('bookCoveringReports', id, reqUser, accessContext);
  if (!existing) throw new Error('Book covering report not found.');
  await assertReportEditable(existing, reqUser);

  const orgId = existing.orgId;
  const periodType = clean(payload.periodType || existing.periodType).toLowerCase();
  let periodStartDate = normalizeDate(payload.periodStartDate || existing.periodStartDate);
  let periodEndDate = normalizeDate(payload.periodEndDate || existing.periodEndDate);

  if (payload.anchorDate || payload.periodType) {
    const classData = await bookAssignmentService.assertClassInOrg(existing.classId, orgId, reqUser);
    const anchorDate = normalizeDate(payload.anchorDate || periodStartDate);
    const window = bookCoveringPeriodService.resolvePeriodWindow({
      periodType,
      anchorDate,
      cycleStartDate: classData.cycleStartDate
    });
    periodStartDate = window.periodStartDate;
    periodEndDate = window.periodEndDate;
  }

  const teacherId = clean(payload.teacherId || existing.teacherId);
  await assertNoDuplicateReport({
    orgId,
    classId: existing.classId,
    teacherId,
    periodType,
    periodStartDate,
    periodEndDate,
    sessionId: payload.sessionId || existing.sessionId,
    reqUser,
    excludeId: id,
    accessContext
  });

  const fullPayload = {
    ...payload,
    periodType,
    periodStartDate,
    periodEndDate,
    teacherId
  };

  if (fullPayload.entries) {
    await validateEntriesAgainstBooks(fullPayload.entries, orgId, reqUser, accessContext);
  }

  return schoolDataService.updateData('bookCoveringReports', id, fullPayload, reqUser, buildWriteOptions(accessContext));
}

async function submitReport(id, reqUser, accessContext = {}) {
  const existing = await schoolDataService.getDataById('bookCoveringReports', id, reqUser, accessContext);
  if (!existing) throw new Error('Book covering report not found.');
  if (String(existing.status) === REPORT_STATUSES.SUBMITTED) return existing;
  await assertReportEditable(existing, reqUser);
  return updateReport(id, { status: REPORT_STATUSES.SUBMITTED }, reqUser, accessContext);
}

async function createDraftForSession({
  classData,
  session,
  input = {},
  reqUser,
  accessContext = {}
}) {
  if (!classData?.id) throw new Error('Class is required.');
  if (!session?.sessionId) throw new Error('Session is required.');

  const sessionDate = normalizeDate(session.date);
  if (!sessionDate) throw new Error('Session date is required.');

  const teacherId = resolveTeacherId(session, classData);
  if (!teacherId) throw new Error('The session needs an assigned teacher before creating a book covering report.');

  const orgId = clean(classData.orgId || reqUser?.activeOrgId);
  const classId = clean(classData.id);
  const sessionId = clean(session.sessionId);

  const assignedBooks = await bookAssignmentService.expandAssignedBooksForClass(
    classId,
    orgId,
    reqUser,
    { activeOnly: true }
  );
  if (!assignedBooks.length) {
    throw new Error('No active book assignments exist for this class. Assign books in the library first.');
  }

  const periodWindow = bookCoveringPeriodService.resolvePeriodWindow({
    periodType: PERIOD_TYPES.DAILY,
    anchorDate: sessionDate
  });

  const existing = await findDuplicateReport({
    orgId,
    classId,
    teacherId,
    periodType: PERIOD_TYPES.DAILY,
    periodStartDate: periodWindow.periodStartDate,
    periodEndDate: periodWindow.periodEndDate,
    sessionId,
    reqUser,
    accessContext
  });
  if (existing) {
    const status = clean(existing.status || REPORT_STATUSES.DRAFT).toLowerCase();
    return {
      report: existing,
      editUrl: `/school/library/book-covering/edit/${existing.id}`,
      alreadyExists: true,
      message: status === REPORT_STATUSES.SUBMITTED
        ? 'Opening your submitted book covering report.'
        : 'Opening your book covering report draft.'
    };
  }

  const report = await schoolDataService.addData('bookCoveringReports', {
    orgId,
    classId,
    teacherId,
    teacherName: resolveTeacherName(session, classData),
    periodType: PERIOD_TYPES.DAILY,
    periodStartDate: periodWindow.periodStartDate,
    periodEndDate: periodWindow.periodEndDate,
    sessionId,
    status: REPORT_STATUSES.DRAFT,
    entries: [],
    audit: {
      createUser: reqUser?.id || 'SYSTEM',
      lastUpdateUser: reqUser?.id || 'SYSTEM'
    }
  }, reqUser, buildWriteOptions(accessContext));

  return {
    report,
    editUrl: `/school/library/book-covering/edit/${report.id}`,
    message: 'Book covering report draft created for this session.'
  };
}

async function listReportsForOrg(orgId, reqUser, accessContext = {}) {
  const rows = await schoolDataService.fetchAllData('bookCoveringReports', {}, reqUser, accessContext);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
}

async function enrichReports(rows, reqUser, accessContext = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const classIds = [...new Set(list.map((row) => clean(row.classId)).filter(Boolean))];
  const classMap = new Map();
  for (const classId of classIds) {
    const row = await schoolDataService.getDataById('classes', classId, reqUser, accessContext);
    if (row) classMap.set(String(row.id), row);
  }
  return list.map((row) => ({
    ...row,
    classTitle: classMap.get(String(row.classId || ''))?.title || row.classId
  }));
}

async function deleteReport(id, reqUser, accessContext = {}) {
  const reportId = clean(id);
  if (!reportId) throw new Error('Book covering report id is required.');
  const existing = await schoolDataService.getDataById('bookCoveringReports', reportId, reqUser, accessContext);
  if (!existing) throw new Error('Book covering report not found.');
  await schoolDataService.deleteData('bookCoveringReports', reportId, reqUser, buildWriteOptions(accessContext));
  return existing;
}

function resolveCoverPhotoUrl(bookRow) {
  if (!bookRow || typeof bookRow !== 'object') return '';
  return clean(bookRow.coverPhotoUrl || bookRow.coverPhoto?.url);
}

async function listAssignedBooksForSession(classData, reqUser, accessContext = {}) {
  const orgId = clean(classData?.orgId || reqUser?.activeOrgId);
  const classId = clean(classData?.id);
  if (!classId) throw new Error('Class is required.');
  const rows = await bookAssignmentService.expandAssignedBooksForClass(
    classId,
    orgId,
    reqUser,
    { activeOnly: true }
  );
  return rows.map((row) => ({
    bookId: String(row.bookId || ''),
    bookAssignmentId: String(row.bookAssignmentId || row.id || ''),
    bookTitle: clean(row.bookTitle) || row.bookId,
    coverPhotoUrl: resolveCoverPhotoUrl(row),
    sortOrder: Number(row.sortOrder || 0)
  }));
}

async function getAssignedBookDetailForSession(classData, bookId, reqUser, accessContext = {}) {
  const orgId = clean(classData?.orgId || reqUser?.activeOrgId);
  const classId = clean(classData?.id);
  const token = clean(bookId);
  if (!classId || !token) throw new Error('Class and book are required.');

  const assigned = await bookAssignmentService.expandAssignedBooksForClass(
    classId,
    orgId,
    reqUser,
    { activeOnly: true }
  );
  const line = assigned.find((row) => String(row.bookId) === String(token));
  if (!line) throw new Error('This book is not actively assigned to the class.');

  const book = await bookAssignmentService.assertBookInOrg(token, orgId, reqUser);
  const digitalPdf = book.digitalPdf && typeof book.digitalPdf === 'object'
    ? {
      url: clean(book.digitalPdf.url),
      path: clean(book.digitalPdf.path),
      fileName: clean(book.digitalPdf.fileName)
    }
    : null;

  return {
    bookId: String(book.id || token),
    bookAssignmentId: String(line.bookAssignmentId || line.id || ''),
    title: clean(book.title) || token,
    subtitle: clean(book.subtitle),
    authors: book.authors || [],
    isbn: clean(book.isbn),
    publisher: clean(book.publisher),
    totalPages: book.totalPages ?? null,
    coverPhotoUrl: resolveCoverPhotoUrl(book),
    digitalPdf,
    tableOfContents: Array.isArray(book.tableOfContents) ? book.tableOfContents : []
  };
}

async function findOrCreateSessionReport({ classData, session, reqUser, accessContext = {} }) {
  let report = await findReportForSession({ classData, session, reqUser, accessContext });
  if (report) return report;
  const created = await createDraftForSession({ classData, session, reqUser, accessContext });
  return created.report;
}

async function upsertSessionReportEntry({
  classData,
  session,
  entryPayload = {},
  reqUser,
  accessContext = {}
}) {
  const report = await findOrCreateSessionReport({ classData, session, reqUser, accessContext });
  await assertReportEditable(report, reqUser);

  const orgId = clean(report.orgId || classData.orgId);
  const periodType = normalizePeriodType(report.periodType);
  const sanitizedEntry = sanitizeEntry(entryPayload, periodType, 0);
  await validateEntriesAgainstBooks([sanitizedEntry], orgId, reqUser, accessContext);

  const entries = Array.isArray(report.entries) ? report.entries.slice() : [];
  const bookId = sanitizedEntry.bookId;
  const existingIndex = entries.findIndex((row) => String(row.bookId) === String(bookId));
  if (existingIndex >= 0) entries[existingIndex] = sanitizedEntry;
  else entries.push(sanitizedEntry);

  const updated = await updateReport(
    report.id,
    { entries },
    reqUser,
    accessContext
  );
  return updated;
}

async function removeSessionReportEntry({
  classData,
  session,
  bookId,
  reqUser,
  accessContext = {}
}) {
  const token = clean(bookId);
  if (!token) throw new Error('Book id is required.');
  const report = await findReportForSession({ classData, session, reqUser, accessContext });
  if (!report) throw new Error('Book covering report not found for this session.');
  await assertReportEditable(report, reqUser);

  const entries = (Array.isArray(report.entries) ? report.entries : [])
    .filter((row) => String(row.bookId) !== String(token));
  if (entries.length === (report.entries || []).length) {
    throw new Error('Book entry not found on this session report.');
  }

  if (!entries.length) {
    await deleteReport(report.id, reqUser, accessContext);
    return null;
  }

  return updateReport(report.id, { entries }, reqUser, accessContext);
}

module.exports = {
  createReport,
  updateReport,
  submitReport,
  deleteReport,
  createDraftForSession,
  listReportsForOrg,
  enrichReports,
  findDuplicateReport,
  findReportForSession,
  findReportForSessionFromOrgRows,
  hasSubmittedBookReportForSession,
  getSessionBookCoveringSummary,
  buildReportSummary,
  formatEntryCoverageBrief,
  listAssignedBooksForSession,
  getAssignedBookDetailForSession,
  upsertSessionReportEntry,
  removeSessionReportEntry,
  isReportSessionLocked,
  assertReportEditable,
  assertNoDuplicateReport
};
