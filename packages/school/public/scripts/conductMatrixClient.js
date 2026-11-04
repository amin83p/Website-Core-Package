(function initConductMatrix(global) {
  'use strict';

  const INITIAL = global.__conductMatrixInitial || {};
  const CONDUCT_POLICY = global.__conductRatingScalePolicy || { levels: [] };
  const NA_LEVEL = { code: 'NA', displayCode: 'N/A', label: 'Not Available', defaultPercent: null };

  const DIMENSIONS = [
    { key: 'classEffortPercent', label: 'Class effort' },
    { key: 'classParticipationPercent', label: 'Participation' },
    { key: 'respectsTeachersPercent', label: 'Respects teachers' },
    { key: 'respectsStudentsPercent', label: 'Respects students' }
  ];

  let matrixData = null;
  let disabledColumns = new Set();
  let modalContext = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getScaleLevels() {
    const levels = Array.isArray(CONDUCT_POLICY.levels) ? CONDUCT_POLICY.levels : [];
    return levels.length ? levels : [];
  }

  function getPickerLevels() {
    return [...getScaleLevels(), NA_LEVEL];
  }

  function percentToLevelCode(percent) {
    if (percent === null || percent === undefined || percent === '') return 'NA';
    const value = Number(percent);
    if (!Number.isFinite(value)) return 'NA';
    const match = getScaleLevels().find((row) => value >= row.minPercent && value <= row.maxPercent);
    return match ? match.code : (getScaleLevels()[0]?.code || 'NA');
  }

  function levelDefaultPercent(code) {
    if (code === 'NA' || code === 'N/A') return null;
    const match = getScaleLevels().find((row) => row.code === code);
    return match ? match.defaultPercent : 100;
  }

  function storageKey(classId) {
    return `conductMatrix.disabledColumns.${String(classId || '').trim()}`;
  }

  function loadDisabledColumns(classId) {
    disabledColumns = new Set();
    if (!classId) return;
    try {
      const raw = global.localStorage.getItem(storageKey(classId));
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) parsed.forEach((id) => disabledColumns.add(String(id)));
    } catch (_) {
      disabledColumns = new Set();
    }
  }

  function saveDisabledColumns(classId) {
    if (!classId) return;
    try {
      global.localStorage.setItem(storageKey(classId), JSON.stringify(Array.from(disabledColumns)));
    } catch (_) {
      /* ignore */
    }
  }

  function isColumnEnabled(session) {
    if (session?.conductRequiredForReports) return true;
    return !disabledColumns.has(String(session.sessionId || ''));
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

  async function loadMatrix() {
    const filters = readFilters();
    if (!filters.classId) {
      alert('Select a class first.');
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
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Failed to load matrix.');
      matrixData = result;
      loadDisabledColumns(filters.classId);
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
      alert(error.message || 'Load failed.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  }

  function renderMatrix() {
    const thead = document.getElementById('cm_thead');
    const tbody = document.getElementById('cm_tbody');
    if (!thead || !tbody || !matrixData) return;

    const allSessions = matrixData.sessions || [];
    const visibleSessions = allSessions.filter((s) => isColumnEnabled(s));

    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th class="cm-sticky-name">Student</th>';
    allSessions.forEach((session) => {
      const enabled = isColumnEnabled(session);
      const frozen = session.conductRequiredForReports === true;
      const title = frozen ? 'Required for assigned reports' : (enabled ? 'Include column' : 'Column hidden');
      headerRow.innerHTML += `<th class="text-center" data-session-id="${escapeHtml(session.sessionId)}">
        <div class="small fw-bold">${escapeHtml(session.date || '')}</div>
        <div class="text-muted x-small">${escapeHtml(session.startTime || '')}</div>
        <label class="cm-col-toggle d-inline-flex align-items-center gap-1 mt-1" title="${escapeHtml(title)}">
          <input type="checkbox" class="form-check-input m-0 cm-col-enable" data-session-id="${escapeHtml(session.sessionId)}" ${enabled ? 'checked' : ''} ${frozen ? 'disabled' : ''}>
          <span>${frozen ? 'Required' : 'Show'}</span>
        </label>
      </th>`;
    });
    thead.innerHTML = '';
    thead.appendChild(headerRow);

    tbody.innerHTML = '';
    (matrixData.students || []).forEach((stu) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="cm-sticky-name">${escapeHtml(stu.name || stu.personId)}</td>`;
      allSessions.forEach((session) => {
        const enabled = isColumnEnabled(session);
        if (!enabled) {
          tr.innerHTML += `<td class="cm-matrix-cell cm-col-disabled" aria-hidden="true"></td>`;
          return;
        }
        const cell = matrixData.cells?.[stu.personId]?.[session.sessionId] || { onRoster: false, value: null };
        let inner = '—';
        let cellClass = 'cm-matrix-cell cm-empty';
        if (!cell.onRoster) {
          cellClass = 'cm-matrix-cell cm-not-roster';
          inner = '·';
        } else if (cell.value?.summary) {
          cellClass = 'cm-matrix-cell cm-editable';
          inner = escapeHtml(cell.value.summary);
        } else if (enabled) {
          cellClass = 'cm-matrix-cell cm-editable cm-empty';
        }
        tr.innerHTML += `<td class="${cellClass}" data-person-id="${escapeHtml(stu.personId)}" data-session-id="${escapeHtml(session.sessionId)}" data-on-roster="${cell.onRoster ? '1' : '0'}" title="${cell.value?.summary ? 'Edit conduct' : (cell.onRoster ? 'Add conduct' : 'Not on session roster')}">${inner}</td>`;
      });
      tbody.appendChild(tr);
    });

    thead.querySelectorAll('.cm-col-enable').forEach((input) => {
      input.addEventListener('change', (event) => {
        const sessionId = String(event.target.getAttribute('data-session-id') || '').trim();
        const session = allSessions.find((s) => s.sessionId === sessionId);
        if (!session || session.conductRequiredForReports) return;
        if (event.target.checked) disabledColumns.delete(sessionId);
        else disabledColumns.add(sessionId);
        saveDisabledColumns(matrixData.class?.id);
        renderMatrix();
      });
    });
  }

  function openCellModal(personId, sessionId) {
    const session = (matrixData?.sessions || []).find((s) => s.sessionId === sessionId);
    const student = (matrixData?.students || []).find((s) => s.personId === personId);
    const cell = matrixData?.cells?.[personId]?.[sessionId];
    if (!session || !student || !cell?.onRoster || !isColumnEnabled(session)) return;

    modalContext = { personId, sessionId, session, student };
    document.getElementById('cmModalStudent').textContent = student.name || personId;
    document.getElementById('cmModalSession').textContent = session.label || session.date || sessionId;

    const readyWrap = document.getElementById('cmModalReadyWrap');
    const readyInput = document.getElementById('cmModalReady');
    if (readyWrap && readyInput) {
      const showReady = session.conductRequiredForReports === true;
      readyWrap.classList.toggle('d-none', !showReady);
      readyInput.checked = session.conductReadyForReports === true;
    }

    const host = document.getElementById('cmModalDimensionFields');
    const percents = cell.value?.percents || {};
    const levels = getPickerLevels();
    host.innerHTML = DIMENSIONS.map((dim) => {
      const code = cell.value?.levels?.[dim.key] || percentToLevelCode(percents[dim.key]);
      const options = levels.map((level) => {
        const selected = level.code === code ? ' selected' : '';
        return `<option value="${escapeHtml(level.code)}"${selected}>${escapeHtml(level.displayCode || level.code)} — ${escapeHtml(level.label || '')}</option>`;
      }).join('');
      return `<div class="mb-3">
        <label class="form-label fw-semibold" for="cm_dim_${dim.key}">${escapeHtml(dim.label)}</label>
        <select class="form-select" id="cm_dim_${dim.key}" data-dim-key="${escapeHtml(dim.key)}">${options}</select>
      </div>`;
    }).join('');

    const modalEl = document.getElementById('cmCellModal');
    if (modalEl && global.bootstrap) {
      global.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  async function saveCellModal() {
    if (!modalContext || !matrixData?.class?.id) return;
    const { personId, sessionId, session } = modalContext;
    const rosterRow = { personId };
    DIMENSIONS.forEach((dim) => {
      const select = document.getElementById(`cm_dim_${dim.key}`);
      const code = String(select?.value || 'NA').trim();
      rosterRow[dim.key] = levelDefaultPercent(code);
    });
    const ready = session.conductRequiredForReports === true
      ? document.getElementById('cmModalReady')?.checked === true
      : false;

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
        body: JSON.stringify({ roster: [rosterRow], ready })
      });
      syncActionStateFromResponse(res);
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Save failed.');

      const modalEl = document.getElementById('cmCellModal');
      if (modalEl && global.bootstrap) global.bootstrap.Modal.getInstance(modalEl)?.hide();
      await loadMatrix();
    } catch (error) {
      alert(error.message || 'Save failed.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    }
  }

  function openClassPicker() {
    if (typeof global.GenericPicker?.open !== 'function' || !global.GenericPickerPresets?.class) {
      alert('Class picker is not available.');
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
    document.getElementById('cm_btnClassPicker')?.addEventListener('click', openClassPicker);
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
    document.getElementById('cm_table')?.addEventListener('click', (event) => {
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
    wireEvents();
    initFromUrl();
  });
}(window));
