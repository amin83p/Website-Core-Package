(function initClassConductReport(global) {
  'use strict';

  const INITIAL = global.__classConductReportInitial || {};
  const CONDUCT = global.ConductRatingCell || {};
  const DIMENSIONS = [
    { key: 'classEffortPercent', label: 'Class effort' },
    { key: 'classParticipationPercent', label: 'Participation' },
    { key: 'respectsTeachersPercent', label: 'Respects teachers' },
    { key: 'respectsStudentsPercent', label: 'Respects students' }
  ];
  const DIM_KEYS = DIMENSIONS.map((d) => d.key);
  const ASYNC_MIN_STUDENTS = 2;

  let selectedStudents = [];
  let lastPayload = null;
  let hideDaysWithoutSession = true;
  let showWeekSeparators = false;
  let loadToken = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function applyQuickRange(range) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = new Date(today);
    let end = new Date(today);
    if (range === 'thisWeek') {
      const day = today.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      start.setDate(today.getDate() + diff);
    } else if (range === 'thisMonth') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (range === 'lastMonth') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (range === 'lastMonthFirstHalf') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(start.getFullYear(), start.getMonth(), 15);
    } else if (range === 'lastMonthSecondHalf') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 16);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    } else if (range === 'allTime') {
      document.getElementById('ccr_startDate').value = '';
      document.getElementById('ccr_endDate').value = '';
      document.querySelectorAll('.ccr-range').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-range') === range);
      });
      return;
    }
    document.getElementById('ccr_startDate').value = toYmd(start);
    document.getElementById('ccr_endDate').value = toYmd(end);
    document.querySelectorAll('.ccr-range').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-range') === range);
    });
  }

  function conductChipClassFromCode(code) {
    const raw = String(code ?? '').trim();
    if (!raw || raw === '—') return 'cm-dim-chip-empty';
    if (raw === 'S') return 'cm-code-s';
    if (raw === 'Sat' || raw.toUpperCase() === 'SAT') return 'cm-code-sat';
    if (raw === 'NI') return 'cm-code-ni';
    if (raw === 'U') return 'cm-code-u';
    if (/^N\/A$/i.test(raw)) return 'cm-code-na';
    return '';
  }

  function buildChipHtml(code, titleText) {
    const codeText = escapeHtml(code || '—');
    const chipClass = conductChipClassFromCode(code);
    const title = escapeHtml(titleText || codeText);
    return `<span class="cm-dim-chip ${chipClass}" title="${title}">${codeText}</span>`;
  }

  function buildRollupInnerHtml(summary) {
    const avgs = summary?.dimensionAverages || {};
    const hasAny = DIM_KEYS.some((k) => avgs[k] != null);
    if (!hasAny) return '<span class="cm-cell-empty-mark">—</span>';
    const chips = DIMENSIONS.map((dim) => {
      const avg = avgs[dim.key];
      if (avg == null) return '<span class="cm-dim-chip cm-dim-chip-empty">—</span>';
      const level = CONDUCT.percentToConductLevel ? CONDUCT.percentToConductLevel(avg) : null;
      const code = level?.displayCode || level?.code || String(Math.round(avg));
      return buildChipHtml(code, `${dim.label}: ${avg}% avg`);
    }).join('');
    return `<div class="cm-cell-grid">${chips}</div>`;
  }

  function buildCellInnerHtml(dayCell) {
    if (!dayCell?.hasSession) {
      return '<span class="cm-cell-off-roster" aria-hidden="true">·</span>';
    }
    if (!dayCell.onRoster) {
      return '<span class="cm-cell-off-roster" aria-hidden="true">·</span>';
    }
    if (!dayCell.value?.summary) {
      return '<span class="cm-cell-empty-mark">—</span>';
    }
    const labels = dayCell.value.labels || {};
    const percents = dayCell.value.percents || {};
    const chips = DIMENSIONS.map((dim) => {
      const code = labels[dim.key] || '—';
      const pct = percents[dim.key];
      const title = pct != null && pct !== '' ? `${dim.label}: ${pct}%` : dim.label;
      return buildChipHtml(code, title);
    }).join('');
    const hint = dayCell.multiSessionHint ? ` · ${dayCell.multiSessionHint}` : '';
    return `<div class="cm-cell-grid" title="${escapeHtml((dayCell.value.summary || '') + hint)}">${chips}</div>`;
  }

  function renderLegend() {
    const policy = global.__conductRatingScalePolicy || {};
    const levels = Array.isArray(policy.levels) ? policy.levels : [];
    const host = document.getElementById('ccrConductLegend');
    if (!host || !levels.length) return;
    host.innerHTML = levels.map((level) => {
      const code = level.displayCode || level.code || '';
      return `<span class="cm-legend-item">${buildChipHtml(code, level.label || code)} ${escapeHtml(level.label || '')}</span>`;
    }).join('');
  }

  function getWeekStartKey(dateStr) {
    const raw = String(dateStr || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(`${raw}T00:00:00`);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toYmd(d);
  }

  function buildWeekBoundaryFlags(days) {
    let prevWeek = '';
    return (Array.isArray(days) ? days : []).map((date) => {
      const week = getWeekStartKey(date);
      const boundary = prevWeek && week !== prevWeek;
      prevWeek = week;
      return boundary;
    });
  }

  function filterDaysForStudent(student, allDays) {
    const days = Array.isArray(allDays) ? allDays : [];
    if (!hideDaysWithoutSession) return days.slice();
    const sessionDates = new Set();
    (student.classes || []).forEach((classRow) => {
      (classRow.days || []).forEach((cell) => {
        if (cell?.hasSession) sessionDates.add(String(cell.date || '').trim());
      });
    });
    return days.filter((d) => sessionDates.has(String(d || '').trim()));
  }

  function buildDayHeader(date, weekBoundary) {
    const d = new Date(`${date}T00:00:00`);
    const label = Number.isNaN(d.getTime())
      ? date
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const cls = weekBoundary ? ' ccr-week-boundary' : '';
    return `<th class="text-center small${cls}">${escapeHtml(label)}</th>`;
  }

  function buildStudentSection(student, days, startDate, endDate) {
    const personId = String(student?.personId || '').trim();
    const visibleDays = filterDaysForStudent(student, days);
    const visibleSet = new Set(visibleDays);
    const collapseId = `ccr-student-${personId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const summary = student?.summary || {};
    const rated = Number(summary.ratedSessions) || 0;
    const nameHtml = typeof global.schoolRenderStudentNameHtml === 'function'
      ? global.schoolRenderStudentNameHtml(student.name, student.studentRecordId, { className: 'text-decoration-none fw-bold' })
      : escapeHtml(student.name || personId);
    const weekFlags = buildWeekBoundaryFlags(visibleDays);

    let classRows = '';
    (student.classes || []).forEach((classRow) => {
      const classId = String(classRow.classId || '').trim();
      const matrixUrl = `/school/conduct-matrix?classId=${encodeURIComponent(classId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
      let cells = '';
      let vi = 0;
      (classRow.days || []).forEach((dayCell) => {
        const date = String(dayCell?.date || '').trim();
        if (!visibleSet.has(date)) return;
        const weekClass = showWeekSeparators && weekFlags[vi] ? ' ccr-week-boundary' : '';
        vi += 1;
        const inner = buildCellInnerHtml(dayCell);
        cells += `<td class="cm-matrix-cell${weekClass}" data-ccr-cell="1" data-person-id="${escapeHtml(personId)}" data-class-id="${escapeHtml(classId)}" data-date="${escapeHtml(date)}" data-session-id="${escapeHtml(dayCell.sessionId || '')}">${inner}</td>`;
      });
      classRows += `<tr>
        <td class="ccr-sticky-rollup px-2 py-2 text-center">${buildRollupInnerHtml(classRow.summary)}</td>
        <td class="ccr-sticky-class px-3 py-2 small fw-semibold">
          <a href="${escapeHtml(matrixUrl)}" class="text-decoration-none fw-semibold" target="_blank" rel="noopener noreferrer">${escapeHtml(classRow.className || classId)}</a>
          ${classRow.teacherName ? `<div class="text-muted" style="font-size:0.72rem;">${escapeHtml(classRow.teacherName)}</div>` : ''}
        </td>
        ${cells}
      </tr>`;
    });

    const colspan = visibleDays.length + 2;
    if (!classRows) {
      classRows = `<tr><td colspan="${colspan}" class="text-muted small px-3 py-2">No enrolled classes with shown conduct sessions in this range.</td></tr>`;
    }

    const dayHeaders = visibleDays.map((day, i) => buildDayHeader(day, showWeekSeparators && weekFlags[i])).join('');

    return `<div class="card border shadow-sm mb-3 ccr-student-report-card" data-person-id="${escapeHtml(personId)}" data-student-record-id="${escapeHtml(String(student?.studentRecordId || '').trim())}">
      <div class="card-header bg-white py-2">
        <button class="btn btn-link text-decoration-none text-dark text-start p-0 w-100 ccr-collapse-toggle" type="button"
          data-bs-toggle="collapse" data-bs-target="#${escapeHtml(collapseId)}" aria-expanded="false">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div class="d-flex align-items-center gap-2 fw-bold"><i class="bi bi-chevron-down ccr-collapse-chevron"></i><span>${nameHtml}</span></div>
            <div class="ccr-summary-chip text-muted"><span class="fw-semibold text-primary">${rated}</span> rated session${rated === 1 ? '' : 's'}</div>
          </div>
        </button>
      </div>
      <div id="${escapeHtml(collapseId)}" class="collapse">
        <div class="card-body p-0">
          <div class="ccr-matrix-wrapper">
            <table class="table table-sm table-hover mb-0 ccr-matrix-table">
              <thead><tr>
                <th class="ccr-sticky-rollup text-center small">Avg</th>
                <th class="ccr-sticky-class px-3 py-2">Class</th>
                ${dayHeaders}
              </tr></thead>
              <tbody>${classRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
  }

  function orderReportStudentsBySelection(students = []) {
    const rankById = new Map();
    selectedStudents.forEach((row, index) => {
      const studentId = String(row.studentRecordId || row.id || '').trim();
      const personId = String(row.personId || '').trim();
      if (studentId) rankById.set(studentId, index);
      if (personId) rankById.set(`person:${personId}`, index);
    });
    return [...students].sort((a, b) => {
      const aRank = rankById.get(String(a?.studentRecordId || '').trim())
        ?? rankById.get(`person:${String(a?.personId || '').trim()}`);
      const bRank = rankById.get(String(b?.studentRecordId || '').trim())
        ?? rankById.get(`person:${String(b?.personId || '').trim()}`);
      const aIndex = Number.isFinite(Number(aRank)) ? Number(aRank) : 9999;
      const bIndex = Number.isFinite(Number(bRank)) ? Number(bRank) : 9999;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
  }

  function renderSections(payload) {
    if (!payload) return;
    const days = Array.isArray(payload.days) ? payload.days : [];
    const students = orderReportStudentsBySelection(Array.isArray(payload.students) ? payload.students : []);
    const host = document.getElementById('ccrStudentSections');
    if (!host) return;
    host.innerHTML = students.length
      ? students.map((s) => buildStudentSection(s, days, payload.startDate, payload.endDate)).join('')
      : '<p class="text-muted mb-0">No conduct data found for the selected students.</p>';
    document.getElementById('ccrResultsContainer')?.classList.remove('d-none');
    setClassConductPrintEnabled(students.length > 0);
  }

  function setClassConductPrintEnabled(enabled) {
    const btn = document.getElementById('btn_printClassConductReport');
    if (!btn) return;
    btn.disabled = !enabled;
    btn.title = enabled ? 'Print class conduct report for the loaded range' : 'Load the report first';
  }

  function ccrPrintFormatDateShort(ymd) {
    const raw = String(ymd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || '—';
    const d = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function ccrPrintFormatRangeLabel(startDate, endDate) {
    const start = String(startDate || '').trim();
    const end = String(endDate || '').trim();
    if (!start && !end) return 'All dates';
    if (start && end) return `${ccrPrintFormatDateShort(start)} – ${ccrPrintFormatDateShort(end)}`;
    if (start) return `From ${ccrPrintFormatDateShort(start)}`;
    return `Through ${ccrPrintFormatDateShort(end)}`;
  }

  function buildClassConductPrintLegendHtml() {
    const policy = global.__conductRatingScalePolicy || {};
    const levels = Array.isArray(policy.levels) ? policy.levels : [];
    if (!levels.length) return '';
    const items = levels.map((level) => {
      const code = level.displayCode || level.code || '';
      return `<span class="cm-print-legend-item">${buildChipHtml(code, level.label || code)} ${escapeHtml(level.label || '')}</span>`;
    }).join('');
    return `<div class="cm-print-legend">${items}</div>`;
  }

  function buildClassConductPrintDayHeader(date, weekBoundary) {
    const d = new Date(`${date}T00:00:00`);
    const label = Number.isNaN(d.getTime())
      ? date
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const cls = weekBoundary ? ' ccr-week-boundary' : '';
    return `<th class="day-col${cls}">${escapeHtml(label)}</th>`;
  }

  function buildClassConductPrintStudentTable(student, allDays, printMeta) {
    const visibleDays = filterDaysForStudent(student, allDays);
    const visibleSet = new Set(visibleDays);
    const weekFlags = printMeta.showWeekSeparators ? buildWeekBoundaryFlags(visibleDays) : [];
    let classRows = '';
    (student.classes || []).forEach((classRow) => {
      const className = escapeHtml(classRow.className || classRow.classId || 'Class');
      const teacherLine = classRow.teacherName
        ? `<div class="class-teacher">${escapeHtml(classRow.teacherName)}</div>`
        : '';
      let cells = '';
      let vi = 0;
      (classRow.days || []).forEach((dayCell) => {
        const date = String(dayCell?.date || '').trim();
        if (!visibleSet.has(date)) return;
        const weekClass = printMeta.showWeekSeparators && weekFlags[vi] ? ' ccr-week-boundary' : '';
        vi += 1;
        cells += `<td class="cm-print-cell${weekClass}">${buildCellInnerHtml(dayCell)}</td>`;
      });
      if (!cells && !visibleDays.length) return;
      classRows += `<tr>
        <td class="rollup-col">${buildRollupInnerHtml(classRow.summary)}</td>
        <td class="class-col"><div class="class-name">${className}</div>${teacherLine}</td>
        ${cells || visibleDays.map(() => '<td class="cm-print-cell st-empty">—</td>').join('')}
      </tr>`;
    });
    const colspan = visibleDays.length + 2;
    if (!classRows) {
      classRows = `<tr><td colspan="${colspan}" class="empty-msg">No enrolled classes with shown conduct sessions in this range.</td></tr>`;
    }
    const dayHeaders = visibleDays.map((day, i) => buildClassConductPrintDayHeader(
      day,
      printMeta.showWeekSeparators && weekFlags[i]
    )).join('');
    return `<table class="matrix">
      <thead><tr>
        <th class="rollup-col">Avg</th>
        <th class="class-col">Class</th>
        ${dayHeaders || '<th>Days</th>'}
      </tr></thead>
      <tbody>${classRows}</tbody>
    </table>`;
  }

  function buildClassConductPrintDocument(payload, meta = {}) {
    const days = Array.isArray(payload?.days) ? payload.days : [];
    const students = orderReportStudentsBySelection(Array.isArray(payload?.students) ? payload.students : []);
    const orgName = String(meta.orgName || '').trim();
    const rangeLabel = ccrPrintFormatRangeLabel(payload?.startDate, payload?.endDate);
    const printedAt = meta.printedAt instanceof Date ? meta.printedAt : new Date();
    const printedAtLabel = printedAt.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    const printMeta = {
      showWeekSeparators: meta.showWeekSeparators === true,
      hideDaysWithoutSession: meta.hideDaysWithoutSession !== false
    };
    const fallbackSettings = {
      includeOrg: true,
      orgName,
      includeHeaderNote: false,
      headerNote: '',
      orientation: 'landscape',
      density: 'compact',
      requestedByLabel: '',
      logoUrl: ''
    };
    const settings = global.AppPrintManager?.normalizeSettings
      ? global.AppPrintManager.normalizeSettings({ ...fallbackSettings, ...(meta.printSettings || {}) })
      : fallbackSettings;
    const displayOrgName = settings.includeOrg ? String(settings.orgName || orgName || '').trim() : '';
    const logoUrl = String(settings.logoUrl || '').trim();
    const logoHtml = logoUrl
      ? `<img class="print-logo" src="${escapeHtml(logoUrl)}" alt="Organization logo" onerror="this.style.display='none'">`
      : '';
    const pageCss = global.PrintDocumentBuilder?.buildPageCss
      ? global.PrintDocumentBuilder.buildPageCss(settings.orientation)
      : `@page { margin: 10mm; size: ${settings.orientation === 'portrait' ? 'portrait' : 'landscape'}; }`;
    const previewControlsHtml = global.AppPrintManager?.buildPreviewControlsHtml
      ? global.AppPrintManager.buildPreviewControlsHtml(settings)
      : '<div class="screen-actions no-print"><button type="button" onclick="window.print()">Print</button><button type="button" onclick="window.close()">Close</button></div>';
    const printNoteHtml = global.AppPrintManager?.buildPrintNoteHtml
      ? global.AppPrintManager.buildPrintNoteHtml(settings)
      : '';
    const orientationScript = global.PrintDocumentBuilder?.buildPreviewOrientationScript
      ? global.PrintDocumentBuilder.buildPreviewOrientationScript({
        orientation: settings.orientation,
        sourcePath: global.location.pathname,
        mode: 'class-conduct-report'
      })
      : '';

    const filterNotes = [];
    if (printMeta.hideDaysWithoutSession) filterNotes.push('Days without sessions hidden');
    if (printMeta.showWeekSeparators) filterNotes.push('Week separators shown');
    const filterNote = filterNotes.join(' · ');

    const studentNames = students.map((s) => String(s.name || s.personId || '').trim()).filter(Boolean);
    const studentListLabel = studentNames.length <= 5
      ? studentNames.join(', ')
      : `${studentNames.slice(0, 5).join(', ')} +${studentNames.length - 5} more`;

    const legendHtml = buildClassConductPrintLegendHtml();
    const studentSections = students.map((student, index) => {
      const name = escapeHtml(student.name || student.personId || 'Student');
      const rated = Number(student.summary?.ratedSessions) || 0;
      const tableHtml = buildClassConductPrintStudentTable(student, days, printMeta);
      const breakClass = index < students.length - 1 ? ' ccr-print-student-page' : '';
      return `<section class="ccr-print-student-section${breakClass}">
        <h2 class="student-heading">${name} <span class="student-meta">${rated} rated session${rated === 1 ? '' : 's'}</span></h2>
        ${tableHtml}
      </section>`;
    }).join('');

    const emptyDoc = !students.length
      ? '<p class="empty-msg">No students in the loaded report.</p>'
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml('Class Conduct Report')}</title>
  <style id="print-page-orientation-css">${pageCss}</style>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; font-size: 10px; color: #111; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body.print-density-normal { font-size: 11px; line-height: 1.35; }
    .sheet { padding: 0; }
    .identity-block { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 8px; }
    .identity-copy { min-width: 0; flex: 1 1 auto; }
    .print-logo { display: block; flex: 0 0 auto; width: auto; height: 58px; max-width: 180px; object-fit: contain; object-position: right top; }
    .doc-header { margin-bottom: 8px; }
    .doc-header h1 { margin: 0 0 2px 0; font-size: 16px; font-weight: 700; }
    .org-name { font-size: 13px; font-weight: 700; margin: 0 0 4px 0; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 8px 16px; color: #333; font-size: 10px; margin-top: 4px; }
    .print-note { margin: 0 0 8px; font-size: 10px; color: #444; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 8px; font-size: 10px; color: #444; }
    .summary .stat b { color: #111; }
    .cm-print-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; font-size: 9px; }
    .cm-print-legend-item { display: inline-flex; align-items: center; gap: 4px; }
    .ccr-print-student-section { margin-bottom: 14px; }
    .ccr-print-student-section.ccr-print-student-page { page-break-after: always; }
    .student-heading { font-size: 12px; font-weight: 700; margin: 0 0 6px 0; }
    .student-meta { font-weight: 400; color: #555; font-size: 10px; }
    table.matrix { width: 100%; border-collapse: collapse; table-layout: auto; margin-bottom: 4px; }
    table.matrix th, table.matrix td { border: 1px solid #bbb; padding: 3px 4px; vertical-align: middle; }
    table.matrix thead th { background: #eef1f4; font-weight: 700; text-align: center; font-size: 9px; }
    table.matrix thead { display: table-header-group; }
    table.matrix tbody tr { page-break-inside: avoid; }
    .rollup-col { text-align: center; min-width: 72px; max-width: 88px; }
    .class-col { text-align: left; min-width: 120px; max-width: 200px; font-size: 9px; }
    .class-name { font-weight: 600; }
    .class-teacher { color: #666; font-size: 8.5px; margin-top: 2px; }
    .day-col { min-width: 52px; font-size: 9px; }
    th.ccr-week-boundary, td.ccr-week-boundary { border-left: 2px solid #94a3b8; }
    .cm-print-cell { text-align: center; font-size: 8.5px; padding: 2px 3px !important; }
    .cm-cell-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.12rem 0.2rem; justify-items: center; }
    .cm-dim-chip {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 1.4rem; padding: 0.05rem 0.18rem; border-radius: 0.2rem;
      background: #e9ecef; font-weight: 700; font-size: 7.5px; line-height: 1.15;
    }
    .cm-dim-chip-empty { background: transparent; color: #adb5bd; font-weight: 400; }
    .cm-dim-chip.cm-code-s { background-color: #198754; color: #fff; border: 1px solid #157347; }
    .cm-dim-chip.cm-code-sat { background-color: #c5f135; color: #1a3d0a; border: 1px solid #a8d42a; }
    .cm-dim-chip.cm-code-ni { background-color: #fd7e14; color: #fff; border: 1px solid #e96b00; }
    .cm-dim-chip.cm-code-u { background-color: #dc3545; color: #fff; border: 1px solid #bb2d3b; }
    .cm-dim-chip.cm-code-na { background-color: #fff; color: #495057; border: 1px solid #ced4da; font-weight: 600; }
    .cm-cell-empty-mark { color: #adb5bd; }
    .cm-cell-off-roster { color: #dee2e6; }
    .st-empty { color: #6c757d; }
    .empty-msg { text-align: center; color: #666; padding: 16px !important; }
    .doc-footer { margin-top: 10px; padding-top: 4px; border-top: 1px solid #ddd; color: #666; font-size: 9px; }
    @media print { body { margin: 0; } .no-print { display: none !important; } }
    @media screen {
      body { background: #e9ecef; padding: 16px; }
      .sheet { background: #fff; padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.12); max-width: 100%; }
    }
  </style>
  ${orientationScript}
</head>
<body class="print-density-${settings.density}" data-print-orientation="${settings.orientation}">
  ${previewControlsHtml}
  <div class="sheet">
    <div class="identity-block">
      <div class="identity-copy">
        <header class="doc-header">
          ${displayOrgName ? `<div class="org-name">${escapeHtml(displayOrgName)}</div>` : ''}
          <h1>Class Conduct Report</h1>
          <div class="meta-row">
            <span><strong>Range:</strong> ${escapeHtml(rangeLabel)}</span>
            <span><strong>Printed:</strong> ${escapeHtml(printedAtLabel)}</span>
            ${settings.requestedByLabel ? `<span><strong>Requested by:</strong> ${escapeHtml(settings.requestedByLabel)}</span>` : ''}
          </div>
        </header>
      </div>
      ${logoHtml}
    </div>
    ${printNoteHtml}
    <div class="summary">
      <span class="stat"><b>${students.length}</b> student${students.length === 1 ? '' : 's'}</span>
      ${studentListLabel ? `<span class="stat">${escapeHtml(studentListLabel)}</span>` : ''}
      ${filterNote ? `<span class="stat">${escapeHtml(filterNote)}</span>` : ''}
    </div>
    ${legendHtml}
    ${studentSections}${emptyDoc}
    <div class="doc-footer">Read-only report. First shown conduct session per day per class. Use Class Conduct Matrix to edit ratings.</div>
  </div>
</body>
</html>`;
  }

  function openClassConductPrint() {
    if (!lastPayload) {
      void showMessage('Nothing to print', 'Load a class conduct report first.', 'warning');
      return;
    }
    const orgName = String(document.getElementById('activeOrgNameRef')?.getAttribute('data-name') || '').trim()
      || (global.AppPrintManager?.resolveActiveOrgName ? global.AppPrintManager.resolveActiveOrgName() : '');
    const defaults = { orgName, orientation: 'landscape', density: 'compact' };
    const openPreview = (settings = defaults) => {
      const html = buildClassConductPrintDocument(lastPayload, {
        orgName,
        printedAt: new Date(),
        printSettings: settings,
        hideDaysWithoutSession,
        showWeekSeparators
      });
      const printWindow = global.AppPrintManager?.openHtmlPreview
        ? global.AppPrintManager.openHtmlPreview({
          title: 'Class Conduct Report',
          html,
          settings,
          sourcePath: global.location.pathname,
          view: 'class-conduct-report'
        })
        : null;
      if (!printWindow) {
        void showMessage(
          'Popup blocked',
          'Allow pop-ups for this site to open the print page.',
          'warning'
        );
      }
    };
    if (global.AppPrintManager?.openSettings) {
      global.AppPrintManager.openSettings({
        mode: 'class-conduct-report',
        defaults,
        onConfirm: openPreview
      });
    } else {
      openPreview(defaults);
    }
  }

  function studentDisplayName(item) {
    const first = String(item?.firstName || item?.name?.first || '').trim();
    const last = String(item?.lastName || item?.name?.last || '').trim();
    return `${first} ${last}`.trim() || String(item?.name || item?.displayName || item?.label || item?.id || '').trim();
  }

  function normalizeSelectedStudentItems(items) {
    const list = Array.isArray(items) ? items : (items ? [items] : []);
    return list.map((item) => {
      const studentRecordId = String(item?.studentRecordId || item?.studentId || item?.id || '').trim();
      return {
        id: studentRecordId,
        studentRecordId,
        personId: String(item?.personId || item?.meta?.personId || '').trim(),
        name: studentDisplayName(item)
      };
    }).filter((row) => row.studentRecordId);
  }

  function findStudentReportCard(student = {}) {
    const container = document.getElementById('ccrStudentSections');
    if (!container) return null;
    const personId = String(student?.personId || '').trim();
    const studentRecordId = String(student?.studentRecordId || student?.id || '').trim();
    if (personId) {
      const byPerson = container.querySelector(`.ccr-student-report-card[data-person-id="${CSS.escape(personId)}"]`);
      if (byPerson) return byPerson;
    }
    if (studentRecordId) {
      return container.querySelector(`.ccr-student-report-card[data-student-record-id="${CSS.escape(studentRecordId)}"]`);
    }
    return null;
  }

  function removeStudentReportSection(student = {}) {
    const card = findStudentReportCard(student);
    if (card) card.remove();
    syncResultsContainerVisibility();
  }

  function syncResultsContainerVisibility() {
    const results = document.getElementById('ccrResultsContainer');
    const container = document.getElementById('ccrStudentSections');
    if (!results || !container) return;
    if (!selectedStudents.length) {
      container.innerHTML = '';
      results.classList.add('d-none');
      lastPayload = null;
      setClassConductPrintEnabled(false);
      return;
    }
    const remainingCards = container.querySelectorAll('.ccr-student-report-card').length;
    if (remainingCards === 0 && !container.querySelector('p.text-muted')) {
      container.innerHTML = '<p class="text-muted mb-0">Click Apply to load conduct for the selected students.</p>';
    }
    results.classList.remove('d-none');
  }

  function syncStudentReportSectionOrder() {
    const container = document.getElementById('ccrStudentSections');
    if (!container || !selectedStudents.length) return;
    selectedStudents.forEach((student) => {
      const card = findStudentReportCard(student);
      if (card) container.appendChild(card);
    });
  }

  function moveSelectedStudent(index, delta) {
    const fromIndex = Number(index);
    const toIndex = fromIndex + Number(delta);
    if (fromIndex < 0 || fromIndex >= selectedStudents.length) return;
    if (toIndex < 0 || toIndex >= selectedStudents.length) return;
    const [row] = selectedStudents.splice(fromIndex, 1);
    selectedStudents.splice(toIndex, 0, row);
    renderSelectedStudents();
    syncStudentReportSectionOrder();
  }

  function removeSelectedStudentAt(index) {
    const targetIndex = Number(index);
    if (targetIndex < 0 || targetIndex >= selectedStudents.length) return;
    const removed = selectedStudents[targetIndex];
    selectedStudents.splice(targetIndex, 1);
    removeStudentReportSection(removed);
    renderSelectedStudents();
  }

  function setAllStudentSectionsExpanded(expanded) {
    document.querySelectorAll('#ccrStudentSections .collapse').forEach((sectionEl) => {
      const collapse = global.bootstrap?.Collapse?.getOrCreateInstance(sectionEl, { toggle: false });
      if (collapse) {
        if (expanded) collapse.show();
        else collapse.hide();
      } else {
        sectionEl.classList.toggle('show', expanded);
      }
      const toggleBtn = document.querySelector(`[data-bs-target="#${sectionEl.id}"]`);
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  function renderSelectedStudents() {
    const menuLabel = document.getElementById('ccr_selectedMenuLabel');
    const menuBtn = document.getElementById('ccr_btnSelectedMenu');
    const listEl = document.getElementById('ccr_selectedStudentsList');
    if (!menuLabel || !menuBtn || !listEl) return;

    if (!selectedStudents.length) {
      menuLabel.textContent = 'No students selected';
      menuBtn.disabled = true;
      listEl.innerHTML = '<div class="text-muted small px-1">No students selected.</div>';
      syncUrl();
      return;
    }

    menuLabel.textContent = `${selectedStudents.length} student${selectedStudents.length === 1 ? '' : 's'} selected`;
    menuBtn.disabled = false;
    listEl.innerHTML = selectedStudents.map((student, index) => {
      const studentId = String(student.studentRecordId || student.id || '').trim();
      const canMoveUp = index > 0;
      const canMoveDown = index < selectedStudents.length - 1;
      return `
        <div class="sar-selected-student-row">
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-secondary">${index + 1}</span>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold small text-truncate">${escapeHtml(student.name || studentId)}</div>
              <div class="text-muted x-small font-monospace">${escapeHtml(studentId)}</div>
            </div>
            <div class="d-flex align-items-center gap-1">
              <button type="button" class="btn btn-outline-secondary btn-sm py-0 px-1" data-move-student-up="${index}" title="Move up" ${canMoveUp ? '' : 'disabled'}>
                <i class="bi bi-arrow-up"></i>
              </button>
              <button type="button" class="btn btn-outline-secondary btn-sm py-0 px-1" data-move-student-down="${index}" title="Move down" ${canMoveDown ? '' : 'disabled'}>
                <i class="bi bi-arrow-down"></i>
              </button>
              <button type="button" class="btn btn-outline-danger btn-sm py-0 px-1" data-remove-student-index="${index}" title="Remove">
                <i class="bi bi-x-lg"></i>
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('[data-move-student-up]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        moveSelectedStudent(Number(btn.getAttribute('data-move-student-up')), -1);
      });
    });
    listEl.querySelectorAll('[data-move-student-down]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        moveSelectedStudent(Number(btn.getAttribute('data-move-student-down')), 1);
      });
    });
    listEl.querySelectorAll('[data-remove-student-index]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        removeSelectedStudentAt(Number(btn.getAttribute('data-remove-student-index')));
      });
    });
    syncUrl();
  }

  async function showMessage(title, message, icon = 'info') {
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title,
        icon,
        message,
        buttons: [{ text: 'Close', class: 'btn-secondary' }]
      });
      return;
    }
    global.alert(message);
  }

  function showLoading(note) {
    if (typeof global.showLoading === 'function') {
      loadToken = global.showLoading({
        title: 'Loading Report',
        note,
        operation: 'Class Conduct Report',
        progress: 0
      });
    }
    return loadToken;
  }

  function hideLoading() {
    if (loadToken && typeof global.hideLoading === 'function') {
      global.hideLoading(loadToken);
      loadToken = null;
    } else if (typeof global.hideLoading === 'function') {
      global.hideLoading({ force: true });
    }
  }

  function updateLoading(patch) {
    if (loadToken && typeof global.updateLoading === 'function') {
      global.updateLoading(patch);
    }
  }

  async function pollJob(jobId) {
    const pollMs = 1500;
    for (let attempt = 0; attempt < 450; attempt += 1) {
      const res = await fetch(`/school/class-conduct-report/api/report-jobs/${encodeURIComponent(jobId)}`, {
        headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' }
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Could not check report job.');
      }
      const job = payload.job || {};
      if (job.totalItems > 0) {
        updateLoading({
          progress: Math.round((job.processedItems / job.totalItems) * 100),
          note: `Processed ${job.processedItems} of ${job.totalItems} class loads…`
        });
      }
      if (job.status === 'failed') throw new Error(job.error || 'Report load failed.');
      if (job.status === 'complete') {
        if (!payload.reportPayload || payload.reportPayload.status !== 'success') {
          throw new Error(payload.reportPayload?.message || 'Report load failed.');
        }
        return payload.reportPayload;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error('Report load timed out.');
  }

  async function loadReport() {
    const startDate = String(document.getElementById('ccr_startDate')?.value || '').trim();
    const endDate = String(document.getElementById('ccr_endDate')?.value || '').trim();
    const studentIds = selectedStudents.map((r) => String(r.studentRecordId || r.id || '').trim()).filter(Boolean);
    if (!studentIds.length) {
      await showMessage('Students required', 'Select at least one student.', 'warning');
      return;
    }

    const btn = document.getElementById('ccr_btnLoad');
    const orig = btn?.innerHTML;
    showLoading(`Loading ${studentIds.length} student${studentIds.length === 1 ? '' : 's'}…`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }

    try {
      let payload;
      if (studentIds.length >= ASYNC_MIN_STUDENTS) {
        const res = await fetch('/school/class-conduct-report/api/data-async', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'X-AJAX-Request': 'true'
          },
          body: new URLSearchParams({
            startDate,
            endDate,
            studentIds: studentIds.join(',')
          }).toString()
        });
        if (res.status !== 202) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Could not start report load.');
        }
        const accepted = await res.json().catch(() => ({}));
        const jobId = accepted?.job?.jobId || accepted?.jobId;
        if (!jobId) throw new Error('Report load did not return a job id.');
        payload = await pollJob(jobId);
      } else {
        const params = new URLSearchParams({ startDate, endDate, studentIds: studentIds.join(',') });
        const res = await fetch(`/school/class-conduct-report/api/data?${params.toString()}`, {
          headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' }
        });
        payload = await res.json().catch(() => ({}));
        if (!res.ok || payload.status !== 'success') {
          throw new Error(payload.message || 'Load failed.');
        }
      }
      lastPayload = payload;
      renderSections(payload);
      syncUrl();
    } catch (error) {
      lastPayload = null;
      setClassConductPrintEnabled(false);
      await showMessage('Load failed', error.message || 'Load failed.', 'error');
    } finally {
      hideLoading();
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  }

  function syncUrl() {
    const startDate = document.getElementById('ccr_startDate')?.value || '';
    const endDate = document.getElementById('ccr_endDate')?.value || '';
    const studentIds = selectedStudents.map((r) => String(r.studentRecordId || '').trim()).filter(Boolean);
    const url = new URL(global.location.href);
    if (startDate) url.searchParams.set('startDate', startDate);
    else url.searchParams.delete('startDate');
    if (endDate) url.searchParams.set('endDate', endDate);
    else url.searchParams.delete('endDate');
    if (studentIds.length) url.searchParams.set('studentIds', studentIds.join(','));
    else url.searchParams.delete('studentIds');
    global.history.replaceState({}, '', url.toString());
  }

  async function copyLink() {
    syncUrl();
    try {
      await navigator.clipboard.writeText(global.location.href);
      await showMessage('Link copied', 'Shareable link copied to clipboard.', 'success');
    } catch (_) {
      await showMessage('Copy failed', 'Could not copy the link.', 'warning');
    }
  }

  function openStudentPicker() {
    if (!global.GenericPicker?.open || !global.GenericPickerPresets?.student) {
      void showMessage('Unavailable', 'Student picker is not available on this page yet.', 'warning');
      return;
    }
    global.GenericPicker.open(global.GenericPickerPresets.student({
      title: 'Select Students',
      placeholder: 'Search students, select one or more...',
      multiselect: true,
      selectedItems: selectedStudents.map((row) => ({
        id: row.studentRecordId || row.id,
        studentRecordId: row.studentRecordId || row.id,
        personId: row.personId,
        firstName: row.name,
        name: row.name
      })),
      onSelect(items) {
        selectedStudents = normalizeSelectedStudentItems(items);
        renderSelectedStudents();
      }
    }));
  }

  function openHierarchicalStudentPicker() {
    if (!global.SchoolEntityPicker || typeof global.SchoolEntityPicker.open !== 'function') {
      void showMessage('Unavailable', 'Class-based student picker is not available on this page yet.', 'warning');
      return;
    }
    const referenceDate = document.getElementById('ccr_startDate')?.value
      || document.getElementById('ccr_endDate')?.value
      || '';
    global.SchoolEntityPicker.open({
      target: 'students',
      title: 'Browse Students by Class',
      multiselect: true,
      referenceDate,
      selectedItems: selectedStudents.map((row) => ({
        id: row.studentRecordId || row.id,
        studentId: row.studentRecordId || row.id,
        studentRecordId: row.studentRecordId || row.id,
        personId: row.personId,
        label: row.name,
        name: row.name
      })),
      onSelect(items) {
        selectedStudents = normalizeSelectedStudentItems(items);
        renderSelectedStudents();
      }
    });
  }

  function openCellModal(cellEl) {
    if (!cellEl || !lastPayload) return;
    const personId = cellEl.getAttribute('data-person-id');
    const classId = cellEl.getAttribute('data-class-id');
    const date = cellEl.getAttribute('data-date');
    const student = (lastPayload.students || []).find((s) => s.personId === personId);
    const classRow = (student?.classes || []).find((c) => c.classId === classId);
    const dayCell = (classRow?.days || []).find((d) => String(d.date) === String(date));
    document.getElementById('ccrModalMeta').textContent = [
      student?.name,
      classRow?.className,
      date
    ].filter(Boolean).join(' · ');
    const body = document.getElementById('ccrModalBody');
    if (!dayCell?.value?.summary) {
      body.innerHTML = '<p class="text-muted mb-0">No conduct rating saved for this session.</p>';
    } else {
      body.innerHTML = buildCellInnerHtml(dayCell);
    }
    const modalEl = document.getElementById('ccrCellModal');
    if (modalEl && global.bootstrap) {
      global.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  function wireEvents() {
    document.getElementById('ccr_btnStudentPicker')?.addEventListener('click', openStudentPicker);
    document.getElementById('ccr_btnBrowseClasses')?.addEventListener('click', openHierarchicalStudentPicker);
    document.getElementById('ccr_btnClearStudents')?.addEventListener('click', () => {
      selectedStudents = [];
      renderSelectedStudents();
      syncResultsContainerVisibility();
    });
    document.getElementById('ccr_btnLoad')?.addEventListener('click', () => { void loadReport(); });
    document.getElementById('ccr_btnReset')?.addEventListener('click', () => {
      selectedStudents = [];
      document.getElementById('ccr_startDate').value = '';
      document.getElementById('ccr_endDate').value = '';
      document.querySelectorAll('.ccr-range').forEach((b) => b.classList.remove('active'));
      renderSelectedStudents();
      document.getElementById('ccrResultsContainer')?.classList.add('d-none');
      lastPayload = null;
      setClassConductPrintEnabled(false);
    });
    document.getElementById('btn_printClassConductReport')?.addEventListener('click', () => { openClassConductPrint(); });
    document.getElementById('ccr_btnCopyLink')?.addEventListener('click', () => { void copyLink(); });
    document.querySelectorAll('.ccr-range').forEach((btn) => {
      btn.addEventListener('click', () => applyQuickRange(btn.getAttribute('data-range')));
    });
    document.getElementById('ccr_btnHideEmptyDays')?.addEventListener('click', (event) => {
      hideDaysWithoutSession = !hideDaysWithoutSession;
      event.currentTarget.classList.toggle('active', hideDaysWithoutSession);
      event.currentTarget.setAttribute('aria-pressed', hideDaysWithoutSession ? 'true' : 'false');
      if (lastPayload) renderSections(lastPayload);
    });
    document.getElementById('ccr_btnWeekSeparators')?.addEventListener('click', (event) => {
      showWeekSeparators = !showWeekSeparators;
      event.currentTarget.classList.toggle('active', showWeekSeparators);
      event.currentTarget.setAttribute('aria-pressed', showWeekSeparators ? 'true' : 'false');
      document.getElementById('ccrResultsContainer')?.classList.toggle('ccr-week-separators-on', showWeekSeparators);
      if (lastPayload) renderSections(lastPayload);
    });
    document.getElementById('ccr_btnExpandAllStudents')?.addEventListener('click', () => setAllStudentSectionsExpanded(true));
    document.getElementById('ccr_btnCollapseAllStudents')?.addEventListener('click', () => setAllStudentSectionsExpanded(false));
    document.getElementById('ccrStudentSections')?.addEventListener('click', (event) => {
      const cell = event.target.closest('td[data-ccr-cell]');
      if (cell) openCellModal(cell);
    });
  }

  function initFromUrl() {
    if (INITIAL.startDate) document.getElementById('ccr_startDate').value = INITIAL.startDate;
    if (INITIAL.endDate) document.getElementById('ccr_endDate').value = INITIAL.endDate;
    if (!INITIAL.startDate && !INITIAL.endDate) applyQuickRange('thisMonth');
    if (Array.isArray(INITIAL.students) && INITIAL.students.length) {
      selectedStudents = normalizeSelectedStudentItems(INITIAL.students);
      renderSelectedStudents();
    }
  }

  function buildCcrSharedLinkConfirmHtml({ startDate = '', endDate = '', studentCount = 0 } = {}) {
    const start = escapeHtml(startDate || '—');
    const end = escapeHtml(endDate || '—');
    const count = Number(studentCount) || 0;
    const studentLabel = count === 1 ? '1 student' : `${count} students`;
    return (
      '<div class="text-start ccr-shared-link-prompt">'
      + '<p class="mb-3">This page was opened from a link with report filters already set.</p>'
      + '<ul class="list-unstyled mb-3 border rounded bg-light px-3 py-2">'
      + '<li class="mb-2 d-flex align-items-start gap-2">'
      + '<i class="bi bi-calendar-range text-primary mt-1"></i>'
      + '<span><span class="text-muted d-block small">Date range</span>'
      + `<strong>${start}</strong> <span class="text-muted">to</span> <strong>${end}</strong></span></li>`
      + '<li class="mb-0 d-flex align-items-start gap-2">'
      + '<i class="bi bi-people text-primary mt-1"></i>'
      + `<span><span class="text-muted d-block small">Students selected</span><strong>${escapeHtml(studentLabel)}</strong></span></li>`
      + '</ul>'
      + '<p class="mb-0">Load the report now with these settings, or choose <strong>Not now</strong> to review the filters first.</p>'
      + '</div>'
    );
  }

  function buildCcrSharedLinkDeclinedHtml() {
    return (
      '<div class="text-start ccr-shared-link-prompt">'
      + '<p class="mb-2">No report was loaded.</p>'
      + '<p class="mb-2">The date range and students from the link are still shown in the filter panel.</p>'
      + '<p class="mb-0">When you are ready, click <strong>Load</strong> to run the report.</p>'
      + '</div>'
    );
  }

  function runWhenReportMessageModalReady(callback) {
    const run = () => {
      const ready = typeof window.showMessageModal === 'function' && document.getElementById('messageModal');
      if (!ready) {
        window.setTimeout(run, 50);
        return;
      }
      callback();
    };
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
  }

  async function promptLoadReportFromUrlLink() {
    const studentCount = selectedStudents.length
      || (Array.isArray(INITIAL.studentIds) ? INITIAL.studentIds.length : 0);
    let confirmed = false;
    if (window.ReportMessaging?.confirmReportAction) {
      confirmed = await window.ReportMessaging.confirmReportAction({
        title: 'Open report from link?',
        icon: 'info',
        html: true,
        message: buildCcrSharedLinkConfirmHtml({
          startDate: INITIAL.startDate || document.getElementById('ccr_startDate')?.value,
          endDate: INITIAL.endDate || document.getElementById('ccr_endDate')?.value,
          studentCount
        }),
        confirmText: 'Load report',
        cancelText: 'Not now',
        confirmClass: 'btn-primary'
      });
    }
    if (!confirmed) {
      if (window.ReportMessaging?.showReportMessage) {
        await window.ReportMessaging.showReportMessage({
          title: 'Class Conduct Report',
          icon: 'info',
          html: true,
          message: buildCcrSharedLinkDeclinedHtml()
        });
      }
      return;
    }
    void loadReport();
  }

  const ccrOpenedFromUrlQuery = Boolean(
    INITIAL.startDate
    && INITIAL.endDate
    && (
      (Array.isArray(INITIAL.students) && INITIAL.students.length)
      || (Array.isArray(INITIAL.studentIds) && INITIAL.studentIds.length)
    )
  );

  document.addEventListener('DOMContentLoaded', () => {
    renderLegend();
    setClassConductPrintEnabled(false);
    wireEvents();
    initFromUrl();
    if (ccrOpenedFromUrlQuery) {
      runWhenReportMessageModalReady(() => {
        void promptLoadReportFromUrlLink();
      });
    }
  });
}(window));
