(function initSchoolAutosave(global) {
  'use strict';

  const STORAGE_PREFIX = 'schoolAutosave';
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 60;

  let activeController = null;

  function clampMinutes(value, fallback) {
    const n = Number(value);
    const fb = Number(fallback);
    const base = Number.isFinite(fb) ? fb : 5;
    if (!Number.isFinite(n)) return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(base)));
    return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(n)));
  }

  function storageKey(orgId, sectionKey) {
    return `${STORAGE_PREFIX}:${String(orgId || '').trim()}:${String(sectionKey || '').trim()}`;
  }

  function readLocalOverride(orgId, sectionKey) {
    try {
      const raw = global.localStorage.getItem(storageKey(orgId, sectionKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        enabled: Object.prototype.hasOwnProperty.call(parsed, 'enabled')
          ? parsed.enabled === true
          : null,
        minutes: Object.prototype.hasOwnProperty.call(parsed, 'minutes') && parsed.minutes != null
          ? clampMinutes(parsed.minutes, 5)
          : null
      };
    } catch (_) {
      return null;
    }
  }

  function clearLocalOverride(orgId, sectionKey) {
    try {
      global.localStorage.removeItem(storageKey(orgId, sectionKey));
    } catch (_) {
      // Storage can be unavailable in privacy-restricted browsers.
    }
  }

  function writeLocalOverride(orgId, sectionKey, value, policy) {
    const sectionPolicy = resolveSectionPolicy(policy, sectionKey);
    const minutes = clampMinutes(value?.minutes, sectionPolicy.defaultMinutes);
    const enabled = value?.enabled === true;
    const enabledDiffers = enabled !== (sectionPolicy.enabledByDefault === true);
    const minutesDiffers = minutes !== sectionPolicy.defaultMinutes;

    if (!enabledDiffers && !minutesDiffers) {
      clearLocalOverride(orgId, sectionKey);
      return;
    }

    const payload = {};
    if (enabledDiffers) payload.enabled = enabled;
    if (minutesDiffers) payload.minutes = minutes;

    try {
      global.localStorage.setItem(storageKey(orgId, sectionKey), JSON.stringify(payload));
    } catch (_) {
      // Storage can be unavailable in privacy-restricted browsers.
    }
  }

  function resolveSectionPolicy(policy, sectionKey) {
    const sections = policy?.sections && typeof policy.sections === 'object' ? policy.sections : {};
    const section = sections[sectionKey] || {};
    const defaultMinutes = clampMinutes(policy?.defaultMinutes, 5);
    const sectionMinutes = section.defaultMinutes == null
      ? defaultMinutes
      : clampMinutes(section.defaultMinutes, defaultMinutes);
    return {
      enabledByDefault: section.enabledByDefault === true,
      defaultMinutes: sectionMinutes
    };
  }

  function resolveEffectiveConfig(orgId, sectionKey, policy) {
    const sectionPolicy = resolveSectionPolicy(policy, sectionKey);
    const local = readLocalOverride(orgId, sectionKey);
    const resolved = local
      ? {
        enabled: local.enabled == null
          ? sectionPolicy.enabledByDefault === true
          : local.enabled === true,
        minutes: local.minutes == null
          ? sectionPolicy.defaultMinutes
          : clampMinutes(local.minutes, sectionPolicy.defaultMinutes)
      }
      : {
        enabled: sectionPolicy.enabledByDefault === true,
        minutes: sectionPolicy.defaultMinutes
      };
    return resolved;
  }

  function formatTime(value) {
    if (!value) return '';
    try {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function renderSideControlContent(button) {
    if (!button) return;
    button.innerHTML = `
      <span class="school-autosave-side-control__rings" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      <i class="bi bi-arrow-repeat school-autosave-side-control__icon" aria-hidden="true"></i>
    `;
  }

  function ensureSideControl() {
    const host = document.querySelector('.header-side-controls');
    if (!host) return null;
    let button = document.getElementById('schoolAutosaveSideControl');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'schoolAutosaveSideControl';
      button.className = 'header-settings-toggle header-side-control-btn school-autosave-side-control';
      button.setAttribute('data-no-wait', 'true');
      button.setAttribute('aria-label', 'Manage autosave for this page');
      button.title = 'Autosave';
      renderSideControlContent(button);
    } else {
      button.setAttribute('data-no-wait', 'true');
      if (!button.querySelector('.school-autosave-side-control__icon')) {
        renderSideControlContent(button);
      }
    }
    const diagnosticsButton = document.getElementById('pageDiagnosticsSideControl');
    if (diagnosticsButton && diagnosticsButton.parentElement === host) {
      if (diagnosticsButton.previousElementSibling !== button) diagnosticsButton.before(button);
    } else if (button.parentElement !== host) {
      host.appendChild(button);
    }
    return button;
  }

  function ensureSettingsModal() {
    let modal = document.getElementById('schoolAutosaveSettingsModal');
    if (modal) {
      const dialog = modal.querySelector('.modal-dialog');
      if (dialog) {
        dialog.classList.remove('modal-sm');
        dialog.classList.add('modal-md');
      }
      return modal;
    }

    modal = document.createElement('div');
    modal.id = 'schoolAutosaveSettingsModal';
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-md">
        <div class="modal-content border-0 shadow-lg" style="border-radius: 12px;">
          <div class="modal-header border-bottom-0 pb-0">
            <h5 class="modal-title fw-bold" id="schoolAutosaveSettingsModalTitle">Autosave</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body py-3" id="schoolAutosaveSettingsModalBody"></div>
          <div class="modal-footer border-top-0 pt-0" id="schoolAutosaveSettingsModalFooter">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-primary" id="schoolAutosaveModalApply" data-no-wait="true">Apply</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function updateSideControlUi(controller) {
    const button = controller.button;
    if (!button) return;
    if (!button.querySelector('.school-autosave-side-control__icon')) {
      renderSideControlContent(button);
    }
    const active = controller.config.enabled && !controller.readOnly;
    button.classList.toggle('school-autosave-side-control--active', active);
    button.classList.toggle('school-autosave-side-control--saving', active && controller.status === 'saving');
    button.classList.toggle('school-autosave-side-control--error', controller.status === 'error');
    const statusLabel = controller.readOnly
      ? 'Autosave unavailable (read-only)'
      : (controller.config.enabled ? `Autosave active every ${controller.config.minutes} min` : 'Autosave inactive');
    button.title = statusLabel;
    button.setAttribute('aria-pressed', controller.config.enabled ? 'true' : 'false');
    button.setAttribute('aria-label', statusLabel);
  }

  async function openManagementModal(controller) {
    const sectionTitle = controller.sectionTitle || controller.sectionKey;
    const orgPolicy = resolveSectionPolicy(controller.policy, controller.sectionKey);
    const statusText = controller.readOnly
      ? 'Read-only page — autosave is disabled.'
      : (controller.config.enabled
        ? `Active on this page · every ${controller.config.minutes} minute(s)`
        : 'Inactive on this page');
    const lastSaved = controller.lastSavedAt
      ? `Last autosave: ${formatTime(controller.lastSavedAt)}`
      : (controller.status === 'saving' ? 'Saving…' : 'No autosave yet this visit');
    const errorText = controller.lastError ? `<div class="small text-danger mt-2">${escapeHtml(controller.lastError)}</div>` : '';

    const modal = ensureSettingsModal();
    const bodyEl = document.getElementById('schoolAutosaveSettingsModalBody');
    const applyBtn = document.getElementById('schoolAutosaveModalApply');
    if (!modal || !bodyEl || !applyBtn) return;

    bodyEl.innerHTML = `
      <p class="mb-2"><strong>${escapeHtml(sectionTitle)}</strong></p>
      <p class="mb-3 text-muted small mb-0">${escapeHtml(statusText)}</p>
      <p class="small text-muted mb-3">${escapeHtml(lastSaved)}</p>
      <div class="form-check form-switch mb-3">
        <input class="form-check-input" type="checkbox" role="switch" id="schoolAutosaveModalEnabled" ${controller.config.enabled ? 'checked' : ''} ${controller.readOnly ? 'disabled' : ''}>
        <label class="form-check-label fw-semibold" for="schoolAutosaveModalEnabled">Enable autosave on this page</label>
      </div>
      <div class="mb-2">
        <label class="form-label fw-semibold small" for="schoolAutosaveModalMinutes">Interval (minutes)</label>
        <input class="form-control" type="number" min="${MIN_MINUTES}" max="${MAX_MINUTES}" step="1" id="schoolAutosaveModalMinutes" value="${escapeHtml(String(controller.config.minutes))}" ${controller.readOnly ? 'disabled' : ''}>
      </div>
      <p class="small text-muted mb-2">Organization default: ${orgPolicy.enabledByDefault ? 'On' : 'Off'}, every ${escapeHtml(String(orgPolicy.defaultMinutes))} minute(s).</p>
      <p class="small text-muted mb-0">Device overrides apply only on this browser. Matching organization defaults clears your local override.</p>
      ${errorText}
    `;
    applyBtn.disabled = controller.readOnly;

    const instance = global.bootstrap?.Modal?.getOrCreateInstance(modal);
    instance?.show();

    const handleApply = () => {
      const enabled = document.getElementById('schoolAutosaveModalEnabled')?.checked === true;
      const minutes = clampMinutes(
        document.getElementById('schoolAutosaveModalMinutes')?.value,
        controller.config.minutes
      );
      controller.setConfig({ enabled, minutes }, { persist: true });
      instance?.hide();
    };

    const handleReset = () => {
      clearLocalOverride(controller.orgId, controller.sectionKey);
      const orgConfig = resolveEffectiveConfig(controller.orgId, controller.sectionKey, controller.policy);
      controller.setConfig(orgConfig, { persist: false });
      instance?.hide();
    };

    applyBtn.replaceWith(applyBtn.cloneNode(true));
    const freshApplyBtn = document.getElementById('schoolAutosaveModalApply');
    freshApplyBtn?.addEventListener('click', handleApply, { once: true });

    let resetBtn = document.getElementById('schoolAutosaveModalReset');
    if (!resetBtn) {
      const footer = document.getElementById('schoolAutosaveSettingsModalFooter');
      resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn btn-outline-secondary me-auto';
      resetBtn.id = 'schoolAutosaveModalReset';
      resetBtn.textContent = 'Use organization defaults';
      footer?.insertBefore(resetBtn, footer.firstChild);
    }
    resetBtn.disabled = controller.readOnly;
    resetBtn.replaceWith(resetBtn.cloneNode(true));
    document.getElementById('schoolAutosaveModalReset')?.addEventListener('click', handleReset, { once: true });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function createController(options) {
    const sectionKey = String(options.sectionKey || '').trim();
    const orgId = String(options.orgId || '').trim();
    const policy = options.policy && typeof options.policy === 'object' ? options.policy : {};
    const readOnly = options.readOnly === true;
    const sectionTitle = String(options.sectionTitle || sectionKey).trim();
    const isDirty = typeof options.isDirty === 'function' ? options.isDirty : () => false;
    const save = typeof options.save === 'function' ? options.save : async () => ({ ok: false, skipped: true, reason: 'missing-save' });
    const canAutosave = typeof options.canAutosave === 'function' ? options.canAutosave : () => true;
    const onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : null;

    let config = resolveEffectiveConfig(orgId, sectionKey, policy);
    if (readOnly) config = { ...config, enabled: false };

    let visibilityPoller = null;
    let status = 'idle';
    let lastSavedAt = null;
    let lastError = '';
    const button = ensureSideControl();

    function notifyStatus() {
      controller.config = config;
      controller.status = status;
      controller.lastSavedAt = lastSavedAt;
      controller.lastError = lastError;
      updateSideControlUi(controller);
      if (onStatusChange) onStatusChange({ status, config, lastSavedAt, lastError });
    }

    function clearTimer() {
      if (visibilityPoller) {
        visibilityPoller.stop();
        visibilityPoller = null;
      }
    }

    function scheduleTimer() {
      clearTimer();
      if (!config.enabled || readOnly) {
        return;
      }
      const intervalMs = Math.max(MIN_MINUTES, config.minutes) * 60 * 1000;
      if (typeof global.createVisibilityInterval === 'function') {
        visibilityPoller = global.createVisibilityInterval(() => {
          void controller.tick();
        }, intervalMs);
        visibilityPoller.start();
        return;
      }
      visibilityPoller = {
        stop() {},
        setIntervalMs() {}
      };
      const legacyTimerId = global.setInterval(() => {
        void controller.tick();
      }, intervalMs);
      visibilityPoller.stop = () => global.clearInterval(legacyTimerId);
    }

    async function tick() {
      if (!config.enabled || readOnly) return;
      if (!isDirty()) {
        status = 'idle';
        notifyStatus();
        return;
      }
      if (!canAutosave()) {
        status = 'paused';
        notifyStatus();
        return;
      }
      status = 'saving';
      lastError = '';
      notifyStatus();
      try {
        const result = await save({ trigger: 'autosave' });
        if (result?.ok) {
          status = 'saved';
          lastSavedAt = new Date();
          lastError = '';
        } else if (result?.skipped) {
          status = 'paused';
          lastError = result?.message || '';
        } else {
          status = 'error';
          lastError = result?.message || 'Autosave failed.';
        }
      } catch (error) {
        status = 'error';
        lastError = error?.message || 'Autosave failed.';
      }
      notifyStatus();
    }

    const controller = {
      sectionKey,
      sectionTitle,
      orgId,
      policy,
      readOnly,
      config,
      status,
      lastSavedAt,
      lastError,
      button,
      setConfig(next, { persist = false } = {}) {
        Object.assign(config, {
          enabled: next?.enabled === true,
          minutes: clampMinutes(next?.minutes, config.minutes)
        });
        if (readOnly) config.enabled = false;
        if (persist) {
          writeLocalOverride(orgId, sectionKey, config, policy);
        }
        status = 'idle';
        scheduleTimer();
        notifyStatus();
      },
      async tick() {
        await tick();
      },
      destroy() {
        clearTimer();
        button?.removeEventListener('click', controller._onClick);
        if (button && button.parentElement && activeController === controller) {
          button.remove();
        }
        if (activeController === controller) activeController = null;
      },
      _onClick: null
    };

    controller._onClick = () => {
      void openManagementModal(controller);
    };
    button?.addEventListener('click', controller._onClick);
    scheduleTimer();
    notifyStatus();
    return controller;
  }

  function destroy() {
    if (activeController) activeController.destroy();
  }

  function init(options = {}) {
    destroy();
    activeController = createController(options);
    return activeController;
  }

  global.SchoolAutosave = {
    STORAGE_PREFIX,
    storageKey,
    resolveSectionPolicy,
    resolveEffectiveConfig,
    clearLocalOverride,
    init,
    destroy
  };
})(window);
