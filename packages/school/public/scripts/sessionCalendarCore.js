(function (global) {
  'use strict';

  const TIMELINE_START_HOUR = 7;
  const TIMELINE_END_HOUR = 22;
  const TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60;

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

  function computeViewRange(preset = 'week', anchorDate = '') {
    const anchor = parseAnchorDate(anchorDate);
    const key = String(preset || 'week').trim();
    if (key === 'day') {
      return { startDate: anchor, endDate: anchor, preset: key, anchorDate: anchor };
    }
    if (key === 'week') {
      const start = addDaysIso(anchor, -((new Date(`${anchor}T00:00:00`).getDay() + 6) % 7));
      return { startDate: start, endDate: addDaysIso(start, 6), preset: key, anchorDate: anchor };
    }
    if (key === 'twoWeeks') {
      const start = addDaysIso(anchor, -((new Date(`${anchor}T00:00:00`).getDay() + 6) % 7));
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
    if (key === 'week' || key === 'twoWeeks') return 'vertical';
    if (key === 'month' || key === 'twoMonths' || key === 'threeMonths') return 'month';
    return 'vertical';
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

  function buildEnrollmentBlockHtml(ev, selectedSet, options = {}) {
    const sessionId = String(ev?.sessionId || '').trim();
    const selectable = ev?.selectable === true;
    const selected = selectedSet && selectedSet.has(sessionId);
    const classes = [
      'session-enrollment-block',
      ev?.isStaged ? 'is-staged' : '',
      selected ? 'is-selected' : '',
      selectable ? '' : 'is-unselectable'
    ].filter(Boolean).join(' ');
    const tip = selectable ? '' : String(ev?.excludeReason || 'Not selectable');
    const manageUrl = String(ev?.manageSessionUrl || '').trim();
    const manageLink = manageUrl && ev?.manageable
      ? `<a class="session-manage-link" href="${escapeHtml(manageUrl)}" target="_blank" rel="noopener noreferrer" title="Manage session" data-session-manage="1"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>`
      : '';
    return `
      <div class="${classes}"
           data-session-id="${escapeHtml(sessionId)}"
           data-selectable="${selectable ? '1' : '0'}"
           title="${escapeHtml(tip)}"
           role="button"
           aria-selected="${selected ? 'true' : 'false'}"
           tabindex="0">
        ${manageLink}
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

  function renderSingleDayList(eventsByDate, container, selectedSet) {
    container.innerHTML = '';
    const dates = Object.keys(eventsByDate || {}).sort();
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
          selected ? 'is-selected' : '',
          selectable ? '' : 'is-unselectable'
        ].filter(Boolean).join(' ');
        const manageUrl = String(ev?.manageSessionUrl || '').trim();
        html += `
          <div class="${classes}" data-session-id="${escapeHtml(sessionId)}" data-selectable="${selectable ? '1' : '0'}" role="button" aria-selected="${selected ? 'true' : 'false'}">
            <div class="flex-grow-1">
              <div class="fw-semibold">${escapeHtml(ev?.teacherName || 'Teacher')}</div>
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

  function renderVerticalTimeline(eventsByDate, container, selectedSet, dayWidth = 140) {
    const dates = Object.keys(eventsByDate || {}).sort();
    if (!dates.length) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return;
    }
    container.style.setProperty('--session-day-width', `${dayWidth}px`);
    let html = '<div class="session-vertical-scroll"><div class="schedule-vertical-days">';
    dates.forEach((dateStr) => {
      const dayEvents = eventsByDate[dateStr] || [];
      const dateObj = new Date(`${dateStr}T00:00:00`);
      const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const tracks = assignTracks(dayEvents.slice());
      const trackCount = Math.max(1, tracks.length);
      html += `
        <div class="vertical-day-column">
          <div class="vertical-day-header">
            <span>${escapeHtml(displayDate)}</span>
            <span class="badge bg-primary">${dayEvents.length}</span>
          </div>
          <div class="vertical-day-body">
            <div class="vertical-hour-markers">
      `;
      for (let h = TIMELINE_START_HOUR; h < TIMELINE_END_HOUR; h += 1) {
        const displayHour = h > 12 ? `${h - 12}p` : (h === 12 ? '12p' : `${h}a`);
        html += `<div class="vertical-hour-marker"><span class="vertical-hour-label">${displayHour}</span></div>`;
      }
      html += '</div>';
      dayEvents.forEach((ev) => {
        const trackLeft = (ev.trackIndex / trackCount) * 100;
        const trackWidth = 100 / trackCount;
        const blockHeight = Math.max(1, Number(ev.pos?.width || 0));
        const blockHtml = buildEnrollmentBlockHtml(ev, selectedSet);
        html += `<div class="vertical-positioned-session" style="top:${ev.pos.left}%;height:calc(${blockHeight}% - 4px);left:calc(${trackLeft}% + 28px);width:calc(${trackWidth}% - 34px);">${blockHtml}</div>`;
      });
      html += '</div></div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
  }

  function renderTimeline(eventsByDate, container, selectedSet) {
    container.innerHTML = '';
    const dates = Object.keys(eventsByDate || {}).sort();
    if (!dates.length) {
      container.innerHTML = '<div class="alert alert-light text-center border py-4 text-muted">No sessions in this range.</div>';
      return;
    }
    dates.forEach((dateStr) => {
      const dayEvents = eventsByDate[dateStr] || [];
      const dateObj = new Date(`${dateStr}T00:00:00`);
      const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      assignTracks(dayEvents);
      const tracks = [];
      dayEvents.forEach((ev) => {
        if (!tracks[ev.trackIndex]) tracks[ev.trackIndex] = [];
        tracks[ev.trackIndex].push(ev);
      });
      const bodyHeight = Math.max(76, tracks.length * 64 + 14);
      let html = `
        <div class="timeline-container">
          <div class="timeline-header"><span>${escapeHtml(displayDate)}</span><span class="badge bg-primary">${dayEvents.length}</span></div>
          <div class="timeline-body pb-3" style="height:${bodyHeight}px;">
      `;
      dayEvents.forEach((ev) => {
        const topPos = (ev.trackIndex * 62) + 7;
        const block = buildEnrollmentBlockHtml(ev, selectedSet);
        html += `<div class="vertical-positioned-session" style="position:absolute;left:${ev.pos.left}%;width:${ev.pos.width}%;top:${topPos}px;">${block}</div>`;
      });
      html += '<div class="hour-markers">';
      for (let h = TIMELINE_START_HOUR; h < TIMELINE_END_HOUR; h += 1) {
        const displayHour = h > 12 ? `${h - 12}p` : (h === 12 ? '12p' : `${h}a`);
        html += `<div class="hour-marker"><span class="hour-label">${displayHour}</span></div>`;
      }
      html += '</div></div></div>';
      container.innerHTML += html;
    });
  }

  function renderMonthGrid(eventsByDate, startStr, endStr, container, selectedSet) {
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
        html += '<div class="session-cal-day empty"></div>';
      }
      for (let d = 1; d <= daysInMonth; d += 1) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayEvents = eventsByDate[dateStr] || [];
        const count = dayEvents.length;
        const hasSelected = dayEvents.some((ev) => selectedSet && selectedSet.has(String(ev?.sessionId || '').trim()));
        let classes = 'session-cal-day';
        if (count > 0) classes += ' has-events';
        if (hasSelected) classes += ' has-selected';
        else if (!count) classes += ' empty';
        html += `
          <div class="${classes}" data-cal-date="${escapeHtml(dateStr)}" title="${count} session(s)">
            <span>${d}</span>
            ${count ? `<div><span class="session-cal-badge">${count}</span></div>` : ''}
          </div>
        `;
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
    if (viewMode === 'singleDay') {
      renderSingleDayList(eventsByDate, container, selectedSet);
      return;
    }
    if (viewMode === 'timeline') {
      renderTimeline(eventsByDate, container, selectedSet);
      return;
    }
    if (viewMode === 'month') {
      renderMonthGrid(eventsByDate, viewRange.startDate, viewRange.endDate, container, selectedSet);
      return;
    }
    renderVerticalTimeline(eventsByDate, container, selectedSet, Number(options.dayWidth || 140));
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

  global.SessionCalendarCore = {
    TIMELINE_START_HOUR,
    TIMELINE_END_HOUR,
    VIEW_PRESETS,
    VIEW_MODES,
    escapeHtml,
    normalizeDateOnly,
    parseAnchorDate,
    addDaysIso,
    computeViewRange,
    shiftViewRange,
    suggestViewModeForPreset,
    timeToMinutes,
    calculatePosition,
    groupEventsByDate,
    formatHours,
    renderEnrollmentCalendar,
    summarizeSelectionFromEvents
  };
})(typeof window !== 'undefined' ? window : global);
