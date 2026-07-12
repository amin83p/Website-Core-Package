(function initReportAssignmentDelete(global) {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripHtml(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function withLoading(note, fn) {
    let token = null;
    if (typeof global.showLoading === 'function') {
      token = global.showLoading({ note: note || 'Processing...' });
    }
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        if (typeof global.hideLoading === 'function') {
          if (token) global.hideLoading(token);
          else global.hideLoading({ force: true });
        }
      });
  }

  async function fetchJson(url, options = {}) {
    const headers = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'x-ajax-request': 'true',
      ...(options.headers || {})
    };
    const method = String(options.method || 'GET').toUpperCase();
    if (options.actionStateId) {
      headers['x-action-state-id'] = String(options.actionStateId).trim();
    }
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'error') {
      const err = new Error(stripHtml(payload.message) || 'Request failed.');
      err.preview = payload.preview || payload.details || null;
      err.code = payload.code || '';
      throw err;
    }
    return payload;
  }

  async function deleteReportInstance(instanceId) {
    const id = String(instanceId || '').trim();
    if (!id) throw new Error('Report instance is required.');
    return fetchJson(`/school/reports/instances/delete/${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  }

  async function fetchAssignmentDeletePreview(assignmentId) {
    const id = String(assignmentId || '').trim();
    if (!id) throw new Error('Assignment is required.');
    return fetchJson(`/school/reports/assignments/${encodeURIComponent(id)}/delete-preview`, {
      method: 'GET'
    });
  }

  async function deleteReportAssignment(assignmentId) {
    const id = String(assignmentId || '').trim();
    if (!id) throw new Error('Assignment is required.');
    return fetchJson(`/school/reports/assignments/delete/${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  }

  async function unlockReportInstance(instanceId, options = {}) {
    const id = String(instanceId || '').trim();
    if (!id) throw new Error('Report instance is required.');
    let actionStateId = String(options.actionStateId || '').trim();
    if (!actionStateId && typeof document !== 'undefined') {
      const input = document.getElementById('hid_actionStateId')
        || document.getElementById('reportInstanceActionStateId');
      actionStateId = String(input?.value || '').trim();
    }
    return fetchJson(`/school/reports/instances/unlock/${encodeURIComponent(id)}`, {
      method: 'POST',
      actionStateId: actionStateId || undefined
    });
  }

  function renderBlockersList(blockers) {
    const rows = Array.isArray(blockers) ? blockers : [];
    if (!rows.length) return '';
    return '<div class="mb-3">' + rows.map((blocker) => {
      const samples = Array.isArray(blocker.samples) ? blocker.samples : [];
      const sampleHtml = samples.map((sample) => {
        const label = escapeHtml(sample.label || sample.id || 'Record');
        if (sample.href) {
          return `<li class="list-group-item py-2"><a href="${escapeHtml(sample.href)}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
        }
        return `<li class="list-group-item py-2">${label}</li>`;
      }).join('');
      const hint = blocker.resolveHint
        ? `<div class="small text-muted mt-1">${escapeHtml(blocker.resolveHint)}</div>`
        : '';
      return `<div class="border rounded p-3 mb-2 bg-light-subtle">
        <div class="fw-semibold">${escapeHtml(blocker.label || blocker.code || 'Reference')}</div>
        <div class="small text-muted">${Number(blocker.count || 0)} reference(s)</div>
        ${hint}
        ${sampleHtml ? `<ul class="list-group list-group-flush mt-2 mb-0">${sampleHtml}</ul>` : ''}
      </div>`;
    }).join('') + '</div>';
  }

  function renderInstancesTable(instances, options = {}) {
    const rows = Array.isArray(instances) ? instances : [];
    const onDeleteAttr = options.bindDelete ? ' data-report-instance-delete' : '';
    if (!rows.length) {
      return '<div class="text-muted small py-3">No started report instances found for this assignment.</div>';
    }
    const body = rows.map((row) => {
      const status = escapeHtml(row.status || '-');
      const unlockBtn = row.canUnlock
        ? `<button type="button" class="btn btn-outline-warning btn-sm" data-report-instance-unlock data-instance-id="${escapeHtml(row.id)}"><i class="bi bi-unlock me-1"></i>Unlock</button>`
        : '';
      const deleteBtn = row.canDelete
        ? `<button type="button" class="btn btn-outline-danger btn-sm"${onDeleteAttr} data-instance-id="${escapeHtml(row.id)}"><i class="bi bi-trash me-1"></i>Delete</button>`
        : `<button type="button" class="btn btn-outline-secondary btn-sm" disabled title="Locked reports cannot be deleted."><i class="bi bi-lock me-1"></i>Locked</button>`;
      const openBtn = row.editUrl
        ? `<a href="${escapeHtml(row.editUrl)}" class="btn btn-outline-primary btn-sm" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right me-1"></i>Open</a>`
        : '';
      return `<tr data-instance-row-id="${escapeHtml(row.id)}">
        <td>${escapeHtml(row.sessionDate || '-')}</td>
        <td>${escapeHtml(row.teacherName || '-')}</td>
        <td>${escapeHtml(row.studentName || '-')}</td>
        <td><span class="badge bg-secondary-subtle text-secondary-emphasis border">${status}</span></td>
        <td class="text-end"><div class="d-flex flex-wrap gap-1 justify-content-end">${openBtn}${unlockBtn}${deleteBtn}</div></td>
      </tr>`;
    }).join('');
    return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead class="table-light"><tr>
        <th>Session Date</th><th>Teacher</th><th>Student</th><th>Status</th><th class="text-end">Actions</th>
      </tr></thead>
      <tbody id="reportAssignmentDeleteInstancesBody">${body}</tbody>
    </table></div>`;
  }

  async function confirmDelete(message, title = 'Confirm Delete') {
    if (typeof global.showMessageModal === 'function') {
      const result = await global.showMessageModal({
        title,
        icon: 'warning',
        message: String(message || ''),
        size: 'md',
        buttons: [
          { text: 'Cancel', class: 'btn-secondary btn-md' },
          { text: 'Delete', class: 'btn-warning btn-md' }
        ]
      });
      return result === 'Delete';
    }
    return global.confirm(String(message || ''));
  }

  async function confirmUnlock(message, title = 'Unlock Report') {
    if (typeof global.showMessageModal === 'function') {
      const result = await global.showMessageModal({
        title,
        icon: 'warning',
        message: String(message || ''),
        size: 'md',
        buttons: [
          { text: 'Cancel', class: 'btn-secondary btn-md' },
          { text: 'Unlock', class: 'btn-warning btn-md' }
        ]
      });
      return result === 'Unlock';
    }
    return global.confirm(String(message || ''));
  }

  async function showError(message, title = 'Error') {
    const plain = stripHtml(message) || 'Something went wrong.';
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title,
        icon: 'error',
        message: plain,
        buttons: [{ text: 'OK', class: 'btn-danger btn-sm' }]
      });
      return;
    }
    global.alert(plain);
  }

  global.ReportAssignmentDelete = {
    escapeHtml,
    withLoading,
    fetchJson,
    deleteReportInstance,
    unlockReportInstance,
    fetchAssignmentDeletePreview,
    deleteReportAssignment,
    renderBlockersList,
    renderInstancesTable,
    confirmDelete,
    confirmUnlock,
    showError
  };
}(window));
