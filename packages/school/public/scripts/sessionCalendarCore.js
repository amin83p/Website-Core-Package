(function (global) {
  'use strict';

  const TIMELINE_START_HOUR = 7;
  const TIMELINE_END_HOUR = 22;
  const TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60;
  const HOUR_SLOT_COUNT = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
  const TIMELINE_SNAP_MINUTES = 30;
  const TIMELINE_SNAP_THRESHOLD_MINUTES = 10;

  const VIEW_PRESETS = ['day', 'week', 'twoWeeks', 'month', 'twoMonths', 'threeMonths'];
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

  function computeViewRange(preset = 'week', anchorDate = '') {
    const anchor = parseAnchorDate(anchorDate);
    const key = String(preset || 'week').trim();
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
    if (key === 'month') {
      const start = startOfMonth(anchor);
      return { startDate: start, endDate: endOfMonth(anchor), preset: key, anchorDate: anchor };
    }
    if (key === 'twoMonths') {
      const start = startOfMonth(anchor);
      const endAnchor = addMonthsIso(start, 1);
      return { startDate: start, endDate: endOfMonth(endAnchor), preset: key, anchorDate: anchor };
    }
    if (key === 'threeMonths') {
      const start = startOfMonth(anchor);
      const endAnchor = addMonthsIso(start, 2);
      return { startDate: start, endDate: endOfMonth(endAnchor), preset: key, anchorDate: anchor };
    }
    return { startDate: anchor, endDate: addDaysIso(anchor, 6), preset: 'week', anchorDate: anchor };
  }

  function shiftViewRange(viewRange = {}, direction = 1) {
    const preset = String(viewRange?.preset || 'week').trim();
    const anchor = parseAnchorDate(viewRange?.anchorDate);
    const dir = Number(direction) >= 0 ? 1 : -1;
    if (preset === 'day') return computeViewRange(preset, addDaysIso(anchor, dir));
    if (preset === 'week') return computeViewRange(preset, addDaysIso(anchor, dir * 7));
    if (preset === 'twoWeeks') return computeViewRange(preset, addDaysIso(anchor, dir * 14));
    if (preset === 'month') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir));
    if (preset === 'twoMonths') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir * 2));
    if (preset === 'threeMonths') return computeViewRange(preset, addMonthsIso(startOfMonth(anchor), dir * 3));
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
    const pad = (n) => String(n).padStart(2, '0');
    if (hour === 0) return '12:00 AM';
    if (hour < 12) return `${pad(hour)}:00 AM`;
    if (hour === 12) return '12:00 PM';
    return `${pad(hour - 12)}:00 PM`;
  }

  function formatDayHeaderShort(dateStr) {
    const dateObj = new Date(`${dateStr}T00:00:00`);
    return dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatDayHeaderLong(dateStr) {
    const dateObj = new Date(`${dateStr}T00:00:00`);
    return dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
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
    return Boolean(target.closest('.session-enrollment-block, .session-cal-positioned-session, .session-manage-link'));
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

  function renderVerticalDayCell(dateStr, dayEvents, selectedSet, inRange, holidayDates) {
    const tracks = assignTracks((dayEvents || []).slice());
    const trackCount = Math.max(1, tracks.length);
    const dayClass = buildDayCalendarClasses(
      dateStr,
      holidayDates,
      'session-cal-day-cell',
      inRange ? '' : 'is-out-of-range is-outside-month'
    );
    let sessionsHtml = '';
    (dayEvents || []).forEach((ev) => {
      const trackLeft = (ev.trackIndex / trackCount) * 100;
      const trackWidth = 100 / trackCount;
      const blockHeight = Math.max(1, Number(ev.pos?.width || 0));
      const blockHtml = buildEnrollmentBlockHtml(ev, selectedSet);
      sessionsHtml += `<div class="session-cal-positioned-session session-cal-positioned-vertical" data-timeline-start="${ev.pos.startMin}" data-timeline-end="${ev.pos.endMin}" style="top:${ev.pos.left}%;height:calc(${blockHeight}% - 4px);left:${trackLeft}%;width:calc(${trackWidth}% - 4px);">${blockHtml}</div>`;
    });
    return `
      <div class="${dayClass}" data-cal-date="${escapeHtml(dateStr)}">
        <div class="session-cal-day-grid">
          ${buildHourGridBackgroundHtml()}
          ${sessionsHtml}
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
      return;
    }

    const dayWidth = Number(options.dayWidth || 140);
    const holidayDates = options.holidayDates || null;
    container.style.setProperty('--session-day-width', `${dayWidth}px`);
    container.style.setProperty('--session-time-gutter-width', '64px');
    container.style.setProperty('--session-hour-height', '28px');
    const visibleDayCount = weekBlocks.reduce((max, week) => Math.max(max, week.days.length), 0) || 7;
    container.dataset.sessionVisibleDayCount = String(visibleDayCount);

    let html = '<div class="session-cal-vertical-scroll"><div class="session-cal-week-stack">';
    weekBlocks.forEach((week) => {
      html += `
        <div class="session-cal-week-row">
          <div class="session-cal-week-label">${escapeHtml(week.weekStart)} – ${escapeHtml(week.weekEnd)}</div>
          <div class="session-cal-week-grid-vertical">
            <div class="session-cal-day-header-row">
              <div class="session-cal-time-gutter-spacer" aria-hidden="true"></div>
      `;
      week.days.forEach((day) => {
        const dayEvents = eventsByDate[day.date] || [];
        const headerClass = buildDayCalendarClasses(
          day.date,
          holidayDates,
          'session-cal-day-header',
          outOfViewRangeDayClass(day.inRange)
        );
        html += `
          <div class="${headerClass}">
            <span>${escapeHtml(formatDayHeaderShort(day.date))}</span>
            ${day.inRange ? buildDaySessionBadges(dayEvents, true) : ''}
          </div>
        `;
      });
      html += `
            </div>
            <div class="session-cal-week-body-row session-cal-time-track">
              ${buildVerticalTimeGutterHtml()}
              <div class="session-cal-days-row">
      `;
      week.days.forEach((day) => {
        const dayEvents = day.inRange ? (eventsByDate[day.date] || []) : [];
        html += renderVerticalDayCell(day.date, dayEvents, selectedSet, day.inRange, holidayDates);
      });
      html += '</div><div class="session-cal-hover-line" aria-hidden="true"></div><div class="session-cal-hover-time-label" aria-hidden="true"></div></div></div></div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
    bindVerticalTimeHover(container);
  }

  function renderHorizontalWeekGrid(eventsByDate, container, selectedSet, options = {}) {
    const viewRange = options.viewRange || computeViewRange(options.viewPreset || 'week', options.anchorDate || '');
    const blockOptions = { displayStartDate: options.enrollmentStartDate || '' };
    const weekBlocks = buildWeekBlocks(viewRange, blockOptions);
    if (!weekBlocks.length) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return;
    }

    const holidayDates = options.holidayDates || null;
    let html = '<div class="session-cal-vertical-scroll"><div class="session-cal-week-stack session-cal-week-stack-timeline">';
    weekBlocks.forEach((week) => {
      html += `
        <div class="session-cal-week-row session-cal-week-row-timeline session-cal-timeline-time-track">
          <div class="session-cal-week-label">${escapeHtml(week.weekStart)} – ${escapeHtml(week.weekEnd)}</div>
          <div class="session-cal-timeline-hover-shell">
            <div class="session-cal-timeline-header-row">
              <div class="session-cal-day-label-spacer" aria-hidden="true"></div>
              <div class="session-cal-time-header-wrap">
                ${buildHorizontalTimeHeaderHtml()}
              </div>
            </div>
      `;
      week.days.forEach((day) => {
        const dayEvents = day.inRange ? (eventsByDate[day.date] || []) : [];
        assignTracks(dayEvents.slice());
        const tracks = [];
        dayEvents.forEach((ev) => {
          if (!tracks[ev.trackIndex]) tracks[ev.trackIndex] = [];
          tracks[ev.trackIndex].push(ev);
        });
        const trackCount = Math.max(1, tracks.length);
        const bodyHeight = Math.max(56, trackCount * 58 + 8);
        const rowClass = buildDayCalendarClasses(
          day.date,
          holidayDates,
          'session-cal-timeline-day-row',
          outOfViewRangeDayClass(day.inRange)
        );
        let sessionsHtml = '';
        dayEvents.forEach((ev) => {
          const topPos = (ev.trackIndex * 58) + 4;
          const block = buildEnrollmentBlockHtml(ev, selectedSet);
          sessionsHtml += `<div class="session-cal-positioned-session session-cal-positioned-horizontal" data-timeline-start="${ev.pos.startMin}" data-timeline-end="${ev.pos.endMin}" style="left:${ev.pos.left}%;width:${ev.pos.width}%;top:${topPos}px;">${block}</div>`;
        });
        html += `
          <div class="${rowClass}" data-cal-date="${escapeHtml(day.date)}">
            <div class="session-cal-day-row-label">${escapeHtml(formatDayHeaderShort(day.date))}</div>
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
    container.innerHTML = html;
    bindCalendarTimeHover(container);
  }

  function renderSingleDayList(eventsByDate, container, selectedSet, displayStartDate = '') {
    container.innerHTML = '';
    const displayStart = normalizeDateOnly(displayStartDate);
    const dates = Object.keys(eventsByDate || {}).sort().filter((dateStr) => !displayStart || dateStr >= displayStart);
    if (!dates.length) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return;
    }
    let html = '<div class="single-day-list">';
    dates.forEach((dateStr) => {
      const dateObj = new Date(`${dateStr}T00:00:00`);
      const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      html += `<div class="small fw-semibold text-muted mb-2">${escapeHtml(displayDate)}</div>`;
      (eventsByDate[dateStr] || []).forEach((ev) => {
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
    html += '</div>';
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
      enrollmentStartDate: options.enrollmentStartDate || ''
    };

    if (viewMode === 'singleDay') {
      renderSingleDayList(eventsByDate, container, selectedSet, gridOptions.enrollmentStartDate);
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
    shiftViewRange,
    suggestViewModeForPreset,
    isWeekRowPreset,
    computeAutoDayWidth,
    filterEventsByViewRange,
    buildWeekBlocks,
    timeToMinutes,
    calculatePosition,
    snapTimelineOffsetMinutes,
    snapTimelineOffsetMinutesForClick,
    formatSnappedTimelineLabel,
    timelineMinutesFromOffset,
    isSnappedTimeOccupiedOnDay,
    groupEventsByDate,
    formatHours,
    renderEnrollmentCalendar,
    summarizeSelectionFromEvents,
    sessionScheduleKey,
    minutesToTime24,
    addDurationToTime,
    normalizeWeekdays,
    buildRotationWeekdayOrder,
    generateRotatingWeekdaySessions,
    resolveGridClickContext,
    isPointerOverSessionUi
  };
})(typeof window !== 'undefined' ? window : global);
