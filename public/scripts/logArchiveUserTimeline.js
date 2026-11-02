/**
 * Local archive — per-user filtered occurrences (table + batched equal-spaced timeline).
 */
(function () {
  const cfg = window.__LOG_ARCHIVE_USER_TIMELINE__ || {};
  const Range = window.LogArchiveAnalyzerRange || {};
  const TimelineCore = window.LogArchiveUserTimelineCore || {};
  const LocalSession = window.LogArchiveLocalSession || null;
  const Staging = window.LogArchiveStaging || null;
  const ArchiveLocal = window.TrackActivityArchiveLocal || null;

  const bannerEl = document.getElementById('logArchiveUserTimelineBanner');
  const bannerMetaEl = document.getElementById('logArchiveUserTimelineBannerMeta');
  const userSelectEl = document.getElementById('logArchiveUserTimelineUserSelect');
  const sectionSelectEl = document.getElementById('logArchiveUserTimelineSectionSelect');
  const operationSelectEl = document.getElementById('logArchiveUserTimelineOperationSelect');
  const startDateEl = document.getElementById('logArchiveUserTimelineStartDate');
  const endDateEl = document.getElementById('logArchiveUserTimelineEndDate');
  const applyBtn = document.getElementById('logArchiveUserTimelineApplyBtn');
  const statusEl = document.getElementById('logArchiveUserTimelineStatus');
  const resultsCardEl = document.getElementById('logArchiveUserTimelineResultsCard');
  const resultsTbodyEl = document.getElementById('logArchiveUserTimelineResultsTbody');
  const batchesEl = document.getElementById('logArchiveUserTimelineBatches');
  const tooltipEl = document.getElementById('logArchiveUserTimelineTooltip');
  const detailModalEl = document.getElementById('logArchiveUserTimelineDetailModal');
  const detailTitleEl = document.getElementById('logArchiveUserTimelineDetailTitle');
  const detailSummaryEl = document.getElementById('logArchiveUserTimelineDetailSummary');
  const detailTableHostEl = document.getElementById('logArchiveUserTimelineDetailTableHost');
  const detailActionBlockEl = document.getElementById('logArchiveUserTimelineDetailActionBlock');
  const detailActionTableHostEl = document.getElementById('logArchiveUserTimelineDetailActionTableHost');
  const enlargeModalEl = document.getElementById('logArchiveUserTimelineEnlargeModal');
  const enlargeTitleEl = document.getElementById('logArchiveUserTimelineEnlargeTitle');
  const enlargeChartHostEl = document.getElementById('logArchiveUserTimelineEnlargeChartHost');

  const windowDays = Math.max(1, Number(cfg.windowDays || TimelineCore.WINDOW_DAYS || 3));
  const pageTimezone = String(cfg.timezone || 'UTC').trim() || 'UTC';
  const CHART_FIXED_HEIGHT = 320;
  const CHART_PAD_TOP = 44;
  const CHART_PAD_BOTTOM = 32;
  const CHART_DAY_COL_WIDTH = 240;
  const CHART_ENLARGE_MIN_GAP = 52;
  const CHART_ENLARGE_COL_WIDTH = 520;

  const state = {
    session: null,
    events: [],
    eventsById: new Map(),
    filterCatalog: { sections: [], operationsBySection: {} },
    lookups: { sections: [], operations: [] },
    reportStartDate: '',
    reportEndDate: '',
    loading: false,
    pendingEnlargeDayCol: null
  };

  let detailModal = null;
  let enlargeModal = null;

  function ensureDetailModal() {
    if (detailModal) return detailModal;
    if (detailModalEl && window.bootstrap?.Modal) {
      detailModal = new window.bootstrap.Modal(detailModalEl);
    }
    return detailModal;
  }

  function ensureEnlargeModal() {
    if (enlargeModal) return enlargeModal;
    if (enlargeModalEl && window.bootstrap?.Modal) {
      enlargeModal = new window.bootstrap.Modal(enlargeModalEl);
    }
    return enlargeModal;
  }

  function maxOpenModalZIndex() {
    let maxZ = 1050;
    document.querySelectorAll('.modal.show').forEach((el) => {
      const z = parseInt(window.getComputedStyle(el).zIndex, 10);
      if (Number.isFinite(z) && z > maxZ) maxZ = z;
    });
    return maxZ;
  }

  function raiseModalStack(modalEl) {
    if (!modalEl) return 0;
    const nextZ = maxOpenModalZIndex() + 20;
    modalEl.style.zIndex = String(nextZ);
    return nextZ;
  }

  function syncTopBackdropZIndex(modalZ) {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    if (!backdrops.length || !Number.isFinite(modalZ)) return;
    backdrops[backdrops.length - 1].style.zIndex = String(modalZ - 10);
  }

  function bindDetailModalStacking() {
    if (!detailModalEl || detailModalEl.dataset.stackBound === '1') return;
    detailModalEl.dataset.stackBound = '1';
    detailModalEl.addEventListener('show.bs.modal', () => {
      raiseModalStack(detailModalEl);
    });
    detailModalEl.addEventListener('shown.bs.modal', () => {
      const modalZ = parseInt(window.getComputedStyle(detailModalEl).zIndex, 10);
      syncTopBackdropZIndex(modalZ);
    });
    detailModalEl.addEventListener('hidden.bs.modal', () => {
      detailModalEl.style.zIndex = '';
    });
  }

  function cleanText(value, max) {
    const text = String(value == null ? '' : value).trim();
    const cap = Number(max) > 0 ? Number(max) : 500;
    return text.length > cap ? text.slice(0, cap) : text;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveLocalSessionIdFromPage() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = String(
      params.get('localSession')
      || params.get('session')
      || params.get('sessionId')
      || ''
    ).trim();
    if (fromUrl) return fromUrl;
    return LocalSession?.getActiveSessionId?.() || '';
  }

  function sessionTimezone(session) {
    return cleanText(
      session?.manifest?.timezone
      || session?.reportSetup?.timezone
      || pageTimezone,
      80
    ) || pageTimezone;
  }

  function reportRangeFromSession(session) {
    const report = session?.reportSetup || {};
    const manifest = session?.manifest?.reportRange || {};
    return {
      startDate: cleanText(report.startDate || manifest.startDate, 10),
      endDate: cleanText(report.endDate || manifest.endDate, 10)
    };
  }

  function allowedUserIdSet(session) {
    if (ArchiveLocal && typeof ArchiveLocal.allowedUserIdSet === 'function') {
      return ArchiveLocal.allowedUserIdSet(session);
    }
    const ids = session?.reportSetup?.userIds;
    if (Array.isArray(ids) && ids.length) {
      return new Set(ids.map((id) => cleanText(id, 120)).filter(Boolean));
    }
    return null;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = String(text || '');
  }

  function lookupName(rows, id) {
    const token = cleanText(id, 120);
    if (!token) return '';
    const row = (Array.isArray(rows) ? rows : []).find((r) => cleanText(r?.id, 120) === token);
    return cleanText(row?.name || row?.label || row?.title || token, 180) || token;
  }

  function showBanner(session) {
    if (!bannerEl) return;
    bannerEl.classList.remove('d-none');
    const range = reportRangeFromSession(session);
    const exportId = cleanText(session?.manifest?.exportId, 120) || 'archive';
    if (bannerMetaEl) {
      bannerMetaEl.textContent = `Report ${range.startDate || '—'} to ${range.endDate || '—'} · Export ${exportId} · Timezone ${sessionTimezone(session)}`;
    }
  }

  function setSelectOptions(selectEl, placeholder, options, selectedValue) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholder;
    selectEl.appendChild(ph);
    (options || []).forEach((entry) => {
      const id = cleanText(entry?.id || entry, 120);
      if (!id) return;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = cleanText(entry?.label || id, 200);
      selectEl.appendChild(opt);
    });
    if (selectedValue) selectEl.value = selectedValue;
  }

  function populateUserSelect(userOptions) {
    if (!userSelectEl) return;
    const options = Array.isArray(userOptions) ? userOptions : [];
    if (!options.length) {
      userSelectEl.disabled = true;
      setSelectOptions(userSelectEl, 'No users found in archive', []);
      return;
    }
    userSelectEl.disabled = false;
    const reportUsers = state.session?.reportSetup?.selectedUsers || [];
    const enriched = options.map((entry) => {
      const id = cleanText(entry?.id || entry, 120);
      const fromReport = reportUsers.find((u) => u.id === id);
      const label = cleanText(entry?.label || fromReport?.label || fromReport?.name || id, 180);
      return { id, label: label === id ? label : `${label} (${id})` };
    });
    setSelectOptions(userSelectEl, 'Select a user…', enriched);
  }

  async function loadUserOptions(session) {
    const backend = session.storageBackend || session.manifest?.storageBackend;
    const allowed = allowedUserIdSet(session);
    const allowedList = allowed ? Array.from(allowed) : null;
    if (session.staging && Staging?.collectArchiveUsers) {
      return Staging.collectArchiveUsers(session.id, backend, allowedList);
    }
    if (ArchiveLocal?.deriveLocalUserPickerItems) {
      const pseudo = { ...session, logs: session.logs || [] };
      return ArchiveLocal.deriveLocalUserPickerItems(pseudo);
    }
    return [];
  }

  function reportRangeBoundsMs() {
    const tz = sessionTimezone(state.session);
    if (!Range.resolveArchiveRangeBoundsMs || !state.reportStartDate || !state.reportEndDate) {
      return { dayStartMs: 0, dayEndMs: 0 };
    }
    return Range.resolveArchiveRangeBoundsMs(state.reportStartDate, state.reportEndDate, tz);
  }

  function selectedFilterBoundsMs() {
    const tz = sessionTimezone(state.session);
    const startDate = cleanText(startDateEl?.value, 10);
    const endDate = cleanText(endDateEl?.value, 10);
    if (!Range.resolveArchiveRangeBoundsMs || !startDate || !endDate) {
      return { dayStartMs: 0, dayEndMs: 0, startDate, endDate };
    }
    const bounds = Range.resolveArchiveRangeBoundsMs(startDate, endDate, tz);
    return { ...bounds, startDate, endDate };
  }

  function enableFilterControls(enabled) {
    const on = Boolean(enabled);
    if (startDateEl) startDateEl.disabled = !on;
    if (endDateEl) endDateEl.disabled = !on;
    updateApplyButtonState();
  }

  function updateApplyButtonState() {
    if (!applyBtn) return;
    const ready = Boolean(
      cleanText(userSelectEl?.value, 120)
      && cleanText(sectionSelectEl?.value, 120)
      && cleanText(operationSelectEl?.value, 120)
      && cleanText(startDateEl?.value, 10)
      && cleanText(endDateEl?.value, 10)
      && !state.loading
    );
    applyBtn.disabled = !ready;
  }

  async function refreshSectionOperationCatalog() {
    const userId = cleanText(userSelectEl?.value, 120);
    if (!userId || !state.session) {
      state.filterCatalog = { sections: [], operationsBySection: {} };
      if (sectionSelectEl) {
        sectionSelectEl.disabled = true;
        setSelectOptions(sectionSelectEl, 'Select user first…', []);
      }
      if (operationSelectEl) {
        operationSelectEl.disabled = true;
        setSelectOptions(operationSelectEl, 'Select section first…', []);
      }
      updateApplyButtonState();
      return;
    }
    setStatus('Scanning archive for sections and operations…');
    const bounds = reportRangeBoundsMs();
    const backend = state.session.storageBackend || state.session.manifest?.storageBackend;
    const raw = Staging?.collectArchiveSectionOperationsForUser
      ? await Staging.collectArchiveSectionOperationsForUser({
        sessionId: state.session.id,
        backend,
        userId,
        startMs: bounds.dayStartMs,
        endMs: bounds.dayEndMs,
        allowedUserIds: allowedUserIdSet(state.session)
      })
      : { sections: [], operationsBySection: {} };
    const sections = (raw.sections || []).map((row) => {
      const id = cleanText(row?.id, 120);
      const label = lookupName(state.lookups.sections, id);
      return { id, label: label === id ? id : `${label} (${id})` };
    });
    state.filterCatalog = {
      sections,
      operationsBySection: raw.operationsBySection || {}
    };
    sectionSelectEl.disabled = !sections.length;
    setSelectOptions(
      sectionSelectEl,
      sections.length ? 'Select a section…' : 'No sections for this user',
      sections
    );
    operationSelectEl.disabled = true;
    setSelectOptions(operationSelectEl, 'Select section first…', []);
    setStatus(sections.length
      ? `${sections.length.toLocaleString()} section(s) found for this user in the report range.`
      : 'No sections found for this user in the report range.');
    updateApplyButtonState();
  }

  function onSectionChange() {
    const sectionId = cleanText(sectionSelectEl?.value, 120);
    if (!sectionId) {
      operationSelectEl.disabled = true;
      setSelectOptions(operationSelectEl, 'Select section first…', []);
      updateApplyButtonState();
      return;
    }
    const ops = (state.filterCatalog.operationsBySection[sectionId] || []).map((row) => {
      const id = cleanText(row?.id, 120);
      const label = lookupName(state.lookups.operations, id);
      return { id, label: label === id ? id : `${label} (${id})` };
    });
    operationSelectEl.disabled = !ops.length;
    setSelectOptions(
      operationSelectEl,
      ops.length ? 'Select an operation…' : 'No operations in this section',
      ops
    );
    updateApplyButtonState();
  }

  function validateFilters() {
    const userId = cleanText(userSelectEl?.value, 120);
    const sectionId = cleanText(sectionSelectEl?.value, 120);
    const operationId = cleanText(operationSelectEl?.value, 120);
    const startDate = cleanText(startDateEl?.value, 10);
    const endDate = cleanText(endDateEl?.value, 10);
    if (!userId || !sectionId || !operationId || !startDate || !endDate) {
      return { ok: false, message: 'User, section, operation, and date range are required.' };
    }
    if (startDate > endDate) {
      return { ok: false, message: 'Start date must be on or before end date.' };
    }
    if (state.reportStartDate && startDate < state.reportStartDate) {
      return { ok: false, message: `Start date cannot be before report start (${state.reportStartDate}).` };
    }
    if (state.reportEndDate && endDate > state.reportEndDate) {
      return { ok: false, message: `End date cannot be after report end (${state.reportEndDate}).` };
    }
    return { ok: true, userId, sectionId, operationId, startDate, endDate };
  }

  async function buildEventsForFilters(filterDef) {
    const session = state.session;
    const tz = sessionTimezone(session);
    const bounds = selectedFilterBoundsMs();
    const backend = session.storageBackend || session.manifest?.storageBackend;
    let logs = [];
    let actionStates = [];
    if (session.staging && Staging?.loadStagedRecordsForUserWindow) {
      const subset = await Staging.loadStagedRecordsForUserWindow({
        sessionId: session.id,
        backend,
        userId: filterDef.userId,
        startMs: bounds.dayStartMs,
        endMs: bounds.dayEndMs,
        allowedUserIds: allowedUserIdSet(session)
      });
      logs = subset.logs || [];
      actionStates = subset.actionStates || [];
    } else {
      logs = (session.logs || []).filter((row) => {
        const ms = new Date(String(row?.timestamp || row?.createdAt || '')).getTime();
        return Number.isFinite(ms) && ms >= bounds.dayStartMs && ms <= bounds.dayEndMs;
      });
      actionStates = session.actionStates || [];
    }
    const lookups = ArchiveLocal.mergeLookups(session, { lookups: {} });
    const presetFilters = {
      userId: filterDef.userId,
      sectionIds: [filterDef.sectionId],
      operationIds: [filterDef.operationId],
      sectionId: filterDef.sectionId,
      operationId: filterDef.operationId,
      startAtMs: bounds.dayStartMs,
      endAtMs: bounds.dayEndMs,
      startAt: new Date(bounds.dayStartMs).toISOString(),
      endAt: new Date(bounds.dayEndMs).toISOString()
    };
    const pseudoSession = { ...session, logs, actionStates };
    const built = ArchiveLocal.buildLocalEvents(
      pseudoSession,
      {},
      lookups,
      presetFilters
    );
    const events = (built.events || []).slice().sort(
      (a, b) => Number(a.occurredAtMs || 0) - Number(b.occurredAtMs || 0)
    );
    return { events, timezone: tz, startDate: filterDef.startDate, endDate: filterDef.endDate };
  }

  function tzForDisplay() {
    return sessionTimezone(state.session);
  }

  function addCalendarDayKey(dateKey) {
    const token = cleanText(dateKey, 10);
    const match = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    date.setUTCDate(date.getUTCDate() + 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function listDateKeysInWindow(win) {
    const keys = [];
    let cursor = cleanText(win?.startDate, 10);
    const end = cleanText(win?.endDate, 10);
    while (cursor && end && cursor.localeCompare(end) <= 0) {
      keys.push(cursor);
      const next = addCalendarDayKey(cursor);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return keys;
  }

  function formatDateKeyHeading(dateKey) {
    const token = cleanText(dateKey, 10);
    const match = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return token;
    try {
      const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
      return new Intl.DateTimeFormat(undefined, {
        timeZone: tzForDisplay(),
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(dt);
    } catch (_) {
      return token;
    }
  }

  function formatBatchRangeHeading(win) {
    const start = formatDateKeyHeading(win?.startDate);
    const end = formatDateKeyHeading(win?.endDate);
    if (!start || !end || start === end) return start || end || '';
    return `${start} → ${end}`;
  }

  function formatMsTimeLabel(ms) {
    if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return '—';
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: tzForDisplay(),
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toISOString();
    }
  }

  function formatMsDateTimeLabel(ms) {
    if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return '—';
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: tzForDisplay(),
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toISOString();
    }
  }

  function buildDayColumnsForBatch(batch) {
    const win = batch.window || {};
    const tz = tzForDisplay();
    const byDay = TimelineCore.groupEventsByDay
      ? TimelineCore.groupEventsByDay(batch.events || [], tz)
      : new Map();
    const dateKeys = listDateKeysInWindow(win);
    return dateKeys.map((dateKey) => {
      const dayEvents = byDay.get(dateKey) || [];
      const layout = TimelineCore.layoutEqualSpacedBatch
        ? TimelineCore.layoutEqualSpacedBatch(dayEvents)
        : { markers: [], firstMs: 0, lastMs: 0 };
      return {
        dateKey,
        heading: formatDateKeyHeading(dateKey),
        markers: layout.markers || [],
        firstMs: layout.firstMs,
        lastMs: layout.lastMs,
        count: dayEvents.length
      };
    });
  }

  function renderResultsTable(events) {
    if (!resultsTbodyEl) return;
    if (!events.length) {
      resultsTbodyEl.innerHTML = '<tr><td colspan="6" class="text-muted small px-3 py-3">No occurrences match these filters.</td></tr>';
      return;
    }
    const rows = events.map((ev) => {
      const id = escapeHtml(String(ev.id || ''));
      const when = escapeHtml(ev.occurredAtDisplay || ev.occurredAt || '');
      const section = escapeHtml(ev.sectionName || ev.sectionId || '—');
      const operation = escapeHtml(ev.operationName || ev.operationId || '—');
      const status = escapeHtml(ev.statusRaw || '—');
      const summary = escapeHtml(ev.summary || '—');
      const asBadge = ev.hasActionState
        ? '<span class="badge bg-success">Yes</span>'
        : '<span class="text-muted">—</span>';
      return `<tr class="log-archive-user-timeline-row" data-event-id="${id}" role="button" tabindex="0">`
        + `<td class="small">${when}</td>`
        + `<td class="small">${section}</td>`
        + `<td class="small">${operation}</td>`
        + `<td class="small">${status}</td>`
        + `<td class="small">${summary}</td>`
        + `<td class="text-center">${asBadge}</td>`
        + '</tr>';
    }).join('');
    resultsTbodyEl.innerHTML = rows;
    resultsTbodyEl.querySelectorAll('tr[data-event-id]').forEach((row) => {
      const open = () => openDetail(row.getAttribute('data-event-id'));
      row.addEventListener('click', open);
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      });
    });
  }

  function formatDetailScalar(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : '';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch (_) {
        return String(value);
      }
    }
    const text = String(value);
    if (text === '[object Object]') return '';
    if (/^\d{4}-\d{2}-\d{2}T\d/.test(text)) {
      const ms = Date.parse(text);
      if (Number.isFinite(ms)) {
        try {
          return new Intl.DateTimeFormat(undefined, {
            timeZone: tzForDisplay(),
            dateStyle: 'medium',
            timeStyle: 'medium'
          }).format(new Date(ms));
        } catch (_) {
          return text;
        }
      }
    }
    return text;
  }

  function formatDetailCell(value) {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) {
      const parts = value
        .map((v) => formatDetailScalar(v))
        .filter((v) => v != null && v !== '');
      if (!parts.length) return '—';
      if (parts.length === 1 && parts[0].includes('\n')) {
        return `<pre class="small mb-0 log-archive-user-timeline-detail-nested">${escapeHtml(parts[0])}</pre>`;
      }
      return escapeHtml(parts.join(', '));
    }
    if (typeof value === 'object') {
      const nested = formatDetailScalar(value);
      return `<pre class="small mb-0 log-archive-user-timeline-detail-nested">${escapeHtml(nested || '—')}</pre>`;
    }
    const scalar = formatDetailScalar(value);
    return escapeHtml(scalar || '—');
  }

  function humanizeDetailKey(key) {
    return String(key || '')
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  function flattenObjectRows(obj, prefix) {
    const rows = [];
    const source = obj && typeof obj === 'object' ? obj : {};
    Object.keys(source).sort().forEach((key) => {
      const val = source[key];
      const label = prefix ? `${prefix}.${key}` : key;
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        rows.push(...flattenObjectRows(val, label));
        return;
      }
      if (Array.isArray(val)) {
        rows.push([humanizeDetailKey(label), val]);
        return;
      }
      rows.push([humanizeDetailKey(label), val]);
    });
    return rows;
  }

  function buildKeyValueTable(tableRows) {
    const body = (tableRows || []).map(([label, value]) => (
      `<tr><th scope="row" class="log-archive-user-timeline-detail-th">${escapeHtml(label)}</th>`
      + `<td class="log-archive-user-timeline-detail-td">${formatDetailCell(value)}</td></tr>`
    )).join('');
    return `<table class="table table-sm table-striped table-bordered align-middle mb-0 log-archive-user-timeline-detail-table"><tbody>${body}</tbody></table>`;
  }

  function renderEventDetailTables(masked) {
    const mainRows = [
      ['When', masked.occurredAtDisplay || masked.occurredAt],
      ['Operation', masked.operationName || masked.operationId],
      ['Section', masked.sectionName || masked.sectionId],
      ['Status', masked.statusRaw],
      ['Summary', masked.summary],
      ['User', masked.displayName || masked.username || masked.userId],
      ['Organization', masked.orgName || masked.orgId],
      ['Source', masked.sourceLabel || masked.source],
      ['Request ID', masked.requestId],
      ['Record ID', masked.recordId],
      ['Context', masked.contextLine],
      ['Action state linked', masked.hasActionState ? 'Yes' : 'No']
    ].filter(([, value]) => value != null && value !== '');
    let html = buildKeyValueTable(mainRows);
    const details = masked.details && typeof masked.details === 'object' ? masked.details : {};
    const detailRows = flattenObjectRows(details);
    if (detailRows.length) {
      html += '<h6 class="small fw-bold text-muted text-uppercase mt-3 mb-2">Additional details</h6>';
      html += buildKeyValueTable(detailRows);
    }
    return html;
  }

  function renderActionStateDetailTables(actionState) {
    if (!actionState) return '';
    const mainRows = [
      ['When', actionState.occurredAtDisplay || actionState.occurredAt],
      ['Status', actionState.statusRaw],
      ['Summary', actionState.summary],
      ['Method', actionState.method],
      ['URL', actionState.url],
      ['Target', actionState.targetKey],
      ['Request ID', actionState.requestId],
      ['Record ID', actionState.recordId],
      ['Organization', actionState.orgName || actionState.orgId]
    ].filter(([, value]) => value != null && value !== '');
    let html = buildKeyValueTable(mainRows);
    const details = actionState.details && typeof actionState.details === 'object'
      ? actionState.details
      : {};
    const detailRows = flattenObjectRows(details);
    if (detailRows.length) {
      html += '<h6 class="small fw-bold text-muted text-uppercase mt-3 mb-2">Action state payload</h6>';
      html += buildKeyValueTable(detailRows);
    }
    return html;
  }

  function viewportEnlargeMinChartHeight() {
    const vh = typeof window.innerHeight === 'number' ? window.innerHeight : 800;
    return Math.max(520, Math.floor(vh - 140));
  }

  function computeEnlargedLayout(dayCol, colWidth) {
    const totalWidth = Number(colWidth) || CHART_ENLARGE_COL_WIDTH;
    const padTop = 28;
    const padBottom = 36;
    const markers = dayCol?.markers || [];
    const n = markers.length;
    const viewportInner = viewportEnlargeMinChartHeight() - padTop - padBottom;
    const innerNeed = n <= 1 ? Math.max(240, viewportInner) : (n - 1) * CHART_ENLARGE_MIN_GAP + 48;
    const innerH = Math.max(viewportInner, innerNeed);
    const chartHeight = padTop + innerH + padBottom;
    const cx = totalWidth / 2;
    const yTop = padTop;
    const yBottom = padTop + innerH;
    const markerYs = markers.map((marker, index) => {
      if (n <= 1) return padTop + innerH / 2;
      const ratio = index / (n - 1);
      return padTop + innerH * (1 - ratio);
    });
    return {
      totalWidth,
      chartHeight,
      padTop,
      innerH,
      cx,
      yTop,
      yBottom,
      markers,
      markerYs
    };
  }

  function renderEnlargedDayColumnSvg(dayCol, colWidth) {
    const layout = computeEnlargedLayout(dayCol, colWidth);
    const {
      totalWidth, chartHeight, cx, yTop, yBottom, markers, markerYs
    } = layout;

    let svg = `<svg viewBox="0 0 ${totalWidth} ${chartHeight}" width="${totalWidth}" height="${chartHeight}"`
      + ' preserveAspectRatio="xMidYMin meet" xmlns="http://www.w3.org/2000/svg"'
      + ' class="log-archive-user-timeline-svg log-archive-user-timeline-svg-enlarged">';

    if (!dayCol.dateKey) {
      svg += `<text x="${cx}" y="${layout.padTop + layout.innerH / 2}" text-anchor="middle" class="log-archive-user-timeline-empty-label">—</text>`;
      svg += '</svg>';
      return { svg, chartHeight, totalWidth };
    }

    svg += `<text x="${cx}" y="20" text-anchor="middle" class="log-archive-user-timeline-day-subheading">${dayCol.count} occurrence${dayCol.count === 1 ? '' : 's'}</text>`;

    if (!markers.length) {
      svg += `<line class="log-archive-user-timeline-spine log-archive-user-timeline-spine-muted" x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBottom}" />`;
      svg += `<text x="${cx}" y="${layout.padTop + layout.innerH / 2}" text-anchor="middle" class="log-archive-user-timeline-empty-label">No activity</text>`;
    } else {
      svg += `<line class="log-archive-user-timeline-spine" x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBottom}" />`;

      markers.forEach((marker, index) => {
        const y = markerYs[index];
        const side = Number(marker.branchSide) || 1;
        const len = side * 72;
        const x2 = cx + len;
        const branchClass = marker.hasActionState
          ? 'log-archive-user-timeline-branch action-state'
          : 'log-archive-user-timeline-branch';
        svg += `<line class="${branchClass}" x1="${cx}" y1="${y}" x2="${x2}" y2="${y}" />`;
        const nodeClass = marker.hasActionState
          ? 'log-archive-user-timeline-node has-action-state'
          : 'log-archive-user-timeline-node';
        const safeId = encodeURIComponent(String(marker.eventId || ''));
        svg += `<circle class="${nodeClass}" cx="${x2}" cy="${y}" r="10" data-event-id="${safeId}" tabindex="0" role="button" aria-label="${escapeHtml(marker.tooltipTitle || 'Activity')}" />`;
        const timeLine = escapeHtml(formatMsTimeLabel(marker.occurredAtMs) || marker.tooltipTime || '');
        const labelX = side > 0 ? x2 + 16 : x2 - 16;
        svg += `<text x="${labelX}" y="${y + 5}" class="log-archive-user-timeline-event-label log-archive-user-timeline-event-label-enlarged" text-anchor="${side > 0 ? 'start' : 'end'}">${timeLine}</text>`;
      });
    }

    svg += '</svg>';
    return { svg, chartHeight, totalWidth };
  }

  function renderDayColumnSvg(dayCol, options) {
    const opts = options && typeof options === 'object' ? options : {};
    if (opts.enlarged) {
      return renderEnlargedDayColumnSvg(dayCol, opts.colWidth).svg;
    }
    const chartHeight = Number(opts.height) || CHART_FIXED_HEIGHT;
    const totalWidth = Number(opts.colWidth) || CHART_DAY_COL_WIDTH;
    const padTop = CHART_PAD_TOP;
    const padBottom = CHART_PAD_BOTTOM;
    const innerH = chartHeight - padTop - padBottom;
    const cx = totalWidth / 2;
    const yAt = (ratio) => padTop + innerH * (1 - Number(ratio || 0));
    const yTop = padTop;
    const yBottom = padTop + innerH;
    const markers = dayCol.markers || [];

    let svg = `<svg width="100%" height="${chartHeight}" viewBox="0 0 ${totalWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" class="log-archive-user-timeline-svg">`;

    if (!dayCol.dateKey) {
      svg += `<text x="${cx}" y="${padTop + innerH / 2}" text-anchor="middle" class="log-archive-user-timeline-empty-label">—</text>`;
      svg += '</svg>';
      return svg;
    }

    svg += `<text x="${cx}" y="22" text-anchor="middle" class="log-archive-user-timeline-day-heading">${escapeHtml(dayCol.heading || dayCol.dateKey)}</text>`;
    svg += `<text x="${cx}" y="36" text-anchor="middle" class="log-archive-user-timeline-day-subheading">${dayCol.count} occurrence${dayCol.count === 1 ? '' : 's'}</text>`;

    if (!markers.length) {
      svg += `<line class="log-archive-user-timeline-spine log-archive-user-timeline-spine-muted" x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBottom}" />`;
      svg += `<text x="${cx}" y="${padTop + innerH / 2}" text-anchor="middle" class="log-archive-user-timeline-empty-label">No activity</text>`;
    } else {
      svg += `<line class="log-archive-user-timeline-spine" x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBottom}" />`;
      svg += `<text x="${cx - 16}" y="${yTop + 4}" text-anchor="end" class="log-archive-user-timeline-end-label">${escapeHtml(formatMsTimeLabel(dayCol.firstMs))}</text>`;
      svg += `<text x="${cx - 16}" y="${yBottom}" text-anchor="end" class="log-archive-user-timeline-end-label">${escapeHtml(formatMsTimeLabel(dayCol.lastMs))}</text>`;

      markers.forEach((marker) => {
        const y = yAt(marker.yRatio);
        const side = Number(marker.branchSide) || 1;
        const len = side * (Number(marker.branchLength) || 40);
        const x2 = cx + len;
        const branchClass = marker.hasActionState
          ? 'log-archive-user-timeline-branch action-state'
          : 'log-archive-user-timeline-branch';
        svg += `<line class="${branchClass}" x1="${cx}" y1="${y}" x2="${x2}" y2="${y}" />`;
        const nodeClass = marker.hasActionState
          ? 'log-archive-user-timeline-node has-action-state'
          : 'log-archive-user-timeline-node';
        const safeId = encodeURIComponent(String(marker.eventId || ''));
        svg += `<circle class="${nodeClass}" cx="${x2}" cy="${y}" r="9" data-event-id="${safeId}" tabindex="0" role="button" aria-label="${escapeHtml(marker.tooltipTitle || 'Activity')}" />`;
        const timeLine = escapeHtml(formatMsTimeLabel(marker.occurredAtMs) || marker.tooltipTime || '');
        svg += `<text x="${x2 + side * 14}" y="${y + 4}" class="log-archive-user-timeline-event-label" text-anchor="${side > 0 ? 'start' : 'end'}">${timeLine}</text>`;
      });
    }

    svg += '</svg>';
    return svg;
  }

  function paintEnlargedDayChart(dayCol) {
    if (!enlargeChartHostEl || !dayCol?.dateKey) return;
    const hostWidth = enlargeChartHostEl.clientWidth || CHART_ENLARGE_COL_WIDTH;
    const colWidth = Math.max(400, Math.min(hostWidth - 16, CHART_ENLARGE_COL_WIDTH));
    const rendered = renderEnlargedDayColumnSvg(dayCol, colWidth);
    enlargeChartHostEl.style.minHeight = '';
    enlargeChartHostEl.innerHTML = `<div class="log-archive-user-timeline-enlarge-svg-wrap" style="width:${rendered.totalWidth}px;max-width:100%;margin:0 auto;">${rendered.svg}</div>`;
    bindChartInteractions(enlargeChartHostEl);
  }

  function openEnlargedDayTimeline(dayCol) {
    if (!dayCol?.dateKey) return;
    const modal = ensureEnlargeModal();
    if (!modal || !enlargeChartHostEl) return;
    hideTooltip();
    if (enlargeTitleEl) {
      enlargeTitleEl.textContent = dayCol.heading || dayCol.dateKey;
    }
    modal.show();
    if (enlargeModalEl && !enlargeModalEl.dataset.enlargeResizeBound) {
      enlargeModalEl.dataset.enlargeResizeBound = '1';
      enlargeModalEl.addEventListener('shown.bs.modal', () => {
        if (state.pendingEnlargeDayCol) {
          paintEnlargedDayChart(state.pendingEnlargeDayCol);
        }
      });
    }
    state.pendingEnlargeDayCol = dayCol;
    requestAnimationFrame(() => {
      paintEnlargedDayChart(dayCol);
    });
  }

  function bindDayPanelEnlarge(panelEl, dayCol) {
    if (!panelEl || !dayCol?.dateKey) return;
    panelEl.classList.add('log-archive-user-timeline-day-panel-clickable');
    panelEl.setAttribute('role', 'button');
    panelEl.setAttribute('tabindex', '0');
    panelEl.setAttribute('aria-label', `Enlarge timeline for ${dayCol.heading || dayCol.dateKey}`);
    const open = () => openEnlargedDayTimeline(dayCol);
    panelEl.addEventListener('click', (ev) => {
      if (ev.target.closest('circle[data-event-id]')) return;
      open();
    });
    panelEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        if (ev.target.closest('circle[data-event-id]')) return;
        ev.preventDefault();
        open();
      }
    });
  }

  function bindChartInteractions(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('circle[data-event-id]').forEach((node) => {
      const readEventId = () => decodeURIComponent(node.getAttribute('data-event-id') || '');
      node.addEventListener('mouseenter', (ev) => showTooltip(ev, readEventId()));
      node.addEventListener('mousemove', (ev) => moveTooltip(ev));
      node.addEventListener('mouseleave', hideTooltip);
      node.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openDetail(readEventId());
      });
      node.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openDetail(readEventId());
        }
      });
    });
  }

  function renderTimelineBatches(batches) {
    if (!batchesEl) return;
    batchesEl.innerHTML = '';
    (batches || []).forEach((batch, index) => {
      const win = batch.window || {};
      const count = (batch.events || []).length;
      const dayColumns = buildDayColumnsForBatch(batch);
      const block = document.createElement('div');
      block.className = 'log-archive-user-timeline-batch mb-4';
      block.innerHTML = `<div class="log-archive-user-timeline-batch-header d-flex flex-wrap justify-content-between align-items-center mb-2 gap-2">`
        + `<span class="log-archive-user-timeline-batch-title">${escapeHtml(formatBatchRangeHeading(win))}</span>`
        + `<span class="small text-muted">${count.toLocaleString()} occurrence(s) in batch</span>`
        + '</div>'
        + `<div class="row g-2 log-archive-user-timeline-day-row" data-batch-index="${index}"></div>`;
      batchesEl.appendChild(block);
      const rowEl = block.querySelector('.log-archive-user-timeline-day-row');
      dayColumns.forEach((dayCol) => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-4 log-archive-user-timeline-day-col';
        col.innerHTML = '<div class="log-archive-user-timeline-day-panel log-archive-user-timeline-chart log-archive-user-timeline-chart-fixed" aria-live="polite"></div>';
        rowEl.appendChild(col);
        const chartHost = col.querySelector('.log-archive-user-timeline-day-panel');
        if (chartHost) {
          chartHost.innerHTML = renderDayColumnSvg(dayCol);
          bindChartInteractions(chartHost);
          bindDayPanelEnlarge(chartHost, dayCol);
        }
      });
    });
  }

  function showTooltip(ev, eventId) {
    const event = state.eventsById.get(String(eventId || ''));
    if (!tooltipEl || !event) return;
    const asNote = event.hasActionState ? '<div class="mt-1"><span class="badge bg-success">Action state linked</span></div>' : '';
    tooltipEl.innerHTML = `<strong>${escapeHtml(event.operationName || event.sectionName || event.sourceLabel || 'Activity')}</strong>`
      + `<div>${escapeHtml(event.occurredAtDisplay || event.occurredAt || '')}</div>`
      + `<div class="text-white-50">${escapeHtml(event.statusRaw || event.summary || '')}</div>${asNote}`;
    tooltipEl.classList.remove('d-none');
    moveTooltip(ev);
  }

  function moveTooltip(ev) {
    if (!tooltipEl) return;
    tooltipEl.style.left = `${ev.clientX + 14}px`;
    tooltipEl.style.top = `${ev.clientY + 14}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.add('d-none');
  }

  function openDetail(eventId) {
    const event = state.eventsById.get(String(eventId || ''));
    const modal = ensureDetailModal();
    if (!event) return;
    if (!modal) {
      if (typeof window.showMessageModal === 'function') {
        void window.showMessageModal({
          title: 'Activity detail',
          icon: 'info',
          message: `<pre class="small mb-0">${escapeHtml(JSON.stringify(event, null, 2))}</pre>`
        });
      }
      return;
    }
    hideTooltip();
    const masked = ArchiveLocal?.toMaskedEventDetails
      ? ArchiveLocal.toMaskedEventDetails(event, true, (v) => v)
      : event;
    if (detailTitleEl) {
      detailTitleEl.textContent = masked.operationName || masked.sectionName || 'Activity detail';
    }
    if (detailSummaryEl) {
      const badge = masked.hasActionState
        ? '<span class="badge bg-success">Action state linked</span>'
        : '';
      detailSummaryEl.innerHTML = badge
        ? `<div class="mb-2">${badge}</div>`
        : '';
    }
    if (detailTableHostEl) {
      detailTableHostEl.innerHTML = renderEventDetailTables(masked);
    }
    if (detailActionBlockEl && detailActionTableHostEl) {
      if (masked.actionState) {
        detailActionBlockEl.classList.remove('d-none');
        detailActionTableHostEl.innerHTML = renderActionStateDetailTables(masked.actionState);
      } else {
        detailActionBlockEl.classList.add('d-none');
        detailActionTableHostEl.innerHTML = '';
      }
    }
    raiseModalStack(detailModalEl);
    modal.show();
  }

  async function applyFilters() {
    const check = validateFilters();
    if (!check.ok) {
      setStatus(check.message);
      return;
    }
    state.loading = true;
    updateApplyButtonState();
    setStatus('Loading occurrences…');
    try {
      const { events, startDate, endDate } = await buildEventsForFilters(check);
      state.events = events;
      state.eventsById = new Map(events.map((ev) => [String(ev.id), ev]));

      if (resultsCardEl) resultsCardEl.classList.remove('d-none');
      renderResultsTable(events);

      const batches = TimelineCore.layoutBatchedEqualSpacedTimelines
        ? TimelineCore.layoutBatchedEqualSpacedTimelines(
          events,
          startDate,
          endDate,
          sessionTimezone(state.session),
          windowDays
        )
        : [];
      renderTimelineBatches(batches);
      setStatus(`${events.length.toLocaleString()} occurrence(s) · ${batches.length.toLocaleString()} timeline batch(es)`);
    } catch (err) {
      setStatus(err.message || 'Load failed');
    } finally {
      state.loading = false;
      updateApplyButtonState();
    }
  }

  async function initPage() {
    bindDetailModalStacking();
    if (!LocalSession || !Staging || !ArchiveLocal) {
      setStatus('Required scripts are missing.');
      return;
    }
    const sessionId = resolveLocalSessionIdFromPage();
    let session = await LocalSession.loadSession(sessionId || undefined);
    if (!session && LocalSession.loadLatestSession) {
      session = await LocalSession.loadLatestSession();
    }
    if (!session) {
      if (bannerEl) {
        bannerEl.classList.remove('d-none');
        bannerEl.classList.replace('alert-info', 'alert-warning');
      }
      if (bannerMetaEl) {
        bannerMetaEl.textContent = 'No local archive session found. Load an archive in the Local Analyzer first (Step 3 links include your session id).';
      }
      setStatus('No local session');
      return;
    }

    state.session = session;
    state.lookups = ArchiveLocal.mergeLookups(session, { lookups: {} });
    const range = reportRangeFromSession(session);
    state.reportStartDate = range.startDate;
    state.reportEndDate = range.endDate;
    showBanner(session);

    if (startDateEl && range.startDate) startDateEl.value = range.startDate;
    if (endDateEl && range.endDate) endDateEl.value = range.endDate;
    enableFilterControls(true);

    const users = await loadUserOptions(session);
    populateUserSelect(users);
    setStatus('Select a user, section, operation, and date range, then Apply.');

    userSelectEl?.addEventListener('change', () => {
      void refreshSectionOperationCatalog();
    });
    sectionSelectEl?.addEventListener('change', onSectionChange);
    startDateEl?.addEventListener('change', updateApplyButtonState);
    endDateEl?.addEventListener('change', updateApplyButtonState);
    operationSelectEl?.addEventListener('change', updateApplyButtonState);
    applyBtn?.addEventListener('click', () => { void applyFilters(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void initPage(); });
  } else {
    void initPage();
  }
}());
