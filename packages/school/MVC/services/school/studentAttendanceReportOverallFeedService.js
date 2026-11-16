'use strict';

const schoolDataService = require('./schoolDataService');
const { inferDaypartRankFromClassName, DAYPART_RANK } = require('./studentAttendanceReportClassOrderService');

function clean(value = '') {
  return String(value ?? '').trim();
}

function normalizeDateOnly(value = '') {
  const token = clean(value);
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function addDays(dateOnly, days) {
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function listDates(startDate, endDate) {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  if (!start || !end || end < start) return [];
  const dates = [];
  let cursor = start;
  while (cursor && cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function daypartRank(classRow = {}) {
  const minutes = Number(classRow.dominantStartMinutes);
  if (Number.isFinite(minutes)) return minutes < (12 * 60) ? DAYPART_RANK.AM : DAYPART_RANK.PM;
  if (Number.isFinite(Number(classRow.daypartRank))) return Number(classRow.daypartRank);
  return inferDaypartRankFromClassName(classRow.className || classRow.classId);
}

function enrollmentStartKey(classRow = {}, reportStart = '') {
  const windows = enrollmentWindowsForClass(classRow, reportStart, '9999-12-31');
  return windows.map((window) => window.start).filter(Boolean).sort()[0] || reportStart || '9999-12-31';
}

function pickDaypartClass(classRows = [], afternoon = false, reportStart = '') {
  const matching = classRows.filter((classRow) => {
    const rank = daypartRank(classRow);
    return afternoon ? rank === DAYPART_RANK.PM : rank !== DAYPART_RANK.PM;
  });
  matching.sort((left, right) => {
    const leftMinutes = Number.isFinite(Number(left.dominantStartMinutes)) ? Number(left.dominantStartMinutes) : 0;
    const rightMinutes = Number.isFinite(Number(right.dominantStartMinutes)) ? Number(right.dominantStartMinutes) : 0;
    if (leftMinutes !== rightMinutes) return leftMinutes - rightMinutes;
    const startDiff = enrollmentStartKey(left, reportStart).localeCompare(enrollmentStartKey(right, reportStart));
    if (startDiff !== 0) return startDiff;
    return clean(left.className || left.classId).localeCompare(clean(right.className || right.classId));
  });
  return matching[0] || null;
}

function attendanceGridIsLoaded(classRow = {}) {
  const days = Array.isArray(classRow.days) ? classRow.days : null;
  if (!days) return false;
  return days.some((day) => day && day.hasSession === true);
}

function hasCountableAttendance(classRow, date, reportStart, reportEnd) {
  if (!classIsEnrolledOnDate(classRow, date, reportStart, reportEnd)) return false;
  const days = Array.isArray(classRow.days) ? classRow.days : null;
  if (!days || !attendanceGridIsLoaded(classRow)) return true;
  const cell = days.find((day) => normalizeDateOnly(day?.date) === date);
  if (!cell || cell.hasSession === false || cell.withinEnrollmentWindow === false) return false;
  const status = clean(cell.status).toLowerCase();
  if (!status) return false;
  return !['not_applicable', 'n/a', 'na', 'notapplicable'].includes(status);
}

function feedSortMinutes(classRow = {}) {
  const minutes = Number(classRow.dominantStartMinutes);
  if (Number.isFinite(minutes)) return minutes;
  const rank = Number(classRow.daypartRank);
  if (rank === DAYPART_RANK.AM) return 9 * 60;
  if (rank === DAYPART_RANK.PM) return 13 * 60;
  return Number.MAX_SAFE_INTEGER;
}

function orderedClassesForFeed(classes = [], reportStart = '') {
  return [...classes].sort((left, right) => {
    const leftMinutes = feedSortMinutes(left);
    const rightMinutes = feedSortMinutes(right);
    if (leftMinutes !== rightMinutes) return leftMinutes - rightMinutes;
    const startDiff = enrollmentStartKey(left, reportStart).localeCompare(enrollmentStartKey(right, reportStart));
    if (startDiff !== 0) return startDiff;
    return clean(left.className || left.classId).localeCompare(clean(right.className || right.classId));
  });
}

function classCoversFullReport(classRow, reportStart, reportEnd) {
  return enrollmentWindowsForClass(classRow, reportStart, reportEnd)
    .some((window) => window.start <= reportStart && window.end >= reportEnd);
}

function buildFastSlotSegments(classes = [], reportStart = '', reportEnd = '') {
  const ordered = orderedClassesForFeed(classes, reportStart);
  if (ordered.length === 1) {
    return [{ start: reportStart, end: reportEnd, first: ordered[0], second: null }];
  }
  if (ordered.length === 2 && ordered.every((classRow) => classCoversFullReport(classRow, reportStart, reportEnd))) {
    return [{ start: reportStart, end: reportEnd, first: ordered[0], second: ordered[1] }];
  }
  return null;
}

function buildAttendanceSlotSegments(classes = [], reportStart = '', reportEnd = '') {
  const ordered = orderedClassesForFeed(classes, reportStart);
  const segments = [];
  listDates(reportStart, reportEnd).forEach((date) => {
    const withStatus = ordered.filter((classRow) => hasCountableAttendance(classRow, date, reportStart, reportEnd)).slice(0, 2);
    if (!withStatus.length) {
      const previous = segments[segments.length - 1];
      if (previous) previous.end = date;
      return;
    }
    const first = withStatus[0] || null;
    const second = withStatus[1] || null;
    const key = `${clean(first?.classId)}|${clean(second?.classId)}`;
    const previous = segments[segments.length - 1];
    if (previous && previous.key === key) {
      previous.end = date;
      return;
    }
    segments.push({ key, start: date, end: date, first, second });
  });
  return segments.filter((segment) => segment.first || segment.second);
}

function periodMatchesStudent(period = {}, personId = '', studentRecordId = '') {
  const periodPersonId = clean(period.personId);
  const periodStudentId = clean(period.studentId);
  if (personId && periodPersonId && periodPersonId === personId) return true;
  if (studentRecordId && periodStudentId && periodStudentId === studentRecordId) return true;
  return false;
}

function isSkippedPeriodStatus(status = '') {
  return ['void', 'voided', 'cancelled', 'canceled'].includes(clean(status).toLowerCase());
}

function clipWindow(startDate, endDate, reportStart, reportEnd) {
  const start = normalizeDateOnly(startDate) || reportStart;
  const end = normalizeDateOnly(endDate) || reportEnd;
  const clippedStart = start > reportStart ? start : reportStart;
  const clippedEnd = end < reportEnd ? end : reportEnd;
  if (!clippedStart || !clippedEnd || clippedStart > clippedEnd) return null;
  return { start: clippedStart, end: clippedEnd };
}

function enrollmentWindowsForClass(classRow = {}, reportStart = '', reportEnd = '') {
  const explicit = Array.isArray(classRow.enrollmentWindows) ? classRow.enrollmentWindows : null;
  if (!explicit) return [{ start: reportStart, end: reportEnd }];
  return explicit
    .map((window) => clipWindow(window.start, window.end, reportStart, reportEnd))
    .filter(Boolean);
}

function classIsEnrolledOnDate(classRow, date, reportStart, reportEnd) {
  return enrollmentWindowsForClass(classRow, reportStart, reportEnd)
    .some((window) => date >= window.start && date <= window.end);
}

function buildEnrollmentSegments(classes = [], reportStart = '', reportEnd = '') {
  const dates = listDates(reportStart, reportEnd);
  const segments = [];
  dates.forEach((date) => {
    const active = classes.filter((classRow) => classIsEnrolledOnDate(classRow, date, reportStart, reportEnd));
    const key = active.map((row) => clean(row.classId)).sort().join('|');
    const previous = segments[segments.length - 1];
    if (previous && previous.key === key) {
      previous.end = date;
      return;
    }
    segments.push({ key, start: date, end: date, classes: active });
  });
  return segments.filter((segment) => segment.classes.length);
}

function assignClassesToSlots(classRows = [], slots = []) {
  const sorted = [...classRows].sort((left, right) => {
    const daypartDiff = daypartRank(left) - daypartRank(right);
    if (daypartDiff !== 0) return daypartDiff;
    return clean(left.className || left.classId).localeCompare(clean(right.className || right.classId));
  });
  const used = new Set();
  const assigned = [];
  sorted.forEach((classRow) => {
    const rank = daypartRank(classRow);
    let slot = null;
    if (sorted.length === 1) {
      if (rank === DAYPART_RANK.PM && slots.length > 1) slot = slots[1];
      else slot = slots[0];
    } else if (rank === DAYPART_RANK.AM) {
      slot = slots.find((item, index) => index === 0 && !used.has(clean(item.slotKey).toUpperCase()))
        || slots.find((item) => !used.has(clean(item.slotKey).toUpperCase()));
    } else if (rank === DAYPART_RANK.PM) {
      slot = slots.find((item, index) => index === 1 && !used.has(clean(item.slotKey).toUpperCase()))
        || slots.find((item) => !used.has(clean(item.slotKey).toUpperCase()));
    } else {
      slot = slots.find((item) => !used.has(clean(item.slotKey).toUpperCase()));
    }
    if (!slot) return;
    const slotKey = clean(slot.slotKey).toUpperCase();
    used.add(slotKey);
    assigned.push({ slot, classRow });
  });
  return assigned;
}

function coalesceSlotPieces(pieces = []) {
  const sorted = [...pieces].sort((left, right) => clean(left.reportStartDate).localeCompare(clean(right.reportStartDate)));
  const merged = [];
  sorted.forEach((piece) => {
    const previous = merged[merged.length - 1];
    const previousNextDay = previous ? addDays(previous.reportDueDate, 1) : '';
    if (previous && previous.classId === piece.classId && previousNextDay && previousNextDay >= piece.reportStartDate) {
      if (piece.reportDueDate > previous.reportDueDate) previous.reportDueDate = piece.reportDueDate;
      return;
    }
    merged.push({ ...piece });
  });
  return merged;
}

function buildOverallSlotRuns({
  classes = [],
  slots = [],
  startDate = '',
  endDate = '',
  personId = '',
  templateId = '',
  selectedClassIds = null
} = {}) {
  const reportStart = normalizeDateOnly(startDate);
  const reportEnd = normalizeDateOnly(endDate);
  const warnings = [];
  const selectedSet = selectedClassIds instanceof Set ? selectedClassIds : null;
  const visibleClasses = (Array.isArray(classes) ? classes : []).filter((classRow) => {
    const classId = clean(classRow.classId);
    return !selectedSet || selectedSet.has(classId);
  });
  if (!visibleClasses.length || !slots.length || !reportStart || !reportEnd) {
    return { sourceRuns: [], warnings };
  }

  const bySlot = new Map();
  const slotByKey = new Map(slots.map((slot) => [clean(slot.slotKey).toUpperCase(), slot]));
  const morningSlot = slots[0];
  const afternoonSlot = slots[1] || null;
  const slotPlan = buildFastSlotSegments(visibleClasses, reportStart, reportEnd)
    || buildAttendanceSlotSegments(visibleClasses, reportStart, reportEnd);
  slotPlan.forEach((segment) => {
    [
      { slot: morningSlot, classRow: segment.first },
      { slot: afternoonSlot, classRow: segment.second }
    ].forEach(({ slot, classRow }) => {
      if (!slot || !classRow) return;
      const slotKey = clean(slot.slotKey).toUpperCase();
      const teacherId = clean(classRow.teacherId || classRow.teacherPersonId || classRow.instructorId);
      if (!teacherId) {
        warnings.push(`Class ${classRow.className || classRow.classId} has no teacher for slot ${slotKey}.`);
        return;
      }
      const pieces = bySlot.get(slotKey) || [];
      pieces.push({
        slotKey,
        templateId: clean(templateId || slot.templateId),
        classId: clean(classRow.classId),
        teacherId,
        reportStartDate: segment.start,
        reportDueDate: segment.end,
        reportScope: 'selected_students',
        targetStudentIds: [personId],
        format: 'json'
      });
      bySlot.set(slotKey, pieces);
    });
  });
  void slotByKey;

  const sourceRuns = [];
  slots.forEach((slot) => {
    const slotKey = clean(slot.slotKey).toUpperCase();
    const pieces = coalesceSlotPieces(bySlot.get(slotKey) || []);
    if (!pieces.length) return;
    if (pieces.length === 1) {
      sourceRuns.push(pieces[0]);
      return;
    }
    sourceRuns.push({
      ...pieces[0],
      reportStartDate: pieces[0].reportStartDate,
      reportDueDate: pieces[pieces.length - 1].reportDueDate,
      segments: pieces
    });
  });
  return { sourceRuns, warnings };
}

function describeOverallClassSlots(sourceRuns = [], classes = []) {
  const nameById = new Map((Array.isArray(classes) ? classes : []).map((classRow) => [
    clean(classRow.classId),
    clean(classRow.className) || clean(classRow.classId)
  ]));
  return ['T1', 'T2'].map((slotKey, index) => {
    const run = (Array.isArray(sourceRuns) ? sourceRuns : []).find((row) => clean(row.slotKey).toUpperCase() === slotKey) || null;
    const pieces = Array.isArray(run?.segments) && run.segments.length ? run.segments : (run ? [run] : []);
    return {
      slotKey,
      label: index === 0 ? 'Class slot 1' : 'Class slot 2',
      segments: pieces.map((piece) => ({
        classId: clean(piece.classId),
        className: nameById.get(clean(piece.classId)) || clean(piece.classId),
        startDate: clean(piece.reportStartDate),
        endDate: clean(piece.reportDueDate)
      }))
    };
  });
}

async function attachEnrollmentWindows(classes = [], student = {}, reportStart = '', reportEnd = '', reqUser = null) {
  const personId = clean(student.personId);
  const studentRecordId = clean(student.studentRecordId || student.studentId);
  const next = [];
  for (const classRow of (Array.isArray(classes) ? classes : [])) {
    const classId = clean(classRow.classId);
    let periods = [];
    if (classId && reqUser) {
      // eslint-disable-next-line no-await-in-loop
      periods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser).catch(() => []);
    }
    const windows = (Array.isArray(periods) ? periods : [])
      .filter((period) => !isSkippedPeriodStatus(period?.status) && periodMatchesStudent(period, personId, studentRecordId))
      .map((period) => clipWindow(period.startDate, period.endDate, reportStart, reportEnd))
      .filter(Boolean);
    next.push({
      ...classRow,
      enrollmentWindows: windows.length ? windows : (periods.length ? [] : [{ start: reportStart, end: reportEnd }])
    });
  }
  return next.filter((classRow) => classRow.enrollmentWindows.length);
}

function blankPlaceholderDaysOutside(engineResult = {}, monthStart = '', monthEnd = '', segmentStart = '', segmentEnd = '') {
  const start = normalizeDateOnly(monthStart);
  const end = normalizeDateOnly(monthEnd);
  const from = normalizeDateOnly(segmentStart);
  const to = normalizeDateOnly(segmentEnd);
  if (!start || !end || !from || !to) return engineResult;
  const rows = Array.isArray(engineResult?.rows) ? engineResult.rows : [];
  rows.forEach((row) => {
    const placeholders = row?.payload?.placeholders;
    if (!placeholders || typeof placeholders !== 'object') return;
    listDates(start, end).forEach((date, index) => {
      if (date >= from && date <= to) return;
      const day = String(index + 1).padStart(2, '0');
      ['attendance_presence_', 'attendance_note_'].forEach((prefix) => {
        const plain = `${prefix}${day}`;
        [plain, `{{${plain}}}`].forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(placeholders, key)) placeholders[key] = '';
        });
      });
    });
  });
  return engineResult;
}

function isEmptyMergeValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function dateTokens(value) {
  return String(value ?? '').match(/\d{4}-\d{2}-\d{2}/g) || [];
}

function earliestDateValue(left, right) {
  const dates = [...dateTokens(left), ...dateTokens(right)].sort();
  return dates[0] || (isEmptyMergeValue(left) ? right : left);
}

function latestDateValue(left, right) {
  const dates = [...dateTokens(left), ...dateTokens(right)].sort();
  return dates[dates.length - 1] || (isEmptyMergeValue(left) ? right : left);
}

function mergeFieldKey(key = '') {
  return clean(key).replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
}

function presenceMarks(value) {
  return String(value ?? '')
    .split(/[\n/]/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part && part !== 'X');
}

function mergePresenceMarks(left, right) {
  const marks = [...new Set([...presenceMarks(left), ...presenceMarks(right)])];
  if (!marks.length) return isEmptyMergeValue(left) && isEmptyMergeValue(right) ? '' : 'X';
  if (marks.length === 1) return marks[0];
  return marks.join('/');
}

function mergePlaceholderValue(left, right, key = '') {
  const fieldKey = mergeFieldKey(key);
  if (/^attendance_presence_\d{2}$/.test(fieldKey)) return mergePresenceMarks(left, right);
  if (fieldKey === 'report_period_start_date') return earliestDateValue(left, right);
  if (fieldKey === 'report_period_due_date') return latestDateValue(left, right);
  if (fieldKey === 'report_date' || fieldKey === 'report_period_month_name') {
    if (isEmptyMergeValue(left)) return right;
    if (isEmptyMergeValue(right)) return left;
    const leftText = String(left).trim();
    const rightText = String(right).trim();
    return leftText === rightText ? leftText : leftText.split('\n')[0].trim();
  }
  if (isEmptyMergeValue(left)) return right;
  if (isEmptyMergeValue(right)) return left;
  if (typeof left === 'number' && typeof right === 'number') return left + right;
  if (typeof left === 'string' && typeof right === 'string') {
    if (left === right) return left;
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (left.trim() !== '' && right.trim() !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber + rightNumber;
    }
    return `${left}\n${right}`;
  }
  if (Array.isArray(left) && Array.isArray(right)) return left.concat(right);
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const merged = { ...left };
    Object.keys(right).forEach((key) => {
      merged[key] = mergePlaceholderValue(merged[key], right[key], key);
    });
    return merged;
  }
  return right;
}

function mergeEngineResults(results = []) {
  const rowsByStudent = new Map();
  const warnings = [];
  (Array.isArray(results) ? results : []).forEach((result) => {
    (result?.warnings || []).forEach((warning) => warnings.push(warning));
    (Array.isArray(result?.rows) ? result.rows : []).forEach((row) => {
      const studentId = clean(row?.studentId);
      const existing = rowsByStudent.get(studentId);
      if (!existing) {
        rowsByStudent.set(studentId, {
          ...row,
          payload: {
            ...(row.payload || {}),
            placeholders: { ...((row.payload || {}).placeholders || {}) }
          }
        });
        return;
      }
      const left = existing.payload?.placeholders || {};
      const right = row.payload?.placeholders || {};
      const placeholders = { ...left };
      Object.keys(right).forEach((key) => {
        placeholders[key] = mergePlaceholderValue(placeholders[key], right[key], key);
      });
      existing.payload = { ...(existing.payload || {}), ...(row.payload || {}), placeholders };
    });
  });
  const first = results[0] || {};
  return {
    ...first,
    warnings,
    rows: [...rowsByStudent.values()]
  };
}

module.exports = {
  attachEnrollmentWindows,
  buildEnrollmentSegments,
  buildOverallSlotRuns,
  describeOverallClassSlots,
  blankPlaceholderDaysOutside,
  mergeEngineResults
};
