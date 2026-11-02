/**
 * Local Archive Analyzer — client-only wizard (dates → ZIP/folder → report).
 */
(function () {
  const cfg = window.__LOG_ARCHIVE_ANALYZER__ || {};
  const Range = window.LogArchiveAnalyzerRange || {};
  const Core = window.LogArchiveAnalyzerCore || {};
  const maxMergeLimitCeiling = Math.max(1, Number(cfg.maxMergeLimit || 50000));
  const defaultRecordLimit = Math.min(
    maxMergeLimitCeiling,
    Math.max(1, Number(cfg.defaultRecordLimit || 5000))
  );
  const RECORD_LIMIT_STORAGE_KEY = 'logArchive.recordLimit';
  const defaultTimezone = String(cfg.timezone || 'UTC').trim() || 'UTC';

  const setupForm = document.getElementById('logArchiveReportSetupForm');
  const reportStartInput = document.getElementById('logArchiveReportStart');
  const reportEndInput = document.getElementById('logArchiveReportEnd');
  const recordLimitInput = document.getElementById('logArchiveRecordLimit');
  const userSummaryInput = document.getElementById('logArchiveUserSummary');
  const truncationNoticeEl = document.getElementById('logArchiveTruncationNotice');
  const step2Card = document.getElementById('logArchiveStep2Card');
  const openZipBtn = document.getElementById('logArchiveOpenZipBtn');
  const openFolderBtn = document.getElementById('logArchiveOpenFolderBtn');
  const mirrorFolderBtn = document.getElementById('logArchiveMirrorFolderBtn');
  const zipInput = document.getElementById('logArchiveZipInput');
  const folderInput = document.getElementById('logArchiveFolderInput');
  const pickUsersBtn = document.getElementById('logArchivePickUsersBtn');
  const clearUsersBtn = document.getElementById('logArchiveClearUsersBtn');
  const selectedUsersEl = document.getElementById('logArchiveSelectedUsers');
  const loadMeta = document.getElementById('logArchiveLoadMeta');
  const step3Card = document.getElementById('logArchiveStep3Card');
  const step3Summary = document.getElementById('logArchiveStep3Summary');
  const openPanelBtn = document.getElementById('logArchiveOpenPanelBtn');
  const reviewTrackBtn = document.getElementById('logArchiveReviewTrackBtn');
  const userTimelineBtn = document.getElementById('logArchiveUserTimelineBtn');
  const panel = document.getElementById('logArchiveAnalyzerPanel');
  const filterForm = document.getElementById('logArchiveAnalyzerFilterForm');
  const tbody = document.querySelector('#logArchiveEventsTable tbody');
  const summaryRow = document.getElementById('logArchiveSummaryRow');
  const pageMeta = document.getElementById('logArchivePageMeta');
  const csvBtn = document.getElementById('logArchiveCsvBtn');
  const prevBtn = document.getElementById('logArchivePrevPage');
  const nextBtn = document.getElementById('logArchiveNextPage');

  let archive = null;
  let allEvents = [];
  let filteredEvents = [];
  let selectedUsers = [];
  let page = 1;
  const pageSize = 50;
  let loadStepOrder = [];
  let loadModalButtonResolver = null;

  const LOAD_STEPS_ZIP = [
    { id: 'validate', label: 'Validate report period' },
    { id: 'read', label: 'Read ZIP file from your device' },
    { id: 'manifest', label: 'Read manifest and check date overlap' },
    { id: 'parse', label: 'Parse archive NDJSON files' },
    { id: 'filter', label: 'Filter by report range and users' },
    { id: 'stage', label: 'Stage records locally (OPFS / IndexedDB)' },
    { id: 'events', label: 'Build activity timeline' }
  ];

  const LOAD_STEPS_FOLDER = [
    { id: 'validate', label: 'Validate report period' },
    { id: 'scan', label: 'Find activity-archive ZIP files in folder' },
    { id: 'manifest', label: 'Match exports to your date range' },
    { id: 'read', label: 'Read selected ZIP file(s)' },
    { id: 'merge', label: 'Merge and filter records' },
    { id: 'stage', label: 'Stage records locally (OPFS / IndexedDB)' },
    { id: 'events', label: 'Build activity timeline' }
  ];

  function cleanText(value, max) {
    const text = String(value == null ? '' : value).trim();
    return text.length > max ? text.slice(0, max) : text;
  }

  function parseNdjson(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  }

  function getReportSetup() {
    const startDate = Range.cleanDateKey ? Range.cleanDateKey(reportStartInput?.value) : cleanText(reportStartInput?.value, 10);
    const endDate = Range.cleanDateKey ? Range.cleanDateKey(reportEndInput?.value) : cleanText(reportEndInput?.value, 10);
    const userIds = selectedUsers.map((u) => u.id).filter(Boolean);
    const selectedUsersSnapshot = selectedUsers.map((u) => ({
      id: cleanText(u.id, 120),
      label: cleanText(u.label || u.name || u.username || u.id, 180)
    })).filter((u) => u.id);
    return { startDate, endDate, userIds, selectedUsers: selectedUsersSnapshot };
  }

  function validateReportSetup() {
    const { startDate, endDate } = getReportSetup();
    if (!startDate || !endDate) return { ok: false, message: 'Start and end dates are required.' };
    if (startDate > endDate) return { ok: false, message: 'Start date must be on or before end date.' };
    return { ok: true, startDate, endDate };
  }

  function setStep2Enabled(enabled) {
    const on = Boolean(enabled);
    if (step2Card) step2Card.classList.toggle('is-disabled', !on);
    [openZipBtn, openFolderBtn].forEach((el) => {
      if (el) {
        el.disabled = !on;
        el.classList.toggle('disabled', !on);
        if (on) el.removeAttribute('disabled');
        else el.setAttribute('disabled', 'disabled');
      }
    });
    if (zipInput) {
      zipInput.disabled = !on;
      if (on) zipInput.removeAttribute('disabled');
      else zipInput.setAttribute('disabled', 'disabled');
    }
    if (folderInput) {
      folderInput.disabled = !on;
      if (on) folderInput.removeAttribute('disabled');
      else folderInput.setAttribute('disabled', 'disabled');
    }
  }

  function waitForMessageModalHidden(maxMs = 2500) {
    const modalEl = document.getElementById('messageModal');
    if (!modalEl || !modalEl.classList.contains('show')) return Promise.resolve();
    return Promise.race([
      new Promise((resolve) => {
        modalEl.addEventListener('hidden.bs.modal', () => resolve(), { once: true });
      }),
      new Promise((resolve) => { setTimeout(resolve, maxMs); })
    ]);
  }

  async function prepareMessageModalAfterProgress() {
    await closeProgressModal();
    await waitForMessageModalHidden();
    enableMessageModalButtons();
  }

  /** Swap progress UI to a message without hide/show (avoids hidden.bs.modal racing the next prompt). */
  async function transitionProgressToMessagePrompt(opts) {
    enableMessageModalButtons();
    return showMessageModalPrompt(opts);
  }

  function clampRecordLimit(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, maxMergeLimitCeiling);
  }

  function getRecordLimit() {
    if (recordLimitInput) return clampRecordLimit(recordLimitInput.value);
    try {
      const stored = localStorage.getItem(RECORD_LIMIT_STORAGE_KEY);
      if (stored != null && stored !== '') return clampRecordLimit(stored);
    } catch (_) { /* ignore */ }
    return defaultRecordLimit;
  }

  function persistRecordLimit(value) {
    const clamped = clampRecordLimit(value);
    try {
      localStorage.setItem(RECORD_LIMIT_STORAGE_KEY, String(clamped));
    } catch (_) { /* ignore */ }
    if (recordLimitInput && String(recordLimitInput.value) !== String(clamped)) {
      recordLimitInput.value = String(clamped);
    }
    return clamped;
  }

  function initRecordLimitInput() {
    if (!recordLimitInput) return;
    recordLimitInput.max = String(maxMergeLimitCeiling);
    recordLimitInput.value = String(getRecordLimit());
    const onLimitChange = () => { persistRecordLimit(recordLimitInput.value); };
    recordLimitInput.addEventListener('change', onLimitChange);
    recordLimitInput.addEventListener('blur', onLimitChange);
  }

  function syncStep2FromDates() {
    const validation = validateReportSetup();
    setStep2Enabled(validation.ok);
  }

  function bindReportDateListeners() {
    const handler = () => syncStep2FromDates();
    if (setupForm) {
      setupForm.addEventListener('change', handler);
      setupForm.addEventListener('input', handler);
    }
    [reportStartInput, reportEndInput].forEach((el) => {
      if (!el) return;
      el.addEventListener('change', handler);
      el.addEventListener('input', handler);
      el.addEventListener('blur', handler);
    });
    syncStep2FromDates();
  }

  function updateUserSummaryField() {
    if (!userSummaryInput) return;
    if (!selectedUsers.length) {
      userSummaryInput.value = 'All users in range';
      return;
    }
    if (selectedUsers.length === 1) {
      const u = selectedUsers[0];
      userSummaryInput.value = cleanText(u.label || u.name || u.username || u.id, 180);
      return;
    }
    userSummaryInput.value = `${selectedUsers.length} users selected`;
  }

  function renderSelectedUsers() {
    updateUserSummaryField();
    if (!selectedUsersEl) return;
    if (!selectedUsers.length) {
      selectedUsersEl.classList.add('d-none');
      selectedUsersEl.innerHTML = '';
      return;
    }
    selectedUsersEl.classList.remove('d-none');
    selectedUsersEl.innerHTML = selectedUsers.map((user) => {
      const id = cleanText(user.id, 120);
      const label = cleanText(user.label || user.name || user.username || id, 180);
      return `<span class="badge rounded-pill text-bg-light border" data-user-id="${id}">
        ${label}
        <button type="button" class="btn-close" aria-label="Remove ${label}" data-remove-user="${id}"></button>
      </span>`;
    }).join('');
    selectedUsersEl.querySelectorAll('[data-remove-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-user');
        selectedUsers = selectedUsers.filter((u) => u.id !== id);
        renderSelectedUsers();
      });
    });
  }

  function upsertSelectedUsers(items) {
    const rows = Array.isArray(items) ? items : (items ? [items] : []);
    const byId = new Map(selectedUsers.map((u) => [u.id, u]));
    rows.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const id = cleanText(item.id, 120);
      if (!id) return;
      const label = cleanText(item.name || item.username || item.email || id, 180);
      byId.set(id, { id, label });
    });
    selectedUsers = Array.from(byId.values());
    renderSelectedUsers();
  }

  function initUserPicker() {
    if (!pickUsersBtn) return;
    pickUsersBtn.addEventListener('click', () => {
      if (!window.GenericPicker || !window.GenericPickerPresets) {
        void showUserMessage({
          title: 'Picker unavailable',
          icon: 'warning',
          message: 'User picker is not loaded on this page.'
        });
        return;
      }
      window.GenericPicker.open(window.GenericPickerPresets.user({
        title: 'Select users for report',
        icon: 'bi-people',
        apiEndpoint: '/security/track-activity/users',
        searchFields: 'id,username,email,name',
        placeholder: 'Search users…',
        multiselect: true,
        onSelect: (items) => upsertSelectedUsers(items)
      }));
    });
    if (clearUsersBtn) {
      clearUsersBtn.addEventListener('click', () => {
        selectedUsers = [];
        renderSelectedUsers();
      });
    }
    renderSelectedUsers();
  }

  function getMessageModalElements() {
    const modalEl = document.getElementById('messageModal');
    if (!modalEl) return null;
    return {
      modalEl,
      titleEl: document.getElementById('messageModalTitle'),
      iconEl: document.getElementById('messageModalIcon'),
      bodyEl: document.getElementById('messageModalBody'),
      footerEl: document.getElementById('messageModalButtons'),
      headerEl: modalEl.querySelector('.modal-header')
    };
  }

  function enableMessageModalButtons() {
    const parts = getMessageModalElements();
    if (!parts) return;
    const closeBtn = parts.modalEl.querySelector('.btn-close');
    if (closeBtn) {
      closeBtn.classList.remove('d-none');
      closeBtn.disabled = false;
    }
    parts.footerEl.querySelectorAll('button').forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('disabled');
    });
    document.body.style.pointerEvents = '';
  }

  function lockMessageModalWhileBusy() {
    const parts = getMessageModalElements();
    if (!parts) return;
    const apply = () => {
      const closeBtn = parts.modalEl.querySelector('.btn-close');
      if (closeBtn) closeBtn.classList.add('d-none');
      parts.footerEl.querySelectorAll('button').forEach((btn) => {
        btn.disabled = true;
        btn.classList.add('disabled');
      });
    };
    if (parts.modalEl.classList.contains('show')) apply();
    else parts.modalEl.addEventListener('shown.bs.modal', apply, { once: true });
  }

  function buildLoadStepsHtml(steps, activeId, doneIds) {
    const doneSet = doneIds instanceof Set ? doneIds : new Set(doneIds || []);
    const items = steps.map((step) => {
      let icon = '<span class="text-muted me-2">○</span>';
      let cls = 'text-muted';
      if (doneSet.has(step.id)) {
        icon = '<span class="text-success me-2"><i class="bi bi-check-circle-fill"></i></span>';
        cls = 'text-success';
      } else if (step.id === activeId) {
        icon = '<span class="text-primary me-2"><span class="spinner-border spinner-border-sm" role="status"></span></span>';
        cls = 'fw-semibold text-body';
      }
      return `<li class="list-group-item border-0 px-0 py-1 ${cls}" data-load-step="${step.id}">${icon}${step.label}</li>`;
    }).join('');
    return `<p class="small text-muted mb-2">All steps run locally in your browser. Nothing is uploaded.</p>
      <ul class="list-group list-group-flush small mb-3" id="logArchiveLoadSteps">${items}</ul>
      <div class="progress" style="height: 1rem;">
        <div id="logArchiveLoadProgressBar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%" aria-valuemin="0" aria-valuemax="100">0%</div>
      </div>`;
  }

  function paintLoadProgress(activeId, doneIds, percent) {
    const parts = getMessageModalElements();
    if (!parts || !loadStepOrder.length) return;
    parts.bodyEl.innerHTML = buildLoadStepsHtml(loadStepOrder, activeId, doneIds);
    const bar = document.getElementById('logArchiveLoadProgressBar');
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
      bar.textContent = `${pct}%`;
      if (pct >= 100) bar.classList.remove('progress-bar-animated', 'progress-bar-striped');
    }
  }

  function ensureMessageModalShown() {
    const parts = getMessageModalElements();
    if (!parts || !window.bootstrap?.Modal) return null;
    let inst = window.bootstrap.Modal.getInstance(parts.modalEl);
    if (!inst) inst = new window.bootstrap.Modal(parts.modalEl, { backdrop: 'static', keyboard: false });
    if (!parts.modalEl.classList.contains('show')) inst.show();
    return inst;
  }

  function openLoadProgressModal(steps, title) {
    loadStepOrder = steps.slice();
    const parts = getMessageModalElements();
    if (!parts) return;
    parts.titleEl.textContent = cleanText(title, 120) || 'Loading archive';
    paintLoadProgress(steps[0]?.id, [], 0);
    parts.footerEl.innerHTML = '<span class="small text-muted">Please wait…</span>';
    ensureMessageModalShown();
    lockMessageModalWhileBusy();
  }

  function advanceLoadProgress(stepId, doneIds, percent) {
    paintLoadProgress(stepId, doneIds, percent);
  }

  function yieldToUi() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => { setTimeout(resolve, 0); });
    });
  }

  function showMessageModalPrompt({ title, icon, message, buttons }) {
    enableMessageModalButtons();
    if (typeof window.showMessageModal !== 'function') {
      console.error('[LogArchiveAnalyzer] messageModal unavailable:', title, message);
      return Promise.resolve('OK');
    }
    return new Promise((resolve) => {
      void window.showMessageModal({
        title: title || 'Message',
        icon: icon || 'info',
        message: message || '',
        buttons: buttons && buttons.length ? buttons : [{ text: 'OK', class: 'btn-primary' }]
      }).then((result) => {
        enableMessageModalButtons();
        resolve(result);
      });
    });
  }

  async function showUserMessage(opts) {
    enableMessageModalButtons();
    await showMessageModalPrompt(opts);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Read failed'));
      reader.readAsText(file);
    });
  }

  function normalizeRelativePath(file) {
    return String(file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/');
  }

  function buildFolderScanDiagnostics(fileList, reportSetup) {
    const files = Array.from(fileList || []);
    const zipEntries = files.filter((f) => /\.zip$/i.test(String(f.name || '')));
    const zipNames = zipEntries.map((f) => normalizeRelativePath(f));
    const parsedZips = zipNames.map((name) => {
      const parsed = Range.parseArchiveZipFileName ? Range.parseArchiveZipFileName(name) : null;
      const overlaps = parsed && Range.dateKeysOverlap
        ? Range.dateKeysOverlap(reportSetup.startDate, reportSetup.endDate, parsed.startDate, parsed.endDate)
        : false;
      return { name, parsed, overlaps };
    });
    const manifestFiles = files.filter((f) => {
      const rp = normalizeRelativePath(f);
      return rp === 'manifest.json' || rp.endsWith('/manifest.json');
    });
    return {
      totalFiles: files.length,
      zipCount: zipEntries.length,
      parsedZips,
      manifestCount: manifestFiles.length,
      reportStart: reportSetup.startDate,
      reportEnd: reportSetup.endDate
    };
  }

  function buildFolderScanErrorHtml(diagnostics) {
    const lines = parsedZipsToList(diagnostics.parsedZips);
    let html = `<p>No export in this folder overlaps your report period (<strong>${diagnostics.reportStart}</strong> – <strong>${diagnostics.reportEnd}</strong>).</p>`;
    html += `<p class="small mb-2">Scanned <strong>${diagnostics.totalFiles}</strong> file(s): `
      + `<strong>${diagnostics.zipCount}</strong> ZIP(s), <strong>${diagnostics.manifestCount}</strong> manifest.json.</p>`;
    if (diagnostics.manifestRanges && diagnostics.manifestRanges.length) {
      html += '<p class="small fw-semibold mb-1">manifest.json ranges found:</p><ul class="small mb-2">';
      diagnostics.manifestRanges.forEach((row) => {
        const r = row.range || {};
        html += `<li><code>${cleanText(row.path, 160)}</code> — ${r.startDate || '—'} – ${r.endDate || '—'}</li>`;
      });
      html += '</ul>';
    }
    if (lines.length) {
      html += '<p class="small fw-semibold mb-1">ZIP files:</p><ul class="small mb-2">' + lines.join('') + '</ul>';
    } else if (diagnostics.zipCount > 0) {
      html += '<p class="small text-muted mb-2">ZIP files found but none match the <code>activity-archive_YYYY-MM-DD_YYYY-MM-DD_EXP-….zip</code> export name pattern.</p>';
    } else if (diagnostics.manifestCount > 0) {
      html += '<p class="small text-muted mb-2">Found manifest.json without a matching ZIP name — adjust your report dates to overlap the manifest range.</p>';
    } else {
      html += '<p class="small text-muted mb-2">Add export ZIP files or an extracted folder with manifest.json and NDJSON files.</p>';
    }
    html += '<p class="small text-muted mb-0">Widen or shift your Step 1 dates to match an export range, then try again.</p>';
    return html;
  }

  function parsedZipsToList(parsedZips) {
    return (parsedZips || []).map((row) => {
      if (!row.parsed) {
        return `<li><code>${cleanText(row.name.split('/').pop(), 120)}</code> — not a recognized export file name</li>`;
      }
      const flag = row.overlaps ? 'overlaps' : 'no overlap';
      return `<li><code>${cleanText(row.parsed.fileName, 140)}</code> — ${row.parsed.startDate} – ${row.parsed.endDate} (<em>${flag}</em>)</li>`;
    });
  }

  async function enrichDiagnosticsWithManifestRanges(diagnostics, fileList) {
    const files = Array.from(fileList || []);
    const manifestFiles = files.filter((f) => {
      const rp = normalizeRelativePath(f);
      return rp === 'manifest.json' || rp.endsWith('/manifest.json');
    });
    const manifestRanges = [];
    for (const mf of manifestFiles) {
      try {
        const manifest = JSON.parse(await readFileAsText(mf));
        manifestRanges.push({ path: normalizeRelativePath(mf), range: manifest.range || {} });
      } catch (_) { /* skip */ }
    }
    diagnostics.manifestRanges = manifestRanges;
    return diagnostics;
  }

  async function findExtractedArchivesOverlapping(fileList, reportSetup) {
    const files = Array.from(fileList || []);
    const manifestFiles = files.filter((f) => {
      const rp = normalizeRelativePath(f);
      return rp === 'manifest.json' || rp.endsWith('/manifest.json');
    });
    const matched = [];
    for (const manifestFile of manifestFiles) {
      let manifest;
      try {
        manifest = JSON.parse(await readFileAsText(manifestFile));
      } catch (_) {
        continue;
      }
      const arc = manifest.range || {};
      if (!Range.dateKeysOverlap(reportSetup.startDate, reportSetup.endDate, arc.startDate, arc.endDate)) {
        continue;
      }
      const rp = normalizeRelativePath(manifestFile);
      const dir = rp.includes('/') ? rp.slice(0, rp.lastIndexOf('/') + 1) : '';
      matched.push({ manifestFile, manifest, dir });
    }
    return matched;
  }

  async function loadExtractedArchivePayload(manifestFile, fileList, dir) {
    const files = Array.from(fileList || []);
    const inDir = (leaf) => files.find((f) => {
      const rp = normalizeRelativePath(f);
      if (!dir) return rp === leaf || rp.endsWith(`/${leaf}`);
      return rp === `${dir}${leaf}` || rp.startsWith(dir) && rp.endsWith(`/${leaf}`);
    });
    const manifest = JSON.parse(await readFileAsText(manifestFile));
    const logsFile = inDir('logs.ndjson');
    const asFile = inDir('action_states.ndjson');
    const logs = logsFile ? parseNdjson(await readFileAsText(logsFile)) : [];
    const actionStates = asFile ? parseNdjson(await readFileAsText(asFile)) : [];
    let sections = [];
    let operations = [];
    const secFile = files.find((f) => normalizeRelativePath(f).includes('reference/sections.json') && normalizeRelativePath(f).startsWith(dir));
    const opFile = files.find((f) => normalizeRelativePath(f).includes('reference/operations.json') && normalizeRelativePath(f).startsWith(dir));
    if (secFile) sections = JSON.parse(await readFileAsText(secFile));
    if (opFile) operations = JSON.parse(await readFileAsText(opFile));
    return {
      manifest,
      logs,
      actionStates,
      refs: { sections, operations },
      sourceFile: dir || 'extracted-folder'
    };
  }

  async function promptOpenFolderPicker() {
    const folderNameHint = 'your export folder';
    const choice = await showMessageModalPrompt({
      title: 'Open folder on your device',
      icon: 'info',
      message: `<p>You will see a <strong>browser confirmation</strong> next (folder access). That dialog is required by the browser; <strong>files are not uploaded to this server</strong>.</p>
        <p class="mb-2">We only read matching <code>activity-archive_*.zip</code> files or extracted <code>manifest.json</code> + NDJSON locally.</p>
        <p class="small text-muted mb-0">Choose <strong>${folderNameHint}</strong> containing your exports, then confirm in the browser dialog.</p>`,
      buttons: [
        { text: 'Cancel', class: 'btn-outline-secondary' },
        { text: 'Choose folder', class: 'btn-primary' }
      ]
    });
    return choice === 'Choose folder';
  }

  async function promptOpenZipPicker() {
    const choice = await showMessageModalPrompt({
      title: 'Open ZIP on your device',
      icon: 'info',
      message: '<p>Select an <code>activity-archive_*.zip</code> export. The file is read locally only — nothing is uploaded to this server.</p>',
      buttons: [
        { text: 'Cancel', class: 'btn-outline-secondary' },
        { text: 'Choose ZIP', class: 'btn-primary' }
      ]
    });
    return choice === 'Choose ZIP';
  }

  async function readManifestFromZipBuffer(buf) {
    if (typeof PizZip === 'undefined') throw new Error('ZIP library not loaded');
    const zip = new PizZip(buf);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('manifest.json missing in ZIP');
    return JSON.parse(manifestFile.asText());
  }

  async function loadFullZipPayloadFromBuffer(buf, sourceFileName) {
    if (typeof PizZip === 'undefined') throw new Error('ZIP library not loaded');
    const zip = new PizZip(buf);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('manifest.json missing in ZIP');
    const manifest = JSON.parse(manifestFile.asText());
    const logsFile = zip.file('logs.ndjson');
    const asFile = zip.file('action_states.ndjson');
    const logs = logsFile ? parseNdjson(logsFile.asText()) : [];
    const actionStates = asFile ? parseNdjson(asFile.asText()) : [];
    let sections = [];
    let operations = [];
    const secRef = zip.file('reference/sections.json');
    const opRef = zip.file('reference/operations.json');
    if (secRef) sections = JSON.parse(secRef.asText());
    if (opRef) operations = JSON.parse(opRef.asText());
    return {
      manifest,
      logs,
      actionStates,
      refs: { sections, operations },
      sourceFile: sourceFileName || 'archive.zip'
    };
  }

  async function loadFullZipPayload(file, sourceFileName) {
    const buf = await file.arrayBuffer();
    return loadFullZipPayloadFromBuffer(buf, sourceFileName || file.name);
  }

  function resolveEffectiveTimezone(manifest) {
    return cleanText(manifest?.timezone, 80) || defaultTimezone;
  }

  function buildFilteredPayload(rawPayload, reportSetup) {
    const tz = resolveEffectiveTimezone(rawPayload.manifest);
    const filtered = Core.filterSourceRecords({
      logs: rawPayload.logs,
      actionStates: rawPayload.actionStates,
      startDate: reportSetup.startDate,
      endDate: reportSetup.endDate,
      timezone: tz,
      userIds: reportSetup.userIds
    });
    return {
      manifest: {
        ...rawPayload.manifest,
        timezone: tz,
        requestedReportRange: {
          startDate: reportSetup.startDate,
          endDate: reportSetup.endDate
        }
      },
      logs: filtered.logs,
      actionStates: filtered.actionStates,
      refs: rawPayload.refs,
      sourceFile: rawPayload.sourceFile,
      effectiveTimezone: tz,
      loadStats: {
        truncated: false,
        viewCapped: false,
        matchedCount: filtered.logs.length,
        recordLimit: getRecordLimit(),
        requestedStartDate: reportSetup.startDate,
        requestedEndDate: reportSetup.endDate
      }
    };
  }

  async function stageFilteredPayload(filteredPayload, reportSetup) {
    const Session = window.LogArchiveLocalSession;
    const Staging = window.LogArchiveStaging;
    if (!Session || !Staging || typeof Staging.createStagingWriter !== 'function') {
      throw new Error('Local staging is not available in this browser.');
    }
    const sessionId = Session.createSessionId();
    await Staging.clearSessionStaging(sessionId);
    const writer = Staging.createStagingWriter(sessionId, {
      timezone: filteredPayload.effectiveTimezone,
      requestedStartDate: reportSetup.startDate,
      requestedEndDate: reportSetup.endDate
    });
    await writer.appendLogs(filteredPayload.logs);
    await writer.appendActionStates(filteredPayload.actionStates);
    const { manifest } = await writer.finalize(
      {
        ...filteredPayload.manifest,
        exportId: filteredPayload.manifest?.exportId,
        timezone: filteredPayload.effectiveTimezone
      },
      filteredPayload.refs
    );

    const matchedCount = filteredPayload.logs.length;
    const viewLimit = getRecordLimit();
    let viewLogs = filteredPayload.logs;
    let viewActionStates = filteredPayload.actionStates;
    const loadStats = {
      ...filteredPayload.loadStats,
      matchedCount,
      totalStaged: Number(manifest.counts?.logs) || matchedCount,
      recordLimit: viewLimit,
      truncated: false,
      viewCapped: false
    };

    if (matchedCount > viewLimit) {
      const limited = Core.truncateRecordsToLimit({
        logs: viewLogs,
        actionStates: viewActionStates,
        limit: viewLimit,
        timezone: filteredPayload.effectiveTimezone,
        requestedStartDate: reportSetup.startDate,
        requestedEndDate: reportSetup.endDate
      });
      viewLogs = limited.logs;
      viewActionStates = limited.actionStates;
      loadStats.truncated = true;
      loadStats.viewCapped = true;
      loadStats.effectiveStartDate = limited.effectiveStartDate;
      loadStats.effectiveEndDate = limited.effectiveEndDate;
    }

    if (Staging.getMirrorDirectoryHandle?.()) {
      try {
        await Staging.mirrorSessionToDirectory(sessionId);
      } catch (err) {
        console.warn('Could not mirror staging folder', err);
      }
    }

    return {
      manifest,
      logs: viewLogs,
      actionStates: viewActionStates,
      refs: filteredPayload.refs,
      sourceFile: filteredPayload.sourceFile,
      effectiveTimezone: filteredPayload.effectiveTimezone,
      loadStats,
      sessionId,
      storageBackend: writer.backend,
      staging: true
    };
  }

  function buildTruncationCopy(loadStats) {
    if (!loadStats?.viewCapped && !loadStats?.truncated) return '';
    const staged = Number(loadStats.totalStaged || loadStats.matchedCount || 0);
    const limit = Number(loadStats.recordLimit || 0);
    const reqEnd = cleanText(loadStats.requestedEndDate, 10);
    const effEnd = cleanText(loadStats.effectiveEndDate, 10);
    return `<strong>${staged.toLocaleString()}</strong> record(s) staged locally; the activity table uses the first `
      + `<strong>${limit.toLocaleString()}</strong> (earliest in range). `
      + `Track Activity reads the full staged archive. `
      + (effEnd && reqEnd && effEnd !== reqEnd
        ? `Table view through <strong>${effEnd}</strong> (requested through <strong>${reqEnd}</strong>).`
        : '');
  }

  function showTruncationNotice(loadStats, effectiveStart, effectiveEnd) {
    const copy = buildTruncationCopy({
      ...loadStats,
      effectiveEndDate: effectiveEnd,
      effectiveStartDate: effectiveStart
    });
    if (!copy) {
      if (truncationNoticeEl) {
        truncationNoticeEl.classList.add('d-none');
        truncationNoticeEl.innerHTML = '';
      }
      return;
    }
    if (truncationNoticeEl) {
      truncationNoticeEl.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>${copy}`;
      truncationNoticeEl.classList.remove('d-none');
    }
  }

  function applyEffectiveReportDatesToStep1(startDate, endDate) {
    if (reportStartInput && startDate) reportStartInput.value = startDate;
    if (reportEndInput && endDate) reportEndInput.value = endDate;
    syncStep2FromDates();
  }

  function effectiveReportSetupFromPayload(reportSetup, payload) {
    const range = payload?.manifest?.reportRange || {};
    return {
      ...reportSetup,
      startDate: cleanText(range.startDate, 10) || reportSetup.startDate,
      endDate: cleanText(range.endDate, 10) || reportSetup.endDate
    };
  }

  function stashArchive(payload, events) {
    archive = payload;
    allEvents = events;
    filteredEvents = events.slice();
    if (panel) panel.classList.add('d-none');
    hideStep3Ready();
    if (summaryRow) summaryRow.innerHTML = '';
    if (tbody) tbody.innerHTML = '';
    if (pageMeta) pageMeta.textContent = '';
    if (filterForm) {
      filterForm.startAt.value = `${reportSetupSafeStart(payload)}T00:00`;
      filterForm.endAt.value = `${reportSetupSafeEnd(payload)}T23:59`;
    }
  }

  function reportSetupSafeStart(payload) {
    return cleanText(payload?.manifest?.reportRange?.startDate || payload?.manifest?.range?.startDate, 10);
  }

  function reportSetupSafeEnd(payload) {
    return cleanText(payload?.manifest?.reportRange?.endDate || payload?.manifest?.range?.endDate, 10);
  }

  function hideStep3Ready() {
    if (step3Card) step3Card.classList.add('d-none');
    if (step3Summary) step3Summary.innerHTML = '';
  }

  function buildStep3SummaryHtml(eventCount, payload, loadStats) {
    const start = reportSetupSafeStart(payload);
    const end = reportSetupSafeEnd(payload);
    const logs = Number(payload?.manifest?.counts?.logs)
      || Number(payload?.loadStats?.totalStaged)
      || (payload?.logs || []).length;
    const exportId = cleanText(payload?.manifest?.exportId, 120) || 'archive';
    let html = `<p class="mb-2"><span class="badge text-bg-success me-2">Loaded</span>`
      + `<strong>${start}</strong> – <strong>${end}</strong> · `
      + `<strong>${eventCount.toLocaleString()}</strong> events · `
      + `<strong>${logs.toLocaleString()}</strong> logs · Export <strong>${exportId}</strong></p>`;
    const truncHtml = buildTruncationCopy({
      ...(loadStats || payload?.loadStats || {}),
      effectiveEndDate: end
    });
    if (truncHtml) {
      html += `<div class="alert alert-warning py-2 px-3 mb-0 small log-archive-truncation-notice">${truncHtml}</div>`;
    }
    return html;
  }

  function showStep3ReadyActions(eventCount, payload, loadStats) {
    if (!step3Card || !step3Summary) return;
    step3Summary.innerHTML = buildStep3SummaryHtml(eventCount, payload, loadStats);
    step3Card.classList.remove('d-none');
  }

  function revealAnalyzerPanel() {
    if (!archive) return;
    if (panel) {
      panel.classList.remove('d-none');
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (loadMeta) {
      loadMeta.textContent = `Showing activity table · ${allEvents.length.toLocaleString()} events · ${reportSetupSafeStart(archive)} – ${reportSetupSafeEnd(archive)}`;
    }
    page = 1;
    renderSummary();
    renderTable();
  }

  function buildLocalSessionPageUrl(path, sessionId) {
    const sid = String(sessionId || window.LogArchiveLocalSession?.getActiveSessionId?.() || '').trim();
    const base = String(path || '').trim();
    if (!sid) return `${base}?local=1`;
    return `${base}?local=1&localSession=${encodeURIComponent(sid)}`;
  }

  function buildTrackActivityLocalUrl(sessionId) {
    return buildLocalSessionPageUrl('/security/track-activity', sessionId);
  }

  function buildUserTimelineLocalUrl(sessionId) {
    return buildLocalSessionPageUrl('/logs/archive/user-timeline', sessionId);
  }

  function syncOutboundLocalSessionLinks(sessionId) {
    const trackUrl = buildTrackActivityLocalUrl(sessionId);
    if (reviewTrackBtn && reviewTrackBtn.tagName === 'A') {
      reviewTrackBtn.href = trackUrl;
    }
    const timelineUrl = buildUserTimelineLocalUrl(sessionId);
    if (userTimelineBtn && userTimelineBtn.tagName === 'A') {
      userTimelineBtn.href = timelineUrl;
    }
  }

  function updateLoadMetaReady(eventCount, payload, loadStats) {
    if (!loadMeta) return;
    const start = reportSetupSafeStart(payload);
    const end = reportSetupSafeEnd(payload);
    loadMeta.innerHTML = `<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>Archive loaded</span> `
      + `<span class="text-muted">(${start} – ${end})</span>`;
    syncOutboundLocalSessionLinks(payload?.sessionId);
    showStep3ReadyActions(eventCount, payload, loadStats);
  }

  async function persistLocalSession(rawPayload, reportSetup, eventCount, metaExtra) {
    const Session = window.LogArchiveLocalSession;
    if (!Session || typeof Session.saveSession !== 'function') return;
    const loadStats = rawPayload?.loadStats || {};
    const requested = rawPayload?.manifest?.requestedReportRange || {};
    const totalStaged = Number(loadStats.totalStaged || rawPayload?.manifest?.counts?.logs || 0);
    try {
      await Session.saveSession({
        id: rawPayload.sessionId,
        staging: Boolean(rawPayload.staging),
        storageBackend: rawPayload.storageBackend || rawPayload.manifest?.storageBackend || '',
        logs: rawPayload.staging ? [] : (rawPayload.logs || []),
        actionStates: rawPayload.staging ? [] : (rawPayload.actionStates || []),
        refs: rawPayload.refs || { sections: [], operations: [] },
        manifest: rawPayload.manifest || {},
        reportSetup: {
          startDate: reportSetup.startDate,
          endDate: reportSetup.endDate,
          userIds: reportSetup.userIds || [],
          selectedUsers: reportSetup.selectedUsers || []
        },
        meta: {
          ...(metaExtra || {}),
          loadedAt: new Date().toISOString(),
          eventCount,
          logCount: totalStaged || (rawPayload.logs || []).length,
          viewCappedInAnalyzer: Boolean(loadStats.viewCapped),
          truncated: Boolean(loadStats.viewCapped),
          matchedLogCount: Number(loadStats.matchedCount || totalStaged || 0),
          recordLimit: Number(loadStats.recordLimit || getRecordLimit()),
          requestedReportRange: {
            startDate: cleanText(requested.startDate || loadStats.requestedStartDate, 10),
            endDate: cleanText(requested.endDate || loadStats.requestedEndDate, 10)
          }
        }
      });
    } catch (err) {
      console.warn('Could not persist local archive session', err);
    }
  }

  function renderSummary() {
    if (!summaryRow) return;
    const total = filteredEvents.length;
    const success = filteredEvents.filter((e) => /success|completed/i.test(e.statusRaw)).length;
    const failure = filteredEvents.filter((e) => /fail|error|denied|blocked/i.test(e.statusRaw)).length;
    summaryRow.innerHTML = `
      <div class="col-md-4"><div class="card border-0 shadow-sm p-3 border-start border-4 border-primary"><div class="small text-muted">Events</div><div class="fs-4 fw-bold">${total}</div></div></div>
      <div class="col-md-4"><div class="card border-0 shadow-sm p-3 border-start border-4 border-success"><div class="small text-muted">Success-ish</div><div class="fs-4 fw-bold">${success}</div></div></div>
      <div class="col-md-4"><div class="card border-0 shadow-sm p-3 border-start border-4 border-danger"><div class="small text-muted">Failure-ish</div><div class="fs-4 fw-bold">${failure}</div></div></div>`;
  }

  function renderTable() {
    if (!tbody) return;
    const start = (page - 1) * pageSize;
    const rows = filteredEvents.slice(start, start + pageSize);
    tbody.innerHTML = rows.map((ev) => `
      <tr>
        <td class="small">${ev.occurredAt || ''}</td>
        <td class="small">${ev.displayName || ev.userId || ''}</td>
        <td class="small">${ev.sectionName || ''}</td>
        <td class="small">${ev.operationName || ''}</td>
        <td class="small">${ev.statusRaw || ''}</td>
        <td class="small">${ev.summary || ''}</td>
      </tr>`).join('');
    const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
    if (pageMeta) pageMeta.textContent = `Page ${page} of ${totalPages} (${filteredEvents.length} events)`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }

  function applyFilters() {
    if (!filterForm) return;
    const fd = new FormData(filterForm);
    const startAt = cleanText(fd.get('startAt'), 40);
    const endAt = cleanText(fd.get('endAt'), 40);
    const userId = cleanText(fd.get('userId'), 120);
    const q = cleanText(fd.get('q'), 200).toLowerCase();
    const source = cleanText(fd.get('source'), 40);
    const startMs = startAt ? new Date(startAt).getTime() : Number.NEGATIVE_INFINITY;
    const endMs = endAt ? new Date(endAt).getTime() : Number.POSITIVE_INFINITY;
    filteredEvents = allEvents.filter((ev) => {
      const ms = Number(ev.occurredAtMs || 0);
      if (ms < startMs || ms > endMs) return false;
      if (userId && ev.userId !== userId) return false;
      if (source === 'action_state' && !ev.hasActionState) return false;
      if (q) {
        const blob = [ev.summary, ev.displayName, ev.userId, ev.sectionName, ev.operationName, ev.statusRaw].join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    page = 1;
    renderTable();
    renderSummary();
  }

  async function exportCsv() {
    if (!filteredEvents.length) {
      await showUserMessage({ title: 'Nothing to export', icon: 'warning', message: 'Load a report with events before exporting CSV.' });
      return;
    }
    const header = ['Timestamp', 'User', 'UserId', 'Section', 'Operation', 'Status', 'Summary'];
    const lines = [header.join(',')];
    filteredEvents.forEach((ev) => {
      const row = [ev.occurredAt, ev.displayName, ev.userId, ev.sectionName, ev.operationName, ev.statusRaw, ev.summary]
        .map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`);
      lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'archive-activity-export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await showUserMessage({ title: 'CSV export', icon: 'success', message: `Download started for <strong>${filteredEvents.length}</strong> filtered event(s).` });
  }

  function buildSuccessSummary(payload, eventCount, meta) {
    const manifest = payload.manifest || {};
    const exportId = cleanText(manifest.exportId, 120) || 'archive';
    const reportRange = manifest.reportRange || {};
    let html = `<p class="mb-2">Report ready for <strong>${cleanText(reportRange.startDate, 10)}</strong> – <strong>${cleanText(reportRange.endDate, 10)}</strong>.</p>`;
    html += `<ul class="small mb-2">
      <li>Archive: <strong>${exportId}</strong></li>
      <li><strong>${eventCount}</strong> timeline event(s)</li>
      <li><strong>${(Number(payload.manifest?.counts?.logs) || Number(payload.loadStats?.totalStaged) || (payload.logs || []).length).toLocaleString()}</strong> log record(s) staged</li>
    </ul>`;
    const truncCopy = buildTruncationCopy({
      ...(payload.loadStats || {}),
      effectiveEndDate: reportRange.endDate
    });
    if (truncCopy) {
      html += `<p class="small text-warning mb-2">${truncCopy}</p>`;
    }
    if (meta.partialCoverage) {
      html += '<p class="small text-warning mb-2">Your report range extends beyond this export manifest; only overlapping dates were included.</p>';
    }
    if (meta.timezoneMismatch) {
      html += '<p class="small text-warning mb-2">Merged archives use different timezones; day boundaries may be approximate.</p>';
    }
    if (meta.sourceFiles && meta.sourceFiles.length > 1) {
      html += `<p class="small text-muted mb-2">Merged ${meta.sourceFiles.length} ZIP file(s).</p>`;
    }
    html += '<p class="small text-muted mb-0">Use <strong>View activity table</strong> on this page or <strong>Review in Track Activity</strong> for the full timeline.</p>';
    return html;
  }

  async function promptAfterLoadSuccess(payload, eventCount, meta) {
    await transitionProgressToMessagePrompt({
      title: payload.loadStats?.truncated ? 'Archive loaded (partial)' : 'Archive loaded',
      icon: payload.loadStats?.truncated ? 'warning' : 'success',
      message: `${buildSuccessSummary(payload, eventCount, meta)}<p class="small text-muted mb-0">Choose an option in <strong>Step 3</strong> below.</p>`,
      buttons: [{ text: 'OK', class: 'btn-primary btn-filled' }]
    });
  }

  async function closeProgressModal() {
    enableMessageModalButtons();
    const parts = getMessageModalElements();
    if (parts && window.bootstrap?.Modal) {
      const inst = window.bootstrap.Modal.getInstance(parts.modalEl);
      if (inst && parts.modalEl.classList.contains('show')) inst.hide();
    }
  }

  async function handleLoadError(err, fallbackMessage) {
    await transitionProgressToMessagePrompt({
      title: 'Could not load archive',
      icon: 'error',
      message: err?.htmlMessage || cleanText(err?.message, 1200) || fallbackMessage,
      buttons: [{ text: 'OK', class: 'btn-primary' }]
    });
    if (loadMeta) loadMeta.textContent = '';
  }

  function makeProgress(steps) {
    const done = [];
    const indexById = new Map(steps.map((s, i) => [s.id, i]));
    return {
      async tick(stepId) {
        const idx = indexById.get(stepId) ?? 0;
        advanceLoadProgress(stepId, done.slice(), Math.round((idx / steps.length) * 100));
        await yieldToUi();
      },
      complete(stepId) {
        if (!done.includes(stepId)) done.push(stepId);
      },
      done
    };
  }

  async function finalizePayload(rawPayload, reportSetup, metaExtra, progress) {
    const matchedCount = (rawPayload?.logs || []).length;
    if (matchedCount === 0) {
      await transitionProgressToMessagePrompt({
        title: 'No records in range',
        icon: 'warning',
        message: '<p>No log records matched your report period and user filters.</p><p class="mb-0">Try different dates or clear user filters.</p>'
      });
      if (loadMeta) loadMeta.textContent = '';
      return false;
    }
    if (progress) await progress.tick('stage');
    const stagedPayload = await stageFilteredPayload(rawPayload, reportSetup);
    if (progress) progress.complete('stage');

    const loadStats = stagedPayload.loadStats || {};
    const events = Core.buildTimelineEvents(
      stagedPayload.manifest,
      stagedPayload.logs,
      stagedPayload.actionStates,
      stagedPayload.refs
    );
    const effectiveSetup = effectiveReportSetupFromPayload(reportSetup, stagedPayload);
    applyEffectiveReportDatesToStep1(effectiveSetup.startDate, effectiveSetup.endDate);
    showTruncationNotice(loadStats, effectiveSetup.startDate, effectiveSetup.endDate);
    stashArchive(stagedPayload, events);
    await persistLocalSession(stagedPayload, effectiveSetup, events.length, metaExtra || {});
    updateLoadMetaReady(events.length, stagedPayload, loadStats);
    await promptAfterLoadSuccess(stagedPayload, events.length, { ...(metaExtra || {}), ...loadStats });
    return true;
  }

  async function processZipFile(file) {
    const reportSetup = getReportSetup();
    const validation = validateReportSetup();
    if (!validation.ok) throw new Error(validation.message);

    const progress = makeProgress(LOAD_STEPS_ZIP);
    openLoadProgressModal(LOAD_STEPS_ZIP, 'Loading ZIP');
    try {
      await progress.tick('validate');
      progress.complete('validate');

      await progress.tick('read');
      const buf = await file.arrayBuffer();
      progress.complete('read');

      await progress.tick('manifest');
      const manifest = await readManifestFromZipBuffer(buf);
      const arc = manifest.range || {};
      if (!Range.dateKeysOverlap(reportSetup.startDate, reportSetup.endDate, arc.startDate, arc.endDate)) {
        throw new Error(`This export (${arc.startDate || '—'} – ${arc.endDate || '—'}) does not overlap your report period.`);
      }
      const partialCoverage = Range.userRangeExtendsBeyondManifest(
        reportSetup.startDate,
        reportSetup.endDate,
        arc.startDate,
        arc.endDate
      );
      progress.complete('manifest');

      await progress.tick('parse');
      const raw = await loadFullZipPayloadFromBuffer(buf, file.name);
      progress.complete('parse');

      await progress.tick('filter');
      const filteredPayload = buildFilteredPayload(raw, reportSetup);
      progress.complete('filter');

      await progress.tick('events');
      await finalizePayload(filteredPayload, reportSetup, { partialCoverage, sourceFiles: [file.name] }, progress);
      progress.complete('events');
    } catch (err) {
      await handleLoadError(err, 'Failed to read ZIP.');
    }
  }

  async function processFolder(fileList) {
    const reportSetup = getReportSetup();
    const validation = validateReportSetup();
    if (!validation.ok) throw new Error(validation.message);

    const progress = makeProgress(LOAD_STEPS_FOLDER);
    openLoadProgressModal(LOAD_STEPS_FOLDER, 'Loading folder');
    try {
      await progress.tick('validate');
      progress.complete('validate');

      await progress.tick('scan');
      const files = Array.from(fileList || []);
      const diagnostics = buildFolderScanDiagnostics(files, reportSetup);
      const zipEntries = files.filter((f) => /\.zip$/i.test(String(f.name || '')));
      const names = zipEntries.map((f) => normalizeRelativePath(f));
      const candidates = Core.quickFilterZipNames(names, reportSetup.startDate, reportSetup.endDate);
      progress.complete('scan');

      await progress.tick('manifest');
      const matchedFiles = [];
      for (const candidate of candidates) {
        const file = zipEntries.find((f) => {
          const path = normalizeRelativePath(f);
          const base = path.split('/').pop();
          return path === candidate.name || base === candidate.fileName || base === candidate.name.split('/').pop();
        });
        if (!file) continue;
        const manifest = await readManifestFromZipBuffer(await file.arrayBuffer());
        const arc = manifest.range || {};
        if (Range.dateKeysOverlap(reportSetup.startDate, reportSetup.endDate, arc.startDate, arc.endDate)) {
          matchedFiles.push({ file, manifest });
        }
      }

      let payloads = [];
      if (matchedFiles.length) {
        progress.complete('manifest');
        await progress.tick('read');
        for (const entry of matchedFiles) {
          payloads.push(await loadFullZipPayload(entry.file, normalizeRelativePath(entry.file)));
        }
        progress.complete('read');
      } else {
        const extracted = await findExtractedArchivesOverlapping(files, reportSetup);
        if (!extracted.length) {
          await enrichDiagnosticsWithManifestRanges(diagnostics, files);
          const err = new Error('No matching archives in folder.');
          err.htmlMessage = buildFolderScanErrorHtml(diagnostics);
          throw err;
        }
        progress.complete('manifest');
        await progress.tick('read');
        for (const entry of extracted) {
          payloads.push(await loadExtractedArchivePayload(entry.manifestFile, files, entry.dir));
        }
        progress.complete('read');
      }

      if (!payloads.length) {
        await enrichDiagnosticsWithManifestRanges(diagnostics, files);
        const err = new Error('No matching archives in folder.');
        err.htmlMessage = buildFolderScanErrorHtml(diagnostics);
        throw err;
      }

      await progress.tick('merge');
      const merged = Core.mergeArchivePayloads(payloads);
      const filteredPayload = buildFilteredPayload(merged, reportSetup);
      filteredPayload.timezoneMismatch = merged.timezoneMismatch;
      progress.complete('merge');

      await progress.tick('events');
      await finalizePayload(filteredPayload, reportSetup, {
        partialCoverage: false,
        timezoneMismatch: merged.timezoneMismatch,
        sourceFiles: merged.sourceFiles
      }, progress);
      progress.complete('events');
    } catch (err) {
      await handleLoadError(err, 'Failed to read folder.');
    }
  }

  function resetAnalyzerClientStateAfterPurge() {
    archive = null;
    allEvents = [];
    filteredEvents = [];
    page = 1;
    hideStep3Ready();
    if (panel) panel.classList.add('d-none');
    if (loadMeta) loadMeta.textContent = '';
    if (truncationNoticeEl) {
      truncationNoticeEl.classList.add('d-none');
      truncationNoticeEl.innerHTML = '';
    }
    syncOutboundLocalSessionLinks('');
  }

  async function collectLocalArchiveLeftoverSummary() {
    const Session = window.LogArchiveLocalSession;
    const Staging = window.LogArchiveStaging;
    if (!Session) return { hasAny: false };
    const sessions = typeof Session.listAllSessions === 'function'
      ? await Session.listAllSessions()
      : [];
    let staging = { sessionIds: [], idbFileCount: 0, opfsSessionIds: [] };
    if (Staging && typeof Staging.scanStagingFootprint === 'function') {
      staging = await Staging.scanStagingFootprint();
    }
    const activeSessionId = Session.getActiveSessionId?.() || '';
    const hasAny = Boolean(
      sessions.length
      || staging.idbFileCount
      || (staging.opfsSessionIds && staging.opfsSessionIds.length)
      || activeSessionId
    );
    return {
      hasAny,
      sessions,
      staging,
      activeSessionId
    };
  }

  function buildLeftoverCleanupMessage(summary) {
    const sessionRows = (summary.sessions || []).map((row) => {
      const logs = Number(row?.manifest?.counts?.logs || row?.meta?.logCount || (row?.logs || []).length || 0);
      const savedAt = cleanText(row?.savedAt, 40) || '—';
      return `<li>Session <code>${cleanText(row?.id, 80)}</code> · ${logs.toLocaleString()} log(s) · saved ${savedAt}</li>`;
    }).join('');
    const stagingIds = summary.staging?.sessionIds || [];
    let html = '<p>Leftover data from a previous Local Archive Analyzer run was found in this browser (IndexedDB / private file storage).</p>';
    html += '<ul class="small mb-2">';
    if (sessionRows) html += sessionRows;
    else html += '<li>No saved session records</li>';
    html += '</ul>';
    html += `<p class="small mb-2">Staging footprint: <strong>${stagingIds.length}</strong> staged session folder(s), `
      + `<strong>${Number(summary.staging?.idbFileCount || 0).toLocaleString()}</strong> chunked IndexedDB file(s), `
      + `<strong>${(summary.staging?.opfsSessionIds || []).length}</strong> OPFS session folder(s).</p>`;
    if (summary.activeSessionId) {
      html += `<p class="small text-muted mb-2">Active session pointer: <code>${cleanText(summary.activeSessionId, 80)}</code></p>`;
    }
    html += '<p class="mb-0">It has been removed so this page starts clean. Track Activity tabs using an old local session will need a new load from here.</p>';
    return html;
  }

  async function purgeLeftoverLocalArchiveOnPageOpen() {
    const Session = window.LogArchiveLocalSession;
    if (!Session || typeof Session.clearAllSessions !== 'function') return;
    try {
      const summary = await collectLocalArchiveLeftoverSummary();
      if (!summary.hasAny) return;
      await Session.clearAllSessions();
      resetAnalyzerClientStateAfterPurge();
      await showUserMessage({
        title: 'Previous local archive data cleared',
        icon: 'info',
        message: buildLeftoverCleanupMessage(summary)
      });
    } catch (err) {
      console.warn('Local archive leftover cleanup failed', err);
      await showUserMessage({
        title: 'Could not verify local storage',
        icon: 'warning',
        message: `<p class="mb-0">${cleanText(err?.message, 600) || 'Cleanup failed. You can continue, but old staged data may still be on this device.'}</p>`
      });
    }
  }

  bindReportDateListeners();
  initRecordLimitInput();
  initUserPicker();
  void purgeLeftoverLocalArchiveOnPageOpen();
  if (openPanelBtn) openPanelBtn.addEventListener('click', () => revealAnalyzerPanel());
  const localInfoBtn = document.getElementById('logArchiveLocalInfoBtn');
  if (localInfoBtn) {
    localInfoBtn.addEventListener('click', () => {
      void showUserMessage({
        title: 'Local processing & privacy',
        icon: 'info',
        message: `<p><strong>Local only — nothing is uploaded.</strong></p>
          <p class="mb-2">Archive ZIP and folder bytes are read on your device only. Filtered records are staged in private browser storage (OPFS or chunked IndexedDB) as manifest + NDJSON chunks.</p>
          <p class="mb-2">Optional <strong>Save staging copy to folder</strong> writes a mirror under <code>.log-archive-analyzer-staging/&lt;sessionId&gt;/</code> when your browser supports writable folder pick.</p>
          <p class="small text-muted mb-0">Loading this page fetches HTML and scripts once. Opening an archive does not send your files to the server.</p>`
      });
    });
  }

  if (openZipBtn && zipInput) {
    openZipBtn.addEventListener('click', async () => {
      if (!validateReportSetup().ok) {
        await showUserMessage({ title: 'Report period required', icon: 'warning', message: 'Set start and end dates in Step 1 first.' });
        return;
      }
      if (await promptOpenZipPicker()) zipInput.click();
    });
  }

  if (zipInput) {
    zipInput.addEventListener('change', async () => {
      const file = zipInput.files && zipInput.files[0];
      zipInput.value = '';
      if (!file) return;
      await processZipFile(file);
    });
  }

  if (openFolderBtn && folderInput) {
    openFolderBtn.addEventListener('click', async () => {
      if (!validateReportSetup().ok) {
        await showUserMessage({ title: 'Report period required', icon: 'warning', message: 'Set start and end dates in Step 1 first.' });
        return;
      }
      if (await promptOpenFolderPicker()) folderInput.click();
    });
  }

  if (folderInput) {
    folderInput.addEventListener('change', async () => {
      const files = Array.from(folderInput.files || []);
      folderInput.value = '';
      if (!files.length) return;
      await processFolder(files);
    });
  }

  if (mirrorFolderBtn) {
    const Staging = window.LogArchiveStaging;
    if (!Staging?.supportsWritableDirectoryPicker?.()) {
      mirrorFolderBtn.classList.add('d-none');
    } else {
      mirrorFolderBtn.addEventListener('click', async () => {
        try {
          await Staging.pickMirrorDirectory();
          const sessionId = window.LogArchiveLocalSession?.getActiveSessionId?.();
          if (sessionId) {
            const ok = await Staging.mirrorSessionToDirectory(sessionId);
            await showUserMessage({
              title: ok ? 'Staging copy saved' : 'Nothing to mirror',
              icon: ok ? 'success' : 'warning',
              message: ok
                ? '<p class="mb-0">Latest session files were written under <code>.log-archive-analyzer-staging/</code> in the folder you picked.</p>'
                : '<p class="mb-0">Load an archive first, then mirror again.</p>'
            });
          } else {
            await showUserMessage({
              title: 'Folder selected',
              icon: 'success',
              message: '<p class="mb-0">The next archive load will also mirror staging files into this folder.</p>'
            });
          }
        } catch (err) {
          await showUserMessage({
            title: 'Could not use folder',
            icon: 'error',
            message: cleanText(err?.message, 800) || 'Writable folder pick failed.'
          });
        }
      });
    }
  }

  if (filterForm) filterForm.addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
  if (csvBtn) csvBtn.addEventListener('click', () => { void exportCsv(); });
  if (prevBtn) prevBtn.addEventListener('click', () => { page -= 1; renderTable(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { page += 1; renderTable(); });
})();
