(function initWordOfDayDisplayScheduleModal(global) {
  'use strict';

  const state = { shortcutsBound: false };
  let scheduleModal;

  function qs(id) {
    return document.getElementById(id);
  }

  function wf() {
    return global.WordOfDayWorkflow;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function csrfHeaders() {
    const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
      || document.querySelector('input[name="_csrf"]')?.value
      || '';
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers['CSRF-Token'] = token;
    return headers;
  }

  function defaultRange() {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const to = new Date(from);
    to.setDate(to.getDate() + 27);
    const fmt = (d) => d.toISOString().slice(0, 10);
    return { from: fmt(from), to: fmt(to) };
  }

  function bindDateShortcuts() {
    if (state.shortcutsBound) return;
    const shortcuts = global.SchoolDateRangeShortcuts;
    if (!shortcuts?.bindDateRangeShortcuts) return;
    shortcuts.bindDateRangeShortcuts({
      menuId: 'wodDisplayScheduleDateRangeMenu',
      buttonId: 'wodScheduleDateShortcutsBtn',
      fromInputId: 'wodScheduleDateFrom',
      toInputId: 'wodScheduleDateTo'
    });
    state.shortcutsBound = true;
  }

  async function showAlert(title, message, icon) {
    if (wf()?.showAlert) {
      await wf().showAlert(title, message, icon);
      return;
    }
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title,
        message,
        icon: icon || 'error',
        buttons: [{ text: 'OK', class: 'btn-primary' }]
      });
    }
  }

  async function showConfirm(title, message, options) {
    if (wf()?.showConfirm) {
      return wf().showConfirm(title, message, options);
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
    return false;
  }

  function setStatus(message, isError) {
    const el = qs('wodScheduleStatus');
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.toggle('text-danger', Boolean(isError));
    el.classList.toggle('text-muted', !isError);
    el.classList.toggle('d-none', !message);
  }

  function assignmentLabel(day) {
    if (day.invalid) return 'Invalid assignment';
    if (day.mode === 'excluded') return 'Excluded';
    if (day.mode === 'scheduled') return 'Scheduled';
    return 'Automatic';
  }

  function renderRows(days) {
    const body = qs('wodScheduleTableBody');
    if (!body) return;
    if (!Array.isArray(days) || !days.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No dates in range.</td></tr>';
      return;
    }
    body.innerHTML = days.map((day) => {
      const invalidClass = day.invalid ? 'wod-schedule-invalid' : '';
      const word = day.mode === 'excluded' ? '—' : (day.word ? escapeHtml(day.word) : '—');
      const author = day.mode === 'excluded' ? '—' : (day.authorName ? escapeHtml(day.authorName) : '—');
      const assign = escapeHtml(assignmentLabel(day));
      const assignDisabled = day.mode === 'excluded' || day.assignDisabled === true;
      const assignLabel = day.mode === 'scheduled' && !day.invalid ? 'Change' : 'Assign';
      const assignBtn = assignDisabled
        ? `<button type="button" class="btn btn-outline-primary btn-sm" disabled aria-disabled="true">Assign</button>`
        : `<button type="button" class="btn btn-outline-primary btn-sm" data-wod-schedule-assign data-date-key="${escapeHtml(day.dateKey)}" data-entry-id="${escapeHtml(day.entryId || '')}">${assignLabel}</button>`;
      const excludeBtn = day.mode === 'excluded'
        ? `<button type="button" class="btn btn-outline-secondary btn-sm" data-wod-schedule-include data-date-key="${escapeHtml(day.dateKey)}">Include day</button>`
        : `<button type="button" class="btn btn-outline-warning btn-sm" data-wod-schedule-exclude data-date-key="${escapeHtml(day.dateKey)}">Exclude</button>`;
      return `<tr class="${invalidClass}" data-date-key="${escapeHtml(day.dateKey)}">
        <td class="ps-3 font-monospace small">${escapeHtml(day.dateKey)}</td>
        <td class="small">${assign}</td>
        <td class="fw-semibold">${word}</td>
        <td class="small text-muted">${author}</td>
        <td class="text-end pe-3"><div class="d-inline-flex flex-wrap gap-1 justify-content-end">${assignBtn}${excludeBtn}</div></td>
      </tr>`;
    }).join('');
  }

  async function fetchSchedule() {
    const from = qs('wodScheduleDateFrom')?.value || '';
    const to = qs('wodScheduleDateTo')?.value || '';
    if (!from || !to) {
      setStatus('Choose both start and end dates.', true);
      return;
    }
    setStatus('Loading…', false);
    const url = `/school/word-of-day/api/display-schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setStatus(data.message || 'Could not load schedule.', true);
      return;
    }
    renderRows(data.days || []);
    const invalidCount = (data.days || []).filter((d) => d.invalid).length;
    setStatus(
      invalidCount
        ? `Loaded ${(data.days || []).length} day(s). ${invalidCount} invalid — reassign to fix.`
        : `Loaded ${(data.days || []).length} day(s).`,
      invalidCount > 0
    );
  }

  async function putSchedule(body) {
    const resp = await fetch('/school/word-of-day/api/display-schedule', {
      method: 'PUT',
      headers: csrfHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message || 'Update failed.');
    return data;
  }

  function assignWord(dateKey, entryId) {
    return putSchedule({ dateKey, entryId });
  }

  function excludeDate(dateKey) {
    return putSchedule({ dateKey, mode: 'exclude' });
  }

  function includeDate(dateKey) {
    return putSchedule({ dateKey, mode: 'automatic' });
  }

  function openAssignPicker(dateKey) {
    if (!global.GenericPicker?.open) {
      return showAlert('Assign word', 'Word picker is not available on this page. Refresh and try again.', 'error');
    }
    const title = `Assign approved word for ${dateKey}`;
    return new Promise((resolve) => {
      global.GenericPicker.open({
        title,
        apiEndpoint: '/school/word-of-day/api/display-schedule/picker',
        searchFields: 'word,authorName,entryId',
        limit: 25,
        onSelect: async (item) => {
          const entryId = String(item?.entryId || item?.id || '').trim();
          if (!entryId) {
            await showAlert('Assign word', 'Could not read the selected entry id.', 'error');
            resolve();
            return;
          }
          try {
            await assignWord(dateKey, entryId);
            await fetchSchedule();
          } catch (err) {
            await showAlert('Assign failed', err.message || 'Could not assign word.', 'error');
          }
          resolve();
        }
      });
    });
  }

  function bindTableActions() {
    const body = qs('wodScheduleTableBody');
    if (!body || body.dataset.wodScheduleBound === '1') return;
    body.dataset.wodScheduleBound = '1';
    body.addEventListener('click', async (event) => {
      const assignBtn = event.target.closest('[data-wod-schedule-assign]');
      const excludeBtn = event.target.closest('[data-wod-schedule-exclude]');
      const includeBtn = event.target.closest('[data-wod-schedule-include]');
      try {
        if (assignBtn) {
          const dateKey = assignBtn.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          await openAssignPicker(dateKey);
        } else if (excludeBtn) {
          const dateKey = excludeBtn.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const ok = await showConfirm(
            'Exclude this day?',
            `Exclude ${dateKey} from display? Visitors will see the most recent prior word instead. Assign is disabled while excluded.`,
            { confirmText: 'Exclude', confirmClass: 'btn-warning' }
          );
          if (!ok) return;
          await excludeDate(dateKey);
          await fetchSchedule();
        } else if (includeBtn) {
          const dateKey = includeBtn.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const ok = await showConfirm(
            'Include this day?',
            `Include ${dateKey} for display again? The day will use Automatic selection unless you assign a word.`,
            { confirmText: 'Include day', confirmClass: 'btn-primary', icon: 'info' }
          );
          if (!ok) return;
          await includeDate(dateKey);
          await fetchSchedule();
        }
      } catch (err) {
        setStatus(err.message || 'Action failed.', true);
        await showAlert('Schedule update', err.message || 'Action failed.', 'error');
      }
    });
  }

  function openModal() {
    if (!scheduleModal) return;
    const range = defaultRange();
    if (qs('wodScheduleDateFrom')) qs('wodScheduleDateFrom').value = range.from;
    if (qs('wodScheduleDateTo')) qs('wodScheduleDateTo').value = range.to;
    bindDateShortcuts();
    bindTableActions();
    scheduleModal.show();
    fetchSchedule().catch((err) => setStatus(err.message || 'Load failed.', true));
  }

  function init() {
    const modalEl = qs('wordOfDayDisplayScheduleModal');
    const openBtn = qs('btnWordOfDayConfigureDisplay');
    if (!modalEl || !openBtn || !global.bootstrap?.Modal) return;
    scheduleModal = global.bootstrap.Modal.getOrCreateInstance(modalEl);
    qs('wodScheduleLoadBtn')?.addEventListener('click', () => {
      fetchSchedule().catch((err) => setStatus(err.message || 'Load failed.', true));
    });
    openBtn.addEventListener('click', () => openModal());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);