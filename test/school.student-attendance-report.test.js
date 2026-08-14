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
