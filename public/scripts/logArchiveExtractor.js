(function () {
  const form = document.getElementById('logArchiveExportForm');
  const msgEl = document.getElementById('logArchiveExportMsg');
  const refreshBtn = document.getElementById('logArchiveRefreshStatusBtn');
  const deleteForm = document.getElementById('logArchiveDeleteForm');
  if (!form && !deleteForm) return;

  let localArchiveFiles = [];
  let lastDeleteVerification = null;
  let lastDeletePreview = null;
  let lastLocalVerificationPayload = null;
  let lastDeleteAnalysis = null;

  function showDeleteStep3(show) {
    const block = document.getElementById('logArchiveDeleteStep3Block');
    if (block) block.classList.toggle('d-none', !show);
  }

  function renderMismatchErrorPanel(verification, preview) {
    const panel = document.getElementById('logArchiveDeleteMismatchPanel');
    if (!panel) return;
    if (!verification || verification.ok) {
      panel.classList.add('d-none');
      panel.innerHTML = '';
      return;
    }
    panel.classList.remove('d-none');
    const local = verification.localCounts || {};
    const server = verification.serverCounts || preview?.counts || {};
    const code = String(verification.code || '').trim();
    let detailHtml = '';
    if (code === 'LOCAL_COUNT_INSUFFICIENT') {
      detailHtml = `
        <table class="table table-sm table-bordered mb-2 bg-white">
          <thead><tr><th scope="col">Collection</th><th scope="col">Local backup (manifest)</th><th scope="col">Database in range</th></tr></thead>
          <tbody>
            <tr><td>Logs</td><td>${Number(local.logs || 0).toLocaleString()}</td><td>${Number(server.logs || 0).toLocaleString()}</td></tr>
            <tr><td>Action states</td><td>${Number(local.actionStates || 0).toLocaleString()}</td><td>${Number(server.actionStates || 0).toLocaleString()}</td></tr>
          </tbody>
        </table>
        <p class="mb-0">The database has more records in this date range than your export manifest reports. Export a fresh ZIP for this range, or include a complete archive with <code>logs.ndjson</code> / <code>action_states.ndjson</code>.</p>`;
    } else if (code === 'LOCAL_COVERAGE_GAP') {
      detailHtml = `<p class="mb-0">Your delete range (<strong>${verification.deleteRange?.startDate || '—'}</strong> → `
        + `<strong>${verification.deleteRange?.endDate || '—'}</strong>) is wider than the archive coverage (`
        + `<strong>${verification.coveredRange?.startDate || '—'}</strong> → `
        + `<strong>${verification.coveredRange?.endDate || '—'}</strong>). Add another export ZIP or use a folder that covers all dates.</p>`;
    } else {
      detailHtml = `<p class="mb-0">${verification.message || 'Verification did not pass.'}</p>`;
    }
    panel.innerHTML = `
      <div class="fw-semibold mb-2"><i class="bi bi-exclamation-octagon me-1"></i>Data mismatch — Step 3 delete is blocked</div>
      <p class="mb-2"><strong>${code || 'VERIFICATION_FAILED'}</strong>: ${verification.message || 'Could not verify local backup against the database.'}</p>
      ${detailHtml}`;
  }

  function buildWaitModalHtml(startDate, endDate, actionLabel) {
    const start = String(startDate || '').trim() || '—';
    const end = String(endDate || '').trim() || '—';
    const label = String(actionLabel || 'Working').trim();
    return `<p class="mb-2">${label} for <strong>${start}</strong> through <strong>${end}</strong>.</p>
      <p class="small text-muted mb-2">Large date ranges can take several minutes. Please keep this tab open.</p>
      <div class="progress" style="height: 1rem;">
        <div class="progress-bar progress-bar-striped progress-bar-animated w-100" role="progressbar" aria-valuenow="100" aria-valuemin="0" aria-valuemax="100">Working…</div>
      </div>`;
  }

  function buildAnalyzeWaitModalHtml(phaseLabel, detailText) {
    const phase = String(phaseLabel || 'Working').trim();
    const detail = String(detailText || '').trim();
    return `<p class="mb-2 fw-semibold">${phase}</p>
      <p class="small text-muted mb-3">${detail || 'Please keep this tab open until analysis finishes.'}</p>
      <div class="progress" style="height: 1rem;">
        <div class="progress-bar progress-bar-striped progress-bar-animated w-100" role="progressbar" aria-busy="true">Working…</div>
      </div>`;
  }

  function updateAnalyzeWaitModal(phaseLabel, detailText) {
    const bodyEl = document.getElementById('messageModalBody');
    if (bodyEl) {
      bodyEl.innerHTML = buildAnalyzeWaitModalHtml(phaseLabel, detailText);
    }
  }

  function openAnalyzeWaitModal(phaseLabel, detailText) {
    if (typeof window.showMessageModal !== 'function') return;
    lockMessageModalWhileBusy();
    void window.showMessageModal({
      title: 'Analyzing archive',
      icon: 'info',
      message: buildAnalyzeWaitModalHtml(phaseLabel, detailText),
      buttons: [{ text: 'Please wait…', class: 'btn-outline-secondary' }]
    });
    lockMessageModalWhileBusy();
  }

  function scrollDeleteStep3IntoView() {
    const block = document.getElementById('logArchiveDeleteStep3Block');
    if (block && typeof block.scrollIntoView === 'function') {
      block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function lockMessageModalWhileBusy() {
    const modalEl = document.getElementById('messageModal');
    if (!modalEl) return;
    const apply = () => {
      const closeBtn = modalEl.querySelector('.btn-close');
      if (closeBtn) closeBtn.classList.add('d-none');
      modalEl.querySelectorAll('#messageModalButtons button').forEach((btn) => {
        btn.disabled = true;
        btn.classList.add('disabled');
      });
    };
    if (modalEl.classList.contains('show')) apply();
    else modalEl.addEventListener('shown.bs.modal', apply, { once: true });
  }

  function unlockMessageModalChrome() {
    const modalEl = document.getElementById('messageModal');
    if (!modalEl) return;
    const closeBtn = modalEl.querySelector('.btn-close');
    if (closeBtn) closeBtn.classList.remove('d-none');
  }

  function openOperationWaitModal(startDate, endDate, actionLabel) {
    if (typeof window.showMessageModal !== 'function') return;
    lockMessageModalWhileBusy();
    void window.showMessageModal({
      title: 'Performing operation',
      icon: 'info',
      message: buildWaitModalHtml(startDate, endDate, actionLabel),
      buttons: [{ text: 'Please wait…', class: 'btn-outline-secondary' }]
    });
    lockMessageModalWhileBusy();
  }

  function closeOperationWaitModal() {
    const modalEl = document.getElementById('messageModal');
    unlockMessageModalChrome();
    if (!modalEl || !window.bootstrap?.Modal) return Promise.resolve();
    const inst = window.bootstrap.Modal.getInstance(modalEl);
    if (inst && modalEl.classList.contains('show')) {
      modalEl.dataset.resolveValue = 'done';
      return new Promise((resolve) => {
        modalEl.addEventListener('hidden.bs.modal', () => resolve(), { once: true });
        inst.hide();
      });
    }
    return Promise.resolve();
  }

  async function showUserMessage({ title, icon, message, buttons }) {
    if (typeof window.showMessageModal === 'function') {
      await window.showMessageModal({
        title: title || 'Message',
        icon: icon || 'info',
        message: message || '',
        buttons: buttons || [{ text: 'OK', class: 'btn-primary' }]
      });
      return;
    }
    window.alert(String(message || title || 'Message').replace(/<[^>]+>/g, ' '));
  }

  async function parseErrorResponse(res, fallbackLabel) {
    const contentType = String(res.headers.get('Content-Type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = await res.json();
      const err = new Error(payload.message || `${fallbackLabel || 'Request'} failed (HTTP ${res.status}).`);
      err.payload = payload;
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    throw new Error(text || `${fallbackLabel || 'Request'} failed (HTTP ${res.status}).`);
  }

  function fmtBytes(n) {
    const b = Number(n || 0);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  function applyStatusDashboard(status) {
    const dash = status && typeof status === 'object' ? status : {};
    const logs = dash.collections?.logs || {};
    const actionStates = dash.collections?.actionStates || {};
    const cards = document.getElementById('logArchiveStatusCards');
    if (!cards) return;
    const cardBodies = cards.querySelectorAll('.card-body');
    if (cardBodies[0]) {
      cardBodies[0].querySelector('.fs-4').textContent = `${logs.count || 0} records`;
      const meta = cardBodies[0].querySelector('.small.text-muted');
      if (meta) meta.textContent = `${fmtBytes(logs.sizeBytes)} · Backend: ${logs.backendMode || 'json'}`;
      const range = cardBodies[0].querySelector('.small.mt-2');
      if (range) range.textContent = `Range: ${logs.earliestAt || '—'} → ${logs.latestAt || '—'}`;
    }
    if (cardBodies[1]) {
      cardBodies[1].querySelector('.fs-4').textContent = `${actionStates.count || 0} records`;
      const meta = cardBodies[1].querySelector('.small.text-muted');
      if (meta) meta.textContent = `${fmtBytes(actionStates.sizeBytes)} · Backend: ${actionStates.backendMode || 'json'}`;
      const range = cardBodies[1].querySelector('.small.mt-2');
      if (range) range.textContent = `Range: ${actionStates.earliestAt || '—'} → ${actionStates.latestAt || '—'}`;
    }
  }

  async function refreshStatus() {
    if (!refreshBtn) return;
    refreshBtn.disabled = true;
    try {
      const res = await fetch('/logs/archive/status', {
        headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Status refresh failed');
      applyStatusDashboard(data.data);
      const stamp = 'Status refreshed at ' + new Date().toLocaleTimeString();
      if (msgEl) msgEl.textContent = stamp;
      const deleteMsg = document.getElementById('logArchiveDeleteMsg');
      if (deleteMsg && deleteMsg.dataset.keepAfterRefresh !== '1') {
        deleteMsg.textContent = '';
      }
    } catch (err) {
      await showUserMessage({
        title: 'Refresh failed',
        icon: 'error',
        message: err.message || 'Could not refresh archive status.'
      });
    } finally {
      refreshBtn.disabled = false;
    }
  }

  if (refreshBtn) refreshBtn.addEventListener('click', refreshStatus);

  async function runExport(body) {
    const res = await fetch('/logs/archive/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/zip, application/json',
        'X-AJAX-Request': 'true'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      await parseErrorResponse(res, 'Export');
      return;
    }

    const blob = await res.blob();
    const exportId = res.headers.get('X-Archive-Export-Id') || 'export';
    const fileName = `activity-archive_${body.startDate}_${body.endDate}_${exportId}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const btn = document.getElementById('logArchiveExportBtn');
      const fd = new FormData(form);
      const body = {
        startDate: fd.get('startDate'),
        endDate: fd.get('endDate'),
        includeLogs: fd.get('includeLogs') === 'on',
        includeActionStates: fd.get('includeActionStates') === 'on',
        includeDecryptedSnapshots: fd.get('includeDecryptedSnapshots') === 'on'
      };

      const startExport = async () => {
        if (btn) btn.disabled = true;
        if (msgEl) msgEl.textContent = '';
        openOperationWaitModal(body.startDate, body.endDate, 'Building activity archive ZIP');
        try {
          await runExport(body);
          closeOperationWaitModal();
          if (msgEl) msgEl.textContent = 'Download started. Records remain in the database.';
          await showUserMessage({
            title: 'Export ready',
            icon: 'success',
            message: 'Your archive ZIP download has started. Records remain in the database until you delete them separately.'
          });
        } catch (err) {
          closeOperationWaitModal();
          if (err?.payload?.status === 'admin_required') {
            await showUserMessage({
              title: 'Admin approval required',
              icon: 'warning',
              message: err.message || 'Administrator verification is required for this export.'
            });
          } else {
            await showUserMessage({
              title: 'Export failed',
              icon: 'error',
              message: err.message || 'Archive export could not be completed.'
            });
          }
        } finally {
          if (btn) btn.disabled = false;
        }
      };

      try {
        if (typeof window.requestProtectedAction === 'function') {
          await window.requestProtectedAction(() => {
            void startExport();
          });
        } else {
          await startExport();
        }
      } catch (_) {
        /* user cancelled admin verification */
      }
    });
  }

  function normalizeRelativePath(file) {
    const raw = file.webkitRelativePath || file.name || '';
    return String(raw).replace(/\\/g, '/');
  }

  function manifestToArchiveEntry(manifest, sourceLabel) {
    const range = manifest?.range || {};
    const counts = manifest?.counts || {};
    return {
      exportId: String(manifest?.exportId || sourceLabel || '').trim(),
      startDate: range.startDate,
      endDate: range.endDate,
      counts: {
        logs: Number(counts.logs || 0),
        actionStates: Number(counts.actionStates || 0)
      }
    };
  }

  async function readManifestFromZipBuffer(buf, sourceName) {
    if (typeof PizZip === 'undefined') throw new Error('ZIP library not loaded.');
    const zip = new PizZip(buf);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error(`manifest.json missing in ${sourceName}`);
    const manifest = JSON.parse(manifestFile.asText());
    return {
      manifest,
      zip,
      checks: [
        {
          ok: true,
          label: `${sourceName}: manifest.json parsed`
        },
        {
          ok: Number(manifest?.schemaVersion || 0) >= 1,
          label: `${sourceName}: schema version ${manifest?.schemaVersion ?? '—'}`
        },
        {
          ok: Boolean(manifest?.range?.startDate && manifest?.range?.endDate),
          label: `${sourceName}: export range ${manifest?.range?.startDate || '—'} → ${manifest?.range?.endDate || '—'}`
        },
        {
          ok: Boolean(zip.file('logs.ndjson')),
          label: `${sourceName}: logs.ndjson ${zip.file('logs.ndjson') ? 'present' : 'missing'}`
        },
        {
          ok: Boolean(zip.file('action_states.ndjson')),
          label: `${sourceName}: action_states.ndjson ${zip.file('action_states.ndjson') ? 'present' : 'missing'}`
        }
      ],
      hasLogsFile: Boolean(zip.file('logs.ndjson')),
      hasActionStatesFile: Boolean(zip.file('action_states.ndjson'))
    };
  }

  async function readManifestFromZipFile(file) {
    const buf = await file.arrayBuffer();
    const parsed = await readManifestFromZipBuffer(buf, file.name);
    return parsed.manifest;
  }

  function dirFromManifestPath(relativePath) {
    const rp = String(relativePath || '').replace(/\\/g, '/');
    const idx = rp.lastIndexOf('/');
    return idx >= 0 ? rp.slice(0, idx) : '';
  }

  function folderHasRelativeFile(files, dir, name) {
    const target = dir ? `${dir}/${name}` : name;
    return files.some((f) => normalizeRelativePath(f) === target);
  }

  async function analyzeLocalArchives(files) {
    const list = Array.from(files || []);
    if (!list.length) {
      throw new Error('Choose an export ZIP or folder that contains manifest.json.');
    }

    const archives = [];
    const checks = [];
    const seenExportIds = new Set();

    const zipFiles = list.filter((f) => /\.zip$/i.test(f.name || ''));
    const nonZipFiles = list.filter((f) => !/\.zip$/i.test(f.name || ''));

    for (const file of zipFiles) {
      const buf = await file.arrayBuffer();
      const parsed = await readManifestFromZipBuffer(buf, file.name);
      checks.push(...parsed.checks);
      const entry = manifestToArchiveEntry(parsed.manifest, file.name);
      if (!entry.startDate || !entry.endDate) {
        throw new Error(`Invalid manifest range in ${file.name}`);
      }
      entry.hasLogsFile = parsed.hasLogsFile;
      entry.hasActionStatesFile = parsed.hasActionStatesFile;
      entry.sourceName = file.name;
      entry.timezone = parsed.manifest?.timezone || '';
      entry.exportedAt = parsed.manifest?.exportedAt || '';
      const key = entry.exportId || file.name;
      if (seenExportIds.has(key)) continue;
      seenExportIds.add(key);
      archives.push(entry);
    }

    const manifestFiles = nonZipFiles.filter((f) => {
      const rp = normalizeRelativePath(f);
      return rp === 'manifest.json' || rp.endsWith('/manifest.json');
    });

    for (const mf of manifestFiles) {
      const rp = normalizeRelativePath(mf);
      const text = await mf.text();
      const manifest = JSON.parse(text);
      const entry = manifestToArchiveEntry(manifest, rp);
      if (!entry.startDate || !entry.endDate) {
        throw new Error(`Invalid manifest range in ${rp}`);
      }
      const dir = dirFromManifestPath(rp);
      const hasLogsFile = folderHasRelativeFile(list, dir, 'logs.ndjson');
      const hasActionStatesFile = folderHasRelativeFile(list, dir, 'action_states.ndjson');
      checks.push(
        { ok: true, label: `${rp}: manifest.json parsed` },
        {
          ok: Number(manifest?.schemaVersion || 0) >= 1,
          label: `${rp}: schema version ${manifest?.schemaVersion ?? '—'}`
        },
        {
          ok: true,
          label: `${rp}: export range ${entry.startDate} → ${entry.endDate}`
        },
        { ok: hasLogsFile, label: `${rp}: logs.ndjson ${hasLogsFile ? 'present' : 'missing'}` },
        { ok: hasActionStatesFile, label: `${rp}: action_states.ndjson ${hasActionStatesFile ? 'present' : 'missing'}` }
      );
      entry.hasLogsFile = hasLogsFile;
      entry.hasActionStatesFile = hasActionStatesFile;
      entry.sourceName = rp;
      entry.timezone = manifest?.timezone || '';
      entry.exportedAt = manifest?.exportedAt || '';
      const key = entry.exportId || rp;
      if (seenExportIds.has(key)) continue;
      seenExportIds.add(key);
      archives.push(entry);
    }

    if (!archives.length) {
      throw new Error('No valid activity-archive ZIP or manifest.json found in the selection.');
    }

    const startDates = archives.map((a) => a.startDate).sort();
    const endDates = archives.map((a) => a.endDate).sort();
    const mergedRange = {
      startDate: startDates[0],
      endDate: endDates[endDates.length - 1]
    };
    const mergedCounts = archives.reduce(
      (acc, row) => ({
        logs: acc.logs + row.counts.logs,
        actionStates: acc.actionStates + row.counts.actionStates
      }),
      { logs: 0, actionStates: 0 }
    );
    const includeLogs = archives.some((a) => a.hasLogsFile || a.counts.logs > 0);
    const includeActionStates = archives.some((a) => a.hasActionStatesFile || a.counts.actionStates > 0);

    if (!includeLogs && !includeActionStates) {
      throw new Error('Archive contains no logs or action states to delete.');
    }

    const localVerification = {
      archives: archives.map((a) => ({
        exportId: a.exportId,
        startDate: a.startDate,
        endDate: a.endDate,
        counts: a.counts,
        hasLogsFile: Boolean(a.hasLogsFile),
        hasActionStatesFile: Boolean(a.hasActionStatesFile)
      }))
    };

    return {
      localVerification,
      analysis: {
        archives,
        mergedRange,
        mergedCounts,
        includeLogs,
        includeActionStates,
        checks
      }
    };
  }

  async function buildLocalVerificationFromFiles(files) {
    const { localVerification } = await analyzeLocalArchives(files);
    return localVerification;
  }

  function resetDeleteVerificationState() {
    lastDeleteVerification = null;
    lastDeletePreview = null;
    lastLocalVerificationPayload = null;
    lastDeleteAnalysis = null;
    const deleteBtn = document.getElementById('logArchiveDeleteBtn');
    if (deleteBtn) deleteBtn.disabled = true;
    syncDeleteButtonState(null, null);
    const panel = document.getElementById('logArchiveDeleteVerifyPanel');
    if (panel) {
      panel.classList.add('d-none');
      panel.classList.remove('alert-success', 'alert-danger', 'alert-warning');
      panel.classList.add('alert-secondary');
      panel.textContent = '';
    }
    const analysisPanel = document.getElementById('logArchiveDeleteAnalysisPanel');
    if (analysisPanel) analysisPanel.classList.add('d-none');
    const planBlock = document.getElementById('logArchiveDeletePlanBlock');
    if (planBlock) planBlock.classList.add('d-none');
    const mismatchPanel = document.getElementById('logArchiveDeleteMismatchPanel');
    if (mismatchPanel) {
      mismatchPanel.classList.add('d-none');
      mismatchPanel.innerHTML = '';
    }
    const startEl = document.getElementById('logArchiveDeleteStart');
    const endEl = document.getElementById('logArchiveDeleteEnd');
    if (startEl) startEl.value = '';
    if (endEl) endEl.value = '';
    const rangeDisplay = document.getElementById('logArchiveDeleteRangeDisplay');
    if (rangeDisplay) rangeDisplay.textContent = '—';
    const logsCb = document.getElementById('logArchiveDeleteIncludeLogs');
    const statesCb = document.getElementById('logArchiveDeleteIncludeActionStates');
    if (logsCb) {
      logsCb.checked = false;
      logsCb.disabled = true;
    }
    if (statesCb) {
      statesCb.checked = false;
      statesCb.disabled = true;
    }
  }

  function renderDeleteAnalysisPanel(analysis) {
    const panel = document.getElementById('logArchiveDeleteAnalysisPanel');
    const checksEl = document.getElementById('logArchiveDeleteChecksList');
    const rangeEl = document.getElementById('logArchiveDeleteRangeSummary');
    if (!panel || !checksEl || !rangeEl || !analysis) return;

    const checkRows = (analysis.checks || []).map((row) => {
      const cls = row.ok ? 'log-archive-delete-check-ok' : 'log-archive-delete-check-fail';
      const icon = row.ok ? 'bi-check-circle-fill' : 'bi-x-circle-fill';
      return `<li class="${cls}"><i class="bi ${icon} me-1"></i>${row.label}</li>`;
    }).join('');

    const archiveLines = (analysis.archives || []).map((a) => (
      `<li><code>${a.exportId || a.sourceName || 'archive'}</code> · ${a.startDate} → ${a.endDate} · `
      + `${Number(a.counts?.logs || 0).toLocaleString()} log(s), `
      + `${Number(a.counts?.actionStates || 0).toLocaleString()} action state(s)</li>`
    )).join('');

    checksEl.innerHTML = `<ul class="list-unstyled mb-2">${checkRows}</ul>`;
    rangeEl.innerHTML = `
      <p class="mb-1"><strong>Archives found:</strong></p>
      <ul class="mb-2 ps-3">${archiveLines}</ul>
      <p class="mb-0">Delete range set from archive coverage: `
      + `<strong>${analysis.mergedRange?.startDate || '—'}</strong> → `
      + `<strong>${analysis.mergedRange?.endDate || '—'}</strong> `
      + `(manifest totals: ${Number(analysis.mergedCounts?.logs || 0).toLocaleString()} logs, `
      + `${Number(analysis.mergedCounts?.actionStates || 0).toLocaleString()} action states)</p>`;
    panel.classList.remove('d-none');
  }

  function applyDeletePlanFromAnalysis(analysis) {
    const planBlock = document.getElementById('logArchiveDeletePlanBlock');
    const startEl = document.getElementById('logArchiveDeleteStart');
    const endEl = document.getElementById('logArchiveDeleteEnd');
    const rangeDisplay = document.getElementById('logArchiveDeleteRangeDisplay');
    const logsCb = document.getElementById('logArchiveDeleteIncludeLogs');
    const statesCb = document.getElementById('logArchiveDeleteIncludeActionStates');
    if (!analysis?.mergedRange) return;

    if (startEl) startEl.value = analysis.mergedRange.startDate || '';
    if (endEl) endEl.value = analysis.mergedRange.endDate || '';
    if (rangeDisplay) {
      rangeDisplay.textContent = `${analysis.mergedRange.startDate} → ${analysis.mergedRange.endDate}`;
    }
    if (logsCb) {
      logsCb.disabled = false;
      logsCb.checked = Boolean(analysis.includeLogs);
    }
    if (statesCb) {
      statesCb.disabled = false;
      statesCb.checked = Boolean(analysis.includeActionStates);
    }
    if (planBlock) planBlock.classList.remove('d-none');
  }

  function buildDeleteRequestBody(fd, localVerification) {
    const form = deleteForm || document.getElementById('logArchiveDeleteForm');
    const startEl = form?.querySelector('#logArchiveDeleteStart');
    const endEl = form?.querySelector('#logArchiveDeleteEnd');
    const logsCb = form?.querySelector('#logArchiveDeleteIncludeLogs');
    const statesCb = form?.querySelector('#logArchiveDeleteIncludeActionStates');
    return {
      startDate: startEl?.value || fd?.get('startDate') || '',
      endDate: endEl?.value || fd?.get('endDate') || '',
      includeLogs: Boolean(logsCb?.checked),
      includeActionStates: Boolean(statesCb?.checked),
      localVerification
    };
  }

  function syncDeleteButtonState(verification, preview) {
    const deleteBtn = document.getElementById('logArchiveDeleteBtn');
    const hintEl = document.getElementById('logArchiveDeleteBtnHint');
    if (!deleteBtn) return;

    const ready = Boolean(verification && verification.ok);
    deleteBtn.disabled = !ready;

    if (!hintEl) return;
    if (!lastLocalVerificationPayload) {
      hintEl.textContent = 'Complete Step 1 (choose backup) and Step 2 (Analyze archive).';
      hintEl.className = 'small text-muted d-block mt-2';
      return;
    }
    if (!verification) {
      hintEl.textContent = 'Run Step 2 — Analyze archive to compare backup with the database.';
      hintEl.className = 'small text-muted d-block mt-2';
      return;
    }
    if (!verification.ok) {
      const code = verification.code ? `[${verification.code}] ` : '';
      hintEl.textContent = `${code}${verification.message || 'Data mismatch — delete blocked.'}`;
      hintEl.className = 'small text-danger d-block mt-2 fw-semibold';
      return;
    }
    const counts = preview?.counts || verification.serverCounts || {};
    hintEl.textContent = `Ready: delete ${Number(counts.logs || 0).toLocaleString()} log(s) and `
      + `${Number(counts.actionStates || 0).toLocaleString()} action state(s) for `
      + `${verification.deleteRange?.startDate || '—'} → ${verification.deleteRange?.endDate || '—'}.`;
    hintEl.className = 'small text-success d-block mt-2';
  }

  function finalizeDeleteStepUi(preview, verification) {
    showDeleteStep3(true);
    renderMismatchErrorPanel(verification, preview);
    renderVerifyPanel(preview, verification);
    syncDeleteButtonState(verification, preview);
  }

  function renderVerifyPanel(preview, verification) {
    const panel = document.getElementById('logArchiveDeleteVerifyPanel');
    if (!panel) return;

    panel.classList.remove('d-none', 'alert-secondary', 'alert-success', 'alert-danger', 'alert-warning');
    if (!verification) {
      panel.classList.add('alert-warning');
      panel.classList.remove('d-none');
      panel.innerHTML = '<strong>Database check pending.</strong> Run Step 2 — Analyze archive. A progress dialog will appear while the server is checked.';
      return;
    }

    if (!verification.ok) {
      panel.classList.add('alert-danger');
      panel.innerHTML = `<strong>Database check failed.</strong> See the mismatch details above. Delete stays disabled until this is resolved.`;
      return;
    }

    const local = verification.localCounts || {};
    const server = verification.serverCounts || preview?.counts || {};
    const covered = verification.coveredRange || {};
    const del = verification.deleteRange || {};
    const exportIds = (verification.archives || []).map((a) => a.exportId).filter(Boolean).join(', ') || '—';

    panel.classList.add('alert-success');
    panel.innerHTML = `
      <div class="fw-semibold mb-1">Local backup verified</div>
      <ul class="mb-0 ps-3">
        <li>Delete range: <strong>${del.startDate || '—'}</strong> → <strong>${del.endDate || '—'}</strong></li>
        <li>Local archive coverage: <strong>${covered.startDate || '—'}</strong> → <strong>${covered.endDate || '—'}</strong></li>
        <li>Export id(s): ${exportIds}</li>
        <li>Logs — local manifest: ${Number(local.logs || 0).toLocaleString()}, database in range: ${Number(server.logs || 0).toLocaleString()}</li>
        <li>Action states — local manifest: ${Number(local.actionStates || 0).toLocaleString()}, database in range: ${Number(server.actionStates || 0).toLocaleString()}</li>
      </ul>`;
  }

  async function runDeletePreview(body) {
    const res = await fetch('/logs/archive/delete/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      body: JSON.stringify(body)
    });
    const payload = await res.json();
    if (!res.ok || payload.status !== 'success') {
      const err = new Error(payload.message || 'Delete preview failed.');
      err.payload = payload;
      throw err;
    }
    return payload.data;
  }

  async function runDelete(body) {
    const res = await fetch('/logs/archive/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-AJAX-Request': 'true'
      },
      body: JSON.stringify(body)
    });
    const payload = await res.json();
    if (!res.ok || payload.status !== 'success') {
      const err = new Error(payload.message || 'Delete failed.');
      err.payload = payload;
      throw err;
    }
    return payload.data;
  }

  function buildDeleteConfirmHtml(preview, verification) {
    const counts = preview?.counts || verification?.serverCounts || {};
    const del = verification?.deleteRange || {};
    return `<p class="mb-2">Permanently delete records from the database for <strong>${del.startDate || '—'}</strong> through <strong>${del.endDate || '—'}</strong>?</p>
      <ul class="mb-2">
        <li><strong>${Number(counts.logs || 0).toLocaleString()}</strong> activity log(s)</li>
        <li><strong>${Number(counts.actionStates || 0).toLocaleString()}</strong> action state(s)</li>
      </ul>
      <p class="small text-danger mb-0">This cannot be undone. Local ZIP backups are your only recovery copy.</p>`;
  }

  if (deleteForm) {
    const deleteMsg = document.getElementById('logArchiveDeleteMsg');
    const deleteBtn = document.getElementById('logArchiveDeleteBtn');
    const analyzeBtn = document.getElementById('logArchiveDeleteAnalyzeBtn');
    const localMeta = document.getElementById('logArchiveDeleteLocalMeta');
    const zipInput = document.getElementById('logArchiveDeleteZipInput');
    const folderInput = document.getElementById('logArchiveDeleteFolderInput');
    const pickZipBtn = document.getElementById('logArchiveDeletePickZipBtn');
    const pickFolderBtn = document.getElementById('logArchiveDeletePickFolderBtn');

    function updateLocalMeta() {
      if (!localMeta) return;
      if (!localArchiveFiles.length) {
        localMeta.textContent = 'No archive selected. Pick an export ZIP or extracted folder that contains manifest.json.';
        if (analyzeBtn) analyzeBtn.disabled = true;
        return;
      }
      const names = localArchiveFiles.slice(0, 3).map((f) => f.name).join(', ');
      const extra = localArchiveFiles.length > 3 ? ` (+${localArchiveFiles.length - 3} more)` : '';
      localMeta.textContent = `${localArchiveFiles.length} file(s) selected: ${names}${extra}`;
      if (analyzeBtn) analyzeBtn.disabled = false;
    }

    function onLocalFilesChanged(files, source) {
      localArchiveFiles = Array.from(files || []);
      if (source === 'zip' && folderInput) folderInput.value = '';
      if (source === 'folder' && zipInput) zipInput.value = '';
      updateLocalMeta();
      resetDeleteVerificationState();
    }

    if (pickZipBtn && zipInput) {
      pickZipBtn.addEventListener('click', () => zipInput.click());
      zipInput.addEventListener('change', () => onLocalFilesChanged(zipInput.files, 'zip'));
    }
    if (pickFolderBtn && folderInput) {
      pickFolderBtn.addEventListener('click', () => folderInput.click());
      folderInput.addEventListener('change', () => onLocalFilesChanged(folderInput.files, 'folder'));
    }

    deleteForm.querySelectorAll('#logArchiveDeleteIncludeLogs, #logArchiveDeleteIncludeActionStates').forEach((el) => {
      el.addEventListener('change', async () => {
        if (!lastLocalVerificationPayload || !lastDeleteAnalysis) {
          syncDeleteButtonState(null, null);
          return;
        }
        try {
          const body = buildDeleteRequestBody(null, lastLocalVerificationPayload);
          const data = await runDeletePreview(body);
          lastDeletePreview = data.preview;
          lastDeleteVerification = data.verification;
          renderVerifyPanel(data.preview, data.verification);
          finalizeDeleteStepUi(data.preview, data.verification);
        } catch (err) {
          syncDeleteButtonState({ ok: false, message: err.message, code: err.payload?.code }, null);
          showDeleteStep3(true);
          renderMismatchErrorPanel({ ok: false, message: err.message, code: err.payload?.code }, null);
          renderVerifyPanel(null, { ok: false, message: err.message });
        }
      });
    });

    async function analyzeAndVerifyDeleteArchive(options = {}) {
      const showWaitModal = options.showWaitModal !== false;
      if (showWaitModal) {
        showDeleteStep3(true);
        scrollDeleteStep3IntoView();
        openAnalyzeWaitModal(
          'Step 1 of 3 — Reading local backup',
          'Parsing manifest.json and archive files in your browser.'
        );
      }
      try {
        if (showWaitModal) {
          updateAnalyzeWaitModal(
            'Step 1 of 3 — Reading local backup',
            'Parsing manifest.json and archive files in your browser.'
          );
        }
        const analyzed = await analyzeLocalArchives(localArchiveFiles);
        lastDeleteAnalysis = analyzed.analysis;
        lastLocalVerificationPayload = analyzed.localVerification;
        renderDeleteAnalysisPanel(analyzed.analysis);
        applyDeletePlanFromAnalysis(analyzed.analysis);

        if (showWaitModal) {
          updateAnalyzeWaitModal(
            'Step 2 of 3 — Preparing delete plan',
            `Date range ${analyzed.analysis.mergedRange?.startDate || '—'} → ${analyzed.analysis.mergedRange?.endDate || '—'} from archive manifest.`
          );
        }

        const body = buildDeleteRequestBody(null, analyzed.localVerification);
        if (!body.includeLogs && !body.includeActionStates) {
          throw new Error('Archive has no deletable collections.');
        }
        if (!body.startDate || !body.endDate) {
          throw new Error('Could not determine delete date range from the archive.');
        }
        if (showWaitModal) {
          updateAnalyzeWaitModal(
            'Step 3 of 3 — Checking database',
            'Counting matching logs and action states on the server. Large ranges can take several minutes.'
          );
        }
        const data = await runDeletePreview(body);
        lastDeletePreview = data.preview;
        lastDeleteVerification = data.verification;
        finalizeDeleteStepUi(data.preview, data.verification);
        return data;
      } finally {
        if (showWaitModal) {
          await closeOperationWaitModal();
        }
      }
    }

    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', async () => {
        analyzeBtn.disabled = true;
        if (deleteMsg) {
          deleteMsg.textContent = '';
          deleteMsg.className = 'small text-muted flex-grow-1';
        }
        try {
          const data = await analyzeAndVerifyDeleteArchive();
          if (deleteMsg) {
            if (data.verification?.ok) {
              deleteMsg.textContent = 'Verification passed. You can delete matching records in Step 3.';
              deleteMsg.className = 'small text-success flex-grow-1';
            } else {
              deleteMsg.textContent = 'Analysis finished but delete is blocked due to data mismatch (see red box in Step 3).';
              deleteMsg.className = 'small text-danger flex-grow-1 fw-semibold';
            }
          }
        } catch (err) {
          await closeOperationWaitModal();
          if (lastDeleteAnalysis) {
            showDeleteStep3(true);
            renderMismatchErrorPanel({ ok: false, message: err.message, code: err.payload?.code }, null);
            syncDeleteButtonState({ ok: false, message: err.message, code: err.payload?.code }, null);
            renderVerifyPanel(null, { ok: false, message: err.message });
          } else {
            resetDeleteVerificationState();
            updateLocalMeta();
          }
          if (deleteMsg) {
            deleteMsg.textContent = err.message || 'Analyze failed.';
            deleteMsg.className = 'small text-danger flex-grow-1';
          }
          await showUserMessage({
            title: 'Analyze failed',
            icon: 'error',
            message: err.message || 'Could not analyze the local archive.'
          });
        } finally {
          analyzeBtn.disabled = !localArchiveFiles.length;
        }
      });
    }

    deleteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (deleteBtn) deleteBtn.disabled = true;
      if (deleteMsg) {
        deleteMsg.textContent = '';
        deleteMsg.dataset.keepAfterRefresh = '';
      }

      try {
        let data;
        if (lastDeleteVerification?.ok && lastDeletePreview && lastLocalVerificationPayload) {
          data = { preview: lastDeletePreview, verification: lastDeleteVerification };
        } else {
          data = await analyzeAndVerifyDeleteArchive();
        }
        const preview = data.preview;
        const verification = data.verification;
        const localVerification = lastLocalVerificationPayload;

        if (!verification?.ok) {
          finalizeDeleteStepUi(preview, verification);
          throw new Error(verification?.message || 'Local verification must pass before delete.');
        }

        await closeOperationWaitModal();

        if (typeof window.showMessageModal !== 'function') {
          throw new Error('Confirmation dialog is not available. Refresh the page and try again.');
        }

        const btnResult = await window.showMessageModal({
          title: 'Confirm permanent delete',
          icon: 'warning',
          message: buildDeleteConfirmHtml(preview, verification),
          buttons: [
            { text: 'Cancel', class: 'btn-secondary' },
            { text: 'Delete permanently', class: 'btn-danger' }
          ]
        });
        if (btnResult !== 'Delete permanently') {
          syncDeleteButtonState(lastDeleteVerification, lastDeletePreview);
          return;
        }

        const body = buildDeleteRequestBody(null, localVerification);

        try {
          if (typeof window.requestProtectedAction === 'function') {
            await window.requestProtectedAction();
          }
        } catch (adminErr) {
          if (adminErr?.code === 'ADMIN_VERIFICATION_CANCELLED') {
            return;
          }
          throw adminErr;
        }

        openOperationWaitModal(body.startDate, body.endDate, 'Deleting archived records');
        try {
          const result = await runDelete(body);
          await closeOperationWaitModal();
          resetDeleteVerificationState();
          if (deleteMsg) {
            deleteMsg.dataset.keepAfterRefresh = '1';
            deleteMsg.textContent = `Deleted ${result.deleted?.logs || 0} log(s) and ${result.deleted?.actionStates || 0} action state(s).`;
          }
          await refreshStatus();
          await showUserMessage({
            title: 'Delete complete',
            icon: 'success',
            message: `Removed ${result.deleted?.logs || 0} log(s) and ${result.deleted?.actionStates || 0} action state(s) from the database.`
          });
        } catch (err) {
          await closeOperationWaitModal();
          if (err?.payload?.status === 'admin_required') {
            await showUserMessage({
              title: 'Admin approval required',
              icon: 'warning',
              message: err.message || 'Administrator verification is required for this delete.'
            });
          } else {
            await showUserMessage({
              title: 'Delete failed',
              icon: 'error',
              message: err.message || 'Records could not be deleted.'
            });
          }
        }
      } catch (err) {
        if (err?.code === 'ADMIN_VERIFICATION_CANCELLED') {
          return;
        }
        await showUserMessage({
          title: 'Delete blocked',
          icon: 'error',
          message: err.message || 'Delete could not proceed.'
        });
      } finally {
        syncDeleteButtonState(lastDeleteVerification, lastDeletePreview);
      }
    });

    showDeleteStep3(true);
    renderVerifyPanel(null, null);
    syncDeleteButtonState(null, null);

    const deleteCollapseEl = document.getElementById('logArchiveDeleteCollapse');
    const deleteSectionEl = document.getElementById('logArchiveDeleteSection');
    if (deleteCollapseEl && deleteSectionEl) {
      deleteCollapseEl.addEventListener('shown.bs.collapse', () => {
        deleteSectionEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, { once: true });
    }
  }
})();
