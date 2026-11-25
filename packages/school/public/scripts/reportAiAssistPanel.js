(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildReportAiAssistJsonHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    const csrfToken = String(document.querySelector('meta[name="csrf-token"]')?.content || '').trim();
    if (csrfToken) {
      headers['csrf-token'] = csrfToken;
      headers['x-csrf-token'] = csrfToken;
    }
    const actionStateId = String(
      document.querySelector('input[name="actionStateId"]')?.value
      || document.getElementById('actionStateIdRef')?.dataset?.id
      || document.getElementById('actionStateIdRef')?.getAttribute('data-id')
      || ''
    ).trim();
    if (actionStateId) headers['X-Action-State-Id'] = actionStateId;
    return headers;
  }

  function formatRunResult(result) {
    if (!result || typeof result !== 'object') return '';
    if (result.ok === false && result.error) return 'Error: ' + String(result.error);
    if (result.data && typeof result.data === 'object') return JSON.stringify(result.data, null, 2);
    return String(result.displayText || result.rawText || '');
  }

  function resolveTrayInputPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.resolved && typeof payload.resolved === 'object' && !Array.isArray(payload.resolved)) {
      return payload;
    }
    return { resolved: payload };
  }

  function formatTrayInputsPlainText(inputPayload) {
    const shaped = resolveTrayInputPayload(inputPayload);
    if (!shaped) return '';
    try {
      return JSON.stringify(shaped, null, 2);
    } catch (_) {
      return '';
    }
  }

  function buildTrayInputsHtml(row) {
    const plain = formatTrayInputsPlainText(row?.inputPayload);
    if (!plain || plain === '{}' || plain === '{\n  "resolved": {}\n}') return '';
    const inputsCollapseId = `${trayCardCollapseDomId(row.usageRecordId || row.bindingRowId)}_inputs`;
    return `<div class="report-ai-tray-inputs mt-3">
      <button
        type="button"
        class="btn btn-link btn-sm p-0 text-decoration-none report-ai-tray-inputs-toggle"
        data-bs-toggle="collapse"
        data-bs-target="#${escapeHtml(inputsCollapseId)}"
        aria-expanded="false"
        aria-controls="${escapeHtml(inputsCollapseId)}"
      ><i class="bi bi-sliders me-1" aria-hidden="true"></i>Inputs used for this run</button>
      <div id="${escapeHtml(inputsCollapseId)}" class="collapse mt-2">
        <div class="report-ai-result-body report-ai-result-json small" data-plain-text="${escapeHtml(plain)}">${escapeHtml(plain)}</div>
      </div>
    </div>`;
  }

  function summarizeRunResult(result) {
    const mode = String(result?.mode || 'markdown').toLowerCase();
    const isError = result?.ok === false;
    const resultData = result?.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data
      : null;
    const text = isError
      ? formatRunResult(result)
      : (resultData ? JSON.stringify(resultData, null, 2) : formatRunResult(result));
    const isJson = mode === 'json' || Boolean(resultData);
    return {
      text,
      mode,
      isError,
      isJson,
      resultData,
      traceId: String(result?.traceId || '').trim()
    };
  }

  function sectionHasAction(section, name) {
    return Array.isArray(section?.actions) && section.actions.includes(name);
  }

  const CHANGE_TYPE_META = {
    unchanged: { label: 'No change', badge: 'secondary', accent: 'unchanged' },
    minor_edit: { label: 'Minor edit', badge: 'info', accent: 'minor' },
    updated: { label: 'Updated', badge: 'warning', accent: 'updated' },
    replaced: { label: 'Replaced', badge: 'primary', accent: 'replaced' }
  };

  function normalizeChangeType(token) {
    return String(token || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function resolveSectionContent(section, data) {
    const key = String(section?.resultKey || '').trim();
    if (!key || !data) return null;
    const raw = data[key];
    if (raw === undefined || raw === null) return null;
    const valueField = String(section?.valueField || '').trim();
    let valueText = '';
    let changeType = '';
    let changeSummary = '';
    if (valueField && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      valueText = String(raw[valueField] ?? '').trim();
      const changeTypeField = String(section?.changeTypeField || 'changeType').trim();
      const changeSummaryField = String(section?.changeSummaryField || 'changeSummary').trim();
      changeType = normalizeChangeType(raw[changeTypeField]);
      changeSummary = String(raw[changeSummaryField] ?? '').trim();
    } else {
      valueText = String(raw).trim();
    }
    if (!valueText) return null;
    return { key, valueText, changeType, changeSummary };
  }

  function changeTypeBadgeHtml(changeType) {
    const token = normalizeChangeType(changeType);
    if (!token) return '';
    const meta = CHANGE_TYPE_META[token] || { label: token.replace(/_/g, ' '), badge: 'secondary', accent: 'updated' };
    return `<span class="badge rounded-pill report-ai-change-badge text-bg-${escapeHtml(meta.badge)}">${escapeHtml(meta.label)}</span>`;
  }

  function sectionAccentClass(changeType) {
    const token = normalizeChangeType(changeType);
    const meta = CHANGE_TYPE_META[token];
    return meta ? ` report-ai-section--${meta.accent}` : '';
  }

  function formatSectionPlainText(data, reportUi) {
    if (!data || !reportUi || !Array.isArray(reportUi.sections)) {
      return JSON.stringify(data || {}, null, 2);
    }
    return reportUi.sections.map((section) => {
      const content = resolveSectionContent(section, data);
      if (!content) return '';
      const title = section.title || section.resultKey;
      const meta = CHANGE_TYPE_META[content.changeType];
      const changeLine = content.changeType
        ? `[${meta ? meta.label : content.changeType}]${content.changeSummary ? ` ${content.changeSummary}` : ''}`
        : '';
      return [title + ':', changeLine, content.valueText].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n\n');
  }

  function buildStructuredSectionsHtml(data, reportUi, bindingRowId) {
    if (!data || !reportUi || reportUi.layout !== 'sections' || !Array.isArray(reportUi.sections)) {
      return null;
    }
    const parts = [];
    reportUi.sections.forEach((section) => {
      const key = String(section?.resultKey || '').trim();
      if (!key) return;
      const content = resolveSectionContent(section, data);
      if (!content) return;
      const actionBtns = [];
      if (sectionHasAction(section, 'copy')) {
        actionBtns.push(`<button type="button" class="btn btn-outline-secondary btn-sm py-0 js-report-ai-section-copy" data-section-key="${escapeHtml(key)}" data-binding-id="${escapeHtml(bindingRowId)}"><i class="bi bi-clipboard me-1"></i>Copy</button>`);
      }
      if (sectionHasAction(section, 'apply')) {
        const inputId = String(section.inputId || key).trim();
        actionBtns.push(`<button type="button" class="btn btn-outline-primary btn-sm py-0 js-report-ai-section-apply" data-section-key="${escapeHtml(key)}" data-input-id="${escapeHtml(inputId)}" data-binding-id="${escapeHtml(bindingRowId)}"><i class="bi bi-arrow-down-circle me-1"></i>Apply</button>`);
      }
      const badge = content.changeType ? changeTypeBadgeHtml(content.changeType) : '';
      const summaryBlock = content.changeSummary
        ? `<div class="report-ai-change-callout small mb-2"><i class="bi bi-info-circle me-1" aria-hidden="true"></i><span class="report-ai-change-callout-label">What changed:</span> ${escapeHtml(content.changeSummary)}</div>`
        : '';
      parts.push(`<div class="report-ai-result-section card border-0 shadow-sm mb-3${sectionAccentClass(content.changeType)}" data-section-key="${escapeHtml(key)}">
        <div class="report-ai-section-accent" aria-hidden="true"></div>
        <div class="card-header bg-transparent border-0 py-2 px-3 pt-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div class="d-flex flex-wrap align-items-center gap-2">
            <span class="fw-semibold mb-0 report-ai-section-title">${escapeHtml(section.title || key)}</span>
            ${badge}
          </div>
          <div class="d-flex flex-wrap gap-1">${actionBtns.join('')}</div>
        </div>
        <div class="card-body pt-0 pb-3 px-3">
          ${summaryBlock}
          <div class="report-ai-section-text">${escapeHtml(content.valueText)}</div>
        </div>
      </div>`);
    });
    if (!parts.length) {
      return '<p class="text-muted mb-0">No section content in response.</p>';
    }
    return parts.join('');
  }

  function formatInlineMarkdown(text) {
    let s = escapeHtml(text);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<code class="report-ai-inline-code">$1</code>');
    return s;
  }

  function renderMarkdownLite(source) {
    const lines = String(source || '').split('\n');
    const html = [];
    let inList = false;
    const closeList = () => {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
    };
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('### ')) {
        closeList();
        html.push(`<h6 class="report-ai-result-heading">${formatInlineMarkdown(trimmed.slice(4))}</h6>`);
      } else if (trimmed.startsWith('## ')) {
        closeList();
        html.push(`<h6 class="report-ai-result-heading">${formatInlineMarkdown(trimmed.slice(3))}</h6>`);
      } else if (trimmed.startsWith('# ')) {
        closeList();
        html.push(`<h6 class="report-ai-result-heading">${formatInlineMarkdown(trimmed.slice(2))}</h6>`);
      } else if (/^[-*]\s+/.test(trimmed)) {
        if (!inList) {
          html.push('<ul class="report-ai-result-list">');
          inList = true;
        }
        html.push(`<li>${formatInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      } else if (!trimmed) {
        closeList();
      } else {
        closeList();
        html.push(`<p class="report-ai-result-para mb-0">${formatInlineMarkdown(trimmed)}</p>`);
      }
    });
    closeList();
    return html.join('');
  }

  function renderResultBodyHtml(summary, reportUi, bindingRowId) {
    if (!summary || (!summary.text && !summary.resultData)) {
      return { html: '<p class="text-muted mb-0">No output returned.</p>', plain: '' };
    }
    if (summary.isError) {
      return {
        html: `<p class="report-ai-result-para text-danger mb-0"><i class="bi bi-exclamation-octagon me-1"></i>${escapeHtml(summary.text)}</p>`,
        plain: summary.text
      };
    }
    if (summary.resultData && reportUi?.layout === 'sections') {
      const structuredHtml = buildStructuredSectionsHtml(summary.resultData, reportUi, bindingRowId);
      if (structuredHtml) {
        return {
          html: structuredHtml,
          plain: formatSectionPlainText(summary.resultData, reportUi),
          structured: true
        };
      }
    }
    if (summary.isJson) {
      return {
        html: escapeHtml(summary.text),
        plain: summary.text,
        json: true
      };
    }
    return { html: renderMarkdownLite(summary.text), plain: summary.text };
  }

  function modeBadgeLabel(mode) {
    const token = String(mode || 'markdown').toLowerCase();
    if (token === 'json') return 'JSON';
    return 'Markdown';
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

  function showAiAssistWaiting(options = {}) {
    if (typeof window.showLoading !== 'function') return null;
    return window.showLoading({
      title: options.title || 'AI Assist',
      operation: options.operation || 'AI Assist',
      note: options.note || 'Running AI Assist…'
    });
  }

  function updateAiAssistWaiting(note, operation) {
    if (typeof window.updateLoading !== 'function') return;
    const patch = { title: 'AI Assist', note: String(note || '').trim() || 'Running AI Assist…' };
    if (operation !== undefined) patch.operation = String(operation || '').trim();
    window.updateLoading(patch);
  }

  function hideAiAssistWaiting(token) {
    if (token && typeof window.hideLoading === 'function') window.hideLoading(token);
  }

  function ReportAiAssistPanel(options = {}) {
    this.context = String(options.context || 'instance');
    this.catalog = Array.isArray(options.catalog) ? options.catalog : [];
    this.identity = options.identity && typeof options.identity === 'object' ? options.identity : {};
    this.getAnswersOverride = typeof options.getAnswersOverride === 'function' ? options.getAnswersOverride : () => ({});
    this.canClearTray = options.canClearTray === true;
    this.runHistory = [];
    this.trayHiddenLocally = false;
    this.modalEl = document.getElementById('reportAiAssistModal');
    this.modal = null;
    this.serviceSelect = document.getElementById('reportAiAssistServiceSelect');
    this.servicePickerWrap = document.getElementById('reportAiAssistServicePickerWrap');
    this.serviceDescription = document.getElementById('reportAiAssistServiceDescription');
    this.inputsHost = document.getElementById('reportAiAssistInputsHost');
    this.runBtn = document.getElementById('reportAiAssistModalRunBtn');
    this.resultWrap = document.getElementById('reportAiAssistModalResult');
    this.resultBody = document.getElementById('reportAiAssistModalResultBody');
    this.resultTitle = document.getElementById('reportAiAssistModalResultTitle');
    this.resultMeta = document.getElementById('reportAiAssistModalResultMeta');
    this.resultModeBadge = document.getElementById('reportAiAssistModalResultMode');
    this.resultIcon = document.getElementById('reportAiAssistModalResultIcon');
    this.tray = document.getElementById('reportAiAssistResultsTray');
    this.trayBody = document.getElementById('reportAiAssistResultsTrayBody');
    this.trayCount = document.getElementById('reportAiAssistResultsTrayCount');
    this.trayCollapseEl = document.getElementById('reportAiAssistResultsTrayCollapse');
    this.trayToggleBtn = document.getElementById('reportAiAssistTrayToggleBtn');
    this.bindEvents();
    const loadHistory = () => { void this.loadHistoryFromServer(); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadHistory, { once: true });
    } else {
      loadHistory();
    }
  }

  ReportAiAssistPanel.prototype.buildHistoryBody = function () {
    const body = { context: this.context };
    if (this.context === 'matrix') {
      body.assignmentId = this.identity.assignmentId;
      body.assignmentRowId = this.identity.assignmentRowId || '';
      body.teacherId = this.identity.teacherId || '';
    } else {
      body.instanceId = this.identity.instanceId;
    }
    return body;
  };

  ReportAiAssistPanel.prototype.mapHistoryRunToTrayRow = function (run) {
    const result = run?.outputPayload && typeof run.outputPayload === 'object' ? run.outputPayload : {};
    const summary = summarizeRunResult(result);
    const catalogEntry = this.catalog.find((row) => String(row.bindingRowId) === String(run.bindingRowId)) || null;
    const isFailed = String(run?.status || '').toLowerCase() === 'failed' || summary.isError;
    const failedMessage = isFailed && !summary.text
      ? String(result.error || run.outputPayload?.error || 'AI Assist run failed.')
      : summary.text;
    return {
      usageRecordId: String(run.usageRecordId || run.id || '').trim(),
      bindingRowId: run.bindingRowId,
      label: run.label || catalogEntry?.label,
      ranByUserId: run.ranByUserId || '',
      ranByLabel: run.ranByLabel || run.ranByUserId || '',
      text: failedMessage,
      mode: summary.mode || result.mode || 'markdown',
      isError: isFailed,
      isJson: summary.isJson,
      resultData: summary.resultData || result.data || null,
      reportUi: run.reportUi || catalogEntry?.reportUi || null,
      entrySnapshot: {
        inputBindings: catalogEntry?.inputBindings || null,
        reportUi: run.reportUi || catalogEntry?.reportUi || null
      },
      at: run.at || new Date().toISOString(),
      traceId: run.traceId || summary.traceId || '',
      inputPayload: run.inputPayload || null
    };
  };

  ReportAiAssistPanel.prototype.loadHistoryFromServer = async function () {
  const historyBody = this.buildHistoryBody();
    try {
      const response = await fetch('/school/reports/ai-assist/history', {
        method: 'POST',
        headers: buildReportAiAssistJsonHeaders(),
        body: JSON.stringify(historyBody)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') return;
      const sorted = (Array.isArray(payload.runs) ? payload.runs : []).slice().sort(
        (a, b) => String(b?.at || '').localeCompare(String(a?.at || ''))
      );
      this.runHistory = sorted.map((run) => this.mapHistoryRunToTrayRow(run));
      if (!this.trayHiddenLocally) this.renderTray();
    } catch (_) { /* ignore — tray empty until user runs or reload */ }
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

  ReportAiAssistPanel.prototype.buildRunWaitingNote = function (entry, stage) {
    const label = String(entry?.label || entry?.serviceKey || 'AI service').trim();
    const dataSource = this.context === 'matrix'
      ? 'Fill Reports matrix (shared fields and common columns for this teacher and assignment row, including unsaved edits in the grid).'
      : 'this report instance (saved answers and current on-screen field values).';
    if (stage === 'prepare') {
      return [
        `Service: ${label}`,
        `Context: ${dataSource}`,
        'Checking inputs and preparing the run request…'
      ].join('\n');
    }
    if (stage === 'remote') {
      return [
        `Service: ${label}`,
        'The school server is calling the configured AI provider. Generation time depends on model load and output length.',
        'Please keep this page open until the response is ready.'
      ].join('\n');
    }
    if (stage === 'finish') {
      return `Service: ${label}\nFormatting the AI response and updating your results…`;
    }
    return `Running ${label}…`;
  };

  ReportAiAssistPanel.prototype.findTrayRowByUsageId = function (usageRecordId) {
    const token = String(usageRecordId || '').trim();
    if (!token) return null;
    return this.runHistory.find((row) => String(row?.usageRecordId || '') === token) || null;
  };

  ReportAiAssistPanel.prototype.findLatestTrayRowForBinding = function (bindingRowId) {
    const token = String(bindingRowId || '').trim();
    if (!token) return null;
    return this.runHistory.find((row) => String(row?.bindingRowId || '') === token) || null;
  };

  ReportAiAssistPanel.prototype.resolveEntrySnapshot = function (bindingRowId) {
    const id = String(bindingRowId || '').trim();
    if (!id) return this._lastRunEntry || null;
    const stored = this.findLatestTrayRowForBinding(id);
    if (stored?.entrySnapshot) return stored.entrySnapshot;
    return this.catalog.find((row) => String(row.bindingRowId) === id) || this._lastRunEntry || null;
  };

  ReportAiAssistPanel.prototype.applySectionValue = function (inputId, text, entry) {
    const value = String(text ?? '');
    const token = String(inputId || '').trim();
    if (token) {
      const modalInput = this.inputsHost?.querySelector(`[data-ai-input="${token}"]`);
      if (modalInput) {
        if (modalInput.type === 'checkbox') {
          modalInput.checked = value.toLowerCase() === 'true';
        } else {
          modalInput.value = value;
        }
        modalInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    const bindings = entry?.inputBindings && typeof entry.inputBindings === 'object' ? entry.inputBindings : {};
    const binding = bindings[token];
    if (binding && String(binding.source || '').toLowerCase() === 'field') {
      const fieldId = String(binding.value || '').trim();
      if (fieldId) {
        const candidates = document.querySelectorAll(
          `.js-report-field[data-field-id="${fieldId}"], .js-matrix-row-field[data-field-id="${fieldId}"], .js-matrix-shared-field[data-field-id="${fieldId}"]`
        );
        for (let i = 0; i < candidates.length; i += 1) {
          const fieldEl = candidates[i];
          if (fieldEl.disabled || fieldEl.readOnly) continue;
          if (fieldEl.type === 'checkbox') {
            fieldEl.checked = value.toLowerCase() === 'true';
          } else {
            fieldEl.value = value;
          }
          fieldEl.dispatchEvent(new Event('input', { bubbles: true }));
          fieldEl.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
  };

  ReportAiAssistPanel.prototype.handleSectionActionClick = async function (event) {
    const copyBtn = event.target.closest('.js-report-ai-section-copy');
    const applyBtn = event.target.closest('.js-report-ai-section-apply');
    if (!copyBtn && !applyBtn) return;
    const bindingRowId = String((copyBtn || applyBtn).getAttribute('data-binding-id') || '').trim();
    const sectionKey = String((copyBtn || applyBtn).getAttribute('data-section-key') || '').trim();
    const card = (copyBtn || applyBtn).closest('.report-ai-tray-card');
    const usageId = String(card?.getAttribute('data-tray-id') || '').trim();
    const stored = usageId
      ? this.findTrayRowByUsageId(usageId)
      : (bindingRowId ? this.findLatestTrayRowForBinding(bindingRowId) : null);
    const data = stored?.resultData;
    const entry = this.resolveEntrySnapshot(bindingRowId);
    const section = entry?.reportUi?.sections?.find((row) => String(row?.resultKey || '') === sectionKey) || {
      resultKey: sectionKey,
      inputId: sectionKey
    };
    const content = data ? resolveSectionContent(section, data) : null;
    const text = content?.valueText || '';
    if (!text) return;
    if (copyBtn) {
      const ok = await copyText(text);
      notify(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'warning', ok ? 'Section copied.' : 'Could not copy.');
      return;
    }
    const inputId = String(applyBtn.getAttribute('data-input-id') || sectionKey).trim();
    this.applySectionValue(inputId, text, entry);
    notify('Applied', 'success', 'Updated the AI Assist input and the bound report field when available.');
  };

  ReportAiAssistPanel.prototype.paintModalResult = function (summary, serviceLabel, entry) {
    if (!this.resultWrap || !this.resultBody) return;
    const bindingRowId = String(entry?.bindingRowId || '').trim();
    const reportUi = entry?.reportUi || null;
    const rendered = renderResultBodyHtml(summary, reportUi, bindingRowId);
    this.resultWrap.classList.toggle('is-error', Boolean(summary?.isError));
    if (this.resultIcon) {
      this.resultIcon.innerHTML = summary?.isError
        ? '<i class="bi bi-exclamation-lg"></i>'
        : '<i class="bi bi-check-lg"></i>';
    }
    if (this.resultTitle) {
      this.resultTitle.textContent = summary?.isError ? 'AI Assist could not finish' : 'AI response ready';
    }
    const label = String(serviceLabel || 'AI Assist').trim();
    const metaParts = [label];
    if (summary?.traceId) metaParts.push(`Trace ${summary.traceId}`);
    if (this.resultMeta) this.resultMeta.textContent = metaParts.join(' · ');
    if (this.resultModeBadge) {
      if (summary?.isError) {
        this.resultModeBadge.classList.add('d-none');
      } else {
        this.resultModeBadge.textContent = modeBadgeLabel(summary?.mode);
        this.resultModeBadge.className = 'badge rounded-pill report-ai-mode-badge text-bg-light border';
      }
    }
    this.resultBody.classList.toggle('report-ai-result-json', Boolean(rendered.json));
    this.resultBody.classList.toggle('report-ai-result-markdown', !rendered.json && !rendered.structured && !summary?.isError);
    this.resultBody.classList.toggle('report-ai-result-structured', Boolean(rendered.structured));
    if (rendered.json) this.resultBody.textContent = rendered.plain;
    else this.resultBody.innerHTML = rendered.html;
    this.resultBody.setAttribute('data-plain-text', rendered.plain);
    this.resultWrap.classList.remove('d-none');
  };

  function trayCardCollapseDomId(bindingRowId) {
    const safe = String(bindingRowId || 'card').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `reportAiTrayCollapse_${safe}`;
  }

  ReportAiAssistPanel.prototype.ensureTrayExpanded = function () {
    if (!this.trayCollapseEl || !window.bootstrap?.Collapse) return;
    const instance = window.bootstrap.Collapse.getOrCreateInstance(this.trayCollapseEl, { toggle: false });
    instance.show();
    if (this.trayToggleBtn) this.trayToggleBtn.setAttribute('aria-expanded', 'true');
  };

  ReportAiAssistPanel.prototype.focusResultsTray = function (bindingRowId) {
    if (!this.tray) return;
    this.ensureTrayExpanded();
    let card = null;
    if (bindingRowId) {
      const token = String(bindingRowId);
      card = [...this.tray.querySelectorAll('.report-ai-tray-card')].find(
        (el) => String(el.getAttribute('data-binding-id') || '') === token
      );
    } else {
      card = this.tray.querySelector('.report-ai-tray-card');
    }
    if (card) {
      const collapseEl = card.querySelector('.report-ai-tray-card-collapse');
      if (collapseEl && window.bootstrap?.Collapse) {
        window.bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false }).show();
        const toggle = card.querySelector('.report-ai-tray-card-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
      }
      card.classList.add('report-ai-tray-card--focus');
      window.setTimeout(() => card.classList.remove('report-ai-tray-card--focus'), 2200);
      card.setAttribute('tabindex', '-1');
      try {
        card.focus({ preventScroll: true });
      } catch (_) { /* ignore */ }
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      this.tray.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  ReportAiAssistPanel.prototype.buildTrayCardHtml = function (row, expandDefault) {
    const summary = {
      text: row.text,
      mode: row.mode || 'markdown',
      isError: row.isError === true,
      isJson: row.isJson === true,
      traceId: row.traceId || '',
      resultData: row.resultData || null
    };
    const reportUi = row.reportUi || row.entrySnapshot?.reportUi || null;
    const rendered = renderResultBodyHtml(summary, reportUi, row.bindingRowId);
    const when = row.at ? new Date(row.at).toLocaleString() : '';
    const ranBy = String(row.ranByLabel || '').trim();
    const metaLine = [when, ranBy ? `Ran by ${ranBy}` : ''].filter(Boolean).join(' · ');
    const title = escapeHtml(row.label || row.bindingRowId);
    const errorClass = summary.isError ? ' is-error' : '';
    const bodyClass = rendered.json
      ? ' report-ai-result-json'
      : (rendered.structured ? ' report-ai-result-structured' : ' report-ai-result-markdown');
    const bodyContent = rendered.json ? escapeHtml(rendered.plain) : rendered.html;
    const collapseId = trayCardCollapseDomId(row.usageRecordId || row.bindingRowId);
    const inputsHtml = buildTrayInputsHtml(row);
    const isOpen = expandDefault === true;
    const collapseClass = isOpen ? 'collapse show' : 'collapse';
    const trayKey = String(row.usageRecordId || row.bindingRowId || '').trim();
    return `<article class="report-ai-tray-card${errorClass}" data-tray-id="${escapeHtml(trayKey)}" data-binding-id="${escapeHtml(row.bindingRowId)}">
      <div class="report-ai-tray-card-accent" aria-hidden="true"></div>
      <div class="report-ai-tray-card-inner">
        <div class="report-ai-tray-card-header d-flex flex-wrap justify-content-between align-items-start gap-2">
          <div class="d-flex align-items-center gap-2 min-w-0 flex-grow-1">
            <button
              type="button"
              class="btn btn-link report-ai-tray-card-toggle p-0 flex-shrink-0"
              data-bs-toggle="collapse"
              data-bs-target="#${escapeHtml(collapseId)}"
              aria-expanded="${isOpen ? 'true' : 'false'}"
              aria-controls="${escapeHtml(collapseId)}"
              title="Show or hide result"
            ><i class="bi bi-chevron-down report-ai-tray-card-chevron" aria-hidden="true"></i></button>
            <span class="report-ai-icon-chip report-ai-icon-chip-sm flex-shrink-0" aria-hidden="true"><i class="bi bi-${summary.isError ? 'exclamation-lg' : 'stars'}"></i></span>
            <div class="min-w-0">
              <div class="fw-semibold report-ai-tray-title text-truncate">${title}</div>
              ${metaLine ? `<div class="small text-muted">${escapeHtml(metaLine)}</div>` : ''}
            </div>
          </div>
          <div class="d-flex flex-wrap align-items-center gap-2">
            ${!summary.isError ? `<span class="badge rounded-pill report-ai-mode-badge text-bg-light border">${escapeHtml(modeBadgeLabel(summary.mode))}</span>` : ''}
            <button type="button" class="btn btn-outline-secondary btn-sm js-report-ai-tray-copy" data-copy-id="${escapeHtml(trayKey)}"><i class="bi bi-clipboard me-1"></i>Copy</button>
          </div>
        </div>
        <div id="${escapeHtml(collapseId)}" class="${collapseClass} report-ai-tray-card-collapse">
          <div class="report-ai-tray-card-body-wrap">
            <div class="report-ai-result-body${bodyClass}" data-plain-text="${escapeHtml(rendered.plain)}">${bodyContent}</div>
            ${inputsHtml}
            ${summary.traceId ? `<div class="small text-muted mt-2 font-monospace">Trace: ${escapeHtml(summary.traceId)}</div>` : ''}
          </div>
        </div>
      </div>
    </article>`;
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
        headers: buildReportAiAssistJsonHeaders(),
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
      if (refreshed.reportUi) entry.reportUi = refreshed.reportUi;
      if (refreshed.outputMode) entry.outputMode = refreshed.outputMode;
      entry.inputBindings = refreshed.inputBindings || entry.inputBindings;
      const renderEntry = { ...entry, inputDefaults: defaults };
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
    const runBtnLabel = this.runBtn.innerHTML;
    const serviceOperation = String(entry.label || entry.serviceKey || 'AI Assist').trim();
    this.runBtn.disabled = true;
    this.runBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Running…';
    let loadingToken = null;
    try {
      loadingToken = showAiAssistWaiting({
        operation: serviceOperation,
        note: this.buildRunWaitingNote(entry, 'prepare')
      });
      updateAiAssistWaiting(this.buildRunWaitingNote(entry, 'remote'), serviceOperation);
      const response = await fetch('/school/reports/ai-assist/run', {
        method: 'POST',
        headers: buildReportAiAssistJsonHeaders(),
        body: JSON.stringify(this.buildRequestBody(entry.bindingRowId, inputs))
      });
      updateAiAssistWaiting(this.buildRunWaitingNote(entry, 'finish'), serviceOperation);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Run failed.');
      const summary = summarizeRunResult(payload.result);
      this._lastRunEntry = {
        bindingRowId: entry.bindingRowId,
        inputBindings: entry.inputBindings,
        reportUi: entry.reportUi || null,
        outputMode: entry.outputMode || summary.mode
      };
      this.trayHiddenLocally = false;
      await this.loadHistoryFromServer();
      if (summary.isError) {
        this.paintModalResult(summary, entry.label || entry.serviceKey, entry);
      } else {
        this.resultWrap?.classList.add('d-none');
        const modal = this.ensureModalInstance();
        if (modal) modal.hide();
        notify('AI Assist', 'success', 'Results are ready in AI Assist results.');
        window.requestAnimationFrame(() => {
          this.focusResultsTray(entry.bindingRowId);
        });
      }
    } catch (err) {
      notify('AI Assist failed', 'error', err.message || 'Run failed.');
    } finally {
      hideAiAssistWaiting(loadingToken);
      this.runBtn.disabled = false;
      this.runBtn.innerHTML = runBtnLabel;
    }
  };

  ReportAiAssistPanel.prototype.renderTray = function () {
    if (!this.tray || !this.trayBody) return;
    if (this.trayHiddenLocally || !this.runHistory.length) {
      this.tray.classList.add('d-none');
      this.trayBody.innerHTML = '';
      return;
    }
    this.tray.classList.remove('d-none');
    const rows = this.runHistory;
    if (this.trayCount) {
      this.trayCount.textContent = String(rows.length);
      this.trayCount.classList.toggle('d-none', rows.length < 2);
    }
    this.trayBody.innerHTML = rows.map((row, index) => this.buildTrayCardHtml(row, index === 0)).join('');
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
      const plain = this.resultBody?.getAttribute('data-plain-text') || this.resultBody?.textContent || '';
      const ok = await copyText(plain);
      notify(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'warning', ok ? 'Result copied to clipboard.' : 'Could not copy.');
    });
    this.resultBody?.addEventListener('click', (event) => {
      void this.handleSectionActionClick(event);
    });
    this.trayBody?.addEventListener('click', async (event) => {
      if (event.target.closest('[data-bs-toggle="collapse"]')) return;
      if (event.target.closest('.js-report-ai-section-copy, .js-report-ai-section-apply')) {
        void this.handleSectionActionClick(event);
        return;
      }
      const btn = event.target.closest('.js-report-ai-tray-copy');
      if (!btn) return;
      const id = btn.getAttribute('data-copy-id');
      const row = id ? this.findTrayRowByUsageId(id) : null;
      const copyPayload = row?.reportUi?.layout === 'sections' && row.resultData
        ? formatSectionPlainText(row.resultData, row.reportUi)
        : (row?.text || '');
      const ok = await copyText(copyPayload);
      notify(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'warning', ok ? 'Result copied to clipboard.' : 'Could not copy.');
    });
    if (this.canClearTray) {
      document.getElementById('reportAiAssistTrayClearBtn')?.addEventListener('click', () => {
        this.trayHiddenLocally = true;
        this.runHistory = [];
        this.renderTray();
      });
    }
  };

  window.ReportAiAssistPanel = ReportAiAssistPanel;

  window.initReportAiAssistPanel = function (options) {
    return new ReportAiAssistPanel(options);
  };
})();