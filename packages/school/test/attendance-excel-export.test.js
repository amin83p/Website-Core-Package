const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const ROOT_DIR = path.resolve(__dirname, '..');
const attendanceExcelExportService = require('../MVC/services/school/attendanceExcelExportService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function noteText(cell) {
  if (typeof cell.note === 'string') return cell.note;
  return String(cell.note?.texts?.map((t) => t.text).join('') || '');
}

test('attendance viewer uses shared Export button look and wires xlsx after load', () => {
  const viewer = read('MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(viewer, /btn_exportAttendanceExcel/);
  assert.match(viewer, /btn-filled btn-success/);
  assert.match(viewer, /bi-cloud-download/);
  assert.match(viewer, />\s*Export\s*</);
  assert.doesNotMatch(viewer, /Export Excel/);
  assert.match(viewer, /btn_printAttendanceMatrix/);
  assert.match(viewer, /exportAttendanceExcel\(/);
  assert.match(viewer, /\/school\/attendances\/api\/export\.xlsx/);
  assert.match(viewer, /personIds/);
  assert.match(viewer, /getAttendanceVisiblePersonIds/);
  assert.match(viewer, /exportBtn\.disabled = !enabled/);
});

test('attendance routes expose export.xlsx with same admin gate as matrix data', () => {
  const routes = read('MVC/routes/attendanceRoutes.js');
  assert.match(routes, /\/api\/export\.xlsx/);
  assert.match(routes, /exportAttendanceExcel/);
  assert.match(routes, /requireAttendanceMatrixPolicyAdmin\(\)/);
});

test('matrix payload builder enriches enrollment dates and CLB maps', () => {
  const controller = read('MVC/controllers/school/attendanceController.js');
  assert.match(controller, /enrollmentStartDate/);
  assert.match(controller, /enrollmentEndDate/);
  assert.match(controller, /funderType/);
  assert.match(controller, /authorEmail/);
  assert.match(controller, /enrichAttendanceComments/);
  assert.match(controller, /clbCurrent/);
  assert.match(controller, /clbGoal/);
  assert.match(controller, /resolveEnrollmentDatesForPerson/);
  assert.match(controller, /resolveClbMapsForStudent/);
  assert.match(controller, /getLatestClbLevelEntry/);
});

test('legend includes only class-enabled statuses and omits disabled optional ones', () => {
  const mandatoryOnly = attendanceExcelExportService.buildLegendEntries([
    'present',
    'absent',
    'not_applicable'
  ]);
  assert.deepEqual(
    mandatoryOnly.map((row) => row.code),
    ['P', 'A', 'N/A']
  );
  assert.equal(mandatoryOnly.some((row) => row.code === 'L'), false);
  assert.equal(mandatoryOnly.some((row) => row.code === 'E'), false);
  assert.equal(mandatoryOnly.some((row) => row.code === 'ACF'), false);

  const withOptional = attendanceExcelExportService.buildLegendEntries([
    'present',
    'late',
    'excused',
    'absent',
    'acf',
    'not_applicable'
  ]);
  assert.deepEqual(
    withOptional.map((row) => `${row.code}:${row.label}`),
    [
      'P:Present',
      'L:Late',
      'E:Excused',
      'A:Absent',
      'ACF:Absent Camera Off',
      'N/A:Not Applicable'
    ]
  );
});

test('title includes month when range is same month, otherwise start–end dates', () => {
  assert.equal(
    attendanceExcelExportService.resolveAttendanceTitle({
      startDate: '2026-07-01',
      endDate: '2026-07-31'
    }),
    'Attendance July 2026 (1–31)'
  );
  assert.equal(
    attendanceExcelExportService.resolveAttendanceTitle({
      startDate: '2026-06-15',
      endDate: '2026-07-14'
    }),
    'Attendance 15 Jun 2026 – 14 Jul 2026'
  );
  assert.equal(
    attendanceExcelExportService.resolveAttendanceTitle({
      sessions: [{ date: '2026-03-10' }, { date: '2026-03-20' }]
    }),
    'Attendance March 2026 (10–20)'
  );
});

test('day-cell codes and fills use Fatima-derived palette', () => {
  assert.equal(attendanceExcelExportService.statusToExportCode('present'), 'P');
  assert.equal(attendanceExcelExportService.statusToExportCode('absent'), 'A');
  assert.equal(attendanceExcelExportService.statusToExportCode('not_applicable'), 'N/A');
  assert.equal(attendanceExcelExportService.statusToExportCode('late'), 'L');
  assert.equal(attendanceExcelExportService.statusToExportCode('excused'), 'E');
  assert.equal(attendanceExcelExportService.statusToExportCode('acf'), 'ACF');
  assert.equal(attendanceExcelExportService.statusToExportCode(''), '');
  assert.equal(attendanceExcelExportService.statusToExportCode(null), '');
  assert.equal(attendanceExcelExportService.statusFillArgb('present'), 'FFA9CE91');
  assert.equal(attendanceExcelExportService.statusFillArgb('late'), 'FFFFC000');
  assert.equal(attendanceExcelExportService.statusFillArgb('excused'), 'FF0DCAF0');
  assert.equal(attendanceExcelExportService.statusFillArgb('absent'), 'FFFF0000');
  assert.equal(attendanceExcelExportService.statusFillArgb('acf'), 'FFED7D31');
  assert.equal(attendanceExcelExportService.statusFillArgb('not_applicable'), 'FFD9D9D9');
  assert.equal(attendanceExcelExportService.statusFillArgb(''), '');
  assert.equal(
    attendanceExcelExportService.statusFillArgb('not_applicable', { forLegend: true }),
    'FFD9D9D9'
  );
  assert.equal(attendanceExcelExportService.HEADER_FILL_ARGB, 'FF5B9BD5');
  assert.equal(attendanceExcelExportService.WEEKDAY_FILL_ARGB, 'FFFBE5D6');
});

test('Late and Excused details enrich day-cell notes with author names', () => {
  assert.equal(
    attendanceExcelExportService.buildLateExcusedCommentFragment({
      status: 'late',
      date: '2026-07-20',
      lateMinutes: 15
    }),
    'Jul 20 Late 15m'
  );
  assert.equal(
    attendanceExcelExportService.buildLateExcusedCommentFragment({
      status: 'excused',
      date: '2026-07-20',
      excuseRef: 'doctor note'
    }),
    'Jul 20 Excused doctor note'
  );

  const lateNote = attendanceExcelExportService.buildCellNoteText({
    status: 'late',
    date: '2026-07-20',
    lateMinutes: 10,
    rosterStudentNotes: 'traffic',
    comments: [{
      authorName: 'Jane Admin',
      authorEmail: 'jane@school.org',
      mentions: [{ id: 'u2', name: 'Bob Teacher', email: 'bob@school.org' }],
      text: 'Please follow up'
    }]
  }, {
    receiverName: 'Foroozan Haidari',
    receiverEmail: 'foroozan@example.com'
  });
  assert.match(lateNote, /Jul 20 Late 10m/);
  assert.match(lateNote, /traffic/);
  assert.match(lateNote, /From: Jane Admin <jane@school\.org>/);
  assert.match(lateNote, /To: Bob Teacher <bob@school\.org>/);
  assert.match(lateNote, /Please follow up/);

  assert.equal(
    attendanceExcelExportService.buildStatusNoteText({
      status: 'late',
      date: '2026-07-20',
      lateMinutes: 10,
      rosterStudentNotes: 'traffic',
      comments: [{ authorName: 'Jane Admin', text: 'Please follow up' }]
    }),
    'Jul 20 Late 10m\n\ntraffic'
  );

  const threaded = attendanceExcelExportService.buildThreadedMessagesForRecord({
    status: 'late',
    date: '2026-07-20',
    lateMinutes: 10,
    rosterStudentNotes: 'traffic',
    comments: [{
      authorName: 'Jane Admin',
      authorEmail: 'jane@school.org',
      mentions: [{ id: 'u2', name: 'Bob Teacher', email: 'bob@school.org' }],
      text: 'Please follow up'
    }]
  }, {
    receiverName: 'Foroozan Haidari',
    receiverEmail: 'foroozan@example.com'
  });
  assert.equal(threaded.length, 1);
  assert.match(threaded[0].text, /Jul 20 Late 10m/);
  assert.match(threaded[0].text, /From: Jane Admin <jane@school\.org>/);
  assert.equal(threaded[0].authorEmail, 'jane@school.org');

  const excusedNote = attendanceExcelExportService.buildCellNoteText({
    status: 'excused',
    date: '2026-07-21',
    comments: [{
      authorName: 'Jane Admin',
      authorEmail: 'jane@school.org',
      text: 'family emergency'
    }]
  }, {
    receiverName: 'Foroozan Haidari',
    receiverEmail: 'foroozan@example.com'
  });
  assert.match(excusedNote, /Jul 21 Excused/);
  assert.match(excusedNote, /From: Jane Admin <jane@school\.org>/);
  assert.match(excusedNote, /To: Foroozan Haidari <foroozan@example\.com>/);
  assert.match(excusedNote, /family emergency/);

  assert.equal(
    attendanceExcelExportService.formatCommentAsCommunication({
      authorName: 'A',
      authorEmail: 'a@x.com',
      mentions: [{ name: 'B', email: 'b@x.com' }],
      text: 'hello'
    }),
    'From: A <a@x.com>\nTo: B <b@x.com>\nhello'
  );

  assert.equal(
    attendanceExcelExportService.buildCellNoteText({
      status: 'present',
      date: '2026-07-22'
    }),
    ''
  );
});

test('Att % formatter includes performance percent and per-status counts', () => {
  assert.equal(
    attendanceExcelExportService.formatAttendancePercentCell(
      { performancePercent: 87.5 },
      [
        { status: 'present' },
        { status: 'present' },
        { status: 'present' },
        { status: 'late' },
        { status: 'absent' },
        { status: 'absent' },
        { status: 'not_applicable' }
      ]
    ),
    '87.5%\nP(3)/L(1)/E(0)/A(2)/ACF(0)/N(1)'
  );
  assert.equal(
    attendanceExcelExportService.formatAttendancePercentCell({}, []),
    '—\nP(0)/L(0)/E(0)/A(0)/ACF(0)/N(0)'
  );
  assert.deepEqual(
    attendanceExcelExportService.countStatusesFromRecords([
      { status: 'excused' },
      { status: 'acf' }
    ]),
    {
      present: 0,
      late: 0,
      excused: 1,
      absent: 0,
      acf: 1,
      not_applicable: 0
    }
  );
});

test('CLB and enrollment formatters include current, goal, start, and end', () => {
  assert.equal(
    attendanceExcelExportService.formatClbSkills({
      listening: '4',
      speaking: '4',
      reading: '4',
      writing: '4'
    }),
    'L4 S4 R4 W4'
  );
  assert.equal(
    attendanceExcelExportService.formatClbColumn({
      clbCurrent: { listening: '4', speaking: '4', reading: '4', writing: '4' },
      clbGoal: { listening: '5', speaking: '5', reading: '5', writing: '5' }
    }),
    'C: L4 S4 R4 W4\nG: L5 S5 R5 W5'
  );
  assert.equal(
    attendanceExcelExportService.formatClbColumn({
      clbCurrent: { listening: '4' },
      clbGoal: {}
    }),
    'C: L4'
  );
  assert.match(
    attendanceExcelExportService.formatEnrollmentStartEnd({
      enrollmentStartDate: '2026-01-15',
      enrollmentEndDate: '2026-07-24'
    }),
    /Start:.*15.*Jan.*26\nEnd:.*24.*Jul.*26/
  );
  assert.match(
    attendanceExcelExportService.formatEnrollmentStartEnd({
      enrollmentStartDate: '2026-01-15',
      enrollmentEndDate: '2026-07-24'
    }),
    /End:.*24.*Jul.*26/
  );
});

test('formatFunderType maps enrollment funder types', () => {
  assert.equal(attendanceExcelExportService.formatFunderType({ funderType: 'self' }), 'Self Fund');
  assert.equal(attendanceExcelExportService.formatFunderType({ funderType: 'funder' }), 'Funder');
  assert.equal(attendanceExcelExportService.formatFunderType({ funderId: 'self' }), 'Self Fund');
  assert.equal(attendanceExcelExportService.formatFunderType({ funderLabel: 'IRCC' }), 'IRCC');
});

test('filterMatrixByPersonIds keeps only requested students', () => {
  const payload = {
    matrix: [
      { personId: 'p1', name: 'A' },
      { personId: 'p2', name: 'B' },
      { personId: 'p3', name: 'C' }
    ]
  };
  assert.deepEqual(
    attendanceExcelExportService.filterMatrixByPersonIds(payload, 'p1,p3').matrix.map((s) => s.personId),
    ['p1', 'p3']
  );
  assert.deepEqual(
    attendanceExcelExportService.filterMatrixByPersonIds(payload, '').matrix,
    []
  );
  assert.equal(
    attendanceExcelExportService.filterMatrixByPersonIds(payload, null).matrix.length,
    3
  );
});

test('workbook layout: Att %, banding, title/class/teacher, Fatima fills, notes, CLBs', async () => {
  const { buffer, filename, legend, title } = await attendanceExcelExportService.buildAttendanceExcelWorkbook({
    className: 'EAL Morning',
    teacherName: 'Fatima Majoka',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    enabledAttendanceStatuses: ['present', 'late', 'excused', 'absent', 'not_applicable'],
    sessions: [
      { id: 's1', date: '2026-07-20' },
      { id: 's2', date: '2026-07-21' }
    ],
    matrix: [
      {
        firstName: 'Foroozan',
        lastName: 'Haidari',
        funderType: 'funder',
        email: 'foroozan@example.com',
        enrollmentStartDate: '2026-01-15',
        enrollmentEndDate: '2026-07-24',
        clbCurrent: { listening: '4', speaking: '4', reading: '4', writing: '4' },
        clbGoal: { listening: '5', speaking: '5', reading: '5', writing: '5' },
        summary: { performancePercent: 50 },
        records: [
          {
            sessionId: 's1',
            date: '2026-07-20',
            status: 'late',
            lateMinutes: 15,
            rosterStudentNotes: 'bus delay',
            comments: [{
              authorName: 'Jane Admin',
              authorEmail: 'jane@school.org',
              mentions: [{ id: 'u2', name: 'Bob Teacher', email: 'bob@school.org' }],
              text: 'Please follow up'
            }]
          },
          {
            sessionId: 's2',
            date: '2026-07-21',
            status: 'excused',
            excuseRef: 'appointment'
          }
        ]
      },
      {
        firstName: 'Jose',
        lastName: 'Alvarenga',
        funderType: 'self',
        email: 'jose@example.com',
        summary: { performancePercent: 0 },
        records: [
          { sessionId: 's1', date: '2026-07-20', status: 'absent' },
          { sessionId: 's2', date: '2026-07-21', status: 'absent' }
        ]
      }
    ]
  });

  assert.match(filename, /Attendance_EAL_Morning_2026-07-01_to_2026-07-31\.xlsx/);
  assert.equal(title, 'Attendance July 2026 (1–31)');
  assert.deepEqual(legend.map((row) => row.code), ['P', 'L', 'E', 'A', 'N/A']);
  assert.equal(legend.some((row) => row.code === 'ACF'), false);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];

  assert.equal(sheet.getCell(1, 1).value, 'P');
  assert.equal(sheet.getCell(1, 2).value, 'Present');
  assert.equal(sheet.getCell(1, 1).fill?.fgColor?.argb, 'FFA9CE91');
  assert.equal(sheet.getCell(1, 2).fill?.fgColor?.argb, 'FFA9CE91');
  assert.equal(sheet.getCell(1, 3).fill?.fgColor?.argb, 'FFA9CE91');
  assert.equal(sheet.getCell(2, 1).value, 'L');
  assert.equal(sheet.getCell(2, 1).fill?.fgColor?.argb, 'FFFFC000');
  assert.equal(sheet.getCell(3, 1).value, 'E');
  assert.equal(sheet.getCell(4, 1).value, 'A');
  assert.equal(sheet.getCell(4, 1).fill?.fgColor?.argb, 'FFFF0000');
  assert.equal(sheet.getCell(5, 1).value, 'N/A');
  assert.equal(sheet.getCell(5, 1).fill?.fgColor?.argb, 'FFD9D9D9');
  assert.equal(sheet.getCell(5, 2).fill?.fgColor?.argb, 'FFD9D9D9');
  assert.equal(sheet.getCell(5, 3).fill?.fgColor?.argb, 'FFD9D9D9');
  // Legend labels span # + Last Name (cols 2–3)
  const mergeKeys = [
    ...Object.keys(sheet._merges || {}),
    ...((sheet.model && sheet.model.merges) || [])
  ].map(String);
  assert.ok(mergeKeys.some((key) => /B1:C1/i.test(key)), `expected B1:C1 merge, got ${mergeKeys.join(',')}`);

  assert.equal(String(sheet.getCell(1, 5).value), 'Attendance July 2026 (1–31)');
  assert.equal(String(sheet.getCell(2, 5).value), 'Class: EAL Morning');
  assert.equal(String(sheet.getCell(3, 5).value), 'Teacher: Fatima Majoka');

  // legend (5) + blank => header at row 7
  assert.equal(sheet.getCell(7, 1).value, 'Funder');
  assert.equal(sheet.getCell(7, 1).fill?.fgColor?.argb, 'FF5B9BD5');
  assert.equal(sheet.getCell(7, 2).value, '#');
  assert.equal(sheet.getCell(7, 3).value, 'Last Name');
  assert.equal(sheet.getCell(7, 4).value, 'First Name');
  assert.equal(sheet.getCell(7, 5).value, 20);
  assert.equal(sheet.getCell(7, 6).value, 21);
  assert.equal(sheet.getCell(7, 7).value, 'Comment');
  assert.equal(sheet.getCell(7, 8).value, 'Start/End Date');
  assert.equal(sheet.getCell(7, 9).value, 'CLBs');
  assert.equal(sheet.getCell(7, 10).value, 'Att %');
  assert.ok(sheet.getCell(7, 1).border?.top);
  assert.ok(sheet.getCell(7, 10).border?.left);
  assert.equal(sheet.getCell(8, 5).value, 'Mon');
  assert.equal(sheet.getCell(8, 5).fill?.fgColor?.argb, 'FFFBE5D6');
  assert.equal(sheet.getCell(8, 6).value, 'Tue');

  assert.equal(sheet.getCell(9, 1).value, 'Funder');
  assert.equal(sheet.getCell(9, 2).value, 1);
  assert.equal(sheet.getCell(9, 3).value, 'Haidari');
  assert.equal(sheet.getCell(9, 4).value, 'Foroozan');
  assert.equal(sheet.getCell(9, 5).value, 'L');
  assert.equal(sheet.getCell(9, 6).value, 'E');
  assert.equal(sheet.getCell(9, 3).fill?.fgColor?.argb || null, null);
  assert.equal(sheet.getCell(9, 3).alignment?.vertical, 'middle');
  assert.notEqual(sheet.getCell(9, 3).alignment?.horizontal, 'center');
  assert.ok(sheet.getCell(9, 3).border?.bottom);
  assert.ok(sheet.getCell(9, 5).border?.top);

  const lateCell = sheet.getCell(9, 5);
  const excusedCell = sheet.getCell(9, 6);
  assert.equal(lateCell.fill?.fgColor?.argb, 'FFFFC000');
  assert.equal(excusedCell.fill?.fgColor?.argb, 'FF0DCAF0');

  // Admin Discussion uses threaded Comments (+ legacy bridge), not a normal Note author
  const lateNote = noteText(lateCell);
  if (lateNote) {
    assert.match(lateNote, /\[Threaded comment\]/);
    assert.match(lateNote, /Please follow up/);
  }
  assert.match(noteText(excusedCell), /Jul 21 Excused appointment/);
  assert.doesNotMatch(noteText(excusedCell), /Please follow up/);

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('xl/persons/person.xml'));
  assert.ok(zip.file('xl/threadedComments/threadedComment1.xml'));
  assert.ok(zip.file('xl/comments1.xml'));
  assert.ok(zip.file('xl/drawings/vmlDrawing1.vml'));
  const personXml = await zip.file('xl/persons/person.xml').async('string');
  const threadedXml = await zip.file('xl/threadedComments/threadedComment1.xml').async('string');
  const commentsXml = await zip.file('xl/comments1.xml').async('string');
  const vmlXml = await zip.file('xl/drawings/vmlDrawing1.vml').async('string');
  assert.match(personXml, /displayName="Jane Admin"/);
  assert.match(personXml, /userId="jane@school\.org"/);
  assert.match(threadedXml, /ref="E9"/);
  assert.match(threadedXml, /From: Jane Admin &lt;jane@school\.org&gt;/);
  assert.match(threadedXml, /To: Bob Teacher &lt;bob@school\.org&gt;/);
  assert.match(threadedXml, /Please follow up/);
  assert.match(threadedXml, /Jul 20 Late 15m/);
  assert.match(threadedXml, /bus delay/);

  // Legacy bridge Excel needs to show Comments in the UI
  assert.match(commentsXml, /tc=\{/);
  assert.match(commentsXml, /ref="E9"/);
  assert.match(commentsXml, /xr:uid="\{/);
  assert.match(commentsXml, /\[Threaded comment\]/);
  assert.match(commentsXml, /Please follow up/);
  // E9 => col 4 (0-based), row 8 (0-based)
  assert.match(vmlXml, /<x:Row>8<\/x:Row><x:Column>4<\/x:Column>/);

  const contentTypes = await zip.file('[Content_Types].xml').async('string');
  assert.match(contentTypes, /\/xl\/persons\/person\.xml/);
  assert.match(contentTypes, /\/xl\/threadedComments\/threadedComment1\.xml/);
  assert.match(contentTypes, /\/xl\/comments1\.xml/);
  const workbookRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  assert.match(workbookRels, /relationships\/person/);
  const sheetRels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels').async('string');
  assert.match(sheetRels, /relationships\/threadedComment/);
  assert.match(sheetRels, /relationships\/comments/);
  assert.match(sheetRels, /relationships\/vmlDrawing/);
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheetXml, /<legacyDrawing r:id="rId\d+"\/>/);

  assert.equal(String(sheet.getCell(9, 7).value || ''), '');

  const startEnd = String(sheet.getCell(9, 8).value || '');
  assert.match(startEnd, /Start:/);
  assert.match(startEnd, /End:/);
  assert.equal(String(sheet.getCell(9, 9).value), 'C: L4 S4 R4 W4\nG: L5 S5 R5 W5');
  assert.equal(sheet.getCell(9, 9).alignment?.wrapText, true);
  assert.match(String(sheet.getCell(9, 8).value || ''), /Start:.*\nEnd:/);
  assert.equal(sheet.getCell(9, 8).alignment?.wrapText, true);
  assert.notEqual(sheet.getCell(9, 5).font?.bold, true);
  assert.equal(String(sheet.getCell(9, 10).value), '50%\nP(0)/L(1)/E(1)/A(0)/ACF(0)/N(0)');
  assert.equal(sheet.getCell(9, 10).alignment?.vertical, 'middle');
  assert.notEqual(sheet.getCell(9, 10).alignment?.horizontal, 'center');
  assert.equal(sheet.getCell(9, 10).alignment?.wrapText, true);

  // second student row is banded
  assert.equal(sheet.getCell(10, 1).value, 'Self Fund');
  assert.equal(sheet.getCell(10, 2).value, 2);
  assert.equal(sheet.getCell(10, 3).value, 'Alvarenga');
  assert.equal(sheet.getCell(10, 3).fill?.fgColor?.argb, 'FFDDEBF7');
  assert.equal(String(sheet.getCell(10, 10).value), '0%\nP(0)/L(0)/E(0)/A(2)/ACF(0)/N(0)');
  assert.equal(sheet.getCell(10, 10).fill?.fgColor?.argb, 'FFDDEBF7');
  assert.ok(sheet.getCell(10, 10).border?.right);
  assert.equal(attendanceExcelExportService.ROW_BAND_FILL_ARGB, 'FFDDEBF7');
  // CLBs column width fits content (not a fixed oversized default)
  assert.ok(sheet.getColumn(9).width >= 12);
  assert.ok(sheet.getColumn(9).width <= 42);
});
