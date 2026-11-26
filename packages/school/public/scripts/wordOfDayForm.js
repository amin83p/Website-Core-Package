(function (global) {
  'use strict';

  let examples = [];
  let photo = {};
  let audio = {};
  let csrf = '';
  let entryId = '';
  let duplicateModal = null;
  let saving = false;

  function qs(id) {
    return document.getElementById(id);
  }

  function parseJsonInput(el, fallback) {
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || 'null') ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function syncWordTypesInput(form) {
    const hidden = qs('wodWordTypesInput');
    if (!hidden || !form) return;
    const checked = Array.from(form.querySelectorAll('[data-wod-word-type]:checked')).map((el) => el.value);
    const fallback = checked.length ? checked : ['noun'];
    hidden.value = JSON.stringify(fallback);
  }

  function flushExampleDraft() {
    const draft = qs('wodExampleDraft');
    const text = String(draft?.value || '').trim();
    if (!text) return false;
    examples.push(text);
    draft.value = '';
    syncExamplesInput();
    return true;
  }

  function syncExamplesInput() {
    const input = qs('wodExamplesInput');
    if (input) input.value = JSON.stringify(examples);
    renderExamples();
  }

  function renderExamples() {
    const list = qs('wodExamplesList');
    if (!list) return;
    if (!examples.length) {
      list.innerHTML = '<li class="list-group-item text-muted small border-0">No examples yet.</li>';
      return;
    }
    list.innerHTML = examples.map((text, index) => (
      `<li class="list-group-item d-flex justify-content-between align-items-start gap-2">
        <span class="wod-example-text">${escapeHtml(text)}</span>
        <button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0" data-example-index="${index}">Remove</button>
      </li>`
    )).join('');
  }

  function setMediaPreview(kind, media) {
    const box = qs(kind === 'photo' ? 'wodPhotoPreview' : 'wodAudioPreview');
    if (!box) return;
    if (!media?.url) {
      box.innerHTML = '';
      return;
    }
    if (kind === 'photo') {
      box.innerHTML = `<img src="${escapeHtml(media.url)}" alt="" class="rounded border mt-1" style="max-height:100px;">`;
    } else {
      box.innerHTML = `<audio controls src="${escapeHtml(media.url)}" class="w-100 mt-1"></audio>`;
    }
  }

  async function uploadFile(file, kind) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    const res = await fetch('/school/word-of-day/api/media/upload', {
      method: 'POST',
      headers: csrf ? { 'CSRF-Token': csrf } : {},
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Upload failed.');
    return data.media || {};
  }

  function ensureDuplicateModal() {
    const el = qs('wodDuplicateModal');
    if (!el || !global.bootstrap?.Modal) return null;
    if (!duplicateModal) duplicateModal = new global.bootstrap.Modal(el);
    return duplicateModal;
  }

  function showDuplicateModal(duplicate) {
    if (!duplicate) return;
    const dl = qs('wodDuplicateDetails');
    const exList = qs('wodDuplicateExamples');
    const link = qs('wodDuplicateOpenLink');
    if (dl) {
      const rows = [
        ['Word', duplicate.word],
        ['Type', duplicate.typeLabels || (duplicate.wordTypes || []).join(', ')],
        ['Difficulty', duplicate.difficultyLabel || duplicate.difficulty],
        ['Pronunciation', duplicate.pronunciation || '—'],
        ['Meaning', duplicate.meaning || '—'],
        ['Status', duplicate.status || '—'],
        ['Saved by', duplicate.authorName || duplicate.createdBy || '—'],
        ['Saved on', duplicate.createDateTime || '—']
      ];
      dl.innerHTML = rows.map(([dt, dd]) => (
        `<dt class="col-sm-3">${escapeHtml(dt)}</dt><dd class="col-sm-9">${escapeHtml(dd)}</dd>`
      )).join('');
    }
    const examplesDup = Array.isArray(duplicate.examples) ? duplicate.examples : [];
    if (exList) {
      if (examplesDup.length) {
        exList.classList.remove('d-none');
        exList.innerHTML = examplesDup.map((row) => `<li>${escapeHtml(row)}</li>`).join('');
      } else {
        exList.classList.add('d-none');
        exList.innerHTML = '';
      }
    }
    if (link && duplicate.detailUrl) {
      link.href = duplicate.detailUrl;
      link.classList.remove('d-none');
    } else if (link) {
      link.classList.add('d-none');
    }
    const modal = ensureDuplicateModal();
    if (modal) modal.show();
    else window.alert(`This word is already saved by ${duplicate.authorName || 'another user'}.`);
  }

  async function checkDuplicateWord(word) {
    const res = await fetch('/school/word-of-day/api/check-duplicate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(csrf ? { 'CSRF-Token': csrf } : {})
      },
      body: JSON.stringify({ word, excludeId: entryId })
    });
    const data = await res.json().catch(() => ({}));
    return data;
  }

  async function runSave(form, saveAction) {
    if (saving) return;
    saving = true;
    const saveInput = qs('wodSaveAction');
    if (saveInput) saveInput.value = saveAction;

    flushExampleDraft();
    syncWordTypesInput(form);

    try {
      const photoInput = qs('wodPhotoFile');
      const audioInput = qs('wodAudioFile');
      if (photoInput?.files?.[0]) {
        photo = await uploadFile(photoInput.files[0], 'photo');
        qs('wodPhotoInput').value = JSON.stringify(photo);
      }
      if (audioInput?.files?.[0]) {
        audio = await uploadFile(audioInput.files[0], 'audio');
        qs('wodAudioInput').value = JSON.stringify(audio);
      }
    } catch (err) {
      saving = false;
      window.alert(err.message || 'Upload failed.');
      return;
    }

    const word = String(qs('wodWord')?.value || '').trim();
    try {
      const preCheck = await checkDuplicateWord(word);
      if (preCheck?.duplicate) {
        saving = false;
        showDuplicateModal(preCheck.duplicate);
        return;
      }
    } catch (_) { /* server will enforce */ }

    const fd = new FormData(form);
    fd.set('saveAction', saveAction);

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', ...(csrf ? { 'CSRF-Token': csrf } : {}) },
        body: fd
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data?.duplicate) {
        showDuplicateModal(data.duplicate);
        saving = false;
        return;
      }
      if (!res.ok) {
        window.alert(data.message || 'Save failed.');
        saving = false;
        return;
      }
      const id = data?.entry?.id;
      if (id) {
        global.location.href = `/school/word-of-day/detail/${encodeURIComponent(id)}`;
        return;
      }
      global.location.href = '/school/word-of-day';
    } catch (err) {
      window.alert(err.message || 'Save failed.');
    } finally {
      saving = false;
    }
  }

  function bindSaveButtons(form) {
    form.querySelectorAll('[data-wod-save]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-wod-save') || 'saved';
        runSave(form, action);
      });
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
    });
  }

  function init(options = {}) {
    csrf = String(options.csrfToken || '').trim();
    const form = qs('wordOfDayForm');
    if (!form) return;
    entryId = String(form.getAttribute('data-entry-id') || '').trim();

    examples = parseJsonInput(qs('wodExamplesInput'), []);
    photo = parseJsonInput(qs('wodPhotoInput'), {});
    audio = parseJsonInput(qs('wodAudioInput'), {});
    setMediaPreview('photo', photo);
    setMediaPreview('audio', audio);
    renderExamples();

    qs('btnAddWodExample')?.addEventListener('click', () => {
      flushExampleDraft();
    });

    qs('wodExamplesList')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-example-index]');
      if (!btn) return;
      const index = Number(btn.getAttribute('data-example-index'));
      if (!Number.isFinite(index)) return;
      examples.splice(index, 1);
      syncExamplesInput();
    });

    form.querySelectorAll('[data-wod-word-type]').forEach((el) => {
      el.addEventListener('change', () => syncWordTypesInput(form));
    });

    bindSaveButtons(form);
    syncWordTypesInput(form);
  }

  global.WordOfDayForm = { init };
}(window));