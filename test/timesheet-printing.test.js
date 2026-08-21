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
  assert.equal(`${printService.formatDateKey('2026-07-15', { weekday: 'short' })}.`, 'Wed.');
  assert.equal(printService.formatDateKey('2026-07-15', { month: 'long', day: 'numeric' }), 'July 15');
  assert.equal(`${printService.formatDateKey('2026-07-15', { month: 'short' })}. ${printService.formatDateKey('2026-07-15', { day: 'numeric' })}`, 'Jul. 15');

  const serviceSource = read('packages/school/MVC/services/school/timesheetPrintService.js');
  assert.match(serviceSource, /dayName:\s*`\$\{formatDateKey\(date, \{ weekday: 'short' \}\)\}\.`/);
  assert.match(serviceSource, /dateLabel:\s*`\$\{shortMonth\}\. \$\{formatDateKey\(date, \{ day: 'numeric' \}\)\}`/);
});

test('department one-on-one classifier uses max capacity of 1 or single-student enrollment', () => {
  assert.equal(printService.isDepartmentOneOnOneEntry({ classId: 'C-1', classMaxCapacity: 1 }), true);
  assert.equal(printService.isDepartmentOneOnOneEntry({ classId: 'C-2', classMaxCapacity: 30 }), false);
  assert.equal(printService.isDepartmentOneOnOneEntry({ classId: 'C-2b', classMaxCapacity: 30, isOneOnOne: true }), true);
  assert.equal(printService.isDepartmentOneOnOneEntry(
    { classId: 'C-3' },
    { enrollment: { maxCapacity: 1 } }
  ), true);
  assert.equal(printService.isDepartmentOneOnOneEntry({ activityId: 'ACT-1', sessionId: 'act-1' }), false);
});

test('department optional hours require one-on-one classification and Optional badge', () => {
  const lookups = {
    classMap: new Map([['CLASS-30', { id: 'CLASS-30', enrollment: { maxCapacity: 30 } }]]),
    departmentMap: new Map()
  };
  const optionalAbsent = printService.shapePrintEntry({
    sessionId: 'optional-absent',
    classId: 'CLASS-30',
    classMaxCapacity: 30,
    deliveryDepartmentName: 'EAL',
    durationHours: 1.5,
    timesheetHours: 0,
    showOptionalBadge: true,
    isOneOnOne: true
  }, lookups);
  const totals = printService.buildDepartmentTotals([optionalAbsent], lookups);

  assert.equal(printService.isDepartmentOneOnOneEntry(optionalAbsent, lookups.classMap.get('CLASS-30')), true);
  assert.equal(printService.resolveDepartmentOptionalHours(optionalAbsent, lookups.classMap.get('CLASS-30')), 1.5);
  assert.equal(totals.rows[0].groupHours, 0);
  assert.equal(totals.rows[0].oneOnOneHours, 0);
  assert.equal(totals.rows[0].oneOnOneOptionalHours, 1.5);
  assert.equal(totals.totals.oneOnOneOptionalHours, 1.5);

  const groupOptional = printService.shapePrintEntry({
    sessionId: 'group-optional',
    classId: 'CLASS-30',
    classMaxCapacity: 30,
    deliveryDepartmentName: 'EAL',
    durationHours: 2,
    timesheetHours: 0,
    showOptionalBadge: true,
    isOneOnOne: false
  }, lookups);
  assert.equal(printService.resolveDepartmentOptionalHours(groupOptional, lookups.classMap.get('CLASS-30')), 0);
});

test('department optional hours apply makeup duration percent for make-up required sessions', () => {
  const lookups = {
    classMap: new Map([['CLASS-30', { id: 'CLASS-30', enrollment: { maxCapacity: 30 } }]]),
    departmentMap: new Map()
  };
  const makeupOptional = printService.shapePrintEntry({
    sessionId: 'makeup-optional',
    classId: 'CLASS-30',
    classMaxCapacity: 30,
    deliveryDepartmentName: 'LINC',
    durationHours: 3,
    timesheetHours: 0,
    showOptionalBadge: true,
    isOneOnOne: true,
    makeUpRequired: true,
    makeupDurationPercent: 50,
    allowedDurationHours: 1.5
  }, lookups);
  const regularOptional = printService.shapePrintEntry({
    sessionId: 'regular-optional',
    classId: 'CLASS-30',
    classMaxCapacity: 30,
    deliveryDepartmentName: 'LINC',
    durationHours: 3,
    timesheetHours: 0,
    showOptionalBadge: true,
    isOneOnOne: true,
    makeUpRequired: false
  }, lookups);
  const totals = printService.buildDepartmentTotals([makeupOptional, regularOptional], lookups);

  assert.equal(printService.resolveOptionalHours(makeupOptional), 1.5);
  assert.equal(printService.resolveOptionalHours(regularOptional), 3);
  assert.equal(totals.rows[0].oneOnOneOptionalHours, 4.5);
});

test('buildDepartmentTotalsFromEffective uses the same shaped print entry pipeline', () => {
  const effective = {
    timesheet: { status: 'draft' },
    entries: [{
      sessionId: 'SES-1',
      classId: 'CLASS-1',
      date: '2026-07-01',
      deliveryDepartmentCode: 'EAL',
      deliveryDepartmentName: 'English',
      classMaxCapacity: 1,
      timesheetHours: 2,
      durationHours: 2
    }],
    classes: [{ id: 'CLASS-1', enrollment: { maxCapacity: 1 } }],
    departments: []
  };
  const fromEffective = printService.buildDepartmentTotalsFromEffective(effective);
  const { entries, lookups } = printService.buildShapedPrintEntriesFromEffective(effective);
  const direct = printService.buildDepartmentTotals(entries, lookups);

  assert.deepEqual(fromEffective, direct);
  assert.equal(fromEffective.rows[0].departmentName, 'EAL');
  assert.equal(fromEffective.rows[0].departmentCode, 'EAL');
  assert.equal(fromEffective.rows[0].oneOnOneHours, 2);
  assert.equal(fromEffective.totals.totalHours, 2);
});

test('Optional Hours remain informational and are listed separately by department', () => {
  const lookups = {
    classMap: new Map([['CLASS-1', { id: 'CLASS-1', enrollment: { maxCapacity: 1 } }]]),
    departmentMap: new Map()
  };
  const optionalPaid = printService.shapePrintEntry({
    sessionId: 'paid',
    classId: 'CLASS-1',
    classMaxCapacity: 1,
    deliveryDepartmentName: 'English',
    durationHours: 1,
    timesheetHours: 1,
    showOptionalBadge: true
  }, lookups);
  const pending = printService.shapePrintEntry({
    sessionId: 'pending',
    deliveryDepartmentName: 'English',
    isManual: true,
    approvalStatus: 'pending_approval',
    requestedHours: 3
  }, lookups);
  const optionalUnpaid = printService.shapePrintEntry({
    sessionId: 'optional-unpaid',
    classId: 'CLASS-1',
    classMaxCapacity: 1,
    deliveryDepartmentName: 'English',
    durationHours: 2,
    timesheetHours: 0,
    showOptionalBadge: true
  }, lookups);
  const totals = printService.buildDepartmentTotals([optionalPaid, pending, optionalUnpaid], lookups);

  assert.equal(optionalPaid.payableHours, 1);
  assert.equal(optionalUnpaid.payableHours, 0);
  assert.equal(totals.rows[0].groupHours, 0);
  assert.equal(totals.rows[0].oneOnOneHours, 0);
  assert.equal(totals.rows[0].groupPendingHours, 3);
  assert.equal(totals.rows[0].totalHours, 6);
  assert.equal(totals.rows[0].oneOnOneOptionalHours, 3);
  assert.equal(totals.totals.oneOnOneOptionalHours, 3);
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
    regularTotalHours: 0,
    optionalTotalHours: 1.5,
    days: [{
      date: '2026-07-15',
      dayName: 'Wed.',
      dateLabel: 'Jul. 15',
      holidayName: '',
      entries: [{
        department: { code: 'EAL', name: 'English' },
        primaryLabel: 'ESL',
        secondaryLabel: '<script>alert(1)</script>',
        isOneOnOne: true,
        roleLabel: 'Teacher',
        studentName: 'Student One',
        attendanceLabel: 'Absent',
        regularHoursLabel: '—',
        optionalHoursLabel: '1.50',
        hoursIsStruck: false,
        showOptionalBadge: true,
        payableNote: '',
        scheduleLabel: '08:00 – 09:30',
        statusLabel: 'Completed',
        commentLabel: 'Printed comment'
      }]
    }, {
      date: '2026-07-16',
      dayName: 'Thu.',
      dateLabel: 'Jul. 16',
      holidayName: '',
      entries: []
    }],
    departmentTotals: {
      rows: [{
        departmentCode: 'EAL',
        departmentName: 'English',
        groupHours: 0,
        oneOnOneHours: 1.5,
        oneOnOneOptionalHours: 1.5,
        groupPendingHours: 0,
        oneOnOnePendingHours: 0,
        totalHours: 1.5
      }],
      totals: {
        groupHours: 0,
        oneOnOneHours: 1.5,
        oneOnOneOptionalHours: 1.5,
        groupPendingHours: 0,
        oneOnOnePendingHours: 0,
        totalHours: 1.5
      }
    },
    ...overrides
  };
}

test('print review type defaults to managerial and financial uses the same layout with a different subtitle', () => {
  assert.equal(printService.parsePrintReviewType('financial'), 'financial');
  assert.equal(printService.parsePrintReviewType('managerial'), 'managerial');
  assert.equal(printService.parsePrintReviewType(''), 'managerial');
  assert.equal(printService.resolvePrintReviewTitle('financial'), 'Financial Review');
  assert.equal(printService.resolvePrintReviewTitle('managerial'), 'Managerial Review');

  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /const printReviewType = timesheetPrintService\.parsePrintReviewType\(body\.printReviewType\)/);
  assert.match(controller, /String\(body\.printOrientation \|\| ''\)[\s\S]*?=== 'landscape'[\s\S]*?\? 'landscape'[\s\S]*?: 'portrait'/);
  assert.match(controller, /printReviewType:\s*printSettings\.printReviewType/);

  const viewPath = path.join(ROOT_DIR, 'packages/school/MVC/views/school/timesheet/timesheetPrint.ejs');
  const source = fs.readFileSync(viewPath, 'utf8');
  const financialHtml = ejs.render(source, {
    title: 'Timesheet Print',
    appBrand: { appName: 'Example Website' },
    printContext: {
      organizationName: 'Example School',
      printedByName: 'Printer User',
      printedAtLabel: 'Jul 15, 2026, 09:00 a.m.',
      printReviewType: 'financial',
      printReviewTitle: 'Financial Review',
      period: { name: '2026-JULY-02', startDateLabel: 'July 15, 2026', endDateLabel: 'July 31, 2026', deadlineLabel: '2026-07-30 23:59' },
      documents: [sampleDocument('Person One')]
    },
    printSettings: { orientation: 'landscape', density: 'compact' }
  }, { filename: viewPath });

  assert.match(financialHtml, /class="print-sheet-footer"/);
  assert.match(financialHtml, />Financial Review</);
  assert.match(financialHtml, /Hours\/Time \(Hrs\)/);
  assert.match(financialHtml, /Total Period Hours:/);
});

test('shapePrintEntry exposes split regular and optional hour labels without hrs suffix', () => {
  const shaped = printService.shapePrintEntry({
    sessionId: 'optional-row',
    classId: 'CLASS-1',
    classMaxCapacity: 1,
    deliveryDepartmentCode: 'ESL',
    durationHours: 1.5,
    timesheetHours: 0,
    showOptionalBadge: true,
    isOneOnOne: true,
    startTime: '08:00',
    endTime: '09:30'
  }, { classMap: new Map(), departmentMap: new Map() });

  assert.equal(shaped.regularHoursLabel, '—');
  assert.equal(shaped.optionalHoursLabel, '1.50');
  assert.equal(shaped.scheduleLabel, '08:00 – 09:30');
  assert.equal(shaped.regularDisplayHours, 0);
  assert.equal(shaped.optionalHours, 1.5);

  const pending = printService.shapePrintEntry({
    sessionId: 'pending-row',
    isManual: true,
    approvalStatus: 'pending_approval',
    requestedHours: 2.5
  }, { classMap: new Map(), departmentMap: new Map() });

  assert.equal(pending.regularHoursLabel, '2.50');
  assert.equal(pending.hoursIsStruck, true);
  assert.equal(pending.payableNote, '0.00 payable (pending)');
  assert.equal(pending.optionalHoursLabel, '—');
});

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
      printReviewType: 'managerial',
      printReviewTitle: 'Managerial Review',
      period: {
        name: '2026-JULY-02',
        startDateLabel: 'July 15, 2026',
        endDateLabel: 'July 31, 2026',
        deadlineLabel: '2026-07-30 23:59'
      },
      documents: [sampleDocument('Person One'), reconciliationDocument]
    },
    printSettings: {
      orientation: 'portrait',
      density: 'normal',
      includeOrg: true,
      orgName: 'Printed School Name',
      includeHeaderNote: true,
      headerNote: 'Payroll copy',
      requestedByLabel: 'Print Clerk'
    }
  }, { filename: viewPath });

  assert.equal((html.match(/class="print-sheet-frame"/g) || []).length, 2);
  assert.equal((html.match(/class="print-sheet"/g) || []).length, 2);
  assert.match(html, /@page \{ margin: 10mm; size: A4 portrait; \}/);
  assert.doesNotMatch(html, /size:\s*letter/i);
  assert.match(html, /html, body \{ width: 100%; max-width: 100%; min-width: 0; margin: 0; \}/);
  assert.match(html, /break-after: page/);
  assert.match(html, /class="screen-actions no-print"/);
  assert.match(html, /data-print-orientation="landscape"/);
  assert.match(html, /data-print-orientation="portrait"/);
  assert.match(html, /screen-actions-hint/);
  assert.match(html, /applyPrintOrientation/);
  assert.match(html, />Print<\/button>/);
  assert.doesNotMatch(html, /Print Again/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /Payroll copy/);
  assert.match(html, /<h1 class="document-title">Timesheet<\/h1>/);
  assert.match(html, /July 15, 2026 to July 31, 2026/);
  assert.match(html, /class="print-sheet-footer"/);
  assert.match(html, /Requested by: Print Clerk/);
  assert.match(html, />Managerial Review</);
  assert.doesNotMatch(html, /Printed School Name/);
  assert.doesNotMatch(html, /class="print-logo"/);
  assert.doesNotMatch(html, /2026-JULY-02/);
  assert.match(html, /Hours\/Time \(Hrs\)/);
  assert.match(html, />Regular</);
  assert.match(html, />Optional</);
  assert.match(html, /\.timesheet-table th\.col-hours-regular,[\s\S]*?font-size: 10px;[\s\S]*?white-space: nowrap;/);
  assert.match(html, /\.col-description \{ width: 39%; \}/);
  assert.match(html, /\.col-comment \{ width: 28%;/);
  assert.doesNotMatch(html, /<col class="col-status">/);
  assert.doesNotMatch(html, /<th class="col-status" rowspan="2">Status<\/th>/);
  assert.doesNotMatch(html, /<td class="col-status">/);
  assert.match(html, /<th class="col-comment" rowspan="2">Comment<\/th>/);
  assert.match(html, /class="date-day">Wed\.<\/div>\s*<div class="date-value">Jul\. 15<\/div>/);
  assert.doesNotMatch(html, /class="date-line"/);
  assert.doesNotMatch(html, /class="date-day">Wednesday<\/div>/);
  assert.match(html, /<tr class="no-log-row">\s*<td colspan="6" class="empty-row">[\s\S]*?<span class="no-log-row-date">Thu\. Jul\. 16<\/span>\s*<span class="no-log-row-note">No sessions logged\.<\/span>/);
  assert.match(html, /\.no-log-row td \{ border-left: 0; border-right: 0; padding: 6px 8px; \}/);
  assert.match(html, /class="badge status-badge">Completed<\/span>\s*<span class="comment-separator">-<\/span><span class="comment-text">Printed comment<\/span>/);
  assert.match(html, /class="session-department-line">\s*<span class="session-department-text">EAL<\/span>/);
  assert.match(html, /class="session-class-time-line">&lt;script&gt;alert\(1\)&lt;\/script&gt; - 08:00 – 09:30<\/div>/);
  assert.doesNotMatch(html, /class="schedule-label"/);
  assert.doesNotMatch(html, /class="primary-label"/);
  assert.match(html, /Total Period Hours:/);
  assert.match(html, /<td class="total-hours">0\.00<\/td>/);
  assert.match(html, /<td class="total-hours-optional">1\.50<\/td>/);
  assert.doesNotMatch(html, /Total Payable Hours/);
  assert.doesNotMatch(html, /class="badge optional-badge"/);
  assert.match(html, /Person One/);
  assert.match(html, /class="timesheet-table"/);
  assert.match(html, /<colgroup>/);
  assert.match(html, /print-fit-step-1/);
  assert.match(html, /190mm/);
  assert.match(html, /body\[data-print-orientation="portrait"\] \.print-sheet-frame \{/);
  assert.match(html, /width: calc\(210mm - 20mm\);/);
  assert.match(html, /height: calc\(297mm - 20mm\);/);
  assert.match(html, /size: A4 /);
  assert.match(html, /var layoutWidth = bounds\.width \/ Math\.max\(scale, 0\.01\);/);
  assert.match(html, /sheet\.style\.width = layoutWidth \+ 'px'/);
  assert.doesNotMatch(html, /sheet\.style\.width = \(bounds\.width \/ scale\) \+ 'px'/);
  assert.match(html, /var readableScaleFloor = 0\.86;/);
  assert.match(html, /Math\.max\(scale, readableScaleFloor\)/);
  assert.match(html, /frame\.dataset\.printOverflow = 'readable'/);
  assert.match(html, /frame\.style\.height = '';\s*frame\.style\.maxHeight = '';[\s\S]*?sheet\.style\.transform = '';[\s\S]*?return;/);
  assert.match(html, /\.print-sheet-frame\[data-print-overflow="readable"\] \{ overflow: visible; \}/);
  assert.match(html, /\.print-sheet-frame \{ width: 100%; max-width: 100%; margin: 0; padding: 0; overflow: visible; \}/);
  assert.match(html, /sheet\.style\.transform = 'scale\(' \+ scale\.toFixed\(4\) \+ '\)'/);
  assert.doesNotMatch(html, /scale\(1,\s*y\)/);
  assert.doesNotMatch(html, /allow a second printed page/);
  assert.match(html, /One on One/);
  assert.doesNotMatch(html, /class="badge optional-badge"/);
  assert.equal((html.match(/class="badge reconciliation-badge"/g) || []).length, 1);
  assert.match(html, />Scheduled<\/span>/);
  assert.match(html, />Reconciliation<\/span>/);
  assert.doesNotMatch(html, /Provisional - Scheduled/);
  assert.doesNotMatch(html, /Completed - Recheck/);
  assert.match(html, /Hours by Department/);
  assert.match(html, /class="department-name-row"/);
  assert.match(html, /class="department-hours-row"/);
  assert.match(html, /class="department-optional-row optional-row"/);
  assert.match(html, /Optional \(1:1\)/);
  assert.match(html, /<th scope="col">EAL<\/th>/);
  assert.match(html, /<th scope="col" class="department-total-col">Total<\/th>/);
  assert.doesNotMatch(html, /Total Optional Hours/);
  assert.doesNotMatch(html, /<th>Payable Hours<\/th>/);
  assert.match(html, /body \{ font-size: 15px; line-height: 1\.38; \}/);
  assert.match(html, /\.session-department-line \{ font-weight: 800; font-size: 15px; \}/);
  assert.match(html, /\.session-class-time-line \{[\s\S]*?font-size: 11\.5px;[\s\S]*?white-space: nowrap;[\s\S]*?word-break: normal;/);
  assert.match(html, /\.print-sheet\.print-fit-step-1 \.session-class-time-line \{ font-size: 11px; \}/);
  assert.match(html, /\.print-sheet\.print-fit-step-2 \.session-class-time-line \{ font-size: 10\.5px; \}/);
  assert.match(html, /\.holiday-label, \.secondary-label, \.cell-muted, \.payable-note, \.time-label \{ margin-top: 2px; font-size: 11\.5px; \}\s*\.comment-cell \{ font-size: 11\.5px; \}/);
  assert.match(html, /\.print-sheet\.print-fit-step-1 \.comment-cell \{ font-size: 11px; \}/);
  assert.match(html, /\.print-sheet\.print-fit-step-2 \.comment-cell \{ font-size: 10px; \}/);
  assert.match(html, /\.department-table th,\s*\.department-table td \{[\s\S]*?padding: 10px 9px;/);
  assert.match(html, /print-sheet-bottom/);
  assert.match(html, /print-sheet-main/);
  assert.match(html, /th, td \{ padding: 9px 8px; \}/);
  assert.doesNotMatch(html, /class="meta-grid"/);
  assert.doesNotMatch(html, /class="draft-warning"/);
  assert.doesNotMatch(html, /class="document-footer"/);
  assert.doesNotMatch(html, /Manager Approved/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, />Act</);
});

test('print department summary uses compact columns with totals on the right', () => {
  const viewPath = path.join(ROOT_DIR, 'packages/school/MVC/views/school/timesheet/timesheetPrint.ejs');
  const source = fs.readFileSync(viewPath, 'utf8');
  const html = ejs.render(source, {
    title: 'Timesheet Print',
    appBrand: { appName: 'Example Website' },
    printContext: {
      organizationName: 'Example School',
      printedByName: 'Printer User',
      printedAtLabel: 'Jul 15, 2026, 09:00 a.m.',
      period: { name: '2026-JULY-02', startDateLabel: 'July 15, 2026', endDateLabel: 'July 31, 2026', deadlineLabel: '2026-07-30 23:59' },
      documents: [sampleDocument('Person One', {
        departmentTotals: {
          rows: [
            {
              departmentName: 'EAL',
              groupHours: 33,
              oneOnOneHours: 10,
              oneOnOneOptionalHours: 1.5,
              groupPendingHours: 0,
              oneOnOnePendingHours: 0,
              totalHours: 43
            },
            {
              departmentName: 'LINC',
              groupHours: 6,
              oneOnOneHours: 0,
              oneOnOneOptionalHours: 0,
              groupPendingHours: 2,
              oneOnOnePendingHours: 0,
              totalHours: 8
            },
            {
              departmentName: 'Settlement',
              groupHours: 4,
              oneOnOneHours: 0,
              oneOnOneOptionalHours: 0.5,
              groupPendingHours: 0,
              oneOnOnePendingHours: 0,
              totalHours: 4
            }
          ],
          totals: {
            groupHours: 43,
            oneOnOneHours: 10,
            oneOnOneOptionalHours: 2,
            groupPendingHours: 2,
            oneOnOnePendingHours: 0,
            totalHours: 55
          }
        }
      })]
    },
    printSettings: { orientation: 'landscape', density: 'compact' }
  }, { filename: viewPath });

  assert.match(html, /<th scope="col">EAL<\/th>[\s\S]*<th scope="col">LINC<\/th>[\s\S]*<th scope="col">Settlement<\/th>[\s\S]*<th scope="col" class="department-total-col">Total<\/th>/);
  assert.match(html, /<th scope="row" class="department-metric-label">Group<\/th>[\s\S]*<td>33\.00<\/td>[\s\S]*<td>6\.00<\/td>[\s\S]*<td>4\.00<\/td>[\s\S]*<td class="department-total-col">43\.00<\/td>/);
  assert.match(html, /<th scope="row" class="department-metric-label">One-on-One<\/th>[\s\S]*<td>10\.00<\/td>[\s\S]*<td>0\.00<\/td>[\s\S]*<td>0\.00<\/td>[\s\S]*<td class="department-total-col">10\.00<\/td>/);
  assert.match(html, /class="department-optional-row optional-row">[\s\S]*<td>1\.50<\/td>[\s\S]*<td>—<\/td>[\s\S]*<td>0\.50<\/td>[\s\S]*<td class="department-total-col">2\.00<\/td>/);
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
  assert.match(editor, /AppPrintManager\.openSettings/);
  assert.match(editor, /orientation:\s*'portrait'/);
  assert.match(editor, /openTimesheetReviewTypeChooser/);
  assert.match(editor, /appendSettingsToSearchParams/);
  assert.match(editor, /window\.open\('', '_blank', 'height=720,width=1100'\)/);
  assert.match(editor, /fetch\(TIMESHEET_PRINT_ACTION/);
  assert.match(editor, /printWindow\.document\.write\(html\)/);
  assert.match(editor, /printWindow\.print\(\)/);
  assert.doesNotMatch(editor, /btnPrintTimesheet[\s\S]{0,250}type="submit"/);
  assert.doesNotMatch(editor, /btnPrintTimesheet[\s\S]{0,500}Processing/);
});

test('timesheet management page exposes selection print and disables generic table print', () => {
  const manage = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /showTimesheetManagement[\s\S]*?canPrintManagedTimesheets/);
  assert.match(controller, /showTimesheetManagement[\s\S]*?print:\s*false/);
  assert.match(controller, /showTimesheetManagement[\s\S]*?includePrintManager:\s*true/);
  assert.match(manage, /timesheetSelectAllVisible/);
  assert.match(manage, /timesheet-print-select/);
  assert.match(manage, /btnPrintSelectedTimesheets/);
  assert.match(manage, /btn btn-filled btn-edit btn-md me-2 mb-2/);
  assert.match(manage, /optionalBtnsBeforePrint/);
  assert.match(manage, /TIMESHEET_MANAGE_PRINT_ACTION = '\/school\/timesheets\/manage\/print'/);
  assert.match(manage, /openSelectedTimesheetPrintPreview/);
  assert.match(manage, /openTimesheetReviewTypeChooser/);
  assert.match(manage, /AppPrintManager\.openSettings/);
  assert.match(manage, /orientation:\s*'portrait'/);
  assert.match(manage, /appendSettingsToSearchParams/);
  assert.match(manage, /printReviewType/);
  assert.match(manage, /isPrintableRow/);
  assert.match(manage, /submitted.*processed|processed.*submitted/);
  assert.doesNotMatch(manage, /printTableBtn/);
});

test('managed print rejects non-printable timesheet statuses', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /exports\.printManagedTimesheets[\s\S]*?timesheetByPersonId/);
  assert.match(controller, /Only submitted or processed timesheets can be printed/);
  assert.match(controller, /function isEditorTimesheetPrintRequest/);
  assert.match(controller, /allowDraftEditorPrint/);
  assert.match(controller, /normalizeTimesheetLifecycle\(row\)/);
});
