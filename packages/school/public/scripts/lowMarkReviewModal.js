(function (global) {
  'use strict';

  let ctx = null;
  let modalInstance = null;
  let pollTimer = null;
  let activeJobId = null;
  let tipEl = null;
  let tipAnchor = null;
  let lastThreshold = 60;

  function qs(id) {
    return document.getElementById(id);
  }

  function escape(value) {
    return typeof ctx?.escapeHtml === 'function' ? ctx.escapeHtml(value) : String(value ?? '');
  }

  function getModal() {
    const el = qs('lowMarkReviewModal');
    if (!el || !global.bootstrap?.Modal) return null;
    if (!modalInstance) modalInstance = global.bootstrap.Modal.getOrCreateInstance(el);
    return modalInstance;
  }

  function showMessage(options) {
    if (typeof ctx?.showReportMessage === 'function') {
      ctx.showReportMessage({ title: 'Low Average Mark Review', ...(options || {}) });
    }
  }

  function selectedOptions(selectEl) {
    if (!selectEl) return [];
    return [...selectEl.options].filter((opt) => opt.selected && String(opt.value || '').trim()).map((opt) => opt.value);
  }

  function formatMark(mark) {
    const n = Number(mark);
    if (!Number.isFinite(n)) return '—';
    return `${Math.round(n)}%`;
  }

  const METRIC_ICON_BY_KEY = {
    attendance: 'bi-person-check-fill',
    punctuality: 'bi-alarm-fill',
    speaking: 'bi-mic-fill',
    listening: 'bi-headphones',
    reading: 'bi-book-fill',
    writing: 'bi-pencil-fill',
    average_class_mark: 'bi-calculator-fill'
  };

  const METRIC_UI_LABEL_BY_KEY = {
    attendance: 'Attendance',
    punctuality: 'Punctuality',
    speaking: 'Speaking',
    listening: 'Listening',
    reading: 'Reading',
    writing: 'Writing',
    average_class_mark: 'Average Class Mark'
  };

  function renderMetricLegend(selectedMetrics) {
    const el = qs('lmrMetricLegend');
    if (!el) return;
    let metrics = Array.isArray(selectedMetrics) ? selectedMetrics : [];
    if (!metrics.length) {
      metrics = selectedMetricKeys().map((key) => ({
        key,
        uiLabel: METRIC_UI_LABEL_BY_KEY[key] || key
      }));
    }
    if (!metrics.length) {
      el.classList.add('d-none');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('d-none');
    el.innerHTML = metrics.map((m) => {
      const key = String(m.key || m).trim();
      const label = escape(m.uiLabel || METRIC_UI_LABEL_BY_KEY[key] || key);
      const iconClass = METRIC_ICON_BY_KEY[key] || 'bi-clipboard-data-fill';
      return `<span class="lmr-legend-item"><i class="bi ${iconClass} lmr-legend-icon" aria-hidden="true"></i><span>${label}</span></span>`;
    }).join('');
  }

  function metricIconHtml(entry) {
    const key = String(entry?.metricKey || '').trim();
    const iconClass = METRIC_ICON_BY_KEY[key] || 'bi-clipboard-data-fill';
    const stateClass = entry?.passesThreshold ? 'lmr-metric-icon--pass' : 'lmr-metric-icon--fail';
    const title = escape(entry?.metricLabel || entry?.fieldLabel || key || 'Metric');
    return `<i class="bi ${iconClass} lmr-metric-icon ${stateClass}" title="${title}" aria-hidden="true"></i>`;
  }

  function markSeverityClass(entry, threshold) {
    if (entry?.passesThreshold) return 'lmr-mark-ok';
    const mark = Number(entry?.mark);
    const limit = Number(threshold);
    if (!Number.isFinite(mark) || !Number.isFinite(limit)) return 'lmr-mark-gap-moderate';
    const gap = Math.max(0, limit - mark);
    if (gap <= 5) return 'lmr-mark-gap-slight';
    if (gap <= 15) return 'lmr-mark-gap-moderate';
    if (gap <= 25) return 'lmr-mark-gap-serious';
    return 'lmr-mark-gap-severe';
  }

  function tipStyleForSeverity(severityClass) {
    const map = {
      'lmr-mark-ok': { bg: '#2e7d32', fg: '#ffffff', border: '#1b5e20' },
      'lmr-mark-gap-slight': { bg: '#f9a825', fg: '#3e2723', border: '#f57f17' },
      'lmr-mark-gap-moderate': { bg: '#ef6c00', fg: '#ffffff', border: '#e65100' },
      'lmr-mark-gap-serious': { bg: '#d84315', fg: '#ffffff', border: '#bf360c' },
      'lmr-mark-gap-severe': { bg: '#c62828', fg: '#ffffff', border: '#b71c1c' }
    };
    return map[severityClass] || { bg: '#0f172a', fg: '#ffffff', border: '#0f172a' };
  }

  function simplifyTemplateTitle(label = '') {
    let text = String(label || '').trim();
    if (!text) return '';
    const pipeIdx = text.indexOf('|');
    if (pipeIdx > 0) text = text.slice(0, pipeIdx).trim();
    text = text.replace(/\s+\(progress report\)\s*$/i, '').trim();
    text = text.replace(/\s+v\d+(?:\.\d+)?\s*$/i, '').trim();
    return text;
  }

  function buildEntryTooltip(entry) {
    const lines = [];
    const template = simplifyTemplateTitle(entry.templateLabel || entry.templateId);
    if (template) lines.push(template);
    const className = String(entry.className || '').trim();
    if (className) lines.push(className);
    const teacherName = String(entry.teacherName || '').trim();
    if (teacherName) lines.push(teacherName);
    const fieldLabel = String(entry.fieldLabel || entry.metricLabel || '').trim();
    if (fieldLabel) lines.push(fieldLabel);
    return lines.join('\n');
  }

  function selectedMetricKeys() {
    const modal = qs('lowMarkReviewModal');
    if (!modal) return [];
    return [...modal.querySelectorAll('.lmr-metric-key:checked')]
      .map((el) => String(el.value || '').trim())
      .filter(Boolean);
  }

  function ensureTipElement() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'sch-event-tip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function hideTip() {
    if (!tipEl) return;
    tipEl.classList.remove('is-visible', 'is-below', 'lmr-cell-tip');
    tipEl.hidden = true;
    tipAnchor = null;
  }

  function showTip(target) {
    const el = ensureTipElement();
    const label = String(target?.getAttribute('data-tip') || '').trim();
    if (!label) {
      hideTip();
      return;
    }
    const tipBg = target.getAttribute('data-tip-bg') || '#0f172a';
    const tipFg = target.getAttribute('data-tip-fg') || '#ffffff';
    const tipBorder = target.getAttribute('data-tip-border') || tipBg;
    const isLmrCell = Boolean(target?.classList?.contains('lmr-cell-chip'));
    el.classList.toggle('lmr-cell-tip', isLmrCell);
    const parts = label.split('\n').map((part) => String(part || '').trim()).filter(Boolean);
    el.innerHTML = parts.map((part, index) => (
      `<span class="sch-tip-line${index > 0 ? ' sch-tip-sub' : ''} lmr-tip-line">${escape(part)}</span>`
    )).join('');
    el.style.background = tipBg;
    el.style.color = tipFg;
    el.style.borderColor = tipBorder;
    el.style.setProperty('--sch-tip-arrow', tipBg);
    el.hidden = false;
    el.classList.remove('is-below');
    const rect = target.getBoundingClientRect();
    let left = rect.left + (rect.width / 2);
    const tipWidth = el.offsetWidth || 160;
    const tipHeight = el.offsetHeight || 80;
    const pad = 10;
    left = Math.max(pad + tipWidth / 2, Math.min(left, window.innerWidth - pad - tipWidth / 2));
    el.style.left = `${left}px`;
    if ((rect.top - tipHeight - 14) < pad) {
      el.classList.add('is-below');
      el.style.top = `${Math.min(window.innerHeight - pad - tipHeight, rect.bottom)}px`;
    } else {
      el.style.top = `${Math.max(8, rect.top)}px`;
    }
    el.classList.add('is-visible');
    tipAnchor = target;
  }

  function shouldUseHoverTips() {
    if (window.matchMedia('(hover: none)').matches) return false;
    if (window.matchMedia('(max-width: 767.98px)').matches) return false;
    return true;
  }

  function wireCellTips(root) {
    if (!root || root.dataset.lmrTipsWired === '1') return;
    root.dataset.lmrTipsWired = '1';
    root.addEventListener('scroll', hideTip, true);
    root.addEventListener('pointerover', (event) => {
      if (!shouldUseHoverTips()) return;
      const target = event.target.closest('.lmr-cell-chip[data-tip], .lmr-warnings-chip[data-tip]');
      if (!target || !root.contains(target)) return;
      showTip(target);
    });
    root.addEventListener('pointerout', (event) => {
      const target = event.target.closest('.lmr-cell-chip[data-tip], .lmr-warnings-chip[data-tip]');
      if (!target) return;
      const next = event.relatedTarget;
      if (next && target.contains(next)) return;
      hideTip();
    });
    root.addEventListener('focusin', (event) => {
      const target = event.target.closest('.lmr-cell-chip[data-tip], .lmr-warnings-chip[data-tip]');
      if (target) showTip(target);
    });
    root.addEventListener('focusout', (event) => {
      const target = event.target.closest('.lmr-cell-chip[data-tip], .lmr-warnings-chip[data-tip]');
      if (!target) return;
      const next = event.relatedTarget;
      if (next && target.contains(next)) return;
      hideTip();
    });
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    activeJobId = null;
  }

  function setRunning(running) {
    const runBtn = qs('btn_lmrRunScan');
    const cancelBtn = qs('btn_lmrCancelScan');
    const progress = qs('lmrProgressWrap');
    if (runBtn) runBtn.disabled = running;
    if (cancelBtn) cancelBtn.classList.toggle('d-none', !running);
    if (progress) progress.classList.toggle('d-none', !running);
    if (!running) {
      const bar = qs('lmrProgressBar');
      if (bar) {
        bar.style.width = '0%';
        bar.setAttribute('aria-valuenow', '0');
        bar.classList.remove('progress-bar-animated');
      }
    }
  }

  function applyJobProgress(job) {
    const phaseEl = qs('lmrProgressPhase');
    const etaEl = qs('lmrProgressEta');
    const bar = qs('lmrProgressBar');
    const phase = String(job?.phase || 'working').trim();
    const labels = { templates: 'Checking templates…', instances: 'Scanning report instances…', students: 'Building results…' };
    if (phaseEl) phaseEl.textContent = labels[phase] || 'Scanning…';
    const pct = job?.progressPercent;
    if (bar && Number.isFinite(pct)) {
      bar.style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
      bar.classList.add('progress-bar-animated');
    }
    if (etaEl) {
      const sec = job?.estimatedSecondsRemaining;
      etaEl.textContent = Number.isFinite(sec) ? `About ${sec}s remaining` : '';
    }
  }

  function renderWarnings(warnings) {
    const el = qs('lmrWarnings');
    if (!el) return;
    const rows = Array.isArray(warnings) ? warnings : [];
    if (!rows.length) {
      el.classList.add('d-none');
      el.innerHTML = '';
      return;
    }
    const errors = rows.filter((row) => row.severity === 'error');
    const tipLines = rows.map((row) => String(row.message || '').trim()).filter(Boolean);
    const tipText = tipLines.join('\n');
    const summary = errors.length
      ? `${errors.length} template issue${errors.length === 1 ? '' : 's'}`
      : 'Some templates omit selected metrics';
    el.classList.remove('d-none');
    el.innerHTML = `<span class="lmr-warnings-chip" data-tip="${escape(tipText)}" data-tip-bg="#f59f00" data-tip-fg="#3e2723" data-tip-border="#e65100" tabindex="0" aria-label="${escape(summary)}. ${escape(tipText.replace(/\n/g, ', '))}">
      <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
      <span>${escape(summary)}</span>
    </span>`;
  }

  function renderResults(payload) {
    const empty = qs('lmrEmpty');
    const wrap = qs('lmrTableWrap');
    const head = qs('lmrResultsHead');
    const body = qs('lmrResultsBody');
    const students = Array.isArray(payload?.students) ? payload.students : [];
    const columns = Array.isArray(payload?.columns) ? payload.columns : [];
    const threshold = Number(payload?.threshold);
    if (Number.isFinite(threshold)) lastThreshold = threshold;
    if (!students.length) {
      renderMetricLegend([]);
      if (wrap) wrap.classList.add('d-none');
      if (empty) empty.classList.remove('d-none');
      return;
    }
    if (empty) empty.classList.add('d-none');
    if (wrap) wrap.classList.remove('d-none');
    renderMetricLegend(payload?.selectedMetrics);
    if (head) {
      head.innerHTML = `<th class="lmr-sticky-student">Student</th>${columns.map((col) => (
        `<th class="text-center">${escape(col.headerLabel || col.sessionDate)}</th>`
      )).join('')}`;
    }
    if (body) {
      body.innerHTML = students.map((student) => {
        const cells = student.cells && typeof student.cells === 'object' ? student.cells : {};
        return `<tr>
          <td class="lmr-sticky-student fw-semibold">${escape(student.name || student.studentRecordId)}</td>
          ${columns.map((col) => {
            const date = col.sessionDate;
            const entries = Array.isArray(cells[date]) ? cells[date] : [];
            if (!entries.length) return '<td class="text-center text-muted">—</td>';
            return `<td class="text-center small p-1">${entries.map((entry) => {
              const severity = markSeverityClass(entry, lastThreshold);
              const tipStyle = tipStyleForSeverity(severity);
              const tooltip = buildEntryTooltip(entry);
              const markText = formatMark(entry.mark);
              const icon = metricIconHtml(entry);
              const markLink = entry.editUrl
                ? `<a href="${escape(entry.editUrl)}" class="lmr-mark-badge ${severity}" target="_blank" rel="noopener noreferrer">${markText}</a>`
                : `<span class="lmr-mark-badge ${severity}">${markText}</span>`;
              const openLink = entry.editUrl
                ? `<a href="${escape(entry.editUrl)}" class="lmr-open-report" target="_blank" rel="noopener noreferrer" title="Open report">↗</a>`
                : '';
              return `<div class="lmr-cell-chip" data-tip="${escape(tooltip)}" data-tip-bg="${tipStyle.bg}" data-tip-fg="${tipStyle.fg}" data-tip-border="${tipStyle.border}" tabindex="0" aria-label="${escape(tooltip.replace(/\n/g, ', '))}">
                <span class="lmr-cell-value">${icon}${markLink}${openLink}</span>
              </div>`;
            }).join('')}</td>`;
          }).join('')}
        </tr>`;
      }).join('');
    }
  }

  async function pollJob(jobId) {
    const pollUrl = `/school/reports/semi-monthly/api/low-mark-review-jobs/${encodeURIComponent(jobId)}`;
  outer:
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const response = await fetch(pollUrl, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'x-ajax-request': 'true' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Could not check scan status.');
      }
      const job = payload.job || {};
      applyJobProgress(job);
      if (job.status === 'failed') throw new Error(job.error || 'Scan failed.');
      if (job.status === 'cancelled') {
        showMessage({ icon: 'info', message: 'Scan cancelled.' });
        return null;
      }
      if (job.status === 'complete') return payload.reviewPayload || null;
      await new Promise((resolve) => {
        pollTimer = setTimeout(resolve, 500);
      });
      if (activeJobId !== jobId) break outer;
    }
    throw new Error('Scan is taking longer than expected.');
  }

  function buildRequestBody() {
    return {
      startDate: String(qs('lmrStartDate')?.value || '').trim(),
      endDate: String(qs('lmrEndDate')?.value || '').trim(),
      threshold: String(qs('lmrThreshold')?.value || '').trim(),
      templateId: String(qs('lmrTemplateId')?.value || '').trim(),
      funderIds: selectedOptions(qs('lmrFunderIds')),
      metricKeys: selectedMetricKeys(),
      onlyBelowThreshold: qs('lmrOnlyBelowThreshold')?.checked !== false
    };
  }

  async function runScan() {
    stopPolling();
    hideTip();
    qs('lmrTableWrap')?.classList.add('d-none');
    qs('lmrEmpty')?.classList.add('d-none');
    renderMetricLegend([]);
    renderWarnings([]);
    const body = buildRequestBody();
    if (!body.startDate || !body.endDate) {
      showMessage({ icon: 'warning', message: 'Start and end dates are required.' });
      return;
    }
    if (!body.metricKeys.length) {
      showMessage({ icon: 'warning', message: 'Select at least one metric to review.' });
      return;
    }
    setRunning(true);
    try {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-ajax-request': 'true'
      };
      const stateId = String(ctx?.actionStateId || '').trim();
      if (stateId) headers['x-action-state-id'] = stateId;
      const response = await fetch('/school/reports/semi-monthly/api/low-mark-review/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ ...body, actionStateId: stateId })
      });
      const accepted = await response.json().catch(() => ({}));
      if (response.status !== 202) {
        throw new Error(accepted.message || 'Could not start scan.');
      }
      const jobId = accepted?.job?.jobId;
      if (!jobId) throw new Error('Scan job was not created.');
      activeJobId = jobId;
      const result = await pollJob(jobId);
      if (result?.status === 'success') {
        renderWarnings(result.templateWarnings);
        renderResults(result);
        if (result.message) showMessage({ icon: 'info', message: result.message });
      }
    } catch (error) {
      showMessage({ icon: 'error', message: error.message || 'Scan failed.' });
    } finally {
      setRunning(false);
      stopPolling();
    }
  }

  async function cancelScan() {
    if (!activeJobId) return;
    try {
      await fetch(`/school/reports/semi-monthly/api/low-mark-review-jobs/${encodeURIComponent(activeJobId)}/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-ajax-request': 'true' },
        body: JSON.stringify({})
      });
    } catch (_) {
      // polling will surface cancelled state
    }
  }

  function syncDatesFromPage() {
    const start = qs('filter_startDate')?.value || ctx?.initialStartDate || '';
    const end = qs('filter_endDate')?.value || ctx?.initialEndDate || '';
    if (qs('lmrStartDate') && start) qs('lmrStartDate').value = start;
    if (qs('lmrEndDate') && end) qs('lmrEndDate').value = end;
  }

  function init(options = {}) {
    ctx = options;
    qs('btn_openLowMarkReviewModal')?.addEventListener('click', () => {
      syncDatesFromPage();
      getModal()?.show();
    });
    qs('btn_lmrRunScan')?.addEventListener('click', () => runScan());
    qs('btn_lmrCancelScan')?.addEventListener('click', () => cancelScan());
    qs('lowMarkReviewModal')?.addEventListener('hidden.bs.modal', () => {
      cancelScan();
      stopPolling();
      setRunning(false);
      hideTip();
    });
    const modalEl = qs('lowMarkReviewModal');
    if (modalEl) wireCellTips(modalEl);
  }

  global.LowMarkReviewModal = { init };
})(typeof window !== 'undefined' ? window : global);