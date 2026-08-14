(function initSchoolEntityPicker(global) {
  const TARGET_ALIASES = {
    student: 'students',
    students: 'students',
    teacher: 'teachers',
    teachers: 'teachers'
  };

  const LEVEL_LABELS = {
    departments: 'Departments',
    classes: 'Classes',
    students: 'Students',
    teachers: 'Teachers'
  };

  const state = {
    config: {},
    target: 'students',
    level: 'departments',
    selectedDepartment: null,
    selectedClass: null,
    selectedItems: new Map(),
    currentPage: 1,
    totalPages: 1,
    currentRows: [],
    busy: false,
    searchTimer: null,
    modal: null
  };

  function getEl(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeTarget(value) {
    return TARGET_ALIASES[String(value || 'students').trim().toLowerCase()] || 'students';
  }

  function normalizeContextRows(value) {
    return (Array.isArray(value) ? value : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const normalized = {
          departmentId: String(row.departmentId || '').trim(),
          departmentName: String(row.departmentName || '').trim()
        };
        const classId = String(row.classId || '').trim();
        const classTitle = String(row.classTitle || '').trim();
        if (classId) normalized.classId = classId;
        if (classTitle) normalized.classTitle = classTitle;
        return normalized;
      })
      .filter((row) => row.departmentId || row.classId);
  }

  function normalizeSelectedItem(item) {
    if (!item || typeof item !== 'object') return null;
    const id = String(item.id || item.studentId || item.teacherId || '').trim();
    if (!id) return null;
    const type = String(item.type || item.targetType || '').trim() || (state.target === 'teachers' ? 'teacher' : 'student');
    return {
      ...item,
      id,
      type,
      label: String(item.label || item.name || item.displayName || id).trim(),
      subtitle: String(item.subtitle || item.email || '').trim(),
      selectedFrom: normalizeContextRows(item.selectedFrom || item.meta?.selectedFrom)
    };
  }

  function selectionKey(itemOrId) {
    if (typeof itemOrId === 'string') return itemOrId;
    return String(itemOrId?.id || itemOrId?.studentId || itemOrId?.teacherId || '').trim();
  }

  function mergeContexts(existingRows, incomingRows) {
    const out = [];
    const seen = new Set();
    normalizeContextRows(existingRows).concat(normalizeContextRows(incomingRows)).forEach((row) => {
      const key = [row.departmentId || '', row.classId || ''].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(row);
    });
    return out;
  }

  function itemFromResult(result) {
    const id = String(result?.id || '').trim();
    if (!id) return null;
    const meta = result.meta || {};
    return normalizeSelectedItem({
      id,
      type: result.type,
      label: result.label,
      subtitle: result.subtitle,
      studentId: meta.studentId,
      teacherId: meta.teacherId,
      personId: meta.personId,
      customStudentId: meta.customStudentId,
      email: meta.email,
      status: meta.status,
      selectedFrom: meta.selectedFrom
    });
  }

  function upsertSelection(result) {
    const item = itemFromResult(result);
    if (!item) return null;
    const key = selectionKey(item);
    const existing = state.selectedItems.get(key);
    if (existing) {
      state.selectedItems.set(key, {
        ...existing,
        ...item,
        selectedFrom: mergeContexts(existing.selectedFrom, item.selectedFrom)
      });
    } else {
      state.selectedItems.set(key, item);
    }
    updateSelectionSummary();
    return state.selectedItems.get(key);
  }

  function removeSelection(resultOrId, contextFilter) {
    const key = selectionKey(resultOrId);
    if (!key || !state.selectedItems.has(key)) return;
    if (!contextFilter || typeof contextFilter !== 'function') {
      state.selectedItems.delete(key);
      updateSelectionSummary();
      return;
    }
    const existing = state.selectedItems.get(key);
    const remainingContexts = normalizeContextRows(existing.selectedFrom).filter((row) => !contextFilter(row));
    if (remainingContexts.length) {
      state.selectedItems.set(key, { ...existing, selectedFrom: remainingContexts });
    } else {
      state.selectedItems.delete(key);
    }
    updateSelectionSummary();
  }

  function resultSelectedInCurrentContext(result) {
    const item = itemFromResult(result);
    const existing = item ? state.selectedItems.get(selectionKey(item)) : null;
    if (!existing) return false;
    const incoming = normalizeContextRows(item.selectedFrom);
    if (!incoming.length) return true;
    return incoming.some((incomingContext) => (
      normalizeContextRows(existing.selectedFrom).some((existingContext) => (
        existingContext.departmentId === incomingContext.departmentId
        && (existingContext.classId || '') === (incomingContext.classId || '')
      ))
    ));
  }

  function selectedCountForClass(classId) {
    const normalizedClassId = String(classId || '').trim();
    if (!normalizedClassId) return 0;
    let count = 0;
    state.selectedItems.forEach((item) => {
      if (normalizeContextRows(item.selectedFrom).some((row) => (row.classId || '') === normalizedClassId)) count += 1;
    });
    return count;
  }

  function setBusy(isBusy) {
    state.busy = isBusy === true;
    const loadMoreBtn = getEl('sep-load-more-btn');
    const selectAllBtn = getEl('sep-select-all-btn');
    if (loadMoreBtn) loadMoreBtn.disabled = state.busy;
    if (selectAllBtn) selectAllBtn.disabled = state.busy;
  }

  function setSummary(text, iconClass) {
    const summary = getEl('sep-summary');
    if (!summary) return;
    summary.innerHTML = `<i class="bi ${iconClass || 'bi-info-circle'} me-1"></i>${escapeHtml(text)}`;
  }

  function updateSelectionSummary() {
    const selectedCount = state.selectedItems.size;
    const selectedCountEl = getEl('sep-selected-count');
    const confirmBtn = getEl('sep-confirm-btn');
    if (selectedCountEl) selectedCountEl.textContent = `(${selectedCount})`;
    if (confirmBtn) {
      confirmBtn.classList.toggle('d-none', state.config.multiselect !== true);
      confirmBtn.disabled = selectedCount === 0;
    }
  }

  function updateControls() {
    const backBtn = getEl('sep-back-btn');
    const selectAllBtn = getEl('sep-select-all-btn');
    const clearClassBtn = getEl('sep-clear-class-btn');
    const loadMoreBtn = getEl('sep-load-more-btn');
    if (backBtn) backBtn.classList.toggle('d-none', !(state.target === 'students' && state.level === 'students'));
    if (selectAllBtn) selectAllBtn.classList.toggle('d-none', !(state.target === 'students' && state.level === 'students' && state.config.multiselect === true));
    if (clearClassBtn) clearClassBtn.classList.toggle('d-none', !(state.target === 'students' && state.level === 'students' && state.config.multiselect === true));
    if (loadMoreBtn) loadMoreBtn.classList.toggle('d-none', Number(state.currentPage || 1) >= Number(state.totalPages || 1));
    updateSelectionSummary();
  }

  function updateHeader(payload) {
    const title = getEl('sep-title');
    const breadcrumb = getEl('sep-breadcrumb');
    const icon = state.target === 'teachers' ? 'bi-person-workspace' : 'bi-person-vcard';
    const fallbackTitle = state.target === 'teachers' ? 'Select Teachers' : 'Select Students';
    if (title) title.innerHTML = `<i class="bi ${icon} me-2 text-primary"></i>${escapeHtml(state.config.title || fallbackTitle)}`;
    if (!breadcrumb) return;
    const crumbs = Array.isArray(payload?.breadcrumb) ? payload.breadcrumb : [];
    const tail = LEVEL_LABELS[state.level] || 'Options';
    const text = crumbs.length
      ? `${crumbs.map((row) => row.label).join(' / ')} / ${tail}`
      : tail;
    breadcrumb.textContent = text;
  }

  function emptyState(message) {
    return `
      <div class="text-center text-muted py-5">
        <i class="bi bi-inboxes fs-1 opacity-25 d-block mb-2"></i>
        <div class="fw-semibold">${escapeHtml(message || 'No options found.')}</div>
      </div>
    `;
  }

  function loadingState() {
    return `
      <div class="text-center text-primary py-5">
        <div class="spinner-border mb-3" role="status"></div>
        <div class="fw-semibold">Loading...</div>
      </div>
    `;
  }

  function renderDepartmentCard(row) {
    return `
      <button type="button" class="sep-card p-3" data-sep-id="${escapeHtml(row.id)}" data-sep-action="department">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div class="sep-card-title fw-bold text-dark">${escapeHtml(row.label)}</div>
          <i class="bi bi-chevron-right text-muted"></i>
        </div>
        <div class="small text-muted">${escapeHtml(row.subtitle || 'Department')}</div>
      </button>
    `;
  }

  function renderClassCard(row) {
    const pickedCount = selectedCountForClass(row.id);
    const studentCount = Number(row.counts?.students || 0);
    return `
      <button type="button" class="sep-card p-3" data-sep-id="${escapeHtml(row.id)}" data-sep-action="class">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div class="sep-card-title fw-bold text-dark">${escapeHtml(row.label)}</div>
          <i class="bi bi-chevron-right text-muted"></i>
        </div>
        <div class="small text-muted mb-3">${escapeHtml(row.subtitle || 'Class')}</div>
        <div class="d-flex flex-wrap gap-2">
          <span class="badge bg-light text-secondary border">${studentCount} student${studentCount === 1 ? '' : 's'}</span>
          <span class="badge ${pickedCount ? 'bg-primary' : 'bg-light text-secondary border'} sep-picked-badge">${pickedCount} picked</span>
        </div>
      </button>
    `;
  }

  function renderPersonRow(row) {
    const isMulti = state.config.multiselect === true;
    const checked = resultSelectedInCurrentContext(row);
    const checkbox = isMulti
      ? `<input type="checkbox" class="form-check-input sep-row-check flex-shrink-0" data-sep-id="${escapeHtml(row.id)}" ${checked ? 'checked' : ''}>`
      : '<i class="bi bi-chevron-right text-muted flex-shrink-0"></i>';
    const icon = row.type === 'teacher' ? 'bi-person-workspace' : 'bi-person-vcard';
    return `
      <button type="button" class="sep-row d-flex align-items-center gap-3 p-3 mb-2" data-sep-id="${escapeHtml(row.id)}" data-sep-action="terminal">
        ${checkbox}
        <span class="rounded bg-light border d-inline-flex align-items-center justify-content-center text-primary flex-shrink-0" style="width: 42px; height: 42px;">
          <i class="bi ${icon}"></i>
        </span>
        <span class="min-w-0 flex-grow-1">
          <span class="sep-row-title fw-bold text-dark d-block">${escapeHtml(row.label)}</span>
          <span class="small text-muted d-block text-truncate">${escapeHtml(row.subtitle || '')}</span>
        </span>
      </button>
    `;
  }

  function renderRows(rows, append) {
    const resultsEl = getEl('sep-results');
    if (!resultsEl) return;
    const source = Array.isArray(rows) ? rows : [];
    if (!append) {
      if (!source.length) {
        resultsEl.innerHTML = emptyState();
        return;
      }
      if (state.level === 'departments') {
        resultsEl.innerHTML = `<div class="sep-grid">${source.map(renderDepartmentCard).join('')}</div>`;
      } else if (state.level === 'classes') {
        resultsEl.innerHTML = `<div class="sep-grid">${source.map(renderClassCard).join('')}</div>`;
      } else {
        resultsEl.innerHTML = `<div>${source.map(renderPersonRow).join('')}</div>`;
      }
      bindResultActions();
      return;
    }

    if (!source.length) return;
    if (state.level === 'departments' || state.level === 'classes') {
      const grid = resultsEl.querySelector('.sep-grid');
      if (grid) grid.insertAdjacentHTML('beforeend', source.map(state.level === 'classes' ? renderClassCard : renderDepartmentCard).join(''));
    } else {
      resultsEl.insertAdjacentHTML('beforeend', source.map(renderPersonRow).join(''));
    }
    bindResultActions();
  }

  function findCurrentRow(id) {
    const normalized = String(id || '').trim();
    return state.currentRows.find((row) => String(row.id || '').trim() === normalized) || null;
  }

  function bindResultActions() {
    const resultsEl = getEl('sep-results');
    if (!resultsEl) return;
    resultsEl.querySelectorAll('[data-sep-action]').forEach((button) => {
      if (button.dataset.sepBound === '1') return;
      button.dataset.sepBound = '1';
      button.addEventListener('click', (event) => {
        const row = findCurrentRow(button.dataset.sepId);
        if (!row) return;
        const action = button.dataset.sepAction;
        if (action === 'department') return openDepartment(row);
        if (action === 'class') return openClass(row);
        if (action === 'terminal') return toggleTerminal(row, event);
      });
    });
  }

  function openDepartment(row) {
    state.selectedDepartment = {
      id: row.id,
      label: row.label
    };
    state.selectedClass = null;
    state.level = state.target === 'teachers' ? 'teachers' : 'classes';
    clearSearch();
    loadOptions({ page: 1 });
  }

  function openClass(row) {
    state.selectedClass = {
      id: row.id,
      label: row.label
    };
    state.level = 'students';
    clearSearch();
    loadOptions({ page: 1 });
  }

  function toggleTerminal(row, event) {
    const isMulti = state.config.multiselect === true;
    if (!isMulti) {
      const item = upsertSelection(row);
      if (typeof state.config.onSelect === 'function') state.config.onSelect(item);
      closeModal();
      return;
    }

    const wasChecked = resultSelectedInCurrentContext(row);
    const clickedCheckbox = event?.target?.classList?.contains('sep-row-check') === true;
    const checkbox = clickedCheckbox
      ? event.target
      : event?.currentTarget?.querySelector?.('.sep-row-check');
    const shouldSelect = clickedCheckbox ? checkbox.checked : !wasChecked;
    if (checkbox && !clickedCheckbox) checkbox.checked = shouldSelect;
    if (shouldSelect) {
      upsertSelection(row);
    } else {
      const item = itemFromResult(row);
      const incomingContexts = normalizeContextRows(item?.selectedFrom);
      removeSelection(item, (context) => incomingContexts.some((incoming) => (
        incoming.departmentId === context.departmentId && incoming.classId === context.classId
      )));
    }
    renderRows(state.currentRows, false);
  }

  function clearSearch() {
    const input = getEl('sep-search-input');
    if (input) input.value = '';
  }

  function buildUrl(page, options) {
    const input = getEl('sep-search-input');
    const params = new URLSearchParams();
    params.set('target', state.target);
    params.set('level', state.level);
    params.set('page', String(page || 1));
    params.set('limit', String(options?.limit || state.config.limit || 50));
    const q = options?.q !== undefined ? options.q : input?.value || '';
    if (String(q || '').trim()) params.set('q', String(q || '').trim());
    if (state.selectedDepartment?.id) params.set('departmentId', state.selectedDepartment.id);
    if (state.selectedClass?.id) params.set('classId', state.selectedClass.id);
    if (state.config.referenceDate) params.set('referenceDate', String(state.config.referenceDate));
    return `/school/entity-picker/api/options?${params.toString()}`;
  }

  async function loadOptions(options) {
    const append = options?.append === true;
    const page = Number(options?.page || 1) || 1;
    const resultsEl = getEl('sep-results');
    if (state.busy) return;
    setBusy(true);
    if (!append && resultsEl) resultsEl.innerHTML = loadingState();
    try {
      const response = await fetch(buildUrl(page, options), {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-AJAX-Request': 'true'
        }
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.status !== 'success') {
        throw new Error(payload?.message || `Picker request failed (${response.status}).`);
      }
      const rows = Array.isArray(payload.results) ? payload.results : [];
      state.currentRows = append ? state.currentRows.concat(rows) : rows;
      state.currentPage = Number(payload.pagination?.currentPage || page);
      state.totalPages = Number(payload.pagination?.totalPages || 1);
      updateHeader(payload);
      renderRows(rows, append);
      const totalItems = Number(payload.pagination?.totalItems || rows.length || 0);
      const loaded = state.currentRows.length;
      setSummary(totalItems ? `Showing ${loaded} of ${totalItems}. Selected ${state.selectedItems.size}.` : `Selected ${state.selectedItems.size}.`, 'bi-info-circle');
    } catch (error) {
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="text-center text-danger py-5">
            <i class="bi bi-exclamation-triangle fs-1 opacity-50 d-block mb-2"></i>
            <div class="fw-bold mb-1">Unable to load picker options.</div>
            <div class="small">${escapeHtml(error.message || 'Unknown error')}</div>
          </div>
        `;
      }
      setSummary('Unable to load picker options.', 'bi-exclamation-triangle');
    } finally {
      setBusy(false);
      updateControls();
    }
  }

  async function selectAllInClass() {
    if (state.target !== 'students' || state.level !== 'students') return;
    const priorLimit = state.config.limit;
    try {
      const response = await fetch(buildUrl(1, { limit: 1000, q: '' }), {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-AJAX-Request': 'true'
        }
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.status !== 'success') {
        throw new Error(payload?.message || `Picker request failed (${response.status}).`);
      }
      (Array.isArray(payload.results) ? payload.results : []).forEach((row) => upsertSelection(row));
      state.currentRows = Array.isArray(payload.results) ? payload.results : state.currentRows;
      renderRows(state.currentRows, false);
      setSummary(`Selected ${state.selectedItems.size}.`, 'bi-check2-square');
    } catch (error) {
      setSummary(error.message || 'Unable to select all.', 'bi-exclamation-triangle');
    } finally {
      state.config.limit = priorLimit;
      updateControls();
    }
  }

  function clearSelectedClass() {
    const classId = String(state.selectedClass?.id || '').trim();
    if (!classId) return;
    Array.from(state.selectedItems.keys()).forEach((key) => {
      removeSelection(key, (context) => context.classId === classId);
    });
    renderRows(state.currentRows, false);
    setSummary(`Selected ${state.selectedItems.size}.`, 'bi-eraser');
  }

  function goBack() {
    if (state.target !== 'students' || state.level !== 'students') return;
    state.level = 'classes';
    state.selectedClass = null;
    clearSearch();
    loadOptions({ page: 1 });
  }

  function confirmSelection() {
    if (typeof state.config.onSelect === 'function') {
      state.config.onSelect(Array.from(state.selectedItems.values()));
    }
    closeModal();
  }

  function closeModal() {
    if (state.modal) state.modal.hide();
  }

  function bindChrome() {
    const modalEl = getEl('schoolEntityPickerModal');
    const input = getEl('sep-search-input');
    const backBtn = getEl('sep-back-btn');
    const loadMoreBtn = getEl('sep-load-more-btn');
    const confirmBtn = getEl('sep-confirm-btn');
    const selectAllBtn = getEl('sep-select-all-btn');
    const clearClassBtn = getEl('sep-clear-class-btn');

    if (input && input.dataset.sepBound !== '1') {
      input.dataset.sepBound = '1';
      input.addEventListener('input', () => {
        if (state.searchTimer) clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => loadOptions({ page: 1 }), 250);
      });
    }
    if (backBtn && backBtn.dataset.sepBound !== '1') {
      backBtn.dataset.sepBound = '1';
      backBtn.addEventListener('click', goBack);
    }
    if (loadMoreBtn && loadMoreBtn.dataset.sepBound !== '1') {
      loadMoreBtn.dataset.sepBound = '1';
      loadMoreBtn.addEventListener('click', () => loadOptions({ page: Number(state.currentPage || 1) + 1, append: true }));
    }
    if (confirmBtn && confirmBtn.dataset.sepBound !== '1') {
      confirmBtn.dataset.sepBound = '1';
      confirmBtn.addEventListener('click', confirmSelection);
    }
    if (selectAllBtn && selectAllBtn.dataset.sepBound !== '1') {
      selectAllBtn.dataset.sepBound = '1';
      selectAllBtn.addEventListener('click', selectAllInClass);
    }
    if (clearClassBtn && clearClassBtn.dataset.sepBound !== '1') {
      clearClassBtn.dataset.sepBound = '1';
      clearClassBtn.addEventListener('click', clearSelectedClass);
    }
    if (modalEl && modalEl.dataset.sepBound !== '1') {
      modalEl.dataset.sepBound = '1';
      modalEl.addEventListener('hidden.bs.modal', () => {
        if (state.searchTimer) clearTimeout(state.searchTimer);
        state.searchTimer = null;
      });
      modalEl.addEventListener('shown.bs.modal', () => {
        if (input) input.focus();
      });
    }
  }

  function reset(config) {
    state.config = config || {};
    state.target = normalizeTarget(config?.target);
    state.level = 'departments';
    state.selectedDepartment = null;
    state.selectedClass = null;
    state.currentPage = 1;
    state.totalPages = 1;
    state.currentRows = [];
    state.selectedItems.clear();
    const selectedItems = Array.isArray(config?.selectedItems)
      ? config.selectedItems
      : (config?.selectedItems ? [config.selectedItems] : []);
    selectedItems.forEach((item) => {
      const normalized = normalizeSelectedItem(item);
      if (normalized) state.selectedItems.set(selectionKey(normalized), normalized);
    });
    clearSearch();
    updateControls();
  }

  function open(config) {
    const modalEl = getEl('schoolEntityPickerModal');
    if (!modalEl) {
      console.error('SchoolEntityPicker modal partial is not loaded.');
      return;
    }
    bindChrome();
    reset(config || {});
    if (!state.modal) state.modal = new bootstrap.Modal(modalEl);
    state.modal.show();
    loadOptions({ page: 1 });
  }

  global.SchoolEntityPicker = {
    open
  };
})(typeof window !== 'undefined' ? window : globalThis);
