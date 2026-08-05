'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const ROOT_DIR = path.resolve(__dirname, '..');
const printService = require('../packages/school/MVC/services/school/timesheetPrintService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheet sections declare EXPORT without granting it to default access profiles', () => {
  const manifest = JSON.parse(read('packages/school/package.manifest.json'));
  const sectionIds = ['445568', '445579'];
  sectionIds.forEach((sectionId) => {
    const section = manifest.sections.find((row) => String(row.id) === sectionId);
    assert.ok(section, `missing section ${sectionId}`);
    assert.ok(section.operations.some((operation) => operation.id === 'OP1012'));
  });

  manifest.accesses.forEach((access) => {
    (access.sections || [])
      .filter((section) => sectionIds.includes(String(section.sectionId)))
      .forEach((section) => {
        assert.equal(
          (section.operations || []).some((operation) => operation.operationId === 'OP1012'),
          false,
          `${access.name} must not receive default timesheet EXPORT access`
        );
      });
  });
});

test('owner and management print routes use their corresponding EXPORT permissions', () => {
  const routes = read('packages/school/MVC/routes/timesheetRoutes.js');
  assert.match(routes, /router\.post\('\/editor\/:periodId\/print',[\s\S]*?SCHOOL_TIMESHEETS, OPERATIONS\.EXPORT[\s\S]*?ctrl\.printOwnTimesheet/);
  assert.match(routes, /router\.post\('\/manage\/print',[\s\S]*?SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS\.EXPORT[\s\S]*?ctrl\.printManagedTimesheets/);
  assert.match(routes, /trackActionState\(SECTIONS\.SCHOOL_TIMESHEETS, OPERATIONS\.EXPORT\)/);
  assert.match(routes, /trackActionState\(SECTIONS\.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS\.EXPORT\)/);
});

test('print controller derives owner identity and validates all managed targets', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /exports\.printOwnTimesheet[\s\S]*?resolveSelfTeacherOrThrow\(req\)/);
  assert.match(controller, /exports\.printManagedTimesheets[\s\S]*?loadTimesheetEligiblePeople\(activeOrgId, req\.user\)/);
  assert.match(controller, /people\.some\(\(row\) => !row\)/);
  assert.match(controller, /One or more selected timesheets is not available in the active organization/);
  assert.match(controller, /Cache-Control', 'no-store, private, max-age=0'/);
  assert.match(controller, /timesheetEffectiveEntryService\.buildEffectiveTimesheetEntries/);
  assert.match(
    controller,
    /res\.render\('school\/timesheet\/timesheetPrint',\s*\{[\s\S]*?layout:\s*false/,
    'print preview must bypass the application layout'
  );
});

test('print source freezes submitted entries and fills legacy display metadata from live sessions', () => {
  const effective = {
    timesheet: {
      status: 'submitted',
      submissionSnapshot: {
        entries: [{ sessionId: 'S-1', className: 'Stored Class', isOneOnOne: false, showOptionalBadge: false }]
      }
    },
    entries: [{ sessionId: 'DRAFT' }],
    liveEntries: [{
      sessionId: 'S-1',
      className: 'Changed Live Class',
      deliveryDepartmentCode: 'ESL',
      isOneOnOne: true,
      singleStudentId: 'ST-1',
      singleStudentName: 'Student One',
      showOptionalBadge: true
    }]
  };
  const resolved = printService.resolveAuthoritativeEntries(effective);
  assert.equal(resolved.source, 'snapshot');
  assert.equal(resolved.entries[0].className, 'Stored Class');
  assert.equal(resolved.entries[0].deliveryDepartmentCode, 'ESL');
  assert.equal(resolved.entries[0].isOneOnOne, true);
  assert.equal(resolved.entries[0].showOptionalBadge, true);

  const draft = printService.resolveAuthoritativeEntries({
    timesheet: { status: 'draft', submissionSnapshot: { entries: [{ sessionId: 'OLD' }] } },
    entries: [{ sessionId: 'LIVE' }]
  });
  assert.equal(draft.source, 'live');
  assert.deepEqual(draft.entries.map((entry) => entry.sessionId), ['LIVE']);
});

test('print sorting and date labels follow schedule precedence', () => {
  const sorted = printService.sortEntriesBySchedule([
    { sessionId: 'late', date: '2026-07-15', startTime: '11:00', endTime: '13:00' },
    { sessionId: 'untimed', date: '2026-07-15', startTime: '' },
    { sessionId: 'early', date: '2026-07-15', startTime: '08:00', endTime: '10:00' }
  ]);
  assert.deepEqual(sorted.map((entry) => entry.sessionId), ['early', 'late', 'untimed']);
  assert.equal(printService.formatDateKey('2026-07-15', { weekday: 'long' }), 'Wednesday');
  assert.equal(printService.formatDateKey('2026-07-15', { month: 'long', day: 'numeric' }), 'July 15');
});

test('Optional Hours remain informational and are listed separately by department', () => {
  const optionalPaid = printService.shapePrintEntry({
    sessionId: 'paid',
    deliveryDepartmentName: 'English',
    durationHours: 1,
    timesheetHours: 1,
    showOptionalBadge: true
  }, { classMap: new Map(), departmentMap: new Map() });
  const pending = printService.shapePrintEntry({
    sessionId: 'pending',
    deliveryDepartmentName: 'English',
    isManual: true,
    approvalStatus: 'pending_approval',
    requestedHours: 3
  }, { classMap: new Map(), departmentMap: new Map() });
  const optionalUnpaid = printService.shapePrintEntry({
    sessionId: 'optional-unpaid',
    deliveryDepartmentName: 'English',
    durationHours: 2,
    timesheetHours: 0,
    showOptionalBadge: true
  }, { classMap: new Map(), departmentMap: new Map() });
  const totals = printService.buildDepartmentTotals([optionalPaid, pending, optionalUnpaid]);

  assert.equal(optionalPaid.payableHours, 1);
  assert.equal(optionalUnpaid.payableHours, 0);
  assert.equal(totals.rows[0].payableHours, 1);
  assert.equal(totals.rows[0].pendingHours, 3);
  assert.equal(totals.rows[0].totalHours, 4);
  assert.equal(totals.rows[0].optionalHours, 3);
  assert.equal(totals.totals.optionalHours, 3);
  assert.equal(
    printService.resolvePayableHours({ timesheetHours: 1.5, showOptionalBadge: true }),
    printService.resolvePayableHours({ timesheetHours: 1.5, showOptionalBadge: false })
  );
});

test('print comments use only user-authored timesheet comments', () => {
  const withoutTimesheetComment = printService.shapePrintEntry({
    sessionId: 'session-note-only',
    notes: 'Internal session note that must not print',
    timesheetHours: 1
  }, { classMap: new Map(), departmentMap: new Map() });
  const withTimesheetComment = printService.shapePrintEntry({
    sessionId: 'user-comment',
    notes: 'Internal session note',
    comment: 'User entered this on the timesheet',
    timesheetHours: 1
  }, { classMap: new Map(), departmentMap: new Map() });

  assert.equal(withoutTimesheetComment.commentLabel, '');
  assert.equal(withTimesheetComment.commentLabel, 'User entered this on the timesheet');

  const effectiveSource = read('packages/school/MVC/services/school/timesheetEffectiveEntryService.js');
  assert.match(effectiveSource, /comment: savedComments\.get\(String\(entry\?\.sessionId \|\| ''\)\.trim\(\)\) \|\| ''/);
  assert.doesNotMatch(effectiveSource, /comment: savedComments[\s\S]{0,120}\|\| entry\?\.comment/);
});

test('organization print title resolves a name and never falls back to the organization id', () => {
  assert.equal(printService.resolveOrganizationNameFromContext({
    activeOrgId: 'ORG-1',
    allowedOrgs: [{ orgId: 'ORG-1', name: 'Example Learning Centre' }]
  }, 'ORG-1'), 'Example Learning Centre');
  assert.equal(printService.resolveOrganizationNameFromContext({}, 'ORG-1'), '');

  const serviceSource = read('packages/school/MVC/services/school/timesheetPrintService.js');
  assert.match(serviceSource, /getDataById\('organizations', targetOrgId, reqUser\)/);
  assert.doesNotMatch(serviceSource, /\|\| activeOrgId\s*\)/);
});

function sampleDocument(name, overrides = {}) {
  return {
    person: { id: name, name },
    status: 'draft',
    statusLabel: 'Draft',
    isDraft: true,
    managerApproved: false,
    source: 'live',
    payableTotalHours: 1.5,
    days: [{
      date: '2026-07-15',
      dayName: 'Wednesday',
      dateLabel: 'July 15',
      holidayName: '',
      entries: [{
        primaryLabel: 'ESL',
        secondaryLabel: '<script>alert(1)</script>',
        isOneOnOne: true,
        roleLabel: 'Teacher',
        studentName: 'Student One',
        attendanceLabel: 'Absent',
        hoursLabel: '1.50 hrs',
        hoursIsStruck: false,
        showOptionalBadge: true,
        payableNote: '',
        timeLabel: '08:00 – 09:30',
        statusLabel: 'Completed',
        commentLabel: 'Printed comment'
      }]
    }],
    departmentTotals: {
      rows: [{ departmentName: 'English', payableHours: 1.5, pendingHours: 0, totalHours: 1.5, optionalHours: 1.5 }],
      totals: { payableHours: 1.5, pendingHours: 0, totalHours: 1.5, optionalHours: 1.5 }
    },
    ...overrides
  };
}

test('standalone print view renders safe single and batch documents with print CSS', () => {
  const viewPath = path.join(ROOT_DIR, 'packages/school/MVC/views/school/timesheet/timesheetPrint.ejs');
  const source = fs.readFileSync(viewPath, 'utf8');
  assert.doesNotThrow(() => ejs.compile(source, { filename: viewPath }));
  const reconciliationDocument = sampleDocument('Person Two', { isDraft: false, status: 'processed', statusLabel: 'Processed' });
  reconciliationDocument.days[0].entries[0] = {
    ...reconciliationDocument.days[0].entries[0],
    statusLabel: 'Scheduled',
    isProvisional: true,
    showReconciliationBadge: true
  };
  const html = ejs.render(source, {
    title: 'Timesheet Print',
    appBrand: {
      appName: 'Example Website',
      logoUrl: '/uploads/GLOBAL/logo/example-logo.png'
    },
    printContext: {
      organizationName: 'Example School',
      printedByName: 'Printer User',
      printedAtLabel: 'Jul 15, 2026, 09:00 a.m.',
      period: {
        name: '2026-JULY-02',
        startDateLabel: 'July 15, 2026',
        endDateLabel: 'July 31, 2026',
        deadlineLabel: '2026-07-30 23:59'
      },
      documents: [sampleDocument('Person One'), reconciliationDocument]
    }
  }, { filename: viewPath });

  assert.equal((html.match(/class="print-sheet"/g) || []).length, 2);
  assert.match(html, /@page \{ margin: 10mm; \}/);
  assert.doesNotMatch(html, /@page\s*\{[^}]*\bsize\s*:/);
  assert.match(html, /html, body \{ width: auto; min-width: 0; max-width: none; \}/);
  assert.match(html, /break-after: page/);
  assert.match(html, /class="screen-actions no-print"/);
  assert.match(html, />Print<\/button>/);
  assert.doesNotMatch(html, /Print Again/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /Example School/);
  assert.match(html, /<h1 class="organization-name">Example School<\/h1>/);
  assert.match(html, /<div class="document-name">Timesheet<\/div>/);
  assert.match(html, /class="print-logo" src="\/uploads\/GLOBAL\/logo\/example-logo\.png" alt="Example Website Logo"/);
  assert.match(html, /\.print-logo \{[^}]*height: 58px;[^}]*max-width: 180px;/);
  assert.match(html, /\.print-logo \{ height: 42px; max-width: 140px; \}/);
  assert.match(html, /Person One/);
  assert.match(html, /2026-JULY-02/);
  assert.match(html, /class="timesheet-table"/);
  assert.match(html, /One on One/);
  assert.match(html, />Optional<\/span>/);
  assert.equal((html.match(/class="badge reconciliation-badge"/g) || []).length, 1);
  assert.match(html, />Scheduled<\/span>/);
  assert.match(html, />Reconciliation<\/span>/);
  assert.doesNotMatch(html, /Provisional - Scheduled/);
  assert.doesNotMatch(html, /Completed - Recheck/);
  assert.match(html, /Hours by Department/);
  assert.match(html, /Total Optional Hours/);
  assert.match(html, /body \{ font-size: 8px; line-height: 1\.15; \}/);
  assert.match(html, /th, td \{ padding: 2px 3px; \}/);
  assert.doesNotMatch(html, /class="meta-grid"/);
  assert.doesNotMatch(html, /class="draft-warning"/);
  assert.doesNotMatch(html, /class="document-footer"/);
  assert.doesNotMatch(html, /Manager Approved/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, />Act</);
});

test('timesheet editor always exposes Print and blocks dirty drafts', () => {
  const editorPath = path.join(ROOT_DIR, 'packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const editor = fs.readFileSync(editorPath, 'utf8');
  assert.doesNotThrow(() => ejs.compile(editor, { filename: editorPath }));
  assert.match(editor, /id="btnPrintTimesheet"/);
  assert.match(editor, /class="btn btn-filled btn-edit btn-md me-2 mb-2"/);
  assert.doesNotMatch(editor, /id="timesheetPrintForm"/);
  assert.match(editor, /EXPORT access is required to print this timesheet/);
  assert.match(editor, /function buildTimesheetPrintFingerprint\(\)/);
  assert.match(editor, /hasUnsavedTimesheetPrintChanges\(\)/);
  assert.match(editor, /Save Before Printing/);
  assert.match(editor, /This timesheet has unsaved changes\. Save the timesheet before opening the print preview\./);
  assert.match(editor, /window\.open\('', '_blank', 'height=720,width=1100'\)/);
  assert.match(editor, /fetch\(TIMESHEET_PRINT_ACTION/);
  assert.match(editor, /printWindow\.document\.write\(html\)/);
  assert.match(editor, /printWindow\.print\(\)/);
  assert.doesNotMatch(editor, /btnPrintTimesheet[\s\S]{0,250}type="submit"/);
  assert.doesNotMatch(editor, /btnPrintTimesheet[\s\S]{0,500}Processing/);
});
