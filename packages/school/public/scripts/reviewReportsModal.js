(function (global) {
  'use strict';

  let ctx = null;
  let modalInstance = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function getModal() {
    const el = qs('reviewReportsModal');
    if (!el || !global.bootstrap?.Modal) return null;
    if (!modalInstance) modalInstance = global.bootstrap.Modal.getOrCreateInstance(el);
    return modalInstance;
  }

  function escape(value) {
    return typeof ctx?.escapeHtml === 'function' ? ctx.escapeHtml(value) : String(value ?? '');
  }

  function showMessage(options) {
    if (typeof ctx?.showReportMessage === 'function') ctx.showReportMessage(options);
  }

  function dateApi() {
    return global.ReportByFunderModal?.dateRangeApi || global.SmmrByFunderModal?.dateRangeApi || {};
  }

  function applyDateRangeToInputs(range) {
    if (!range) return;
    const startEl = qs('reviewReportsStartDate');
    const endEl = qs('reviewReportsEndDate');
    if (startEl) startEl.value = range.start || '';
    if (endEl) endEl.value = range.end || '';
  }

  function resolveDefaultDates() {
    if (typeof ctx?.getDefaultDateRange === 'function') {
      const fromPage = ctx.getDefaultDateRange();
      if (fromPage?.start && fromPage?.end) return fromPage;
    }
    const api = dateApi();
    if (typeof api.defaultOpenDateRange === 'function') {
      return api.defaultOpenDateRange();
    }
    return { start: '', end: '' };
  }

  function setLoading(active) {
    qs('reviewReportsLoading')?.classList.toggle('d-none', !active);
  }

  function setEmpty(active) {
    qs('reviewReportsEmpty')?.classList.toggle('d-none', !active);
  }

  function setResults(active) {
    qs('reviewReportsResults')?.classList.toggle('d-none', !active);
  }

  function statusBadge(progress) {
    const p = progress && typeof progress === 'object' ? progress : {};
    if (p.total > 0 && p.pending === 0 && p.draft === 0 && (p.submitted + p.locked) === p.total) {
      return '<span class="badge bg-success">Ready</span>';
    }
    if (p.locked) return '<span class="badge bg-dark">Locked</span>';
    if (p.submitted) return '<span class="badge bg-success-subtle text-success-emphasis border">Submitted</span>';
    if (p.draft) return '<span class="badge bg-warning text-dark">Draft</span>';
    if (p.pending) return '<span class="badge bg-info-subtle text-info-emphasis border">Not started</span>';
    return '<span class="badge bg-secondary">—</span>';
  }

  function renderResults(payload) {
    const host = qs('reviewReportsResults');
    if (!host) return;
    const teachers = Array.isArray(payload?.teachers) ? payload.teachers : [];
    if (!teachers.length) {
      setResults(false);
      setEmpty(true);
      host.innerHTML = '';
      return;
    }
    setEmpty(false);
    setResults(true);
    const parts = teachers.map((section, sectionIndex) => {
      const teacherName = escape(section.teacherName || section.teacherId || 'Teacher');
      const collapseId = `reviewReportsTeacherCollapse_${sectionIndex}`;
      const rows = Array.isArray(section.rows) ? section.rows : [];
      const rowHtml = rows.map((row) => {
        const period = [row.reportStartDate, row.reportDueDate].filter(Boolean).join(' → ')
          || row.sessionDate
          || '—';
        const fillUrl = String(row.fillReportsUrl || '').trim();
        const editUrl = String(row.assignmentEditUrl || '').trim();
        const reportTitle = escape(row.templateTitle || 'Report');
        const reportTitleCell = editUrl
          ? `<a href="${escape(editUrl)}" class="fw-semibold link-primary text-decoration-none" target="_blank" rel="noopener noreferrer" title="Open assignment row for editing">${reportTitle}</a>`
          : `<span class="fw-semibold">${reportTitle}</span>`;
        const action = fillUrl
          ? `<a href="${escape(fillUrl)}" class="btn btn-outline-primary btn-sm" target="_blank" rel="noopener noreferrer"><i class="bi bi-table me-1"></i>Fill Reports</a>`
          : '<span class="text-muted small">No matrix link</span>';
        return [
          '<tr>',
          `<td class="ps-3"><div>${reportTitleCell}</div><div class="small text-muted">${escape(row.scopeLabel || row.reportScope || '')}</div></td>`,
          `<td class="small">${escape(row.className || row.classId || '—')}</td>`,
          `<td class="small">${escape(period)}</td>`,
          `<td class="small">${statusBadge(row.progress)}<div class="text-muted mt-1">${escape(row.statusSummary || '')}</div></td>`,
          `<td class="pe-3 text-end">${action}</td>`,
          '</tr>'
        ].join('');
      }).join('');
      return [
        '<div class="card border shadow-sm mb-3 review-reports-teacher-card">',
        '<div class="card-header bg-white py-2 px-3 d-flex justify-content-between align-items-center">',
        `<button class="btn btn-link text-decoration-none text-dark fw-bold p-0 collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false">`,
        `<i class="bi bi-person-badge me-2 text-primary"></i>${teacherName}`,
        `<span class="badge bg-light text-dark border ms-2">${rows.length}</span>`,
        '</button>',
        '</div>',
        `<div class="collapse" id="${collapseId}">`,
        '<div class="table-responsive">',
        '<table class="table table-sm table-hover align-middle mb-0">',
        '<thead class="table-light"><tr>',
        '<th class="ps-3">Report</th><th>Class</th><th>Period</th><th>Status</th><th class="pe-3 text-end">Action</th>',
        '</tr></thead>',
        `<tbody>${rowHtml}</tbody>`,
        '</table></div></div></div>'
      ].join('');
    });
    host.innerHTML = parts.join('');
  }

  function renderWarning(message) {
    const el = qs('reviewReportsWarning');
    if (!el) return;
    const text = String(message || '').trim();
    if (!text) {
      el.classList.add('d-none');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.classList.remove('d-none');
  }

  async function loadAssignments() {
    const startDate = String(qs('reviewReportsStartDate')?.value || '').trim();
    const endDate = String(qs('reviewReportsEndDate')?.value || '').trim();
    if (!startDate || !endDate) {
      showMessage({ icon: 'warning', title: 'Date range', message: 'Choose start and end dates.' });
      return;
    }
    const apiUrl = String(ctx?.apiUrl || '/school/reports/semi-monthly/api/review-assignments').trim();
    const params = new URLSearchParams({ startDate, endDate });
    setLoading(true);
    setEmpty(false);
    setResults(false);
    renderWarning('');
    try {
      const res = await fetch(`${apiUrl}?${params.toString()}`, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Unable to load review assignments.');
      }
      renderWarning(payload.configurationWarning || '');
      renderResults(payload);
    } finally {
      setLoading(false);
    }
  }

  function openModal() {
    applyDateRangeToInputs(resolveDefaultDates());
    setEmpty(false);
    setResults(false);
    renderWarning('');
    qs('reviewReportsResults') && (qs('reviewReportsResults').innerHTML = '');
    getModal()?.show();
  }

  function bindEvents() {
    qs('btn_openReviewReportsModal')?.addEventListener('click', openModal);
    qs('btn_reviewReportsLoad')?.addEventListener('click', () => {
      loadAssignments().catch((error) => {
        showMessage({ icon: 'error', message: error.message || 'Load failed.' });
      });
    });
    qs('reviewReportsRangeChips')?.addEventListener('click', (event) => {
      const btn = event.target.closest('.review-reports-range-chip[data-range]');
      if (!btn) return;
      const api = dateApi();
      if (typeof api.resolveRangeChip !== 'function') return;
      applyDateRangeToInputs(api.resolveRangeChip(btn.getAttribute('data-range')));
    });
  }

  function init(context) {
    ctx = context && typeof context === 'object' ? context : {};
    bindEvents();
  }

  global.ReviewReportsModal = { init };
})(window);