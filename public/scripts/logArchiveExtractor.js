(function () {
  const form = document.getElementById('logArchiveExportForm');
  const msgEl = document.getElementById('logArchiveExportMsg');
  const refreshBtn = document.getElementById('logArchiveRefreshStatusBtn');
  if (!form) return;

  function buildWaitModalHtml(startDate, endDate) {
    const start = String(startDate || '').trim() || '—';
    const end = String(endDate || '').trim() || '—';
    return `<p class="mb-2">Building activity archive ZIP for <strong>${start}</strong> through <strong>${end}</strong>.</p>
      <p class="small text-muted mb-2">Large date ranges can take several minutes. Please keep this tab open.</p>
      <div class="progress" style="height: 1rem;">
        <div class="progress-bar progress-bar-striped progress-bar-animated w-100" role="progressbar" aria-valuenow="100" aria-valuemin="0" aria-valuemax="100">Working…</div>
      </div>`;
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

  function openOperationWaitModal(startDate, endDate) {
    if (typeof window.showMessageModal !== 'function') return;
    lockMessageModalWhileBusy();
    void window.showMessageModal({
      title: 'Performing operation',
      icon: 'info',
      message: buildWaitModalHtml(startDate, endDate),
      buttons: [{ text: 'Please wait…', class: 'btn-outline-secondary' }]
    });
    lockMessageModalWhileBusy();
  }

  function closeOperationWaitModal() {
    const modalEl = document.getElementById('messageModal');
    unlockMessageModalChrome();
    if (!modalEl || !window.bootstrap?.Modal) return;
    const inst = window.bootstrap.Modal.getInstance(modalEl);
    if (inst && modalEl.classList.contains('show')) {
      modalEl.dataset.resolveValue = 'done';
      inst.hide();
    }
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

  async function parseErrorResponse(res) {
    const contentType = String(res.headers.get('Content-Type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = await res.json();
      const err = new Error(payload.message || `Export failed (HTTP ${res.status}).`);
      err.payload = payload;
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    throw new Error(text || `Export failed (HTTP ${res.status}).`);
  }

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
      await parseErrorResponse(res);
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

  async function refreshStatus() {
    if (!refreshBtn) return;
    refreshBtn.disabled = true;
    try {
      const res = await fetch('/logs/archive/status', {
        headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Status refresh failed');
      if (msgEl) msgEl.textContent = 'Status refreshed at ' + new Date().toLocaleTimeString();
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
      openOperationWaitModal(body.startDate, body.endDate);
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
})();
