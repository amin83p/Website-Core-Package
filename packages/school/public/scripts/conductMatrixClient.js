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

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDateLocal(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
    } else if (range === 'allTime') {
      document.getElementById('cm_startDate').value = '';
      document.getElementById('cm_endDate').value = '';
      document.querySelectorAll('.cm-range').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-range') === range);
      });
      return;
    }
    document.getElementById('cm_startDate').value = formatDateLocal(start);
    document.getElementById('cm_endDate').value = formatDateLocal(end);
    document.querySelectorAll('.cm-range').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-range') === range);
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

  function buildStudentNameCell(stu) {
    const name = escapeHtml(stu.name || stu.personId);
    const recordId = String(stu.studentRecordId || '').trim();
    if (recordId) {
      const href = `/school/students/edit/${encodeURIComponent(recordId)}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-decoration-none">${name}</a>`;
    }
    return name;
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
    } catch (error) {
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

  function buildConductSessionHeaderCell(classId, session) {
    const frozen = session.conductRequiredForReports === true;
    const shown = isColumnShown(session);
    const shortDate = escapeHtml(formatSessionShortDate(session.date));
    const sessionIdAttr = escapeHtml(session.sessionId);
    const classIdAttr = escapeHtml(String(classId || '').trim());
    const toggleTitle = frozen
      ? 'Required for assigned reports'
      : 'Show class conduct on Manage Session Reports tab';
    return `<th class="att-cell text-primary small fw-bold cm-session-col cm-session-header"
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
    columns.forEach((session) => {
      headerRow.innerHTML += buildConductSessionHeaderCell(classId, session);
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
      columns.forEach((session) => {
        const shown = isColumnShown(session);
        if (!shown) {
          tr.innerHTML += `<td class="cm-matrix-cell cm-col-disabled" aria-hidden="true"></td>`;
          return;
        }
        const cell = matrixData.cells?.[stu.personId]?.[session.sessionId] || { onRoster: false, value: null };
        let cellClass = 'cm-matrix-cell';
        if (!cell.onRoster) cellClass += ' cm-not-roster';
        else cellClass += ' cm-editable';
        if (cell.onRoster && !cell.value?.summary) cellClass += ' cm-empty';
        const inner = buildCellInnerHtml(cell, session);
        const title = cell.value?.summary
          ? 'Edit conduct'
          : (cell.onRoster ? 'Add conduct' : 'Not on session roster');
        tr.innerHTML += `<td class="${cellClass}" data-person-id="${escapeHtml(stu.personId)}" data-session-id="${escapeHtml(session.sessionId)}" data-on-roster="${cell.onRoster ? '1' : '0'}" title="${escapeHtml(title)}">${inner}</td>`;
      });
      tbody.appendChild(tr);
    });

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
      document.querySelectorAll('.cm-range').forEach((b) => b.classList.remove('active'));
    });
    document.querySelectorAll('.cm-range').forEach((btn) => {
      btn.addEventListener('click', () => applyQuickRange(btn.getAttribute('data-range')));
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
  }

  function initFromUrl() {
    setFilters({
      classId: INITIAL.classId || '',
      className: INITIAL.className || '',
      startDate: INITIAL.startDate || '',
      endDate: INITIAL.endDate || ''
    });
    if (INITIAL.range) applyQuickRange(INITIAL.range);
    else if (!INITIAL.startDate && !INITIAL.endDate) applyQuickRange('thisMonth');
    if (INITIAL.classId) loadMatrix();
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderConductLegendHosts();
    wireEvents();
    initFromUrl();
  });
}(window));
