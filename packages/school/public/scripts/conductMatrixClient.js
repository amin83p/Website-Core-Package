(function initConductMatrix(global) {
  'use strict';

  const INITIAL = global.__conductMatrixInitial || {};
  const CONDUCT = global.ConductRatingCell || {};
  const DIMENSIONS = [
    { key: 'classEffortPercent', label: 'Class effort' },
    { key: 'classParticipationPercent', label: 'Participation' },
    { key: 'respectsTeachersPercent', label: 'Respects teachers' },
    { key: 'respectsStudentsPercent', label: 'Respects students' }
  ];
  const DIM_KEYS = DIMENSIONS.map((d) => d.key);

  let matrixData = null;
  let conductOnlyFilter = false;
  let modalContext = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isColumnShown(session) {
    return session?.conductRequiredForReports === true || session?.conductReportStepEnabled === true;
  }

  function sessionMatchesConductFilter(session) {
    return session?.conductRequiredForReports === true
      || session?.conductReportStepEnabled === true
      || session?.hasSavedConduct === true;
  }

  function visibleSessions(allSessions) {
    const list = Array.isArray(allSessions) ? allSessions : [];
    if (!conductOnlyFilter) return list;
    return list.filter((s) => sessionMatchesConductFilter(s));
  }

  function resolveActionStateId() {
    const input = document.querySelector('input[name="actionStateId"]');
    const fromInput = String(input?.value || '').trim();
    if (fromInput) return fromInput;
    return String(INITIAL.actionStateId || '').trim();
  }

  function syncActionStateFromResponse(res) {
    if (!res || typeof res.headers?.get !== 'function') return;
    const next = String(res.headers.get('x-action-state-id') || res.headers.get('X-Action-State-Id') || '').trim();
    if (!next) return;
    const input = document.querySelector('input[name="actionStateId"]');
    if (input) input.value = next;
  }

  function stripHtmlForMessage(value) {
    const raw = String(value ?? '');
    if (!raw.includes('<')) return raw;
    const el = document.createElement('div');
    el.innerHTML = raw;
    return (el.textContent || el.innerText || raw).trim();
  }

  async function showCmMessage(title, message, icon = 'info') {
    const plain = stripHtmlForMessage(message);
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title: String(title || 'Notice'),
        icon,
        message: plain,
        buttons: [{ text: 'OK', class: icon === 'error' || icon === 'warning' ? 'btn-secondary' : 'btn-primary' }]
      });
      return;
    }
    alert(plain);
  }

  function readApiErrorMessage(res, result) {
    const payload = result && typeof result === 'object' ? result : {};
    const msg = payload.message || payload.error || '';
    if (msg) return stripHtmlForMessage(msg);
    return `Request failed (${res?.status || 'unknown'}).`;
  }

  const CM_DATE_RANGE_MENU_ID = 'cmDateRangeMenu';

  function applyConductRangeSelection(range) {
    const shortcuts = global.SchoolDateRangeShortcuts;
    if (!shortcuts) return false;
    const payload = shortcuts.datesFromRangeToken(range);
    document.getElementById('cm_startDate').value = payload.startDate;
    document.getElementById('cm_endDate').value = payload.endDate;
    shortcuts.setActiveMenuOption(CM_DATE_RANGE_MENU_ID, payload.token);
    return true;
  }

  function bindConductMatrixDateRangeShortcuts() {
    const shortcuts = global.SchoolDateRangeShortcuts;
    if (!shortcuts) return;
    shortcuts.bindDateRangeShortcuts({
      menuId: CM_DATE_RANGE_MENU_ID,
      buttonId: 'btn_cmDateShortcuts',
      startInputId: 'cm_startDate',
      endInputId: 'cm_endDate'
    });
  }

  function readFilters() {
    return {
      classId: String(document.getElementById('cm_classId')?.value || '').trim(),
      className: String(document.getElementById('cm_className')?.value || '').trim(),
      startDate: String(document.getElementById('cm_startDate')?.value || '').trim(),
      endDate: String(document.getElementById('cm_endDate')?.value || '').trim()
    };
  }

  function setFilters(filters) {
    document.getElementById('cm_classId').value = filters.classId || '';
    document.getElementById('cm_className').value = filters.className || '';
    document.getElementById('cm_startDate').value = filters.startDate || '';
    document.getElementById('cm_endDate').value = filters.endDate || '';
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

  function buildConductChipHtml(code, titleText) {
    const codeText = escapeHtml(code || '—');
    const chipClass = conductChipClassFromCode(code);
    const title = escapeHtml(titleText || codeText);
    return `<span class="cm-dim-chip ${chipClass}" title="${title}">${codeText}</span>`;
  }

  function formatSessionShortDate(dateStr) {
    const raw = String(dateStr || '').trim();
    if (!raw) return '—';
    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  async function confirmOpenManageSession(classId, sessionId) {
    const cleanClassId = String(classId || '').trim();
    const cleanSessionId = String(sessionId || '').trim();
    if (!cleanClassId || !cleanSessionId) return;
    const href = `/school/classes/${encodeURIComponent(cleanClassId)}/sessions/${encodeURIComponent(cleanSessionId)}`;
    if (typeof global.showMessageModal === 'function') {
      const res = await global.showMessageModal({
        title: 'Open Session Manager',
        icon: 'question',
        message: 'Do you want to open the Session Manager for this session in a new tab?',
        buttons: [
          { text: 'Cancel', class: 'btn-secondary', value: false },
          { text: 'Open Session', class: 'btn-primary', value: true }
        ]
      });
      const open = res === true || res === 'Open Session' || (res && res.value === true);
      if (open) global.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (global.confirm('Open Session Manager for this session in a new tab?')) {
      global.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  function syncConductFilterButtons() {
    const allBtn = document.getElementById('cm_btnShowAllSessions');
    const conductBtn = document.getElementById('cm_btnShowConductSessions');
    allBtn?.classList.toggle('active', !conductOnlyFilter);
    conductBtn?.classList.toggle('active', conductOnlyFilter);
    if (allBtn) allBtn.setAttribute('aria-pressed', !conductOnlyFilter ? 'true' : 'false');
    if (conductBtn) conductBtn.setAttribute('aria-pressed', conductOnlyFilter ? 'true' : 'false');
  }

  function computeStudentConductAverages(personId, columns) {
    const sums = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
    const counts = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
    columns.forEach((session) => {
      if (!isColumnShown(session)) return;
      const cell = matrixData?.cells?.[personId]?.[session.sessionId];
      if (!cell?.onRoster || !cell.value?.percents) return;
      DIM_KEYS.forEach((key) => {
        const raw = cell.value.percents[key];
        if (raw == null || raw === '') return;
        const num = Number(raw);
        if (!Number.isFinite(num)) return;
        sums[key] += num;
        counts[key] += 1;
      });
    });
    const avgs = {};
    DIM_KEYS.forEach((key) => {
      avgs[key] = counts[key] > 0 ? Math.round((sums[key] / counts[key]) * 10) / 10 : null;
    });
    return avgs;
  }

  function buildRollupInnerHtml(avgs) {
    const hasAny = DIM_KEYS.some((k) => avgs[k] != null);
    if (!hasAny) return '<span class="cm-cell-empty-mark">—</span>';
    const summaryParts = [];
    const chips = DIMENSIONS.map((dim) => {
      const avg = avgs[dim.key];
      if (avg == null) return '<span class="cm-dim-chip cm-dim-chip-empty">—</span>';
      const level = CONDUCT.percentToConductLevel ? CONDUCT.percentToConductLevel(avg) : null;
      const code = level?.displayCode || level?.code || String(Math.round(avg));
      summaryParts.push(`${dim.label}: ${avg}% avg`);
      return buildConductChipHtml(code, `${dim.label}: ${avg}% avg`);
    }).join('');
    return `<div class="cm-cell-grid" title="${escapeHtml(summaryParts.join(' · '))}">${chips}</div>`;
  }

  function renderConductLegendHosts() {
    const policy = global.__conductRatingScalePolicy || {};
    const levels = Array.isArray(policy.levels) ? policy.levels : [];
    if (!levels.length) return;
    const html = levels.map((level) => {
      const code = level.displayCode || level.code || '';
      return `<span class="cm-legend-item">${buildConductChipHtml(code, level.label || code)} ${escapeHtml(level.label || '')}</span>`;
    }).join('');
    ['cmConductLegend', 'cmModalLegendInline'].forEach((id) => {
      const host = document.getElementById(id);
      if (host) host.innerHTML = html;
    });
  }

  function buildCellInnerHtml(cell, session) {
    if (!cell?.onRoster) {
      return '<span class="cm-cell-off-roster" aria-hidden="true">·</span>';
    }
    if (!cell.value?.summary) {
      return '<span class="cm-cell-empty-mark">—</span>';
    }
    const labels = cell.value.labels || {};
    const percents = cell.value.percents || {};
    const chips = DIMENSIONS.map((dim) => {
      const code = labels[dim.key] || '—';
      const pct = percents[dim.key];
      const title = pct != null && pct !== '' ? `${dim.label}: ${pct}%` : dim.label;
      return buildConductChipHtml(code, title);
    }).join('');
    return `<div class="cm-cell-grid" title="${escapeHtml(cell.value.summary)}">${chips}</div>`;
  }

  function wrapEnrollmentClaimName(nameHtml, stu) {
    if (global.EnrollmentClaimToggle && typeof global.EnrollmentClaimToggle.wrapNameHtml === 'function') {
      return global.EnrollmentClaimToggle.wrapNameHtml(nameHtml, {
        personId: stu?.personId,
        studentRecordId: stu?.studentRecordId
      });
    }
    return nameHtml;
  }

  function buildStudentNameCell(stu) {
    const name = escapeHtml(stu.name || stu.personId);
    const recordId = String(stu.studentRecordId || '').trim();
    const nameHtml = recordId
      ? `<a href="/school/students/edit/${encodeURIComponent(recordId)}" target="_blank" rel="noopener noreferrer" class="text-decoration-none">${name}</a>`
      : name;
    return wrapEnrollmentClaimName(nameHtml, stu);
  }

  function getPrintSessionColumns(fromData) {
    const source = fromData || matrixData;
    const allSessions = source?.sessions || [];
    return visibleSessions(allSessions).filter((s) => isColumnShown(s));
  }

  function setConductPrintEnabled(enabled) {
    const btn = document.getElementById('btn_printConductMatrix');
    if (!btn) return;
    btn.disabled = !enabled;
    btn.title = enabled ? 'Print class conduct matrix for the loaded range' : 'Load the matrix first';
    if (global.EnrollmentClaimToggle) {
      global.EnrollmentClaimToggle.setReady(Boolean(enabled));
    }
    if (global.SchoolMatrixExpandedView) {
      global.SchoolMatrixExpandedView.setMatrixExpandEnabled('btn_cmExpandMatrixView', enabled);
    }
  }

  function cmPrintFormatDateShort(ymd) {
    const raw = String(ymd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || '—';
    const d = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function cmPrintFormatRangeLabel(startDate, endDate) {
    const start = String(startDate || '').trim();
    const end = String(endDate || '').trim();
    if (!start && !end) return 'All sessions';
    if (start && end) return `${cmPrintFormatDateShort(start)} – ${cmPrintFormatDateShort(end)}`;
    if (start) return `From ${cmPrintFormatDateShort(start)}`;
    return `Through ${cmPrintFormatDateShort(end)}`;
  }

  function buildCmSessionDateGroups(sessions) {
    const groups = [];
    let i = 0;
    const list = Array.isArray(sessions) ? sessions : [];
    while (i < list.length) {
      const d = String(list[i].date || '').trim();
      let j = i + 1;
      while (j < list.length && String(list[j].date || '').trim() === d) j += 1;
      groups.push({ date: d, start: i, len: j - i });
      i = j;
    }
    return groups;
  }

  function buildConductPrintLegendHtml() {
    const policy = global.__conductRatingScalePolicy || {};
    const levels = Array.isArray(policy.levels) ? policy.levels : [];
    if (!levels.length) return '';
    const items = levels.map((level) => {
      const code = level.displayCode || level.code || '';
      return `<span class="cm-print-legend-item">${buildConductChipHtml(code, level.label || code)} ${escapeHtml(level.label || '')}</span>`;
    }).join('');
    return `<div class="cm-print-legend">${items}</div>`;
  }

  function buildConductPrintDocument(data, meta = {}) {
    const printColumns = getPrintSessionColumns(data);
    const students = Array.isArray(data?.students) ? data.students : [];
    const className = String(data?.class?.title || meta.className || 'Class').trim() || 'Class';
    const orgName = String(meta.orgName || '').trim();
    const rangeLabel = cmPrintFormatRangeLabel(meta.startDate, meta.endDate);
    const printedAt = meta.printedAt instanceof Date ? meta.printedAt : new Date();
    const printedAtLabel = printedAt.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    const filterNote = conductOnlyFilter ? 'Conduct sessions only' : '';
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
        mode: 'conduct-matrix'
      })
      : '';

    const groups = buildCmSessionDateGroups(printColumns);
    const dateHeaderCells = groups.map((g) => {
      const label = cmPrintFormatDateShort(g.date) || '—';
      return `<th class="day-group" colspan="${g.len}">${escapeHtml(label)}</th>`;
    }).join('');

    let prevSessionDate = '';
    const sessionHeaderCells = printColumns.map((session, columnIndex) => {
      const dateKey = String(session.date || '').trim();
      const dayStart = columnIndex > 0 && dateKey !== prevSessionDate;
      prevSessionDate = dateKey;
      const dayClass = dayStart ? ' cm-day-start' : '';
      const reqMark = session.conductRequiredForReports ? '<span class="req-mark">*</span>' : '';
      return `<th class="sess-col${dayClass}">${escapeHtml(formatSessionShortDate(session.date))}${reqMark}</th>`;
    }).join('');

    const bodyRows = students.map((stu) => {
      const name = escapeHtml(stu.name || stu.personId);
      const avgs = computeStudentConductAverages(stu.personId, printColumns);
      const rollupInner = buildRollupInnerHtml(avgs);
      prevSessionDate = '';
      const cells = printColumns.map((session, columnIndex) => {
        const dateKey = String(session.date || '').trim();
        const dayStart = columnIndex > 0 && dateKey !== prevSessionDate;
        prevSessionDate = dateKey;
        const dayClass = dayStart ? ' cm-day-start' : '';
        const cell = data?.cells?.[stu.personId]?.[session.sessionId] || { onRoster: false, value: null };
        const inner = buildCellInnerHtml(cell, session);
        return `<td class="cm-print-cell${dayClass}">${inner}</td>`;
      }).join('');
      return `<tr>
        <td class="rollup-col">${rollupInner}</td>
        <td class="name-col">${name}</td>
        ${cells || '<td class="cm-print-cell st-empty">—</td>'}
      </tr>`;
    }).join('');

    const emptyRow = !students.length
      ? `<tr><td colspan="${Math.max(2, printColumns.length + 2)}" class="empty-msg">No students found for this range.</td></tr>`
      : '';

    const legendHtml = buildConductPrintLegendHtml();
    const colCount = printColumns.length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(`Class Conduct Matrix — ${className}`)}</title>
  <style id="print-page-orientation-css">${pageCss}</style>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10px;
      color: #111;
      line-height: 1.25;
    }
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
    .cm-print-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; font-size: 9px; }
    .cm-print-legend-item { display: inline-flex; align-items: center; gap: 4px; }
    table.matrix { width: 100%; border-collapse: collapse; table-layout: auto; }
    table.matrix th, table.matrix td {
      border: 1px solid #bbb;
      padding: 3px 4px;
      vertical-align: middle;
    }
    table.matrix thead th {
      background: #eef1f4;
      font-weight: 700;
      text-align: center;
    }
    table.matrix thead { display: table-header-group; }
    table.matrix tbody tr { page-break-inside: avoid; }
    .rollup-col { text-align: center; min-width: 72px; max-width: 88px; }
    .name-col { text-align: left; min-width: 110px; max-width: 180px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .day-group { font-size: 9.5px; }
    .sess-col { min-width: 52px; font-size: 9px; }
    .req-mark { color: #084298; font-weight: 700; }
    th.cm-day-start, td.cm-day-start { border-left: 2px solid #94a3b8; }
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
    .doc-footer {
      margin-top: 10px;
      padding-top: 4px;
      border-top: 1px solid #ddd;
      color: #666;
      font-size: 9px;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
    }
    @media screen {
      body { background: #e9ecef; padding: 16px; }
      .sheet {
        background: #fff;
        padding: 14px 16px;
        box-shadow: 0 1px 6px rgba(0,0,0,0.12);
        max-width: 100%;
      }
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
          <h1>Class Conduct Matrix</h1>
          <div class="meta-row">
            <span><strong>Class:</strong> ${escapeHtml(className)}</span>
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
      <span class="stat"><b>${students.length}</b> students</span>
      <span class="stat"><b>${colCount}</b> shown sessions</span>
      ${filterNote ? `<span class="stat">${escapeHtml(filterNote)}</span>` : ''}
    </div>
    ${legendHtml}
    <table class="matrix">
      <thead>
        ${colCount ? `<tr>
          <th class="rollup-col" rowspan="2">Avg</th>
          <th class="name-col" rowspan="2">Student</th>
          ${dateHeaderCells}
        </tr>
        <tr>${sessionHeaderCells}</tr>` : `<tr>
          <th class="rollup-col">Avg</th>
          <th class="name-col">Student</th>
          <th>No shown sessions in this range</th>
        </tr>`}
      </thead>
      <tbody>
        ${bodyRows}${emptyRow}
      </tbody>
    </table>
    <div class="doc-footer">Ratings reflect the loaded date range and session columns enabled via Show or Required. * = required for assigned reports.</div>
  </div>
</body>
</html>`;
  }

  function openConductPrint() {
    if (!matrixData) {
      void showCmMessage('Nothing to print', 'Load a class conduct matrix first.', 'warning');
      return;
    }
    const orgName = String(document.getElementById('activeOrgNameRef')?.getAttribute('data-name') || '').trim();
    const filters = readFilters();
    const defaults = { orgName, orientation: 'landscape', density: 'compact' };
    const openPreview = (settings = defaults) => {
      const html = buildConductPrintDocument(matrixData, {
        orgName,
        startDate: filters.startDate,
        endDate: filters.endDate,
        className: matrixData.class?.title,
        printedAt: new Date(),
        printSettings: settings
      });
      const printWindow = global.AppPrintManager?.openHtmlPreview
        ? global.AppPrintManager.openHtmlPreview({
          title: 'Class Conduct Matrix',
          html,
          settings,
          sourcePath: global.location.pathname,
          view: 'conduct-matrix'
        })
        : null;
      if (!printWindow) {
        void showCmMessage(
          'Popup blocked',
          'Allow pop-ups for this site to open the print page.',
          'warning'
        );
      }
    };
    if (global.AppPrintManager?.openSettings) {
      global.AppPrintManager.openSettings({
        mode: 'conduct-matrix',
        defaults,
        onConfirm: openPreview
      });
    } else {
      openPreview(defaults);
    }
  }

  async function loadMatrix() {
    const filters = readFilters();
    if (!filters.classId) {
      await showCmMessage('Class required', 'Select a class first.', 'warning');
      return;
    }
    const params = new URLSearchParams({ classId: filters.classId });
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    const btn = document.getElementById('cm_btnLoad');
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }
    try {
      const res = await fetch(`/school/conduct-matrix/api/data?${params.toString()}`, {
        headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' }
      });
      syncActionStateFromResponse(res);
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') {
        throw new Error(readApiErrorMessage(res, result));
      }
      matrixData = result;
      renderMatrix();
      document.getElementById('cm_results')?.classList.remove('d-none');
      document.getElementById('cm_classTitle').textContent = result.class?.title || filters.className || 'Class';
      const url = new URL(global.location.href);
      url.searchParams.set('classId', filters.classId);
      if (filters.startDate) url.searchParams.set('startDate', filters.startDate);
      else url.searchParams.delete('startDate');
      if (filters.endDate) url.searchParams.set('endDate', filters.endDate);
      else url.searchParams.delete('endDate');
      global.history.replaceState({}, '', url.toString());
      setConductPrintEnabled(true);
    } catch (error) {
      setConductPrintEnabled(false);
      await showCmMessage('Load failed', error.message || 'Load failed.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  }

  async function setSessionVisibility(sessionId, enabled) {
    if (!matrixData?.class?.id || !sessionId) return;
    const actionStateId = resolveActionStateId();
    const res = await fetch('/school/conduct-matrix/api/session-visibility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true',
        ...(actionStateId ? { 'X-Action-State-Id': actionStateId } : {})
      },
      body: JSON.stringify({
        classId: matrixData.class.id,
        sessionId,
        enabled: enabled === true,
        ...(actionStateId ? { actionStateId } : {})
      })
    });
    syncActionStateFromResponse(res);
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.status !== 'success') {
      throw new Error(readApiErrorMessage(res, result));
    }
    const session = (matrixData.sessions || []).find((s) => s.sessionId === sessionId);
    if (session) {
      session.conductReportStepEnabled = Boolean(result.data?.conductReportStepEnabled);
      session.columnShowByDefault = session.conductRequiredForReports || session.conductReportStepEnabled;
    }
  }

  function buildConductSessionHeaderCell(classId, session, dayStart) {
    const frozen = session.conductRequiredForReports === true;
    const shown = isColumnShown(session);
    const shortDate = escapeHtml(formatSessionShortDate(session.date));
    const sessionIdAttr = escapeHtml(session.sessionId);
    const classIdAttr = escapeHtml(String(classId || '').trim());
    const dayClass = dayStart ? ' cm-day-start' : '';
    const toggleTitle = frozen
      ? 'Required for assigned reports'
      : 'Show class conduct on Manage Session Reports tab';
    return `<th class="att-cell text-primary small fw-bold cm-session-col cm-session-header${dayClass}"
      data-class-id="${classIdAttr}" data-session-id="${sessionIdAttr}"
      title="Click to open Session Manager">
      <span class="cm-session-header-date text-decoration-underline">${shortDate}</span>
      <label class="cm-col-toggle d-block mt-1 mb-0 text-secondary" title="${escapeHtml(toggleTitle)}" onclick="event.stopPropagation();">
        <input type="checkbox" class="form-check-input m-0 cm-col-enable" data-session-id="${sessionIdAttr}" ${shown ? 'checked' : ''} ${frozen ? 'disabled' : ''}>
        <span class="cm-col-toggle-label">${frozen ? 'Required' : 'Show'}</span>
      </label>
    </th>`;
  }

  function renderMatrix() {
    const thead = document.getElementById('cm_thead');
    const tbody = document.getElementById('cm_tbody');
    if (!thead || !tbody || !matrixData) return;

    const allSessions = matrixData.sessions || [];
    const columns = visibleSessions(allSessions);

    const rollupTitle = 'Average rating across shown sessions (rated cells only)';
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `<th class="cm-sticky-rollup text-center small px-2 py-2" title="${escapeHtml(rollupTitle)}">Avg</th><th class="cm-sticky-name">Student</th>`;
    const classId = String(matrixData.class?.id || readFilters().classId || '').trim();
    let prevSessionDate = '';
    columns.forEach((session, columnIndex) => {
      const dateKey = String(session.date || '').trim();
      const dayStart = columnIndex > 0 && dateKey !== prevSessionDate;
      prevSessionDate = dateKey;
      headerRow.innerHTML += buildConductSessionHeaderCell(classId, session, dayStart);
    });
    thead.innerHTML = '';
    thead.appendChild(headerRow);

    tbody.innerHTML = '';
    (matrixData.students || []).forEach((stu) => {
      const tr = document.createElement('tr');
      tr.className = 'cm-student-row';
      const avgs = computeStudentConductAverages(stu.personId, columns);
      const rollupInner = buildRollupInnerHtml(avgs);
      tr.innerHTML = `<td class="cm-sticky-rollup px-2 py-2 text-center">${rollupInner}</td><td class="cm-sticky-name">${buildStudentNameCell(stu)}</td>`;
      prevSessionDate = '';
      columns.forEach((session, columnIndex) => {
        const dateKey = String(session.date || '').trim();
        const dayStart = columnIndex > 0 && dateKey !== prevSessionDate;
        prevSessionDate = dateKey;
        const dayClass = dayStart ? ' cm-day-start' : '';
        const shown = isColumnShown(session);
        if (!shown) {
          tr.innerHTML += `<td class="cm-matrix-cell cm-col-disabled${dayClass}" aria-hidden="true"></td>`;
          return;
        }
        const cell = matrixData.cells?.[stu.personId]?.[session.sessionId] || { onRoster: false, value: null };
        let cellClass = 'cm-matrix-cell';
        if (!cell.onRoster) cellClass += ' cm-not-roster';
        else cellClass += ' cm-editable';
        if (cell.onRoster && !cell.value?.summary) cellClass += ' cm-empty';
        cellClass += dayClass;
        const inner = buildCellInnerHtml(cell, session);
        const title = cell.value?.summary
          ? 'Edit conduct'
          : (cell.onRoster ? 'Add conduct' : 'Not on session roster');
        tr.innerHTML += `<td class="${cellClass}" data-person-id="${escapeHtml(stu.personId)}" data-session-id="${escapeHtml(session.sessionId)}" data-on-roster="${cell.onRoster ? '1' : '0'}" title="${escapeHtml(title)}">${inner}</td>`;
      });
      tbody.appendChild(tr);
    });

    if (global.EnrollmentClaimToggle) global.EnrollmentClaimToggle.afterRender();

    thead.querySelectorAll('.cm-col-enable').forEach((input) => {
      input.addEventListener('change', async (event) => {
        const sessionId = String(event.target.getAttribute('data-session-id') || '').trim();
        const session = allSessions.find((s) => s.sessionId === sessionId);
        if (!session || session.conductRequiredForReports) return;
        const prevChecked = !event.target.checked;
        try {
          await setSessionVisibility(sessionId, event.target.checked);
          renderMatrix();
          const enabled = event.target.checked === true;
          await showCmMessage(
            enabled ? 'Show enabled' : 'Show disabled',
            enabled
              ? 'Class conduct is enabled for this session on Manage Session → Reports. Reload Manage Session if that tab was already open.'
              : 'Class conduct is hidden for this session on Manage Session → Reports.',
            'success'
          );
        } catch (error) {
          event.target.checked = prevChecked;
          await showCmMessage('Show setting', error.message || 'Could not update Show setting.', 'error');
        }
      });
    });
    syncConductFilterButtons();
  }

  function buildModalDimensionFields(cell) {
    const host = document.getElementById('cmModalDimensionFields');
    if (!host || !CONDUCT.buildConductRatingCellHtml) return;
    const percents = cell?.value?.percents || {};
    const pickerLevels = CONDUCT.getPickerLevels ? CONDUCT.getPickerLevels() : [];
    host.innerHTML = DIMENSIONS.map((dim) => {
      const pct = percents[dim.key];
      const cellHtml = CONDUCT.buildConductRatingCellHtml(dim.key, dim.label, pickerLevels, pct, false);
      return `<div class="col-md-6">
        <div class="card h-100 border shadow-sm cm-modal-dim-card">
          <div class="card-body p-3">
            <div class="fw-semibold mb-2 text-primary">${escapeHtml(dim.label)}</div>
            ${cellHtml}
          </div>
        </div>
      </div>`;
    }).join('');
    host.querySelectorAll('.conduct-rating-cell').forEach((ratingCell) => {
      CONDUCT.bindConductRatingCell(ratingCell, { readOnly: false });
    });
  }

  function openCellModal(personId, sessionId) {
    const session = (matrixData?.sessions || []).find((s) => s.sessionId === sessionId);
    const student = (matrixData?.students || []).find((s) => s.personId === personId);
    const cell = matrixData?.cells?.[personId]?.[sessionId];
    if (!session || !student || !cell?.onRoster || !isColumnShown(session)) return;

    modalContext = { personId, sessionId, session, student, cell };
    document.getElementById('cmModalStudent').textContent = student.name || personId;
    document.getElementById('cmModalSession').textContent = session.label || session.date || sessionId;
    buildModalDimensionFields(cell);
    renderConductLegendHosts();

    const readyWrap = document.getElementById('cmModalReadyWrap');
    const readyInput = document.getElementById('cmModalReady');
    if (readyWrap && readyInput) {
      const showReady = session.conductRequiredForReports === true || session.conductReportStepEnabled === true;
      readyWrap.classList.toggle('d-none', !showReady);
      readyInput.checked = session.conductReadyForReports === true;
    }

    const modalEl = document.getElementById('cmCellModal');
    if (modalEl && global.bootstrap) {
      global.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  function collectModalRosterRow() {
    const rosterRow = { personId: modalContext.personId };
    DIMENSIONS.forEach((dim) => {
      const ratingCell = document.querySelector(`#cmModalDimensionFields .conduct-rating-cell[data-dimension="${CSS.escape(dim.key)}"]`);
      rosterRow[dim.key] = CONDUCT.readConductPercentFromCell
        ? CONDUCT.readConductPercentFromCell(ratingCell, null)
        : null;
    });
    return rosterRow;
  }

  async function saveCellModal() {
    if (!modalContext || !matrixData?.class?.id) return;
    const { personId, sessionId, session } = modalContext;
    const rosterRow = collectModalRosterRow();
    const ready = (session.conductRequiredForReports === true || session.conductReportStepEnabled === true)
      ? document.getElementById('cmModalReady')?.checked === true
      : false;
    const enableReportStep = !session.conductRequiredForReports && !session.conductReportStepEnabled;

    const btn = document.getElementById('cmModalSave');
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }
    try {
      const actionStateId = resolveActionStateId();
      const res = await fetch(`/school/classes/${encodeURIComponent(matrixData.class.id)}/sessions/${encodeURIComponent(sessionId)}/conduct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AJAX-Request': 'true',
          ...(actionStateId ? { 'X-Action-State-Id': actionStateId } : {})
        },
        body: JSON.stringify({
          roster: [rosterRow],
          ready,
          enableReportStep: enableReportStep || undefined,
          ...(actionStateId ? { actionStateId } : {})
        })
      });
      syncActionStateFromResponse(res);
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') {
        throw new Error(readApiErrorMessage(res, result));
      }

      const modalEl = document.getElementById('cmCellModal');
      if (modalEl && global.bootstrap) global.bootstrap.Modal.getInstance(modalEl)?.hide();
      await loadMatrix();
    } catch (error) {
      await showCmMessage('Save failed', error.message || 'Save failed.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  }

  async function openClassPicker() {
    if (typeof global.GenericPicker?.open !== 'function' || !global.GenericPickerPresets?.class) {
      await showCmMessage('Unavailable', 'Class picker is not available.', 'error');
      return;
    }
    global.GenericPicker.open(global.GenericPickerPresets.class({
      title: 'Select class',
      onSelect(item) {
        const classId = String(item?.id || item?.classId || '').trim();
        const name = String(item?.title || item?.name || classId).trim();
        if (!classId) return;
        document.getElementById('cm_classId').value = classId;
        document.getElementById('cm_className').value = name;
      }
    }));
  }

  function wireEvents() {
    document.getElementById('cm_btnLoad')?.addEventListener('click', () => loadMatrix());
    document.getElementById('cm_btnClassPicker')?.addEventListener('click', () => { void openClassPicker(); });
    document.getElementById('cm_btnClearClass')?.addEventListener('click', () => {
      document.getElementById('cm_classId').value = '';
      document.getElementById('cm_className').value = '';
    });
    document.getElementById('cm_btnReset')?.addEventListener('click', () => {
      setFilters({ classId: '', className: '', startDate: '', endDate: '' });
      global.SchoolDateRangeShortcuts?.clearActiveMenuOption(CM_DATE_RANGE_MENU_ID);
      matrixData = null;
      document.getElementById('cm_results')?.classList.add('d-none');
      setConductPrintEnabled(false);
    });
    document.getElementById('cm_btnShowAllSessions')?.addEventListener('click', () => {
      conductOnlyFilter = false;
      renderMatrix();
    });
    document.getElementById('cm_btnShowConductSessions')?.addEventListener('click', () => {
      conductOnlyFilter = true;
      renderMatrix();
    });
    document.getElementById('cm_table')?.addEventListener('click', (event) => {
      const sessionHeader = event.target.closest('th.cm-session-header');
      if (sessionHeader && !event.target.closest('.cm-col-toggle')) {
        void confirmOpenManageSession(
          sessionHeader.getAttribute('data-class-id'),
          sessionHeader.getAttribute('data-session-id')
        );
        return;
      }
      const cell = event.target.closest('td.cm-editable');
      if (!cell) return;
      openCellModal(
        String(cell.getAttribute('data-person-id') || '').trim(),
        String(cell.getAttribute('data-session-id') || '').trim()
      );
    });
    document.getElementById('cmModalSave')?.addEventListener('click', () => saveCellModal());
    document.getElementById('btn_printConductMatrix')?.addEventListener('click', () => openConductPrint());
  }

  function buildCmSharedLinkConfirmHtml() {
    const filters = readFilters();
    const className = escapeHtml(filters.className || INITIAL.className || INITIAL.classId || '—');
    const start = escapeHtml(filters.startDate || INITIAL.startDate || '—');
    const end = escapeHtml(filters.endDate || INITIAL.endDate || '—');
    return (
      '<div class="text-start cm-shared-link-prompt">'
      + '<p class="mb-3">This page was opened from a <strong>shared link</strong>.</p>'
      + '<p class="small text-muted text-uppercase fw-semibold mb-2">Applied from the link</p>'
      + '<ul class="list-unstyled mb-3 border rounded bg-light px-3 py-2">'
      + '<li class="mb-2 d-flex align-items-start gap-2">'
      + '<i class="bi bi-book text-primary mt-1"></i>'
      + '<span><span class="text-muted d-block small">Class</span><strong>' + className + '</strong></span></li>'
      + '<li class="mb-0 d-flex align-items-start gap-2">'
      + '<i class="bi bi-calendar-range text-primary mt-1"></i>'
      + '<span><span class="text-muted d-block small">Date range</span>'
      + '<strong>' + start + '</strong> <span class="text-muted">to</span> <strong>' + end + '</strong></span></li>'
      + '</ul>'
      + '<p class="mb-0">Load the matrix now with these settings, or choose <strong>Not now</strong> to review the filters first.</p>'
      + '</div>'
    );
  }

  function buildCmSharedLinkDeclinedHtml() {
    return (
      '<div class="text-start cm-shared-link-prompt">'
      + '<p class="mb-2">No matrix was loaded.</p>'
      + '<p class="mb-2">The class and date range from the link are still shown in the filter panel.</p>'
      + '<p class="mb-0">When you are ready, click <strong>Load</strong> to run the matrix.</p>'
      + '</div>'
    );
  }

  function runWhenCmMessageModalReady(callback) {
    const run = () => {
      const ready = typeof global.showMessageModal === 'function' && document.getElementById('messageModal');
      if (!ready) {
        global.setTimeout(run, 50);
        return;
      }
      callback();
    };
    if (document.readyState === 'complete') run();
    else global.addEventListener('load', run, { once: true });
  }

  async function promptLoadConductMatrixFromUrlLink() {
    let confirmed = false;
    if (global.ReportMessaging?.confirmReportAction) {
      confirmed = await global.ReportMessaging.confirmReportAction({
        title: 'Open matrix from link?',
        icon: 'info',
        html: true,
        message: buildCmSharedLinkConfirmHtml(),
        confirmText: 'Load matrix',
        cancelText: 'Not now',
        confirmClass: 'btn-primary'
      });
    }
    if (!confirmed) {
      if (global.ReportMessaging?.showReportMessage) {
        await global.ReportMessaging.showReportMessage({
          title: 'Class Conduct Matrix',
          icon: 'info',
          html: true,
          message: buildCmSharedLinkDeclinedHtml()
        });
      } else {
        await showCmMessage(
          'Class Conduct Matrix',
          'The link settings are on the page. When you are ready, click Load to run the matrix.',
          'info'
        );
      }
      return;
    }
    await loadMatrix();
  }

  function initFromUrl() {
    setFilters({
      classId: INITIAL.classId || '',
      className: INITIAL.className || '',
      startDate: INITIAL.startDate || '',
      endDate: INITIAL.endDate || ''
    });
    const shortcuts = global.SchoolDateRangeShortcuts;
    if (INITIAL.range && !INITIAL.startDate && !INITIAL.endDate) {
      applyConductRangeSelection(INITIAL.range);
    } else if (INITIAL.range && shortcuts) {
      shortcuts.setActiveMenuOption(CM_DATE_RANGE_MENU_ID, shortcuts.normalizeRangeToken(INITIAL.range));
    } else if (!INITIAL.startDate && !INITIAL.endDate) {
      applyConductRangeSelection('m0-full');
    }
    if (INITIAL.classId) {
      runWhenCmMessageModalReady(() => {
        void promptLoadConductMatrixFromUrlLink();
      });
    }
  }

  function bindCollapseToggle(options = {}) {
    const collapseEl = document.getElementById(String(options.collapseId || ''));
    const buttonEl = document.getElementById(String(options.buttonId || ''));
    const iconEl = document.getElementById(String(options.iconId || ''));
    if (!collapseEl || !buttonEl || !iconEl) return;
    const setState = (open) => {
      iconEl.className = open ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
      buttonEl.setAttribute('aria-expanded', open ? 'true' : 'false');
      buttonEl.setAttribute('aria-label', open ? 'Close filters' : 'Open filters');
    };
    setState(collapseEl.classList.contains('show'));
    collapseEl.addEventListener('shown.bs.collapse', () => setState(true));
    collapseEl.addEventListener('hidden.bs.collapse', () => setState(false));
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindCollapseToggle({
      collapseId: 'cmFilterCollapse',
      buttonId: 'cmFilterToggleBtn',
      iconId: 'cmFilterToggleIcon'
    });
    renderConductLegendHosts();
    setConductPrintEnabled(false);
    wireEvents();
    bindConductMatrixDateRangeShortcuts();
    if (global.SchoolMatrixExpandedView) {
      global.SchoolMatrixExpandedView.bindMatrixExpandedView({
        buttonId: 'btn_cmExpandMatrixView',
        modalId: 'cmMatrixExpandModal',
        modalDialogId: 'cmMatrixExpandModalDialog',
        inlineHostId: 'cmMatrixExpandInlineHost',
        modalHostId: 'cmMatrixExpandModalHost',
        wrapperSelector: '.cm-matrix-wrapper'
      });
    }
    if (global.EnrollmentClaimToggle) {
      global.EnrollmentClaimToggle.init({
        page: 'conduct-matrix',
        getWindow() {
          const filters = readFilters();
          return {
            classId: filters.classId,
            startDate: filters.startDate,
            endDate: filters.endDate
          };
        }
      });
    }
    initFromUrl();
  });
}(window));
