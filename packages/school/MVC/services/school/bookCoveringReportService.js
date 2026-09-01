'use strict';

const schoolDataService = require('./schoolDataService');
const bookAssignmentService = require('./bookAssignmentService');
const bookCoveringPeriodService = require('./bookCoveringPeriodService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  PERIOD_TYPES,
  REPORT_STATUSES,
  validateTocEntryIdsAgainstBook
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
  }
  return parts.join(', ') || 'No coverage recorded';
}

function entryHasCoverage(entry = {}) {
  return formatEntryCoverageBrief(entry) !== 'No coverage recorded';
}

async function buildReportSummary(report, reqUser, accessContext = {}) {
  const entries = Array.isArray(report?.entries) ? report.entries : [];
  const bookTitleMap = new Map();
  for (const entry of entries) {
    const bookId = clean(entry.bookId);
    if (!bookId || bookTitleMap.has(bookId)) continue;
    const book = await schoolDataService.getDataById('books', bookId, reqUser, accessContext);
    bookTitleMap.set(bookId, clean(book?.title) || bookId);
  }

  const entrySummaries = entries.map((entry) => {
    const bookId = clean(entry.bookId);
    const coverageBrief = formatEntryCoverageBrief(entry);
    return {
      bookId,
      bookTitle: bookTitleMap.get(bookId) || bookId,
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

  let matched = findReportLinkedToSession(orgRows, { classId, sessionId });
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
  if (!matched) {
    matched = findReportByDailyWindow(orgRows, {
      classId,
      periodStartDate: periodWindow.periodStartDate,
      periodEndDate: periodWindow.periodEndDate,
      teacherId,
      sessionId
    });
  }

  return matched || null;
}

async function getSessionBookCoveringSummary(classData, session, reqUser, accessContext = {}) {
  const report = await findReportForSession({ classData, session, reqUser, accessContext });
  if (!report) return null;
  return buildReportSummary(report, reqUser, accessContext);
}

async function validateEntriesAgainstBooks(entries, orgId, reqUser) {
  for (const entry of entries) {
    const book = await bookAssignmentService.assertBookInOrg(entry.bookId, orgId, reqUser);
    validateTocEntryIdsAgainstBook([entry], book.tableOfContents || []);
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
  getSessionBookCoveringSummary,
  buildReportSummary,
  isReportSessionLocked,
  assertReportEditable,
  assertNoDuplicateReport
};
