(function initSchoolDeletionGuard(global) {
  const API_BASE = '/school/api';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderBlockers(blockers) {
    if (!Array.isArray(blockers) || !blockers.length) {
      return '<p class="text-success mb-0">No blocking references found.</p>';
    }
    const items = blockers.map((blocker, index) => {
      const samples = Array.isArray(blocker.samples) ? blocker.samples : [];
      const count = Number(blocker.count || 0);
      const sampleHtml = samples.map((sample) => {
        const label = escapeHtml(sample.label || sample.id || 'Record');
        if (sample.href) {
          return `<li class="list-group-item py-2"><a href="${escapeHtml(sample.href)}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
        }
        return `<li class="list-group-item py-2">${label}</li>`;
      }).join('');
      const extra = count > samples.length
        ? `<li class="list-group-item py-2 text-muted">…and ${count - samples.length} more</li>`
        : '';
      const hint = blocker.resolveHint
        ? `<div class="small text-muted mt-2"><i class="bi bi-lightbulb me-1"></i>${escapeHtml(blocker.resolveHint)}</div>`
        : '';
      return `<div class="border rounded p-3 mb-2 bg-light-subtle">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
          <span class="badge text-bg-warning">${index + 1}</span>
          <strong>${escapeHtml(blocker.label || blocker.message || blocker.code || 'Reference')}</strong>
          <span class="badge rounded-pill text-bg-secondary">${count} reference${count === 1 ? '' : 's'}</span>
        </div>
        ${hint}
        ${samples.length || extra ? `<ul class="list-group list-group-flush mt-2 mb-0">${sampleHtml}${extra}</ul>` : ''}
      </div>`;
    }).join('');
    return `<div class="small fw-semibold text-uppercase text-muted mb-2">Resolve these references first</div>${items}`;
  }

  function renderPreview(preview) {
    const label = escapeHtml(preview?.label || preview?.id || 'This record');
    if (preview?.canDelete) {
      return `<p class="mb-2">You are about to delete <strong>${label}</strong>.</p>
        <p class="text-success mb-0">No blocking references were found. You can proceed.</p>`;
    }
    return `<p class="mb-3">Cannot delete <strong>${label}</strong> yet.</p>${renderBlockers(preview?.blockers || [])}`;
  }

  async function fetchPreview({ entityKey, id, context = {} }) {
    const params = new URLSearchParams();
    if (context.classId) params.set('classId', context.classId);
    const qs = params.toString();
    const url = `${API_BASE}/deletion-preview/${encodeURIComponent(entityKey)}/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || 'Could not load deletion preview.');
    }
    return payload.preview || null;
  }

  async function executeDelete({ entityKey, id, context = {} }) {
    const response = await fetch(`${API_BASE}/delete/${encodeURIComponent(entityKey)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify(context)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload?.message || 'Delete failed.');
      err.preview = payload?.preview || null;
      err.code = payload?.code || '';
      throw err;
    }
    return payload;
  }

  function ensureModal() {
    let modalEl = document.getElementById('schoolDeletionPreviewModal');
    if (modalEl) return modalEl;
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="modal fade" id="schoolDeletionPreviewModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Confirm deletion</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body" id="schoolDeletionPreviewModalBody"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-danger d-none" id="schoolDeletionPreviewConfirmBtn">Delete</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(container.firstElementChild);
    modalEl = document.getElementById('schoolDeletionPreviewModal');
    return modalEl;
  }

  async function confirmDelete({
    entityKey,
    id,
    context = {},
    title = 'Confirm deletion',
    onSuccess,
    onBlocked,
    onError
  }) {
    const modalEl = ensureModal();
    const bodyEl = document.getElementById('schoolDeletionPreviewModalBody');
    const confirmBtn = document.getElementById('schoolDeletionPreviewConfirmBtn');
    const titleEl = modalEl.querySelector('.modal-title');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="py-4 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Checking references...</div>';
    }
    if (confirmBtn) {
      confirmBtn.classList.add('d-none');
      confirmBtn.onclick = null;
    }

    const modal = global.bootstrap?.Modal ? new global.bootstrap.Modal(modalEl) : null;
    if (modal) modal.show();

    try {
      const preview = await fetchPreview({ entityKey, id, context });
      if (bodyEl) bodyEl.innerHTML = renderPreview(preview);
      if (!preview?.canDelete) {
        if (typeof onBlocked === 'function') onBlocked(preview);
        return { preview, deleted: false };
      }
      if (confirmBtn) {
        confirmBtn.classList.remove('d-none');
        confirmBtn.onclick = async () => {
          confirmBtn.disabled = true;
          try {
            const result = await executeDelete({ entityKey, id, context });
            if (modal) modal.hide();
            if (typeof onSuccess === 'function') onSuccess(result, preview);
          } catch (error) {
            if (bodyEl) {
              bodyEl.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message || 'Delete failed.')}</div>${error.preview ? renderPreview(error.preview) : ''}`;
            }
            if (typeof onError === 'function') onError(error);
          } finally {
            confirmBtn.disabled = false;
          }
        };
      }
      return { preview, deleted: false };
    } catch (error) {
      if (bodyEl) {
        bodyEl.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message || 'Could not load deletion preview.')}</div>`;
      }
      if (typeof onError === 'function') onError(error);
      return { preview: null, deleted: false, error };
    }
  }

  function bindDeleteLinks(selector = '[data-school-delete]') {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.schoolDeleteBound === 'true') return;
      el.dataset.schoolDeleteBound = 'true';
      el.addEventListener('click', async (event) => {
        const target = event.currentTarget;
        if (target.tagName === 'A') event.preventDefault();
        const entityKey = target.dataset.entityKey || target.dataset.schoolDelete || '';
        const id = target.dataset.entityId || target.dataset.id || '';
        const classId = target.dataset.classId || '';
        const redirectTo = target.dataset.redirectTo || target.getAttribute('href') || '';
        if (!entityKey || !id) return;
        await confirmDelete({
          entityKey,
          id,
          context: classId ? { classId } : {},
          title: target.dataset.deleteTitle || 'Confirm deletion',
          onSuccess: () => {
            if (redirectTo && redirectTo !== '#') {
              global.location.href = redirectTo;
            } else {
              global.location.reload();
            }
          }
        });
      });
    });
  }

  global.SchoolDeletionGuard = {
    fetchPreview,
    executeDelete,
    confirmDelete,
    bindDeleteLinks,
    renderPreview
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bindDeleteLinks());
  } else {
    bindDeleteLinks();
  }
}(window));
