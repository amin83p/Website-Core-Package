const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const accessConstants = require('../config/accessConstants');
const bookAssignmentModel = require('../MVC/models/school/bookAssignmentModel');
const bookAssignmentService = require('../MVC/services/school/bookAssignmentService');
const bookCoveringReportModel = require('../MVC/models/school/bookCoveringReportModel');
const bookCoveringPeriodService = require('../MVC/services/school/bookCoveringPeriodService');
const {
  collapseRows
} = require('../../../scripts/migrate-book-assignments-to-class-docs');

test('access constants declare book assignment and covering sections', () => {
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, 'SCHOOL_LIBRARY_BOOK_ASSIGNMENTS');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, 'SCHOOL_LIBRARY_BOOK_COVERING');
});

test('book assignment model normalizes status', () => {
  assert.equal(bookAssignmentModel.normalizeStatus('ACTIVE'), 'active');
  assert.equal(bookAssignmentModel.normalizeStatus('archived'), 'archived');
});

test('expandBooksFromAssignment orders lines and filters activeOnly', () => {
  const assignment = {
    id: 'BKASG-PARENT',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    status: 'active',
    books: [
      { bookId: 'BK-2', sortOrder: 20, notes: '', status: 'active' },
      { bookId: 'BK-1', sortOrder: 10, notes: 'line note', status: 'inactive' }
    ]
  };
  const all = bookAssignmentService.expandBooksFromAssignment(assignment);
  assert.equal(all.length, 2);
  assert.equal(all[0].bookId, 'BK-1');
  assert.equal(all[0].bookAssignmentId, 'BKASG-PARENT');
  const activeOnly = bookAssignmentService.expandBooksFromAssignment(assignment, { activeOnly: true });
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0].bookId, 'BK-2');
});

test('migration collapses legacy class-book rows into one document', () => {
  const { collapsed } = collapseRows([
    {
      id: 'BKASG-OLD-1',
      orgId: 'ORG-1',
      classId: 'CLS-1',
      bookId: 'BK-1',
      status: 'active',
      sortOrder: 20,
      notes: 'class note',
      audit: {}
    },
    {
      id: 'BKASG-OLD-2',
      orgId: 'ORG-1',
      classId: 'CLS-1',
      bookId: 'BK-2',
      status: 'active',
      sortOrder: 10,
      notes: '',
      audit: {}
    }
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].classId, 'CLS-1');
  assert.equal(collapsed[0].books.length, 2);
  assert.equal(collapsed[0].books[0].bookId, 'BK-2');
  assert.equal(collapsed[0].books[1].bookId, 'BK-1');
});

test('book covering report service uses expandAssignedBooksForClass for session drafts', () => {
  const serviceSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/bookCoveringReportService.js'),
    'utf8'
  );
  assert.match(serviceSource, /expandAssignedBooksForClass/);
  const draftBlock = serviceSource.split('async function createDraftForSession')[1]?.split('async function listReportsForOrg')[0] || '';
  assert.match(draftBlock, /entries:\s*\[\]/);
  assert.doesNotMatch(draftBlock, /assignedBooks\.map\(\(row\)\s*=>\s*\(\{/);
  assert.match(serviceSource, /alreadyExists: true/);
  assert.match(serviceSource, /getSessionBookCoveringSummary/);
});

test('book covering report service formats entry coverage summaries', () => {
  const service = require('../MVC/services/school/bookCoveringReportService');
  const brief = service.buildReportSummary({
    id: 'BCR-1',
    status: 'submitted',
    periodStartDate: '2026-08-15',
    periodEndDate: '2026-08-15',
    notes: 'Overall note',
    entries: [{
      bookId: 'BK-1',
      unitCoverage: { mode: 'count', unitCount: 2 },
      pageCoverage: { mode: 'pages_text', pagesText: '12-14' },
      note: 'Chapter review'
    }]
  }, { id: 'USER-1' });

  return brief.then((summary) => {
    assert.equal(summary.status, 'submitted');
    assert.equal(summary.statusLabel, 'Submitted');
    assert.equal(summary.bookCount, 1);
    assert.equal(summary.coveredBookCount, 1);
    assert.match(summary.entries[0].coverageBrief, /2 unit\(s\)/);
    assert.match(summary.entries[0].coverageBrief, /pages 12-14/);
    assert.equal(summary.editUrl, '/school/library/book-covering/edit/BCR-1');
  });
});

test('book covering period service resolves daily and weekly windows', () => {
  const daily = bookCoveringPeriodService.resolvePeriodWindow({
    periodType: 'daily',
    anchorDate: '2026-08-15'
  });
  assert.equal(daily.periodStartDate, '2026-08-15');
  assert.equal(daily.periodEndDate, '2026-08-15');

  const weekly = bookCoveringPeriodService.resolvePeriodWindow({
    periodType: 'weekly',
    anchorDate: '2026-08-15'
  });
  assert.equal(weekly.periodStartDate, '2026-08-10');
  assert.equal(weekly.periodEndDate, '2026-08-16');
});

test('book covering report service allows submitted edits until session is locked', () => {
  const serviceSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/bookCoveringReportService.js'),
    'utf8'
  );
  assert.doesNotMatch(serviceSource, /Submitted reports cannot be edited/);
  assert.match(serviceSource, /assertReportEditable/);
  assert.match(serviceSource, /isReportSessionLocked/);
});

test('book covering save does not double-submit after update', () => {
  const controllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/bookCoveringReportController.js'),
    'utf8'
  );
  const saveBlock = controllerSource.split('exports.saveReport')[1]?.split('exports.apiAssignedBooks')[0] || '';
  assert.doesNotMatch(saveBlock, /submitReport\(id/);
  assert.doesNotMatch(saveBlock, /submitReport\(report\.id/);
});

test('book covering report form uses session lock for read-only state', () => {
  const view = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/views/school/library/bookCoveringReportForm.ejs'),
    'utf8'
  );
  assert.match(view, /reportReadOnly/);
  assert.match(view, /isReadOnly/);
  assert.match(view, /linked session is locked/);
});

test('book covering report model accepts zero unit and page counts', () => {
  const entry = bookCoveringReportModel.sanitizeEntry({
    bookId: 'BK-2026-TEST',
    unitCoverage: { mode: 'count', unitCount: 0 },
    pageCoverage: { mode: 'page_count', pageCount: 0 },
    note: 'partial coverage'
  }, 'daily', 0);
  assert.equal(entry.unitCoverage.unitCount, 0);
  assert.equal(entry.pageCoverage.pageCount, 0);
});

test('book covering report model omits non-daily follow-up fields for daily period', () => {
  const entry = bookCoveringReportModel.sanitizeEntry({
    bookId: 'BK-2026-TEST',
    unitCoverage: { mode: 'count', unitCount: 2 },
    pageCoverage: { mode: 'page_count', pageCount: 5 },
    note: 'test'
  }, 'daily', 0);
  assert.equal(entry.usageFrequency, null);
  assert.equal(entry.useInNextFourWeeks, null);
});

test('book covering report model requires usage frequency for weekly period', () => {
  assert.throws(() => {
    bookCoveringReportModel.sanitizeEntry({
      bookId: 'BK-2026-TEST',
      unitCoverage: { mode: 'count', unitCount: 1 },
      pageCoverage: { mode: 'pages_text', pagesText: '12-14' }
    }, 'weekly', 0);
  }, /Usage frequency is required/);
});

test('book covering report model validates TOC ids against book', () => {
  const toc = [{ id: 'TOC-1', label: 'Chapter 1', startPage: 1, endPage: 10, level: 1 }];
  bookCoveringReportModel.validateTocEntryIdsAgainstBook([{
    bookId: 'BK-1',
    unitCoverage: { mode: 'toc_pick', tocEntryIds: ['TOC-1'] },
    pageCoverage: { mode: 'pages_text', pagesText: '1-3' }
  }], toc);

  assert.throws(() => {
    bookCoveringReportModel.validateTocEntryIdsAgainstBook([{
      bookId: 'BK-1',
      unitCoverage: { mode: 'toc_pick', tocEntryIds: ['INVALID'] },
      pageCoverage: { mode: 'pages_text', pagesText: '1-3' }
    }], toc);
  }, /not valid for book/);
});

test('library routes mount book assignment and covering paths', () => {
  const mainRoute = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryMainRoute.js'), 'utf8');
  assert.match(mainRoute, /book-assignments/);
  assert.match(mainRoute, /book-covering/);
});

test('class routes expose session book covering shortcut', () => {
  const classRoutes = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/classRoutes.js'), 'utf8');
  assert.match(classRoutes, /book-covering-reports/);
  assert.match(classRoutes, /createBookCoveringForSession/);
  assert.match(classRoutes, /deleteBookCoveringForSession/);
});

test('book covering report form template avoids nested EJS output tags', () => {
  const view = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/views/school/library/bookCoveringReportForm.ejs'),
    'utf8'
  );
  assert.match(view, /initialBooksPayload/);
  assert.match(view, /<%- initialBooksPayload %>/);
  assert.match(view, /<%- initialEntriesPayload %>/);
  assert.doesNotMatch(view, /const initialBooks = <%-/);
});

test('book covering report edit form enables message modal via includeModal', () => {
  const controllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/bookCoveringReportController.js'),
    'utf8'
  );
  const editBlock = controllerSource.split('exports.showEditForm')[1]?.split('exports.saveReport')[0] || '';
  assert.match(editBlock, /includeModal:\s*true/);
  assert.doesNotMatch(editBlock, /includeModal:\s*false/);
});

test('book covering report form uses multi-step wizard with covers and overall notes', () => {
  const view = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/views/school/library/bookCoveringReportForm.ejs'),
    'utf8'
  );
  const wizardJs = fs.readFileSync(path.join(ROOT, 'public/scripts/bookCoveringReportWizard.js'), 'utf8');
  assert.match(view, /coveringWizardStepRail/);
  assert.match(view, /wizardStepBooks/);
  assert.match(view, /wizardStepFinish/);
  assert.match(view, /overallReportNotes/);
  assert.match(view, /coverPhotoUrl/);
  assert.match(view, /max-width: 1400px/);
  assert.match(view, /Book Covering Report/);
  assert.match(view, /covering-wizard-section/);
  assert.match(view, /Class & session/);
  assert.match(view, /Reporting period/);
  assert.match(view, /period-type-option/);
  assert.match(view, /js-period-resolved-label/);
  assert.match(view, /contextTeacherDisplay/);
  assert.match(view, /id="anchorDate"/);
  assert.doesNotMatch(view, /resolvedPeriodLabel/);
  assert.match(wizardJs, /BookCoveringReportWizard/);
  assert.match(wizardJs, /config\.isReadOnly/);
  assert.match(wizardJs, /showMessageModal/);
  assert.match(wizardJs, /js-usage-frequency.*type="radio"/s);
  assert.match(wizardJs, /js-next-four-weeks.*type="radio"/s);
  assert.doesNotMatch(wizardJs, /form-select js-usage-frequency/);
  assert.match(wizardJs, /js-toc-units-list/);
  assert.match(wizardJs, /js-toc-remove/);
  assert.doesNotMatch(wizardJs, /alert\(/);
});

test('book covering report model stores optional overall notes', () => {
  const modelSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/models/school/bookCoveringReportModel.js'),
    'utf8'
  );
  assert.match(modelSource, /notes: cleanString\(row\.notes/);
  assert.match(modelSource, /notes: cleanString\(input\.notes/);
});

test('expandAssignedBooksForClass includes coverPhotoUrl', () => {
  const serviceSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/bookAssignmentService.js'),
    'utf8'
  );
  assert.match(serviceSource, /coverPhotoUrl: resolveCoverPhotoUrl\(book\)/);
});

test('session manager includes book covering report button and summary panel', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/class/sessionManager.ejs'), 'utf8');
  assert.match(view, /btnCreateSessionBookCoveringReport/);
  assert.match(view, /btnDeleteSessionBookCoveringReport/);
  assert.match(view, /book-covering-reports/);
  assert.match(view, /sessionBookCoveringSummaryPanel/);
  assert.match(view, /session-panel-book-covering/);
  assert.match(view, /sessionBookCoveringNavBadge/);
  assert.match(view, /data-edit-url/);
  assert.match(view, /box-arrow-up-right/);
});

test('book covering list uses row actions menu with delete', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/bookCoveringList.ejs'), 'utf8');
  assert.match(view, /btn-row-actions-toggle/);
  assert.match(view, /bi-three-dots-vertical/);
  assert.match(view, /book-covering\/delete/);
  assert.match(view, /canDelete/);
});
