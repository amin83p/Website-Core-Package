(function (global) {
  'use strict';

  let ctx = null;
  let modalInstance = null;
  let canUnlockReportInstance = false;

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
    if (typeof ctx?.showReportMessage === 'function') {
      ctx.showReportMessage({
        title: 'Review Reports',
        ...(options && typeof options === 'object' ? options : {})
      });
    }
  }

  function actionStateId() {
    return String(ctx?.actionStateId || '').trim();
  }

  function lifecycleBaseUrl() {
    const base = String(ctx?.apiUrl || '/school/reports/semi-monthly/api/review-assignments').trim();
    return base.replace(/\/review-assignments\/?$/i, '/review-assignments');
  }

  async function postReviewLifecycle(path, body) {
    const stateId = actionStateId();
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'x-ajax-request': 'true'
    };
    if (stateId) headers['x-action-state-id'] = stateId;
    const res = await fetch(`${lifecycleBaseUrl()}${path}`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ ...body, actionStateId: stateId })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.status === 'error') {
      throw new Error(payload.message || 'Request failed.');
    }
    return payload;
  }

  function lifecycleApi() {
    return global.ReportAssignmentDelete && typeof global.ReportAssignmentDelete === 'object'
      ? global.ReportAssignmentDelete
      : null;
  }

  function withReviewOperationWaiting(note, fn) {
    let loadingToken = null;
    if (typeof global.showLoading === 'function') {
      loadingToken = global.showLoading({
        title: 'Review Reports',
        note: String(note || 'Processing…').trim() || 'Processing…',
        operation: 'Review Reports'
      });
    }
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        if (loadingToken && typeof global.hideLoading === 'function') {
          global.hideLoading(loadingToken);
        }
      });
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

  function joinIdList(ids) {
    return (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
      .join(',');
  }

  function iconLink(href, icon, btnClass, title) {
    return [
      `<a href="${escape(href)}" class="btn ${btnClass} btn-sm review-reports-icon-btn"`,
      ' target="_blank" rel="noopener noreferrer"',
      ` title="${escape(title)}" aria-label="${escape(title)}">`,
      `<i class="bi ${icon}" aria-hidden="true"></i></a>`
    ].join('');
  }

  function buildReviewRowMarkup(row) {
    const period = [row.reportStartDate, row.reportDueDate].filter(Boolean).join(' → ')
      || row.sessionDate
      || '—';
    const fillUrl = String(row.fillReportsUrl || '').trim();
    const editUrl = String(row.assignmentEditUrl || '').trim();
    const sessionUrl = String(row.sessionManageUrl || '').trim();
    const reportTitle = escape(row.templateTitle || 'Report');
    const reportTitleCell = `<span class="fw-semibold">${reportTitle}</span>`;
    const actionParts = [];
    if (editUrl) {
      actionParts.push(iconLink(editUrl, 'bi-journal-text', 'btn-outline-secondary', 'Open report assignment'));
    }
    if (sessionUrl) {
      actionParts.push(iconLink(sessionUrl, 'bi-calendar3', 'btn-outline-secondary', 'Open linked class session'));
    }
    if (fillUrl) {
      actionParts.push(iconLink(fillUrl, 'bi-table', 'btn-outline-primary', 'Open Fill Reports matrix'));
    }
    if (row.canLockSubmitted) {
      actionParts.push(iconButton(
        'js-review-lock-submitted',
        {
          'assignment-id': row.assignmentId,
          'assignment-row-id': row.assignmentRowId,
          'teacher-id': row.teacherId,
          'lock-student-ids': joinIdList(row.lockStudentIds),
          'lock-instance-ids': joinIdList(row.lockInstanceIds)
        },
        'bi-lock',
        'btn-outline-dark',
        'Lock submitted reports'
      ));
    }
    if (row.canUnlockLocked && canUnlockReportInstance) {
      actionParts.push(iconButton(
        'js-review-unlock-locked',
        {
          'unlock-instance-ids': joinIdList(row.unlockInstanceIds),
          'report-title': row.templateTitle || 'Report'
        },
        'bi-unlock',
        'btn-outline-warning',
        'Unlock locked reports'
      ));
    }
    const action = actionParts.length
      ? `<div class="d-inline-flex flex-nowrap justify-content-end gap-1 review-reports-row-actions">${actionParts.join('')}</div>`
      : '<span class="text-muted small">—</span>';
    const assignmentId = escape(row.assignmentId || '');
    const assignmentRowId = escape(row.assignmentRowId || '');
    return [
      `<tr data-review-assignment-id="${assignmentId}" data-review-assignment-row-id="${assignmentRowId}">`,
      `<td class="ps-3"><div>${reportTitleCell}</div><div class="small text-muted">${escape(row.scopeLabel || row.reportScope || '')}</div></td>`,
      `<td class="small">${escape(row.className || row.classId || '—')}</td>`,
      `<td class="small">${escape(period)}</td>`,
      `<td class="small">${statusBadge(row.progress)}<div class="text-muted mt-1">${escape(row.statusSummary || '')}</div></td>`,
      `<td class="pe-3 text-end text-nowrap">${action}</td>`,
      '</tr>'
    ].join('');
  }

  function findReviewRowInPayload(payload, assignmentId, assignmentRowId) {
    const teachers = Array.isArray(payload?.teachers) ? payload.teachers : [];
    const aid = String(assignmentId || '').trim();
    const rid = String(assignmentRowId || '').trim();
    for (const section of teachers) {
      const match = (Array.isArray(section.rows) ? section.rows : []).find((row) => (
        String(row.assignmentId || '').trim() === aid
        && String(row.assignmentRowId || '').trim() === rid
      ));
      if (match) return match;
    }
    return null;
  }

  async function fetchReviewAssignmentsPayload() {
    const startDate = String(qs('reviewReportsStartDate')?.value || '').trim();
    const endDate = String(qs('reviewReportsEndDate')?.value || '').trim();
    if (!startDate || !endDate) return null;
    const apiUrl = String(ctx?.apiUrl || '/school/reports/semi-monthly/api/review-assignments').trim();
    const params = new URLSearchParams({ startDate, endDate });
    const res = await fetch(`${apiUrl}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.status !== 'success') {
      throw new Error(payload.message || 'Unable to load review assignments.');
    }
    return payload;
  }

  async function refreshSingleReviewRow(triggerEl) {
    const tr = triggerEl?.closest('tr[data-review-assignment-id]');
    const assignmentId = String(
      triggerEl?.getAttribute('data-assignment-id')
      || tr?.getAttribute('data-review-assignment-id')
      || ''
    ).trim();
    const assignmentRowId = String(
      triggerEl?.getAttribute('data-assignment-row-id')
      || tr?.getAttribute('data-review-assignment-row-id')
      || ''
    ).trim();
    if (!tr || !assignmentId) return false;
    try {
      const payload = await fetchReviewAssignmentsPayload();
      if (!payload) return false;
      canUnlockReportInstance = Boolean(payload.canUnlockReportInstance);
      const row = findReviewRowInPayload(payload, assignmentId, assignmentRowId);
      if (!row) return false;
      const next = document.createElement('tbody');
      next.innerHTML = buildReviewRowMarkup(row);
      const freshTr = next.querySelector('tr');
      if (!freshTr) return false;
      tr.replaceWith(freshTr);
      return true;
    } catch (error) {
      return false;
    }
  }

  function iconButton(jsClass, dataAttrs, icon, btnClass, title) {
    const attrs = Object.entries(dataAttrs || {})
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([key, value]) => ` data-${key}="${escape(value)}"`)
      .join('');
    return [
      `<button type="button" class="btn ${btnClass} btn-sm review-reports-icon-btn ${jsClass}"`,
      attrs,
      ` title="${escape(title)}" aria-label="${escape(title)}">`,
      `<i class="bi ${icon}" aria-hidden="true"></i></button>`
    ].join('');
  }

  function renderResults(payload) {
    const host = qs('reviewReportsResults');
    if (!host) return;
    canUnlockReportInstance = Boolean(payload?.canUnlockReportInstance);
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
      const rowHtml = rows.map((row) => buildReviewRowMarkup(row)).join('');
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

  function splitIds(raw = '') {
    return String(raw || '').split(',').map((id) => id.trim()).filter(Boolean);
  }

  async function confirmLock(count, reportTitle) {
    const message = count === 1
      ? `Lock the submitted report for “${reportTitle}”?`
      : `Lock all ${count} submitted report(s) for “${reportTitle}”?`;
    if (typeof global.showMessageModal === 'function') {
      const result = await global.showMessageModal({
        title: 'Lock Reports',
        icon: 'warning',
        message,
        size: 'md',
        buttons: [
          { text: 'Cancel', class: 'btn-secondary btn-md' },
          { text: 'Lock', class: 'btn-dark btn-md' }
        ]
      });
      return result === 'Lock';
    }
    return global.confirm(message);
  }

  async function lockSubmittedRow(button) {
    const assignmentId = String(button.getAttribute('data-assignment-id') || '').trim();
    const assignmentRowId = String(button.getAttribute('data-assignment-row-id') || '').trim();
    const teacherId = String(button.getAttribute('data-teacher-id') || '').trim();
    const lockStudentIds = splitIds(button.getAttribute('data-lock-student-ids'));
    const lockInstanceIds = splitIds(button.getAttribute('data-lock-instance-ids'));
    const total = lockStudentIds.length + lockInstanceIds.length;
    if (!assignmentId || !total) return;

    const reportTitle = button.closest('tr')?.querySelector('.fw-semibold')?.textContent?.trim() || 'this assignment';
    if (!(await confirmLock(total, reportTitle))) return;

    await withReviewOperationWaiting('Locking submitted reports…', async () => {
      const payload = await postReviewLifecycle('/lock', {
        assignmentId,
        assignmentRowId,
        teacherId,
        lockStudentIds,
        lockInstanceIds
      });
      const summary = payload.summary || {};
      const succeeded = Number(summary.succeeded || 0);
      const failed = Number(summary.failed || 0);
      if (succeeded) {
        await refreshSingleReviewRow(button);
      }
      if (failed) {
        const icon = payload.status === 'partial' ? 'warning' : 'error';
        showMessage({
          icon,
          title: 'Lock incomplete',
          message: String(payload.message || `${succeeded} report(s) locked.`)
        });
      }
    });
  }

  async function unlockLockedRow(button) {
    if (!canUnlockReportInstance) return;
    const instanceIds = splitIds(button.getAttribute('data-unlock-instance-ids'));
    if (!instanceIds.length) return;
    const api = lifecycleApi();
    if (!api?.confirmUnlock) {
      showMessage({ icon: 'error', message: 'Unlock helpers are unavailable. Refresh the page and try again.' });
      return;
    }
    const reportTitle = String(button.getAttribute('data-report-title') || 'this assignment').trim();
    const confirmMessage = instanceIds.length === 1
      ? `Unlock the locked report for “${reportTitle}”? Status will return to submitted.`
      : `Unlock all ${instanceIds.length} locked reports for “${reportTitle}”? Status will return to submitted.`;
    if (!(await api.confirmUnlock(confirmMessage, 'Unlock Reports'))) return;

    await withReviewOperationWaiting('Unlocking locked reports…', async () => {
      const payload = await postReviewLifecycle('/unlock', { unlockInstanceIds: instanceIds });
      const summary = payload.summary || {};
      const succeeded = Number(summary.succeeded || 0);
      const failed = Number(summary.failed || 0);
      const failures = (payload.results || [])
        .filter((row) => row.status === 'error')
        .map((row) => `${row.instanceId}: ${row.message || 'failed'}`);
      if (succeeded) {
        await refreshSingleReviewRow(button);
      }
      if (failed) {
        showMessage({
          icon: payload.status === 'partial' ? 'warning' : 'error',
          title: 'Unlock incomplete',
          message: failures.slice(0, 5).join('\n') + (failures.length > 5 ? `\n+${failures.length - 5} more` : '')
        });
      }
    });
  }

  async function loadAssignments() {
    const startDate = String(qs('reviewReportsStartDate')?.value || '').trim();
    const endDate = String(qs('reviewReportsEndDate')?.value || '').trim();
    if (!startDate || !endDate) {
      showMessage({ icon: 'warning', message: 'Choose start and end dates.' });
      return;
    }
    setLoading(true);
    setEmpty(false);
    setResults(false);
    renderWarning('');
    try {
      const payload = await fetchReviewAssignmentsPayload();
      if (!payload) throw new Error('Unable to load review assignments.');
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
    qs('reviewReportsResults')?.addEventListener('click', (event) => {
      const lockBtn = event.target.closest('.js-review-lock-submitted');
      if (lockBtn) {
        event.preventDefault();
        lockSubmittedRow(lockBtn).catch((error) => {
          showMessage({ icon: 'error', message: error?.message || 'Lock failed.' });
        });
        return;
      }
      const unlockBtn = event.target.closest('.js-review-unlock-locked');
      if (unlockBtn) {
        event.preventDefault();
        unlockLockedRow(unlockBtn).catch((error) => {
          showMessage({ icon: 'error', message: error?.message || 'Unlock failed.' });
        });
      }
    });
  }

  function init(context) {
    ctx = context && typeof context === 'object' ? context : {};
    bindEvents();
  }

  global.ReviewReportsModal = { init };
})(window);