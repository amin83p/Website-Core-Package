(function initWordOfDayDisplayScheduleModal(global) {
  'use strict';

  const state = { shortcutsBound: false };
  let scheduleModal;

  function qs(id) {
    return document.getElementById(id);
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
      const word = day.word ? escapeHtml(day.word) : '—';
      const author = day.authorName ? escapeHtml(day.authorName) : '—';
      const assign = escapeHtml(assignmentLabel(day));
      const assignBtn = day.mode === 'scheduled' && !day.invalid
        ? `<button type="button" class="btn btn-outline-secondary btn-sm" data-wod-schedule-assign data-date-key="${escapeHtml(day.dateKey)}" data-entry-id="${escapeHtml(day.entryId || '')}">Change</button>`
        : `<button type="button" class="btn btn-outline-primary btn-sm" data-wod-schedule-assign data-date-key="${escapeHtml(day.dateKey)}">Assign</button>`;
      const clearBtn = day.mode === 'scheduled'
        ? `<button type="button" class="btn btn-outline-danger btn-sm" data-wod-schedule-clear data-date-key="${escapeHtml(day.dateKey)}">Clear</button>`
        : '';
      return `<tr class="${invalidClass}" data-date-key="${escapeHtml(day.dateKey)}">
        <td class="ps-3 font-monospace small">${escapeHtml(day.dateKey)}</td>
        <td class="small">${assign}</td>
        <td class="fw-semibold">${word}</td>
        <td class="small text-muted">${author}</td>
        <td class="text-end pe-3"><div class="d-inline-flex flex-wrap gap-1 justify-content-end">${assignBtn}${clearBtn}</div></td>
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
        ? `Loaded ${(data.days || []).length} day(s). ${invalidCount} invalid — clear or reassign.`
        : `Loaded ${(data.days || []).length} day(s).`,
      invalidCount > 0
    );
  }

  async function searchApprovedWords(query) {
    const url = `/school/word-of-day/api/display-schedule/picker?q=${encodeURIComponent(query)}&limit=25`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message || 'Search failed.');
    return Array.isArray(data.items) ? data.items : [];
  }

  async function assignWord(dateKey, entryId) {
    const resp = await fetch('/school/word-of-day/api/display-schedule', {
      method: 'PUT',
      headers: csrfHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ dateKey, entryId })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message || 'Assign failed.');
  }

  async function clearDate(dateKey) {
    const resp = await fetch('/school/word-of-day/api/display-schedule', {
      method: 'PUT',
      headers: csrfHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ dateKey, entryId: null })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message || 'Clear failed.');
  }

  async function promptAssign(dateKey, currentEntryId) {
    const initial = await searchApprovedWords('');
    let options = initial;
    if (currentEntryId && !options.find((row) => String(row.entryId) === String(currentEntryId))) {
      const extra = await searchApprovedWords(currentEntryId);
      options = [...extra, ...options];
    }
    const lines = options.map((row, idx) => `${idx + 1}. ${row.word} — ${row.authorName || 'Unknown'} (${row.entryId})`).join('\n');
    const promptText = lines
      ? `Assign word for ${dateKey}.\nEnter list number, or search and paste entry id:\n\n${lines}`
      : `Assign word for ${dateKey}. Enter approved entry id:`;
    const raw = global.prompt(promptText, currentEntryId || '');
    if (raw === null) return;
    const trimmed = String(raw).trim();
    if (!trimmed) return;
    const asIndex = Number.parseInt(trimmed, 10);
    let entryId = trimmed;
    if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= options.length) {
      entryId = options[asIndex - 1].entryId;
    }
    await assignWord(dateKey, entryId);
    await fetchSchedule();
  }

  function bindTableActions() {
    const body = qs('wodScheduleTableBody');
    if (!body || body.dataset.wodScheduleBound === '1') return;
    body.dataset.wodScheduleBound = '1';
    body.addEventListener('click', async (event) => {
      const assignBtn = event.target.closest('[data-wod-schedule-assign]');
      const clearBtn = event.target.closest('[data-wod-schedule-clear]');
      try {
        if (assignBtn) {
          const dateKey = assignBtn.getAttribute('data-date-key') || '';
          const entryId = assignBtn.getAttribute('data-entry-id') || '';
          await promptAssign(dateKey, entryId);
        } else if (clearBtn) {
          const dateKey = clearBtn.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          if (!global.confirm(`Clear scheduled word for ${dateKey}?`)) return;
          await clearDate(dateKey);
          await fetchSchedule();
        }
      } catch (err) {
        setStatus(err.message || 'Action failed.', true);
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