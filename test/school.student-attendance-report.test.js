const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const studentAttendanceReportService = require('../packages/school/MVC/services/school/studentAttendanceReportService');

test('buildDateRangeDays returns inclusive calendar days', () => {
  const days = studentAttendanceReportService.buildDateRangeDays('2026-01-01', '2026-01-03');
  assert.deepEqual(days, ['2026-01-01', '2026-01-02', '2026-01-03']);
});

test('buildClassDayCells marks missing class sessions as no-session days', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const rollupRecords = [{
    sessionId: 'SES-1',
    date: '2026-01-02',
    status: 'present',
    comments: []
  }];
  const cells = studentAttendanceReportService.buildClassDayCells(days, rollupRecords);
  assert.equal(cells.length, 3);
  assert.equal(cells[0].hasSession, false);
  assert.equal(cells[1].hasSession, true);
  assert.equal(cells[1].status, 'present');
  assert.equal(cells[2].hasSession, false);
});

test('buildClassDayCells detects notes on session records', () => {
  const cells = studentAttendanceReportService.buildClassDayCells(['2026-01-01'], [{
    sessionId: 'SES-1',
    date: '2026-01-01',
    status: 'late',
    rosterStudentNotes: 'Doctor note',
    comments: []
  }]);
  assert.equal(cells[0].notesExist, true);
});

test('buildClassDayCells serializes comments and detail fields', () => {
  const cells = studentAttendanceReportService.buildClassDayCells(['2026-01-01'], [{
    sessionId: 'SES-1',
    date: '2026-01-01',
    status: 'absent',
    absenceExcused: true,
    lateMinutes: 5,
    lateExcused: true,
    excuseRef: 'Medical',
    excuseAttachment: { name: 'note.pdf', url: '/files/note.pdf' },
    comments: [{
      authorName: 'Admin',
      text: 'Approved',
      timestamp: '2026-01-01T10:00:00Z',
      mentions: [{ id: 'U1', name: 'Teacher' }]
    }],
    sessionLocked: true,
    scheduledMinutes: 60
  }]);
  assert.equal(cells[0].excuseRef, 'Medical');
  assert.equal(cells[0].lateMinutes, 5);
  assert.equal(cells[0].lateExcused, true);
  assert.equal(cells[0].sessionLocked, true);
  assert.equal(cells[0].scheduledMinutes, 60);
  assert.equal(cells[0].comments.length, 1);
  assert.equal(cells[0].comments[0].authorName, 'Admin');
  assert.equal(cells[0].comments[0].mentions[0].name, 'Teacher');
  assert.equal(cells[0].excuseAttachment.name, 'note.pdf');
});

test('filterReportDaysWithSessionForStudent returns all days when hide flag is off', () => {
  const allDays = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const student = {
    classes: [{
      days: [
        { date: '2026-01-02', hasSession: true },
        { date: '2026-01-01', hasSession: false },
        { date: '2026-01-03', hasSession: false }
      ]
    }]
  };
  const result = studentAttendanceReportService.filterReportDaysWithSessionForStudent(student, allDays, {
    hideDaysWithoutSession: false
  });
  assert.deepEqual(result, allDays);
  assert.notEqual(result, allDays);
});

test('filterReportDaysWithSessionForStudent keeps days with any class session', () => {
  const allDays = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const student = {
    classes: [{
      days: [
        { date: '2026-01-01', hasSession: false },
        { date: '2026-01-02', hasSession: true },
        { date: '2026-01-03', hasSession: false }
      ]
    }]
  };
  const result = studentAttendanceReportService.filterReportDaysWithSessionForStudent(student, allDays, {
    hideDaysWithoutSession: true
  });
  assert.deepEqual(result, ['2026-01-02']);
});

test('filterReportDaysWithSessionForStudent unions sessions across classes', () => {
  const allDays = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const student = {
    classes: [
      {
        days: [
          { date: '2026-01-01', hasSession: true },
          { date: '2026-01-02', hasSession: false },
          { date: '2026-01-03', hasSession: false }
        ]
      },
      {
        days: [
          { date: '2026-01-01', hasSession: false },
          { date: '2026-01-02', hasSession: false },
          { date: '2026-01-03', hasSession: true }
        ]
      }
    ]
  };
  const result = studentAttendanceReportService.filterReportDaysWithSessionForStudent(student, allDays, {
    hideDaysWithoutSession: true
  });
  assert.deepEqual(result, ['2026-01-01', '2026-01-03']);
});

test('getWeekStartKeyForDate returns Monday for Monday-start weeks', () => {
  assert.equal(studentAttendanceReportService.getWeekStartKeyForDate('2026-01-05'), '2026-01-05');
  assert.equal(studentAttendanceReportService.getWeekStartKeyForDate('2026-01-11'), '2026-01-05');
  assert.equal(studentAttendanceReportService.getWeekStartKeyForDate('2026-01-12'), '2026-01-12');
});

test('buildWeekBoundaryFlagsForDays marks new week columns after the first day', () => {
  assert.deepEqual(
    studentAttendanceReportService.buildWeekBoundaryFlagsForDays(['2026-01-05', '2026-01-06', '2026-01-07']),
    [false, false, false]
  );
  assert.deepEqual(
    studentAttendanceReportService.buildWeekBoundaryFlagsForDays(['2026-01-09', '2026-01-10', '2026-01-11', '2026-01-12']),
    [false, false, false, true]
  );
  assert.deepEqual(studentAttendanceReportService.buildWeekBoundaryFlagsForDays([]), []);
});

test('student attendance report viewer wires week separators toggle and toolbar layout', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /id="btn_sarWeekSeparators"/);
  assert.match(view, /sarShowWeekSeparators/);
  assert.match(view, /sar-week-boundary/);
  assert.match(view, /sar-week-separators-on/);
  assert.match(view, /setSarWeekSeparators/);
  const collapseIdx = view.indexOf('id="btn_collapseAllStudents"');
  const historyIdx = view.indexOf('id="btn_sarAttendanceHistory"');
  assert.ok(collapseIdx > -1 && historyIdx > -1 && collapseIdx < historyIdx);
});

test('filterReportDaysWithSessionForStudent drops day only when no class has session', () => {
  const allDays = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const student = {
    classes: [
      {
        days: [
          { date: '2026-01-01', hasSession: false },
          { date: '2026-01-02', hasSession: true },
          { date: '2026-01-03', hasSession: false }
        ]
      },
      {
        days: [
          { date: '2026-01-01', hasSession: false },
          { date: '2026-01-02', hasSession: false },
          { date: '2026-01-03', hasSession: false }
        ]
      }
    ]
  };
  const result = studentAttendanceReportService.filterReportDaysWithSessionForStudent(student, allDays, {
    hideDaysWithoutSession: true
  });
  assert.deepEqual(result, ['2026-01-02']);
});

test('student attendance report viewer wires hide days without sessions toggle', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /id="btn_sarHideDaysWithoutSession"/);
  assert.match(view, /sarHideDaysWithoutSession/);
  assert.match(view, /filterReportDaysWithSessionForStudent/);
  assert.match(view, /visibleDays/);
  assert.match(view, /renderStudentReportSections/);
});

test('student attendance report header shortcut targets reports dashboard', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /school-navigator-reports-dashboard/);
  assert.match(view, /\/dashboard\/section-nav\/SCHOOL_REPORTS/);
  assert.doesNotMatch(view, /SCHOOL_ACADEMIA/);
  assert.match(view, /aria-keyshortcuts="Alt\+Shift\+R"/);
});

test('student attendance report export modal sends selected overall template ids', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /js-sar-overall-template-select/);
  assert.match(view, /overallTemplateId/);
  assert.match(view, /getOverallOptionsForStudent/);
  assert.match(view, /getEligibleOverallOptionsForStudent/);
  assert.match(view, /plan\.overallReportTemplates/);
});
