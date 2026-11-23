(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatRunResult(result) {
    if (!result || typeof result !== 'object') return '';
    if (result.ok === false && result.error) return 'Error: ' + String(result.error);
    if (result.data && typeof result.data === 'object') return JSON.stringify(result.data, null, 2);
    return String(result.displayText || result.rawText || '');
  }

  async function copyText(text) {
    const payload = String(text || '');
    if (!payload) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        return true;
      }
    } catch (_) { /* fallthrough */ }
    try {
      const area = document.createElement('textarea');
      area.value = payload;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function readInstancePrefillSnapshot() {
    try {
      const el = document.getElementById('reportInstancePrefillData');
      if (!el?.textContent) return {};
      const parsed = JSON.parse(el.textContent);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function resolveLiveBindingValue(binding, answersOverride, prefill) {
    const source = String(binding?.source || 'empty').toLowerCase();
    const value = String(binding?.value || '').trim();
    if (!value) {
      if (source === 'static') return '';
      return null;
    }
    if (source === 'field') {
      if (Object.prototype.hasOwnProperty.call(answersOverride, value)) {
        const raw = answersOverride[value];
        if (raw === undefined || raw === null) return '';
        return typeof raw === 'boolean' ? String(raw) : String(raw);
      }
      return null;
    }
    if (source === 'prefill') {
      if (Object.prototype.hasOwnProperty.call(prefill, value)) return String(prefill[value] ?? '');
      if (Object.prototype.hasOwnProperty.call(answersOverride, value)) return String(answersOverride[value] ?? '');
      return null;
    }
    if (source === 'static') return value;
    return null;
  }

  function applyLiveBindingDefaults(defaults, entry, answersOverride, prefill) {
    const bindings = entry?.inputBindings && typeof entry.inputBindings === 'object' ? entry.inputBindings : {};
    const out = { ...(defaults && typeof defaults === 'object' ? defaults : {}) };
    Object.keys(bindings).forEach((inputId) => {
      const live = resolveLiveBindingValue(bindings[inputId], answersOverride, prefill);
      if (live !== null) out[inputId] = live;
    });
    return out;
  }

  function notify(title, icon, message) {
    if (typeof showMessageModal === 'function') {
      showMessageModal({
        title,
        icon,
        message,
        buttons: [{ text: 'OK', class: icon === 'error' ? 'btn-secondary' : 'btn-primary' }]
      });
    }
  }

  function ReportAiAssistPanel(options = {}) {
    this.context = String(options.context || 'instance');
    this.catalog = Array.isArray(options.catalog) ? options.catalog : [];
    this.identity = options.identity && typeof options.identity === 'object' ? options.identity : {};
    this.storageKey = String(options.storageKey || '').trim();
    this.getAnswersOverride = typeof options.getAnswersOverride === 'function' ? options.getAnswersOverride : () => ({});
    this.results = new Map();
    this.modalEl = document.getElementById('reportAiAssistModal');
    this.modal = null;
    this.serviceSelect = document.getElementById('reportAiAssistServiceSelect');
    this.servicePickerWrap = document.getElementById('reportAiAssistServicePickerWrap');
    this.serviceDescription = document.getElementById('reportAiAssistServiceDescription');
    this.inputsHost = document.getElementById('reportAiAssistInputsHost');
    this.runBtn = document.getElementById('reportAiAssistModalRunBtn');
    this.resultWrap = document.getElementById('reportAiAssistModalResult');
    this.resultBody = document.getElementById('reportAiAssistModalResultBody');
    this.tray = document.getElementById('reportAiAssistResultsTray');
    this.trayBody = document.getElementById('reportAiAssistResultsTrayBody');
    this.loadStoredResults();
    this.bindEvents();
    this.renderTray();
  }

  ReportAiAssistPanel.prototype.loadStoredResults = function () {
    if (!this.storageKey) return;
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      Object.entries(parsed).forEach(([key, value]) => {
        if (value && typeof value === 'object') this.results.set(key, value);
      });
    } catch (_) { /* ignore */ }
  };

  ReportAiAssistPanel.prototype.persistResults = function () {
    if (!this.storageKey) return;
    try {
      const out = {};
      this.results.forEach((value, key) => { out[key] = value; });
      sessionStorage.setItem(this.storageKey, JSON.stringify(out));
    } catch (_) { /* ignore */ }
  };

  ReportAiAssistPanel.prototype.getSelectedEntry = function () {
    const selectedId = this.serviceSelect?.value || this.catalog[0]?.bindingRowId || '';
    return this.catalog.find((row) => String(row.bindingRowId) === String(selectedId)) || this.catalog[0] || null;
  };

  ReportAiAssistPanel.prototype.renderInputs = function (entry) {
    if (!this.inputsHost) return;
    const inputs = Array.isArray(entry?.inputs) ? entry.inputs : [];
    const defaults = entry?.inputDefaults && typeof entry.inputDefaults === 'object' ? entry.inputDefaults : {};
    if (!inputs.length) {
      this.inputsHost.innerHTML = '<p class="small text-muted mb-0">No inputs defined for this service.</p>';
      return;
    }
    const bindingHints = entry?.inputBindings && typeof entry.inputBindings === 'object' ? entry.inputBindings : {};
    this.inputsHost.innerHTML = inputs.map((field) => {
      const id = String(field.id || '').trim();
      const val = defaults[id] !== undefined ? defaults[id] : '';
      const type = String(field.type || 'text').toLowerCase();
      const label = escapeHtml(field.label || id);
      const bind = bindingHints[id];
      const bindSource = bind ? String(bind.source || '').toLowerCase() : '';
      const bindValue = bind ? String(bind.value || '').trim() : '';
      const bindHint = bindSource && (bindSource === 'empty' && !bindValue)
        ? ''
        : bindSource
          ? `<div class="small text-muted mb-1">Source: ${escapeHtml(bindSource)}${bindValue ? ` · <span class="font-monospace">${escapeHtml(bindValue)}</span>` : ''}</div>`
          : '';
      if (type === 'textarea' || type === 'json') {
        return `<div class="col-12"><label class="form-label fw-semibold" for="rai_${escapeHtml(id)}">${label}</label>${bindHint}<textarea class="form-control font-monospace" id="rai_${escapeHtml(id)}" data-ai-input="${escapeHtml(id)}" rows="${type === 'json' ? 5 : 6}">${escapeHtml(val)}</textarea></div>`;
      }
      if (type === 'boolean') {
        const isTrue = String(val).toLowerCase() === 'true';
        return `<div class="col-12 col-md-4"><label class="form-label fw-semibold" for="rai_${escapeHtml(id)}">${label}</label>${bindHint}<select class="form-select" id="rai_${escapeHtml(id)}" data-ai-input="${escapeHtml(id)}"><option value="false"${isTrue ? '' : ' selected'}>No</option><option value="true"${isTrue ? ' selected' : ''}>Yes</option></select></div>`;
      }
      const inputType = type === 'number' ? 'number' : 'text';
      return `<div class="col-12 col-md-6"><label class="form-label fw-semibold" for="rai_${escapeHtml(id)}">${label}</label>${bindHint}<input type="${inputType}" class="form-control" id="rai_${escapeHtml(id)}" data-ai-input="${escapeHtml(id)}" value="${escapeHtml(val)}"></div>`;
    }).join('');
  };

  ReportAiAssistPanel.prototype.readInputValues = function () {
    const out = {};
    this.inputsHost?.querySelectorAll('[data-ai-input]').forEach((el) => {
      if (!el.dataset.aiInput) return;
      if (el.type === 'checkbox') out[el.dataset.aiInput] = el.checked;
      else out[el.dataset.aiInput] = el.value;
    });
    return out;
  };

  ReportAiAssistPanel.prototype.buildRequestBody = function (bindingRowId, inputs) {
    const body = {
      context: this.context,
      bindingRowId,
      inputs: inputs || {}
    };
    if (this.context === 'matrix') {
      body.assignmentId = this.identity.assignmentId;
      body.assignmentRowId = this.identity.assignmentRowId || '';
      body.teacherId = this.identity.teacherId || '';
      const overrides = this.getAnswersOverride();
      body.sharedAnswersOverride = overrides.sharedAnswersOverride || {};
      body.commonAnswersOverride = overrides.commonAnswersOverride || {};
    } else {
      body.instanceId = this.identity.instanceId;
      body.answersOverride = this.getAnswersOverride().answersOverride || {};
    }
    return body;
  };

  ReportAiAssistPanel.prototype.ensureModalInstance = function () {
    if (!this.modalEl || !window.bootstrap?.Modal) return null;
    if (!this.modal) {
      this.modal = window.bootstrap.Modal.getOrCreateInstance
        ? window.bootstrap.Modal.getOrCreateInstance(this.modalEl)
        : new window.bootstrap.Modal(this.modalEl);
    }
    return this.modal;
  };

  ReportAiAssistPanel.prototype.openModal = async function () {
    const modal = this.ensureModalInstance();
    if (!this.catalog.length || !modal) return;
    const pickerHidden = this.catalog.length <= 1;
    this.servicePickerWrap?.classList.toggle('d-none', pickerHidden);
    if (this.serviceSelect) {
      this.serviceSelect.innerHTML = this.catalog.map((entry) => (
        `<option value="${escapeHtml(entry.bindingRowId)}">${escapeHtml(entry.label || entry.serviceKey)}</option>`
      )).join('');
      this.serviceSelect.value = this.catalog[0].bindingRowId;
    }
    await this.refreshInputsFromServer();
    this.resultWrap?.classList.add('d-none');
    modal.show();
  };

  ReportAiAssistPanel.prototype.refreshInputsFromServer = async function () {
    const entry = this.getSelectedEntry();
    if (!entry) return;
    try {
      const response = await fetch('/school/reports/ai-assist/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(this.buildRequestBody(entry.bindingRowId, {}))
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Prepare failed.');
      const refreshed = payload.service || entry;
      const serverDefaults = payload.inputs || refreshed.inputDefaults || entry.inputDefaults;
      const answersOverride = (this.getAnswersOverride() || {}).answersOverride || {};
      const prefill = this.context === 'instance' ? readInstancePrefillSnapshot() : {};
      const defaults = applyLiveBindingDefaults(serverDefaults, { ...entry, inputBindings: refreshed.inputBindings || entry.inputBindings }, answersOverride, prefill);
      entry.inputDefaults = defaults;
      const renderEntry = { ...refreshed, inputDefaults: defaults, inputBindings: refreshed.inputBindings || entry.inputBindings };
      if (this.serviceDescription) {
        this.serviceDescription.textContent = refreshed.description || entry.description || '';
      }
      this.renderInputs(renderEntry);
    } catch (err) {
      notify('AI Assist', 'error', err.message || 'Could not prepare inputs.');
      this.renderInputs(entry);
      if (this.serviceDescription) this.serviceDescription.textContent = entry.description || '';
    }
  };

  ReportAiAssistPanel.prototype.runSelected = async function () {
    const entry = this.getSelectedEntry();
    if (!entry || !this.runBtn) return;
    const inputs = this.readInputValues();
    this.runBtn.disabled = true;
    try {
      const response = await fetch('/school/reports/ai-assist/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(this.buildRequestBody(entry.bindingRowId, inputs))
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Run failed.');
      const text = formatRunResult(payload.result);
      if (this.resultWrap) this.resultWrap.classList.remove('d-none');
      if (this.resultBody) this.resultBody.textContent = text;
      this.results.set(entry.bindingRowId, {
        bindingRowId: entry.bindingRowId,
        label: entry.label,
        text,
        at: new Date().toISOString(),
        traceId: payload.result?.traceId || ''
      });
      this.persistResults();
      this.renderTray();
    } catch (err) {
      notify('AI Assist failed', 'error', err.message || 'Run failed.');
    } finally {
      this.runBtn.disabled = false;
    }
  };

  ReportAiAssistPanel.prototype.renderTray = function () {
    if (!this.tray || !this.trayBody) return;
    if (!this.results.size) {
      this.tray.classList.add('d-none');
      this.trayBody.innerHTML = '';
      return;
    }
    this.tray.classList.remove('d-none');
    this.trayBody.innerHTML = [...this.results.values()].map((row) => {
      const when = row.at ? new Date(row.at).toLocaleString() : '';
      return `<div class="border rounded p-3 mb-3 mb-last-0" data-tray-id="${escapeHtml(row.bindingRowId)}">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <div class="fw-semibold">${escapeHtml(row.label || row.bindingRowId)}</div>
          <div class="d-flex gap-2 align-items-center">
            ${when ? `<span class="small text-muted">${escapeHtml(when)}</span>` : ''}
            <button type="button" class="btn btn-outline-secondary btn-sm js-report-ai-tray-copy" data-copy-id="${escapeHtml(row.bindingRowId)}"><i class="bi bi-clipboard me-1"></i>Copy</button>
          </div>
        </div>
        <pre class="small mb-0 bg-light border rounded p-2" style="white-space: pre-wrap; max-height: 240px; overflow: auto;">${escapeHtml(row.text || '')}</pre>
      </div>`;
    }).join('');
  };

  ReportAiAssistPanel.prototype.bindEvents = function () {
    const openBtn = document.getElementById(this.context === 'matrix' ? 'btnReportMatrixAiAssist' : 'btnReportInstanceAiAssist');
    if (this.context === 'matrix') {
      document.getElementById('btnReportMatrixAiAssist')?.addEventListener('click', () => { void this.openModal(); });
    } else {
      openBtn?.addEventListener('click', () => { void this.openModal(); });
    }
    this.serviceSelect?.addEventListener('change', () => { void this.refreshInputsFromServer(); });
    this.runBtn?.addEventListener('click', () => { void this.runSelected(); });
    document.getElementById('reportAiAssistModalCopyResult')?.addEventListener('click', async () => {
      const ok = await copyText(this.resultBody?.textContent || '');
      notify(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'warning', ok ? 'Result copied to clipboard.' : 'Could not copy.');
    });
    this.trayBody?.addEventListener('click', async (event) => {
      const btn = event.target.closest('.js-report-ai-tray-copy');
      if (!btn) return;
      const id = btn.getAttribute('data-copy-id');
      const row = id ? this.results.get(id) : null;
      const ok = await copyText(row?.text || '');
      notify(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'warning', ok ? 'Result copied to clipboard.' : 'Could not copy.');
    });
    document.getElementById('reportAiAssistTrayClearBtn')?.addEventListener('click', () => {
      this.results.clear();
      this.persistResults();
      this.renderTray();
    });
  };

  window.ReportAiAssistPanel = ReportAiAssistPanel;

  window.initReportAiAssistPanel = function (options) {
    return new ReportAiAssistPanel(options);
  };
})();