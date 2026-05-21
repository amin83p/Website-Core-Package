document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('trackActivityFilterForm');
  if (!form) return;

  const userIdInput = document.getElementById('trackActivityUserIdInput');
  const userSummaryInput = document.getElementById('trackActivityUserSummary');
  const pickUserBtn = document.getElementById('trackActivityPickUserBtn');
  const resetUserBtn = document.getElementById('trackActivityResetUserBtn');
  const sectionIdsInput = document.getElementById('trackActivitySectionIdsInput');
  const operationIdsInput = document.getElementById('trackActivityOperationIdsInput');
  const orgIdsInput = document.getElementById('trackActivityOrgIdsInput');
  const sectionSummaryInput = document.getElementById('trackActivitySectionSummary');
  const operationSummaryInput = document.getElementById('trackActivityOperationSummary');
  const orgSummaryInput = document.getElementById('trackActivityOrgSummary');
  const sectionListEl = document.getElementById('trackActivitySectionSelectedList');
  const operationListEl = document.getElementById('trackActivityOperationSelectedList');
  const orgListEl = document.getElementById('trackActivityOrgSelectedList');
  const pickSectionBtn = document.getElementById('trackActivityPickSectionBtn');
  const clearSectionBtn = document.getElementById('trackActivityClearSectionBtn');
  const pickOperationBtn = document.getElementById('trackActivityPickOperationBtn');
  const clearOperationBtn = document.getElementById('trackActivityClearOperationBtn');
  const pickOrgBtn = document.getElementById('trackActivityPickOrgBtn');
  const clearOrgBtn = document.getElementById('trackActivityClearOrgBtn');

  const metaEl = document.getElementById('trackActivityTimelineMeta');
  const alertEl = document.getElementById('trackActivityTimelineAlert');
  const modeEl = document.getElementById('trackActivityTimelineMode');
  const focusHostEl = document.getElementById('trackActivityTimelineFocusHost');
  const daysHostEl = document.getElementById('trackActivityTimelineDaysHost');
  const lineGraphHostEl = document.getElementById('trackActivityLineGraphHost');
  const summaryEl = document.getElementById('trackActivityTimelineSummary');
  const backBtnEl = document.getElementById('trackActivityTimelineBackBtn');
  const resetZoomBtnEl = document.getElementById('trackActivityTimelineResetZoomBtn');
  const shadeViewBtnEl = document.getElementById('trackActivityShadeViewBtn');
  const lineViewBtnEl = document.getElementById('trackActivityLineViewBtn');

  const requestsCardEl = document.getElementById('taCardRequests');
  const attemptsCardEl = document.getElementById('taCardAttempts');
  const busiestCardEl = document.getElementById('taCardBusiest');

  const startInputEl = document.getElementById('trackActivityStartAt');
  const endInputEl = document.getElementById('trackActivityEndAt');
  const rangeShortcutsEl = document.getElementById('trackActivityRangeShortcuts');
  const chunkModalEl = document.getElementById('trackActivityChunkModal');
  const chunkModalTitleEl = document.getElementById('trackActivityChunkModalTitle');
  const chunkModalMetaEl = document.getElementById('trackActivityChunkModalMeta');
  const chunkModalSummaryEl = document.getElementById('trackActivityChunkModalSummary');
  const chunkModalRowsEl = document.getElementById('trackActivityChunkModalRows');
  const chunkTableModalEl = document.getElementById('trackActivityChunkTableModal');
  const chunkTableModalTitleEl = document.getElementById('trackActivityChunkTableModalTitle');
  const chunkTableModalMetaEl = document.getElementById('trackActivityChunkTableModalMeta');
  const chunkTableModalHostEl = document.getElementById('trackActivityChunkTableModalHost');
  const chunkChartModalEl = document.getElementById('trackActivityChunkChartModal');
  const chunkChartModalTitleEl = document.getElementById('trackActivityChunkChartModalTitle');
  const chunkChartModalMetaEl = document.getElementById('trackActivityChunkChartModalMeta');
  const chunkChartModalHostEl = document.getElementById('trackActivityChunkChartModalHost');
  const eventModalEl = document.getElementById('trackActivityEventModal');
  const eventModalTitleEl = document.getElementById('trackActivityEventModalTitle');
  const eventModalMetaEl = document.getElementById('trackActivityEventModalMeta');
  const eventModalSummaryEl = document.getElementById('trackActivityEventModalSummary');
  const eventModalPayloadEl = document.getElementById('trackActivityEventModalPayload');
  const eventModalActionSummaryEl = document.getElementById('trackActivityEventModalActionSummary');
  const eventModalActionPayloadEl = document.getElementById('trackActivityEventModalActionPayload');
  const eventModalLoadActionBtnEl = document.getElementById('trackActivityEventModalLoadActionBtn');

  const config = window.__trackActivityConfig || {};
  const canPickUsers = config.canPickUsers === true;
  const maxRangeDays = Number(config.maxRangeDays || 7);
  const defaultUserId = String(config.defaultUserId || '').trim();
  const defaultUserLabel = String(config.defaultUserLabel || '').trim() || defaultUserId || '-';
  const chunkModal = (chunkModalEl && window.bootstrap?.Modal)
    ? new window.bootstrap.Modal(chunkModalEl)
    : null;
  const chunkTableModal = (chunkTableModalEl && window.bootstrap?.Modal)
    ? new window.bootstrap.Modal(chunkTableModalEl)
    : null;
  const chunkChartModal = (chunkChartModalEl && window.bootstrap?.Modal)
    ? new window.bootstrap.Modal(chunkChartModalEl)
    : null;
  const eventModal = (eventModalEl && window.bootstrap?.Modal)
    ? new window.bootstrap.Modal(eventModalEl)
    : null;
  const lookupRows = (config && typeof config.lookups === 'object') ? config.lookups : {};
  const filterConfigRows = (config && typeof config.filters === 'object') ? config.filters : {};
  const storedTimelineViewMode = (() => {
    try {
      return window.localStorage?.getItem('trackActivityTimeline.viewMode') === 'line' ? 'line' : 'shade';
    } catch (error) {
      return 'shade';
    }
  })();

  function toList(raw) {
    if (Array.isArray(raw)) {
      return Array.from(new Set(raw
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
    }
    const token = String(raw || '').trim();
    if (!token) return [];
    return Array.from(new Set(token
      .split(',')
      .map((item) => String(item || '').trim())
      .filter(Boolean)));
  }

  function toLookupMap(raw) {
    const map = new Map();
    (Array.isArray(raw) ? raw : []).forEach((row) => {
      const id = String(row?.id || '').trim();
      const name = String(row?.name || row?.label || row?.title || id).trim() || id;
      if (!id) return;
      map.set(id, name);
    });
    return map;
  }

  const sectionNameMap = toLookupMap(lookupRows.sections);
  const operationNameMap = toLookupMap(lookupRows.operations);
  const orgNameMap = toLookupMap(lookupRows.orgs);

  const contexts = window.GenericPickerContexts || {};
  const activeOrgContext = (typeof contexts.activeOrganizationScope === 'function')
    ? contexts.activeOrganizationScope({ label: 'Active Organization' })
    : null;

  const filterPickerConfig = {
    sections: {
      inputEl: sectionIdsInput,
      summaryEl: sectionSummaryInput,
      listEl: sectionListEl,
      pickBtnEl: pickSectionBtn,
      clearBtnEl: clearSectionBtn,
      nameMap: sectionNameMap,
      emptyLabel: 'All Sections',
      itemLabel: 'Section',
      removeAttr: 'data-track-remove-section',
      preset: () => (window.GenericPickerPresets && typeof window.GenericPickerPresets.section === 'function'
        ? window.GenericPickerPresets.section({
          title: 'Select Sections',
          icon: 'bi-collection',
          apiEndpoint: '/sections',
          searchFields: 'id,name,description,category',
          placeholder: 'Search sections...',
          context: activeOrgContext,
          multiselect: true
        })
        : null)
    },
    operations: {
      inputEl: operationIdsInput,
      summaryEl: operationSummaryInput,
      listEl: operationListEl,
      pickBtnEl: pickOperationBtn,
      clearBtnEl: clearOperationBtn,
      nameMap: operationNameMap,
      emptyLabel: 'All Operations',
      itemLabel: 'Operation',
      removeAttr: 'data-track-remove-operation',
      preset: () => (window.GenericPickerPresets && typeof window.GenericPickerPresets.operation === 'function'
        ? window.GenericPickerPresets.operation({
          title: 'Select Operations',
          icon: 'bi-gear',
          apiEndpoint: '/operations',
          searchFields: 'id,name,description',
          placeholder: 'Search operations...',
          context: activeOrgContext,
          multiselect: true
        })
        : null)
    },
    orgs: {
      inputEl: orgIdsInput,
      summaryEl: orgSummaryInput,
      listEl: orgListEl,
      pickBtnEl: pickOrgBtn,
      clearBtnEl: clearOrgBtn,
      nameMap: orgNameMap,
      emptyLabel: 'All Organizations',
      itemLabel: 'Organization',
      removeAttr: 'data-track-remove-org',
      preset: () => (window.GenericPickerPresets && typeof window.GenericPickerPresets.organization === 'function'
        ? window.GenericPickerPresets.organization({
          title: 'Select Organizations',
          icon: 'bi-building',
          apiEndpoint: '/organizations',
          searchFields: 'id,name,identity.displayName',
          placeholder: 'Search organizations...',
          context: activeOrgContext,
          multiselect: true
        })
        : null)
    }
  };

  const state = {
    zoomLevel: 'hourly',
    focusDay: '',
    focusHour: -1,
    focusFiveMinute: -1,
    lastPayload: null,
    summaryRows: [],
    lineGraphRows: [],
    viewMode: storedTimelineViewMode,
    currentActionStateId: '',
    chunkTableOpenRows: [],
    filterSelections: {
      sections: [],
      operations: [],
      orgs: []
    }
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmt(value) {
    return Number(value || 0).toLocaleString();
  }

  function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function formatLocalDateTime(value, { withSeconds = false } = {}) {
    const token = String(value || '').trim();
    if (!token) return '-';
    const date = new Date(token);
    if (Number.isNaN(date.getTime())) return token;
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      hour12: false
    });
  }

  function toPrettyJson(value) {
    if (value === undefined) return '-';
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }

  function normalizeIdToken(value, max = 220) {
    const token = String(value || '').trim();
    if (!token) return '';
    return token.length > max ? token.slice(0, max) : token;
  }

  function resolveActionStateIdFromEvent(event = {}) {
    return normalizeIdToken(event?.actionState?.recordId || event?.actionStateId, 180);
  }

  function normalizeFilterItem(raw, nameMap = null) {
    if (!raw || (typeof raw !== 'object' && typeof raw !== 'string')) return null;
    const item = typeof raw === 'string' ? { id: raw } : raw;
    const id = String(item.id || '').trim();
    if (!id) return null;
    const mapped = (nameMap && typeof nameMap.get === 'function') ? String(nameMap.get(id) || '').trim() : '';
    const name = String(item.name || item.label || item.title || mapped || id).trim() || id;
    return { id, name };
  }

  function buildInitialFilterSelection(fieldName) {
    const cfg = filterPickerConfig[fieldName];
    if (!cfg) return [];
    const fromConfig = toList(filterConfigRows?.[`${fieldName === 'orgs' ? 'org' : fieldName.slice(0, -1)}Ids`]);
    const fromInput = toList(cfg.inputEl?.value || '');
    const merged = Array.from(new Set([].concat(fromConfig, fromInput))).filter(Boolean);
    return merged
      .map((id) => normalizeFilterItem({ id }, cfg.nameMap))
      .filter(Boolean);
  }

  function setFieldInputFromSelection(fieldName) {
    const cfg = filterPickerConfig[fieldName];
    if (!cfg || !cfg.inputEl) return;
    const selected = Array.isArray(state.filterSelections[fieldName]) ? state.filterSelections[fieldName] : [];
    cfg.inputEl.value = selected.map((item) => String(item.id || '').trim()).filter(Boolean).join(',');
  }

  function renderFilterField(fieldName) {
    const cfg = filterPickerConfig[fieldName];
    if (!cfg || !cfg.summaryEl || !cfg.listEl) return;

    const selected = Array.isArray(state.filterSelections[fieldName]) ? state.filterSelections[fieldName] : [];
    cfg.summaryEl.value = selected.length ? `${selected.length} selected` : '';
    cfg.summaryEl.placeholder = cfg.emptyLabel;
    setFieldInputFromSelection(fieldName);

    if (!selected.length) {
      cfg.listEl.innerHTML = `<div class="ta-filter-empty">${escapeHtml(cfg.emptyLabel)}</div>`;
      return;
    }

    cfg.listEl.innerHTML = selected.map((item) => {
      const id = escapeHtml(item.id || '');
      const name = escapeHtml(item.name || item.id || '');
      return `
        <div class="ta-filter-item d-flex align-items-start justify-content-between gap-2 mb-1">
          <div class="overflow-hidden">
            <div class="ta-filter-item-title text-truncate">${name}</div>
            <div class="ta-filter-item-id text-truncate">${id}</div>
          </div>
          <button
            type="button"
            class="btn btn-outline-danger btn-sm"
            ${cfg.removeAttr}="${id}"
            aria-label="Remove ${escapeHtml(cfg.itemLabel)}">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      `;
    }).join('');
  }

  function upsertFilterItems(fieldName, rawItems) {
    const cfg = filterPickerConfig[fieldName];
    if (!cfg) return;
    const incoming = Array.isArray(rawItems) ? rawItems : [rawItems];
    const byId = new Map((Array.isArray(state.filterSelections[fieldName]) ? state.filterSelections[fieldName] : [])
      .map((item) => [String(item.id || '').trim(), item]));

    incoming.forEach((raw) => {
      const normalized = normalizeFilterItem(raw, cfg.nameMap);
      if (!normalized) return;
      byId.set(normalized.id, normalized);
    });

    state.filterSelections[fieldName] = Array.from(byId.values());
    renderFilterField(fieldName);
  }

  function removeFilterItem(fieldName, itemId) {
    const token = String(itemId || '').trim();
    if (!token) return;
    state.filterSelections[fieldName] = (Array.isArray(state.filterSelections[fieldName]) ? state.filterSelections[fieldName] : [])
      .filter((item) => String(item.id || '').trim() !== token);
    renderFilterField(fieldName);
  }

  function clearFilterField(fieldName) {
    state.filterSelections[fieldName] = [];
    renderFilterField(fieldName);
  }

  function toDatetimeLocalValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  function setDateRangeShortcut(token = '') {
    if (!startInputEl || !endInputEl) return;
    const now = new Date();
    const shortcut = String(token || '').trim().toLowerCase();
    const end = new Date(now);
    const start = new Date(now);

    if (shortcut === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (shortcut === 'yesterday') {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 0, 0);
    } else {
      const dayMap = {
        last2: 2,
        last3: 3,
        last4: 4,
        last5: 5,
        last6: 6,
        weekly: 7
      };
      const days = Number(dayMap[shortcut] || 0);
      if (days > 0) {
        start.setDate(start.getDate() - (days - 1));
        start.setHours(0, 0, 0, 0);
      } else {
        return;
      }
    }

    startInputEl.value = toDatetimeLocalValue(start);
    endInputEl.value = toDatetimeLocalValue(end);
    validateRangeHint();
  }

  function showAlert(message, type = 'warning') {
    if (!alertEl) return;
    alertEl.innerHTML = `<div class="alert alert-${type} py-2 px-3 mb-0">${escapeHtml(message)}</div>`;
  }

  function clearAlert() {
    if (!alertEl) return;
    alertEl.innerHTML = '';
  }

  function toRGBA(weight) {
    const safe = Math.max(0, Math.min(1, Number(weight || 0)));
    const start = { r: 22, g: 163, b: 74 };
    const end = { r: 147, g: 51, b: 234 };
    const r = Math.round(start.r + ((end.r - start.r) * safe));
    const g = Math.round(start.g + ((end.g - start.g) * safe));
    const b = Math.round(start.b + ((end.b - start.b) * safe));
    const alpha = 0.24 + (0.68 * safe);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  function buildSmoothGradient(chunks = []) {
    const rows = Array.isArray(chunks) ? chunks : [];
    if (!rows.length) return 'linear-gradient(90deg, rgba(22,163,74,0.18) 0%, rgba(147,51,234,0.18) 100%)';

    const stops = [];
    const total = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const currentWeight = Number(rows[i]?.colorWeight || 0);
      const nextWeight = Number(rows[Math.min(i + 1, rows.length - 1)]?.colorWeight || currentWeight);
      const startPct = ((i / total) * 100).toFixed(3);
      const endPct = (((i + 1) / total) * 100).toFixed(3);
      const currentColor = toRGBA(currentWeight);
      const boundaryColor = toRGBA((currentWeight + nextWeight) / 2);
      stops.push(`${currentColor} ${startPct}%`);
      stops.push(`${boundaryColor} ${endPct}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  function renderEmpty(message) {
    if (focusHostEl) {
      focusHostEl.classList.add('d-none');
      focusHostEl.innerHTML = '';
    }
    if (daysHostEl) {
      daysHostEl.classList.toggle('d-none', state.viewMode === 'line');
      daysHostEl.innerHTML = `<div class="ta-empty">${escapeHtml(message)}</div>`;
    }
    if (lineGraphHostEl) {
      lineGraphHostEl.classList.toggle('d-none', state.viewMode !== 'line');
      lineGraphHostEl.innerHTML = `<div class="ta-empty">${escapeHtml(message)}</div>`;
    }
    if (summaryEl) {
      summaryEl.innerHTML = '<span class="ta-hour-chip">No activity summary available.</span>';
    }
  }

  function renderIdleState() {
    state.zoomLevel = 'hourly';
    state.focusDay = '';
    state.focusHour = -1;
    state.focusFiveMinute = -1;
    state.lastPayload = null;
    state.summaryRows = [];
    state.lineGraphRows = [];
    state.currentActionStateId = '';
    state.chunkTableOpenRows = [];

    clearAlert();
    setCards({ totalRequests: 0, totalAttempts: 0 }, null);
    updateTimelineViewButtons();
    updateZoomButtons();

    if (modeEl) {
      modeEl.textContent = 'Set filters and click Run to load timeline.';
    }
    if (metaEl) {
      metaEl.textContent = 'No timeline data loaded yet.';
    }
    if (focusHostEl) {
      focusHostEl.classList.add('d-none');
      focusHostEl.innerHTML = '';
    }
    if (daysHostEl) {
      daysHostEl.classList.toggle('d-none', state.viewMode === 'line');
      daysHostEl.innerHTML = '<div class="ta-empty">No data loaded yet. Choose filters and click Run.</div>';
    }
    if (lineGraphHostEl) {
      lineGraphHostEl.classList.toggle('d-none', state.viewMode !== 'line');
      lineGraphHostEl.innerHTML = '<div class="ta-empty">No data loaded yet. Choose filters and click Run.</div>';
    }
    if (summaryEl) {
      summaryEl.innerHTML = '<span class="ta-hour-chip">Timeline fetch starts after clicking Run.</span>';
    }
  }

  function getFormParams() {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of fd.entries()) {
      const token = String(value || '').trim();
      if (!token) continue;
      params.set(key, token);
    }
    if (startInputEl && startInputEl.value) {
      const startAtMs = new Date(startInputEl.value).getTime();
      if (Number.isFinite(startAtMs)) params.set('startAtMs', String(startAtMs));
    }
    if (endInputEl && endInputEl.value) {
      const endAtMs = new Date(endInputEl.value).getTime();
      if (Number.isFinite(endAtMs)) params.set('endAtMs', String(endAtMs));
    }
    params.set('zoomLevel', state.zoomLevel);
    if (state.zoomLevel !== 'hourly' && state.focusDay) {
      params.set('focusDay', state.focusDay);
    }
    if (state.zoomLevel !== 'hourly' && state.focusHour >= 0) {
      params.set('focusHour', String(state.focusHour));
    }
    if (state.zoomLevel === '15s' && state.focusFiveMinute >= 0) {
      params.set('focusFiveMinute', String(state.focusFiveMinute));
    }
    return params;
  }

  function setCards(summary = {}, payload = null) {
    if (requestsCardEl) requestsCardEl.textContent = fmt(summary.totalRequests);
    if (attemptsCardEl) attemptsCardEl.textContent = fmt(summary.totalAttempts);

    if (!busiestCardEl) return;

    const rows = [];
    if (payload?.zoomLevel === 'hourly') {
      (Array.isArray(payload?.dayTimelines) ? payload.dayTimelines : []).forEach((day) => {
        (Array.isArray(day?.chunks) ? day.chunks : []).forEach((chunk) => {
          rows.push({
            label: `${day?.dateKey || ''} ${chunk?.label || ''}`.trim(),
            requestCount: Number(chunk?.requestCount || 0)
          });
        });
      });
    } else {
      (Array.isArray(payload?.focusTimeline?.chunks) ? payload.focusTimeline.chunks : []).forEach((chunk) => {
        rows.push({
          label: String(chunk?.label || ''),
          requestCount: Number(chunk?.requestCount || 0)
        });
      });
    }

    const top = rows.sort((a, b) => b.requestCount - a.requestCount)[0] || null;
    if (!top || top.requestCount <= 0) {
      busiestCardEl.textContent = '-';
      return;
    }
    busiestCardEl.textContent = `${top.label} (${fmt(top.requestCount)} logs)`;
  }

  function createAxisLabels(chunks = []) {
    const rows = Array.isArray(chunks) ? chunks : [];
    if (!rows.length) return ['-', '-', '-', '-', '-'];

    const extractStart = (label) => String(label || '').split(' - ')[0] || '-';
    const extractEnd = (label) => {
      const parts = String(label || '').split(' - ');
      return parts.length > 1 ? parts[1] : (parts[0] || '-');
    };

    const i1 = 0;
    const i2 = Math.floor((rows.length - 1) * 0.25);
    const i3 = Math.floor((rows.length - 1) * 0.5);
    const i4 = Math.floor((rows.length - 1) * 0.75);
    const i5 = rows.length - 1;

    return [
      extractStart(rows[i1]?.label),
      extractStart(rows[i2]?.label),
      extractStart(rows[i3]?.label),
      extractStart(rows[i4]?.label),
      extractEnd(rows[i5]?.label)
    ];
  }

  function buildTimelineCard(options = {}) {
    const title = String(options.title || '-');
    const meta = String(options.meta || '');
    const rangeStart = String(options.rangeStart || '00:00');
    const rangeEnd = String(options.rangeEnd || '23:59');
    const chunks = Array.isArray(options.chunks) ? options.chunks : [];
    const cols = Math.max(1, Number(options.cols || chunks.length || 1));
    const onClick = typeof options.onClick === 'function' ? options.onClick : null;
    const onOpenChunkTable = typeof options.onOpenChunkTable === 'function' ? options.onOpenChunkTable : null;
    const onOpenChunkChart = typeof options.onOpenChunkChart === 'function' ? options.onOpenChunkChart : null;
    const chunkTableButtonLabel = String(options.chunkTableButtonLabel || 'View Chunk Table');
    const chunkChartButtonLabel = String(options.chunkChartButtonLabel || 'View Activity Chart');
    const axis = Array.isArray(options.axis) && options.axis.length ? options.axis : createAxisLabels(chunks);
    const isFocus = options.isFocus === true;

    const card = document.createElement('div');
    card.className = `ta-timeline-card${isFocus ? ' ta-focus-card' : ''}`;

    const head = document.createElement('div');
    head.className = 'ta-timeline-card-head';
    head.innerHTML = `
      <div class="ta-timeline-label">${escapeHtml(title)}</div>
      <div class="ta-timeline-meta">${escapeHtml(meta)}</div>
    `;

    const range = document.createElement('div');
    range.className = 'ta-timeline-range';
    range.innerHTML = `<span>${escapeHtml(rangeStart)}</span><span>${escapeHtml(rangeEnd)}</span>`;

    const track = document.createElement('div');
    track.className = 'ta-timeline-track';
    track.style.setProperty('--ta-cols', String(cols));
    track.style.backgroundImage = buildSmoothGradient(chunks);

    const grid = document.createElement('div');
    grid.className = 'ta-timeline-grid';
    for (let i = 0; i < cols; i += 1) {
      grid.appendChild(document.createElement('span'));
    }

    const segments = document.createElement('div');
    segments.className = 'ta-timeline-segments';

    chunks.forEach((chunk, index) => {
      const titleText = `${chunk?.label || ''} | Logs: ${fmt(chunk?.requestCount)} | Attempts: ${fmt(chunk?.attemptCount)}`;
      const segment = document.createElement('button');
      segment.type = 'button';
      segment.className = 'ta-hour-segment';
      segment.title = titleText;
      segment.setAttribute('aria-label', titleText);
      if (onClick) {
        segment.addEventListener('click', () => onClick(chunk, index));
      } else {
        segment.style.cursor = 'default';
      }
      segments.appendChild(segment);
    });

    track.appendChild(grid);
    track.appendChild(segments);

    const axisRow = document.createElement('div');
    axisRow.className = 'ta-hour-axis';
    axisRow.innerHTML = axis.map((label) => `<span>${escapeHtml(label)}</span>`).join('');

    card.appendChild(head);
    card.appendChild(range);
    card.appendChild(track);
    card.appendChild(axisRow);
    if (onOpenChunkTable || onOpenChunkChart) {
      const actions = document.createElement('div');
      actions.className = 'ta-card-actions';
      if (onOpenChunkTable) {
        const tableBtn = document.createElement('button');
        tableBtn.type = 'button';
        tableBtn.className = 'btn btn-outline-primary btn-sm';
        tableBtn.innerHTML = '<i class="bi bi-table me-1"></i>' + escapeHtml(chunkTableButtonLabel);
        tableBtn.addEventListener('click', () => onOpenChunkTable());
        actions.appendChild(tableBtn);
      }
      if (onOpenChunkChart) {
        const chartBtn = document.createElement('button');
        chartBtn.type = 'button';
        chartBtn.className = 'btn btn-outline-secondary btn-sm';
        chartBtn.innerHTML = '<i class="bi bi-bar-chart-line me-1"></i>' + escapeHtml(chunkChartButtonLabel);
        chartBtn.addEventListener('click', () => onOpenChunkChart());
        actions.appendChild(chartBtn);
      }
      card.appendChild(actions);
    }

    return card;
  }

  function renderChunkTableMatrix(rowHeaders = [], chunkRows = [], title = '', subtitle = '') {
    if (!chunkTableModalTitleEl || !chunkTableModalMetaEl || !chunkTableModalHostEl) return;
    const chunks = Array.isArray(chunkRows) ? chunkRows : [];
    state.chunkTableOpenRows = [];
    if (!chunks.length) {
      chunkTableModalTitleEl.textContent = title || 'Chunk Table';
      chunkTableModalMetaEl.textContent = subtitle || '-';
      chunkTableModalHostEl.innerHTML = '<div class="text-muted">No chunks available.</div>';
      return;
    }

    const columnHeadersHtml = chunks.map((chunk, idx) => {
      const label = String(chunk?.label || `Chunk ${idx + 1}`).trim() || `Chunk ${idx + 1}`;
      return `<th scope="col">${escapeHtml(label)}</th>`;
    }).join('');

    const bodyRowsHtml = rowHeaders.map((row) => {
      const name = String(row?.name || '').trim();
      const accessor = typeof row?.value === 'function' ? row.value : (() => '');
      const cellsHtml = chunks.map((chunk, idx) => {
        const cellValue = accessor(chunk, idx);
        if (cellValue && typeof cellValue === 'object' && !Array.isArray(cellValue)) {
          const text = (cellValue.text !== undefined) ? cellValue.text : (cellValue.value ?? '-');
          const clickable = cellValue.clickable === true;
          const detailRow = (cellValue.detailRow && typeof cellValue.detailRow === 'object') ? cellValue.detailRow : null;
          if (clickable && detailRow) {
            const detailIndex = state.chunkTableOpenRows.push(detailRow) - 1;
            const buttonClass = String(cellValue.buttonClass || 'btn btn-link btn-sm p-0 ta-chunk-table-value-link');
            const buttonTitle = String(cellValue.title || 'Open chunk logs');
            return `
              <td>
                <button
                  type="button"
                  class="${escapeHtml(buttonClass)}"
                  data-track-chunk-detail-index="${detailIndex}"
                  title="${escapeHtml(buttonTitle)}">
                  ${escapeHtml(String(text ?? '-'))}
                </button>
              </td>
            `;
          }
          return `<td>${escapeHtml(String(text ?? '-'))}</td>`;
        }
        return `<td>${escapeHtml(String(cellValue ?? '-'))}</td>`;
      }).join('');
      return `
        <tr>
          <th scope="row">${escapeHtml(name || 'Row')}</th>
          ${cellsHtml}
        </tr>
      `;
    }).join('');

    chunkTableModalTitleEl.textContent = title || 'Chunk Table';
    chunkTableModalMetaEl.textContent = subtitle || '-';
    chunkTableModalHostEl.innerHTML = `
      <table class="table table-sm align-middle ta-chunk-matrix-table mb-0">
        <thead class="table-light">
          <tr>
            <th scope="col">Row Header</th>
            ${columnHeadersHtml}
          </tr>
        </thead>
        <tbody>
          ${bodyRowsHtml}
        </tbody>
      </table>
    `;
  }

  function openChunkTableModal(options = {}) {
    if (!chunkTableModal) return;
    const chunks = Array.isArray(options?.chunks) ? options.chunks : [];
    const title = String(options?.title || 'Chunk Table');
    const subtitle = String(options?.subtitle || '');
    const baseLabel = title
      .replace(/\s*-\s*Focus Chunk Table\s*$/i, '')
      .replace(/\s*-\s*Chunk Table\s*$/i, '')
      .trim();
    const toChunkDetailRow = (chunk = {}) => {
      const windowLabel = String(chunk?.label || '').trim();
      const joinedLabel = [baseLabel, windowLabel].filter(Boolean).join(' | ');
      return {
        label: joinedLabel || windowLabel || baseLabel || 'Chunk',
        requestCount: Number(chunk?.requestCount || 0),
        attemptCount: Number(chunk?.attemptCount || 0),
        startAt: String(chunk?.startAt || ''),
        endAt: String(chunk?.endAt || ''),
        startAtDisplay: String(chunk?.startAtDisplay || ''),
        endAtDisplay: String(chunk?.endAtDisplay || '')
      };
    };
    const tableRows = [
      {
        name: 'Requests',
        value: (chunk) => ({
          text: fmt(chunk?.requestCount),
          clickable: Number(chunk?.requestCount || 0) > 0,
          detailRow: toChunkDetailRow(chunk),
          title: 'Open logs for this chunk'
        })
      },
      {
        name: 'Attempt-like',
        value: (chunk) => ({
          text: fmt(chunk?.attemptCount),
          clickable: Number(chunk?.requestCount || 0) > 0 || Number(chunk?.attemptCount || 0) > 0,
          detailRow: toChunkDetailRow(chunk),
          title: 'Open logs for this chunk'
        })
      },
      { name: 'Load Weight', value: (chunk) => `${Math.round(Number(chunk?.colorWeight || 0) * 100)}%` }
    ];
    renderChunkTableMatrix(
      tableRows,
      chunks,
      title,
      subtitle
    );
    chunkTableModal.show();
  }

  function openSummaryChunkModalFromChunkTable(row = null) {
    if (!row || typeof row !== 'object') return;
    if (!chunkTableModalEl || !chunkTableModal || !chunkTableModalEl.classList.contains('show')) {
      openSummaryChunkModal(row);
      return;
    }
    const onHidden = () => {
      openSummaryChunkModal(row);
    };
    chunkTableModalEl.addEventListener('hidden.bs.modal', onHidden, { once: true });
    chunkTableModal.hide();
  }

  function renderChunkActivityChart(chunks = [], options = {}) {
    if (!chunkChartModalTitleEl || !chunkChartModalMetaEl || !chunkChartModalHostEl) return;
    const rows = Array.isArray(chunks) ? chunks : [];
    if (!rows.length) {
      chunkChartModalTitleEl.textContent = String(options?.title || 'Activity Chart');
      chunkChartModalMetaEl.textContent = String(options?.subtitle || '-');
      chunkChartModalHostEl.innerHTML = '<div class="text-muted">No chunks available.</div>';
      return;
    }

    const maxValue = rows.reduce((max, row) => {
      const requestCount = Number(row?.requestCount || 0);
      const attemptCount = Number(row?.attemptCount || 0);
      return Math.max(max, requestCount, attemptCount);
    }, 0) || 1;

    const columnsHtml = rows.map((chunk, idx) => {
      const label = String(chunk?.label || `Chunk ${idx + 1}`).trim() || `Chunk ${idx + 1}`;
      const requestCount = Math.max(0, Number(chunk?.requestCount || 0));
      const attemptCount = Math.max(0, Number(chunk?.attemptCount || 0));
      const requestPct = requestCount > 0 ? Math.max(3, Math.round((requestCount / maxValue) * 100)) : 0;
      const attemptPct = attemptCount > 0 ? Math.max(3, Math.round((attemptCount / maxValue) * 100)) : 0;
      const barTitle = `${label} | Logs: ${fmt(requestCount)} | Attempt-like: ${fmt(attemptCount)}`;
      return `
        <div class="ta-activity-col">
          <div class="ta-activity-bars" title="${escapeHtml(barTitle)}" aria-label="${escapeHtml(barTitle)}">
            <div class="ta-activity-bar ta-activity-bar-attempts" style="height: ${attemptPct}%"></div>
            <div class="ta-activity-bar ta-activity-bar-requests" style="height: ${requestPct}%"></div>
          </div>
          <div class="ta-activity-values">${escapeHtml(fmt(requestCount))} / ${escapeHtml(fmt(attemptCount))}</div>
          <div class="ta-activity-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        </div>
      `;
    }).join('');

    chunkChartModalTitleEl.textContent = String(options?.title || 'Activity Chart');
    chunkChartModalMetaEl.textContent = String(options?.subtitle || '-');
    chunkChartModalHostEl.innerHTML = `
      <div class="ta-activity-chart-shell">
        <div class="ta-activity-chart-legend">
          <span><i class="ta-legend-swatch ta-legend-requests"></i>Logs</span>
          <span><i class="ta-legend-swatch ta-legend-attempts"></i>Attempt-like</span>
          <span class="ms-auto">Scale Max: ${escapeHtml(fmt(maxValue))}</span>
        </div>
        <div class="ta-activity-chart-scroll">
          <div class="ta-activity-chart" style="--ta-chart-cols: ${rows.length};">
            ${columnsHtml}
          </div>
        </div>
      </div>
    `;
  }

  function openChunkChartModal(options = {}) {
    if (!chunkChartModal) return;
    const chunks = Array.isArray(options?.chunks) ? options.chunks : [];
    renderChunkActivityChart(chunks, {
      title: String(options?.title || 'Activity Chart'),
      subtitle: String(options?.subtitle || '')
    });
    chunkChartModal.show();
  }

  function updateTimelineViewButtons() {
    const isLine = state.viewMode === 'line';
    if (shadeViewBtnEl) {
      shadeViewBtnEl.className = isLine
        ? 'btn btn-outline-primary btn-sm'
        : 'btn btn-primary btn-sm';
      shadeViewBtnEl.setAttribute('aria-pressed', isLine ? 'false' : 'true');
    }
    if (lineViewBtnEl) {
      lineViewBtnEl.className = isLine
        ? 'btn btn-primary btn-sm'
        : 'btn btn-outline-primary btn-sm';
      lineViewBtnEl.setAttribute('aria-pressed', isLine ? 'true' : 'false');
    }
  }

  function getChunkDetailRow(label, chunk = {}) {
    const title = String(label || chunk?.label || 'Chunk').trim() || 'Chunk';
    return {
      label: title,
      requestCount: Number(chunk?.requestCount || 0),
      attemptCount: Number(chunk?.attemptCount || 0),
      startAt: String(chunk?.startAt || ''),
      endAt: String(chunk?.endAt || ''),
      startAtDisplay: String(chunk?.startAtDisplay || ''),
      endAtDisplay: String(chunk?.endAtDisplay || '')
    };
  }

  function getLineAxisLabel(label, index, totalRows) {
    const token = String(label || `#${index + 1}`).trim();
    const start = token.includes(' - ') ? token.split(' - ')[0] : token;
    if (start.length <= 14) return start;
    if (totalRows > 48) return start.slice(0, 5);
    return `${start.slice(0, 12)}...`;
  }

  function buildLineGraphRows(payload = null) {
    const rows = [];
    if (!payload || typeof payload !== 'object') return rows;

    if (payload.zoomLevel === 'hourly') {
      const days = Array.isArray(payload.dayTimelines) ? payload.dayTimelines : [];
      days.forEach((day) => {
        const chunks = Array.isArray(day?.chunks) ? day.chunks : [];
        chunks.forEach((chunk, index) => {
          const dayLabel = String(day?.label || day?.dateKey || 'Day').trim();
          const chunkLabel = String(chunk?.label || `${String(index).padStart(2, '0')}:00`).trim();
          const label = `${dayLabel} ${chunkLabel}`.trim();
          rows.push({
            label,
            axisLabel: getLineAxisLabel(`${String(day?.dateKey || dayLabel).slice(5)} ${chunkLabel}`, index, chunks.length),
            requestCount: Math.max(0, Number(chunk?.requestCount || 0)),
            attemptCount: Math.max(0, Number(chunk?.attemptCount || 0)),
            chunk,
            detailRow: getChunkDetailRow(label, chunk),
            focusDay: String(day?.dateKey || '').trim(),
            focusHour: Number(chunk?.hour ?? index),
            focusFiveMinute: -1,
            nextZoomLevel: '5m'
          });
        });
      });
      return rows;
    }

    const focusTimeline = payload.focusTimeline || {};
    const chunks = Array.isArray(focusTimeline?.chunks) ? focusTimeline.chunks : [];
    chunks.forEach((chunk, index) => {
      const focusTitle = String(focusTimeline?.title || 'Focused Timeline').trim();
      const chunkLabel = String(chunk?.label || `Chunk ${index + 1}`).trim();
      const label = `${focusTitle} ${chunkLabel}`.trim();
      rows.push({
        label,
        axisLabel: getLineAxisLabel(chunkLabel, index, chunks.length),
        requestCount: Math.max(0, Number(chunk?.requestCount || 0)),
        attemptCount: Math.max(0, Number(chunk?.attemptCount || 0)),
        chunk,
        detailRow: getChunkDetailRow(label, chunk),
        focusDay: state.focusDay,
        focusHour: state.focusHour,
        focusFiveMinute: payload.zoomLevel === '5m' ? index : state.focusFiveMinute,
        nextZoomLevel: payload.zoomLevel === '5m' ? '15s' : ''
      });
    });
    return rows;
  }

  function getNiceAxisMax(maxValue) {
    const raw = Math.max(1, Number(maxValue || 0));
    const roughStep = Math.max(1, Math.ceil(raw / 4));
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalized = roughStep / magnitude;
    let niceStep = 10;
    if (normalized <= 1) niceStep = 1;
    else if (normalized <= 2) niceStep = 2;
    else if (normalized <= 5) niceStep = 5;
    return niceStep * magnitude * 4;
  }

  function getLineTickIndexes(count, maxTicks = 8) {
    const total = Math.max(0, Number(count || 0));
    if (!total) return [];
    if (total === 1) return [0];
    const target = Math.min(total, maxTicks);
    const indexes = new Set();
    for (let i = 0; i < target; i += 1) {
      indexes.add(Math.round(((total - 1) * i) / (target - 1)));
    }
    indexes.add(0);
    indexes.add(total - 1);
    return Array.from(indexes).sort((a, b) => a - b);
  }

  function renderLineGraph(payload = null) {
    if (!lineGraphHostEl) return;
    const rows = buildLineGraphRows(payload);
    state.lineGraphRows = rows;

    if (!rows.length) {
      lineGraphHostEl.innerHTML = '<div class="ta-empty">No line graph data is available for selected filters.</div>';
      return;
    }

    const width = Math.max(760, rows.length * 38);
    const height = 340;
    const margin = { top: 28, right: 34, bottom: 66, left: 64 };
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = Math.max(1, height - margin.top - margin.bottom);
    const maxValue = getNiceAxisMax(rows.reduce((max, row) => Math.max(max, row.requestCount, row.attemptCount), 0));
    const yTicks = [0, maxValue * 0.25, maxValue * 0.5, maxValue * 0.75, maxValue];
    const xFor = (index) => margin.left + (rows.length === 1 ? plotWidth / 2 : (plotWidth * index) / (rows.length - 1));
    const yFor = (value) => margin.top + plotHeight - (clampNumber(value, 0, maxValue) / maxValue) * plotHeight;
    const requestPath = rows
      .map((row, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(2)} ${yFor(row.requestCount).toFixed(2)}`)
      .join(' ');
    const attemptPath = rows
      .map((row, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(2)} ${yFor(row.attemptCount).toFixed(2)}`)
      .join(' ');
    const baseY = margin.top + plotHeight;
    const fillPath = `${requestPath} L ${xFor(rows.length - 1).toFixed(2)} ${baseY.toFixed(2)} L ${xFor(0).toFixed(2)} ${baseY.toFixed(2)} Z`;
    const xTickIndexes = getLineTickIndexes(rows.length);
    const hasAttempts = rows.some((row) => row.attemptCount > 0);
    const title = payload?.zoomLevel === 'hourly'
      ? 'Hourly Activity Line'
      : `${String(payload?.focusTimeline?.title || 'Focused Timeline')} Line`;
    const subtitle = payload?.zoomLevel === 'hourly'
      ? `${fmt(rows.length)} hourly chunks across selected day(s)`
      : `${fmt(rows.length)} focus chunks in the current zoom level`;

    const yGridHtml = yTicks.map((tick) => {
      const y = yFor(tick);
      return `
        <line class="ta-line-grid-line" x1="${margin.left}" y1="${y.toFixed(2)}" x2="${width - margin.right}" y2="${y.toFixed(2)}"></line>
        <text class="ta-line-axis-number" x="${margin.left - 12}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(fmt(Math.round(tick)))}</text>
      `;
    }).join('');

    const xTickHtml = xTickIndexes.map((index) => {
      const x = xFor(index);
      const label = rows[index]?.axisLabel || String(index + 1);
      return `
        <line class="ta-line-grid-line" x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${baseY}"></line>
        <text class="ta-line-axis-number ta-line-axis-number-x" x="${x.toFixed(2)}" y="${height - 36}" text-anchor="middle">${escapeHtml(label)}</text>
      `;
    }).join('');

    const dotsHtml = rows.map((row, index) => {
      const x = xFor(index);
      const y = yFor(row.requestCount);
      const titleText = `${row.label} | Logs: ${fmt(row.requestCount)} | Attempt-like: ${fmt(row.attemptCount)}`;
      return `
        <circle
          class="ta-line-dot"
          cx="${x.toFixed(2)}"
          cy="${y.toFixed(2)}"
          r="4.8"
          tabindex="0"
          role="button"
          data-track-line-index="${index}"
          aria-label="${escapeHtml(titleText)}">
          <title>${escapeHtml(titleText)}</title>
        </circle>
      `;
    }).join('');

    lineGraphHostEl.innerHTML = `
      <div class="ta-line-card">
        <div class="ta-line-card-head">
          <div>
            <div class="ta-line-title">${escapeHtml(title)}</div>
            <div class="ta-line-subtitle">${escapeHtml(subtitle)}</div>
          </div>
          <div class="ta-line-legend" aria-label="Line graph legend">
            <span><i class="ta-line-swatch ta-line-swatch-logs"></i>Logs</span>
            ${hasAttempts ? '<span><i class="ta-line-swatch ta-line-swatch-attempts"></i>Attempt-like</span>' : ''}
            <span>Scale Max: ${escapeHtml(fmt(maxValue))}</span>
          </div>
        </div>
        <div class="ta-line-scroll">
          <svg class="ta-line-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
            <defs>
              <linearGradient id="taLineFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.45"></stop>
                <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.02"></stop>
              </linearGradient>
              <filter id="taLineGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#22d3ee" flood-opacity="0.75"></feDropShadow>
              </filter>
              <filter id="taLineGlowWarm" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#facc15" flood-opacity="0.65"></feDropShadow>
              </filter>
              <filter id="taLineDotGlow" x="-80%" y="-80%" width="260%" height="260%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#22d3ee" flood-opacity="0.95"></feDropShadow>
              </filter>
            </defs>
            ${yGridHtml}
            ${xTickHtml}
            <line class="ta-line-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${baseY}"></line>
            <line class="ta-line-axis" x1="${margin.left}" y1="${baseY}" x2="${width - margin.right}" y2="${baseY}"></line>
            <text class="ta-line-axis-title" x="${margin.left}" y="16">LOGS</text>
            <text class="ta-line-axis-title" x="${width - margin.right}" y="${height - 10}" text-anchor="end">TIME CHUNKS</text>
            <path class="ta-line-fill" d="${fillPath}"></path>
            ${hasAttempts ? `<path class="ta-line-path-attempts" d="${attemptPath}"></path>` : ''}
            <path class="ta-line-path" d="${requestPath}"></path>
            ${dotsHtml}
          </svg>
        </div>
        <div class="ta-line-note">Click a point to drill into the next timeline level. At the final zoom level, click a point to inspect the matching logs.</div>
      </div>
    `;
  }

  function renderActiveTimelineView(payload = null) {
    updateTimelineViewButtons();
    if (state.viewMode === 'line') {
      if (focusHostEl) {
        focusHostEl.classList.add('d-none');
        focusHostEl.innerHTML = '';
      }
      if (daysHostEl) daysHostEl.classList.add('d-none');
      if (lineGraphHostEl) {
        lineGraphHostEl.classList.remove('d-none');
        renderLineGraph(payload);
      }
      return;
    }

    state.lineGraphRows = [];
    if (lineGraphHostEl) {
      lineGraphHostEl.classList.add('d-none');
      lineGraphHostEl.innerHTML = '';
    }
    if (daysHostEl) daysHostEl.classList.remove('d-none');
    if (payload?.zoomLevel === 'hourly') {
      renderHourly(payload);
    } else {
      renderFocus(payload);
    }
  }

  function setTimelineViewMode(mode) {
    const nextMode = mode === 'line' ? 'line' : 'shade';
    if (state.viewMode === nextMode) {
      updateTimelineViewButtons();
      return;
    }
    state.viewMode = nextMode;
    try {
      window.localStorage?.setItem('trackActivityTimeline.viewMode', nextMode);
    } catch (error) {
      // Local storage can be unavailable in private browsing modes.
    }
    if (state.lastPayload) {
      renderSummaryChips(state.lastPayload);
      renderActiveTimelineView(state.lastPayload);
    } else {
      renderIdleState();
    }
  }

  function openLineGraphRow(row = null) {
    if (!row || typeof row !== 'object') return;
    if (row.nextZoomLevel === '5m' && row.focusDay && Number.isFinite(row.focusHour) && row.focusHour >= 0) {
      state.zoomLevel = '5m';
      state.focusDay = row.focusDay;
      state.focusHour = row.focusHour;
      state.focusFiveMinute = -1;
      loadTimeline();
      return;
    }
    if (row.nextZoomLevel === '15s' && Number.isFinite(row.focusFiveMinute) && row.focusFiveMinute >= 0) {
      state.zoomLevel = '15s';
      state.focusFiveMinute = row.focusFiveMinute;
      loadTimeline();
      return;
    }
    openSummaryChunkModal(row.detailRow || row.chunk || row);
  }

  function renderSummaryChips(payload = null) {
    if (!summaryEl) return;
    const dayCount = Array.isArray(payload?.dayTimelines) ? payload.dayTimelines.length : 0;
    const focusChunkCount = Array.isArray(payload?.focusTimeline?.chunks) ? payload.focusTimeline.chunks.length : 0;
    if (state.viewMode === 'line') {
      if (payload?.zoomLevel === 'hourly' && !dayCount) {
        summaryEl.innerHTML = '<span class="ta-hour-chip">No line graph data available for this range.</span>';
        return;
      }
      if (payload?.zoomLevel !== 'hourly' && !focusChunkCount) {
        summaryEl.innerHTML = '<span class="ta-hour-chip">No focus line graph data available.</span>';
        return;
      }
      summaryEl.innerHTML = '<span class="ta-hour-chip">Line graph view is active. Click a point to drill into the next timeline level.</span>';
      return;
    }
    if (payload?.zoomLevel === 'hourly') {
      if (!dayCount) {
        summaryEl.innerHTML = '<span class="ta-hour-chip">No chunk table available for this range.</span>';
        return;
      }
      summaryEl.innerHTML = '<span class="ta-hour-chip">Use "View Chunk Table" or "View Activity Chart" under each day timeline.</span>';
      return;
    }
    if (!focusChunkCount) {
      summaryEl.innerHTML = '<span class="ta-hour-chip">No focus chunk data available.</span>';
      return;
    }
    summaryEl.innerHTML = '<span class="ta-hour-chip">Use "View Focus Chunk Table" or "View Focus Activity Chart" under this timeline.</span>';
  }

  function updateModeBanner(payload = null) {
    if (!modeEl) return;
    const daysCount = Number(payload?.summary?.daysCount || 0);
    if (payload?.zoomLevel === '5m') {
      modeEl.textContent = `Zoom: 5-minute chunks - click any chunk to zoom into 15-second view.`;
      return;
    }
    if (payload?.zoomLevel === '15s') {
      modeEl.textContent = 'Zoom: 15-second chunks.';
      return;
    }
    modeEl.textContent = `Zoom: hourly - ${fmt(daysCount)} day timeline(s). Click any hour chunk to zoom in.`;
  }

  function updateZoomButtons() {
    const inZoom = state.zoomLevel !== 'hourly';
    if (backBtnEl) backBtnEl.classList.toggle('d-none', !inZoom);
    if (resetZoomBtnEl) resetZoomBtnEl.classList.toggle('d-none', !inZoom);
  }

  function renderChunkModalLoading(row = {}) {
    if (chunkModalTitleEl) {
      chunkModalTitleEl.textContent = `Chunk Activity - ${String(row?.label || 'Timeline')}`;
    }
    if (chunkModalMetaEl) {
      const start = formatLocalDateTime(row?.startAt || row?.startAtDisplay, { withSeconds: true });
      const end = formatLocalDateTime(row?.endAt || row?.endAtDisplay, { withSeconds: true });
      chunkModalMetaEl.textContent = `${start} to ${end}`;
    }
    if (chunkModalSummaryEl) {
      chunkModalSummaryEl.innerHTML = '<div class="alert alert-info py-2 px-3 mb-0">Loading events for this chunk...</div>';
    }
    if (chunkModalRowsEl) {
      chunkModalRowsEl.innerHTML = `
        <tr>
          <td colspan="9" class="text-center py-4">
            <div class="spinner-border spinner-border-sm text-primary me-2" role="status" aria-hidden="true"></div>
            Loading...
          </td>
        </tr>`;
    }
  }

  function renderChunkModalError(message = 'Failed to load details.') {
    if (chunkModalSummaryEl) {
      chunkModalSummaryEl.innerHTML = `<div class="alert alert-danger py-2 px-3 mb-0">${escapeHtml(message)}</div>`;
    }
    if (chunkModalRowsEl) {
      chunkModalRowsEl.innerHTML = `
        <tr>
          <td colspan="9" class="text-center text-danger py-3">${escapeHtml(message)}</td>
        </tr>`;
    }
  }

  function renderChunkModalRows(payload = {}, row = {}) {
    const summary = payload?.summary || {};
    const interval = payload?.interval || {};
    const sampleRows = Array.isArray(payload?.sampleRows) ? payload.sampleRows : [];

    if (chunkModalTitleEl) {
      chunkModalTitleEl.textContent = `Chunk Activity - ${String(row?.label || 'Timeline')}`;
    }
    if (chunkModalMetaEl) {
      const start = formatLocalDateTime(interval?.startAt || row?.startAt || interval?.startAtDisplay || row?.startAtDisplay, { withSeconds: true });
      const end = formatLocalDateTime(interval?.endAt || row?.endAt || interval?.endAtDisplay || row?.endAtDisplay, { withSeconds: true });
      chunkModalMetaEl.textContent = `${start} to ${end} | Local Time`;
    }
    if (chunkModalSummaryEl) {
      chunkModalSummaryEl.innerHTML = `
        <div class="d-flex flex-wrap gap-2">
          <span class="ta-hour-chip">Total: ${fmt(summary.totalEvents)}</span>
          <span class="ta-hour-chip">Success: ${fmt(summary.successCount)}</span>
          <span class="ta-hour-chip">Failure: ${fmt(summary.failureCount)}</span>
          <span class="ta-hour-chip">Users: ${fmt(summary.uniqueUserCount)}</span>
          <span class="ta-hour-chip">Requests: ${fmt(summary.uniqueRequestCount)}</span>
        </div>
      `;
    }

    if (!chunkModalRowsEl) return;
    if (!sampleRows.length) {
      chunkModalRowsEl.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">No events in this chunk.</td></tr>';
      return;
    }

    chunkModalRowsEl.innerHTML = sampleRows.map((event) => {
      const eventId = escapeHtml(event?.eventId || '');
      const timestamp = escapeHtml(formatLocalDateTime(event?.occurredAt || event?.occurredAtDisplay, { withSeconds: true }));
      const source = escapeHtml(event?.sourceLabel || event?.source || '-');
      const status = escapeHtml(event?.statusRaw || '-');
      const user = escapeHtml(event?.actorPrimary || event?.displayName || event?.username || event?.userId || 'User');
      const section = escapeHtml(event?.sectionName || event?.sectionId || '-');
      const operation = escapeHtml(event?.operationName || event?.operationId || '-');
      const requestId = escapeHtml(event?.requestId || '-');
      const summaryText = escapeHtml(event?.summary || '-');
      const actionStateId = resolveActionStateIdFromEvent(event);
      const actionStateIdEscaped = escapeHtml(actionStateId);
      const actionStateCell = actionStateId
        ? `<button
            type="button"
            class="btn btn-link btn-sm p-0 text-start font-monospace ta-action-state-link"
            data-track-open-action-state="${actionStateIdEscaped}"
            data-track-event-id="${eventId}"
            title="Open linked Action State details">
            ${actionStateIdEscaped}
          </button>`
        : '<span class="text-muted">-</span>';
      return `
        <tr class="ta-chunk-row" data-track-event-id="${eventId}" tabindex="0" role="button" aria-label="Open event details">
          <td>${timestamp}</td>
          <td>${source}</td>
          <td>${status}</td>
          <td>${user}</td>
          <td>${section}</td>
          <td>${operation}</td>
          <td class="font-monospace small">${requestId}</td>
          <td>${actionStateCell}</td>
          <td>${summaryText}</td>
        </tr>
      `;
    }).join('');
  }

  function renderEventModalLoading() {
    if (eventModalTitleEl) eventModalTitleEl.textContent = 'Event Detail';
    if (eventModalMetaEl) eventModalMetaEl.textContent = 'Loading event details...';
    if (eventModalSummaryEl) {
      eventModalSummaryEl.innerHTML = '<div class="alert alert-info py-2 px-3 mb-0">Loading selected event...</div>';
    }
    if (eventModalPayloadEl) eventModalPayloadEl.textContent = 'Loading...';
    if (eventModalActionSummaryEl) eventModalActionSummaryEl.textContent = 'Loading action-state data...';
    if (eventModalActionPayloadEl) eventModalActionPayloadEl.textContent = 'Loading...';
    if (eventModalLoadActionBtnEl) {
      eventModalLoadActionBtnEl.classList.add('d-none');
      eventModalLoadActionBtnEl.disabled = false;
    }
  }

  function renderEventModalError(message = 'Failed to load event details.') {
    if (eventModalTitleEl) eventModalTitleEl.textContent = 'Event Detail';
    if (eventModalMetaEl) eventModalMetaEl.textContent = '-';
    if (eventModalSummaryEl) {
      eventModalSummaryEl.innerHTML = `<div class="alert alert-danger py-2 px-3 mb-0">${escapeHtml(message)}</div>`;
    }
    if (eventModalPayloadEl) eventModalPayloadEl.textContent = '-';
    if (eventModalActionSummaryEl) eventModalActionSummaryEl.textContent = 'Action State details are unavailable.';
    if (eventModalActionPayloadEl) eventModalActionPayloadEl.textContent = '-';
    if (eventModalLoadActionBtnEl) {
      eventModalLoadActionBtnEl.classList.add('d-none');
      eventModalLoadActionBtnEl.disabled = false;
    }
  }

  function renderEventModal(payload = {}) {
    const event = payload?.event || {};
    const sourceLabel = String(event?.sourceLabel || event?.source || 'Log').trim() || 'Log';
    const occurredAt = formatLocalDateTime(event?.occurredAt || event?.occurredAtDisplay, { withSeconds: true });
    const summaryText = String(event?.summary || '-').trim() || '-';
    const requestId = String(event?.requestId || '-').trim() || '-';
    const actor = String(event?.actorPrimary || event?.displayName || event?.username || event?.userId || 'User').trim();
    const section = String(event?.sectionName || event?.sectionId || '-').trim() || '-';
    const operation = String(event?.operationName || event?.operationId || '-').trim() || '-';
    const statusText = String(event?.statusRaw || '-').trim() || '-';
    const actionStateId = resolveActionStateIdFromEvent(event);
    const actionStateStatus = String(event?.actionState?.statusRaw || '-').trim() || '-';

    state.currentActionStateId = actionStateId;

    if (eventModalTitleEl) {
      eventModalTitleEl.textContent = `${sourceLabel} Event Detail`;
    }
    if (eventModalMetaEl) {
      eventModalMetaEl.textContent = `${occurredAt} | Request: ${requestId}`;
    }
    if (eventModalSummaryEl) {
      eventModalSummaryEl.innerHTML = `
        <div class="d-flex flex-wrap gap-2">
          <span class="ta-hour-chip">Status: ${escapeHtml(statusText)}</span>
          <span class="ta-hour-chip">User: ${escapeHtml(actor || '-')}</span>
          <span class="ta-hour-chip">Section: ${escapeHtml(section)}</span>
          <span class="ta-hour-chip">Operation: ${escapeHtml(operation)}</span>
          <span class="ta-hour-chip">Source: ${escapeHtml(sourceLabel)}</span>
        </div>
        <div class="small text-muted mt-2">${escapeHtml(summaryText)}</div>
      `;
    }

    if (eventModalPayloadEl) {
      eventModalPayloadEl.textContent = toPrettyJson(event?.details || {});
    }

    if (!actionStateId) {
      if (eventModalActionSummaryEl) {
        eventModalActionSummaryEl.textContent = 'No Action State linked to this log event.';
      }
      if (eventModalActionPayloadEl) {
        eventModalActionPayloadEl.textContent = '-';
      }
      if (eventModalLoadActionBtnEl) {
        eventModalLoadActionBtnEl.classList.add('d-none');
        eventModalLoadActionBtnEl.disabled = false;
      }
      return;
    }

    if (eventModalActionSummaryEl) {
      eventModalActionSummaryEl.innerHTML = `
        <div class="mb-1">
          Linked Action State:
          <span class="font-monospace fw-semibold">${escapeHtml(actionStateId)}</span>
        </div>
        <div class="x-small text-muted">Status: ${escapeHtml(actionStateStatus)}</div>
      `;
    }
    if (eventModalActionPayloadEl) {
      eventModalActionPayloadEl.textContent = toPrettyJson(event?.actionState?.details || event?.actionState || {});
    }
    if (eventModalLoadActionBtnEl) {
      eventModalLoadActionBtnEl.classList.remove('d-none');
      eventModalLoadActionBtnEl.disabled = false;
    }
  }

  async function loadFullActionStateDetails(actionStateId) {
    const token = normalizeIdToken(actionStateId, 180);
    if (!token || !eventModalLoadActionBtnEl || !eventModalActionPayloadEl || !eventModalActionSummaryEl) return;

    eventModalLoadActionBtnEl.disabled = true;
    const originalHtml = eventModalLoadActionBtnEl.innerHTML;
    eventModalLoadActionBtnEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Loading...';
    eventModalActionSummaryEl.innerHTML = `Loading full Action State record for <span class="font-monospace">${escapeHtml(token)}</span>...`;

    try {
      const response = await fetch(`/actionStates/details/${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: {
          'X-AJAX-Request': 'true',
          Accept: 'application/json'
        },
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status === 'error') {
        throw new Error(payload.message || 'Failed to load Action State details.');
      }

      const record = payload?.record || {};
      const meta = payload?.meta || {};
      const snapshot = {
        record: {
          id: record?.id || token,
          status: record?.status || '',
          sectionId: record?.sectionId || '',
          operationId: record?.operationId || '',
          targetKey: record?.targetKey || '',
          startedAt: record?.startedAt || '',
          updatedAt: record?.updatedAt || '',
          attemptCount: Number(record?.attemptCount || 0),
          volumeUsageKB: Number(record?.volumeUsageKB || 0)
        },
        meta: {
          userName: meta?.userName || '',
          username: meta?.username || '',
          requestId: meta?.requestId || '',
          sectionName: meta?.sectionName || '',
          opName: meta?.opName || ''
        },
        changeEvents: Array.isArray(payload?.changeEvents) ? payload.changeEvents : [],
        decryptedPayload: payload?.decryptedPayload || null
      };

      eventModalActionSummaryEl.innerHTML = `
        Full Action State Loaded:
        <span class="font-monospace fw-semibold">${escapeHtml(token)}</span>
      `;
      eventModalActionPayloadEl.textContent = toPrettyJson(snapshot);
    } catch (error) {
      eventModalActionSummaryEl.innerHTML = `<span class="text-danger">${escapeHtml(error.message || 'Failed to load Action State details.')}</span>`;
      eventModalActionPayloadEl.textContent = '-';
    } finally {
      eventModalLoadActionBtnEl.disabled = false;
      eventModalLoadActionBtnEl.innerHTML = originalHtml;
    }
  }

  function showEventModalFromChunk() {
    if (!eventModal) return;
    if (!chunkModalEl || !chunkModal || !chunkModalEl.classList.contains('show')) {
      eventModal.show();
      return;
    }
    const onHidden = () => {
      eventModal.show();
    };
    chunkModalEl.addEventListener('hidden.bs.modal', onHidden, { once: true });
    chunkModal.hide();
  }

  async function openEventDetailModal(eventId, options = {}) {
    const eventToken = normalizeIdToken(eventId, 260);
    const preferredActionStateId = normalizeIdToken(options?.actionStateId, 180);
    const autoLoadActionState = options?.autoLoadActionState === true;
    if (!eventToken || !eventModal) return;

    showEventModalFromChunk();
    renderEventModalLoading();

    try {
      const params = getFormParams();
      params.delete('page');
      params.set('kind', 'event');
      params.set('eventId', eventToken);
      const response = await fetch(`/security/track-activity/details?${params.toString()}`, {
        method: 'GET',
        headers: {
          'X-AJAX-Request': 'true',
          Accept: 'application/json'
        },
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status === 'error' || payload.found === false) {
        throw new Error(payload.message || 'Failed to load event details.');
      }
      renderEventModal(payload);
      if (autoLoadActionState) {
        const actionStateId = preferredActionStateId || state.currentActionStateId;
        if (actionStateId) {
          loadFullActionStateDetails(actionStateId);
        }
      }
    } catch (error) {
      renderEventModalError(error.message || 'Failed to load event details.');
    }
  }

  async function openSummaryChunkModal(row = {}) {
    if (!chunkModal) return;
    const startAt = String(row?.startAt || '').trim();
    const endAt = String(row?.endAt || '').trim();
    if (!startAt || !endAt) return;

    chunkModal.show();
    renderChunkModalLoading(row);

    try {
      const params = getFormParams();
      params.delete('page');
      params.set('kind', 'interval');
      params.set('bucketStartAt', startAt);
      params.set('bucketEndAt', endAt);
      const response = await fetch(`/security/track-activity/details?${params.toString()}`, {
        method: 'GET',
        headers: {
          'X-AJAX-Request': 'true',
          Accept: 'application/json'
        },
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status === 'error') {
        throw new Error(payload.message || 'Failed to load chunk details.');
      }
      renderChunkModalRows(payload, row);
    } catch (error) {
      renderChunkModalError(error.message || 'Failed to load chunk details.');
    }
  }

  function initChunkModalRowClick() {
    if (!chunkModalRowsEl) return;

    chunkModalRowsEl.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-track-open-action-state]');
      if (actionBtn) {
        event.preventDefault();
        event.stopPropagation();
        const eventId = normalizeIdToken(actionBtn.getAttribute('data-track-event-id'), 260);
        const actionStateId = normalizeIdToken(actionBtn.getAttribute('data-track-open-action-state'), 180);
        if (!eventId) return;
        openEventDetailModal(eventId, { actionStateId, autoLoadActionState: true });
        return;
      }

      const row = event.target.closest('[data-track-event-id]');
      if (!row) return;
      const eventId = normalizeIdToken(row.getAttribute('data-track-event-id'), 260);
      if (!eventId) return;
      openEventDetailModal(eventId);
    });

    chunkModalRowsEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('[data-track-event-id]');
      if (!row) return;
      if (event.target.closest('[data-track-open-action-state]')) return;
      event.preventDefault();
      const eventId = normalizeIdToken(row.getAttribute('data-track-event-id'), 260);
      if (!eventId) return;
      openEventDetailModal(eventId);
    });
  }

  function initChunkTableCellClick() {
    if (!chunkTableModalHostEl) return;
    chunkTableModalHostEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-track-chunk-detail-index]');
      if (!button) return;
      const idx = Number.parseInt(String(button.getAttribute('data-track-chunk-detail-index') || ''), 10);
      if (!Number.isFinite(idx) || idx < 0) return;
      const rows = Array.isArray(state.chunkTableOpenRows) ? state.chunkTableOpenRows : [];
      const row = rows[idx];
      if (!row) return;
      openSummaryChunkModalFromChunkTable(row);
    });
  }

  function initSummaryBadgeClick() {
    if (!summaryEl) return;
    summaryEl.addEventListener('click', (event) => {
      const badge = event.target.closest('[data-summary-row-index]');
      if (!badge) return;
      const idx = Number.parseInt(String(badge.getAttribute('data-summary-row-index') || ''), 10);
      if (!Number.isFinite(idx) || idx < 0) return;
      const row = Array.isArray(state.summaryRows) ? state.summaryRows[idx] : null;
      if (!row) return;
      openSummaryChunkModal(row);
    });
  }

  function initRangeShortcuts() {
    if (!rangeShortcutsEl) return;
    rangeShortcutsEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-range-shortcut]');
      if (!button) return;
      const token = String(button.getAttribute('data-range-shortcut') || '').trim();
      if (!token) return;
      setDateRangeShortcut(token);
    });
  }

  function runTimelineForNewFilters() {
    state.zoomLevel = 'hourly';
    state.focusDay = '';
    state.focusHour = -1;
    state.focusFiveMinute = -1;
    loadTimeline();
  }

  function renderHourly(payload = null) {
    if (focusHostEl) {
      focusHostEl.classList.add('d-none');
      focusHostEl.innerHTML = '';
    }

    const dayTimelines = Array.isArray(payload?.dayTimelines) ? payload.dayTimelines : [];
    if (!daysHostEl) return;

    if (!dayTimelines.length) {
      daysHostEl.innerHTML = '<div class="ta-empty">No logs found for selected filters.</div>';
      return;
    }

    daysHostEl.innerHTML = '';
    dayTimelines.forEach((day) => {
      const dayChunks = Array.isArray(day?.chunks) ? day.chunks : [];
      const card = buildTimelineCard({
        title: day?.label || day?.dateKey || 'Day',
        meta: `${fmt(day?.totalRequests)} logs | ${fmt(day?.totalAttempts)} attempts`,
        rangeStart: '00:00',
        rangeEnd: '23:59',
        cols: 24,
        chunks: dayChunks,
        axis: ['00:00', '06:00', '12:00', '18:00', '23:59'],
        onClick: (chunk) => {
          state.zoomLevel = '5m';
          state.focusDay = String(day?.dateKey || '').trim();
          state.focusHour = Number(chunk?.hour ?? -1);
          state.focusFiveMinute = -1;
          loadTimeline();
        },
        onOpenChunkTable: () => {
          openChunkTableModal({
            title: `${String(day?.label || day?.dateKey || 'Day')} - Chunk Table`,
            subtitle: `${fmt(day?.totalRequests)} requests | ${fmt(day?.totalAttempts)} attempt-like`,
            chunks: dayChunks
          });
        },
        onOpenChunkChart: () => {
          openChunkChartModal({
            title: `${String(day?.label || day?.dateKey || 'Day')} - Activity Chart`,
            subtitle: `${fmt(day?.totalRequests)} requests | ${fmt(day?.totalAttempts)} attempt-like`,
            chunks: dayChunks
          });
        }
      });
      daysHostEl.appendChild(card);
    });
  }

  function renderFocus(payload = null) {
    const focusTimeline = payload?.focusTimeline;
    if (!focusHostEl || !daysHostEl) return;

    if (!focusTimeline || !Array.isArray(focusTimeline.chunks)) {
      renderHourly(payload);
      return;
    }

    daysHostEl.innerHTML = '';
    focusHostEl.classList.remove('d-none');
    focusHostEl.innerHTML = '';

    let rangeStart = '00:00';
    let rangeEnd = '00:00';
    if (focusTimeline.zoomLevel === '5m') {
      rangeStart = `${String(state.focusHour).padStart(2, '0')}:00`;
      rangeEnd = `${String(state.focusHour).padStart(2, '0')}:59`;
    } else if (focusTimeline.zoomLevel === '15s') {
      const baseMinute = (Number(state.focusFiveMinute || 0) * 5);
      rangeStart = `${String(state.focusHour).padStart(2, '0')}:${String(baseMinute).padStart(2, '0')}:00`;
      rangeEnd = `${String(state.focusHour).padStart(2, '0')}:${String(baseMinute + 4).padStart(2, '0')}:59`;
    }

    const card = buildTimelineCard({
      title: String(focusTimeline.title || 'Focused Timeline'),
      meta: String(focusTimeline.subtitle || ''),
      rangeStart,
      rangeEnd,
      cols: focusTimeline.chunks.length,
      chunks: focusTimeline.chunks,
      axis: createAxisLabels(focusTimeline.chunks),
      isFocus: true,
      chunkTableButtonLabel: 'View Focus Chunk Table',
      chunkChartButtonLabel: 'View Focus Activity Chart',
      onClick: focusTimeline.zoomLevel === '5m'
        ? (chunk, index) => {
          state.zoomLevel = '15s';
          state.focusFiveMinute = Number(index);
          loadTimeline();
        }
        : null,
      onOpenChunkTable: () => {
        const totalRequests = (Array.isArray(focusTimeline.chunks) ? focusTimeline.chunks : [])
          .reduce((sum, row) => sum + Number(row?.requestCount || 0), 0);
        const totalAttempts = (Array.isArray(focusTimeline.chunks) ? focusTimeline.chunks : [])
          .reduce((sum, row) => sum + Number(row?.attemptCount || 0), 0);
        openChunkTableModal({
          title: `${String(focusTimeline.title || 'Focused Timeline')} - Chunk Table`,
          subtitle: `${fmt(totalRequests)} requests | ${fmt(totalAttempts)} attempt-like`,
          chunks: Array.isArray(focusTimeline.chunks) ? focusTimeline.chunks : []
        });
      },
      onOpenChunkChart: () => {
        const totalRequests = (Array.isArray(focusTimeline.chunks) ? focusTimeline.chunks : [])
          .reduce((sum, row) => sum + Number(row?.requestCount || 0), 0);
        const totalAttempts = (Array.isArray(focusTimeline.chunks) ? focusTimeline.chunks : [])
          .reduce((sum, row) => sum + Number(row?.attemptCount || 0), 0);
        openChunkChartModal({
          title: `${String(focusTimeline.title || 'Focused Timeline')} - Activity Chart`,
          subtitle: `${fmt(totalRequests)} requests | ${fmt(totalAttempts)} attempt-like`,
          chunks: Array.isArray(focusTimeline.chunks) ? focusTimeline.chunks : []
        });
      }
    });

    focusHostEl.appendChild(card);
  }

  function applyPayload(payload = null) {
    state.lastPayload = payload || null;
    setCards(payload?.summary || {}, payload);
    renderSummaryChips(payload);
    updateModeBanner(payload);
    updateZoomButtons();

    renderActiveTimelineView(payload);

    const timezone = String(payload?.timezone || 'UTC');
    const startAt = formatLocalDateTime(payload?.filters?.startAt, { withSeconds: true });
    const endAt = formatLocalDateTime(payload?.filters?.endAt, { withSeconds: true });
    if (metaEl) {
      metaEl.textContent = `${startAt} to ${endAt} | Local Time (server tz: ${timezone})`;
    }

    if (payload?.range?.rangeTrimmed) {
      showAlert(`Date range was trimmed to ${maxRangeDays} days.`, 'info');
    }
  }

  function validateRangeHint() {
    if (!startInputEl || !endInputEl) return;
    const startMs = new Date(startInputEl.value).getTime();
    const endMs = new Date(endInputEl.value).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    const days = (endMs - startMs) / (24 * 60 * 60 * 1000);
    if (days > maxRangeDays) {
      showAlert(`Selected range is over ${maxRangeDays} days. The server will trim it.`, 'info');
    }
  }

  async function loadTimeline() {
    clearAlert();
    validateRangeHint();

    if (modeEl) modeEl.textContent = 'Loading timeline...';
    renderEmpty('Loading activity timeline...');

    try {
      const params = getFormParams();
      const response = await fetch(`/security/track-activity/data?${params.toString()}`, {
        method: 'GET',
        headers: {
          'X-AJAX-Request': 'true',
          Accept: 'application/json'
        },
        credentials: 'include'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status === 'error') {
        throw new Error(payload.message || 'Failed to load timeline.');
      }

      applyPayload(payload);
    } catch (error) {
      renderEmpty(error.message || 'Failed to load timeline.');
      showAlert(error.message || 'Failed to load timeline.', 'danger');
    }
  }

  function initAdvancedToggle() {
    const collapseEl = document.getElementById('trackActivityAdvancedCollapse');
    const iconEl = document.getElementById('trackActivityAdvancedToggleIcon');
    const buttonEl = document.getElementById('trackActivityAdvancedToggleBtn');
    if (!collapseEl || !iconEl || !buttonEl) return;

    const setState = (expanded) => {
      iconEl.classList.remove('bi-chevron-down', 'bi-chevron-up');
      iconEl.classList.add(expanded ? 'bi-chevron-up' : 'bi-chevron-down');
      buttonEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    };

    setState(collapseEl.classList.contains('show'));
    collapseEl.addEventListener('shown.bs.collapse', () => setState(true));
    collapseEl.addEventListener('hidden.bs.collapse', () => setState(false));
  }

  function initUserPicker() {
    if (!canPickUsers) return;
    if (!window.GenericPicker || !window.GenericPickerPresets) return;
    if (!pickUserBtn || !userIdInput || !userSummaryInput) return;

    pickUserBtn.addEventListener('click', () => {
      window.GenericPicker.open(window.GenericPickerPresets.user({
        title: 'Select Target User',
        icon: 'bi-people',
        apiEndpoint: '/security/track-activity/users',
        searchFields: 'id,username,email,name',
        placeholder: 'Search users by id, username, or email...',
        multiselect: false,
        onSelect: (item) => {
          if (!item || typeof item !== 'object') return;
          const id = String(item.id || '').trim();
          const label = String(item.name || item.username || item.email || id).trim() || id;
          if (!id) return;
          userIdInput.value = id;
          userSummaryInput.value = label;
        }
      }));
    });

    if (resetUserBtn) {
      resetUserBtn.addEventListener('click', () => {
        userIdInput.value = defaultUserId;
        userSummaryInput.value = defaultUserLabel;
      });
    }
  }

  function initFilterPickers() {
    Object.keys(filterPickerConfig).forEach((fieldName) => {
      state.filterSelections[fieldName] = buildInitialFilterSelection(fieldName);
      renderFilterField(fieldName);
    });

    if (!window.GenericPicker || !window.GenericPickerPresets) return;

    Object.keys(filterPickerConfig).forEach((fieldName) => {
      const cfg = filterPickerConfig[fieldName];
      if (!cfg) return;

      if (cfg.pickBtnEl) {
        cfg.pickBtnEl.addEventListener('click', () => {
          const pickerConfig = cfg.preset ? cfg.preset() : null;
          if (!pickerConfig) return;
          pickerConfig.multiselect = true;
          pickerConfig.onSelect = (items) => {
            upsertFilterItems(fieldName, items);
          };
          window.GenericPicker.open(pickerConfig);
        });
      }

      if (cfg.clearBtnEl) {
        cfg.clearBtnEl.addEventListener('click', () => {
          clearFilterField(fieldName);
        });
      }
    });

    form.addEventListener('click', (event) => {
      const sectionRemoveBtn = event.target.closest('[data-track-remove-section]');
      if (sectionRemoveBtn) {
        removeFilterItem('sections', sectionRemoveBtn.getAttribute('data-track-remove-section'));
        return;
      }
      const operationRemoveBtn = event.target.closest('[data-track-remove-operation]');
      if (operationRemoveBtn) {
        removeFilterItem('operations', operationRemoveBtn.getAttribute('data-track-remove-operation'));
        return;
      }
      const orgRemoveBtn = event.target.closest('[data-track-remove-org]');
      if (orgRemoveBtn) {
        removeFilterItem('orgs', orgRemoveBtn.getAttribute('data-track-remove-org'));
      }
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runTimelineForNewFilters();
  });

  if (backBtnEl) {
    backBtnEl.addEventListener('click', () => {
      if (state.zoomLevel === '15s') {
        state.zoomLevel = '5m';
        state.focusFiveMinute = -1;
      } else {
        state.zoomLevel = 'hourly';
        state.focusDay = '';
        state.focusHour = -1;
        state.focusFiveMinute = -1;
      }
      loadTimeline();
    });
  }

  if (resetZoomBtnEl) {
    resetZoomBtnEl.addEventListener('click', () => {
      state.zoomLevel = 'hourly';
      state.focusDay = '';
      state.focusHour = -1;
      state.focusFiveMinute = -1;
      loadTimeline();
    });
  }

  if (shadeViewBtnEl) {
    shadeViewBtnEl.addEventListener('click', () => setTimelineViewMode('shade'));
  }

  if (lineViewBtnEl) {
    lineViewBtnEl.addEventListener('click', () => setTimelineViewMode('line'));
  }

  if (lineGraphHostEl) {
    lineGraphHostEl.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const trigger = target ? target.closest('[data-track-line-index]') : null;
      if (!trigger) return;
      const index = Number(trigger.getAttribute('data-track-line-index'));
      if (!Number.isInteger(index) || index < 0) return;
      openLineGraphRow(state.lineGraphRows[index]);
    });
    lineGraphHostEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target instanceof Element ? event.target : null;
      const trigger = target ? target.closest('[data-track-line-index]') : null;
      if (!trigger) return;
      event.preventDefault();
      const index = Number(trigger.getAttribute('data-track-line-index'));
      if (!Number.isInteger(index) || index < 0) return;
      openLineGraphRow(state.lineGraphRows[index]);
    });
  }

  if (eventModalLoadActionBtnEl) {
    eventModalLoadActionBtnEl.addEventListener('click', () => {
      if (!state.currentActionStateId) return;
      loadFullActionStateDetails(state.currentActionStateId);
    });
  }

  initAdvancedToggle();
  initFilterPickers();
  initUserPicker();
  initRangeShortcuts();
  initSummaryBadgeClick();
  initChunkModalRowClick();
  initChunkTableCellClick();
  renderIdleState();
});
