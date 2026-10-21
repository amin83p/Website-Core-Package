// MVC/services/school/attendanceExcelExportService.js
const ExcelJS = require('exceljs');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const attendanceExcelThreadedComments = require('./attendanceExcelThreadedComments');

const {
  ATTENDANCE_STATUS,
  ALL_ATTENDANCE_STATUSES_ORDERED,
  normalizeAttendanceStatusForSave,
  normalizeEnabledAttendanceStatuses,
  normalizeAttendanceTimingExcuseFlag,
  isAbsenceExcused,
  isAbsentLikeStatus,
  normalizeLegacyAbsenceExcusedRecord
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
const EARLY_LEAVE_FILL_ARGB = 'FFFFC7CE';
const LATE_AND_EARLY_FILL_ARGB = 'FFFF9966';
const TIMING_LEGEND_ENTRIES = Object.freeze([
  Object.freeze({ code: 'LE', label: 'Left early', fillArgb: EARLY_LEAVE_FILL_ARGB }),
  Object.freeze({ code: 'L/LE', label: 'Late and left early', fillArgb: LATE_AND_EARLY_FILL_ARGB })
]);
const OFFICIAL_NO_CLASS_FILL_ARGB = 'FFBFBFBF';
const HEADER_FILL_ARGB = 'FF5B9BD5';
const WEEKDAY_FILL_ARGB = 'FFFBE5D6';
const ROW_BAND_FILL_ARGB = 'FFDDEBF7';
const DARK_TEXT_ARGB = 'FF000000';
const WHITE_TEXT_ARGB = 'FFFFFFFF';
const OFFICIAL_GRID_EXCUSED_ABSENCE_CODE_GREEN_ARGB = 'FF008000';
const OFFICIAL_APPENDIX_EXCUSED_LABEL = 'Excused';

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

/** Consolidated report title line, e.g. October 01, 2026 - October 25, 2026 */
function formatOfficialReportLongDate(dateValue) {
  const d = parseDateOnly(dateValue);
  if (!d) return clean(dateValue);
  return d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
}

function resolveOfficialAttendanceDateRangeTitle({ startDate, endDate, sessions = [] } = {}) {
  const range = resolveExportRangeDates({ startDate, endDate, sessions });
  const startLabel = formatOfficialReportLongDate(range.startDate);
  const endLabel = formatOfficialReportLongDate(range.endDate);
  if (!startLabel && !endLabel) return 'Attendance Report';
  const dateRange = startLabel && endLabel
    ? `${startLabel} - ${endLabel}`
    : (startLabel || endLabel);
  return `Attendance Report - ${dateRange}`;
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
  const entries = ALL_ATTENDANCE_STATUSES_ORDERED
    .filter((status) => enabled.has(status) && STATUS_EXPORT_META[status])
    .map((status) => ({
      status,
      code: STATUS_EXPORT_META[status].code,
      label: STATUS_EXPORT_META[status].label
    }));
  if (!entries.some((entry) => entry.code === 'E')) {
    entries.push({
      status: ATTENDANCE_STATUS.EXCUSED,
      code: STATUS_EXPORT_META[ATTENDANCE_STATUS.EXCUSED].code,
      label: 'Excused absence'
    });
  }
  TIMING_LEGEND_ENTRIES.forEach((entry) => {
    entries.push({ ...entry });
  });
  return entries;
}

function buildOfficialLegendEntries(enabledAttendanceStatuses = []) {
  const entries = buildLegendEntries(enabledAttendanceStatuses);
  const withoutE = entries.filter((entry) => entry.code !== 'E');
  const hasExcusedAbsenceLegend = withoutE.some(
    (entry) => entry.label === 'Excused absence' || entry.status === ATTENDANCE_STATUS.EXCUSED
  );
  if (!hasExcusedAbsenceLegend) {
    withoutE.push({
      status: ATTENDANCE_STATUS.EXCUSED,
      code: 'A',
      label: 'Excused absence'
    });
  }
  return withoutE.map((entry) => {
    if (entry.status === ATTENDANCE_STATUS.EXCUSED || entry.label === 'Excused absence') {
      return { ...entry, code: 'A', label: 'Excused absence' };
    }
    return entry;
  });
}

function resolveExportRecordAttendanceStatus(record = {}) {
  const legacy = normalizeLegacyAbsenceExcusedRecord(record);
  return normalizeAttendanceStatusForSave(
    legacy.attendance || legacy.status || record.attendance || record.status,
    ''
  );
}

function recordHasExcusedAbsenceFlag(record = {}, attendanceStatus = '') {
  const legacy = normalizeLegacyAbsenceExcusedRecord(record);
  if (isAbsenceExcused(legacy)) return true;
  if (!isAbsentLikeStatus(attendanceStatus)) return false;
  return normalizeAttendanceTimingExcuseFlag(record?.absenceExcused);
}

function resolveExportStatusKey(record = {}) {
  const legacy = normalizeLegacyAbsenceExcusedRecord(record);
  const normalized = resolveExportRecordAttendanceStatus(record);
  if (!normalized) return '';
  if (normalized === ATTENDANCE_STATUS.EXCUSED) return ATTENDANCE_STATUS.EXCUSED;
  if (isAbsentLikeStatus(normalized) && recordHasExcusedAbsenceFlag(record, normalized)) {
    return ATTENDANCE_STATUS.EXCUSED;
  }
  return normalized;
}

function statusToExportCode(recordOrStatus) {
  const record = recordOrStatus && typeof recordOrStatus === 'object'
    ? recordOrStatus
    : { status: recordOrStatus };
  const statusKey = resolveExportStatusKey(record);
  if (!statusKey) return '';
  return STATUS_EXPORT_META[statusKey]?.code || '';
}

function hasAttendanceTiming(record = {}) {
  return (Number(record.lateMinutes) || 0) > 0
    || (Number(record.earlyLeaveMinutes) || 0) > 0;
}

function resolveExportCellPresentation(record = {}) {
  const late = Number(record.lateMinutes) || 0;
  const early = Number(record.earlyLeaveMinutes) || 0;
  if (late > 0 && early > 0) {
    return { code: 'L/LE', fillArgb: LATE_AND_EARLY_FILL_ARGB };
  }
  if (early > 0) {
    return { code: 'LE', fillArgb: EARLY_LEAVE_FILL_ARGB };
  }
  const statusKey = resolveExportStatusKey(record);
  return {
    code: statusToExportCode(record),
    fillArgb: statusFillArgb(statusKey, { forLegend: false })
  };
}

/** Status letter only in the cell; timing details belong in Excel notes via buildStatusNoteText. */
function formatExportCellDisplay(record = {}) {
  return resolveExportCellPresentation(record).code;
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

function resolveLegendEntryFillArgb(entryOrStatus) {
  if (entryOrStatus && typeof entryOrStatus === 'object') {
    if (entryOrStatus.fillArgb) return entryOrStatus.fillArgb;
    if (entryOrStatus.status) return statusFillArgb(entryOrStatus.status, { forLegend: true });
    return '';
  }
  return statusFillArgb(entryOrStatus, { forLegend: true });
}

function applyLegendCellStyle(cell, entryOrStatus) {
  const fillArgb = resolveLegendEntryFillArgb(entryOrStatus);
  if (fillArgb) applySolidFill(cell, fillArgb);
  cell.font = { size: 11, color: { argb: DARK_TEXT_ARGB }, name: 'Calibri' };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell);
}

function applyNoClassCellStyle(cell) {
  applySolidFill(cell, OFFICIAL_NO_CLASS_FILL_ARGB);
  cell.font = {
    bold: false,
    size: 11,
    color: { argb: DARK_TEXT_ARGB },
    name: 'Calibri'
  };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, { horizontal: 'center', wrapText: false });
}

function isOfficialExcusedAbsence(record = {}) {
  const attendance = resolveExportRecordAttendanceStatus(record);
  if (!isAbsentLikeStatus(attendance)) {
    return resolveExportStatusKey(record) === ATTENDANCE_STATUS.EXCUSED;
  }
  return recordHasExcusedAbsenceFlag(record, attendance)
    || resolveExportStatusKey(record) === ATTENDANCE_STATUS.EXCUSED;
}

function isOfficialUnexcusedAbsence(record = {}) {
  const attendance = resolveExportRecordAttendanceStatus(record);
  if (!isAbsentLikeStatus(attendance)) return false;
  return !isOfficialExcusedAbsence(record);
}

function officialAppendixNoteHasExcusedLabel(text = '') {
  const body = clean(text);
  if (!body) return false;
  if (body === OFFICIAL_APPENDIX_EXCUSED_LABEL) return true;
  return new RegExp(`(^|\\n)${OFFICIAL_APPENDIX_EXCUSED_LABEL}$`).test(body)
    || body.includes(` ${OFFICIAL_APPENDIX_EXCUSED_LABEL}`);
}

function appendOfficialAppendixAbsenceQualifier(text, record = {}) {
  const attendance = resolveExportRecordAttendanceStatus(record);
  if (!isAbsentLikeStatus(attendance)) return text;
  if (isOfficialExcusedAbsence(record)) {
    if (officialAppendixNoteHasExcusedLabel(text)) return text;
    const body = clean(text);
    return body ? `${body}\n${OFFICIAL_APPENDIX_EXCUSED_LABEL}` : OFFICIAL_APPENDIX_EXCUSED_LABEL;
  }
  const suffix = '(not excused)';
  if (String(text || '').includes(suffix)) return text;
  const body = clean(text);
  return body ? `${body}\n${suffix}` : suffix;
}

function resolveOfficialConsolidatedCellPresentation(record = {}) {
  const base = resolveExportCellPresentation(record);
  if (base.code === 'LE' || base.code === 'L/LE') return base;
  if (isOfficialExcusedAbsence(record)) {
    return {
      code: 'A',
      fillArgb: STATUS_FILL_ARGB[ATTENDANCE_STATUS.ABSENT]
    };
  }
  return base;
}

function applyOfficialConsolidatedAttendanceCellStyle(cell, record = {}) {
  const { code, fillArgb } = resolveOfficialConsolidatedCellPresentation(record);
  if (fillArgb) applySolidFill(cell, fillArgb);
  const excusedAbsence = code === 'A' && isOfficialExcusedAbsence(record);
  cell.font = {
    bold: excusedAbsence,
    size: 11,
    color: { argb: excusedAbsence ? OFFICIAL_GRID_EXCUSED_ABSENCE_CODE_GREEN_ARGB : DARK_TEXT_ARGB },
    name: 'Calibri'
  };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, { horizontal: 'center', wrapText: false });
}

function applyStatusCellStyle(cell, statusOrRecord, { wrapText = false } = {}) {
  const record = statusOrRecord && typeof statusOrRecord === 'object'
    ? statusOrRecord
    : { status: statusOrRecord };
  const { fillArgb } = resolveExportCellPresentation(record);
  if (fillArgb) applySolidFill(cell, fillArgb);
  cell.font = {
    bold: false,
    size: 11,
    color: { argb: DARK_TEXT_ARGB },
    name: 'Calibri'
  };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, { horizontal: 'center', wrapText });
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

function resolveMentionContacts(comment = {}) {
  const mentions = Array.isArray(comment?.mentions) ? comment.mentions : [];
  return mentions
    .map((mention) => formatPersonContact({
      name: mention?.name || mention?.displayName || mention?.authorName,
      email: mention?.email || mention?.authorEmail
    }))
    .filter(Boolean);
}

/** Admin discussion text for Excel comments (author shown as thread title in Excel). */
function formatCommentAsCommunication(comment = {}) {
  if (typeof comment === 'string') {
    return clean(comment);
  }

  const text = clean(comment?.text || comment?.body);
  const mentionContacts = resolveMentionContacts(comment);
  if (!text && !mentionContacts.length) return '';

  const lines = [];
  if (mentionContacts.length) {
    lines.push(`To: ${mentionContacts.join('; ')}`);
  }
  if (text) lines.push(text);
  return lines.join('\n').trim();
}

function collectRosterStatusNotes(record = {}) {
  const notes = [];
  const rosterNotes = clean(record.rosterStudentNotes || record.notes);
  if (rosterNotes) notes.push(rosterNotes);
  return notes;
}

function formatTimingExcuseSuffix(value, { includeNotExcused = false } = {}) {
  if (normalizeAttendanceTimingExcuseFlag(value)) return ' (excused)';
  return includeNotExcused ? ' (not excused)' : '';
}

function formatTimingMinutesLabel(record = {}, { includeNotExcused = false } = {}) {
  const late = Number(record.lateMinutes) || 0;
  const early = Number(record.earlyLeaveMinutes) || 0;
  const fragments = [];
  if (late > 0) {
    fragments.push(`Late ${late}m${formatTimingExcuseSuffix(record.lateExcused, { includeNotExcused })}`);
  }
  if (early > 0) {
    fragments.push(`Left Early ${early}m${formatTimingExcuseSuffix(record.earlyLeaveExcused, { includeNotExcused })}`);
  }
  return fragments.join(' / ');
}

function formatOfficialTimingExcuseSuffix(value, { includeNotExcused = false } = {}) {
  if (normalizeAttendanceTimingExcuseFlag(value)) return ` ${OFFICIAL_APPENDIX_EXCUSED_LABEL}`;
  return includeNotExcused ? ' (not excused)' : '';
}

function formatOfficialTimingMinutesLabel(record = {}, { includeNotExcused = false } = {}) {
  const late = Number(record.lateMinutes) || 0;
  const early = Number(record.earlyLeaveMinutes) || 0;
  const fragments = [];
  if (late > 0) {
    fragments.push(`Late ${late}m${formatOfficialTimingExcuseSuffix(record.lateExcused, { includeNotExcused })}`);
  }
  if (early > 0) {
    fragments.push(`Left Early ${early}m${formatOfficialTimingExcuseSuffix(record.earlyLeaveExcused, { includeNotExcused })}`);
  }
  return fragments.join(' / ');
}

function formatTimingMinutesFragment(record = {}) {
  return formatTimingMinutesLabel(record);
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
      const formatted = formatCommentAsCommunication(comment);
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
  const timing = formatTimingMinutesLabel(record);

  if (status === ATTENDANCE_STATUS.LATE) {
    return timing || 'Late';
  }

  if (status === ATTENDANCE_STATUS.EXCUSED) {
    return 'Excused';
  }
  if (isAbsenceExcused(record)) {
    return isAbsentLikeStatus(status) ? 'Excused absence' : 'Excused';
  }

  return timing;
}

/** Status-only Excel Note text (excuse, timing, roster notes). */
function buildStatusNoteText(record = {}) {
  const fragments = [];
  const excuseRef = clean(record.excuseRef);
  if (excuseRef) fragments.push(`Excuse: ${excuseRef}`);
  const timingLabel = formatTimingMinutesLabel(record, { includeNotExcused: true });
  if (timingLabel) fragments.push(`Timing: ${timingLabel}`);

  collectRosterStatusNotes(record).forEach((note) => {
    fragments.push(note.startsWith('Note:') ? note : `Note: ${note}`);
  });

  return fragments.join('\n\n');
}

/** Consolidated report appendix: single line breaks between excuse, timing, and roster notes. */
function buildOfficialAppendixNoteText(record = {}) {
  const fragments = [];
  const excuseRef = clean(record.excuseRef);
  if (excuseRef) fragments.push(`Excuse: ${excuseRef}`);
  const timingLabel = formatOfficialTimingMinutesLabel(record, { includeNotExcused: true });
  if (timingLabel) fragments.push(`Timing: ${timingLabel}`);
  collectRosterStatusNotes(record).forEach((note) => {
    fragments.push(note.startsWith('Note:') ? note : `Note: ${note}`);
  });
  return appendOfficialAppendixAbsenceQualifier(fragments.join('\n'), record);
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
  return collectAdminDiscussionMessages(record, { fallbackReceiver });
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
    const legacy = normalizeLegacyAbsenceExcusedRecord(record);
    const status = normalizeAttendanceStatusForSave(legacy.status || record?.status, '');
    if (!status) return;
    if (status === ATTENDANCE_STATUS.EXCUSED || (isAbsenceExcused(legacy) && isAbsentLikeStatus(status))) {
      counts[ATTENDANCE_STATUS.EXCUSED] += 1;
      if (status === ATTENDANCE_STATUS.ACF) counts[ATTENDANCE_STATUS.ACF] += 1;
      return;
    }
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

function parseSessionIdsFilter(sessionIds) {
  if (sessionIds === undefined || sessionIds === null) return null;
  return new Set(String(sessionIds).split(',').map((id) => clean(id)).filter(Boolean));
}

function filterMatrixBySessionIds(payload = {}, sessionIds) {
  const filter = parseSessionIdsFilter(sessionIds);
  if (!filter) return payload;
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const keepIndices = sessions
    .map((sessionRow, index) => (filter.has(clean(sessionRow?.id)) ? index : -1))
    .filter((index) => index >= 0);
  const filteredSessions = keepIndices.map((index) => sessions[index]);
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : [];
  return {
    ...payload,
    sessions: filteredSessions,
    matrix: matrix.map((row) => ({
      ...row,
      records: keepIndices.map((index) => (Array.isArray(row?.records) ? row.records[index] : undefined))
    }))
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

function buildStudentAttendanceExcelFilename({ studentName, startDate, endDate } = {}) {
  const studentPart = sanitizeFilenamePart(studentName || 'Student');
  const rangePart = [clean(startDate), clean(endDate)].filter(Boolean).join('_to_') || 'range';
  return `Attendance_${studentPart}_${rangePart}.xlsx`.replace(/\s+/g, '_');
}

function sanitizeExcelSheetName(value = '', usedNames = new Set()) {
  let base = clean(value)
    .replace(/[\\/*?:[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Class';
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const tail = `_${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 31 - tail.length))}${tail}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
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

function writeAttendanceMatrixBlock(sheet, payload = {}, options = {}) {
  const startRow = Math.max(1, Number(options.startRow) || 1);
  const applyColumnWidths = options.applyColumnWidths !== false;
  const rowAt = (relativeOneBased) => startRow + relativeOneBased - 1;

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
  sheet.getCell(rowAt(1), 5).value = title;
  sheet.getCell(rowAt(1), 5).font = { bold: true, size: 14, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  sheet.getCell(rowAt(1), 5).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, rowAt(1), 5, mergeEndCol);

  sheet.getCell(rowAt(2), 5).value = `Class: ${className}`;
  sheet.getCell(rowAt(2), 5).font = { size: 12, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  sheet.getCell(rowAt(2), 5).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, rowAt(2), 5, mergeEndCol);

  sheet.getCell(rowAt(3), 5).value = `Teacher: ${teacherName}`;
  sheet.getCell(rowAt(3), 5).font = { size: 14, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  sheet.getCell(rowAt(3), 5).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, rowAt(3), 5, mergeEndCol);

  legend.forEach((entry, idx) => {
    const row = rowAt(idx + 1);
    const codeCell = sheet.getCell(row, funderCol);
    const labelCell = sheet.getCell(row, numCol);
    codeCell.value = entry.code;
    labelCell.value = entry.label;
    applyLegendCellStyle(codeCell, entry);
    applyLegendCellStyle(labelCell, entry);
    applyLegendCellStyle(sheet.getCell(row, lastNameCol), entry);
    applyVerticalMiddle(codeCell, { horizontal: 'center' });
    applyVerticalMiddle(labelCell);
    mergeHeaderBlock(sheet, row, numCol, lastNameCol);
  });

  const legendBottom = Math.max(legend.length, 3);
  const headerRowIndex = rowAt(legendBottom + 2);
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
      const displayValue = formatExportCellDisplay(record);
      cell.value = displayValue;
      applyStatusCellStyle(cell, record, { wrapText: false });
      const noteOptions = {
        receiverName: [firstName, lastName].filter(Boolean).join(' ') || clean(student.name),
        receiverEmail: clean(student.email)
      };
      const noteText = buildStatusNoteText(record);
      const threadedMessages = buildThreadedMessagesForRecord(record, noteOptions);
      if (noteText) {
        cell.note = {
          texts: [{ text: noteText }],
          author: resolveNoteAuthorLabel()
        };
      }
      if (threadedMessages.length) {
        threadedCommentTargets.push({
          ref: cell.address,
          messages: threadedMessages
        });
      }
    });

    bodyRow += 1;
  });

  if (applyColumnWidths) {
    sheet.getColumn(funderCol).width = Math.max(sheet.getColumn(funderCol).width || 0, 14);
    sheet.getColumn(numCol).width = Math.max(sheet.getColumn(numCol).width || 0, 6);
    sheet.getColumn(lastNameCol).width = Math.max(sheet.getColumn(lastNameCol).width || 0, 18);
    sheet.getColumn(firstNameCol).width = Math.max(sheet.getColumn(firstNameCol).width || 0, 18);
    const sessionColumnWidth = 5;
    for (let col = firstSessionCol; col < firstSessionCol + sessions.length; col += 1) {
      sheet.getColumn(col).width = Math.max(sheet.getColumn(col).width || 0, sessionColumnWidth);
    }
    sheet.getColumn(commentCol).width = Math.max(sheet.getColumn(commentCol).width || 0, 18);
    sheet.getColumn(startEndCol).width = Math.max(sheet.getColumn(startEndCol).width || 0, 28);
    fitColumnWidthToContent(sheet, clbCol, { min: 12, max: 42, padding: 2 });
    fitColumnWidthToContent(sheet, attPctCol, { min: 14, max: 36, padding: 2 });
  }

  const endRow = bodyRow - 1;

  return {
    legend,
    title,
    className,
    threadedCommentTargets,
    endRow,
    headerRowIndex,
    weekdayRowIndex
  };
}

function appendAttendanceMatrixSheet(workbook, payload = {}, options = {}) {
  const sheetName = clean(options.sheetName) || 'Attendance';
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 0 }]
  });
  const result = writeAttendanceMatrixBlock(sheet, payload, { startRow: 1, applyColumnWidths: true });
  return {
    legend: result.legend,
    title: result.title,
    className: result.className,
    threadedCommentTargets: result.threadedCommentTargets
  };
}

const STUDENT_EXCEL_SHEET_LAYOUT_PER_CLASS = 'perClass';
const STUDENT_EXCEL_SHEET_LAYOUT_SINGLE = 'singleSheet';
const STUDENT_EXCEL_TEMPLATE_CLASS_MATRIX = 'classMatrix';
const STUDENT_EXCEL_TEMPLATE_OFFICIAL = 'officialAttendanceReport';
const STUDENT_EXCEL_BLOCK_GAP_ROWS = 3;

const OFFICIAL_REPORT_META_FONT = Object.freeze({
  bold: true,
  size: 12,
  name: 'Calibri',
  color: { argb: DARK_TEXT_ARGB }
});

const OFFICIAL_REPORT_TITLE_FONT = Object.freeze({
  ...OFFICIAL_REPORT_META_FONT,
  size: 15
});

const OFFICIAL_CLASS_NAME_STRIP_TOKENS = Object.freeze(['EAL', 'O/G', 'O/1', 'I/G', 'I/1']);
const OFFICIAL_BODY_ROW_HEIGHT = 24;
const OFFICIAL_APPENDIX_SECTION_COLOR_ARGB = 'FF495057';
const OFFICIAL_APPENDIX_CLASS_COLOR_ARGB = 'FF198754';
const OFFICIAL_APPENDIX_DATETIME_COLOR_ARGB = 'FF0563C1';
const OFFICIAL_APPENDIX_NOTE_COLOR_ARGB = DARK_TEXT_ARGB;
const OFFICIAL_APPENDIX_CLASS_DIVIDER_FILL_ARGB = 'FFDEE2E6';
const OFFICIAL_APPENDIX_CLASS_DIVIDER_ROW_HEIGHT = 5;
const OFFICIAL_SESSION_COLUMN_WIDTH = 9;
const OFFICIAL_TEACHER_COLUMN_WIDTH = 12;
const OFFICIAL_LEGEND_CODE_WIDTH = 6;
const OFFICIAL_LEGEND_LABEL_WIDTH = 14;
const OFFICIAL_LEGEND_SPACER_WIDTH = 5;
const OFFICIAL_CLASS_START_COL = 1;
const OFFICIAL_CLASS_END_COL = 3;
function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatOfficialExportClassName(rawName = '', teacherName = '') {
  let name = clean(rawName);
  if (!name) return 'Class';

  const teacherTokens = new Set();
  const teacher = clean(teacherName);
  if (teacher) {
    teacherTokens.add(teacher);
    const first = teacher.split(/\s+/).filter(Boolean)[0] || '';
    if (first) {
      teacherTokens.add(first);
      teacherTokens.add(first.toUpperCase());
    }
  }
  teacherTokens.forEach((token) => {
    name = name.replace(new RegExp(escapeRegExp(token), 'gi'), '');
  });

  OFFICIAL_CLASS_NAME_STRIP_TOKENS.forEach((token) => {
    name = name.replace(new RegExp(escapeRegExp(token), 'gi'), '');
  });

  name = name
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || clean(rawName) || 'Class';
}

function measureLongestDisplayLine(value = '') {
  let maxLen = 0;
  String(value || '')
    .split(/\r?\n/)
    .forEach((line) => {
      maxLen = Math.max(maxLen, line.length);
    });
  return maxLen;
}

function formatClockTimeForExport(timeValue = '') {
  const token = clean(timeValue);
  if (!token) return '';
  const match = token.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const parsed = new Date(2000, 0, 1, hours, minutes);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
    }
  }
  return token;
}

function formatOfficialTeacherShortName(teacherName = '') {
  const parts = clean(teacherName).split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

function formatOfficialSessionDateHeading(dateValue = '', session = {}, { includeTime = false } = {}) {
  const date = clean(dateValue || session?.date);
  const parsed = parseDateOnly(date);
  const datePart = parsed
    ? parsed.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
    : date;
  if (!includeTime) return datePart;
  const start = formatClockTimeForExport(session?.startTime);
  const end = formatClockTimeForExport(session?.endTime);
  let timePart = '';
  if (start && end) timePart = `${start}–${end}`;
  else if (start) timePart = start;
  else if (end) timePart = end;
  return timePart ? `${datePart} — ${timePart}` : datePart;
}

function formatOfficialSessionDateTimeHeading(dateValue = '', session = {}) {
  return formatOfficialSessionDateHeading(dateValue, session, { includeTime: true });
}

function resolveOfficialSessionTimeKey(session = {}) {
  return `${clean(session?.startTime)}|${clean(session?.endTime)}`;
}

function shouldIncludeTimeInOfficialAppendixNotes(sessionsByDate = new Map(), noteDates = []) {
  const keys = new Set();
  (Array.isArray(noteDates) ? noteDates : []).forEach((date) => {
    keys.add(resolveOfficialSessionTimeKey(sessionsByDate.get(date) || {}));
  });
  return keys.size > 1;
}

function formatOfficialSessionTimeRange(session = {}) {
  const start = formatClockTimeForExport(session?.startTime);
  const end = formatClockTimeForExport(session?.endTime);
  if (start && end) return `${start}–${end}`;
  if (start) return start;
  if (end) return end;
  return '';
}

function buildOfficialAppendixClassHeading(classRow = {}, {
  noteDates = [],
  sessionsByDate = new Map(),
  includeTimeInNoteHeadings = false
} = {}) {
  const className = formatOfficialExportClassName(classRow.className, classRow.teacherName);
  if (includeTimeInNoteHeadings || !noteDates.length) return className;
  const session = sessionsByDate.get(noteDates[0]) || {};
  const timeRange = formatOfficialSessionTimeRange(session);
  return timeRange ? `${className} — ${timeRange}` : className;
}

function officialClassRowHasExportNotes(classRow = {}, unionSessionDates = []) {
  const sessionDateSet = classRow.sessionDateSet instanceof Set
    ? classRow.sessionDateSet
    : new Set();
  const recordsByDate = classRow.recordsByDate instanceof Map
    ? classRow.recordsByDate
    : new Map();
  return (Array.isArray(unionSessionDates) ? unionSessionDates : []).some((date) => {
    if (!sessionDateSet.has(date)) return false;
    const record = recordsByDate.get(date) || {};
    return Boolean(buildOfficialAppendixNoteText(record));
  });
}

function applyOfficialAppendixTextStyle(cell, {
  bold = false,
  wrapText = true,
  colorArgb = OFFICIAL_APPENDIX_NOTE_COLOR_ARGB,
  size = 11,
  vertical = 'middle',
  horizontal = null
} = {}) {
  cell.font = {
    bold,
    size,
    name: 'Calibri',
    color: { argb: colorArgb }
  };
  cell.border = {};
  const alignment = { vertical, wrapText };
  if (horizontal) alignment.horizontal = horizontal;
  cell.alignment = alignment;
}

function buildOfficialAppendixNoteCellValue(dateHeading = '', noteText = '') {
  const heading = clean(dateHeading);
  const headingPart = {
    text: `${heading}\n`,
    font: {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: OFFICIAL_APPENDIX_DATETIME_COLOR_ARGB }
    }
  };
  const bodyParts = buildOfficialAppendixNoteBodyRichText(noteText);
  return {
    richText: [headingPart, ...bodyParts]
  };
}

function applyOfficialAppendixClassDividerRow(sheet, row, startCol, endCol) {
  mergeHeaderBlock(sheet, row, startCol, endCol);
  sheet.getRow(row).height = OFFICIAL_APPENDIX_CLASS_DIVIDER_ROW_HEIGHT;
  for (let col = startCol; col <= endCol; col += 1) {
    const cell = sheet.getCell(row, col);
    cell.value = '';
    cell.border = {};
    applySolidFill(cell, OFFICIAL_APPENDIX_CLASS_DIVIDER_FILL_ARGB);
  }
}

function applyOfficialAppendixNoteEntryCell(cell, dateHeading, noteText) {
  cell.value = buildOfficialAppendixNoteCellValue(dateHeading, noteText);
  cell.border = {};
  cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
}

function styleOfficialAppendixMergedRow(sheet, row, startCol, endCol, styleOptions = {}) {
  mergeHeaderBlock(sheet, row, startCol, endCol);
  for (let col = startCol; col <= endCol; col += 1) {
    applyOfficialAppendixTextStyle(sheet.getCell(row, col), styleOptions);
  }
}

function writeOfficialAttendanceNotesAppendix(
  sheet,
  {
    classRows = [],
    unionSessionDates = [],
    numCol,
    mergeEndCol
  } = {},
  startRow = 1
) {
  const rows = Array.isArray(classRows) ? classRows : [];
  const dates = Array.isArray(unionSessionDates) ? unionSessionDates : [];
  const hasAnyNotes = rows.some((classRow) => officialClassRowHasExportNotes(classRow, dates));
  if (!hasAnyNotes) return startRow - 1;

  let row = startRow + STUDENT_EXCEL_BLOCK_GAP_ROWS;
  styleOfficialAppendixMergedRow(sheet, row, numCol, mergeEndCol, {
    bold: true,
    wrapText: false,
    colorArgb: OFFICIAL_APPENDIX_SECTION_COLOR_ARGB,
    size: 12
  });
  sheet.getCell(row, numCol).value = 'Attendance notes';
  row += 1;

  let classNotesBlockIndex = 0;
  rows.forEach((classRow) => {
    if (!officialClassRowHasExportNotes(classRow, dates)) return;
    if (classNotesBlockIndex > 0) {
      applyOfficialAppendixClassDividerRow(sheet, row, numCol, mergeEndCol);
      row += 1;
    }
    classNotesBlockIndex += 1;

    const sessionDateSet = classRow.sessionDateSet instanceof Set
      ? classRow.sessionDateSet
      : new Set();
    const recordsByDate = classRow.recordsByDate instanceof Map
      ? classRow.recordsByDate
      : new Map();
    const sessionsByDate = classRow.sessionsByDate instanceof Map
      ? classRow.sessionsByDate
      : new Map();

    const noteDates = dates.filter((date) => {
      if (!sessionDateSet.has(date)) return false;
      const record = recordsByDate.get(date) || {};
      return Boolean(buildOfficialAppendixNoteText(record));
    });
    const includeTimeInNoteHeadings = shouldIncludeTimeInOfficialAppendixNotes(
      sessionsByDate,
      noteDates
    );

    styleOfficialAppendixMergedRow(sheet, row, numCol, mergeEndCol, {
      bold: true,
      wrapText: false,
      colorArgb: OFFICIAL_APPENDIX_CLASS_COLOR_ARGB,
      size: 12
    });
    sheet.getCell(row, numCol).value = buildOfficialAppendixClassHeading(classRow, {
      noteDates,
      sessionsByDate,
      includeTimeInNoteHeadings
    });
    row += 1;

    dates.forEach((date) => {
      if (!sessionDateSet.has(date)) return;
      const record = recordsByDate.get(date) || {};
      const noteText = buildOfficialAppendixNoteText(record);
      if (!noteText) return;

      const session = sessionsByDate.get(date) || { date };
      const dateHeading = formatOfficialSessionDateHeading(date, session, {
        includeTime: includeTimeInNoteHeadings
      });
      mergeHeaderBlock(sheet, row, numCol, mergeEndCol);
      for (let col = numCol; col <= mergeEndCol; col += 1) {
        if (col === numCol) {
          applyOfficialAppendixNoteEntryCell(sheet.getCell(row, col), dateHeading, noteText);
        } else {
          const spacer = sheet.getCell(row, col);
          spacer.border = {};
          spacer.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        }
      }
      const lineCount = String(noteText).split(/\r?\n/).length + 1;
      sheet.getRow(row).height = Math.max(OFFICIAL_BODY_ROW_HEIGHT, lineCount * 16);
      row += 1;
    });
  });

  return row - 1;
}

function resolveOfficialClassColumnWidth(classRows = []) {
  let maxChars = measureLongestDisplayLine('Class');
  (Array.isArray(classRows) ? classRows : []).forEach((row) => {
    const displayName = formatOfficialExportClassName(row?.className, row?.teacherName);
    maxChars = Math.max(maxChars, measureLongestDisplayLine(displayName));
  });
  return Math.max(14, Math.min(48, maxChars + 2));
}

function resolveOfficialLegendLabelColumnWidth(legend = []) {
  let maxChars = measureLongestDisplayLine('Present');
  (Array.isArray(legend) ? legend : []).forEach((entry) => {
    maxChars = Math.max(maxChars, measureLongestDisplayLine(entry?.label));
  });
  return Math.max(OFFICIAL_LEGEND_LABEL_WIDTH, Math.min(36, maxChars + 2));
}

/** Column C width for merged class block; columns A and B stay at fixed legend widths. */
function resolveOfficialClassColumnCWidth(classRows = []) {
  return resolveOfficialClassColumnWidth(classRows);
}

function officialRecordHasExcusedTiming(record = {}) {
  const late = Number(record.lateMinutes) || 0;
  const early = Number(record.earlyLeaveMinutes) || 0;
  return (late > 0 && normalizeAttendanceTimingExcuseFlag(record.lateExcused))
    || (early > 0 && normalizeAttendanceTimingExcuseFlag(record.earlyLeaveExcused));
}

function appendOfficialAppendixInlineRichText(richText, textSlice, baseFont, boldFont) {
  const pattern = /( Excused|\(not excused\))/g;
  let lastIndex = 0;
  let match = pattern.exec(textSlice);
  while (match) {
    if (match.index > lastIndex) {
      richText.push({ text: textSlice.slice(lastIndex, match.index), font: baseFont });
    }
    richText.push({ text: match[0], font: boldFont });
    lastIndex = match.index + match[0].length;
    match = pattern.exec(textSlice);
  }
  if (lastIndex < textSlice.length) {
    richText.push({ text: textSlice.slice(lastIndex), font: baseFont });
  }
}

function buildOfficialAppendixNoteBodyRichText(noteText = '') {
  const baseFont = {
    name: 'Calibri',
    size: 11,
    color: { argb: OFFICIAL_APPENDIX_NOTE_COLOR_ARGB }
  };
  const boldFont = { ...baseFont, bold: true };
  const text = clean(noteText);
  if (!text) return [];
  const richText = [];
  const lines = text.split('\n');
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) richText.push({ text: '\n', font: baseFont });
    if (line === OFFICIAL_APPENDIX_EXCUSED_LABEL || line === '(not excused)') {
      richText.push({ text: line, font: boldFont });
      return;
    }
    appendOfficialAppendixInlineRichText(richText, line, baseFont, boldFont);
  });
  if (!richText.length) richText.push({ text, font: baseFont });
  return richText;
}

function mergeOfficialClassColumns(sheet, row, classStartCol = OFFICIAL_CLASS_START_COL, classEndCol = OFFICIAL_CLASS_END_COL) {
  mergeHeaderBlock(sheet, row, classStartCol, classEndCol);
}

function applyStyleAcrossMergedColumns(sheet, row, startCol, endCol, applyStyle) {
  for (let col = startCol; col <= endCol; col += 1) {
    applyStyle(sheet.getCell(row, col));
  }
}

/** @deprecated use resolveOfficialClassColumnWidth */
function resolveOfficialClassBufferColumnWidth(classRows = []) {
  return resolveOfficialClassColumnWidth(classRows);
}

function normalizeStudentExcelExportTemplate(value = '') {
  const token = clean(value).toLowerCase();
  if (token === STUDENT_EXCEL_TEMPLATE_OFFICIAL || token === 'officialattendancereport') {
    return STUDENT_EXCEL_TEMPLATE_OFFICIAL;
  }
  return STUDENT_EXCEL_TEMPLATE_CLASS_MATRIX;
}

function normalizeStudentExcelSheetLayout(value = '') {
  const token = clean(value).toLowerCase();
  if (token === STUDENT_EXCEL_SHEET_LAYOUT_SINGLE || token === 'singlesheet') {
    return STUDENT_EXCEL_SHEET_LAYOUT_SINGLE;
  }
  return STUDENT_EXCEL_SHEET_LAYOUT_PER_CLASS;
}

function normalizeOfficialIncludeTeacherName(value) {
  const token = clean(value).toLowerCase();
  if (token === 'false' || token === '0' || token === 'no' || token === 'without') {
    return false;
  }
  return true;
}

async function writeWorkbookBuffer(workbook, threadedCommentTargets = []) {
  const rawBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const targets = Array.isArray(threadedCommentTargets) ? threadedCommentTargets : [];
  if (!targets.length) return rawBuffer;
  return attendanceExcelThreadedComments.injectThreadedComments(rawBuffer, targets);
}

async function buildAttendanceExcelWorkbook(payload = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'School Attendance';
  workbook.created = new Date();
  const sheetResult = appendAttendanceMatrixSheet(workbook, payload, { sheetName: 'Attendance' });
  const buffer = await writeWorkbookBuffer(workbook, sheetResult.threadedCommentTargets);
  return {
    buffer,
    filename: buildExportFilename({
      className: sheetResult.className,
      startDate: payload.startDate,
      endDate: payload.endDate
    }),
    legend: sheetResult.legend,
    title: sheetResult.title
  };
}

function writeOfficialStudentAttendanceBlock(sheet, exportModel = {}, options = {}) {
  const startRow = Math.max(1, Number(options.startRow) || 1);
  const applyColumnWidths = options.applyColumnWidths !== false;
  const includeTeacherName = options.includeTeacherName !== false;
  const rowAt = (relativeOneBased) => startRow + relativeOneBased - 1;

  const unionSessionDates = Array.isArray(exportModel.unionSessionDates) ? exportModel.unionSessionDates : [];
  const classRows = Array.isArray(exportModel.classRows) ? exportModel.classRows : [];
  const enabledAttendanceStatuses = exportModel.enabledAttendanceStatuses
    || attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses({});
  const studentName = clean(exportModel.student?.name) || 'Student';
  const claimLine = clean(exportModel.claimHeaderDisplay)
    || (clean(exportModel.claimNumbersDisplay)
      ? `Claim Number: ${clean(exportModel.claimNumbersDisplay)}`
      : '');
  const title = resolveOfficialAttendanceDateRangeTitle({
    startDate: exportModel.startDate,
    endDate: exportModel.endDate,
    sessions: unionSessionDates.map((date) => ({ date }))
  });

  const legend = buildOfficialLegendEntries(enabledAttendanceStatuses);

  const legendCodeCol = OFFICIAL_CLASS_START_COL;
  const legendLabelCol = 2;
  const legendSpacerCol = OFFICIAL_CLASS_END_COL;
  const classStartCol = OFFICIAL_CLASS_START_COL;
  const classEndCol = OFFICIAL_CLASS_END_COL;
  const teacherCol = classEndCol + 1;
  const firstSessionCol = includeTeacherName ? teacherCol + 1 : classEndCol + 1;
  const appendixStartCol = classStartCol;
  const mergeEndCol = Math.max(firstSessionCol + unionSessionDates.length - 1, firstSessionCol + 2);

  sheet.getCell(rowAt(1), firstSessionCol).value = title;
  sheet.getCell(rowAt(1), firstSessionCol).font = { ...OFFICIAL_REPORT_TITLE_FONT };
  sheet.getCell(rowAt(1), firstSessionCol).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, rowAt(1), firstSessionCol, mergeEndCol);

  sheet.getCell(rowAt(2), firstSessionCol).value = `Student: ${studentName}`;
  sheet.getCell(rowAt(2), firstSessionCol).font = { ...OFFICIAL_REPORT_META_FONT };
  sheet.getCell(rowAt(2), firstSessionCol).alignment = { vertical: 'middle' };
  mergeHeaderBlock(sheet, rowAt(2), firstSessionCol, mergeEndCol);

  if (claimLine) {
    sheet.getCell(rowAt(3), firstSessionCol).value = claimLine;
    sheet.getCell(rowAt(3), firstSessionCol).font = { ...OFFICIAL_REPORT_META_FONT };
    sheet.getCell(rowAt(3), firstSessionCol).alignment = { vertical: 'middle' };
    mergeHeaderBlock(sheet, rowAt(3), firstSessionCol, mergeEndCol);
  }

  legend.forEach((entry, idx) => {
    const row = rowAt(idx + 1);
    const codeCell = sheet.getCell(row, legendCodeCol);
    const labelCell = sheet.getCell(row, legendLabelCol);
    const spacerCell = sheet.getCell(row, legendSpacerCol);
    codeCell.value = entry.code;
    labelCell.value = entry.label;
    spacerCell.value = '';
    applyLegendCellStyle(codeCell, entry);
    applyLegendCellStyle(labelCell, entry);
    applyVerticalMiddle(codeCell, { horizontal: 'center' });
    applyVerticalMiddle(labelCell);
    applyVerticalMiddle(spacerCell);
  });

  const legendBottom = Math.max(legend.length, 3);
  const headerRowIndex = rowAt(legendBottom + 2);
  const weekdayRowIndex = headerRowIndex + 1;
  sheet.getRow(headerRowIndex).height = OFFICIAL_BODY_ROW_HEIGHT;
  sheet.getRow(weekdayRowIndex).height = OFFICIAL_BODY_ROW_HEIGHT;

  mergeOfficialClassColumns(sheet, headerRowIndex, classStartCol, classEndCol);
  const classHeaderCell = sheet.getCell(headerRowIndex, classStartCol);
  classHeaderCell.value = 'Class';
  applyStyleAcrossMergedColumns(sheet, headerRowIndex, classStartCol, classEndCol, applyHeaderCellStyle);

  mergeOfficialClassColumns(sheet, weekdayRowIndex, classStartCol, classEndCol);
  applyStyleAcrossMergedColumns(sheet, weekdayRowIndex, classStartCol, classEndCol, applyWeekdayCellStyle);

  if (includeTeacherName) {
    const teacherHeaderCell = sheet.getCell(headerRowIndex, teacherCol);
    teacherHeaderCell.value = 'Teacher';
    applyHeaderCellStyle(teacherHeaderCell);
    applyWeekdayCellStyle(sheet.getCell(weekdayRowIndex, teacherCol));
  }

  unionSessionDates.forEach((date, idx) => {
    const col = firstSessionCol + idx;
    const dayCell = sheet.getCell(headerRowIndex, col);
    dayCell.value = dayOfMonth(date);
    applyHeaderCellStyle(dayCell);

    const weekdayCell = sheet.getCell(weekdayRowIndex, col);
    weekdayCell.value = weekdayShort(date);
    applyWeekdayCellStyle(weekdayCell);
  });

  let bodyRow = weekdayRowIndex + 1;
  const threadedCommentTargets = [];

  classRows.forEach((classRow, idx) => {
    const banded = idx % 2 === 1;
    const sessionDateSet = classRow.sessionDateSet instanceof Set
      ? classRow.sessionDateSet
      : new Set();
    const recordsByDate = classRow.recordsByDate instanceof Map
      ? classRow.recordsByDate
      : new Map();

    const displayClassName = formatOfficialExportClassName(
      classRow.className,
      classRow.teacherName
    );

    mergeOfficialClassColumns(sheet, bodyRow, classStartCol, classEndCol);
    const classCell = sheet.getCell(bodyRow, classStartCol);
    classCell.value = displayClassName;
    applyStyleAcrossMergedColumns(sheet, bodyRow, classStartCol, classEndCol, (cell) => {
      applyBodyMetaCellStyle(cell, { banded, wrapText: true });
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    });
    if (includeTeacherName) {
      const teacherCell = sheet.getCell(bodyRow, teacherCol);
      teacherCell.value = formatOfficialTeacherShortName(classRow.teacherName);
      applyBodyMetaCellStyle(teacherCell, { banded, wrapText: true });
      teacherCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    }
    sheet.getRow(bodyRow).height = OFFICIAL_BODY_ROW_HEIGHT;

    unionSessionDates.forEach((date, sessionIdx) => {
      const cell = sheet.getCell(bodyRow, firstSessionCol + sessionIdx);
      if (!sessionDateSet.has(date)) {
        cell.value = 'X';
        applyNoClassCellStyle(cell);
        cell.note = {
          texts: [{ text: 'No Class' }],
          author: resolveNoteAuthorLabel()
        };
        return;
      }
      const record = recordsByDate.get(date) || {};
      cell.value = resolveOfficialConsolidatedCellPresentation(record).code;
      applyOfficialConsolidatedAttendanceCellStyle(cell, record);
      const noteText = buildStatusNoteText(record);
      const threadedMessages = buildThreadedMessagesForRecord(record, {
        receiverName: studentName,
        receiverEmail: clean(exportModel.student?.email)
      });
      if (noteText) {
        cell.note = {
          texts: [{ text: noteText }],
          author: resolveNoteAuthorLabel()
        };
      }
      if (threadedMessages.length) {
        threadedCommentTargets.push({
          ref: cell.address,
          messages: threadedMessages
        });
      }
    });

    bodyRow += 1;
  });

  if (applyColumnWidths) {
    const legendLabelWidth = resolveOfficialLegendLabelColumnWidth(legend);
    sheet.getColumn(legendCodeCol).width = OFFICIAL_LEGEND_CODE_WIDTH;
    sheet.getColumn(legendLabelCol).width = legendLabelWidth;
    sheet.getColumn(legendSpacerCol).width = resolveOfficialClassColumnCWidth(classRows);
    if (includeTeacherName) {
      sheet.getColumn(teacherCol).width = OFFICIAL_TEACHER_COLUMN_WIDTH;
    }
    for (let col = firstSessionCol; col < firstSessionCol + unionSessionDates.length; col += 1) {
      sheet.getColumn(col).width = Math.max(sheet.getColumn(col).width || 0, OFFICIAL_SESSION_COLUMN_WIDTH);
    }
  }

  let endRow = bodyRow - 1;
  endRow = writeOfficialAttendanceNotesAppendix(sheet, {
    classRows,
    unionSessionDates,
    numCol: appendixStartCol,
    mergeEndCol
  }, bodyRow);

  return {
    legend,
    title,
    threadedCommentTargets,
    endRow,
    headerRowIndex,
    weekdayRowIndex,
    firstSessionCol
  };
}

async function buildOfficialStudentAttendanceExcelWorkbook(exportModel = {}, meta = {}) {
  const classRows = Array.isArray(exportModel.classRows) ? exportModel.classRows : [];
  if (!classRows.length) {
    throw new Error('No attendance sheets to export.');
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'School Attendance';
  workbook.created = new Date();
  const usedSheetNames = new Set();
  const sheetName = sanitizeExcelSheetName('Consolidated Attendance', usedSheetNames);
  const sheet = workbook.addWorksheet(sheetName);
  const blockResult = writeOfficialStudentAttendanceBlock(sheet, exportModel, {
    startRow: 1,
    applyColumnWidths: true,
    includeTeacherName: normalizeOfficialIncludeTeacherName(meta.includeTeacherName)
  });
  const buffer = await writeWorkbookBuffer(workbook, blockResult.threadedCommentTargets);
  const studentName = clean(meta.studentName) || clean(exportModel.student?.name) || 'Student';
  return {
    buffer,
    filename: buildStudentAttendanceExcelFilename({
      studentName,
      startDate: exportModel.startDate || meta.startDate,
      endDate: exportModel.endDate || meta.endDate
    }),
    legend: blockResult.legend,
    title: blockResult.title
  };
}

async function buildStudentAttendanceExcelWorkbook(classEntries = [], meta = {}, options = {}) {
  const entries = Array.isArray(classEntries) ? classEntries : [];
  if (!entries.length) {
    throw new Error('No attendance sheets to export.');
  }
  const sheetLayout = normalizeStudentExcelSheetLayout(options.sheetLayout);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'School Attendance';
  workbook.created = new Date();
  const threadedCommentTargets = [];
  let firstLegend = null;
  let firstTitle = null;

  if (sheetLayout === STUDENT_EXCEL_SHEET_LAYOUT_SINGLE) {
    const usedSheetNames = new Set();
    const sheetName = sanitizeExcelSheetName('Attendance', usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName);
    let startRow = 1;
    let firstWeekdayRowIndex = null;

    entries.forEach((entry, index) => {
      const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : {};
      const blockResult = writeAttendanceMatrixBlock(sheet, payload, {
        startRow,
        applyColumnWidths: true
      });
      if (!firstLegend) firstLegend = blockResult.legend;
      if (!firstTitle) firstTitle = blockResult.title;
      if (firstWeekdayRowIndex == null) firstWeekdayRowIndex = blockResult.weekdayRowIndex;
      threadedCommentTargets.push(...(blockResult.threadedCommentTargets || []));
      if (index < entries.length - 1) {
        startRow = blockResult.endRow + STUDENT_EXCEL_BLOCK_GAP_ROWS + 1;
      }
    });

    if (firstWeekdayRowIndex != null) {
      sheet.views = [{ state: 'frozen', xSplit: 4, ySplit: firstWeekdayRowIndex }];
    }
  } else {
    const usedSheetNames = new Set();
    entries.forEach((entry) => {
      const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : {};
      const requestedName = clean(entry?.sheetName) || clean(payload.className) || 'Class';
      const sheetName = sanitizeExcelSheetName(requestedName, usedSheetNames);
      const sheetResult = appendAttendanceMatrixSheet(workbook, payload, { sheetName });
      if (!firstLegend) firstLegend = sheetResult.legend;
      if (!firstTitle) firstTitle = sheetResult.title;
      threadedCommentTargets.push(...(sheetResult.threadedCommentTargets || []));
    });
  }

  const buffer = await writeWorkbookBuffer(workbook, threadedCommentTargets);
  return {
    buffer,
    filename: buildStudentAttendanceExcelFilename({
      studentName: meta.studentName,
      startDate: meta.startDate,
      endDate: meta.endDate
    }),
    legend: firstLegend,
    title: firstTitle
  };
}

module.exports = {
  STATUS_EXPORT_META,
  STATUS_FILL_ARGB,
  NA_DAY_FILL_ARGB,
  EARLY_LEAVE_FILL_ARGB,
  LATE_AND_EARLY_FILL_ARGB,
  TIMING_LEGEND_ENTRIES,
  HEADER_FILL_ARGB,
  WEEKDAY_FILL_ARGB,
  ROW_BAND_FILL_ARGB,
  buildLegendEntries,
  statusToExportCode,
  resolveExportCellPresentation,
  formatExportCellDisplay,
  isOfficialExcusedAbsence,
  applyOfficialConsolidatedAttendanceCellStyle,
  resolveOfficialConsolidatedCellPresentation,
  buildOfficialLegendEntries,
  OFFICIAL_APPENDIX_EXCUSED_LABEL,
  OFFICIAL_GRID_EXCUSED_ABSENCE_CODE_GREEN_ARGB,
  statusFillArgb,
  buildLateExcusedCommentFragment,
  formatTimingMinutesFragment,
  formatTimingMinutesLabel,
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
  filterMatrixBySessionIds,
  parsePersonIdsFilter,
  splitDisplayName,
  resolveAttendanceTitle,
  resolveTitleMonthYear,
  buildExportFilename,
  buildStudentAttendanceExcelFilename,
  sanitizeExcelSheetName,
  fitColumnWidthToContent,
  writeAttendanceMatrixBlock,
  appendAttendanceMatrixSheet,
  normalizeStudentExcelSheetLayout,
  normalizeStudentExcelExportTemplate,
  normalizeOfficialIncludeTeacherName,
  formatOfficialReportLongDate,
  resolveOfficialAttendanceDateRangeTitle,
  STUDENT_EXCEL_SHEET_LAYOUT_PER_CLASS,
  STUDENT_EXCEL_SHEET_LAYOUT_SINGLE,
  STUDENT_EXCEL_TEMPLATE_CLASS_MATRIX,
  STUDENT_EXCEL_TEMPLATE_OFFICIAL,
  OFFICIAL_APPENDIX_SECTION_COLOR_ARGB,
  OFFICIAL_APPENDIX_CLASS_COLOR_ARGB,
  OFFICIAL_APPENDIX_DATETIME_COLOR_ARGB,
  OFFICIAL_APPENDIX_NOTE_COLOR_ARGB,
  formatOfficialExportClassName,
  formatOfficialTeacherShortName,
  formatOfficialSessionDateHeading,
  formatOfficialSessionDateTimeHeading,
  formatOfficialSessionTimeRange,
  buildOfficialAppendixClassHeading,
  shouldIncludeTimeInOfficialAppendixNotes,
  buildOfficialAppendixNoteText,
  buildOfficialAppendixNoteCellValue,
  OFFICIAL_APPENDIX_CLASS_DIVIDER_FILL_ARGB,
  resolveOfficialClassColumnWidth,
  resolveOfficialClassColumnCWidth,
  resolveOfficialLegendLabelColumnWidth,
  buildOfficialAppendixNoteBodyRichText,
  officialRecordHasExcusedTiming,
  resolveOfficialClassBufferColumnWidth,
  writeOfficialStudentAttendanceBlock,
  buildAttendanceExcelWorkbook,
  buildStudentAttendanceExcelWorkbook,
  buildOfficialStudentAttendanceExcelWorkbook
};
