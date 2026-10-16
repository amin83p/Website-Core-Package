(function (global) {
  'use strict';

  let modalInstance = null;
  let titleTouched = false;
  let previewTimer = null;
  let openOptions = {};

  function getModalEl() {
    return document.getElementById('classCreateFromTemplateModal');
  }

  function ensureModal() {
    const el = getModalEl();
    if (!el || !global.bootstrap?.Modal) return null;
    if (el.parentElement !== global.document.body) {
      global.document.body.appendChild(el);
    }
    if (!modalInstance) modalInstance = new global.bootstrap.Modal(el);
    return modalInstance;
  }

  function readTemplateOptions() {
    const select = document.getElementById('cft_templateId');
    if (!select) return [];
    return Array.from(select.options)
      .filter((opt) => String(opt.value || '').trim())
      .map((opt) => ({
        id: String(opt.value || '').trim(),
        registrationMode: String(opt.dataset.registrationMode || 'term_based').trim().toLowerCase()
      }));
  }

  function selectedTemplate() {
    const id = String(document.getElementById('cft_templateId')?.value || '').trim();
    return readTemplateOptions().find((row) => String(row.id) === id) || null;
  }

  function firstDayOfCurrentMonth(referenceIsoDay) {
    const ref = String(referenceIsoDay || '').trim();
    const match = ref.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (match) return `${match[1]}-${match[2]}-01`;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }

  function applyDefaultStartDate(referenceIsoDay) {
    const startDateInput = document.getElementById('cft_startDate');
    if (!startDateInput) return;
    startDateInput.value = firstDayOfCurrentMonth(referenceIsoDay);
  }

  function syncStartDateVisibility() {
    const template = selectedTemplate();
    const wrap = document.getElementById('cft_startDateWrap');
    const input = document.getElementById('cft_startDate');
    if (!wrap || !input) return;
    const rolling = String(template?.registrationMode || '').toLowerCase() === 'rolling';
    wrap.classList.toggle('d-none', !rolling);
    input.required = rolling;
    if (!rolling) {
      input.value = '';
      return;
    }
    if (!String(input.value || '').trim()) {
      applyDefaultStartDate(input.dataset.orgReferenceDay || '');
    }
  }

  function fillStudentCountOptions() {
    const select = document.getElementById('cft_studentCount');
    if (!select || select.options.length) return;
    for (let n = 1; n <= 30; n += 1) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      if (n === 8) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function populateTemplateSelect(selectEl, templates, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder;
    selectEl.appendChild(blank);
    (templates || []).forEach((row) => {
      const opt = document.createElement('option');
      opt.value = String(row.id || '');
      opt.dataset.registrationMode = String(row.registrationMode || 'term_based');
      opt.textContent = String(row.name || row.code || opt.value);
      selectEl.appendChild(opt);
    });
  }

  function populateTeacherSelect(selectEl, teachers, placeholder) {
    populateSelect(selectEl, teachers, placeholder);
  }

  function populateSelect(selectEl, items, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder;
    selectEl.appendChild(blank);
    (items || []).forEach((row) => {
      const opt = document.createElement('option');
      opt.value = String(row.id || row.personId || '');
      opt.textContent = String(row.label || row.name || row.code || opt.value);
      if (row.code && row.name) {
        opt.textContent = `${row.code} — ${row.name}`;
      }
      selectEl.appendChild(opt);
    });
  }

  async function fetchBootstrapData() {
    const response = await fetch('/school/classes/api/create-from-template/bootstrap', {
      headers: { 'X-AJAX-Request': 'true', Accept: 'application/json' },
      credentials: 'same-origin'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'success') {
      throw new Error(result.message || 'Could not load template options.');
    }
    return result;
  }

  const NO_TEMPLATES_MESSAGE = 'No active class templates are available for this organization.';

  async function showUserAlert(message, title, options = {}) {
    const icon = String(options.icon || 'info').trim();
    const okClassByIcon = {
      error: 'btn-danger',
      warning: 'btn-warning',
      success: 'btn-success',
      info: 'btn-primary'
    };
    const okClass = okClassByIcon[icon] || 'btn-primary';
    if (typeof global.showMessageModal === 'function') {
      await global.showMessageModal({
        title: String(title || 'Notice'),
        message: String(message || ''),
        icon,
        buttons: [{ text: options.okText || 'OK', class: okClass }]
      });
      return;
    }
    if (typeof global.uiAlert === 'function') {
      await global.uiAlert(message, title, options);
      return;
    }
    global.alert(String(message || title || 'Notice'));
  }

  function setLoadingState(isLoading) {
    const loadingEl = document.getElementById('classCreateFromTemplateLoading');
    const fieldsEl = document.getElementById('classCreateFromTemplateFields');
    const submitBtn = document.getElementById('cft_submitBtn');
    loadingEl?.classList.toggle('d-none', !isLoading);
    if (isLoading) {
      fieldsEl?.classList.add('d-none');
      if (submitBtn) submitBtn.disabled = true;
    }
  }

  function resetFormForOpen() {
    document.getElementById('cft_actionStateId').value = '';
    document.getElementById('cft_title').value = '';
    document.getElementById('cft_templateId').innerHTML = '';
    document.getElementById('cft_teacherPersonId').innerHTML = '';
    document.getElementById('cft_startDateWrap')?.classList.add('d-none');
    const startDateInput = document.getElementById('cft_startDate');
    if (startDateInput) {
      startDateInput.value = '';
      startDateInput.required = false;
    }
  }

  function collectPreviewPayload() {
    return {
      templateId: String(document.getElementById('cft_templateId')?.value || '').trim(),
      teacherPersonId: String(document.getElementById('cft_teacherPersonId')?.value || '').trim(),
      period: String(document.getElementById('cft_period')?.value || '').trim(),
      studentCount: String(document.getElementById('cft_studentCount')?.value || '').trim(),
      startDate: String(document.getElementById('cft_startDate')?.value || '').trim()
    };
  }

  async function refreshTitlePreview() {
    const titleInput = document.getElementById('cft_title');
    const payload = collectPreviewPayload();
    if (!payload.templateId || !payload.teacherPersonId || !payload.studentCount) {
      if (titleInput && !titleTouched) titleInput.value = '';
      return;
    }
    try {
      const body = new URLSearchParams(payload);
      const response = await fetch('/school/classes/api/preview-template-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-AJAX-Request': 'true' },
        credentials: 'same-origin',
        body: body.toString()
      });
      const result = await response.json();
      if (titleInput && !titleTouched && result?.status === 'success') {
        titleInput.value = String(result.title || '');
      }
    } catch (_) {
      /* keep prior title */
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshTitlePreview, 200);
  }

  function bindFormOnce() {
    const form = document.getElementById('classCreateFromTemplateForm');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';

    fillStudentCountOptions();

    ['cft_templateId', 'cft_teacherPersonId', 'cft_period', 'cft_studentCount', 'cft_startDate'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (id === 'cft_templateId') syncStartDateVisibility();
        schedulePreview();
      });
    });

    document.getElementById('cft_title')?.addEventListener('input', () => {
      titleTouched = true;
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const submitBtn = document.getElementById('cft_submitBtn');
      const original = submitBtn?.innerHTML || '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating...';
      }
      try {
        const body = new URLSearchParams(new FormData(form));
        const response = await fetch('/school/classes/api/create-from-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-AJAX-Request': 'true' },
          credentials: 'same-origin',
          body: body.toString()
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.status !== 'success') {
          throw new Error(result.message || 'Unable to create class.');
        }
        modalInstance?.hide();
        if (typeof openOptions.onSuccess === 'function') {
          await openOptions.onSuccess(result);
        } else if (openOptions.redirectOnSuccess !== false) {
          global.location.href = openOptions.redirectUrl || '/school/classes';
        } else {
          await showUserAlert(result.message || 'Class created.', 'Success', { icon: 'success' });
        }
      } catch (error) {
        await showUserAlert(error.message || 'Create failed.', 'Error', { icon: 'error' });
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = original;
        }
      }
    });
  }

  async function open(options = {}) {
    openOptions = options || {};
    const modal = ensureModal();
    if (!modal) {
      global.alert('Create from template is not available on this page.');
      return;
    }
    bindFormOnce();
    titleTouched = false;
    resetFormForOpen();
    setLoadingState(true);
    modal.show();

    const fieldsEl = document.getElementById('classCreateFromTemplateFields');
    const submitBtn = document.getElementById('cft_submitBtn');

    try {
      const data = await fetchBootstrapData();
      const hasTemplates = Array.isArray(data.templates) && data.templates.length > 0;
      if (!hasTemplates) {
        setLoadingState(false);
        modal.hide();
        await showUserAlert(NO_TEMPLATES_MESSAGE, 'Create Class from Template', { icon: 'warning' });
        return;
      }

      document.getElementById('cft_actionStateId').value = String(data.actionStateId || '');
      const startDateInput = document.getElementById('cft_startDate');
      if (startDateInput) {
        startDateInput.dataset.orgReferenceDay = String(data.orgToday || '');
        applyDefaultStartDate(data.orgToday);
      }

      populateTemplateSelect(document.getElementById('cft_templateId'), data.templates, 'Select a template...');
      populateTeacherSelect(document.getElementById('cft_teacherPersonId'), data.teachers, 'Select a teacher...');

      setLoadingState(false);
      fieldsEl?.classList.remove('d-none');
      if (submitBtn) submitBtn.disabled = false;

      syncStartDateVisibility();
      schedulePreview();
    } catch (error) {
      setLoadingState(false);
      modal.hide();
      await showUserAlert(error.message || 'Could not open create from template.', 'Error', { icon: 'error' });
    }
  }

  global.ClassCreateFromTemplateModal = { open };
})(window);
