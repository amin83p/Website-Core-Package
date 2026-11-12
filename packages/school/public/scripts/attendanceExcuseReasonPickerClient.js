(function () {
  'use strict';

  function defaultEscapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sortReasons(reasons) {
    return [...(Array.isArray(reasons) ? reasons : [])]
      .map((row) => String(row || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  /**
   * @param {object} config
   * @param {string} config.textareaId
   * @param {string} config.pickButtonId
   * @param {string} [config.modalId]
   * @param {string[]} [config.initialReasons]
   * @param {boolean} [config.canManageCatalog]
   * @param {() => string} [config.getActionStateId]
   * @param {(opts: object) => Promise<unknown>} [config.messageBox]
   * @param {(value: string) => string} [config.escapeHtml]
   */
  function installAttendanceExcuseReasonPicker(config) {
    const cfg = config && typeof config === 'object' ? config : {};
    const textareaId = String(cfg.textareaId || 'modalExcuseRef').trim();
    const pickButtonId = String(cfg.pickButtonId || 'btnPickExcuseReason').trim();
    const modalId = String(cfg.modalId || 'attendanceExcuseReasonPickerModal').trim();
    let reasonsState = sortReasons(cfg.initialReasons || []);
    const canManage = cfg.canManageCatalog === true;
    const getActionStateId = typeof cfg.getActionStateId === 'function' ? cfg.getActionStateId : () => '';
    const escapeHtml = typeof cfg.escapeHtml === 'function' ? cfg.escapeHtml : defaultEscapeHtml;
    const messageBox = typeof cfg.messageBox === 'function'
      ? cfg.messageBox
      : async (opts) => {
        if (typeof window.showMessageModal === 'function') {
          return window.showMessageModal(opts);
        }
        const plain = String(opts?.message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        window.alert(plain || String(opts?.title || 'Notice'));
        return opts?.buttons?.[0]?.text || 'OK';
      };

    const modalEl = document.getElementById(modalId);
    let modalInstance = null;
    let manageDraft = null;
    let manageActive = false;
    let activeTextareaId = textareaId;

    function getTextarea() {
      const id = String(activeTextareaId || textareaId || '').trim();
      return id ? document.getElementById(id) : null;
    }

    function getPickButton() {
      return document.getElementById(pickButtonId);
    }

    function setPickButtonDisabled(disabled) {
      const btn = getPickButton();
      if (btn) btn.disabled = Boolean(disabled);
    }

    function bindPickButton(buttonId, targetTextareaId) {
      const btn = document.getElementById(String(buttonId || '').trim());
      const targetId = String(targetTextareaId || '').trim();
      if (!btn || !targetId) return;
      btn.addEventListener('click', () => {
        activeTextareaId = targetId;
        openPickerModal();
      });
    }

    function closePickerModal() {
      if (modalInstance) modalInstance.hide();
    }

    function applyReasonToTextarea(reasonText, mode) {
      const textarea = getTextarea();
      if (!textarea || textarea.disabled) return;
      const picked = String(reasonText || '').trim();
      if (!picked) return;
      const existing = String(textarea.value || '');
      if (mode === 'prepend' && existing.trim()) {
        textarea.value = `${picked}\n${existing}`;
      } else {
        textarea.value = picked;
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function finishSelection(reasonText, mode) {
      applyReasonToTextarea(reasonText, mode);
      closePickerModal();
    }

    async function handleTilePick(reasonText) {
      if (manageActive) return;
      const picked = String(reasonText || '').trim();
      if (!picked) return;
      const textarea = getTextarea();
      const existing = String(textarea?.value || '').trim();
      if (!existing) {
        finishSelection(picked, 'replace');
        return;
      }
      const escapedReason = escapeHtml(picked);
      const choice = await messageBox({
        title: 'Apply excuse reason',
        icon: 'question',
        html: true,
        message: `<p class="mb-2">This note already has text.</p><p class="mb-0 small text-muted">Selected reason: <strong>${escapedReason}</strong></p><p class="mb-0 mt-2">Replace the whole note, or add the reason as the first line (existing text moves down).</p>`,
        buttons: [
          { text: 'Cancel', class: 'btn-secondary' },
          { text: 'Add as first line', class: 'btn-outline-primary' },
          { text: 'Replace note', class: 'btn-primary' }
        ]
      });
      if (choice === 'Replace note') finishSelection(picked, 'replace');
      else if (choice === 'Add as first line') finishSelection(picked, 'prepend');
    }

    function listForRender() {
      if (manageActive && Array.isArray(manageDraft)) return manageDraft;
      return reasonsState;
    }

    function renderTiles() {
      const grid = document.getElementById('excuseReasonTileGrid');
      const empty = document.getElementById('excuseReasonTileEmpty');
      if (!grid) return;
      const reasons = sortReasons(listForRender());
      if (!reasons.length) {
        grid.innerHTML = '';
        grid.classList.add('d-none');
        if (empty) empty.classList.remove('d-none');
        return;
      }
      if (empty) empty.classList.add('d-none');
      grid.classList.remove('d-none');
      grid.innerHTML = reasons.map((text, index) => {
        const safe = escapeHtml(text);
        if (manageActive) {
          return `<div class="col" role="listitem"><div class="attendance-excuse-reason-tile attendance-excuse-reason-tile-manage w-100"><span class="pe-2">${safe}</span><button type="button" class="btn btn-sm btn-outline-danger attendance-excuse-reason-tile-remove" data-excuse-reason-remove-idx="${index}" aria-label="Remove ${safe}"><i class="bi bi-x-lg"></i></button></div></div>`;
        }
        return `<div class="col" role="listitem"><button type="button" class="attendance-excuse-reason-tile w-100" data-excuse-reason-idx="${index}">${safe}</button></div>`;
      }).join('');
    }

    function setManageMode(active) {
      manageActive = Boolean(active);
      const panel = document.getElementById('excuseReasonManagePanel');
      const toggle = document.getElementById('btnToggleExcuseReasonManage');
      if (manageActive) {
        manageDraft = sortReasons(reasonsState);
      } else {
        manageDraft = null;
      }
      if (panel) panel.classList.toggle('d-none', !manageActive);
      if (toggle) {
        toggle.setAttribute('aria-pressed', manageActive ? 'true' : 'false');
        toggle.textContent = manageActive ? 'Done managing' : 'Manage reasons';
      }
      renderTiles();
    }

    function openPickerModal() {
      const textarea = getTextarea();
      if (!textarea || textarea.disabled) return;
      setManageMode(false);
      renderTiles();
      if (modalEl && window.bootstrap?.Modal) {
        modalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl, {
          backdrop: 'static',
          focus: true
        });
        modalInstance.show();
      }
    }

    getPickButton()?.addEventListener('click', () => {
      activeTextareaId = textareaId;
      openPickerModal();
    });

    document.getElementById('excuseReasonTileGrid')?.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-excuse-reason-remove-idx]');
      if (removeBtn && manageActive) {
        event.preventDefault();
        event.stopPropagation();
        const idx = Number(removeBtn.getAttribute('data-excuse-reason-remove-idx'));
        if (!Array.isArray(manageDraft) || !Number.isFinite(idx)) return;
        manageDraft = manageDraft.filter((_, i) => i !== idx);
        renderTiles();
        return;
      }
      const tile = event.target.closest('[data-excuse-reason-idx]');
      if (!tile) return;
      const idx = Number(tile.getAttribute('data-excuse-reason-idx'));
      const list = listForRender();
      const reason = Number.isFinite(idx) ? list[idx] : '';
      void handleTilePick(reason);
    });

    if (canManage) {
      document.getElementById('btnToggleExcuseReasonManage')?.addEventListener('click', () => {
        setManageMode(!manageActive);
      });
      document.getElementById('btnCancelExcuseReasonManage')?.addEventListener('click', () => {
        setManageMode(false);
      });
      document.getElementById('btnAddExcuseReason')?.addEventListener('click', () => {
        const input = document.getElementById('inpNewExcuseReason');
        if (!input || !Array.isArray(manageDraft)) return;
        const next = String(input.value || '').trim().slice(0, 200);
        if (!next) return;
        const key = next.toLowerCase();
        if (!manageDraft.some((row) => String(row).toLowerCase() === key)) {
          manageDraft.push(next);
          manageDraft = sortReasons(manageDraft);
        }
        input.value = '';
        renderTiles();
      });
      document.getElementById('inpNewExcuseReason')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          document.getElementById('btnAddExcuseReason')?.click();
        }
      });
      document.getElementById('btnSaveExcuseReasons')?.addEventListener('click', async () => {
        if (!Array.isArray(manageDraft) || !manageDraft.length) {
          void messageBox({ title: 'Save reasons', icon: 'warning', message: 'At least one reason is required.' });
          return;
        }
        const saveBtn = document.getElementById('btnSaveExcuseReasons');
        if (saveBtn) saveBtn.disabled = true;
        try {
          const res = await fetch('/school/attendances/api/excuse-reasons', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'X-AJAX-Request': 'true'
            },
            body: JSON.stringify({
              reasons: manageDraft,
              actionStateId: getActionStateId()
            })
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.status !== 'success') {
            throw new Error(result.message || 'Unable to save excuse reasons.');
          }
          reasonsState = sortReasons(result.reasons || manageDraft);
          manageDraft = [...reasonsState];
          renderTiles();
          void messageBox({
            title: 'Save reasons',
            icon: 'success',
            message: 'Frequent excuse reasons were updated for your organization.'
          });
        } catch (err) {
          void messageBox({
            title: 'Save reasons',
            icon: 'error',
            message: err.message || 'Unable to save excuse reasons.'
          });
        } finally {
          if (saveBtn) saveBtn.disabled = false;
        }
      });
    }

    return {
      setPickButtonDisabled,
      bindPickButton,
      setReasons(next) {
        reasonsState = sortReasons(next);
        renderTiles();
      },
      openPickerModal
    };
  }

  window.installAttendanceExcuseReasonPicker = installAttendanceExcuseReasonPicker;
})();
