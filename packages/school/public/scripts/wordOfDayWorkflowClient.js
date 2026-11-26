(function initWordOfDayWorkflowClient(global) {
  'use strict';

  const RISKY_ACTIONS = new Set(['reopen', 'archive', 'delete']);

  function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  async function showAlert(title, message, icon) {
    const ui = global.SchoolMessageUi;
    if (ui?.showAlert) {
      await ui.showAlert(title, icon || 'error', message);
      return;
    }
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title,
        message,
        icon: icon || 'error',
        buttons: [{ text: 'OK', class: icon === 'success' ? 'btn-success' : 'btn-primary' }]
      });
      return;
    }
    global.alert(String(message || title));
  }

  async function showConfirm(title, message, options) {
    const ui = global.SchoolMessageUi;
    if (ui?.showConfirm) {
      return ui.showConfirm(message, title, options);
    }
    if (typeof global.showMessageModal === 'function') {
      const confirmText = options?.confirmText || 'Continue';
      const cancelText = options?.cancelText || 'Cancel';
      const result = await global.showMessageModal({
        title,
        message,
        icon: options?.icon || 'warning',
        buttons: [
          { text: cancelText, class: 'btn-secondary' },
          { text: confirmText, class: options?.confirmClass || 'btn-warning' }
        ]
      });
      return result === confirmText;
    }
    return global.confirm(String(message || title));
  }

  async function postWorkflowAction(entryId, action, options = {}) {
    const id = String(entryId || '').trim();
    const act = String(action || '').trim();
    if (!id || !act) {
      return { ok: false, message: 'Missing entry or action.' };
    }

    const note = options.note !== undefined
      ? String(options.note || '')
      : (global.WordOfDayEntryDetailUi?.readWorkflowNote?.() || '');

    const body = {
      note,
      confirmDisplayRisk: options.confirmDisplayRisk === true,
      ...(options.extra || {})
    };

    const res = await fetch(`/school/word-of-day/api/${encodeURIComponent(id)}/${act}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'CSRF-Token': csrfToken()
      },
      body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 409 && data.code === 'WORD_OF_DAY_DISPLAY_WARNING') {
      const proceed = await showConfirm(
        'Display history',
        data.message || 'This word was displayed. Continue anyway?',
        { confirmText: 'Continue', confirmClass: 'btn-warning' }
      );
      if (proceed) {
        return postWorkflowAction(entryId, action, {
          ...options,
          confirmDisplayRisk: true,
          note: body.note
        });
      }
      return { ok: false, code: data.code, message: data.message };
    }

    if (!res.ok) {
      return { ok: false, message: data.message || 'Action failed.', status: res.status, data };
    }

    return {
      ok: true,
      message: data.message || 'OK',
      entry: data.entry || null,
      data
    };
  }

  async function confirmRiskyAction(action, hasDisplayHistory) {
    if (action === 'delete') {
      return showConfirm(
        'Delete entry?',
        'Delete this Word of the Day entry? This cannot be undone.',
        { confirmText: 'Delete', confirmClass: 'btn-danger', icon: 'warning' }
      );
    }
    if (hasDisplayHistory && RISKY_ACTIONS.has(action)) {
      return showConfirm(
        'Display history',
        'This word has been displayed on the dashboard. Continue with this status change?',
        { confirmText: 'Continue', confirmClass: 'btn-warning' }
      );
    }
    return true;
  }

  global.WordOfDayWorkflow = {
    postWorkflowAction,
    confirmRiskyAction,
    showAlert,
    RISKY_ACTIONS
  };
}(typeof window !== 'undefined' ? window : globalThis));