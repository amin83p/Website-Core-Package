(function (global) {
  'use strict';

  const TIMELINE_START_HOUR = 7;
  const TIMELINE_END_HOUR = 22;
  const TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60;
  const HOUR_SLOT_COUNT = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
  const TIMELINE_SNAP_MINUTES = 30;
  const TIMELINE_SNAP_THRESHOLD_MINUTES = 10;

  const VIEW_PRESETS = ['day', 'week', 'twoWeeks', 'thirtyDays', 'month', 'twoMonths', 'threeMonths', 'fourMonths', 'fiveMonths', 'sixMonths', 'wholeCycle', 'custom'];
  const VIEW_MODES = ['singleDay', 'vertical', 'timeline', 'month'];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeDateOnly(value) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }

  function parseAnchorDate(value, fallback = '') {
    const raw = normalizeDateOnly(value) || normalizeDateOnly(fallback);
    if (raw) return raw;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function clampAnchorDate(anchorDate, minDate) {
    const anchor = parseAnchorDate(anchorDate);
    const min = normalizeDateOnly(minDate);
    if (min && anchor < min) return min;
    return anchor;
  }

  function clampViewRangeToEnrollmentStart(viewRange = {}, enrollmentStartDate = '') {
    const min = normalizeDateOnly(enrollmentStartDate);
    if (!min) return viewRange;
    const anchor = parseAnchorDate(viewRange?.anchorDate);
    if (anchor >= min) return viewRange;
    return computeViewRange(String(viewRange?.preset || 'week').trim(), min);
  }

  function isWeekendDate(dateStr) {
    const date = normalizeDateOnly(dateStr);
    if (!date) return false;
    const day = new Date(`${date}T12:00:00`).getDay();
    return day === 0 || day === 6;
  }

  function hasHolidayDate(dateStr, holidayDates) {
    const date = normalizeDateOnly(dateStr);
    if (!date || !holidayDates) return false;
    if (holidayDates instanceof Set) return holidayDates.has(date);
    if (Array.isArray(holidayDates)) return holidayDates.includes(date);
    return false;
  }

  function buildDayCalendarClasses(dateStr, holidayDates, baseClass, ...extraClasses) {
    const classes = [baseClass, ...extraClasses].filter(Boolean);
    if (hasHolidayDate(dateStr, holidayDates)) classes.push('is-holiday');
    else if (isWeekendDate(dateStr)) classes.push('is-weekend');
    return classes.join(' ');
  }

  function buildDaySessionBadges(dayEvents, inRange) {
    if (!inRange || !Array.isArray(dayEvents) || !dayEvents.length) return '';
    let scheduled = 0;
    let staged = 0;
    dayEvents.forEach((ev) => {
      if (ev?.isStaged) staged += 1;
      else scheduled += 1;
    });
    let html = '<span class="session-cal-day-badges">';
    if (scheduled) {
      html += `<span class="session-cal-day-badge session-cal-day-badge-scheduled" title="${scheduled} scheduled">${scheduled}</span>`;
    }
    if (staged) {
      html += `<span class="session-cal-day-badge session-cal-day-badge-staged" title="${staged} staged">${staged}</span>`;
    }
    html += '</span>';
    return html;
  }

  function addDaysIso(dateStr, days) {
    const base = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(base.getTime())) return dateStr;
    base.setDate(base.getDate() + Number(days || 0));
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function endOfMonth(dateStr) {
    const base = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(base.getTime())) return dateStr;
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, '0');
    const d = String(end.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function startOfMonth(dateStr) {
    const base = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(base.getTime())) return dateStr;
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }

  function addMonthsIso(dateStr, months) {
    const base = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(base.getTime())) return dateStr;
    base.setMonth(base.getMonth() + Number(months || 0));
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function mondayOfWeek(dateStr) {
    const anchor = normalizeDateOnly(dateStr);
    if (!anchor) return anchor;
    return addDaysIso(anchor, -((new Date(`${anchor}T00:00:00`).getDay() + 6) % 7));
  }

  const WEEK_OF_MONTH_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

  function weekOfMonthWord(weekStartDateStr) {
    const monday = new Date(`${normalizeDateOnly(weekStartDateStr)}T12:00:00`);
    if (Number.isNaN(monday.getTime())) return '';
    const month = monday.getMonth();
    let mondayCount = 0;
    for (let day = 1; day <= monday.getDate(); day += 1) {
      const cursor = new Date(monday.getFullYear(), month, day);
      if (cursor.getDay() === 1) mondayCount += 1;
    }
    if (!mondayCount) return WEEK_OF_MONTH_WORDS[0];
    return WEEK_OF_MONTH_WORDS[Math.min(mondayCount - 1, WEEK_OF_MONTH_WORDS.length - 1)] || String(mondayCount);
  }

  function getIsoWeekYear(dateStr) {
    const date = new Date(`${normalizeDateOnly(dateStr)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return { week: 0, year: 0 };
    const target = new Date(date.getTime());
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
    const week1 = new Date(target.getFullYear(), 0, 4);
    const week = 1 + Math.round(((target - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return { week, year: target.getFullYear() };
  }

  function formatWeekLabel(weekStart, weekEnd) {
    const start = normalizeDateOnly(weekStart);
    const end = normalizeDateOnly(weekEnd) || start;
    if (!start) return '';
    const anchor = new Date(`${start}T12:00:00`);
    const monthName = Number.isNaN(anchor.getTime())
      ? ''
      : anchor.toLocaleDateString('en-US', { month: 'long' });
    const monthWeek = weekOfMonthWord(start);
    const iso = getIsoWeekYear(start);
    const monthWeekLabel = monthName && monthWeek ? `${monthName} Week ${monthWeek}` : '';
    const yearWeekLabel = iso.week ? `Year Week ${iso.week}` : '';
    const dateRangeLabel = end ? `${start} – ${end}` : start;
    return [monthWeekLabel, yearWeekLabel, dateRangeLabel].filter(Boolean).join(' - ');
  }

  function formatWeekLabelHtml(weekStart, weekEnd) {
    const start = normalizeDateOnly(weekStart);
    const end = normalizeDateOnly(weekEnd) || start;
    if (!start) return '';
    const anchor = new Date(`${start}T12:00:00`);
    const monthName = Number.isNaN(anchor.getTime())
      ? ''
      : anchor.toLocaleDateString('en-US', { month: 'long' });
    const monthWeek = weekOfMonthWord(start);
    const iso = getIsoWeekYear(start);
    const monthWeekLabel = monthName && monthWeek ? `${monthName} Week ${monthWeek}` : '';
    const yearWeekLabel = iso.week ? `Year Week ${iso.week}` : '';
    const dateRangeLabel = end ? `${start} – ${end}` : start;
    return `
      <span class="session-cal-week-label-primary">${escapeHtml(monthWeekLabel)}</span>
      <span class="session-cal-week-label-sep" aria-hidden="true">-</span>
      <span class="session-cal-week-label-year">${escapeHtml(yearWeekLabel)}</span>
      <span class="session-cal-week-label-sep" aria-hidden="true">-</span>
      <span class="session-cal-week-label-dates">${escapeHtml(dateRangeLabel)}</span>
    `;
  }

  function computeMonthSpanViewRange(anchor, monthSpan, presetKey) {
    const start = startOfMonth(anchor);
    const endAnchor = addMonthsIso(start, monthSpan - 1);
    return { startDate: start, endDate: endOfMonth(endAnchor), preset: presetKey, anchorDate: anchor };
  }

  function computeCustomViewRange(startDate = '', endDate = '') {
    const start = normalizeDateOnly(startDate);
    const end = normalizeDateOnly(endDate) || start;
    const anchor = start || parseAnchorDate('');
    const safeEnd = end >= anchor ? end : anchor;
    return { startDate: anchor, endDate: safeEnd, preset: 'custom', anchorDate: anchor };
  }

  function computeWholeCycleViewRange({ startDate = '', endDate = '' } = {}) {
    const start = normalizeDateOnly(startDate) || parseAnchorDate('');
    const end = normalizeDateOnly(endDate) || start;
    const safeEnd = end >= start ? end : start;
    return { startDate: start, endDate: safeEnd, preset: 'wholeCycle', anchorDate: start };
  }

  function clampViewRangeToBounds(viewRange = {}, { minDate = '', maxDate = '' } = {}) {
    const min = normalizeDateOnly(minDate);
    const max = normalizeDateOnly(maxDate);
    let start = normalizeDateOnly(viewRange?.startDate);
    let end = normalizeDateOnly(viewRange?.endDate);
    if (!start || !end) return viewRange;
    if (min && start < min) start = min;
    if (max && end > max) end = max;
    if (min && end < min) end = min;
    if (max && start > max) start = max;
    if (end < start) end = start;
    return {
      ...viewRange,
      startDate: start,
      endDate: end,
      anchorDate: normalizeDateOnly(viewRange?.anchorDate) || start
    };
  }

  function viewRangeDayCount(viewRange = {}) {
    const start = normalizeDateOnly(viewRange?.startDate);
    const end = normalizeDateOnly(viewRange?.endDate);
    if (!start || !end) return 1;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 1;
    return Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
  }

  function computeViewRange(preset = 'week', anchorDate = '', options = {}) {
    const anchor = parseAnchorDate(anchorDate);
    const key = String(preset || 'week').trim();
    if (key === 'custom') {
      return computeCustomViewRange(options.startDate || anchor, options.endDate || anchor);
    }
    if (key === 'wholeCycle') {
      return computeWholeCycleViewRange({
        startDate: options.startDate || anchor,
        endDate: options.endDate || anchor
      });
    }
    if (key === 'day') {
      return { startDate: anchor, endDate: anchor, preset: key, anchorDate: anchor };
    }
    if (key === 'week') {
      const start = mondayOfWeek(anchor);
      return { startDate: start, endDate: addDaysIso(start, 6), preset: key, anchorDate: anchor };
    }
    if (key === 'twoWeeks') {
      const start = mondayOfWeek(anchor);
      return { startDate: start, endDate: addDaysIso(start, 13), preset: key, anchorDate: anchor };
    }
    if (key === 'thirtyDays') {
      return { startDate: anchor, endDate: addDaysIso(anchor, 30), preset: key, anchorDate: anchor };
    }
    if (key === 'month') {
      const start = startOfMonth(anchor);
      return { startDate: start, endDate: endOfMonth(anchor), preset: key, anchorDate: anchor };
    }
    if (key === 'twoMonths') {
      return computeMonthSpanViewRange(anchor, 2, key);
    }
    if (key === 'threeMonths') {
      return computeMonthSpanViewRange(anchor, 3, key);
    }
    if (key === 'fourMonths') {
      return computeMonthSpanViewRange(anchor, 4, key);
    }
    if (key === 'fiveMonths') {
      return computeMonthSpanViewRange(anchor, 5, key);
    }
    if (key === 'sixMonths') {
      return computeMonthSpanViewRange(anchor, 6, key);
    }
    return { startDate: anchor, endDate: addDaysIso(anchor, 6), preset: 'week', anchorDate: anchor };
  }

  function shiftViewRange(viewRange = {}, direction = 1, options = {}) {
    const preset = String(viewRange?.preset || 'week').trim();
    const anchor = parseAnchorDate(viewRange?.anchorDate);
    const dir = Number(direction) >= 0 ? 1 : -1;
    if (preset === 'custom' || preset === 'wholeCycle') {
      const dayCount = viewRangeDayCount(viewRange);
      const shiftedStart = addDaysIso(normalizeDateOnly(viewRange?.startDate) || anchor, dir * dayCount);
      const shifted = computeViewRange(preset, shiftedStart, {
        startDate: shiftedStart,
        endDate: addDaysIso(shiftedStart, dayCount - 1)
      });
      return clampViewRangeToBounds(shifted, options);
    }
    if (preset === 'day') return computeViewRange(preset, addDaysIso(anchor, dir));
    if (preset === 'week') return computeViewRange(preset, addDaysIso(anchor, dir * 7));
    if (preset === 'twoWeeks') return computeViewRange(preset, addDaysIso(anchor, dir * 14));
    if (preset === 'thirtyDays') return computeViewRange(preset, addDaysIso(anchor, dir * 31));
    if (preset === 'month') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir));
    if (preset === 'twoMonths') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir * 2));
    if (preset === 'threeMonths') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir * 3));
    if (preset === 'fourMonths') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir * 4));
    if (preset === 'fiveMonths') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir * 5));
    if (preset === 'sixMonths') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir * 6));
    return computeViewRange('week', addDaysIso(anchor, dir * 7));
  }

  function suggestViewModeForPreset(preset = 'week') {
    const key = String(preset || 'week').trim();
    if (key === 'day') return 'singleDay';
    return 'vertical';
  }

  function isWeekRowPreset(preset = 'week') {
    const key = String(preset || 'week').trim();
    return key !== 'day';
  }

  function computeAutoDayWidth(container, options = {}) {
    const gutter = Number(options.gutterWidth || 56);
    const days = Number(options.dayCount || 7);
    const min = Number(options.min || 72);
    const max = Number(options.max || 280);
    if (!container) return Number(options.fallback || 140);
    const width = container.clientWidth || container.offsetWidth || 0;
    if (!width) return Number(options.fallback || 140);
    const padding = Number(options.padding || 16);
    const available = Math.max(0, width - gutter - padding);
    return Math.max(min, Math.min(max, Math.floor(available / days)));
  }

  function filterEventsByViewRange(events = [], viewRange = {}) {
    const start = normalizeDateOnly(viewRange?.startDate);
    const end = normalizeDateOnly(viewRange?.endDate);
    if (!start || !end) return Array.isArray(events) ? events : [];
    return (Array.isArray(events) ? events : []).filter((row) => {
      const date = normalizeDateOnly(row?.date);
      if (!date) return false;
      return date >= start && date <= end;
    });
  }

  function buildWeekBlocks(viewRange = {}, options = {}) {
    const rangeStart = normalizeDateOnly(viewRange?.startDate);
    const rangeEnd = normalizeDateOnly(viewRange?.endDate);
    const displayStart = normalizeDateOnly(options.displayStartDate || '');
    if (!rangeStart || !rangeEnd) return [];

    const firstMonday = mondayOfWeek(rangeStart);
    const lastSunday = addDaysIso(mondayOfWeek(rangeEnd), 6);
    const blocks = [];
    let weekStart = firstMonday;

    while (weekStart <= lastSunday) {
      const weekEnd = addDaysIso(weekStart, 6);
      const days = [];
      for (let i = 0; i < 7; i += 1) {
        const dateStr = addDaysIso(weekStart, i);
        const beforeEnrollmentStart = displayStart && dateStr < displayStart;
        days.push({
          date: dateStr,
          inRange: !beforeEnrollmentStart && dateStr >= rangeStart && dateStr <= rangeEnd
        });
      }
      blocks.push({ weekStart, weekEnd, days });
      weekStart = addDaysIso(weekStart, 7);
    }
    return blocks;
  }

  function outOfViewRangeDayClass(inRange) {
    return inRange ? '' : 'is-out-of-range is-outside-month';
  }

  function datePartsToIso(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function buildMonthGridDayCell(dateStr, dayLabel, eventsByDate, selectedSet, holidayDates, options = {}) {
    const outsideMonth = options.outsideMonth === true;
    const muted = options.muted === true;
    const dayEvents = eventsByDate[dateStr] || [];
    const count = dayEvents.length;
    const hasSelected = dayEvents.some((ev) => selectedSet && selectedSet.has(String(ev?.sessionId || '').trim()));
    let classes = buildDayCalendarClasses(dateStr, holidayDates, 'session-cal-day');
    if (outsideMonth || muted) classes += ' is-outside-month';
    if (count > 0) classes += ' has-events';
    if (hasSelected) classes += ' has-selected';
    else if (!count) classes += ' empty';
    return `
      <div class="${classes}" data-cal-date="${escapeHtml(dateStr)}" title="${count} session(s)">
        <span>${escapeHtml(String(dayLabel))}</span>
        ${count ? `<div><span class="session-cal-badge">${count}</span></div>` : ''}
      </div>
    `;
  }

  function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = String(timeStr).split(':').map(Number);
    return (h * 60) + (m || 0);
  }

  function calculatePosition(startStr, endStr) {
    let startMin = timeToMinutes(startStr);
    let endMin = timeToMinutes(endStr);
    const timelineStartMin = TIMELINE_START_HOUR * 60;
    const timelineEndMin = TIMELINE_END_HOUR * 60;
    if (startMin < timelineStartMin) startMin = timelineStartMin;
    if (endMin > timelineEndMin) endMin = timelineEndMin;
    if (endMin <= startMin) endMin = startMin + 30;
    const leftPercent = ((startMin - timelineStartMin) / TOTAL_MINUTES) * 100;
    const widthPercent = ((endMin - startMin) / TOTAL_MINUTES) * 100;
    return { left: leftPercent, width: widthPercent, startMin, endMin };
  }

  function groupEventsByDate(events) {
    const grouped = {};
    (Array.isArray(events) ? events : []).forEach((ev) => {
      const date = normalizeDateOnly(ev?.date);
      if (!date) return;
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(ev);
    });
    Object.keys(grouped).forEach((date) => {
      grouped[date].sort((a, b) => {
        const aStart = timeToMinutes(a?.start);
        const bStart = timeToMinutes(b?.start);
        if (aStart !== bStart) return aStart - bStart;
        return String(a?.teacherName || '').localeCompare(String(b?.teacherName || ''));
      });
    });
    return grouped;
  }

  function formatHours(hours) {
    const n = Number(hours || 0);
    if (!n) return '0 Hr';
    const rounded = Math.round(n * 100) / 100;
    return `${rounded} Hr${rounded === 1 ? '' : 's'}`;
  }

  function formatHourLabel(hour) {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  }

  function formatHourLabelCompact(hour) {
    return formatClockTime(`${String(hour).padStart(2, '0')}:00`, { alwaysShowMinutes: true });
  }

  function parseClockTimeParts(timeStr) {
    const raw = String(timeStr || '').trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  function formatClockTime(timeStr, options = {}) {
    const parts = parseClockTimeParts(timeStr);
    if (!parts) return String(timeStr || '').trim() || '-';
    const period = parts.hour >= 12 ? 'PM' : 'AM';
    const h12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
    const minuteText = String(parts.minute).padStart(2, '0');
    const clock = (parts.minute === 0 && !options.alwaysShowMinutes)
      ? String(h12)
      : `${h12}:${minuteText}`;
    return `${clock} ${period}`;
  }

  function formatClockTimeRange(startStr, endStr) {
    const start = parseClockTimeParts(startStr);
    const end = parseClockTimeParts(endStr);
    if (!start && !end) return '-';
    if (!start) return formatClockTime(endStr);
    if (!end) return formatClockTime(startStr);

    const startPeriod = start.hour >= 12 ? 'PM' : 'AM';
    const endPeriod = end.hour >= 12 ? 'PM' : 'AM';
    const formatPart = (parts, withPeriod) => {
      const h12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
      const minuteText = String(parts.minute).padStart(2, '0');
      const clock = parts.minute === 0 ? String(h12) : `${h12}:${minuteText}`;
      const period = parts.hour >= 12 ? 'PM' : 'AM';
      return withPeriod ? `${clock} ${period}` : clock;
    };

    if (startPeriod === endPeriod) {
      return `${formatPart(start, false)} – ${formatPart(end, true)}`;
    }
    return `${formatPart(start, true)} – ${formatPart(end, true)}`;
  }

  function formatDayHeaderParts(dateStr) {
    const normalized = normalizeDateOnly(dateStr);
    const dateObj = new Date(`${normalized}T12:00:00`);
    if (Number.isNaN(dateObj.getTime())) {
      return {
        weekdayShort: '',
        weekdayLong: '',
        monthShort: '',
        dayNum: '',
        year: ''
      };
    }
    return {
      weekdayShort: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      weekdayLong: dateObj.toLocaleDateString('en-US', { weekday: 'long' }),
      monthShort: dateObj.toLocaleDateString('en-US', { month: 'short' }),
      dayNum: String(dateObj.getDate()),
      year: String(dateObj.getFullYear())
    };
  }

  function formatDayHeaderHtml(dateStr, layout = 'vertical') {
    const parts = formatDayHeaderParts(dateStr);
    if (!parts.weekdayShort && !parts.dayNum) return escapeHtml(dateStr || '');
    const weekday = layout === 'horizontal' ? parts.weekdayShort : parts.weekdayShort;
    const dateLine = parts.monthShort && parts.dayNum
      ? `${parts.monthShort} ${parts.dayNum}`
      : normalizeDateOnly(dateStr);
    return `
      <span class="session-cal-day-header-content">
        <span class="session-cal-day-header-weekday">${escapeHtml(weekday)}</span>
        <span class="session-cal-day-header-date">${escapeHtml(dateLine)}</span>
      </span>
    `;
  }

  function formatDayHeaderShort(dateStr) {
    const parts = formatDayHeaderParts(dateStr);
    if (!parts.weekdayShort || !parts.dayNum) return String(dateStr || '').trim();
    return `${parts.weekdayShort} ${parts.monthShort} ${parts.dayNum}`;
  }

  function formatDayHeaderLong(dateStr) {
    const parts = formatDayHeaderParts(dateStr);
    if (!parts.weekdayLong || !parts.dayNum) return String(dateStr || '').trim();
    return `${parts.weekdayLong}, ${parts.monthShort} ${parts.dayNum}, ${parts.year}`;
  }

  function buildEnrollmentBlockHtml(ev, selectedSet) {
    const sessionId = String(ev?.sessionId || '').trim();
    const selectable = ev?.selectable === true;
    const selected = selectedSet && selectedSet.has(sessionId);
    const isStaged = ev?.isStaged === true;
    const classes = [
      'session-enrollment-block',
      isStaged ? 'is-staged' : 'is-scheduled',
      selected ? 'is-selected' : '',
      selectable ? '' : 'is-unselectable'
    ].filter(Boolean).join(' ');
    const tip = selectable ? '' : String(ev?.excludeReason || 'Not selectable');
    const statusLabel = isStaged ? 'Staged' : 'Scheduled';
    const manageUrl = String(ev?.manageSessionUrl || '').trim();
    const manageLink = manageUrl && ev?.manageable
      ? `<a class="session-manage-link" href="${escapeHtml(manageUrl)}" target="_blank" rel="noopener noreferrer" title="Manage session" data-session-manage="1"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>`
      : '';
    return `
      <div class="${classes}"
           data-session-id="${escapeHtml(sessionId)}"
           data-selectable="${selectable ? '1' : '0'}"
           data-session-kind="${isStaged ? 'staged' : 'scheduled'}"
           title="${escapeHtml(tip)}"
           role="button"
           aria-selected="${selected ? 'true' : 'false'}"
           tabindex="0">
        ${manageLink}
        <div class="session-block-status">${escapeHtml(statusLabel)}</div>
        <div class="session-block-teacher">${escapeHtml(ev?.teacherName || 'Teacher')}</div>
        <div class="session-block-hours">${escapeHtml(formatHours(ev?.durationHours))}</div>
      </div>
    `;
  }

  function assignTracks(dayEvents) {
    const tracks = [];
    dayEvents.forEach((ev) => {
      const pos = calculatePosition(ev.start, ev.end);
      ev.pos = pos;
      let placed = false;
      for (let i = 0; i < tracks.length; i += 1) {
        const lastEv = tracks[i][tracks[i].length - 1];
        if (lastEv.pos.endMin <= pos.startMin) {
          tracks[i].push(ev);
          ev.trackIndex = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        tracks.push([ev]);
        ev.trackIndex = tracks.length - 1;
      }
    });
    return tracks;
  }

  function formatSnappedTimelineLabel(offsetMinutes) {
    const timelineStartMin = TIMELINE_START_HOUR * 60;
    const total = timelineStartMin + Math.max(0, Math.round(offsetMinutes));
    const capped = Math.min(timelineStartMin + TOTAL_MINUTES, total);
    const h24 = Math.floor(capped / 60);
    const m = capped % 60;
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    if (m === 0) return `${h12} ${period}`;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  function snapTimelineOffsetMinutes(offsetMinutes, thresholdMinutes = TIMELINE_SNAP_THRESHOLD_MINUTES) {
    const raw = Math.max(0, Math.min(TOTAL_MINUTES, Number(offsetMinutes) || 0));
    const snapped = Math.round(raw / TIMELINE_SNAP_MINUTES) * TIMELINE_SNAP_MINUTES;
    const capped = Math.max(0, Math.min(TOTAL_MINUTES, snapped));
    if (Math.abs(raw - capped) > thresholdMinutes) return null;
    return capped;
  }

  function snapTimelineOffsetMinutesForClick(offsetMinutes) {
    const raw = Math.max(0, Math.min(TOTAL_MINUTES, Number(offsetMinutes) || 0));
    const snapped = Math.round(raw / TIMELINE_SNAP_MINUTES) * TIMELINE_SNAP_MINUTES;
    return Math.max(0, Math.min(TOTAL_MINUTES, snapped));
  }

  function offsetMinutesFromGridY(y, height) {
    const h = Number(height || 0);
    if (!h) return 0;
    const ratio = Math.max(0, Math.min(1, Number(y || 0) / h));
    return ratio * TOTAL_MINUTES;
  }

  function offsetMinutesFromGridX(x, width) {
    const w = Number(width || 0);
    if (!w) return 0;
    const ratio = Math.max(0, Math.min(1, Number(x || 0) / w));
    return ratio * TOTAL_MINUTES;
  }

  function timelineMinutesFromOffset(offsetMinutes) {
    return TIMELINE_START_HOUR * 60 + offsetMinutes;
  }

  function isPointerOverSessionUi(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(target.closest(
      '.session-enrollment-block, .session-cal-positioned-session, .session-manage-link, .event-block, .vertical-event-block'
    ));
  }

  function filterWeekDaysForDisplay(days, eventsByDate, filterEmptyDays) {
    const rows = Array.isArray(days) ? days : [];
    if (!filterEmptyDays) return rows;
    return rows.filter((day) => {
      if (!day?.inRange) return true;
      const count = (eventsByDate[day.date] || []).length;
      return count > 0;
    });
  }

  function resolvePositionedBlockHtml(ev, selectedSet, options, layout) {
    const build = options?.buildPositionedBlockHtml;
    if (typeof build === 'function') {
      return build(ev, { ...layout, selectedSet });
    }
    return buildEnrollmentBlockHtml(ev, selectedSet);
  }

  function resolveDayHeaderBadgeHtml(day, dayEvents, inRange, options) {
    const build = options?.buildDayHeaderBadgeHtml;
    if (typeof build === 'function') {
      return build(day, dayEvents, inRange);
    }
    return inRange ? buildDaySessionBadges(dayEvents, true) : '';
  }

  function resolveDayExtraClasses(day, dayEvents, inRange, mode, options) {
    const build = options?.buildDayExtraClasses;
    if (typeof build === 'function') {
      return String(build(day, dayEvents, inRange, mode) || '').trim();
    }
    return '';
  }

  function isSnappedTimeOccupiedOnDay(dayCell, snappedOffset) {
    if (!dayCell) return true;
    const snappedMin = timelineMinutesFromOffset(snappedOffset);
    const sessions = dayCell.querySelectorAll('.session-cal-positioned-session[data-timeline-start][data-timeline-end]');
    for (const el of sessions) {
      const startMin = Number(el.dataset.timelineStart);
      const endMin = Number(el.dataset.timelineEnd);
      if (Number.isFinite(startMin) && Number.isFinite(endMin) && startMin <= snappedMin && endMin > snappedMin) {
        return true;
      }
    }
    return false;
  }

  function isSnappedTimeOccupiedInTrack(trackEl, snappedOffset) {
    return isSnappedTimeOccupiedOnDay(trackEl, snappedOffset);
  }

  function formatDurationHrsMins(totalMinutes) {
    const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const hours = Math.floor(mins / 60);
    const remainder = mins % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours} Hr${hours === 1 ? '' : 's'}`);
    if (remainder > 0) parts.push(`${remainder} Mins`);
    if (!parts.length) return '0 Mins';
    return parts.join(' ');
  }

  function computeVerticalDragRange(startOffset, endOffset) {
    const anchorOffset = Math.max(0, Math.min(TOTAL_MINUTES, Number(startOffset) || 0));
    let end = Math.max(0, Math.min(TOTAL_MINUTES, Number(endOffset) || 0));
    if (end <= anchorOffset) {
      end = Math.min(TOTAL_MINUTES, anchorOffset + TIMELINE_SNAP_MINUTES);
    }
    let durationMinutes = end - anchorOffset;
    durationMinutes = Math.max(TIMELINE_SNAP_MINUTES, durationMinutes);
    if (anchorOffset + durationMinutes > TOTAL_MINUTES) {
      durationMinutes = TOTAL_MINUTES - anchorOffset;
    }
    const finalEndOffset = anchorOffset + durationMinutes;
    return {
      anchorOffset,
      endOffset: finalEndOffset,
      durationMinutes,
      durationHours: durationMinutes / 60
    };
  }

  function isSpanOccupiedOnDay(dayCell, startOffset, endOffset) {
    if (!dayCell) return true;
    const startMin = timelineMinutesFromOffset(startOffset);
    const endMin = timelineMinutesFromOffset(endOffset);
    const sessions = dayCell.querySelectorAll('.session-cal-positioned-session[data-timeline-start][data-timeline-end]');
    for (const el of sessions) {
      const sessionStart = Number(el.dataset.timelineStart);
      const sessionEnd = Number(el.dataset.timelineEnd);
      if (Number.isFinite(sessionStart) && Number.isFinite(sessionEnd) && sessionStart < endMin && sessionEnd > startMin) {
        return true;
      }
    }
    return false;
  }

  function buildVerticalDragOverlayHtml() {
    return '<div class="session-cal-drag-preview" aria-hidden="true"></div><div class="session-cal-drag-info" aria-hidden="true"></div>';
  }

  function buildVerticalDragContext(verticalRow, dayCell, anchorSnappedOffset, currentClientY) {
    if (!verticalRow || !dayCell || dayCell.classList.contains('is-out-of-range')) return null;
    const date = normalizeDateOnly(dayCell.getAttribute('data-cal-date'));
    if (!date) return null;
    const daysRow = verticalRow.querySelector('.session-cal-days-row');
    if (!daysRow) return null;
    const trackRect = daysRow.getBoundingClientRect();
    const y = currentClientY - trackRect.top;
    const snappedEnd = snapTimelineOffsetMinutesForClick(offsetMinutesFromGridY(y, trackRect.height));
    const range = computeVerticalDragRange(anchorSnappedOffset, snappedEnd);
    const occupied = isSpanOccupiedOnDay(dayCell, range.anchorOffset, range.endOffset);
    const startMin = timelineMinutesFromOffset(range.anchorOffset);
    return {
      mode: 'vertical',
      date,
      snappedOffsetMinutes: range.anchorOffset,
      endOffsetMinutes: range.endOffset,
      startTime24: minutesToTime24(startMin),
      startTimeLabel: formatSnappedTimelineLabel(range.anchorOffset),
      durationMinutes: range.durationMinutes,
      durationHours: range.durationHours,
      durationLabel: formatDurationHrsMins(range.durationMinutes),
      occupied
    };
  }

  function resolveVerticalDragContext(container, anchorClientX, anchorClientY, currentClientY, target) {
    if (!container || !target || typeof target.closest !== 'function') return null;
    if (isPointerOverSessionUi(target)) return null;
    const anchor = resolveGridClickContext(container, anchorClientX, anchorClientY, target);
    if (!anchor || anchor.mode !== 'vertical') return null;
    const verticalRow = target.closest('.session-cal-time-track');
    if (!verticalRow || !container.contains(verticalRow)) return null;
    const dayGrid = target.closest('.session-cal-day-grid');
    const dayCell = dayGrid
      ? dayGrid.closest('.session-cal-day-cell')
      : verticalRow.querySelector(`.session-cal-day-cell[data-cal-date="${anchor.date}"]`);
    if (!dayCell) return null;
    const context = buildVerticalDragContext(verticalRow, dayCell, anchor.snappedOffsetMinutes, currentClientY);
    if (!context || context.occupied) return null;
    return context;
  }

  function clearDragOverlays(container) {
    if (!container) return;
    container.querySelectorAll('.session-cal-day-grid.is-drag-active').forEach((grid) => {
      grid.classList.remove('is-drag-active');
      const preview = grid.querySelector('.session-cal-drag-preview');
      const info = grid.querySelector('.session-cal-drag-info');
      if (preview) {
        preview.style.display = 'none';
        preview.style.top = '';
        preview.style.height = '';
      }
      if (info) info.textContent = '';
    });
  }

  function updateDragOverlay(dayGrid, context) {
    if (!dayGrid || !context) return;
    const preview = dayGrid.querySelector('.session-cal-drag-preview');
    const info = dayGrid.querySelector('.session-cal-drag-info');
    if (!preview || !info) return;
    const topPct = (context.snappedOffsetMinutes / TOTAL_MINUTES) * 100;
    const heightPct = (context.durationMinutes / TOTAL_MINUTES) * 100;
    preview.style.display = 'block';
    preview.style.top = `${topPct}%`;
    preview.style.height = `${heightPct}%`;
    info.innerHTML = `Start Time: ${escapeHtml(context.startTimeLabel)}<br>Session Duration: ${escapeHtml(context.durationLabel)}`;
    dayGrid.classList.add('is-drag-active');
  }

  function bindCalendarDragCreate(container, options = {}) {
    if (!container) return;
    container._calendarDragCreateOptions = options;
    if (container.dataset.dragCreateBound === '1') return;
    container.dataset.dragCreateBound = '1';

    let dragState = null;

    function getOptions() {
      return container._calendarDragCreateOptions || {};
    }

    function detachDocumentListeners() {
      document.removeEventListener('pointermove', onDocumentPointerMove);
      document.removeEventListener('pointerup', onDocumentPointerUp);
      document.removeEventListener('pointercancel', onDocumentPointerUp);
    }

    function finishDrag(pointerId) {
      if (!dragState) return null;
      try {
        dragState.dayGrid?.releasePointerCapture?.(pointerId);
      } catch (_) {}
      detachDocumentListeners();
      const state = dragState;
      dragState = null;
      clearVerticalTimeHover(container);
      clearDragOverlays(container);
      return state;
    }

    function onDocumentPointerMove(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const opts = getOptions();
      if (!opts.enabled) return;
      clearVerticalTimeHover(container);
      const context = buildVerticalDragContext(
        dragState.verticalRow,
        dragState.dayCell,
        dragState.anchorSnappedOffset,
        event.clientY
      );
      if (!context) return;
      if (event.clientY > dragState.anchorClientY + 5) dragState.dragged = true;
      dragState.lastContext = context;
      updateDragOverlay(dragState.dayGrid, context);
      if (typeof opts.onDragUpdate === 'function') opts.onDragUpdate(context);
    }

    function onDocumentPointerUp(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const opts = getOptions();
      const state = finishDrag(event.pointerId);
      if (!state || !opts.enabled) return;

      let context = state.lastContext;
      if (!state.dragged) {
        const clickRange = computeVerticalDragRange(state.anchorSnappedOffset, state.anchorSnappedOffset + 60);
        if (!isSpanOccupiedOnDay(state.dayCell, clickRange.anchorOffset, clickRange.endOffset)) {
          const startMin = timelineMinutesFromOffset(clickRange.anchorOffset);
          context = {
            mode: 'vertical',
            date: state.anchorContext.date,
            snappedOffsetMinutes: clickRange.anchorOffset,
            endOffsetMinutes: clickRange.endOffset,
            startTime24: minutesToTime24(startMin),
            startTimeLabel: formatSnappedTimelineLabel(clickRange.anchorOffset),
            durationMinutes: 60,
            durationHours: 1,
            durationLabel: formatDurationHrsMins(60),
            occupied: false
          };
        }
      }

      if (!context || context.occupied) {
        if (typeof opts.onDragCancelled === 'function') opts.onDragCancelled();
        return;
      }

      if (typeof opts.setSuppressGridClick === 'function') opts.setSuppressGridClick(true);
      if (typeof opts.onDragComplete === 'function') opts.onDragComplete(context);
    }

    container.addEventListener('pointerdown', (event) => {
      const opts = getOptions();
      if (!opts.enabled) return;
      const grid = event.target.closest('.session-cal-day-grid');
      if (!grid || !container.contains(grid)) return;
      const verticalRow = event.target.closest('.session-cal-time-track');
      if (!verticalRow) return;
      if (isPointerOverSessionUi(event.target)) return;

      const anchor = resolveGridClickContext(container, event.clientX, event.clientY, event.target);
      if (!anchor || anchor.mode !== 'vertical') return;

      const dayCell = grid.closest('.session-cal-day-cell');
      if (!dayCell) return;

      event.preventDefault();
      dragState = {
        pointerId: event.pointerId,
        dayGrid: grid,
        dayCell,
        verticalRow,
        anchorClientX: event.clientX,
        anchorClientY: event.clientY,
        anchorSnappedOffset: anchor.snappedOffsetMinutes,
        anchorContext: anchor,
        dragged: false,
        lastContext: null
      };

      try {
        grid.setPointerCapture(event.pointerId);
      } catch (_) {}

      document.addEventListener('pointermove', onDocumentPointerMove);
      document.addEventListener('pointerup', onDocumentPointerUp);
      document.addEventListener('pointercancel', onDocumentPointerUp);
    });
  }

  function clearVerticalTimeHover(container) {
    if (!container) return;
    container.querySelectorAll('.session-cal-time-track.is-time-hover').forEach((row) => {
      row.classList.remove('is-time-hover');
    });
  }

  function updateVerticalTimeHover(row, clientY, target) {
    if (!row) return;
    if (isPointerOverSessionUi(target)) {
      row.classList.remove('is-time-hover');
      return;
    }
    const dayGrid = target && target.closest('.session-cal-day-grid');
    if (!dayGrid) {
      row.classList.remove('is-time-hover');
      return;
    }
    const dayCell = dayGrid.closest('.session-cal-day-cell');
    if (!dayCell || dayCell.classList.contains('is-out-of-range')) {
      row.classList.remove('is-time-hover');
      return;
    }
    const daysRow = row.querySelector('.session-cal-days-row');
    if (!daysRow) return;
    const trackRect = daysRow.getBoundingClientRect();
    if (clientY < trackRect.top || clientY > trackRect.bottom) {
      row.classList.remove('is-time-hover');
      return;
    }
    const y = clientY - trackRect.top;
    const height = trackRect.height;
    const snappedOffset = snapTimelineOffsetMinutes(offsetMinutesFromGridY(y, height));
    if (snappedOffset === null || isSnappedTimeOccupiedOnDay(dayCell, snappedOffset)) {
      row.classList.remove('is-time-hover');
      return;
    }
    const pct = (snappedOffset / TOTAL_MINUTES) * 100;
    const line = row.querySelector('.session-cal-hover-line');
    const label = row.querySelector('.session-cal-hover-time-label');
    if (line) line.style.top = `${pct}%`;
    if (label) {
      label.style.top = `${pct}%`;
      label.textContent = formatSnappedTimelineLabel(snappedOffset);
    }
    row.classList.add('is-time-hover');
  }

  function clearTimelineTimeHover(container) {
    if (!container) return;
    container.querySelectorAll('.session-cal-timeline-time-track.is-time-hover').forEach((row) => {
      row.classList.remove('is-time-hover');
    });
  }

  function updateTimelineTimeHover(weekRow, clientX, target) {
    if (!weekRow) return;
    if (isPointerOverSessionUi(target)) {
      weekRow.classList.remove('is-time-hover');
      return;
    }
    const track = target && target.closest('.session-cal-timeline-track');
    if (!track) {
      weekRow.classList.remove('is-time-hover');
      return;
    }
    const dayRow = track.closest('.session-cal-timeline-day-row');
    if (!dayRow || dayRow.classList.contains('is-out-of-range')) {
      weekRow.classList.remove('is-time-hover');
      return;
    }
    const shell = weekRow.querySelector('.session-cal-timeline-hover-shell');
    if (!shell) return;
    const trackRect = track.getBoundingClientRect();
    if (clientX < trackRect.left || clientX > trackRect.right) {
      weekRow.classList.remove('is-time-hover');
      return;
    }
    const x = clientX - trackRect.left;
    const width = trackRect.width;
    const snappedOffset = snapTimelineOffsetMinutes(offsetMinutesFromGridX(x, width));
    if (snappedOffset === null || isSnappedTimeOccupiedInTrack(track, snappedOffset)) {
      weekRow.classList.remove('is-time-hover');
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    const pct = snappedOffset / TOTAL_MINUTES;
    const lineLeft = trackRect.left - shellRect.left + pct * trackRect.width;
    const line = weekRow.querySelector('.session-cal-hover-line-vertical');
    const label = weekRow.querySelector('.session-cal-hover-time-label-horizontal');
    if (line) line.style.left = `${lineLeft}px`;
    if (label) {
      label.style.left = `${lineLeft}px`;
      label.textContent = formatSnappedTimelineLabel(snappedOffset);
    }
    weekRow.classList.add('is-time-hover');
  }

  function clearCalendarTimeHover(container) {
    clearVerticalTimeHover(container);
    clearTimelineTimeHover(container);
  }

  function bindCalendarTimeHover(container) {
    if (!container) return;
    if (container.dataset.timeHoverBound === '1') return;
    container.dataset.timeHoverBound = '1';
    container.addEventListener('mousemove', (event) => {
      const verticalRow = event.target.closest('.session-cal-time-track');
      const timelineWeek = event.target.closest('.session-cal-timeline-time-track');
      if (verticalRow) {
        clearTimelineTimeHover(container);
        clearVerticalTimeHover(container);
        updateVerticalTimeHover(verticalRow, event.clientY, event.target);
        return;
      }
      if (timelineWeek) {
        clearVerticalTimeHover(container);
        clearTimelineTimeHover(container);
        updateTimelineTimeHover(timelineWeek, event.clientX, event.target);
        return;
      }
      clearCalendarTimeHover(container);
    });
    container.addEventListener('mouseleave', () => clearCalendarTimeHover(container));
  }

  function bindVerticalTimeHover(container) {
    bindCalendarTimeHover(container);
  }

  function buildVerticalTimeGutterHtml() {
    let html = '<div class="session-cal-time-gutter" aria-hidden="true">';
    for (let h = TIMELINE_START_HOUR; h < TIMELINE_END_HOUR; h += 1) {
      html += `<div class="session-cal-hour-slot"><span class="session-cal-hour-label">${formatHourLabelCompact(h)}</span></div>`;
    }
    html += '</div>';
    return html;
  }

  function buildHorizontalTimeHeaderHtml() {
    let html = '<div class="session-cal-time-header" aria-hidden="true">';
    for (let h = TIMELINE_START_HOUR; h < TIMELINE_END_HOUR; h += 1) {
      html += `<div class="session-cal-hour-slot session-cal-hour-header-slot"><span class="session-cal-hour-label">${formatHourLabel(h)}</span></div>`;
    }
    html += '</div>';
    return html;
  }

  function buildHourGridBackgroundHtml() {
    let html = '<div class="session-cal-hour-grid" aria-hidden="true">';
    for (let h = TIMELINE_START_HOUR; h < TIMELINE_END_HOUR; h += 1) {
      html += '<div class="session-cal-hour-grid-line"></div>';
    }
    html += '</div>';
    return html;
  }

  function renderVerticalDayCell(dateStr, dayEvents, inRange, holidayDates, options = {}) {
    const selectedSet = options.selectedSet || null;
    const tracks = assignTracks((dayEvents || []).slice());
    const trackCount = Math.max(1, tracks.length);
    const extraClass = resolveDayExtraClasses({ date: dateStr, inRange }, dayEvents, inRange, 'vertical', options);
    const dayClass = buildDayCalendarClasses(
      dateStr,
      holidayDates,
      'session-cal-day-cell',
      outOfViewRangeDayClass(inRange),
      extraClass
    );
    let sessionsHtml = '';
    (dayEvents || []).forEach((ev) => {
      const trackLeft = (ev.trackIndex / trackCount) * 100;
      const trackWidth = 100 / trackCount;
      const blockHeight = Math.max(1, Number(ev.pos?.width || 0));
      const blockHtml = resolvePositionedBlockHtml(ev, selectedSet, options, {
        mode: 'vertical',
        trackLeft,
        trackWidth,
        blockHeight,
        trackIndex: ev.trackIndex,
        trackCount
      });
      sessionsHtml += `<div class="session-cal-positioned-session session-cal-positioned-vertical" data-timeline-start="${ev.pos.startMin}" data-timeline-end="${ev.pos.endMin}" style="top:${ev.pos.left}%;height:calc(${blockHeight}% - 4px);left:${trackLeft}%;width:calc(${trackWidth}% - 4px);">${blockHtml}</div>`;
    });
    return `
      <div class="${dayClass}" data-cal-date="${escapeHtml(dateStr)}">
        <div class="session-cal-day-grid">
          ${buildHourGridBackgroundHtml()}
          ${sessionsHtml}
          ${buildVerticalDragOverlayHtml()}
        </div>
      </div>
    `;
  }

  function renderVerticalWeekGrid(eventsByDate, container, selectedSet, options = {}) {
    const viewRange = options.viewRange || computeViewRange(options.viewPreset || 'week', options.anchorDate || '');
    const blockOptions = { displayStartDate: options.enrollmentStartDate || '' };
    const weekBlocks = buildWeekBlocks(viewRange, blockOptions);
    if (!weekBlocks.length) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return false;
    }

    const dayWidth = Number(options.dayWidth || 140);
    const hourHeight = Math.max(20, Number(options.hourHeight || 28));
    const holidayDates = options.holidayDates || null;
    const filterEmptyDays = options.filterEmptyDays === true;
    const cellOptions = { ...options, selectedSet };
    container.style.setProperty('--session-day-width', `${dayWidth}px`);
    container.style.setProperty('--session-time-gutter-width', '76px');
    container.style.setProperty('--session-hour-height', `${hourHeight}px`);
    let renderedWeekCount = 0;
    let visibleDayCount = 0;

    let html = '<div class="session-cal-vertical-scroll"><div class="session-cal-week-stack">';
    weekBlocks.forEach((week) => {
      const days = filterWeekDaysForDisplay(week.days, eventsByDate, filterEmptyDays);
      if (!days.length) return;
      renderedWeekCount += 1;
      visibleDayCount = Math.max(visibleDayCount, days.length);
      html += `
        <div class="session-cal-week-row">
          <div class="session-cal-week-label">${formatWeekLabelHtml(week.weekStart, week.weekEnd)}</div>
          <div class="session-cal-week-grid-vertical">
            <div class="session-cal-day-header-row">
              <div class="session-cal-time-gutter-spacer" aria-hidden="true"></div>
      `;
      days.forEach((day) => {
        const dayEvents = eventsByDate[day.date] || [];
        const headerExtra = resolveDayExtraClasses(day, dayEvents, day.inRange, 'vertical-header', cellOptions);
        const headerClass = buildDayCalendarClasses(
          day.date,
          holidayDates,
          'session-cal-day-header',
          outOfViewRangeDayClass(day.inRange),
          headerExtra
        );
        html += `
          <div class="${headerClass}">
            ${formatDayHeaderHtml(day.date, 'vertical')}
            ${resolveDayHeaderBadgeHtml(day, dayEvents, day.inRange, cellOptions)}
          </div>
        `;
      });
      html += `
            </div>
            <div class="session-cal-week-body-row session-cal-time-track">
              ${buildVerticalTimeGutterHtml()}
              <div class="session-cal-days-row">
      `;
      days.forEach((day) => {
        const dayEvents = day.inRange ? (eventsByDate[day.date] || []) : [];
        html += renderVerticalDayCell(day.date, dayEvents, day.inRange, holidayDates, cellOptions);
      });
      html += '</div><div class="session-cal-hover-line" aria-hidden="true"></div><div class="session-cal-hover-time-label" aria-hidden="true"></div></div></div></div>';
    });
    html += '</div></div>';
    if (!renderedWeekCount) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return false;
    }
    container.dataset.sessionVisibleDayCount = String(visibleDayCount || 7);
    container.innerHTML = html;
    if (options.enableTimeHover !== false) {
      bindVerticalTimeHover(container);
    }
    return true;
  }

  function renderHorizontalWeekGrid(eventsByDate, container, selectedSet, options = {}) {
    const viewRange = options.viewRange || computeViewRange(options.viewPreset || 'week', options.anchorDate || '');
    const blockOptions = { displayStartDate: options.enrollmentStartDate || '' };
    const weekBlocks = buildWeekBlocks(viewRange, blockOptions);
    if (!weekBlocks.length) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return false;
    }

    const holidayDates = options.holidayDates || null;
    const filterEmptyDays = options.filterEmptyDays === true;
    const timelineTrackStep = Math.max(48, Number(options.timelineTrackStep || 76));
    const hourHeight = Math.max(20, Number(options.hourHeight || 28));
    const cellOptions = { ...options, selectedSet };
    container.style.setProperty('--session-hour-height', `${hourHeight}px`);
    container.style.setProperty('--session-timeline-track-step', `${timelineTrackStep}px`);
    let renderedWeekCount = 0;

    let html = '<div class="session-cal-vertical-scroll"><div class="session-cal-week-stack session-cal-week-stack-timeline">';
    weekBlocks.forEach((week) => {
      const days = filterWeekDaysForDisplay(week.days, eventsByDate, filterEmptyDays);
      if (!days.length) return;
      renderedWeekCount += 1;
      html += `
        <div class="session-cal-week-row session-cal-week-row-timeline session-cal-timeline-time-track">
          <div class="session-cal-week-label">${formatWeekLabelHtml(week.weekStart, week.weekEnd)}</div>
          <div class="session-cal-timeline-hover-shell">
            <div class="session-cal-timeline-header-row">
              <div class="session-cal-day-label-spacer" aria-hidden="true"></div>
              <div class="session-cal-time-header-wrap">
                ${buildHorizontalTimeHeaderHtml()}
              </div>
            </div>
      `;
      days.forEach((day) => {
        const dayEvents = day.inRange ? (eventsByDate[day.date] || []) : [];
        assignTracks(dayEvents.slice());
        const tracks = [];
        dayEvents.forEach((ev) => {
          if (!tracks[ev.trackIndex]) tracks[ev.trackIndex] = [];
          tracks[ev.trackIndex].push(ev);
        });
        const trackCount = Math.max(1, tracks.length);
        const bodyHeight = Math.max(72, trackCount * timelineTrackStep + 12);
        const extraClass = resolveDayExtraClasses(day, dayEvents, day.inRange, 'timeline', cellOptions);
        const rowClass = buildDayCalendarClasses(
          day.date,
          holidayDates,
          'session-cal-timeline-day-row',
          outOfViewRangeDayClass(day.inRange),
          extraClass
        );
        let sessionsHtml = '';
        dayEvents.forEach((ev) => {
          const topPos = (ev.trackIndex * timelineTrackStep) + 4;
          const blockHeight = Math.max(48, timelineTrackStep - 8);
          const block = resolvePositionedBlockHtml(ev, selectedSet, cellOptions, {
            mode: 'timeline',
            topPos,
            trackIndex: ev.trackIndex,
            trackCount
          });
          sessionsHtml += `<div class="session-cal-positioned-session session-cal-positioned-horizontal" data-timeline-start="${ev.pos.startMin}" data-timeline-end="${ev.pos.endMin}" data-track-index="${ev.trackIndex}" style="left:${ev.pos.left}%;width:${ev.pos.width}%;top:${topPos}px;height:${blockHeight}px;">${block}</div>`;
        });
        html += `
          <div class="${rowClass}" data-cal-date="${escapeHtml(day.date)}">
            <div class="session-cal-day-row-label">${formatDayHeaderHtml(day.date, 'horizontal')}</div>
            <div class="session-cal-timeline-track" style="height:${bodyHeight}px;">
              ${buildHourGridBackgroundHtml()}
              ${sessionsHtml}
            </div>
          </div>
        `;
      });
      html += '<div class="session-cal-hover-line-vertical" aria-hidden="true"></div><div class="session-cal-hover-time-label-horizontal" aria-hidden="true"></div></div></div>';
    });
    html += '</div></div>';
    if (!renderedWeekCount) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return false;
    }
    container.innerHTML = html;
    if (options.enableTimeHover !== false) {
      bindCalendarTimeHover(container);
    }
    return true;
  }

  function renderSingleDayList(eventsByDate, container, selectedSet, displayStartDate = '', options = {}) {
    container.innerHTML = '';
    const displayStart = normalizeDateOnly(displayStartDate);
    const dates = Object.keys(eventsByDate || {}).sort().filter((dateStr) => !displayStart || dateStr >= displayStart);
    if (!dates.length) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return;
    }
    const buildCard = options?.buildListDayCardHtml;
    let html = '<div class="session-cal-vertical-scroll"><div class="single-day-list">';
    dates.forEach((dateStr) => {
      const dateObj = new Date(`${dateStr}T00:00:00`);
      const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      html += `<div class="small fw-semibold text-muted mb-2">${escapeHtml(displayDate)}</div>`;
      (eventsByDate[dateStr] || []).forEach((ev) => {
        if (typeof buildCard === 'function') {
          html += buildCard(ev, selectedSet);
          return;
        }
        const sessionId = String(ev?.sessionId || '').trim();
        const selectable = ev?.selectable === true;
        const selected = selectedSet && selectedSet.has(sessionId);
        const classes = [
          'session-day-card',
          ev?.isStaged ? 'is-staged' : 'is-scheduled',
          selected ? 'is-selected' : '',
          selectable ? '' : 'is-unselectable'
        ].filter(Boolean).join(' ');
        const statusLabel = ev?.isStaged ? 'Staged' : 'Scheduled';
        const manageUrl = String(ev?.manageSessionUrl || '').trim();
        html += `
          <div class="${classes}" data-session-id="${escapeHtml(sessionId)}" data-selectable="${selectable ? '1' : '0'}" data-session-kind="${ev?.isStaged ? 'staged' : 'scheduled'}" role="button" aria-selected="${selected ? 'true' : 'false'}">
            <div class="flex-grow-1">
              <div class="d-flex align-items-center gap-2 mb-1">
                <span class="session-block-status session-block-status-inline">${escapeHtml(statusLabel)}</span>
                <div class="fw-semibold">${escapeHtml(ev?.teacherName || 'Teacher')}</div>
              </div>
              <div class="small text-muted">${escapeHtml([ev.start, ev.end].filter(Boolean).join(' – ') || dateStr)} · ${escapeHtml(formatHours(ev?.durationHours))}</div>
            </div>
            ${manageUrl ? `<a class="btn btn-sm btn-outline-secondary" href="${escapeHtml(manageUrl)}" target="_blank" rel="noopener noreferrer" data-session-manage="1">Manage</a>` : ''}
          </div>
        `;
      });
    });
    html += '</div></div>';
    container.innerHTML = html;
  }

  function renderMonthGrid(eventsByDate, startStr, endStr, container, selectedSet, holidayDates, displayStartDate = '') {
    const displayStart = normalizeDateOnly(displayStartDate);
    let current = new Date(`${startStr}T00:00:00`);
    current.setDate(1);
    const end = new Date(`${endStr}T00:00:00`);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    let html = '<div class="row g-3">';
    while (current <= end) {
      const year = current.getFullYear();
      const month = current.getMonth();
      const monthName = current.toLocaleString('default', { month: 'long', year: 'numeric' });
      const firstDayIndex = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();
      const prevMonthIndex = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      html += `
        <div class="col-md-6 col-lg-4">
          <div class="card h-100 shadow-sm border-0">
            <div class="card-header bg-dark text-white text-center fw-bold py-2">${escapeHtml(monthName)}</div>
            <div class="card-body p-2 bg-light">
              <div class="session-cal-grid">
      `;
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => {
        html += `<div class="text-center x-small fw-bold text-muted">${d}</div>`;
      });
      for (let i = 0; i < firstDayIndex; i += 1) {
        const d = daysInPrevMonth - firstDayIndex + i + 1;
        const dateStr = datePartsToIso(prevYear, prevMonthIndex, d);
        html += buildMonthGridDayCell(dateStr, d, eventsByDate, selectedSet, holidayDates, { outsideMonth: true });
      }
      for (let d = 1; d <= daysInMonth; d += 1) {
        const dateStr = datePartsToIso(year, month, d);
        if (displayStart && dateStr < displayStart) {
          html += buildMonthGridDayCell(dateStr, d, eventsByDate, selectedSet, holidayDates, { muted: true });
          continue;
        }
        html += buildMonthGridDayCell(dateStr, d, eventsByDate, selectedSet, holidayDates);
      }
      const cellsSoFar = firstDayIndex + daysInMonth;
      const trailing = (7 - (cellsSoFar % 7)) % 7;
      const nextMonthIndex = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      for (let d = 1; d <= trailing; d += 1) {
        const dateStr = datePartsToIso(nextYear, nextMonthIndex, d);
        html += buildMonthGridDayCell(dateStr, d, eventsByDate, selectedSet, holidayDates, { outsideMonth: true });
      }
      html += '</div></div></div></div>';
      current.setMonth(current.getMonth() + 1);
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function renderEnrollmentCalendar(container, events, options = {}) {
    if (!container) return;
    const viewMode = String(options.viewMode || suggestViewModeForPreset(options.viewPreset || 'week')).trim();
    const viewRange = options.viewRange || computeViewRange(options.viewPreset || 'week', options.anchorDate || '');
    const selectedSet = options.selectedSet || new Set();
    const eventsByDate = groupEventsByDate(events);
    const gridOptions = {
      viewPreset: options.viewPreset,
      viewRange,
      anchorDate: options.anchorDate,
      dayWidth: options.dayWidth,
      holidayDates: options.holidayDates || null,
      enrollmentStartDate: options.enrollmentStartDate || '',
      buildPositionedBlockHtml: options.buildPositionedBlockHtml,
      buildListDayCardHtml: options.buildListDayCardHtml,
      buildDayHeaderBadgeHtml: options.buildDayHeaderBadgeHtml,
      buildDayExtraClasses: options.buildDayExtraClasses
    };

    if (viewMode === 'singleDay') {
      renderSingleDayList(eventsByDate, container, selectedSet, gridOptions.enrollmentStartDate, gridOptions);
      return;
    }
    if (viewMode === 'timeline') {
      renderHorizontalWeekGrid(eventsByDate, container, selectedSet, gridOptions);
      return;
    }
    if (viewMode === 'month' && !isWeekRowPreset(options.viewPreset || viewRange.preset)) {
      renderMonthGrid(
        eventsByDate,
        viewRange.startDate,
        viewRange.endDate,
        container,
        selectedSet,
        gridOptions.holidayDates,
        gridOptions.enrollmentStartDate
      );
      return;
    }
    renderVerticalWeekGrid(eventsByDate, container, selectedSet, gridOptions);
  }

  function summarizeSelectionFromEvents(events, selectedSet) {
    const selectedEvents = (Array.isArray(events) ? events : []).filter((row) => {
      const id = String(row?.sessionId || '').trim();
      return id && selectedSet && selectedSet.has(id);
    });
    const selectedCount = selectedEvents.length;
    const selectedHours = Math.round(selectedEvents.reduce((sum, row) => sum + Number(row?.durationHours || 0), 0) * 100) / 100;
    const dates = selectedEvents.map((row) => normalizeDateOnly(row?.date)).filter(Boolean).sort();
    return {
      selectedCount,
      selectedHours,
      selectionStartDate: dates[0] || '',
      selectionEndDate: dates.length ? dates[dates.length - 1] : ''
    };
  }

  function sessionScheduleKey(row = {}) {
    const date = normalizeDateOnly(row?.date || row?.sessionDate || '');
    const start = String(row?.startTime || row?.start || '').trim();
    const end = String(row?.endTime || row?.end || '').trim();
    return `${date}|${start}|${end}`;
  }

  function normalizeSessionTimes(row = {}) {
    const startRaw = String(row?.startTime || row?.start || '').trim();
    const endRaw = String(row?.endTime || row?.end || '').trim();
    const startMin = timeToMinutes(startRaw);
    const endMin = timeToMinutes(endRaw);
    return {
      startTime: startRaw ? minutesToTime24(startMin) : '',
      endTime: endRaw ? minutesToTime24(endMin) : ''
    };
  }

  function sessionTimeWindowKey(row = {}) {
    const { startTime, endTime } = normalizeSessionTimes(row);
    if (!startTime || !endTime) return '';
    return `${startTime}|${endTime}`;
  }

  function matchesSessionTimeWindow(ev = {}, startTime = '', endTime = '') {
    const eventKey = sessionTimeWindowKey(ev);
    const targetKey = sessionTimeWindowKey({ start: startTime, end: endTime });
    return Boolean(eventKey && targetKey && eventKey === targetKey);
  }

  function countSessionsByTimeWindow(events = [], startTime = '', endTime = '') {
    return (Array.isArray(events) ? events : []).filter((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      const date = normalizeDateOnly(ev?.date);
      return sessionId && date && matchesSessionTimeWindow(ev, startTime, endTime);
    }).length;
  }

  function countTimeSlotSessionsInRange(events = [], startTime = '', endTime = '', startDate = '', endDate = '') {
    return (Array.isArray(events) ? events : []).filter((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      const date = normalizeDateOnly(ev?.date);
      if (!sessionId || !date) return false;
      if (!matchesSessionTimeWindow(ev, startTime, endTime)) return false;
      return isDateWithinInclusiveRange(date, startDate, endDate);
    }).length;
  }

  function collectTimeSlotSessions(events = [], pendingMap = null, options = {}) {
    const times = normalizeSessionTimes({ start: options.startTime, end: options.endTime });
    const startTime = times.startTime;
    const endTime = times.endTime;
    const startDate = normalizeDateOnly(options.startDate);
    const endDate = normalizeDateOnly(options.endDate);
    const action = String(options.action || '').trim().toLowerCase();
    let limitCount = Number.parseInt(String(options.limitCount ?? ''), 10);
    if (!Number.isFinite(limitCount) || limitCount <= 0) limitCount = 0;

    let rows = (Array.isArray(events) ? events : []).filter((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      const date = normalizeDateOnly(ev?.date);
      if (!sessionId || !date) return false;
      if (!matchesSessionTimeWindow(ev, startTime, endTime)) return false;
      if (!isDateWithinInclusiveRange(date, startDate, endDate)) return false;
      const naState = resolveEnrollmentNaState(ev, pendingMap);
      if (action === 'mark_na') return naState === 'normal';
      if (action === 'unmark') return naState !== 'normal';
      return false;
    });
    rows.sort((a, b) => normalizeDateOnly(a?.date).localeCompare(normalizeDateOnly(b?.date)));
    if (limitCount > 0 && rows.length > limitCount) {
      rows = rows.slice(0, limitCount);
    }
    return rows;
  }

  function getSessionDate(row = {}) {
    return normalizeDateOnly(row?.date || row?.sessionDate || row?.startDate || '');
  }

  function minutesToTime24(totalMinutes) {
    const mins = Math.max(0, Math.min((24 * 60) - 1, Math.round(Number(totalMinutes) || 0)));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function addDurationToTime(startTime, durationHours) {
    const startMin = timeToMinutes(startTime);
    const addMin = Math.round(Number(durationHours || 0) * 60);
    return minutesToTime24(startMin + addMin);
  }

  function computeDurationHoursFromTimes(startTime, endTime) {
    const diff = timeToMinutes(endTime) - timeToMinutes(startTime);
    return Math.round((diff / 60) * 100) / 100;
  }

  function normalizeWeekdays(weekdays = []) {
    const set = new Set();
    (Array.isArray(weekdays) ? weekdays : []).forEach((value) => {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
    });
    return Array.from(set).sort((a, b) => a - b);
  }

  function buildRotationWeekdayOrder(selectedWeekdays, anchorDate) {
    const sorted = normalizeWeekdays(selectedWeekdays);
    if (!sorted.length) return [];
    const anchor = normalizeDateOnly(anchorDate);
    const anchorDow = anchor ? new Date(`${anchor}T12:00:00`).getDay() : sorted[0];
    let startIdx = sorted.indexOf(anchorDow);
    if (startIdx < 0) startIdx = 0;
    const order = [];
    for (let i = 0; i < sorted.length; i += 1) {
      order.push(sorted[(startIdx + i) % sorted.length]);
    }
    return order;
  }

  function findNextWeekdayAfter(lastDate, targetDow, rangeEnd) {
    let current = addDaysIso(lastDate, 1);
    while (current <= rangeEnd) {
      if (new Date(`${current}T12:00:00`).getDay() === targetDow) return current;
      current = addDaysIso(current, 1);
    }
    return null;
  }

  function findNextSelectedWeekdayAfter(lastDate, selectedWeekdays, rangeEnd) {
    let current = addDaysIso(lastDate, 1);
    while (current <= rangeEnd) {
      const dow = new Date(`${current}T12:00:00`).getDay();
      if (selectedWeekdays.includes(dow)) return current;
      current = addDaysIso(current, 1);
    }
    return null;
  }

  function findAnchorWeekdayOnOrAfter(startDate, anchorDow, rangeEnd) {
    let current = normalizeDateOnly(startDate);
    if (!current) return null;
    while (current <= rangeEnd) {
      if (new Date(`${current}T12:00:00`).getDay() === anchorDow) return current;
      current = addDaysIso(current, 1);
    }
    return null;
  }

  function findNextPlaceableSelectedWeekdayAfter(lastDate, selectedWeekdays, rangeEnd, canPlaceFn) {
    let probe = lastDate;
    while (true) {
      const candidate = findNextSelectedWeekdayAfter(probe, selectedWeekdays, rangeEnd);
      if (!candidate) return null;
      if (canPlaceFn(candidate)) return candidate;
      probe = candidate;
    }
  }

  function findNextPlaceableWeekdayAfter(lastDate, targetDow, rangeEnd, canPlaceFn) {
    let probe = lastDate;
    while (true) {
      const candidate = findNextWeekdayAfter(probe, targetDow, rangeEnd);
      if (!candidate) return null;
      if (canPlaceFn(candidate)) return candidate;
      probe = candidate;
    }
  }

  function generateRotatingWeekdaySessions(options = {}) {
    const anchorDate = normalizeDateOnly(options.anchorDate);
    const startTime = String(options.startTime || '').trim();
    const durationHours = Number(options.durationHours || 0);
    const weekdays = normalizeWeekdays(options.weekdays);
    const count = Math.max(1, Math.min(52, Number(options.count || 1)));
    const enrollmentStart = normalizeDateOnly(options.enrollmentStart || '');
    const enrollmentEnd = normalizeDateOnly(options.enrollmentEnd || '');
    const existingSessions = Array.isArray(options.existingSessions) ? options.existingSessions : [];
    const alreadyStaged = Array.isArray(options.alreadyStaged) ? options.alreadyStaged : [];
    const scheduleDefaults = options.scheduleDefaults && typeof options.scheduleDefaults === 'object'
      ? options.scheduleDefaults
      : {};
    const idPrefix = String(options.idPrefix || `STAGED_quick_${Date.now()}`).trim();

    if (!anchorDate || !startTime || !durationHours || !weekdays.length) {
      return { sessions: [], requested: count, created: 0, capacity: 0 };
    }

    const endTime = addDurationToTime(startTime, durationHours);
    const resolvedDurationHours = computeDurationHoursFromTimes(startTime, endTime);
    const occupiedKeys = new Set();
    [...existingSessions, ...alreadyStaged].forEach((row) => {
      const key = sessionScheduleKey(row);
      if (key) occupiedKeys.add(key);
    });

    let rangeStart = anchorDate;
    if (enrollmentStart && enrollmentStart > rangeStart) rangeStart = enrollmentStart;

    let rangeEnd = enrollmentEnd;
    if (!rangeEnd) {
      const weeksSpan = Math.max(2, Math.ceil(count / 2) + 1);
      rangeEnd = addDaysIso(anchorDate, weeksSpan * 7 + 14);
    }
    if (rangeEnd < rangeStart) {
      return { sessions: [], requested: count, created: 0, capacity: 0 };
    }

    const anchorDow = new Date(`${anchorDate}T12:00:00`).getDay();
    const scheduleRows = [...existingSessions, ...alreadyStaged];

    function scheduleConflicts(dateStr, rowStart, rowEnd) {
      const date = normalizeDateOnly(dateStr);
      if (!date) return true;
      const startMin = timeToMinutes(rowStart);
      const endMin = timeToMinutes(rowEnd);
      return scheduleRows.some((row) => {
        const rowDate = normalizeDateOnly(getSessionDate(row));
        if (rowDate !== date) return false;
        const existingStart = timeToMinutes(String(row?.startTime || row?.start || '').trim());
        const existingEnd = timeToMinutes(String(row?.endTime || row?.end || '').trim());
        return startMin < existingEnd && existingStart < endMin;
      });
    }

    function buildSessionRow(dateStr, index) {
      const sessionId = `${idPrefix}_${String(index + 1).padStart(3, '0')}`;
      return {
        sessionId,
        date: dateStr,
        originalDate: dateStr,
        startTime,
        endTime,
        durationHours: resolvedDurationHours,
        status: 'scheduled',
        room: String(scheduleDefaults.room || '').trim(),
        teacherId: String(scheduleDefaults.teacherId || '').trim(),
        teacherName: String(scheduleDefaults.teacherName || '').trim(),
        isStaged: true
      };
    }

    function canPlace(dateStr) {
      if (!dateStr || dateStr < rangeStart || dateStr > rangeEnd) return false;
      const row = buildSessionRow(dateStr, 0);
      const key = sessionScheduleKey(row);
      if (!key || occupiedKeys.has(key)) return false;
      return !scheduleConflicts(dateStr, row.startTime, row.endTime);
    }

    function placeSession(dateStr, sessions) {
      if (!canPlace(dateStr)) return null;
      const row = buildSessionRow(dateStr, sessions.length);
      const key = sessionScheduleKey(row);
      sessions.push(row);
      occupiedKeys.add(key);
      return dateStr;
    }

    function generateUpTo(maxCount) {
      const sessions = [];
      let lastDate = null;

      let firstDate = anchorDate;
      if (firstDate < rangeStart) {
        firstDate = findAnchorWeekdayOnOrAfter(rangeStart, anchorDow, rangeEnd);
      }
      const placedFirst = placeSession(firstDate, sessions);
      lastDate = placedFirst || firstDate;
      if (!lastDate) return sessions;

      for (let slot = 2; slot <= maxCount; slot += 1) {
        const nextDate = slot % 2 === 0
          ? findNextPlaceableSelectedWeekdayAfter(lastDate, weekdays, rangeEnd, canPlace)
          : findNextPlaceableWeekdayAfter(lastDate, anchorDow, rangeEnd, canPlace);
        if (!nextDate) break;
        const placed = placeSession(nextDate, sessions);
        if (!placed) break;
        lastDate = placed;
      }
      return sessions;
    }

    const allSessions = generateUpTo(52);

    return {
      sessions: allSessions.slice(0, count),
      requested: count,
      created: Math.min(allSessions.length, count),
      capacity: allSessions.length
    };
  }

  function resolveDayCellFromVerticalRow(verticalRow, clientX, clientY) {
    if (!verticalRow) return null;
    const cells = verticalRow.querySelectorAll('.session-cal-day-cell:not(.is-out-of-range)');
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return cell;
      }
    }
    return null;
  }

  function resolveGridClickContext(container, clientX, clientY, target) {
    if (!container || !target || typeof target.closest !== 'function') return null;
    if (isPointerOverSessionUi(target)) return null;

    const timelineWeek = target.closest('.session-cal-timeline-time-track');
    if (timelineWeek && container.contains(timelineWeek)) {
      const track = target.closest('.session-cal-timeline-track');
      if (!track) return null;
      const dayRow = track.closest('.session-cal-timeline-day-row');
      if (!dayRow || dayRow.classList.contains('is-out-of-range')) return null;
      const date = normalizeDateOnly(dayRow.getAttribute('data-cal-date'));
      if (!date) return null;
      const trackRect = track.getBoundingClientRect();
      if (clientX < trackRect.left || clientX > trackRect.right) return null;
      const x = clientX - trackRect.left;
      const snappedOffset = snapTimelineOffsetMinutesForClick(offsetMinutesFromGridX(x, trackRect.width));
      if (isSnappedTimeOccupiedInTrack(track, snappedOffset)) return null;
      const startMin = timelineMinutesFromOffset(snappedOffset);
      return {
        mode: 'timeline',
        date,
        snappedOffsetMinutes: snappedOffset,
        startTime24: minutesToTime24(startMin),
        startTimeLabel: formatSnappedTimelineLabel(snappedOffset)
      };
    }

    const verticalRow = target.closest('.session-cal-time-track');
    if (verticalRow && container.contains(verticalRow)) {
      const dayGrid = target.closest('.session-cal-day-grid');
      const dayCellFromTarget = target.closest('.session-cal-day-cell');
      let dayCell = dayGrid
        ? dayGrid.closest('.session-cal-day-cell')
        : dayCellFromTarget;
      if (!dayCell) {
        dayCell = resolveDayCellFromVerticalRow(verticalRow, clientX, clientY);
      }
      if (!dayCell || dayCell.classList.contains('is-out-of-range')) return null;
      const date = normalizeDateOnly(dayCell.getAttribute('data-cal-date'));
      if (!date) return null;
      const daysRow = verticalRow.querySelector('.session-cal-days-row');
      if (!daysRow) return null;
      const trackRect = daysRow.getBoundingClientRect();
      if (clientY < trackRect.top || clientY > trackRect.bottom) return null;
      const y = clientY - trackRect.top;
      const snappedOffset = snapTimelineOffsetMinutesForClick(offsetMinutesFromGridY(y, trackRect.height));
      if (isSnappedTimeOccupiedOnDay(dayCell, snappedOffset)) return null;
      const startMin = timelineMinutesFromOffset(snappedOffset);
      return {
        mode: 'vertical',
        date,
        snappedOffsetMinutes: snappedOffset,
        startTime24: minutesToTime24(startMin),
        startTimeLabel: formatSnappedTimelineLabel(snappedOffset)
      };
    }

    return null;
  }

  function getPendingChange(pendingMap, sessionId) {
    const id = String(sessionId || '').trim();
    if (!id || !pendingMap) return null;
    if (typeof pendingMap.get === 'function') return pendingMap.get(id) || null;
    return pendingMap[id] || null;
  }

  function resolveEnrollmentNaState(ev = {}, pendingMap = null) {
    const sessionId = String(ev?.sessionId || '').trim();
    const pending = getPendingChange(pendingMap, sessionId);
    if (pending?.action === 'mark_na') return 'pending';
    if (pending?.action === 'unmark') return 'normal';
    if (ev?.savedMarked || ev?.savedRosterNa) return 'saved';
    return 'normal';
  }

  function resolveEnrollmentNaStateForCap(ev = {}, pendingMap = null) {
    const sessionId = String(ev?.sessionId || '').trim();
    const pending = getPendingChange(pendingMap, sessionId);
    if (pending?.action === 'mark_na') return 'pending';
    if (pending?.action === 'unmark') return 'normal';
    if (ev?.savedMarked) return 'saved';
    return 'normal';
  }

  function isDateWithinInclusiveRange(date, startDate, endDate) {
    const d = normalizeDateOnly(date);
    const start = normalizeDateOnly(startDate);
    const end = normalizeDateOnly(endDate);
    if (!d || !start || !end || start > end) return false;
    return d >= start && d <= end;
  }

  function collectBulkNaSessions(events, pendingMap, startDate, endDate, action) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    return (Array.isArray(events) ? events : []).filter((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      const date = normalizeDateOnly(ev?.date);
      if (!sessionId || !date) return false;
      if (!isDateWithinInclusiveRange(date, startDate, endDate)) return false;
      const naState = resolveEnrollmentNaState(ev, pendingMap);
      if (normalizedAction === 'mark_na') return naState === 'normal';
      if (normalizedAction === 'unmark') return naState !== 'normal';
      return false;
    });
  }

  function clonePendingMap(pendingMap) {
    const next = new Map();
    if (!pendingMap) return next;
    if (typeof pendingMap.forEach === 'function') {
      pendingMap.forEach((value, key) => {
        next.set(key, { ...value });
      });
      return next;
    }
    Object.keys(pendingMap).forEach((key) => {
      next.set(key, { ...pendingMap[key] });
    });
    return next;
  }

  function applyBulkPendingChanges(pendingMap, sessions, action, note = '') {
    const next = clonePendingMap(pendingMap);
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedNote = String(note || '').trim();
    (Array.isArray(sessions) ? sessions : []).forEach((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      if (!sessionId) return;
      if (normalizedAction === 'mark_na') {
        next.set(sessionId, { action: 'mark_na', note: normalizedNote });
        return;
      }
      if (normalizedAction === 'unmark') {
        if (ev?.savedMarked || ev?.savedRosterNa) {
          next.set(sessionId, { action: 'unmark', note: '' });
        } else {
          next.delete(sessionId);
        }
      }
    });
    return next;
  }

  function getEffectiveNaSessionIdsFromPending(events, pendingMap) {
    const ids = new Set();
    (Array.isArray(events) ? events : []).forEach((ev) => {
      const sessionId = String(ev?.sessionId || '').trim();
      if (!sessionId) return;
      if (resolveEnrollmentNaStateForCap(ev, pendingMap) !== 'normal') ids.add(sessionId);
    });
    return ids;
  }

  function roundEnrollmentHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function getEnrollmentCapBalance(events, pendingMap, targetSessionCount = 0, targetHours = 0) {
    const targetSessions = Math.max(0, Math.floor(Number(targetSessionCount) || 0));
    const targetHrs = roundEnrollmentHours(targetHours);
    const enforcedSessions = targetSessions > 0;
    const enforcedHours = !enforcedSessions && targetHrs > 0;
    const enforced = enforcedSessions || enforcedHours;
    const rows = Array.isArray(events) ? events : [];
    const availableCount = rows.length;
    const availableHours = roundEnrollmentHours(rows.reduce((sum, row) => sum + (Number(row?.durationHours) || 0), 0));
    const naIds = getEffectiveNaSessionIdsFromPending(rows, pendingMap);
    const naCount = naIds.size;
    let naHours = 0;
    rows.forEach((row) => {
      if (!naIds.has(String(row?.sessionId || '').trim())) return;
      naHours = roundEnrollmentHours(naHours + (Number(row?.durationHours) || 0));
    });
    const expectedCount = Math.max(0, availableCount - naCount);
    const expectedHours = roundEnrollmentHours(Math.max(0, availableHours - naHours));
    const requiredNaCount = enforcedSessions && availableCount > targetSessions
      ? availableCount - targetSessions
      : 0;
    const requiredNaHours = enforcedHours && availableHours > targetHrs
      ? roundEnrollmentHours(availableHours - targetHrs)
      : 0;
    const insufficientSessions = enforcedSessions && availableCount < targetSessions;
    const insufficientHours = enforcedHours && availableHours < targetHrs;
    const gapCount = insufficientSessions ? Math.max(0, targetSessions - availableCount) : 0;
    const gapHours = insufficientHours ? roundEnrollmentHours(Math.max(0, targetHrs - availableHours)) : 0;

    let balanced = true;
    let message = '';
    let needLabel = '';
    if (enforcedSessions) {
      if (insufficientSessions) {
        balanced = true;
        if (gapCount > 0) {
          message = `Only ${availableCount} session(s) scheduled; target is ${targetSessions} (${gapCount} gap). N/A marks are optional.`;
          needLabel = `${gapCount} session gap`;
        }
      } else {
        balanced = expectedCount === targetSessions;
        if (!balanced) {
          if (expectedCount > targetSessions) {
            const need = expectedCount - targetSessions;
            message = `Select exactly ${requiredNaCount} session(s) to mark N/A (currently ${naCount}).`;
            needLabel = `Need ${need} more N/A`;
          } else {
            message = `Too many N/A marks: expected sessions would be ${expectedCount}, target is ${targetSessions}.`;
            needLabel = `Unmark ${targetSessions - expectedCount} N/A`;
          }
        }
      }
    } else if (enforcedHours) {
      if (insufficientHours) {
        balanced = true;
        if (gapHours > 0) {
          message = `Only ${availableHours} hr scheduled; target is ${targetHrs} hr (${gapHours} hr gap). N/A marks are optional.`;
          needLabel = `${gapHours} hr gap`;
        }
      } else {
        balanced = expectedHours <= targetHrs && (requiredNaHours <= 0 || naHours >= requiredNaHours);
        if (expectedHours > targetHrs) {
          balanced = false;
          const need = roundEnrollmentHours(expectedHours - targetHrs);
          message = `Select sessions totaling at least ${requiredNaHours} hour(s) to mark N/A (selected ${naHours} hr).`;
          needLabel = `Need ${need}h more N/A`;
        } else if (requiredNaHours > 0 && naHours < requiredNaHours) {
          balanced = false;
          message = `Select sessions totaling at least ${requiredNaHours} hour(s) to mark N/A (selected ${naHours} hr).`;
          needLabel = `Need ${roundEnrollmentHours(requiredNaHours - naHours)}h more N/A`;
        }
      }
    }

    return {
      enforced,
      enforcedSessions,
      enforcedHours,
      balanced,
      message,
      needLabel: balanced ? (needLabel || 'Balanced') : needLabel,
      targetSessions,
      targetHours: targetHrs,
      availableCount,
      availableHours,
      expectedCount,
      expectedHours,
      naCount,
      naHours,
      requiredNaCount,
      requiredNaHours,
      insufficientSessions,
      insufficientHours,
      gapCount,
      gapHours
    };
  }

  global.SessionCalendarCore = {
    TIMELINE_START_HOUR,
    TIMELINE_END_HOUR,
    TOTAL_MINUTES,
    TIMELINE_SNAP_MINUTES,
    TIMELINE_SNAP_THRESHOLD_MINUTES,
    HOUR_SLOT_COUNT,
    VIEW_PRESETS,
    VIEW_MODES,
    escapeHtml,
    normalizeDateOnly,
    parseAnchorDate,
    clampAnchorDate,
    clampViewRangeToEnrollmentStart,
    isWeekendDate,
    hasHolidayDate,
    buildDayCalendarClasses,
    buildDaySessionBadges,
    addDaysIso,
    mondayOfWeek,
    computeViewRange,
    computeCustomViewRange,
    computeWholeCycleViewRange,
    clampViewRangeToBounds,
    viewRangeDayCount,
    shiftViewRange,
    suggestViewModeForPreset,
    isWeekRowPreset,
    computeAutoDayWidth,
    filterEventsByViewRange,
    buildWeekBlocks,
    formatWeekLabel,
    formatWeekLabelHtml,
    weekOfMonthWord,
    getIsoWeekYear,
    timeToMinutes,
    calculatePosition,
    snapTimelineOffsetMinutes,
    snapTimelineOffsetMinutesForClick,
    formatSnappedTimelineLabel,
    timelineMinutesFromOffset,
    isSnappedTimeOccupiedOnDay,
    groupEventsByDate,
    formatDayHeaderShort,
    formatDayHeaderLong,
    formatDayHeaderHtml,
    formatDayHeaderParts,
    formatClockTime,
    formatClockTimeRange,
    formatHours,
    parseClockTimeParts,
    renderEnrollmentCalendar,
    renderVerticalWeekGrid,
    renderHorizontalWeekGrid,
    bindCalendarTimeHover,
    clearCalendarTimeHover,
    filterWeekDaysForDisplay,
    summarizeSelectionFromEvents,
    sessionScheduleKey,
    sessionTimeWindowKey,
    normalizeSessionTimes,
    matchesSessionTimeWindow,
    countSessionsByTimeWindow,
    countTimeSlotSessionsInRange,
    collectTimeSlotSessions,
    minutesToTime24,
    addDurationToTime,
    normalizeWeekdays,
    buildRotationWeekdayOrder,
    generateRotatingWeekdaySessions,
    resolveGridClickContext,
    isPointerOverSessionUi,
    formatDurationHrsMins,
    computeVerticalDragRange,
    isSpanOccupiedOnDay,
    buildVerticalDragContext,
    resolveVerticalDragContext,
    bindCalendarDragCreate,
    clearDragOverlays,
    resolveEnrollmentNaState,
    resolveEnrollmentNaStateForCap,
    isDateWithinInclusiveRange,
    collectBulkNaSessions,
    clonePendingMap,
    applyBulkPendingChanges,
    getEffectiveNaSessionIdsFromPending,
    getEnrollmentCapBalance
  };
})(typeof window !== 'undefined' ? window : global);
