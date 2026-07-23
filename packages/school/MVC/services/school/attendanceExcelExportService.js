// MVC/services/school/attendanceExcelExportService.js
const ExcelJS = require('exceljs');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceExcelThreadedComments = require('./attendanceExcelThreadedComments');

const {
  ATTENDANCE_STATUS,
  ALL_ATTENDANCE_STATUSES_ORDERED,
  normalizeAttendanceStatusForSave,
  normalizeEnabledAttendanceStatuses
} = attendanceMatrixMetricsService;

const STATUS_EXPORT_META = Object.freeze({
  [ATTENDANCE_STATUS.PRESENT]: { code: 'P', label: 'Present' },
  [ATTENDANCE_STATUS.ABSENT]: { code: 'A', label: 'Absent' },
  [ATTENDANCE_STATUS.NOT_APPLICABLE]: { code: 'N/A', label: 'Not Applicable' },
  [ATTENDANCE_STATUS.LATE]: { code: 'L', label: 'Late' },
  [ATTENDANCE_STATUS.EXCUSED]: { code: 'E', label: 'Excused' },
  [ATTENDANCE_STATUS.ACF]: { code: 'ACF', label: 'Absent Camera Off' }
});

/** Fatima-sample palette (ARGB). N/A uses light gray for both legend and cells. */
const STATUS_FILL_ARGB = Object.freeze({
  [ATTENDANCE_STATUS.PRESENT]: 'FFA9CE91',
  [ATTENDANCE_STATUS.LATE]: 'FFFFC000',
  [ATTENDANCE_STATUS.EXCUSED]: 'FF0DCAF0',
  [ATTENDANCE_STATUS.ABSENT]: 'FFFF0000',
  [ATTENDANCE_STATUS.ACF]: 'FFED7D31',
  [ATTENDANCE_STATUS.NOT_APPLICABLE]: 'FFD9D9D9'
});

const NA_DAY_FILL_ARGB = STATUS_FILL_ARGB[ATTENDANCE_STATUS.NOT_APPLICABLE];
const HEADER_FILL_ARGB = 'FF5B9BD5';
const WEEKDAY_FILL_ARGB = 'FFFBE5D6';
const ROW_BAND_FILL_ARGB = 'FFDDEBF7';
const DARK_TEXT_ARGB = 'FF000000';
const WHITE_TEXT_ARGB = 'FFFFFFFF';

const THIN_BLACK_BORDER = Object.freeze({
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } }
});

const CLB_SKILL_CODES = Object.freeze([
  ['listening', 'L'],
  ['speaking', 'S'],
  ['reading', 'R'],
  ['writing', 'W']
]);

const WEEKDAY_SHORT = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseDateOnly(value) {
  const token = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
  const parsed = new Date(`${token}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatShortMonthDay(dateValue) {
  const d = parseDateOnly(dateValue);
  if (!d) return clean(dateValue);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDisplayDate(dateValue) {
  const d = parseDateOnly(dateValue);
  if (!d) return clean(dateValue);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatCrossMonthDate(dateValue) {
  const d = parseDateOnly(dateValue);
  if (!d) return clean(dateValue);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function weekdayShort(dateValue) {
  const d = parseDateOnly(dateValue);
  if (!d) return '';
  return WEEKDAY_SHORT[d.getDay()] || '';
}

function dayOfMonth(dateValue) {
  const d = parseDateOnly(dateValue);
  if (!d) return '';
  return d.getDate();
}

function resolveExportRangeDates({ startDate, endDate, sessions = [] } = {}) {
  const sessionDates = (Array.isArray(sessions) ? sessions : [])
    .map((s) => clean(s?.date))
    .filter(Boolean)
    .sort();
  const start = clean(startDate) || sessionDates[0] || '';
  const end = clean(endDate) || sessionDates[sessionDates.length - 1] || start;
  return { startDate: start, endDate: end };
}

/**
 * Same calendar month: "Attendance July 2026 (1–31)"
 * Cross month/year: "Attendance 15 Jun 2026 – 14 Jul 2026"
 */
function resolveAttendanceTitle({ startDate, endDate, sessions = [] } = {}) {
  const range = resolveExportRangeDates({ startDate, endDate, sessions });
  const start = parseDateOnly(range.startDate);
  const end = parseDateOnly(range.endDate);
  if (!start && !end) return 'Attendance';
  if (start && !end) {
    const month = start.toLocaleDateString('en-US', { month: 'long' });
    return `Attendance ${month} ${start.getFullYear()} (${start.getDate()})`;
  }
  if (!start && end) {
    const month = end.toLocaleDateString('en-US', { month: 'long' });
    return `Attendance ${month} ${end.getFullYear()} (${end.getDate()})`;
  }
  const sameMonth = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth();
  if (sameMonth) {
    const month = start.toLocaleDateString('en-US', { month: 'long' });
    return `Attendance ${month} ${start.getFullYear()} (${start.getDate()}–${end.getDate()})`;
  }
  return `Attendance ${formatCrossMonthDate(range.startDate)} – ${formatCrossMonthDate(range.endDate)}`;
}

/** @deprecated use resolveAttendanceTitle */
function resolveTitleMonthYear(args) {
  return resolveAttendanceTitle(args);
}

function splitDisplayName(person = {}) {
  const firstName = clean(person.firstName || person.name?.first);
  const lastName = clean(person.lastName || person.name?.last);
  if (firstName || lastName) {
    return { firstName, lastName };
  }
  const display = clean(person.name || person.displayName);
  if (!display) return { firstName: '', lastName: '' };
  const parts = display.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1]
  };
}

function buildLegendEntries(enabledAttendanceStatuses = []) {
  const enabled = new Set(normalizeEnabledAttendanceStatuses(enabledAttendanceStatuses));
  return ALL_ATTENDANCE_STATUSES_ORDERED
    .filter((status) => enabled.has(status) && STATUS_EXPORT_META[status])
    .map((status) => ({
      status,
      code: STATUS_EXPORT_META[status].code,
      label: STATUS_EXPORT_META[status].label
    }));
}

function statusToExportCode(status) {
  const normalized = normalizeAttendanceStatusForSave(status, '');
  if (!normalized) return '';
  return STATUS_EXPORT_META[normalized]?.code || '';
}

function statusFillArgb(status, { forLegend = false } = {}) {
  const normalized = normalizeAttendanceStatusForSave(status, '');
  if (!normalized) return '';
  return STATUS_FILL_ARGB[normalized] || '';
}

function applySolidFill(cell, argb) {
  if (!argb) return;
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb }
  };
}

function applyTableCellBorder(cell) {
  cell.border = { ...THIN_BLACK_BORDER };
}

function applyVerticalMiddle(cell, { horizontal = null, wrapText = false } = {}) {
  const alignment = { vertical: 'middle' };
  if (horizontal) alignment.horizontal = horizontal;
  if (wrapText) alignment.wrapText = true;
  cell.alignment = alignment;
}

function applyLegendCellStyle(cell, status) {
  const fillArgb = statusFillArgb(status, { forLegend: true });
  if (fillArgb) applySolidFill(cell, fillArgb);
  cell.font = { size: 11, color: { argb: DARK_TEXT_ARGB }, name: 'Calibri' };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell);
}

function applyStatusCellStyle(cell, status) {
  const normalized = normalizeAttendanceStatusForSave(status, '');
  const fillArgb = statusFillArgb(normalized, { forLegend: false });
  if (fillArgb) applySolidFill(cell, fillArgb);
  cell.font = {
    bold: false,
    size: 11,
    color: { argb: DARK_TEXT_ARGB },
    name: 'Calibri'
  };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, { horizontal: 'center' });
}

function applyHeaderCellStyle(cell) {
  applySolidFill(cell, HEADER_FILL_ARGB);
  cell.font = { bold: true, size: 11, color: { argb: WHITE_TEXT_ARGB }, name: 'Calibri' };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, { horizontal: 'center' });
}

function applyWeekdayCellStyle(cell) {
  applySolidFill(cell, WEEKDAY_FILL_ARGB);
  cell.font = { size: 11, color: { argb: DARK_TEXT_ARGB }, name: 'Calibri' };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, { horizontal: 'center' });
}

function applyRowBandFill(cell) {
  applySolidFill(cell, ROW_BAND_FILL_ARGB);
}

function applyBodyMetaCellStyle(cell, { banded = false, center = false, wrapText = false } = {}) {
  if (banded) applyRowBandFill(cell);
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, {
    horizontal: center ? 'center' : null,
    wrapText
  });
}

function formatPersonContact({ name, email } = {}) {
  const displayName = clean(name);
  const displayEmail = clean(email);
  if (displayName && displayEmail) return `${displayName} <${displayEmail}>`;
  if (displayName) return displayName;
  if (displayEmail) return displayEmail;
  return '';
}

function resolveCommentReceivers(comment = {}, fallbackReceiver = null) {
  const mentions = Array.isArray(comment?.mentions) ? comment.mentions : [];
  const fromMentions = mentions
    .map((mention) => formatPersonContact({
      name: mention?.name || mention?.displayName || mention?.authorName,
      email: mention?.email || mention?.authorEmail
    }))
    .filter(Boolean);
  if (fromMentions.length) return fromMentions;
  const fallback = formatPersonContact(fallbackReceiver || {});
  return fallback ? [fallback] : [];
}

/** Format one admin comment as clear From/To communication. */
function formatCommentAsCommunication(comment = {}, { fallbackReceiver = null } = {}) {
  if (typeof comment === 'string') {
    const text = clean(comment);
    return text;
  }

  const text = clean(comment?.text || comment?.body);
  const sender = formatPersonContact({
    name: comment?.authorName || comment?.author,
    email: comment?.authorEmail || comment?.email
  });
  const receivers = resolveCommentReceivers(comment, fallbackReceiver);
  if (!text && !sender && !receivers.length) return '';

  const lines = [];
  if (sender) lines.push(`From: ${sender}`);
  if (receivers.length) lines.push(`To: ${receivers.join('; ')}`);
  if (text) lines.push(text);
  return lines.join('\n');
}

function collectRosterStatusNotes(record = {}) {
  const notes = [];
  const rosterNotes = clean(record.rosterStudentNotes || record.notes);
  if (rosterNotes) notes.push(rosterNotes);
  return notes;
}

function collectAdminDiscussionMessages(record = {}, { fallbackReceiver = null } = {}) {
  const comments = Array.isArray(record.comments) ? record.comments : [];
  return comments
    .map((comment) => {
      if (typeof comment === 'string') {
        const text = clean(comment);
        if (!text) return null;
        return {
          authorName: 'Attendance',
          authorEmail: '',
          text,
          timestamp: ''
        };
      }
      const formatted = formatCommentAsCommunication(comment, { fallbackReceiver });
      if (!formatted) return null;
      return {
        authorName: clean(comment?.authorName || comment?.author) || 'Attendance',
        authorEmail: clean(comment?.authorEmail || comment?.email),
        text: formatted,
        timestamp: clean(comment?.timestamp || comment?.createdAt || comment?.created)
      };
    })
    .filter(Boolean);
}

/** @deprecated Prefer buildStatusNoteText / collectAdminDiscussionMessages. Kept for callers. */
function collectCellCommentNotes(record = {}, { fallbackReceiver = null } = {}) {
  const notes = collectRosterStatusNotes(record);
  collectAdminDiscussionMessages(record, { fallbackReceiver }).forEach((message) => {
    notes.push(message.text);
  });
  return notes;
}

function buildLateExcusedCommentFragment(record = {}) {
  const status = normalizeAttendanceStatusForSave(record.status, '');
  const dateLabel = formatShortMonthDay(record.date);
  if (!dateLabel) return '';

  if (status === ATTENDANCE_STATUS.LATE) {
    const minutes = Number(record.lateMinutes) || 0;
    return minutes > 0 ? `${dateLabel} Late ${minutes}m` : `${dateLabel} Late`;
  }

  if (status === ATTENDANCE_STATUS.EXCUSED) {
    const parts = [`${dateLabel} Excused`];
    const excuseRef = clean(record.excuseRef);
    if (excuseRef) parts.push(excuseRef);
    return parts.join(' ');
  }

  return '';
}

/** Status-only Excel Note text (Late/Excused + roster notes). Admin Discussion is excluded. */
function buildStatusNoteText(record = {}) {
  const fragments = [];
  const lateOrExcused = buildLateExcusedCommentFragment(record);
  if (lateOrExcused) fragments.push(lateOrExcused);
  collectRosterStatusNotes(record).forEach((note) => fragments.push(note));
  return fragments.join('\n\n');
}

/**
 * Full note text for tests/back-compat. Prefer buildStatusNoteText for Notes
 * and collectAdminDiscussionMessages for threaded Comments.
 */
function buildCellNoteText(record = {}, { receiverName = '', receiverEmail = '' } = {}) {
  const fallbackReceiver = {
    name: clean(receiverName),
    email: clean(receiverEmail)
  };
  const fragments = [];
  const statusNote = buildStatusNoteText(record);
  if (statusNote) fragments.push(statusNote);
  collectAdminDiscussionMessages(record, { fallbackReceiver }).forEach((message) => {
    fragments.push(message.text);
  });
  return fragments.join('\n\n');
}

function resolveNoteAuthorLabel() {
  return 'Attendance';
}

function buildThreadedMessagesForRecord(record = {}, { receiverName = '', receiverEmail = '' } = {}) {
  const fallbackReceiver = {
    name: clean(receiverName),
    email: clean(receiverEmail)
  };
  const statusNote = buildStatusNoteText(record);
  const discussion = collectAdminDiscussionMessages(record, { fallbackReceiver });
  if (!discussion.length) return [];

  // Excel allows Comment OR Note on a cell, not both — fold status into the thread.
  if (!statusNote) return discussion;
  const [first, ...rest] = discussion;
  return [
    {
      ...first,
      text: `${statusNote}\n\n${first.text}`
    },
    ...rest
  ];
}

function countStatusesFromRecords(records = []) {
  const counts = {
    [ATTENDANCE_STATUS.PRESENT]: 0,
    [ATTENDANCE_STATUS.LATE]: 0,
    [ATTENDANCE_STATUS.EXCUSED]: 0,
    [ATTENDANCE_STATUS.ABSENT]: 0,
    [ATTENDANCE_STATUS.ACF]: 0,
    [ATTENDANCE_STATUS.NOT_APPLICABLE]: 0
  };
  (Array.isArray(records) ? records : []).forEach((record) => {
    const status = normalizeAttendanceStatusForSave(record?.status, '');
    if (!status) return;
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  });
  return counts;
}

/** Locked format (two lines): `87.5%` then `P(3)/L(1)/E(0)/A(2)/ACF(0)/N(1)` */
function formatAttendancePercentCell(summary = {}, records = []) {
  const counts = countStatusesFromRecords(records);
  const pct = summary?.performancePercent;
  const pctLabel = pct == null || Number.isNaN(Number(pct)) ? '—' : `${Number(pct)}%`;
  const breakdown = [
    `P(${counts[ATTENDANCE_STATUS.PRESENT]})`,
    `L(${counts[ATTENDANCE_STATUS.LATE]})`,
    `E(${counts[ATTENDANCE_STATUS.EXCUSED]})`,
    `A(${counts[ATTENDANCE_STATUS.ABSENT]})`,
    `ACF(${counts[ATTENDANCE_STATUS.ACF]})`,
    `N(${counts[ATTENDANCE_STATUS.NOT_APPLICABLE]})`
  ].join('/');
  return `${pctLabel}\n${breakdown}`;
}

function formatFunderType({ funderType, funderId, funderLabel } = {}) {
  const label = clean(funderLabel);
  if (label) return label;
  const type = clean(funderType).toLowerCase();
  const id = clean(funderId).toLowerCase();
  if (type === 'self' || id === 'self' || (!type && !id)) return 'Self Fund';
  if (type === 'funder') return 'Funder';
  return clean(funderType) || clean(funderId) || '';
}

function formatClbSkills(skills = {}) {
  const parts = [];
  CLB_SKILL_CODES.forEach(([key, letter]) => {
    const value = clean(skills?.[key]);
    if (value) parts.push(`${letter}${value}`);
  });
  return parts.join(' ');
}

function formatClbColumn({ current, goal, clbCurrent, clbGoal } = {}) {
  const currentSkills = current || clbCurrent || {};
  const goalSkills = goal || clbGoal || {};
  const currentText = formatClbSkills(currentSkills);
  const goalText = formatClbSkills(goalSkills);
  const parts = [];
  if (currentText) parts.push(`C: ${currentText}`);
  if (goalText) parts.push(`G: ${goalText}`);
  return parts.join('\n');
}

function formatEnrollmentStartEnd({
  startDate,
  endDate,
  enrollmentStartDate,
  enrollmentEndDate
} = {}) {
  const start = clean(startDate || enrollmentStartDate);
  const end = clean(endDate || enrollmentEndDate);
  const parts = [];
  if (start) parts.push(`Start: ${formatDisplayDate(start)}`);
  if (end) parts.push(`End: ${formatDisplayDate(end)}`);
  return parts.join('\n');
}

function parsePersonIdsFilter(personIds) {
  if (personIds == null) return null;
  if (personIds instanceof Set) {
    return new Set([...personIds].map((id) => clean(id)).filter(Boolean));
  }
  if (Array.isArray(personIds)) {
    return new Set(personIds.map((id) => clean(id)).filter(Boolean));
  }
  // Explicit query value (including empty) means filter to the listed IDs.
  return new Set(String(personIds).split(',').map((id) => clean(id)).filter(Boolean));
}

function filterMatrixByPersonIds(payload = {}, personIds) {
  const filter = parsePersonIdsFilter(personIds);
  if (!filter) return payload;
  const matrix = Array.isArray(payload.matrix) ? payload.matrix : [];
  return {
    ...payload,
    matrix: matrix.filter((stu) => filter.has(clean(stu?.personId)))
  };
}

function sanitizeFilenamePart(value) {
  return clean(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Class';
}

function buildExportFilename({ className, startDate, endDate } = {}) {
  const classPart = sanitizeFilenamePart(className);
  const rangePart = [clean(startDate), clean(endDate)].filter(Boolean).join('_to_') || 'range';
  return `Attendance_${classPart}_${rangePart}.xlsx`.replace(/\s+/g, '_');
}

function colLetter(colNumber) {
  let n = colNumber;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function fitColumnWidthToContent(sheet, colIndex, { min = 8, max = 48, padding = 2 } = {}) {
  let maxLen = 0;
  const column = sheet.getColumn(colIndex);
  column.eachCell({ includeEmpty: false }, (cell) => {
    String(cell.value ?? '')
      .split(/\r?\n/)
      .forEach((line) => {
        maxLen = Math.max(maxLen, line.length);
      });
  });
  column.width = Math.min(max, Math.max(min, maxLen + padding));
  return column.width;
}

function mergeHeaderBlock(sheet, row, startCol, endCol) {
  if (endCol <= startCol) return;
  sheet.mergeCells(`${colLetter(startCol)}${row}:${colLetter(endCol)}${row}`);
}

async function buildAttendanceExcelWorkbook(payload = {}) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const matrix = Array.isArray(payload.matrix) ? payload.matrix : [];
  const enabledAttendanceStatuses = payload.enabledAttendanceStatuses
    || attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses({});
  const legend = buildLegendEntries(enabledAttendanceStatuses);
  const className = clean(payload.className) || 'Class';
  const teacherName = clean(payload.teacherName);
  const title = resolveAttendanceTitle({
    startDate: payload.startDate,
    endDate: payload.endDate,
    sessions
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'School Attendance';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Attendance', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 0 }]
  });

  // Funder | # | Last Name | First Name | days... | Comment | Start/End | CLBs | Att %
  const funderCol = 1;
  const numCol = 2;
  const lastNameCol = 3;
  const firstNameCol = 4;
  const firstSessionCol = 5;
  const commentCol = firstSessionCol + sessions.length;
  const startEndCol = commentCol + 1;
  const clbCol = startEndCol + 1;
  const attPctCol = clbCol + 1;
  const mergeEndCol = Math.max(attPctCol, 9);

  // Row 1–3: title / class / teacher (merged from First Name col), legend in A + merged B–C
  sheet.getCell(1, 5).value = title;
  sheet.getCell(1, 5).font = { bold: true, size: 14, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  sheet.getCell(1, 5).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, 1, 5, mergeEndCol);

  sheet.getCell(2, 5).value = `Class: ${className}`;
  sheet.getCell(2, 5).font = { size: 12, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  sheet.getCell(2, 5).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, 2, 5, mergeEndCol);

  sheet.getCell(3, 5).value = `Teacher: ${teacherName}`;
  sheet.getCell(3, 5).font = { size: 14, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  sheet.getCell(3, 5).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, 3, 5, mergeEndCol);

  legend.forEach((entry, idx) => {
    const row = idx + 1;
    const codeCell = sheet.getCell(row, funderCol);
    const labelCell = sheet.getCell(row, numCol);
    codeCell.value = entry.code;
    labelCell.value = entry.label;
    applyLegendCellStyle(codeCell, entry.status);
    applyLegendCellStyle(labelCell, entry.status);
    applyLegendCellStyle(sheet.getCell(row, lastNameCol), entry.status);
    applyVerticalMiddle(codeCell, { horizontal: 'center' });
    applyVerticalMiddle(labelCell);
    mergeHeaderBlock(sheet, row, numCol, lastNameCol);
  });

  const legendBottom = Math.max(legend.length, 3);
  const headerRowIndex = legendBottom + 2;
  const weekdayRowIndex = headerRowIndex + 1;

  const headerLabels = [
    [funderCol, 'Funder'],
    [numCol, '#'],
    [lastNameCol, 'Last Name'],
    [firstNameCol, 'First Name']
  ];
  headerLabels.forEach(([col, label]) => {
    const cell = sheet.getCell(headerRowIndex, col);
    cell.value = label;
    applyHeaderCellStyle(cell);
    applyWeekdayCellStyle(sheet.getCell(weekdayRowIndex, col));
  });

  sessions.forEach((session, idx) => {
    const col = firstSessionCol + idx;
    const dayCell = sheet.getCell(headerRowIndex, col);
    dayCell.value = dayOfMonth(session.date);
    applyHeaderCellStyle(dayCell);

    const weekdayCell = sheet.getCell(weekdayRowIndex, col);
    weekdayCell.value = weekdayShort(session.date);
    applyWeekdayCellStyle(weekdayCell);
  });

  [
    [commentCol, 'Comment'],
    [startEndCol, 'Start/End Date'],
    [clbCol, 'CLBs'],
    [attPctCol, 'Att %']
  ].forEach(([col, label]) => {
    const cell = sheet.getCell(headerRowIndex, col);
    cell.value = label;
    applyHeaderCellStyle(cell);
    applyWeekdayCellStyle(sheet.getCell(weekdayRowIndex, col));
  });

  let bodyRow = weekdayRowIndex + 1;
  const threadedCommentTargets = [];
  matrix.forEach((student, idx) => {
    const { firstName, lastName } = splitDisplayName(student);
    const records = Array.isArray(student.records) ? student.records : [];
    const recordBySessionId = new Map(
      records.map((record) => [clean(record.sessionId), record])
    );
    const banded = idx % 2 === 1;

    const funderCell = sheet.getCell(bodyRow, funderCol);
    const numCell = sheet.getCell(bodyRow, numCol);
    const lastCell = sheet.getCell(bodyRow, lastNameCol);
    const firstCell = sheet.getCell(bodyRow, firstNameCol);
    const commentCell = sheet.getCell(bodyRow, commentCol);
    const startEndCell = sheet.getCell(bodyRow, startEndCol);
    const clbCell = sheet.getCell(bodyRow, clbCol);
    const attPctCell = sheet.getCell(bodyRow, attPctCol);

    funderCell.value = formatFunderType(student);
    numCell.value = idx + 1;
    lastCell.value = lastName;
    firstCell.value = firstName;
    commentCell.value = '';
    startEndCell.value = formatEnrollmentStartEnd(student);
    clbCell.value = formatClbColumn(student);
    attPctCell.value = formatAttendancePercentCell(student.summary, records);

    applyBodyMetaCellStyle(funderCell, { banded });
    applyBodyMetaCellStyle(numCell, { banded, center: true });
    applyBodyMetaCellStyle(lastCell, { banded });
    applyBodyMetaCellStyle(firstCell, { banded });
    applyBodyMetaCellStyle(commentCell, { banded });
    applyBodyMetaCellStyle(startEndCell, { banded, wrapText: true });
    applyBodyMetaCellStyle(clbCell, { banded, wrapText: true });
    applyBodyMetaCellStyle(attPctCell, { banded, wrapText: true });

    sessions.forEach((session, sessionIdx) => {
      const record = recordBySessionId.get(clean(session.id || session.sessionId))
        || records[sessionIdx]
        || {};
      const cell = sheet.getCell(bodyRow, firstSessionCol + sessionIdx);
      cell.value = statusToExportCode(record.status);
      applyStatusCellStyle(cell, record.status);
      const noteOptions = {
        receiverName: [firstName, lastName].filter(Boolean).join(' ') || clean(student.name),
        receiverEmail: clean(student.email)
      };
      const threadedMessages = buildThreadedMessagesForRecord(record, noteOptions);
      if (threadedMessages.length) {
        threadedCommentTargets.push({
          ref: cell.address,
          messages: threadedMessages
        });
        return;
      }
      const noteText = buildStatusNoteText(record);
      if (noteText) {
        cell.note = {
          texts: [{ text: noteText }],
          author: resolveNoteAuthorLabel()
        };
      }
    });

    bodyRow += 1;
  });

  sheet.getColumn(funderCol).width = 14;
  sheet.getColumn(numCol).width = 6;
  sheet.getColumn(lastNameCol).width = 18;
  sheet.getColumn(firstNameCol).width = 18;
  for (let col = firstSessionCol; col < firstSessionCol + sessions.length; col += 1) {
    sheet.getColumn(col).width = 5;
  }
  sheet.getColumn(commentCol).width = 18;
  sheet.getColumn(startEndCol).width = 28;
  fitColumnWidthToContent(sheet, clbCol, { min: 12, max: 42, padding: 2 });
  fitColumnWidthToContent(sheet, attPctCol, { min: 14, max: 36, padding: 2 });

  const rawBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const buffer = await attendanceExcelThreadedComments.injectThreadedComments(
    rawBuffer,
    threadedCommentTargets
  );
  return {
    buffer,
    filename: buildExportFilename({
      className,
      startDate: payload.startDate,
      endDate: payload.endDate
    }),
    legend,
    title
  };
}

module.exports = {
  STATUS_EXPORT_META,
  STATUS_FILL_ARGB,
  NA_DAY_FILL_ARGB,
  HEADER_FILL_ARGB,
  WEEKDAY_FILL_ARGB,
  ROW_BAND_FILL_ARGB,
  buildLegendEntries,
  statusToExportCode,
  statusFillArgb,
  buildLateExcusedCommentFragment,
  formatPersonContact,
  formatCommentAsCommunication,
  buildStatusNoteText,
  buildCellNoteText,
  buildThreadedMessagesForRecord,
  collectAdminDiscussionMessages,
  resolveNoteAuthorLabel,
  countStatusesFromRecords,
  formatAttendancePercentCell,
  formatClbSkills,
  formatClbColumn,
  formatEnrollmentStartEnd,
  formatFunderType,
  filterMatrixByPersonIds,
  parsePersonIdsFilter,
  splitDisplayName,
  resolveAttendanceTitle,
  resolveTitleMonthYear,
  buildExportFilename,
  fitColumnWidthToContent,
  buildAttendanceExcelWorkbook
};
