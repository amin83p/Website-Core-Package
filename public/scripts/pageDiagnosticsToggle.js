(function initPageDiagnosticsToggle(global) {
  'use strict';

  const config = global.__PAGE_DIAGNOSTICS__;
  if (!config || config.enabled === true) return;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getPreferenceEndpoint() {
    return String(config.preferenceEndpoint || '').trim();
  }

  async function savePreference(enabled) {
    const endpoint = getPreferenceEndpoint();
    if (!endpoint) throw new Error('Preference endpoint is unavailable.');
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-ajax-request': 'true'
    };
    if (config.csrfToken) headers['x-csrf-token'] = String(config.csrfToken);

    const response = await global.fetch(endpoint, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ enabled })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== 'success') {
      throw new Error(payload.message || 'Unable to update page diagnostics.');
    }
    return Boolean(payload.enabled);
  }

  function setError(message) {
    const target = document.getElementById('pageDiagnosticsToggleError');
    if (!target) return;
    const text = String(message || '').trim();
    target.textContent = text;
    target.classList.toggle('d-none', !text);
  }

  async function enableDiagnostics(input) {
    setError('');
    if (input) input.disabled = true;
    try {
      await savePreference(true);
      global.location.reload();
    } catch (error) {
      if (input) {
        input.checked = false;
        input.disabled = false;
      }
      setError(error?.message || 'Unable to update page diagnostics.');
    }
  }

  function ensureModal() {
    let modal = document.getElementById('pageDiagnosticsToggleModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'pageDiagnosticsToggleModal';
    modal.className = 'modal fade page-diagnostics-toggle-modal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg rounded-3">
          <div class="modal-header bg-light border-bottom">
            <h5 class="modal-title fw-bold text-dark mb-0">
              <i class="bi bi-speedometer2 me-2"></i>Page Diagnostics
            </h5>
            <div class="page-diagnostics-modal-header-actions ms-auto">
              <div class="form-check form-switch mb-0 page-diagnostics-header-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="pageDiagnosticsToggleSwitch" data-no-wait="true" aria-label="Page diagnostics on or off">
                <label class="form-check-label small fw-semibold" for="pageDiagnosticsToggleSwitch">On</label>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
          </div>
          <div class="modal-body">
            <div class="small text-muted">Diagnostics are off for this account, so full page diagnostics scripts are not loaded.</div>
            <div class="alert alert-danger d-none mt-3 mb-0" id="pageDiagnosticsToggleError"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('pageDiagnosticsToggleSwitch')?.addEventListener('change', (event) => {
      if (event.target.checked) enableDiagnostics(event.target);
    });

    return modal;
  }

  function renderButtonContent(button) {
    button.innerHTML = '<i class="bi bi-speedometer2" aria-hidden="true"></i>';
  }

  function ensureButton() {
    const host = document.querySelector('.header-side-controls');
    if (!host) return null;
    let button = document.getElementById('pageDiagnosticsSideControl');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'pageDiagnosticsSideControl';
      button.className = 'header-settings-toggle header-side-control-btn page-diagnostics-side-control page-diagnostics-side-control--off';
      button.setAttribute('data-no-wait', 'true');
      button.setAttribute('aria-label', 'Page diagnostics are off');
      button.title = 'Page diagnostics are off';
      renderButtonContent(button);
      button.addEventListener('click', () => {
        const modal = ensureModal();
        global.bootstrap?.Modal?.getOrCreateInstance(modal)?.show();
      });
    }

    const autosaveButton = document.getElementById('schoolAutosaveSideControl');
    if (autosaveButton && autosaveButton.parentElement === host) {
      if (autosaveButton.nextElementSibling !== button) autosaveButton.after(button);
    } else if (button.parentElement !== host) {
      host.appendChild(button);
    }

    return button;
  }

  function installButtonObserver() {
    const host = document.querySelector('.header-side-controls');
    if (!host || typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(() => {
      ensureButton();
    });
    observer.observe(host, { childList: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureButton();
    installButtonObserver();
    setTimeout(ensureButton, 0);
    setTimeout(ensureButton, 250);
  });
})(window);
