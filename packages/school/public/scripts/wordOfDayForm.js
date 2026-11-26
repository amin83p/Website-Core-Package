(function (global) {
  'use strict';

  let examples = [];
  let photo = {};
  let audio = {};
  let csrf = '';
  let entryId = '';
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

  function plainMessage(value) {
    return String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function messageIcon(icon) {
    const ui = global.SchoolMessageUi;
    return ui?.normalizeIcon ? ui.normalizeIcon(icon || 'error') : String(icon || 'error');
  }

  function messageOkButtonClass(icon) {
    const normalized = messageIcon(icon);
    if (normalized === 'error') return 'btn-danger';
    if (normalized === 'warning') return 'btn-warning';
    if (normalized === 'success') return 'btn-success';
    return 'btn-primary';
  }

  async function showAlert(title, message, icon) {
    const body = plainMessage(message || title || 'Something went wrong.');
    const normalizedIcon = messageIcon(icon || 'error');
    const ui = global.SchoolMessageUi;
    if (ui?.showAlert) {
      await ui.showAlert(title, normalizedIcon, body);
      return;
    }
    if (typeof global.showMessageModal === 'function' && document.getElementById('messageModal')) {
      await global.showMessageModal({
        title: String(title || 'Message'),
        message: body,
        icon: normalizedIcon,
        buttons: [{ text: 'OK', class: messageOkButtonClass(normalizedIcon) }]
      });
      return;
    }
    global.alert(body);
  }

  function apiHeaders(extra = {}) {
    const headers = {
      Accept: 'application/json',
      'X-Ajax-Request': 'true',
      ...(csrf ? { 'CSRF-Token': csrf } : {}),
      ...extra
    };
    const actionStateId = String(
      document.querySelector('#wordOfDayForm [name="actionStateId"]')?.value
      || document.getElementById('actionStateIdRef')?.dataset?.id
      || ''
    ).trim();
    if (actionStateId) headers['X-Action-State-Id'] = actionStateId;
    return headers;
  }

  function buildSaveRequestBody(form, saveAction) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    fd.forEach((value, key) => {
      if (value instanceof File) return;
      params.append(key, String(value));
    });
    params.set('saveAction', saveAction);
    return params.toString();
  }

  async function readResponsePayload(res) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      return { message: plainMessage(text) || `Request failed (${res.status}).` };
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

  function resolveEntryIdForUpload() {
    const form = qs('wordOfDayForm');
    const id = String(form?.getAttribute('data-entry-id') || form?.dataset?.entryId || '').trim();
    return id || 'entry_unsaved';
  }

  function clearMedia(kind) {
    if (kind === 'photo') {
      photo = {};
      const input = qs('wodPhotoInput');
      const fileInput = qs('wodPhotoFile');
      if (input) input.value = '{}';
      if (fileInput) fileInput.value = '';
      setMediaPreview('photo', photo);
    } else if (kind === 'audio') {
      audio = {};
      const input = qs('wodAudioInput');
      const fileInput = qs('wodAudioFile');
      if (input) input.value = '{}';
      if (fileInput) fileInput.value = '';
      setMediaPreview('audio', audio);
    }
  }

  async function uploadFile(file, kind) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    fd.append('entryId', resolveEntryIdForUpload());
    const res = await fetch('/school/word-of-day/api/media/upload', {
      method: 'POST',
      headers: apiHeaders(),
      body: fd
    });
    const data = await readResponsePayload(res);
    if (!res.ok) throw new Error(data.message || 'Upload failed.');
    return data.media || {};
  }

  function buildDuplicateDetailsHtml(duplicate) {
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
    let html = '<div class="text-start">';
    html += '<p class="text-muted small mb-3">This word is already in your organization. The entry below was not changed.</p>';
    html += `<dl class="row small mb-0">${rows.map(([dt, dd]) => (
      `<dt class="col-sm-3">${escapeHtml(dt)}</dt><dd class="col-sm-9">${escapeHtml(dd)}</dd>`
    )).join('')}</dl>`;
    const examplesDup = Array.isArray(duplicate.examples) ? duplicate.examples : [];
    if (examplesDup.length) {
      html += `<ul class="small mb-0 ps-3 mt-2">${examplesDup.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>`;
    }
    html += '</div>';
    return html;
  }

  async function showDuplicateModal(duplicate) {
    if (!duplicate) return;
    const limited = duplicate.limited === true || duplicate.canOpen === false;
    if (limited) {
      await showAlert(
        'Word already in use',
        duplicate.notice || 'This word is already in your organization. Please choose a different word.',
        'warning'
      );
      return;
    }

    const openLabel = 'Open saved entry';
    if (typeof global.showMessageModal === 'function' && document.getElementById('messageModal')) {
      const buttons = [{ text: 'Close', class: 'btn-secondary' }];
      if (duplicate.detailUrl) {
        buttons.push({ text: openLabel, class: 'btn-primary' });
      }
      const result = await global.showMessageModal({
        title: 'Word already saved',
        icon: 'warning',
        size: 'lg',
        message: buildDuplicateDetailsHtml(duplicate),
        buttons
      });
      if (result === openLabel && duplicate.detailUrl) {
        global.location.href = duplicate.detailUrl;
      }
      return;
    }

    await showAlert(
      'Word already saved',
      `This word is already saved by ${duplicate.authorName || 'another user'}.`,
      'warning'
    );
  }

  async function checkDuplicateWord(word) {
    const res = await fetch('/school/word-of-day/api/check-duplicate', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ word, excludeId: entryId })
    });
    const data = await readResponsePayload(res);
    return data;
  }

  function applyAiAutofillFields(fields = {}) {
    const form = qs('wordOfDayForm');
    const pronunciation = qs('wodPronunciation');
    const meaning = qs('wodMeaning');
    if (pronunciation) pronunciation.value = String(fields.pronunciation || '');
    if (meaning) meaning.value = String(fields.meaning || '');

    const difficulty = String(fields.difficulty || 'medium').trim();
    form?.querySelectorAll('input[name="difficulty"]').forEach((radio) => {
      radio.checked = radio.value === difficulty;
    });

    const typeSet = new Set(Array.isArray(fields.wordTypes) ? fields.wordTypes : []);
    form?.querySelectorAll('[data-wod-word-type]').forEach((el) => {
      el.checked = typeSet.has(el.value);
    });
    if (form) syncWordTypesInput(form);

    examples = Array.isArray(fields.examples)
      ? fields.examples.map((row) => String(row || '').trim()).filter(Boolean).slice(0, 3)
      : [];
    const draft = qs('wodExampleDraft');
    if (draft) draft.value = '';
    syncExamplesInput();
  }

  let aiAutofillRunning = false;
  let aiAutofillAllowed = true;
  let aiAutofillBlockedMessage = '';

  function beginAiAutofillLoading(word) {
    if (typeof global.showLoading !== 'function') return null;
    return global.showLoading({
      title: 'Word of the Day',
      operation: 'AI Assist',
      note: `Generating pronunciation, meaning, and examples for “${String(word || '').trim()}”…`
    });
  }

  function endAiAutofillLoading(token) {
    if (token && typeof global.hideLoading === 'function') {
      global.hideLoading(token);
    }
  }

  async function runAiAutofill() {
    if (!aiAutofillAllowed) {
      await showAlert(
        'AI credit limit',
        aiAutofillBlockedMessage || 'You have reached your allocated School AI limit. Contact your administrator for more credit.',
        'warning'
      );
      return;
    }
    const btn = qs('btnWodAiAutofill');
    const wordInput = qs('wodWord');
    const word = String(wordInput?.value || '').trim();
    if (!word) {
      await showAlert('Word required', 'Enter a vocabulary word before generating with AI.', 'warning');
      wordInput?.focus();
      return;
    }
    if (aiAutofillRunning) return;
    aiAutofillRunning = true;
    const priorLabel = btn?.innerHTML;
    let loadingToken = null;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Generating…';
    }
    try {
      loadingToken = beginAiAutofillLoading(word);
      const res = await fetch('/school/word-of-day/api/ai-autofill', {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ word })
      });
      const data = await readResponsePayload(res);
      const nextToken = String(
        res.headers.get('x-action-state-id') || res.headers.get('X-Action-State-Id') || ''
      ).trim();
      if (nextToken) {
        const hidden = document.querySelector('#wordOfDayForm [name="actionStateId"]');
        const ref = document.getElementById('actionStateIdRef');
        if (hidden) hidden.value = nextToken;
        if (ref) ref.dataset.id = nextToken;
      }
      if (!res.ok || data?.status !== 'success') {
        await showAlert(
          'AI autofill failed',
          data.message || data.error || 'Could not generate content. Assign a model in AI Assist → Service assignments.',
          'error'
        );
        return;
      }
      applyAiAutofillFields(data.fields || {});
    } catch (err) {
      await showAlert('AI autofill failed', err.message || 'Could not generate content.', 'error');
    } finally {
      endAiAutofillLoading(loadingToken);
      aiAutofillRunning = false;
      if (btn) {
        btn.disabled = false;
        if (priorLabel) btn.innerHTML = priorLabel;
      }
    }
  }

  function bindAiAutofill() {
    qs('btnWodAiAutofill')?.addEventListener('click', () => {
      void runAiAutofill();
    });
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
      await showAlert('Upload failed', err.message || 'Upload failed.', 'error');
      return;
    }

    const word = String(qs('wodWord')?.value || '').trim();
    try {
      const preCheck = await checkDuplicateWord(word);
      if (preCheck?.duplicate) {
        saving = false;
        await showDuplicateModal(preCheck.duplicate);
        return;
      }
    } catch (_) { /* server will enforce */ }

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }),
        body: buildSaveRequestBody(form, saveAction)
      });
      const data = await readResponsePayload(res);
      const nextToken = String(
        res.headers.get('x-action-state-id') || res.headers.get('X-Action-State-Id') || ''
      ).trim();
      if (nextToken) {
        const hidden = document.querySelector('#wordOfDayForm [name="actionStateId"]');
        const ref = document.getElementById('actionStateIdRef');
        if (hidden) hidden.value = nextToken;
        if (ref) ref.dataset.id = nextToken;
      }

      if (res.status === 409 && data?.duplicate) {
        await showDuplicateModal(data.duplicate);
        saving = false;
        return;
      }
      if (!res.ok) {
        await showAlert('Save failed', data.message || 'Save failed.', 'error');
        saving = false;
        return;
      }
      const wordLabel = String(qs('wodWord')?.value || data?.entry?.word || 'Word').trim() || 'Word';
      const submitted = saveAction === 'submit';
      const successTitle = submitted ? 'Submitted' : 'Saved';
      const successMessage = submitted
        ? `"${wordLabel}" was saved and submitted for review.`
        : `"${wordLabel}" was saved successfully.`;
      await showAlert(successTitle, successMessage, 'success');
      global.location.href = '/school/word-of-day';
      return;
    } catch (err) {
      await showAlert('Save failed', err.message || 'Save failed.', 'error');
    } finally {
      saving = false;
    }
  }

  function setAuthorChip(userId, displayName) {
    const idInput = qs('wodAuthorUserId');
    const nameInput = qs('wodAuthorName');
    const labelEl = qs('wodAuthorChipLabel');
    const idEl = qs('wodAuthorChipId');
    const clearBtn = qs('wodClearAuthorBtn');
    const uid = String(userId || '').trim();
    const name = String(displayName || '').trim();
    if (idInput) idInput.value = uid;
    if (nameInput) nameInput.value = name || uid;
    if (labelEl) labelEl.textContent = name || uid || 'You (default)';
    if (idEl) {
      if (uid) {
        idEl.textContent = `(${uid})`;
        idEl.classList.remove('d-none');
      } else {
        idEl.textContent = '';
        idEl.classList.add('d-none');
      }
    }
    clearBtn?.classList.toggle('d-none', !uid);
  }

  function readActiveAuthorMeta() {
    const meta = parseJsonInput(qs('wodActiveAuthorMeta'), null);
    if (!meta || typeof meta !== 'object') return { userId: '', displayName: '' };
    const userId = String(meta.userId || meta.id || '').trim();
    const displayName = String(meta.displayName || meta.name || '').trim();
    return { userId, displayName };
  }

  function bindAuthorPicker() {
    const pickBtn = qs('wodPickAuthorBtn');
    const assignSelfBtn = qs('wodAssignSelfAuthorBtn');
    if (!pickBtn && !assignSelfBtn) return;

    assignSelfBtn?.addEventListener('click', () => {
      const active = readActiveAuthorMeta();
      if (!active.userId) {
        void showAlert('Unavailable', 'Active user ID is not available.', 'warning');
        return;
      }
      setAuthorChip(active.userId, active.displayName || active.userId);
    });

    if (!pickBtn) return;

    pickBtn.addEventListener('click', () => {
      if (!global.GenericPicker || !global.GenericPickerPresets?.user) {
        void showAlert('Unavailable', 'User picker is not available on this page.', 'warning');
        return;
      }
      const context = global.GenericPickerContexts?.activeOrganizationScope
        ? global.GenericPickerContexts.activeOrganizationScope({ label: 'Active organization' })
        : null;
      global.GenericPicker.open(global.GenericPickerPresets.user({
        title: 'Select author',
        icon: 'bi-person-check',
        multiselect: false,
        apiEndpoint: '/users',
        searchFields: 'id,username,email,name',
        placeholder: 'Search users…',
        context,
        onSelect: (item) => {
          const user = Array.isArray(item) ? item[0] : item;
          if (!user) return;
          const uid = String(user.id || user.userId || '').trim();
          const label = String(user.name || user.username || user.email || uid).trim();
          setAuthorChip(uid, label);
        }
      }));
    });

    qs('wodClearAuthorBtn')?.addEventListener('click', () => {
      setAuthorChip('', '');
    });
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
    const aiOpts = options.aiAutofill && typeof options.aiAutofill === 'object' ? options.aiAutofill : {};
    aiAutofillAllowed = aiOpts.allowed !== false;
    aiAutofillBlockedMessage = String(aiOpts.blockedMessage || '').trim();
    const form = qs('wordOfDayForm');
    if (!form) return;
    entryId = String(form.getAttribute('data-entry-id') || '').trim();

    examples = parseJsonInput(qs('wodExamplesInput'), []);
    photo = parseJsonInput(qs('wodPhotoInput'), {});
    audio = parseJsonInput(qs('wodAudioInput'), {});
    setMediaPreview('photo', photo);
    setMediaPreview('audio', audio);

    qs('wodClearPhotoBtn')?.addEventListener('click', () => clearMedia('photo'));
    qs('wodClearAudioBtn')?.addEventListener('click', () => clearMedia('audio'));
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
    bindAuthorPicker();
    bindAiAutofill();
    syncWordTypesInput(form);
  }

  global.WordOfDayForm = { init };
}(window));