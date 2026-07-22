document.addEventListener('DOMContentLoaded', () => {
  const table = document.getElementById('first-table');
  if (!table) return;

  const userIdEl = document.getElementById('user-id');
  const tableNameEl = document.getElementById('tableName');
  const userId = userIdEl ? userIdEl.getAttribute('data-id') : '';
  const tableKey = tableNameEl ? tableNameEl.getAttribute('data-id') : '';
  const tableWrapper = table.closest('.table-scroll-wrapper');
  if (tableWrapper && userId && tableKey) setTableLoadingState(tableWrapper, true);

  const headers = table.querySelectorAll('th.draggable');
  const searchInput = document.getElementById('searchInput');
  const searchField = document.getElementById('searchField');

  // Sorting
  headers.forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.column;
      const sortOrder = header.classList.contains('sort-asc') ? 'desc' : 'asc';

      headers.forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        const sortIcon = h.querySelector('.sort-icon');
        if (sortIcon) sortIcon.innerHTML = '';
      });

      header.classList.add(`sort-${sortOrder}`);
      const activeSortIcon = header.querySelector('.sort-icon');
      if (activeSortIcon) activeSortIcon.innerHTML = sortOrder === 'asc' ? '▲' : '▼';

      sortTable(column, sortOrder);
    });

    // make draggable
    header.draggable = true;
    header.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', header.dataset.column);
      header.style.opacity = '0.5';
    });
    header.addEventListener('dragend', () => {
      header.style.opacity = '1';
    });
    header.addEventListener('dragover', e => e.preventDefault());
    header.addEventListener('drop', e => {
      e.preventDefault();
      const source = e.dataTransfer.getData('text/plain');
      const target = header.dataset.column;
      reorderColumns(source, target);
    });
  });

  function sortTable(column, order) {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const idx = getColumnIndex(column);
    if (idx < 0) return;

    rows.sort((a, b) => {
      const aVal = resolveComparableSortValue(a.children[idx]);
      const bVal = resolveComparableSortValue(b.children[idx]);
      const comparison = compareSortValues(aVal, bVal);
      return order === 'asc' ? comparison : -comparison;
    });

    tbody.innerHTML = '';
    rows.forEach(r => tbody.appendChild(r));
  }

  function resolveComparableSortValue(cell) {
    const explicitRaw = cell?.dataset?.sortValue;
    const cellRaw = String(
      explicitRaw == null || String(explicitRaw).trim() === ''
        ? (cell?.textContent || '')
        : explicitRaw
    ).replace(/\s+/g, ' ').trim();

    if (!cellRaw) return { type: 'string', value: '' };

    const normalizedNumeric = cellRaw.replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(normalizedNumeric)) {
      return { type: 'number', value: Number(normalizedNumeric) };
    }

    if (/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(cellRaw)) {
      const asTimestamp = Date.parse(cellRaw);
      if (!Number.isNaN(asTimestamp)) return { type: 'number', value: asTimestamp };
    }

    return { type: 'string', value: cellRaw.toLowerCase() };
  }

  function compareSortValues(aValue, bValue) {
    if (aValue.type === 'number' && bValue.type === 'number') {
      return aValue.value - bValue.value;
    }
    return String(aValue.value).localeCompare(String(bValue.value), undefined, {
      sensitivity: 'base',
      numeric: true
    });
  }

  function getColumnIndex(column) {
    const headerArray = Array.from(table.querySelectorAll('thead th'));
    return headerArray.findIndex(h => h.dataset.column === column);
  }

  function reorderColumns(sourceColumn, targetColumn) {
    const headerRow = table.querySelector('thead tr');
    const bodyRows = table.querySelectorAll('tbody tr');
    const headersArray = Array.from(headerRow.children);
    const headerElems = Array.from(headerRow.querySelectorAll('th'));
    const sourceIndex = headerElems.findIndex(h => h.dataset.column === sourceColumn);
    const targetIndex = headerElems.findIndex(h => h.dataset.column === targetColumn);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

    headerRow.insertBefore(headersArray[sourceIndex], headersArray[targetIndex > sourceIndex ? targetIndex + 1 : targetIndex]);

    bodyRows.forEach(row => {
      const cells = Array.from(row.children);
      row.insertBefore(cells[sourceIndex], cells[targetIndex > sourceIndex ? targetIndex + 1 : targetIndex]);
    });
  }

  // Search
  function performSearch() {
    const q = searchInput.value.trim().toLowerCase();
    const field = searchField.value;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    rows.forEach(row => {
      let match = false;
      const cells = Array.from(row.querySelectorAll('td'));

      if (field === 'all') {
        match = cells.slice(0, -1).some(c => c.textContent.toLowerCase().includes(q));
      } else {
        const headerIdx = getColumnIndex(field);
        if (headerIdx !== -1) {
          match = cells[headerIdx].textContent.toLowerCase().includes(q);
        }
      }

      row.style.display = match || q === '' ? '' : 'none';
    });
  }

  if (searchInput) searchInput.addEventListener('input', performSearch);
  if (searchField) searchField.addEventListener('change', performSearch);

  if (userId && tableKey) {
    const revealFallback = window.setTimeout(() => {
      if (tableWrapper && tableWrapper.dataset.tableSettingsReady !== '1') {
        setTableLoadingState(tableWrapper, false);
      }
    }, 3000);
    initTableSettings(table, tableKey, userId).finally(() => {
      window.clearTimeout(revealFallback);
      if (tableWrapper) setTableLoadingState(tableWrapper, false);
    });
  } else if (tableWrapper) {
    setTableLoadingState(tableWrapper, false);
  }

  const settingsBtn = document.getElementById('firstTableSettingsBtn');
  if (settingsBtn && tableKey && userId) {
    settingsBtn.addEventListener('click', () => {
      const settings = (window.__tableSettings && window.__tableSettings[tableKey]) || getDefaultSettings(table);
      openSettingsModal(table, settings, tableKey, userId);
    });
  }
});

// ============================================
//  ADVANCED SEARCH MODAL
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  const modalEl = document.getElementById('tableSearchModal');
  const formEl = document.getElementById('tableSearchModalForm');
  if (!modalEl || !formEl) return;

  const qEl = document.getElementById('tsmQuery');
  const fieldEl = document.getElementById('tsmField'); // modal select
  const typeEl = document.getElementById('tsmType');   // modal select

  const bsModal = window.bootstrap?.Modal ? new bootstrap.Modal(modalEl) : null;

  function readJsonScript(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try { return JSON.parse(el.textContent || ''); } catch { return fallback; }
  }

  function labelize(field) {
    // "createdAt" -> "Created at", "audit.createUser" -> "Audit create user"
    return String(field)
      .replace(/\./g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, c => c.toUpperCase());
  }

  function loadSearchableFieldsIntoModal() {
    const cfg = readJsonScript('tableSearchConfigJson', {});
    const fields = Array.isArray(cfg.searchableFields) ? cfg.searchableFields : [];
    console.log(fields);
    // Reset select
    fieldEl.innerHTML = '';
    fieldEl.appendChild(new Option('All fields', 'all'));

    fields
      .filter(Boolean)
      .forEach(f => fieldEl.appendChild(new Option(labelize(f), f)));
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.js-open-advanced-search');
    if (!btn) return;

    loadSearchableFieldsIntoModal();

    const quickInput = document.getElementById('searchInput');
    if (qEl && quickInput?.value) qEl.value = quickInput.value;

    bsModal?.show();
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();

    const url = new URL(window.location.href);

    const q = (qEl?.value || '').trim();
    const type = (typeEl?.value || 'contains').trim();     // contains | starts_with | exact_match
    const selectedField = (fieldEl?.value || 'all').trim(); // 'all' or real field name

    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');

    if (type) url.searchParams.set('type', type);
    else url.searchParams.delete('type');

    // dataService supports searchFields; omit it for "all fields" so defaults apply. [file:15]
    if (selectedField && selectedField !== 'all') url.searchParams.set('searchFields', selectedField);
    else url.searchParams.delete('searchFields');

    url.searchParams.delete('page'); // optional: reset pagination on new search

    window.location.assign(url.toString());
  });
});
// Call once after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  makeBootstrapModalFreelyDraggable('tableSearchModal');
});

function makeBootstrapModalFreelyDraggable(modalId, opts = {}) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) return;

  const dialog = modalEl.querySelector('.modal-dialog');
  const handle = modalEl.querySelector('.modal-header');
  if (!dialog || !handle) return;

  const clampToViewport = opts.clampToViewport ?? true; // set false if you want it to go off-screen
  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;

  function resetToBootstrapCenter() {
    // Let Bootstrap position it normally (centered)
    dialog.style.position = '';
    dialog.style.left = '';
    dialog.style.top = '';
    dialog.style.transform = '';
    dialog.style.margin = '';
  }

  function switchToFixedAtCurrentPosition() {
    // Capture the CURRENT on-screen position (centered by Bootstrap)
    const r = dialog.getBoundingClientRect();

    dialog.style.position = 'fixed';
    dialog.style.left = `${r.left}px`;
    dialog.style.top = `${r.top}px`;

    // Turn off Bootstrap centering transform so left/top take control
    dialog.style.transform = 'none';
    dialog.style.margin = '0';
  }

  function clamp(left, top) {
    if (!clampToViewport) return { left, top };

    const w = dialog.offsetWidth;
    const h = dialog.offsetHeight;

    // Keep at least part of the modal reachable:
    // - horizontally keep 80px visible
    // - vertically keep the header visible (or 56px fallback)
    const keepX = opts.keepVisibleX ?? 80;
    const keepY = opts.keepVisibleY ?? (handle.offsetHeight || 56);

    // Allow the modal to go partially off-screen, but keep a "grab area" visible
    const minLeft = -(w - keepX);
    const maxLeft = window.innerWidth - keepX;

    const minTop = -(h - keepY);
    const maxTop = window.innerHeight - keepY;

    return {
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, minTop), maxTop)
    };
  }

  // Important: when the modal opens, re-center (fixes your “far left” issue)
  modalEl.addEventListener('shown.bs.modal', resetToBootstrapCenter);

  // Optional: also reset on close (so next open is centered)
  modalEl.addEventListener('hidden.bs.modal', resetToBootstrapCenter);

  handle.addEventListener('pointerdown', (e) => {
    // Don’t drag when clicking the close button or any header controls
    if (e.target.closest('button, a, input, select, textarea, .btn-close')) return;

    switchToFixedAtCurrentPosition();

    dragging = true;
    startX = e.clientX;
    startY = e.clientY;

    startLeft = parseFloat(dialog.style.left || '0');
    startTop = parseFloat(dialog.style.top || '0');

    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;

    const left = startLeft + (e.clientX - startX);
    const top = startTop + (e.clientY - startY);

    const c = clamp(left, top);
    dialog.style.left = `${c.left}px`;
    dialog.style.top = `${c.top}px`;
  });

  window.addEventListener('pointerup', () => {
    dragging = false;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  makeBootstrapModalFreelyDraggable('tableSearchModal', { clampToViewport: true });
});

// ============================================
//  TABLE SETTINGS MANAGER
// ============================================

async function initTableSettings(tableElement, tableId, userId) {
  const defaultSettings = getDefaultSettings(tableElement);
  let settings = defaultSettings;
  const cachedSettings = getCachedSettings(tableId, userId);
  if (cachedSettings) {
    settings = normalizeSettingsForTable(tableElement, cachedSettings, defaultSettings);
    applySettings(tableElement, settings);
  }

  try {
    const res = await fetch(`/tableSettings/${userId}/${tableId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-ajax-request': 'true'
      }
    });
    if (!res.ok){
      throw new Error('Table settings data could not be retrieved.');
    }
    const data = await res.json();
    // Validate data format
    if (!data.data || typeof data.data !== "object" || !data.data.settings){
      throw new Error('Table settings data is not valid.');
    }
    settings = normalizeSettingsForTable(tableElement, data.data.settings, defaultSettings);
  } catch (err){
    // await showMessageModal({
    //   title: 'Error',
    //   icon: 'error',
    //   message: err.message || 'An unexpected error occurred. Please try again.',
    //   size: 'md',
    //   buttons: [{ text: 'OK', class: 'btn-danger btn-md' }]
    // });
    console.log(err.message);
  }
  // Store globally for access from button click
  window.__tableSettings = window.__tableSettings || {};
  window.__tableSettings[tableId] = settings;
  cacheSettings(tableId, userId, settings);

  applySettings(tableElement, settings);
}
// ============================================
//  SAVE (TEMP DISABLED - MOCK)
// ============================================
async function saveSettings(tableId, userId, settings) {
  try {
    //const response = await fetch(`/tableSettings/edit/${userId}/${tableId}`, {
    console.log(`/tablesettings/api/edit/${userId}/${tableId}`);
    const response = await fetch(`/tablesettings/api/edit/${userId}/${tableId}`, {    
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ajax-request': 'true'
      },
      body: JSON.stringify({
        columns: settings.columns   // <-- NOT just .columns
      })
    });
    //
    const result = await response.json();
    if (result.status === 'success') {
      cacheSettings(tableId, userId, settings);
      const modal = document.getElementById("tableSettingsModal");
      closeModal(modal);
      //
      await showMessageModal({
        title: 'Success',
        icon: 'success',
        message: result.message || '<b>Settings</b> saved successfully.',
        size: 'md',
        buttons: [{ text: 'OK', class: 'btn-success btn-md' }]
      });
      //window.location.href = '/operations';
    } else {
      await showMessageModal({
        title: 'Error',
        icon: 'error',
        message: result.message || 'Failed to save <b>Settings</b>.',
        size: 'md',
        buttons: [{ text: 'OK', class: 'btn-danger btn-md' }]
      });
    }
  } catch (err) {
    console.error('Error saving Settings.', err);
    await showMessageModal({
      title: 'Error',
      icon: 'error',
      message: 'An unexpected error occurred. Please try again.',
      size: 'md',
      buttons: [{ text: 'OK', class: 'btn-danger btn-md' }]
    });
  }
  finally{
  }

}
// ============================================
//  GENERATE DEFAULT TABLE CONFIG
// ============================================
var defaulTableSettings = null;
const TABLE_LOADING_PLACEHOLDER_CLASS = 'table-settings-loading-placeholder';

function ensureTableLoadingPlaceholder(wrapper) {
  if (!wrapper) return null;
  let placeholder = wrapper.querySelector(`.${TABLE_LOADING_PLACEHOLDER_CLASS}`);
  if (placeholder) return placeholder;

  placeholder = document.createElement('div');
  placeholder.className = TABLE_LOADING_PLACEHOLDER_CLASS;
  placeholder.setAttribute('aria-live', 'polite');
  placeholder.style.display = 'none';
  placeholder.style.alignItems = 'center';
  placeholder.style.justifyContent = 'center';
  placeholder.style.minHeight = '96px';
  placeholder.style.padding = '1rem';
  placeholder.style.textAlign = 'center';
  placeholder.style.fontWeight = '600';
  placeholder.style.color = 'var(--color-text-muted, #6c757d)';
  placeholder.textContent = 'Loading ...';

  const tableEl = wrapper.querySelector('table');
  if (tableEl && tableEl.parentNode === wrapper) {
    wrapper.insertBefore(placeholder, tableEl);
  } else {
    wrapper.prepend(placeholder);
  }
  return placeholder;
}

function setTableLoadingState(wrapper, isLoading) {
  if (!wrapper) return;
  const tableEl = wrapper.querySelector('table');
  const placeholder = ensureTableLoadingPlaceholder(wrapper);

  if (isLoading) {
    wrapper.dataset.tableSettingsReady = '0';
    wrapper.setAttribute('aria-busy', 'true');
    if (placeholder) placeholder.style.display = 'flex';
    if (tableEl) tableEl.style.display = 'none';
    return;
  }

  wrapper.dataset.tableSettingsReady = '1';
  wrapper.removeAttribute('aria-busy');
  if (placeholder) placeholder.style.display = 'none';
  if (tableEl) tableEl.style.removeProperty('display');
}

function getTableSettingsCacheKey(tableId, userId) {
  return `tableSettings:${String(userId || '').trim()}:${String(tableId || '').trim()}`;
}

function getCachedSettings(tableId, userId) {
  try {
    const key = getTableSettingsCacheKey(tableId, userId);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.columns)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function cacheSettings(tableId, userId, settings) {
  try {
    const key = getTableSettingsCacheKey(tableId, userId);
    if (!key || !settings || !Array.isArray(settings.columns)) return;
    localStorage.setItem(key, JSON.stringify(settings));
  } catch (_) {
    // Ignore localStorage quota/privacy errors
  }
}

function normalizeSettingsForTable(tableElement, incomingSettings, defaultSettings) {
  function isGenericColumnLabel(value) {
    return /^column\s+\d+$/i.test(String(value || '').trim());
  }

  const defaults = Array.isArray(defaultSettings?.columns)
    ? defaultSettings.columns
    : (getDefaultSettings(tableElement).columns || []);

  const incomingCols = Array.isArray(incomingSettings?.columns) ? incomingSettings.columns : [];
  const incomingMap = new Map(
    incomingCols
      .filter(col => col && typeof col === 'object')
      .map(col => [String(col.key || '').trim(), col])
      .filter(([key]) => key)
  );

  const normalizedColumns = defaults.map((def, idx) => {
    const fromSaved = incomingMap.get(String(def.key || '').trim()) || {};
    const rawOrder = Number(fromSaved.order);
    const safeOrder = Number.isFinite(rawOrder) && rawOrder > 0 ? rawOrder : (idx + 1);
    const fallbackLabel = String(def.defaultLabel || def.label || `Column ${idx + 1}`).trim();
    const savedLabel = String(fromSaved.label || '').trim();
    const safeLabel = (
      savedLabel
      && !(isGenericColumnLabel(savedLabel) && fallbackLabel && !isGenericColumnLabel(fallbackLabel))
    )
      ? savedLabel
      : fallbackLabel;
    const rawWidth = fromSaved.width == null ? '' : String(fromSaved.width).trim();

    return {
      key: def.key,
      defaultLabel: fallbackLabel || `Column ${idx + 1}`,
      label: safeLabel || fallbackLabel || `Column ${idx + 1}`,
      visible: typeof fromSaved.visible === 'boolean' ? fromSaved.visible : true,
      order: safeOrder,
      width: rawWidth
    };
  });

  normalizedColumns.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return String(a.key || '').localeCompare(String(b.key || ''));
  });
  normalizedColumns.forEach((col, index) => {
    col.order = index + 1;
  });

  return { columns: normalizedColumns };
}

function getDefaultSettings(tableElement) {
  function extractHeaderLabel(headerCell, index) {
    const explicitLabel = String(headerCell?.dataset?.defaultLabel || '').trim();
    if (explicitLabel) return explicitLabel;

    const labelNode = headerCell ? headerCell.querySelector('.header-label') : null;
    const labelText = String(labelNode?.textContent || '').replace(/\s+/g, ' ').trim();
    if (labelText) return labelText;

    // textContent still works even when the table is temporarily display:none
    const rawText = String(headerCell?.textContent || '').replace(/\s+/g, ' ').trim();
    return rawText || `Column ${index + 1}`;
  }

  const headers = [...tableElement.querySelectorAll("thead th")];
  const settings =  {
    columns: headers.map((h, index) => {

      // Assign stable internal key IF missing
      if (!h.dataset.column) {
        h.dataset.column = `col_${index}`;
      }

      const defaultText = extractHeaderLabel(h, index);
      h.dataset.defaultLabel = defaultText || `Column ${index + 1}`;

      const thisData = {
        key: h.dataset.column,
        defaultLabel: h.dataset.defaultLabel || `Column ${index + 1}`,
        label: h.dataset.defaultLabel || `Column ${index + 1}`,
        visible: true,
        order: index + 1,
        width: "" // <--- ADD THIS LINE (Default to empty/auto)
      };
      return thisData;
    })
  };
  if(defaulTableSettings === null) defaulTableSettings = settings;
  return settings;
}

// ============================================
//  APPLY SETTINGS TO TABLE
// ============================================

function getOrderedColumns(settings) {
  const columns = Array.isArray(settings?.columns) ? settings.columns.slice() : [];
  columns.sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
  return columns;
}

function applyColumnHeaderPresentation(headerCell, col) {
  if (!headerCell || !col) return;

  headerCell.style.display = col.visible ? '' : 'none';

  if (col.width && String(col.width).trim() !== '') {
    let widthValue = String(col.width).trim();
    if (/^\d+$/.test(widthValue)) widthValue += 'px';
    headerCell.style.width = widthValue;
    headerCell.style.minWidth = widthValue;
  } else {
    headerCell.style.width = '';
    headerCell.style.minWidth = '';
  }

  // Preserve select-all checkbox column; do not replace its content
  if (col.key === 'select') {
    headerCell.classList.remove('draggable');
    const existingCheckbox = headerCell.querySelector('#selectAll');
    if (!existingCheckbox) {
      const label = document.createElement('label');
      label.className = 'd-flex flex-column align-items-center gap-0 mb-0';
      label.style.cursor = 'pointer';
      label.htmlFor = 'selectAll';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'form-check-input';
      cb.id = 'selectAll';
      cb.onclick = function () {
        document.querySelectorAll('.session-checkbox').forEach((c) => { c.checked = cb.checked; });
        const sa = document.getElementById('selectAll');
        if (sa) sa.indeterminate = false;
        if (typeof updateCompareState === 'function') updateCompareState();
      };
      const span = document.createElement('span');
      span.className = 'small text-muted';
      span.textContent = 'Select all';
      label.appendChild(cb);
      label.appendChild(span);
      headerCell.innerHTML = '';
      headerCell.appendChild(label);
    }
    return;
  }

  headerCell.classList.add('sortable', 'draggable');
  headerCell.innerHTML = '';
  const labelSpan = document.createElement('span');
  labelSpan.classList.add('header-label');
  labelSpan.textContent = col.label || col.defaultLabel;
  const sortSpan = document.createElement('span');
  sortSpan.classList.add('sort-icon');
  sortSpan.textContent = '';
  headerCell.appendChild(labelSpan);
  headerCell.appendChild(sortSpan);
}

function applySettings(table, settings) {
  if (!table || !settings) return;

  // Stable keys on headers (never reassign existing data-column values).
  getDefaultSettings(table);

  const columns = getOrderedColumns(settings);
  const orderedKeys = columns.map((col) => String(col?.key || '').trim()).filter(Boolean);
  const headerRow = table.querySelector('thead tr');
  if (!headerRow) return;

  const headerCells = [...headerRow.children];
  const headerByKey = new Map(
    headerCells
      .map((cell) => [String(cell.dataset.column || '').trim(), cell])
      .filter(([key]) => key)
  );

  // Snapshot body cells by the key of the header currently at the same index
  // (before any reordering), so data stays tied to the correct column identity.
  const bodyRows = [...table.querySelectorAll('tbody tr')];
  const bodyMaps = bodyRows.map((row) => {
    const map = new Map();
    const cells = [...row.children];
    if (cells.length < headerCells.length) return map; // colspan / placeholder rows
    headerCells.forEach((headerCell, index) => {
      const key = String(headerCell.dataset.column || '').trim();
      if (key && cells[index]) map.set(key, cells[index]);
    });
    return map;
  });

  // Reorder header by desired key order
  orderedKeys.forEach((key) => {
    const cell = headerByKey.get(key);
    if (cell) headerRow.appendChild(cell);
  });

  // Reorder body cells to match the same key order
  bodyRows.forEach((row, rowIndex) => {
    const map = bodyMaps[rowIndex];
    if (!map || map.size < orderedKeys.length) return;
    orderedKeys.forEach((key) => {
      const cell = map.get(key);
      if (cell) row.appendChild(cell);
    });
  });

  // Visibility / labels / widths by column key (not nth-child position)
  const headerIndexByKey = new Map(
    [...headerRow.children].map((cell, index) => [String(cell.dataset.column || '').trim(), index])
  );

  columns.forEach((col) => {
    const key = String(col?.key || '').trim();
    if (!key) return;
    const headerCell = headerByKey.get(key);
    if (!headerCell) return;

    applyColumnHeaderPresentation(headerCell, col);

    const index = headerIndexByKey.get(key);
    if (index === undefined) return;
    bodyRows.forEach((row) => {
      if (row.children.length <= index) return;
      const cell = row.children[index];
      if (cell) cell.style.display = col.visible ? '' : 'none';
    });
  });

  updateSearchDropdown(columns);
}

function moveColumn(row, fromIndex, toIndex) {
  const cells = [...row.children];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= cells.length || toIndex >= cells.length) return;
  if (fromIndex === toIndex) return;
  const node = cells[fromIndex];
  const reference = cells[toIndex > fromIndex ? toIndex + 1 : toIndex] || null;
  row.insertBefore(node, reference);
}

function findColumnIndex(table, key) {
  return [...table.querySelectorAll('thead th')]
    .findIndex((h) => h.dataset.column === key);
}

function reapplyCurrentTableSettings(tableElement) {
  const table = tableElement || document.getElementById('first-table');
  if (!table) return;
  const tableNameEl = document.getElementById('tableName');
  const tableId = tableNameEl ? tableNameEl.getAttribute('data-id') : '';
  const settings = (tableId && window.__tableSettings && window.__tableSettings[tableId])
    || getDefaultSettings(table);
  applySettings(table, settings);
}

function updateSearchDropdown(columns) {
  const searchSelect = document.getElementById("searchField");
  if (!searchSelect) return;

  // Keep "All Fields" as the first item
  const preservedOption = `<option value="all">All Fields</option>`;

  // Build options only for visible columns
  const newOptions = columns
    .filter(col => col.visible) // only show visible columns
    .map(col => `<option value="${col.key}">${col.label || col.defaultLabel}</option>`)
    .join("");

  // Update dropdown
  searchSelect.innerHTML = preservedOption + newOptions;
}

// ============================================
//  OPEN MODAL + BUILD UI
// ============================================

function openSettingsModal(table, settings, tableId, userId) {

  const modal = document.getElementById("tableSettingsModal");
  const tbody = document.querySelector("#columnSettingsTable tbody");

  if (!modal) {
    console.error("❌ Modal with ID tableSettingsModal not found in layout!");
    return;
  }

  tbody.innerHTML = "";

  // Build table rows (stable order by settings.order)
  getOrderedColumns(settings).forEach(col => {
    const row = document.createElement("tr");
    row.draggable = true;
    row.dataset.key = col.key;

    // row.innerHTML = `
    //   <td class="drag-handle" style="cursor:grab;">☰</td>
    //   <td><input type="checkbox" ${col.visible ? "checked" : ""}></td>
    //   <td id="default-label">${col.defaultLabel}</td>
    //   <td><input type="text" class="form-control form-control-sm" value="${col.label}"></td>
    //       `;

    row.innerHTML = `
      <td class="drag-handle" style="cursor:grab; vertical-align: middle;">☰</td>
      <td style="vertical-align: middle;"><input type="checkbox" ${col.visible ? "checked" : ""}></td>
      <td id="default-label" style="vertical-align: middle;">${col.defaultLabel}</td>
      <td><input type="text" class="form-control form-control-sm label-input" value="${col.label}"></td>
      <td><input type="text" class="form-control form-control-sm width-input" value="${col.width || ''}" placeholder="e.g. 150px"></td>
    `;

    tbody.appendChild(row);

    // Drag behavior
    row.addEventListener("dragstart", () => row.classList.add("dragging"));
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
  });

  // Enable drag sorting
  tbody.addEventListener("dragover", e => {
    e.preventDefault();
    const dragging = tbody.querySelector(".dragging");
    const after = [...tbody.children].find(r =>
      e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2
    );
    if (after) tbody.insertBefore(dragging, after);
    else tbody.appendChild(dragging);
  });

  // Buttons
  document.getElementById("saveSettings").onclick = async () => {

    const updatedSettings = {
      columns: [...tbody.children].map((row, i) => ({
        key: row.dataset.key,
        visible: row.querySelector("input[type='checkbox']").checked,
        order: i + 1,
        label: row.querySelector("input[type='text']").value,
        defaultLabel: row.querySelector("#default-label").textContent.trim(),
        width: row.querySelector(".width-input").value  // <--- ADD THIS LINE        
      }))
    };
    // --- UPDATE SEARCH COMBOBOX BASED ON SETTINGS ---
    updateSearchDropdown(updatedSettings.columns);

    window.__tableSettings[tableId] = updatedSettings;
    await saveSettings(tableId, userId, updatedSettings);
    applySettings(table, updatedSettings);
    closeModal(modal);
  };

  document.getElementById("cancelSettings").onclick = () => closeModal(modal);

  document.getElementById("resetSettings").onclick = async () => {
    if(defaulTableSettings!==null){
      try {
        const res = await fetch(`/tableSettings/api/delete/${userId}/${tableId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-ajax-request': 'true'
          }
        });
        const result = await res.json();
        if (result.status === 'success') {
          window.__tableSettings = window.__tableSettings || {};
          window.__tableSettings[tableId] = defaulTableSettings;
          cacheSettings(tableId, userId, defaulTableSettings);
          applySettings(table, defaulTableSettings);
          //
          const modal = document.getElementById("tableSettingsModal");
          closeModal(modal);
          //
          await showMessageModal({
            title: 'Success',
            icon: 'success',
            message: result.message || '<b>Settings</b> saved successfully.',
            size: 'md',
            buttons: [{ text: 'OK', class: 'btn-success btn-md' }]
          });
          //window.location.href = '/operations';
        } else {
          await showMessageModal({
            title: 'Error',
            icon: 'error',
            message: result.message || 'Failed to save <b>Settings</b>.',
            size: 'md',
            buttons: [{ text: 'OK', class: 'btn-danger btn-md' }]
          });
        }
      } catch (err) {
        console.error('Error saving Settings.', err);
        await showMessageModal({
          title: 'Error',
          icon: 'error',
          message: 'An unexpected error occurred. Please try again.',
          size: 'md',
          buttons: [{ text: 'OK', class: 'btn-danger btn-md' }]
        });
      }
              
    }
    // const defaults = getDefaultSettings(table);
  };
  showModal(modal);
}

// ============================================
//  UNIVERSAL MODAL DISPLAY HANDLER
// ============================================

function showModal(modal) {

  // Bootstrap support
  if (window.bootstrap && bootstrap.Modal) {
    let instance = bootstrap.Modal.getInstance(modal);
    if (!instance) {
      instance = new bootstrap.Modal(modal);
    }
    instance.show();
    return;
  }

  // Custom modal handler support
  if (typeof modal.show === "function") {
    modal.show();
    return;
  }

  // Fallback
  modal.classList.add("show");
  modal.style.display = "block";
}

function closeModal(modal) {

  if (!modal) return;

  // Bootstrap close logic
  if (window.bootstrap && bootstrap.Modal) {
    let instance = bootstrap.Modal.getInstance(modal);
    if (instance) {
      instance.hide();
      return;
    }
  }

  // Fallback
  modal.classList.remove("show");
  modal.style.display = "none";
}

// ============================================
//  EXPORT
// ============================================

window.initTableSettings = initTableSettings;
window.openSettingsModal = openSettingsModal;
window.applyTableSettings = applySettings;
window.reapplyCurrentTableSettings = reapplyCurrentTableSettings;
window.defaulTableSettings = defaulTableSettings;
