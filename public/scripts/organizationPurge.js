(function initOrganizationPurgeWizard() {
  const modalEl = document.getElementById('orgPurgeModal');
  if (!modalEl || typeof bootstrap === 'undefined') return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const state = {
    orgId: '',
    orgName: '',
    step: 1,
    plan: null,
    busy: false
  };

  const els = {
    orgName: document.getElementById('orgPurgeOrgName'),
    orgId: document.getElementById('orgPurgeOrgId'),
    scanState: document.getElementById('orgPurgeScanState'),
    scanError: document.getElementById('orgPurgeScanError'),
    totals: document.getElementById('orgPurgeTotals'),
    categoryList: document.getElementById('orgPurgeCategoryList'),
    confirmExpected: document.getElementById('orgPurgeConfirmExpected'),
    confirmInput: document.getElementById('orgPurgeConfirmInput'),
    confirmCheck: document.getElementById('orgPurgeConfirmCheck'),
    progressList: document.getElementById('orgPurgeProgressList'),
    resultAlert: document.getElementById('orgPurgeResultAlert'),
    backBtn: document.getElementById('orgPurgeBackBtn'),
    nextBtn: document.getElementById('orgPurgeNextBtn'),
    executeBtn: document.getElementById('orgPurgeExecuteBtn'),
    closeBtn: document.getElementById('orgPurgeCloseBtn'),
    stepNav: document.getElementById('orgPurgeSteps')
  };

  function setStep(step) {
    state.step = step;
    document.querySelectorAll('#orgPurgeModal .org-purge-pane').forEach((pane) => {
      const paneStep = Number(pane.getAttribute('data-pane') || 0);
      pane.classList.toggle('d-none', paneStep !== step);
    });
    if (els.stepNav) {
      els.stepNav.querySelectorAll('[data-step]').forEach((link) => {
        const linkStep = Number(link.getAttribute('data-step') || 0);
        link.classList.toggle('active', linkStep === step);
      });
    }
    els.backBtn.classList.toggle('d-none', step <= 1 || step === 4);
    els.nextBtn.classList.toggle('d-none', step === 1 || step === 3 || step === 4);
    els.executeBtn.classList.toggle('d-none', step !== 3);
    if (step === 4) {
      els.closeBtn.textContent = 'Close';
    } else {
      els.closeBtn.textContent = 'Cancel';
    }
    updateConfirmReady();
  }

  function updateConfirmReady() {
    if (state.step !== 3) return;
    const nameOk = String(els.confirmInput.value || '').trim() === String(state.orgName || '');
    const checked = Boolean(els.confirmCheck.checked);
    els.executeBtn.disabled = !(nameOk && checked) || state.busy;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderCategories(plan) {
    const categories = Array.isArray(plan?.categories) ? plan.categories.filter((row) => Number(row.count || 0) > 0) : [];
    els.totals.textContent = `${Number(plan?.totals?.records || 0)} item(s) across ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}.`;
    if (!categories.length) {
      els.categoryList.innerHTML = '<div class="text-muted small">No related org-scoped rows were found. Only the organization record will be removed.</div>';
      return;
    }
    els.categoryList.innerHTML = categories.map((row) => {
      const samples = Array.isArray(row.samples) ? row.samples : [];
      const sampleHtml = samples.length
        ? `<div class="small text-muted mt-1">${samples.map((s) => escapeHtml(s.label || s.id)).join(', ')}${Number(row.count) > samples.length ? '…' : ''}</div>`
        : '';
      const noteHtml = row.note ? `<div class="small text-muted mt-1">${escapeHtml(row.note)}</div>` : '';
      return `
        <div class="border rounded p-2">
          <div class="d-flex justify-content-between gap-2">
            <div class="fw-semibold">${escapeHtml(row.label || row.key)}</div>
            <span class="badge bg-danger-subtle text-danger border border-danger-subtle">${Number(row.count || 0)}</span>
          </div>
          ${sampleHtml}
          ${noteHtml}
        </div>
      `;
    }).join('');
  }

  function renderStages(stages = [], finalMessage = '', finalStatus = 'success') {
    const rows = Array.isArray(stages) ? stages : [];
    els.progressList.innerHTML = rows.map((stage) => {
      const tone = stage.status === 'success'
        ? 'success'
        : (stage.status === 'warning' ? 'warning' : (stage.status === 'skipped' ? 'secondary' : 'danger'));
      return `
        <div class="border rounded p-2">
          <div class="d-flex justify-content-between gap-2">
            <div class="fw-semibold">${escapeHtml(stage.label || stage.key)}</div>
            <span class="badge text-bg-${tone}">${escapeHtml(stage.status || '')}</span>
          </div>
          ${stage.message ? `<div class="small text-muted mt-1">${escapeHtml(stage.message)}</div>` : ''}
        </div>
      `;
    }).join('') || '<div class="text-muted small">No stages reported.</div>';

    els.resultAlert.classList.remove('d-none', 'alert-success', 'alert-warning', 'alert-danger');
    els.resultAlert.classList.add(
      finalStatus === 'success' ? 'alert-success' : (finalStatus === 'partial' ? 'alert-warning' : 'alert-danger')
    );
    els.resultAlert.textContent = finalMessage || 'Done.';
  }

  async function loadPlan() {
    state.busy = true;
    els.scanState.classList.remove('d-none');
    els.scanError.classList.add('d-none');
    els.scanError.textContent = '';
    setStep(1);
    try {
      const res = await fetch(`/organizations/${encodeURIComponent(state.orgId)}/purge-plan`, {
        headers: { Accept: 'application/json', 'X-AJAX-Request': 'true' },
        credentials: 'same-origin'
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || `Failed to scan organization (${res.status})`);
      }
      state.plan = payload.plan || null;
      state.orgName = String(state.plan?.org?.name || state.orgName || '').trim();
      els.orgName.textContent = state.orgName || state.orgId;
      els.confirmExpected.textContent = state.orgName || state.orgId;
      renderCategories(state.plan);
      setStep(2);
      els.nextBtn.classList.remove('d-none');
    } catch (err) {
      els.scanState.classList.add('d-none');
      els.scanError.classList.remove('d-none');
      els.scanError.textContent = String(err?.message || err);
    } finally {
      state.busy = false;
    }
  }

  async function ensureAdminVerification() {
    if (typeof window.requestProtectedAction !== 'function') {
      throw new Error('Admin verification system is not loaded. Please refresh the page and try again.');
    }
    await window.requestProtectedAction();
  }

  function isAdminVerificationCancelled(error) {
    return error && (error.code === 'ADMIN_VERIFICATION_CANCELLED' || /cancel/i.test(String(error?.message || '')));
  }

  async function postPurgeRequest() {
    const res = await fetch(`/organizations/${encodeURIComponent(state.orgId)}/purge`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-AJAX-Request': 'true'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ confirmName: String(els.confirmInput.value || '').trim() })
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 403 && payload?.status === 'admin_required') {
      if (typeof window.resetAdminVerificationCache === 'function') {
        window.resetAdminVerificationCache();
      }
      const error = new Error(payload.message || 'Admin approval required or session expired.');
      error.code = 'ADMIN_VERIFICATION_REQUIRED';
      throw error;
    }
    if (!res.ok && !payload.stages) {
      throw new Error(payload.message || `Purge failed (${res.status})`);
    }
    return payload;
  }

  async function executePurge() {
    if (state.busy) return;
    state.busy = true;
    els.executeBtn.disabled = true;
    try {
      await ensureAdminVerification();
    } catch (err) {
      state.busy = false;
      updateConfirmReady();
      if (isAdminVerificationCancelled(err)) return;
      if (typeof window.showMessageModal === 'function') {
        window.showMessageModal('Admin verification required', String(err?.message || err), 'error');
      } else {
        window.alert(String(err?.message || err));
      }
      return;
    }

    setStep(4);
    els.progressList.innerHTML = `
      <div class="text-center py-4">
        <div class="spinner-border text-danger mb-3" role="status"></div>
        <div class="fw-semibold">Deleting organization data…</div>
      </div>
    `;
    els.resultAlert.classList.add('d-none');
    try {
      let payload;
      try {
        payload = await postPurgeRequest();
      } catch (err) {
        if (err?.code === 'ADMIN_VERIFICATION_REQUIRED') {
          await ensureAdminVerification();
          payload = await postPurgeRequest();
        } else {
          throw err;
        }
      }
      renderStages(payload.stages || [], payload.message || '', payload.status || 'error');
      if (payload.status === 'success' || payload.status === 'partial') {
        setTimeout(() => {
          window.location.reload();
        }, 1600);
      }
    } catch (err) {
      if (isAdminVerificationCancelled(err)) {
        setStep(3);
      } else {
        renderStages([], String(err?.message || err), 'error');
      }
    } finally {
      state.busy = false;
      updateConfirmReady();
    }
  }

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.org-purge-btn');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    state.orgId = String(btn.getAttribute('data-id') || '').trim();
    state.orgName = String(btn.getAttribute('data-name') || '').trim();
    state.plan = null;
    els.orgName.textContent = state.orgName || state.orgId;
    els.orgId.textContent = state.orgId;
    els.confirmInput.value = '';
    els.confirmCheck.checked = false;
    els.confirmExpected.textContent = state.orgName || state.orgId;
    modal.show();
    loadPlan();
  });

  els.nextBtn.addEventListener('click', () => {
    if (state.step === 2) setStep(3);
  });
  els.backBtn.addEventListener('click', () => {
    if (state.step === 3) setStep(2);
    else if (state.step === 2) setStep(1);
  });
  els.executeBtn.addEventListener('click', executePurge);
  els.confirmInput.addEventListener('input', updateConfirmReady);
  els.confirmCheck.addEventListener('change', updateConfirmReady);
})();
