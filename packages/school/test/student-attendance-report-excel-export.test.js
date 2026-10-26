const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..');
const attendanceExcelExportService = require('../MVC/services/school/attendanceExcelExportService');
const studentAttendanceReportService = require('../MVC/services/school/studentAttendanceReportService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function sampleClassPayload(className, sessionDate) {
  return {
    className,
    teacherName: 'Teacher One',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    enabledAttendanceStatuses: ['present', 'absent', 'not_applicable'],
    sessions: [{ id: 's1', date: sessionDate }],
    matrix: [{
      firstName: 'Ada',
      lastName: 'Lovelace',
      records: [{ sessionId: 's1', date: sessionDate, status: 'present' }],
      summary: { performancePercent: 100 }
    }]
  };
}

test('groupSessionsByCalendarMonth orders chunks chronologically', () => {
  const chunks = attendanceExcelExportService.groupSessionsByCalendarMonth([
    { id: 's2', date: '2026-10-05' },
    { id: 's1', date: '2026-09-28' }
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].monthKey, '2026-09');
  assert.equal(chunks[0].startDate, '2026-09-28');
  assert.equal(chunks[1].monthKey, '2026-10');
  assert.equal(chunks[1].startDate, '2026-10-05');
});

test('groupDatesByCalendarMonth groups and sorts date strings', () => {
  const chunks = attendanceExcelExportService.groupDatesByCalendarMonth([
    '2026-10-01',
    '2026-09-15',
    '2026-09-08'
  ]);
  assert.deepEqual(chunks.map((row) => row.monthKey), ['2026-09', '2026-10']);
  assert.deepEqual(chunks[0].dates, ['2026-09-08', '2026-09-15']);
  assert.deepEqual(chunks[1].dates, ['2026-10-01']);
});

test('shouldSplitAttendanceExportByMonth is true only for multiple chunks', () => {
  assert.equal(attendanceExcelExportService.shouldSplitAttendanceExportByMonth([]), false);
  assert.equal(attendanceExcelExportService.shouldSplitAttendanceExportByMonth([{ monthKey: '2026-09' }]), false);
  assert.equal(
    attendanceExcelExportService.shouldSplitAttendanceExportByMonth([
      { monthKey: '2026-09' },
      { monthKey: '2026-10' }
    ]),
    true
  );
});

test('sanitizeExcelSheetName enforces length and uniqueness', () => {
  const used = new Set();
  const first = attendanceExcelExportService.sanitizeExcelSheetName('Morning EAL Class A', used);
  const second = attendanceExcelExportService.sanitizeExcelSheetName('Morning EAL Class A', used);
  assert.ok(first.length <= 31);
  assert.notEqual(first, second);
  assert.match(second, /_2$/);
});

test('buildStudentAttendanceExcelWorkbook creates one sheet per class', async () => {
  const { buffer, filename } = await attendanceExcelExportService.buildStudentAttendanceExcelWorkbook([
    { payload: sampleClassPayload('Alpha Class', '2026-09-08'), sheetName: 'Alpha Class' },
    { payload: sampleClassPayload('Beta Class', '2026-09-09'), sheetName: 'Beta Class' }
  ], {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });

  assert.match(filename, /Attendance_Ada_Lovelace_/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.getWorksheet(1).name, 'Alpha Class');
  assert.equal(workbook.getWorksheet(2).name, 'Beta Class');
});

function cellValueAsText(cell) {
  if (cell?.value == null || cell.value === '') return '';
  if (Array.isArray(cell.value?.richText)) {
    return cell.value.richText.map((part) => part.text).join('');
  }
  return String(cell.value);
}

function collectWorksheetText(worksheet) {
  const parts = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellValueAsText(cell);
      if (text) parts.push(text);
    });
  });
  return parts.join('\n');
}

test('buildStudentAttendanceExcelWorkbook singleSheet stacks all classes on one worksheet', async () => {
  const { buffer } = await attendanceExcelExportService.buildStudentAttendanceExcelWorkbook([
    { payload: sampleClassPayload('Alpha Class', '2026-09-08'), sheetName: 'Alpha Class' },
    { payload: sampleClassPayload('Beta Class', '2026-09-09'), sheetName: 'Beta Class' }
  ], {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  }, {
    sheetLayout: 'singleSheet'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 1);
  const text = collectWorksheetText(workbook.getWorksheet(1));
  assert.match(text, /Class: Alpha Class/);
  assert.match(text, /Class: Beta Class/);
});

test('buildStudentAttendanceExcelWorkbook splits class matrix by calendar month on one sheet', async () => {
  const payload = {
    ...sampleClassPayload('Alpha Class', '2026-09-28'),
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    sessions: [
      { id: 's1', date: '2026-09-28' },
      { id: 's2', date: '2026-10-05' }
    ],
    matrix: [{
      firstName: 'Ada',
      lastName: 'Lovelace',
      records: [
        { sessionId: 's1', date: '2026-09-28', status: 'present' },
        { sessionId: 's2', date: '2026-10-05', status: 'late' }
      ],
      summary: { performancePercent: 100 }
    }]
  };

  const { buffer } = await attendanceExcelExportService.buildStudentAttendanceExcelWorkbook([
    { payload, sheetName: 'Alpha Class' }
  ], {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-10-31'
  }, {
    sheetLayout: 'singleSheet'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const text = collectWorksheetText(workbook.getWorksheet(1));
  assert.match(text, /Attendance September 2026 \(28–28\)/);
  assert.doesNotMatch(text, /Attendance October 2026/);
  assert.match(text, /\b28\b/);
  assert.match(text, /\b5\b/);
  const afterFirstMonthBody = text.split('P(1)/L(1)/E(0)/A(0)/ACF(0)/N(0)').pop();
  assert.doesNotMatch(afterFirstMonthBody, /Teacher: Teacher One/);
  assert.doesNotMatch(afterFirstMonthBody, /Attendance October 2026/);

  const sheet = workbook.getWorksheet(1);
  assert.equal(sheet.getColumn(5).width, 7);
});

test('multi-month student SAR uses roomier session columns than matrix export', async () => {
  const sessions = [];
  const records = [];
  for (let day = 1; day <= 12; day += 1) {
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    sessions.push({ id: `s${day}`, date });
    records.push({ sessionId: `s${day}`, date, status: 'present' });
  }
  sessions.push({ id: 'sOct', date: '2026-10-05' });
  records.push({ sessionId: 'sOct', date: '2026-10-05', status: 'present' });

  const payload = {
    className: 'Alpha Class',
    teacherName: 'Teacher One',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    enabledAttendanceStatuses: ['present', 'absent'],
    sessions,
    matrix: [{
      firstName: 'Ada',
      lastName: 'Lovelace',
      records,
      summary: { performancePercent: 100 }
    }]
  };

  const { buffer } = await attendanceExcelExportService.buildStudentAttendanceExcelWorkbook([
    { payload, sheetName: 'Alpha Class' }
  ], {}, { sheetLayout: 'singleSheet' });

  const matrixReference = await attendanceExcelExportService.buildAttendanceExcelWorkbook({
    ...payload,
    sessions: sessions.slice(0, 12),
    endDate: '2026-09-12'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const reference = new ExcelJS.Workbook();
  await reference.xlsx.load(matrixReference.buffer);

  const sheet = workbook.getWorksheet(1);
  const refSheet = reference.getWorksheet(1);
  assert.equal(refSheet.getColumn(5).width, 5);
  for (let col = 5; col <= 12; col += 1) {
    assert.equal(sheet.getColumn(col).width, 7);
  }
});

test('buildOfficialStudentAttendanceExcelWorkbook splits consolidated table by calendar month', async () => {
  const exportModel = {
    student: { name: 'Ada Lovelace' },
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    enabledAttendanceStatuses: ['present', 'absent', 'not_applicable'],
    unionSessionDates: ['2026-09-28', '2026-10-05'],
    classRows: [{
      className: 'Alpha Class',
      teacherName: 'Fatima Majoka',
      studentRow: {},
      sessionDateSet: new Set(['2026-09-28', '2026-10-05']),
      sessionsByDate: new Map([
        ['2026-09-28', { date: '2026-09-28', startTime: '09:00', endTime: '12:00' }],
        ['2026-10-05', { date: '2026-10-05', startTime: '09:00', endTime: '12:00' }]
      ]),
      recordsByDate: new Map([
        ['2026-09-28', { status: 'present', sessionId: 's1' }],
        ['2026-10-05', { status: 'present', sessionId: 's2' }]
      ])
    }]
  };

  const { buffer } = await attendanceExcelExportService.buildOfficialStudentAttendanceExcelWorkbook(exportModel, {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-10-31'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const text = collectWorksheetText(workbook.getWorksheet(1));
  assert.match(text, /Attendance Report - September 28, 2026 - September 28, 2026/);
  assert.doesNotMatch(text, /Attendance Report - October 05, 2026/);
  assert.match(text, /\b28\b/);
  assert.match(text, /\b5\b/);
  assert.equal(text.split('Not Applicable').length - 1, 1);
});

test('buildUnionSessionDatesFromExportEntries dedupes and sorts session dates', () => {
  const dates = studentAttendanceReportService.buildUnionSessionDatesFromExportEntries([
    { payload: { sessions: [{ date: '2026-09-09' }, { date: '2026-09-08' }] } },
    { payload: { sessions: [{ date: '2026-09-08' }] } }
  ]);
  assert.deepEqual(dates, ['2026-09-08', '2026-09-09']);
});

test('buildOfficialAppendixNoteText appends (Excused) for excused absent with attendance field', () => {
  const text = attendanceExcelExportService.buildOfficialAppendixNoteText({
    attendance: 'absent',
    absenceExcused: true,
    excuseRef: "Informed me yesterday that she had a doctor's appointment"
  });
  assert.match(text, /Excuse:/);
  assert.match(text, /\nExcused$/);
});

test('buildOfficialAppendixNoteText appends Excused for excused absence without excuse text', () => {
  const text = attendanceExcelExportService.buildOfficialAppendixNoteText({
    status: 'absent',
    absenceExcused: true
  });
  assert.equal(text, 'Excused');
});

test('buildOfficialAppendixNoteText appends (not excused) for unexcused absence', () => {
  const text = attendanceExcelExportService.buildOfficialAppendixNoteText({
    status: 'absent',
    absenceExcused: false,
    excuseRef: 'no call'
  });
  assert.match(text, /\(not excused\)$/);
});

test('formatOfficialClaimHeaderLine puts funder label before Claim Number', () => {
  assert.equal(
    studentAttendanceReportService.formatOfficialClaimHeaderLine([{ number: '791 8022', label: 'WCB' }]),
    'WCB Claim Number: 791 8022'
  );
  assert.equal(
    studentAttendanceReportService.formatOfficialClaimHeaderLine([
      { number: 'WCB-2', label: '' },
      { number: 'WCB-1', label: 'Primary' }
    ]),
    'Claim Number: WCB-2; Primary Claim Number: WCB-1'
  );
});

test('formatClaimNumbersDisplay joins number and label', () => {
  assert.equal(
    studentAttendanceReportService.formatClaimNumbersDisplay([{ number: '791 8022', label: 'WCB' }]),
    '791 8022 WCB'
  );
  assert.equal(
    studentAttendanceReportService.formatClaimNumbersDisplay([
      { number: 'WCB-2', label: '' },
      { number: 'WCB-1', label: 'Primary' }
    ]),
    'WCB-1 Primary, WCB-2'
  );
});

test('resolveClaimNumbersForEnrollmentPeriods collects distinct overlapping claims', () => {
  const numbers = studentAttendanceReportService.resolveClaimNumbersForEnrollmentPeriods({
    periodRows: [
      {
        studentId: 'stu-1',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        claimNumber: 'WCB-100'
      },
      {
        studentId: 'stu-1',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        claimSelectToken: 'WCB-200'
      }
    ],
    studentToPersonMap: new Map(),
    personId: 'stu-1',
    windowStart: '2026-09-01',
    windowEnd: '2026-10-31'
  });
  assert.deepEqual(numbers, ['WCB-100', 'WCB-200']);
});

test('resolveOfficialLegendLabelColumnWidth fits longest legend label', () => {
  const legend = attendanceExcelExportService.buildLegendEntries(['present', 'late', 'absent']);
  const width = attendanceExcelExportService.resolveOfficialLegendLabelColumnWidth(legend);
  assert.ok(width >= 16);
  assert.ok(width >= 'Late and left early'.length);
});

test('resolveOfficialClassColumnCWidth sizes column C from class names with fixed A and B', () => {
  const shortWidth = attendanceExcelExportService.resolveOfficialClassColumnCWidth([
    { className: 'AM PM', teacherName: '' }
  ]);
  const longWidth = attendanceExcelExportService.resolveOfficialClassColumnCWidth([
    { className: 'AM Low Intermediate Conversation Class', teacherName: '' }
  ]);
  assert.ok(longWidth > shortWidth);
  assert.ok(shortWidth >= 5);
});

test('formatOfficialExportClassName strips template tokens and teacher name', () => {
  assert.equal(
    attendanceExcelExportService.formatOfficialExportClassName('EAL-PM-I/G-JANE', 'Jane Doe'),
    'PM'
  );
  assert.equal(
    attendanceExcelExportService.formatOfficialExportClassName('EAL-AM-O/1-SAM', 'Sam'),
    'AM'
  );
});

test('buildSessionsByDateFromMatrixPayload maps session times by date', () => {
  const map = studentAttendanceReportService.buildSessionsByDateFromMatrixPayload({
    sessions: [
      { id: 's1', date: '2026-09-08', startTime: '09:00', endTime: '12:00' },
      { id: 's2', date: '2026-09-09', startTime: '13:30', endTime: '15:00' }
    ]
  });
  assert.equal(map.get('2026-09-08')?.startTime, '09:00');
  assert.equal(map.get('2026-09-09')?.endTime, '15:00');
});

test('formatOfficialTeacherShortName uses first name and surname initial', () => {
  assert.equal(
    attendanceExcelExportService.formatOfficialTeacherShortName('Fatima Majoka'),
    'Fatima M.'
  );
  assert.equal(attendanceExcelExportService.formatOfficialTeacherShortName('Sam'), 'Sam');
});

test('formatOfficialSessionDateHeading omits time unless requested', () => {
  const dateOnly = attendanceExcelExportService.formatOfficialSessionDateHeading('2026-09-08', {
    date: '2026-09-08',
    startTime: '09:00',
    endTime: '12:00'
  });
  assert.match(dateOnly, /Sep/);
  assert.doesNotMatch(dateOnly, /9:00/);
  assert.equal(
    attendanceExcelExportService.shouldIncludeTimeInOfficialAppendixNotes(
      new Map([
        ['2026-09-08', { startTime: '09:00', endTime: '12:00' }],
        ['2026-09-09', { startTime: '09:00', endTime: '12:00' }]
      ]),
      ['2026-09-08', '2026-09-09']
    ),
    false
  );
  assert.equal(
    attendanceExcelExportService.shouldIncludeTimeInOfficialAppendixNotes(
      new Map([
        ['2026-09-08', { startTime: '09:00', endTime: '12:00' }],
        ['2026-09-09', { startTime: '13:00', endTime: '15:00' }]
      ]),
      ['2026-09-08', '2026-09-09']
    ),
    true
  );
});

test('formatOfficialSessionDateTimeHeading includes date and session times', () => {
  const heading = attendanceExcelExportService.formatOfficialSessionDateTimeHeading('2026-09-08', {
    date: '2026-09-08',
    startTime: '09:00',
    endTime: '12:00'
  });
  assert.match(heading, /Sep/);
  assert.match(heading, /2026/);
  assert.match(heading, /9:00/);
  assert.match(heading, /12:00/);
});

test('buildOfficialStudentAttendanceExcelWorkbook uses class rows and union day columns', async () => {
  const exportModel = {
    student: { name: 'Ada Lovelace', email: 'ada@example.com' },
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    claimNumbersDisplay: '791 8022 WCB',
    claimHeaderDisplay: 'WCB Claim Number: 791 8022',
    enabledAttendanceStatuses: ['present', 'absent', 'not_applicable'],
    unionSessionDates: ['2026-09-08', '2026-09-09'],
    classRows: [
      {
        className: 'Alpha Class',
        teacherName: 'Fatima Majoka',
        studentRow: { funderType: 'wcb' },
        sessionDateSet: new Set(['2026-09-08', '2026-09-09']),
        sessionsByDate: new Map([
          ['2026-09-08', { date: '2026-09-08', startTime: '09:00', endTime: '12:00' }],
          ['2026-09-09', { date: '2026-09-09', startTime: '09:00', endTime: '12:00' }]
        ]),
        recordsByDate: new Map([
          ['2026-09-08', { status: 'present', sessionId: 's1' }],
          ['2026-09-09', {
            status: 'late',
            sessionId: 's2',
            excuseRef: 'medical appointment',
            lateMinutes: 12,
            lateExcused: true,
            rosterStudentNotes: 'arrived after intake'
          }]
        ])
      },
      {
        className: 'Beta Class',
        teacherName: 'Bob Teacher',
        studentRow: { funderType: 'ircc' },
        sessionDateSet: new Set(['2026-09-08']),
        sessionsByDate: new Map([
          ['2026-09-08', { date: '2026-09-08', startTime: '14:00', endTime: '16:00' }]
        ]),
        recordsByDate: new Map([
          ['2026-09-08', {
            status: 'absent',
            absenceExcused: true,
            sessionId: 's3',
            excuseRef: 'family matter'
          }]
        ])
      }
    ]
  };

  const { buffer } = await attendanceExcelExportService.buildOfficialStudentAttendanceExcelWorkbook(exportModel, {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.getWorksheet(1);
  assert.equal(sheet.name, 'Consolidated Attendance');
  const text = collectWorksheetText(sheet);
  assert.match(text, /Student: Ada Lovelace/);
  assert.match(text, /WCB Claim Number: 791 8022/);
  assert.match(text, /Attendance Report - September 01, 2026 - September 30, 2026/);
  assert.match(text, /Alpha Class/);
  assert.match(text, /Beta Class/);
  assert.match(text, /Attendance notes/);
  assert.match(text, /medical appointment/);
  assert.match(text, /family matter/);
  assert.match(text, /Excuse: family matter[\s\S]*\nExcused/);
  assert.doesNotMatch(text, /\nE\n/);
  assert.match(text, /Fatima M\./);
  assert.match(text, /Bob T\./);
  assert.match(text, /Alpha Class — .*9:00.*12:00/);

  let alphaClassNotesRow = null;
  let betaClassNotesRow = null;
  let combinedNoteCell = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = String(cell.value || '');
      const richFlat = Array.isArray(cell.value?.richText)
        ? cell.value.richText.map((part) => part.text).join('')
        : value;
      if (value === 'Alpha Class' || value.startsWith('Alpha Class —')) alphaClassNotesRow = rowNumber;
      if (value === 'Beta Class' || value.startsWith('Beta Class —')) betaClassNotesRow = rowNumber;
      if (richFlat.includes('medical appointment')) combinedNoteCell = cell;
    });
  });
  assert.ok(alphaClassNotesRow);
  assert.ok(betaClassNotesRow);
  assert.ok(betaClassNotesRow > alphaClassNotesRow);
  assert.equal(betaClassNotesRow - alphaClassNotesRow >= 2, true);
  assert.equal(
    sheet.getCell(alphaClassNotesRow, 1).font?.color?.argb,
    attendanceExcelExportService.OFFICIAL_APPENDIX_CLASS_COLOR_ARGB
  );
  assert.ok(combinedNoteCell);
  assert.ok(Array.isArray(combinedNoteCell.value?.richText));
  const combinedNoteFlat = combinedNoteCell.value.richText.map((part) => part.text).join('');
  assert.match(combinedNoteFlat, /Sep.*2026/);
  assert.doesNotMatch(combinedNoteFlat, /9:00/);
  assert.match(combinedNoteFlat, /medical appointment/);
  assert.doesNotMatch(combinedNoteFlat, /─{3}/);
  assert.doesNotMatch(combinedNoteFlat, /\n\n/);
  assert.match(combinedNoteFlat, /Excuse: medical appointment\nTiming: Late 12m Excused/);
  assert.equal(combinedNoteCell.value.richText.some((part) => part.font?.bold === true), true);
  assert.match(combinedNoteFlat, /arrived after intake/);
  assert.ok(combinedNoteCell.value.richText.length >= 2);
  assert.equal(
    combinedNoteCell.value.richText[0].font?.color?.argb,
    attendanceExcelExportService.OFFICIAL_APPENDIX_DATETIME_COLOR_ARGB
  );
  assert.equal(combinedNoteCell.value.richText[0].font?.bold, true);
  const noteBodyParts = combinedNoteCell.value.richText.slice(1);
  assert.ok(noteBodyParts.some((part) => part.font?.color?.argb === attendanceExcelExportService.OFFICIAL_APPENDIX_NOTE_COLOR_ARGB));
  assert.ok(betaClassNotesRow > alphaClassNotesRow + 2);
  let classDividerRow = null;
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber <= alphaClassNotesRow || rowNumber >= betaClassNotesRow) return;
    const fill = sheet.getCell(rowNumber, 1).fill?.fgColor?.argb;
    if (fill === attendanceExcelExportService.OFFICIAL_APPENDIX_CLASS_DIVIDER_FILL_ARGB) {
      classDividerRow = rowNumber;
    }
  });
  assert.ok(classDividerRow);
  assert.equal(sheet.getRow(classDividerRow).height, 5);
  assert.equal(combinedNoteCell.alignment?.vertical, 'top');
  assert.equal(combinedNoteCell.alignment?.horizontal, 'left');
  assert.equal(combinedNoteCell.border?.top, undefined);
  assert.doesNotMatch(text, /Comment/);
  assert.doesNotMatch(text, /CLBs/);
  assert.doesNotMatch(text, /Att %/);
  assert.doesNotMatch(text, /Funder/);
  assert.doesNotMatch(text, /Last Name/);

  let betaGridRowNumber = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (String(sheet.getCell(rowNumber, 1).value || '') === 'Beta Class') {
      betaGridRowNumber = rowNumber;
    }
  });
  assert.ok(betaGridRowNumber);
  let gridHeaderRow = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (sheet.getCell(rowNumber, 1).value === 'Class') gridHeaderRow = rowNumber;
  });
  assert.ok(gridHeaderRow);
  assert.equal(String(sheet.getCell(gridHeaderRow, 4).value), 'Teacher');
  assert.equal(String(sheet.getCell(gridHeaderRow + 2, 4).value), 'Fatima M.');
  assert.equal(sheet.getCell(1, 1).fill?.fgColor?.argb, 'FFA9CE91');
  assert.equal(sheet.getCell(1, 2).fill?.fgColor?.argb, 'FFA9CE91');
  assert.notEqual(sheet.getCell(1, 3).fill?.fgColor?.argb, 'FFA9CE91');
  const sep09Col = 6;
  const noClassCell = sheet.getCell(betaGridRowNumber, sep09Col);
  assert.equal(String(noClassCell.value), 'X');
});

test('buildOfficialStudentAttendanceExcelWorkbook omits teacher column when disabled', async () => {
  const exportModel = {
    student: { name: 'Ada Lovelace' },
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    enabledAttendanceStatuses: ['present'],
    unionSessionDates: ['2026-09-08', '2026-09-09'],
    classRows: [{
      className: 'Alpha Class',
      teacherName: 'Fatima Majoka',
      sessionDateSet: new Set(['2026-09-08']),
      recordsByDate: new Map([['2026-09-08', { status: 'present' }]])
    }]
  };

  const { buffer } = await attendanceExcelExportService.buildOfficialStudentAttendanceExcelWorkbook(exportModel, {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    includeTeacherName: false
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet(1);
  let gridHeaderRow = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (sheet.getCell(rowNumber, 1).value === 'Class') gridHeaderRow = rowNumber;
  });
  assert.ok(gridHeaderRow);
  assert.equal(String(sheet.getCell(gridHeaderRow, 1).value), 'Class');
  assert.equal(String(sheet.getCell(gridHeaderRow, 4).value), '8');
  assert.equal(String(sheet.getCell(gridHeaderRow, 5).value), '9');
  assert.doesNotMatch(collectWorksheetText(sheet), /Fatima M\./);
  assert.ok(sheet.getColumn(2).width >= 14);
  assert.equal(sheet.getColumn(1).width, 6);
  assert.ok(sheet.getColumn(3).width >= 5);
});

test('buildOfficialStudentAttendanceExcelWorkbook omits claim line when unavailable', async () => {
  const { buffer } = await attendanceExcelExportService.buildOfficialStudentAttendanceExcelWorkbook({
    student: { name: 'Ada Lovelace' },
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    claimNumbersDisplay: '',
    enabledAttendanceStatuses: ['present'],
    unionSessionDates: ['2026-09-08'],
    classRows: [{
      className: 'Alpha Class',
      sessionDateSet: new Set(['2026-09-08']),
      recordsByDate: new Map([['2026-09-08', { status: 'present' }]])
    }]
  }, {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const text = collectWorksheetText(workbook.getWorksheet(1));
  assert.doesNotMatch(text, /Claim Number/);
});

test('normalizeStudentExcelExportTemplate recognizes official template', () => {
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelExportTemplate('officialAttendanceReport'),
    attendanceExcelExportService.STUDENT_EXCEL_TEMPLATE_OFFICIAL
  );
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelExportTemplate(''),
    attendanceExcelExportService.STUDENT_EXCEL_TEMPLATE_CLASS_MATRIX
  );
});

test('normalizeStudentExcelSheetLayout accepts singleSheet alias', () => {
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelSheetLayout('singleSheet'),
    attendanceExcelExportService.STUDENT_EXCEL_SHEET_LAYOUT_SINGLE
  );
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelSheetLayout(''),
    attendanceExcelExportService.STUDENT_EXCEL_SHEET_LAYOUT_PER_CLASS
  );
});

test('attendance routes expose student report export-excel.xlsx', () => {
  const routes = read('MVC/routes/attendanceRoutes.js');
  assert.match(routes, /\/report\/api\/export-excel\.xlsx/);
  assert.match(routes, /exportStudentAttendanceReportExcel/);
  assert.match(
    routes,
    /\/report\/api\/export-excel\.xlsx[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCE_REPORT,\s*OPERATIONS\.READ\)/
  );
});

test('student attendance report viewer wires per-student matrix Excel export', () => {
  const viewer = read('MVC/views/school/attendance/studentAttendanceReportViewer.ejs');
  const controller = read('MVC/controllers/school/attendanceController.js');
  const exportService = read('MVC/services/school/studentAttendanceReportExcelExportService.js');
  assert.match(viewer, /js-sar-student-excel-export/);
  assert.match(viewer, /btn-filled btn-success/);
  assert.match(viewer, /bi-cloud-download/);
  assert.match(viewer, /exportStudentAttendanceExcel/);
  assert.match(viewer, /openSarExcelExportModal/);
  assert.match(viewer, /sarExcelExportModal/);
  assert.match(viewer, /sheetLayout/);
  assert.match(viewer, /exportTemplate/);
  assert.match(viewer, /officialAttendanceReport/);
  assert.match(viewer, /Consolidated Attendance Report/);
  assert.match(viewer, /sarExcelExportTemplateOfficial/);
  assert.match(viewer, /sarExcelOfficialTeacherOptions/);
  assert.match(viewer, /includeTeacherName/);
  assert.match(controller, /includeTeacherName/);
  assert.match(viewer, /\/school\/attendances\/report\/api\/export-excel\.xlsx/);
  assert.match(viewer, /showSarExcelExportWaiting/);
  assert.match(viewer, /fetch\(`\/school\/attendances\/report\/api\/export-excel\.xlsx/);
  assert.match(viewer, /canExportStudentMatrixExcel/);
  assert.match(controller, /sheetLayout/);
  assert.match(controller, /exportTemplate/);
  assert.match(exportService, /sheetLayout/);
  assert.match(exportService, /STUDENT_EXCEL_TEMPLATE_OFFICIAL/);
  assert.match(exportService, /buildOfficialStudentAttendanceExportModel/);
});
