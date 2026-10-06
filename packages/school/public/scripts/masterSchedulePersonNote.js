(function (global) {
  'use strict';

  function installMasterSchedulePersonNote(deps) {
    if (!deps || typeof deps !== 'object') return;

    const noteCacheByPersonId = new Map();
    let loadedPersonId = '';
    let modalOpen = false;

    function clean(value) {
      return String(value || '').trim();
    }

    function escapeHtml(value) {
      return typeof deps.escapeHtml === 'function'
        ? deps.escapeHtml(value)
        : String(value ?? '');
    }

    function getModal() {
      return document.getElementById('schedulePersonNoteModal');
    }

    function getRailButton() {
      return document.querySelector('[data-schedule-admin-action="person-schedule-note"]');
    }

    function setRailButtonFilled(hasNote) {
      const btn = getRailButton();
      if (!btn) return;
      btn.classList.toggle('has-schedule-person-note', hasNote === true);
      btn.setAttribute('aria-pressed', hasNote ? 'true' : 'false');
    }

    async function fetchJson(url, options = {}) {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-AJAX-Request': 'true',
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...options
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || `Request failed (${res.status}).`);
      }
      return data;
    }

    async function loadNoteForPerson(personId, { useCache = true } = {}) {
      const pid = clean(personId);
      if (!pid) return { personId: '', note: '', updatedAt: '', updatedBy: '' };
      if (useCache && noteCacheByPersonId.has(pid)) {
        return noteCacheByPersonId.get(pid);
      }
      const data = await fetchJson(`/school/schedules/api/person-schedule-note?personId=${encodeURIComponent(pid)}`);
      const note = data.note && typeof data.note === 'object' ? data.note : { personId: pid, note: '' };
      noteCacheByPersonId.set(pid, note);
      return note;
    }

    function applyNoteToModal(person, noteRow) {
      const modal = getModal();
      const titleEl = document.getElementById('schedulePersonNoteModalTitle');
      const textarea = document.getElementById('schedulePersonNoteInput');
      const metaEl = document.getElementById('schedulePersonNoteMeta');
      const personName = clean(person?.name) || clean(person?.id) || 'Person';
      if (titleEl) titleEl.textContent = `Schedule note — ${personName}`;
      if (textarea) textarea.value = String(noteRow?.note || '');
      loadedPersonId = clean(person?.id);
      if (metaEl) {
        const updatedAt = clean(noteRow?.updatedAt);
        metaEl.textContent = updatedAt
          ? `Last updated ${new Date(updatedAt).toLocaleString()}`
          : 'No saved note yet.';
      }
      const activePerson = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
      if (clean(activePerson?.id) === loadedPersonId) {
        setRailButtonFilled(Boolean(String(noteRow?.note || '').trim()));
      }
    }

    async function refreshModalForActivePerson() {
      const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
      const personId = clean(person?.id);
      if (!personId) {
        await deps.uiAlert?.('Select a person tab first.', 'Schedule note', { icon: 'info' });
        return false;
      }
      const noteRow = await loadNoteForPerson(personId);
      applyNoteToModal(person, noteRow);
      return true;
    }

    async function openPersonScheduleNoteModal() {
      const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
      if (!clean(person?.id)) {
        await deps.uiAlert?.('Select a person tab first.', 'Schedule note', { icon: 'info' });
        return;
      }
      try {
        const ok = await refreshModalForActivePerson();
        if (!ok) return;
        modalOpen = true;
        deps.showBootstrapModal?.(getModal());
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to load schedule note.', 'Schedule note', { icon: 'warning' });
      }
    }

    async function handleActivePersonChanged() {
      const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
      const personId = clean(person?.id);
      if (!personId) {
        setRailButtonFilled(false);
        return;
      }
      try {
        const noteRow = await loadNoteForPerson(personId);
        if (clean(personId) === clean((typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null)?.id)) {
          setRailButtonFilled(Boolean(String(noteRow?.note || '').trim()));
        }
        if (!modalOpen) return;
        const modal = getModal();
        if (!modal || !modal.classList.contains('show')) return;
        await refreshModalForActivePerson();
      } catch (_error) {
        if (modalOpen) {
          await deps.uiAlert?.('Unable to load schedule note for this person.', 'Schedule note', { icon: 'warning' });
        }
      }
    }

    async function savePersonScheduleNote() {
      const personId = loadedPersonId || clean((typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null)?.id);
      if (!personId) return;
      const textarea = document.getElementById('schedulePersonNoteInput');
      const note = String(textarea?.value ?? '');
      const saveBtn = document.getElementById('btn_schedulePersonNoteSave');
      if (saveBtn) saveBtn.disabled = true;
      try {
        const data = await fetchJson('/school/schedules/api/person-schedule-note', {
          method: 'PUT',
          body: JSON.stringify({ personId, note })
        });
        const saved = data.note && typeof data.note === 'object' ? data.note : { personId, note: note.trim() };
        noteCacheByPersonId.set(personId, saved);
        const person = typeof deps.activeSchedulePerson === 'function' ? deps.activeSchedulePerson() : null;
        applyNoteToModal(person, saved);
        setRailButtonFilled(Boolean(String(saved.note || '').trim()));
        deps.hideBootstrapModal?.(getModal());
        modalOpen = false;
      } catch (error) {
        await deps.uiAlert?.(error.message || 'Unable to save schedule note.', 'Schedule note', { icon: 'warning' });
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    }

    document.getElementById('btn_schedulePersonNoteSave')?.addEventListener('click', () => {
      void savePersonScheduleNote();
    });

    getModal()?.addEventListener('hidden.bs.modal', () => {
      modalOpen = false;
    });

    deps.bindPersonScheduleNoteRail?.(openPersonScheduleNoteModal);
    deps.bindActiveSchedulePersonChangeListener?.(handleActivePersonChanged);
    void handleActivePersonChanged();

    global.MasterSchedulePersonNote = {
      clearCache() {
        noteCacheByPersonId.clear();
      }
    };
  }

  global.installMasterSchedulePersonNote = installMasterSchedulePersonNote;
})(typeof window !== 'undefined' ? window : global);
