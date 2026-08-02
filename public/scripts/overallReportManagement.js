(() => {
  const dataEl = document.getElementById('managementData');
  if (!dataEl) return;

  let bootstrapData;
  try {
    bootstrapData = JSON.parse(dataEl.textContent || '{}');
  } catch (_) {
    bootstrapData = {};
  }

  const actionStateId = String(bootstrapData.actionStateId || '');
  const templateCatalog = new Map((bootstrapData.templates || []).map((row) => [String(row.id), row]));
  let session = bootstrapData.session ? { ...bootstrapData.session } : null;
  let selectedTemplates = (session?.selectedTemplateIds || []).map((id) => {
    const meta = templateCatalog.get(String(id)) || { id, title: id };
    return { id: String(id), title: meta.title || id };
  });
  let studentRows = (session?.rows || []).map((row) => {
    const next = {
      ...row,
      matchingTemplates: row.matchingTemplates || []
    };
    if (!next.matchingTemplates.length && next.selectedOverallTemplateId) {
      const meta = templateCatalog.get(String(next.selectedOverallTemplateId));
      if (meta) {
        next.matchingTemplates = [{
          templateId: meta.id,
          templateTitle: meta.title,
          hasOverallFields: meta.hasOverallFields,
          hasAttachedDocx: meta.hasAttachedDocx
        }];
      }
    }
    return next;
  });
  let selectedStudents = [];
  let addStudents = (session?.addFilters?.studentIds || []).map((id) => ({ id: String(id), name: String(id) }));
  let previewStudentId = '';

  const showModal = (...args) => window.ReportMessaging?.showReportModal
    ? window.ReportMessaging.showReportModal(...args)
    : Promise.resolve(alert(args[0] || 'Notice'));

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchJson(url, options = {}) {
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'x-ajax-request': 'true',
      ...(options.headers || {})
    };
    if (actionStateId) headers['x-action-state-id'] = actionStateId;
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'error') {
      throw new Error(payload.message || 'Request failed.');
    }
    return payload;
  }

  function selectedStatuses(selector) {
    return [...document.querySelectorAll(selector)]
      .filter((input) => input.checked)
      .map((input) => input.value);
  }

  function updateStudentSummary() {
    const el = document.getElementById('studentFilterSummary');
    if (!el) return;
    el.value = selectedStudents.length
      ? `${selectedStudents.length} selected`
      : 'All matching students';
  }

  function updateAddStudentSummary() {
    const el = document.getElementById('addStudentFilterSummary');
    if (!el) return;
    el.value = addStudents.length
      ? `${addStudents.length} selected`
      : 'All matching students';
  }

  function templateInUse(templateId) {
    return studentRows.some((row) => String(row.selectedOverallTemplateId || '') === String(templateId));
  }

  function renderTemplateChips() {
    const host = document.getElementById('selectedTemplateChips');
    if (!host) return;
    if (!selectedTemplates.length) {
      host.innerHTML = '<span class="text-muted small">No templates selected.</span>';
      return;
    }
    host.innerHTML = selectedTemplates.map((row) => {
      const inUse = templateInUse(row.id);
      return `<span class="badge text-bg-light border px-3 py-2 d-inline-flex align-items-center gap-2">
        <span>${escapeHtml(row.title || row.id)}</span>
        ${inUse
          ? '<span class="text-muted small">(in use)</span>'
          : `<button type="button" class="btn btn-sm btn-link p-0 js-remove-template" data-template-id="${escapeHtml(row.id)}" aria-label="Remove template">×</button>`}
      </span>`;
    }).join('');
    host.querySelectorAll('.js-remove-template').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.templateId;
        selectedTemplates = selectedTemplates.filter((row) => row.id !== id);
        renderTemplateChips();
      });
    });
  }

  function getTemplateMeta(templateId) {
    return templateCatalog.get(String(templateId)) || { id: templateId, hasOverallFields: false, hasAttachedDocx: false };
  }

  function rowSourceSelectionsComplete(row) {
    if (!row.selectedOverallTemplateId) return false;
    const template = templateCatalog.get(String(row.selectedOverallTemplateId)) || {};
    const slots = template.sourceSlots || [];
    const picks = new Map((row.sourceSelections || []).map((entry) => [entry.slotKey, entry.instanceId]));
    return slots.length > 0 && slots.every((slot) => picks.get(slot.slotKey));
  }

  function setRowSourceSelection(row, slotKey, instanceId, overallTemplateId) {
    const selections = [...(row.sourceSelections || [])].filter((entry) => entry.slotKey !== slotKey);
    if (instanceId) selections.push({ slotKey, instanceId });
    row.sourceSelections = selections;
    if (overallTemplateId) row.selectedOverallTemplateId = overallTemplateId;
  }

  function renderMatrix() {
    const body = document.getElementById('managementMatrixBody');
    if (!body) return;
    if (!studentRows.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No students loaded.</td></tr>';
      return;
    }

    body.innerHTML = studentRows.map((row) => {
      const excluded = new Set(row.excludedOverallTemplateIds || []);
      const matches = (row.matchingTemplates || []).filter((item) => !excluded.has(item.templateId));
      const selectedTemplate = row.selectedOverallTemplateId;
      const templateMeta = selectedTemplate ? getTemplateMeta(selectedTemplate) : null;
      const canCreate = Boolean(
        selectedTemplate
        && templateMeta?.hasOverallFields
        && rowSourceSelectionsComplete(row)
        && !row.overallInstanceId
      );
      const canPreview = Boolean(row.overallInstanceId && templateMeta?.hasOverallFields);
      const canExportDocx = Boolean(row.overallInstanceId && templateMeta?.hasAttachedDocx);
      const canExportPayload = Boolean(row.overallInstanceId);

      const instancesHtml = (row.instances || []).map((inst) => {
        const selected = (row.sourceSelections || []).some((entry) => (
          entry.slotKey === inst.slotKey && entry.instanceId === inst.instanceId
        ));
        return `<button type="button"
          class="btn btn-sm ${selected ? 'btn-primary' : 'btn-outline-secondary'} mb-1 me-1 js-pick-instance"
          data-student-id="${escapeHtml(row.studentId)}"
          data-slot-key="${escapeHtml(inst.slotKey)}"
          data-instance-id="${escapeHtml(inst.instanceId)}"
          data-template-id="${escapeHtml(inst.overallTemplateId || row.selectedOverallTemplateId || '')}"
          ${row.overallInstanceId ? 'disabled' : ''}>
          ${escapeHtml(inst.instanceTitle)} &mdash; ${escapeHtml(inst.sourceTemplateTitle)}
        </button>`;
      }).join('') || '<span class="text-muted small">No instances</span>';

      const matchesHtml = matches.map((match) => {
        const checked = String(selectedTemplate || '') === String(match.templateId);
        return `<div class="d-flex align-items-center gap-2 mb-1">
          <label class="form-check m-0">
            <input type="radio" class="form-check-input js-pick-overall-template"
              name="overallTemplate_${escapeHtml(row.studentId)}"
              value="${escapeHtml(match.templateId)}"
              ${checked ? 'checked' : ''}
              ${row.overallInstanceId ? 'disabled' : ''}>
            <span class="form-check-label">${escapeHtml(match.templateTitle || match.templateId)}</span>
          </label>
          <button type="button" class="btn btn-link btn-sm p-0 js-unselect-template"
            data-student-id="${escapeHtml(row.studentId)}"
            data-template-id="${escapeHtml(match.templateId)}"
            ${row.overallInstanceId ? 'disabled' : ''}>Unselect</button>
        </div>`;
      }).join('') || '<span class="text-muted small">No matching templates</span>';

      return `<tr data-student-id="${escapeHtml(row.studentId)}">
        <td class="ps-3">
          <div class="fw-semibold">${escapeHtml(row.studentName || row.studentId)}</div>
          <div class="small text-muted font-monospace">${escapeHtml(row.studentId)}</div>
        </td>
        <td>${instancesHtml}</td>
        <td>${matchesHtml}</td>
        <td>
          <div class="d-flex flex-wrap gap-1">
            <button type="button" class="btn btn-outline-success btn-sm js-create-row"
              data-student-id="${escapeHtml(row.studentId)}"
              ${canCreate ? '' : 'disabled'}>Create</button>
            <button type="button" class="btn btn-outline-primary btn-sm js-preview-row"
              data-student-id="${escapeHtml(row.studentId)}"
              ${canPreview ? '' : 'disabled'}>Preview</button>
          </div>
        </td>
        <td class="pe-3">
          <div class="d-flex flex-wrap gap-1">
            <button type="button" class="btn btn-outline-primary btn-sm js-export-docx"
              data-student-id="${escapeHtml(row.studentId)}"
              ${canExportDocx ? '' : 'disabled'}>Export DOCX</button>
            <a class="btn btn-outline-secondary btn-sm ${canExportPayload ? '' : 'disabled'}"
              href="${canExportPayload && session?.id
    ? `/school/reports/overall-management/edit/${encodeURIComponent(session.id)}/row/${encodeURIComponent(row.studentId)}/export-payload?download=1`
    : '#'}"
              ${canExportPayload ? '' : 'tabindex="-1" aria-disabled="true"'}>Export Payload</a>
          </div>
        </td>
      </tr>`;
    }).join('');

    bindMatrixEvents();
  }

  function bindMatrixEvents() {
    document.querySelectorAll('.js-pick-instance').forEach((btn) => {
      btn.addEventListener('click', () => {
        const studentId = btn.dataset.studentId;
        const row = studentRows.find((entry) => entry.studentId === studentId);
        if (!row || row.overallInstanceId) return;
        setRowSourceSelection(
          row,
          btn.dataset.slotKey,
          btn.dataset.instanceId,
          btn.dataset.templateId || row.selectedOverallTemplateId
        );
        renderMatrix();
      });
    });

    document.querySelectorAll('.js-pick-overall-template').forEach((input) => {
      input.addEventListener('change', () => {
        const studentId = input.name.replace('overallTemplate_', '');
        const row = studentRows.find((entry) => entry.studentId === studentId);
        if (!row || row.overallInstanceId) return;
        row.selectedOverallTemplateId = input.value;
        row.excludedOverallTemplateIds = (row.excludedOverallTemplateIds || [])
          .filter((id) => id !== input.value);
        const template = getTemplateMeta(input.value);
        const defaultSelections = {};
        (row.instances || []).filter((inst) => String(inst.overallTemplateId || '') === String(input.value))
          .forEach((inst) => {
            const slotRows = (row.instances || []).filter((item) => (
              item.slotKey === inst.slotKey
              && String(item.overallTemplateId || '') === String(input.value)
            ));
            if (slotRows.length === 1) defaultSelections[inst.slotKey] = inst.instanceId;
          });
        row.sourceSelections = Object.entries(defaultSelections).map(([slotKey, instanceId]) => ({ slotKey, instanceId }));
        renderMatrix();
      });
    });

    document.querySelectorAll('.js-unselect-template').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = studentRows.find((entry) => entry.studentId === btn.dataset.studentId);
        if (!row || row.overallInstanceId) return;
        const templateId = btn.dataset.templateId;
        row.excludedOverallTemplateIds = [...new Set([...(row.excludedOverallTemplateIds || []), templateId])];
        if (String(row.selectedOverallTemplateId || '') === String(templateId)) {
          row.selectedOverallTemplateId = null;
          row.sourceSelections = [];
        }
        renderMatrix();
      });
    });

    document.querySelectorAll('.js-create-row').forEach((btn) => {
      btn.addEventListener('click', () => createRow(btn.dataset.studentId));
    });
    document.querySelectorAll('.js-preview-row').forEach((btn) => {
      btn.addEventListener('click', () => openPreview(btn.dataset.studentId));
    });
    document.querySelectorAll('.js-export-docx').forEach((btn) => {
      btn.addEventListener('click', () => exportDocx(btn.dataset.studentId));
    });
  }

  function openTemplatePicker() {
    if (!window.GenericPicker) {
      showModal('Picker Unavailable', 'The searchable picker could not be loaded.', 'error');
      return;
    }
    const config = {
      title: 'Select Overall Templates',
      icon: 'bi-files',
      placeholder: 'Search overall templates...',
      sourceMode: 'remote',
      apiEndpoint: '/school/reports/overall-templates',
      searchFields: 'id,title,status,description',
      multiselect: true,
      limit: 200,
      selectedItems: selectedTemplates,
      renderer: (item) => `<div><strong>${escapeHtml(item.title || item.id)}</strong>
        <span class="badge bg-light text-dark border ms-1">${escapeHtml(item.status || '')}</span>
        <div class="small text-muted font-monospace">${escapeHtml(item.id)}</div></div>`,
      onSelect: (items) => {
        const next = (Array.isArray(items) ? items : [items]).map((item) => ({
          id: String(item.id || '').trim(),
          title: String(item.title || item.id || '').trim()
        })).filter((item) => item.id);
        selectedTemplates = next;
        renderTemplateChips();
      }
    };
    window.GenericPicker.open(
      window.GenericPickerPresets?.normalizeConfig
        ? window.GenericPickerPresets.normalizeConfig(config)
        : config
    );
  }

  function openStudentPicker(target) {
    if (!window.GenericPicker || !window.GenericPickerPresets) {
      showModal('Picker Unavailable', 'The student picker could not be loaded.', 'error');
      return;
    }
    const current = target === 'add' ? addStudents : selectedStudents;
    window.GenericPicker.open(window.GenericPickerPresets.student({
      title: target === 'add' ? 'Filter Students to Add' : 'Select Students',
      multiselect: true,
      selectedItems: current,
      onSelect: (items) => {
        const mapped = (Array.isArray(items) ? items : [items]).map((item) => ({
          id: String(item.id || '').trim(),
          name: String(item.name || item.title || item.id || '').trim()
        })).filter((item) => item.id);
        if (target === 'add') {
          addStudents = mapped;
          updateAddStudentSummary();
        } else {
          selectedStudents = mapped;
          updateStudentSummary();
        }
      }
    }));
  }

  async function loadMatrix() {
    if (!selectedTemplates.length) {
      await showModal('Templates Required', 'Select at least one overall report template.');
      return;
    }
    const startDate = document.getElementById('filterStartDate')?.value || '';
    const endDate = document.getElementById('filterEndDate')?.value || '';
    if (!startDate || !endDate) {
      await showModal('Dates Required', 'Enter a start and end date.');
      return;
    }
    try {
      if (typeof showLoading === 'function') showLoading({ note: 'Loading students...' });
      const body = new URLSearchParams();
      selectedTemplates.forEach((row) => body.append('templateIds', row.id));
      body.set('startDate', startDate);
      body.set('endDate', endDate);
      body.set('studentIds', selectedStudents.map((row) => row.id).join(','));
      body.set('statuses', selectedStatuses('.js-status-filter').join(','));
      body.set('actionStateId', actionStateId);
      const payload = await fetchJson('/school/reports/overall-management/api/load-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body
      });
      (payload.templates || []).forEach((row) => templateCatalog.set(String(row.id), row));
      studentRows = (payload.students || []).map((row) => ({ ...row }));
      renderMatrix();
      if (!studentRows.length) {
        await showModal('No Matches', 'No student report instances matched the selected filters.', 'info');
      }
    } catch (error) {
      await showModal('Load Failed', error.message || 'Unable to load matrix.', 'error');
    } finally {
      if (typeof hideLoading === 'function') hideLoading({ force: true });
    }
  }

  async function persistSession({ quiet = false } = {}) {
    const title = document.getElementById('sessionTitle')?.value || '';
    const startDate = document.getElementById('filterStartDate')?.value || session?.startDate || '';
    const endDate = document.getElementById('filterEndDate')?.value || session?.endDate || '';
    if (!studentRows.length) {
      if (!quiet) await showModal('Students Required', 'Load or add at least one student before saving.');
      return false;
    }
    const body = new URLSearchParams();
    if (session?.id) body.set('id', session.id);
    body.set('title', title);
    body.set('startDate', startDate);
    body.set('endDate', endDate);
    selectedTemplates.forEach((row) => body.append('selectedTemplateIds', row.id));
    body.set('rowsJson', JSON.stringify(studentRows));
    body.set('addFiltersJson', JSON.stringify({
      studentIds: addStudents.map((row) => row.id),
      statuses: selectedStatuses('.js-add-status-filter').length
        ? selectedStatuses('.js-add-status-filter')
        : selectedStatuses('.js-status-filter')
    }));
    body.set('actionStateId', actionStateId);
    const payload = await fetchJson('/school/reports/overall-management/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });
    session = payload.session;
    if (payload.redirect && !window.location.pathname.includes('/edit/')) {
      window.location.assign(payload.redirect);
      return true;
    }
    if (!quiet) await showModal('Saved', payload.message || 'Session saved.', 'success');
    return true;
  }

  async function saveSession() {
    try {
      if (typeof showLoading === 'function') showLoading({ note: 'Saving session...' });
      await persistSession();
    } catch (error) {
      await showModal('Save Failed', error.message || 'Unable to save session.', 'error');
    } finally {
      if (typeof hideLoading === 'function') hideLoading({ force: true });
    }
  }

  async function addStudentsAction() {
    if (!session?.id) {
      await showModal('Save Required', 'Save the session before adding students.');
      return;
    }
    try {
      if (typeof showLoading === 'function') showLoading({ note: 'Adding students...' });
      const body = new URLSearchParams();
      body.set('studentIds', addStudents.map((row) => row.id).join(','));
      body.set('statuses', selectedStatuses('.js-add-status-filter').join(','));
      body.set('actionStateId', actionStateId);
      const payload = await fetchJson(`/school/reports/overall-management/edit/${encodeURIComponent(session.id)}/add-students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body
      });
      session = payload.session;
      studentRows = (payload.session?.rows || []).map((row) => ({ ...row }));
      renderMatrix();
      await showModal('Students Added', payload.message || 'Students added.', 'success');
    } catch (error) {
      await showModal('Add Failed', error.message || 'Unable to add students.', 'error');
    } finally {
      if (typeof hideLoading === 'function') hideLoading({ force: true });
    }
  }

  async function createRow(studentId) {
    try {
      if (typeof showLoading === 'function') showLoading({ note: 'Creating overall report...' });
      const saved = await persistSession({ quiet: true });
      if (!saved || !session?.id) return;
      const body = new URLSearchParams();
      body.set('actionStateId', actionStateId);
      const payload = await fetchJson(
        `/school/reports/overall-management/edit/${encodeURIComponent(session.id)}/row/${encodeURIComponent(studentId)}/create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body
        }
      );
      session = payload.session;
      studentRows = (payload.session?.rows || studentRows).map((row) => ({ ...row }));
      renderMatrix();
      await showModal('Created', payload.message || 'Overall report created.', 'success');
    } catch (error) {
      await showModal('Create Failed', error.message || 'Unable to create overall report.', 'error');
    } finally {
      if (typeof hideLoading === 'function') hideLoading({ force: true });
    }
  }

  async function openPreview(studentId) {
    if (!session?.id) return;
    try {
      const payload = await fetchJson(
        `/school/reports/overall-management/edit/${encodeURIComponent(session.id)}/row/${encodeURIComponent(studentId)}/preview`
      );
      previewStudentId = studentId;
      document.getElementById('studentPreviewTitle').textContent = `Preview · ${payload.studentName || studentId}`;
      document.getElementById('studentPreviewBody').innerHTML = (payload.fields || []).map((field) => `
        <div class="mb-3">
          <label class="form-label fw-semibold">${escapeHtml(field.label)}
            <span class="badge bg-light text-dark border ms-1">${escapeHtml(field.overallValueMode)}</span>
          </label>
          <input class="form-control js-preview-field" data-field-id="${escapeHtml(field.id)}"
            value="${escapeHtml(field.value ?? '')}"
            ${!field.editable ? 'readonly' : ''}>
          ${field.helpText ? `<div class="form-text">${escapeHtml(field.helpText)}</div>` : ''}
        </div>
      `).join('') || '<div class="text-muted">No overall fields are defined on this template.</div>';
      const modalEl = document.getElementById('studentPreviewModal');
      if (window.bootstrap?.Modal && modalEl) window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (error) {
      await showModal('Preview Failed', error.message || 'Unable to open preview.', 'error');
    }
  }

  async function savePreviewAnswers() {
    if (!session?.id || !previewStudentId) return;
    const answers = {};
    document.querySelectorAll('.js-preview-field').forEach((input) => {
      answers[input.dataset.fieldId] = input.value;
    });
    try {
      const body = new URLSearchParams();
      body.set('answersJson', JSON.stringify(answers));
      body.set('actionStateId', actionStateId);
      await fetchJson(
        `/school/reports/overall-management/edit/${encodeURIComponent(session.id)}/row/${encodeURIComponent(previewStudentId)}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body
        }
      );
      await showModal('Saved', 'Student answers saved.', 'success');
    } catch (error) {
      await showModal('Save Failed', error.message || 'Unable to save answers.', 'error');
    }
  }

  async function exportDocx(studentId) {
    if (!session?.id) return;
    try {
      if (typeof showLoading === 'function') showLoading({ note: 'Exporting DOCX...' });
      const body = new URLSearchParams();
      body.set('actionStateId', actionStateId);
      const response = await fetch(
        `/school/reports/overall-management/edit/${encodeURIComponent(session.id)}/row/${encodeURIComponent(studentId)}/export-docx`,
        {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'x-ajax-request': 'true',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            ...(actionStateId ? { 'x-action-state-id': actionStateId } : {})
          },
          body,
          credentials: 'same-origin'
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Export failed.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = match?.[1] || 'overall-export.docx';
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      await showModal('Export Failed', error.message || 'Unable to export DOCX.', 'error');
    } finally {
      if (typeof hideLoading === 'function') hideLoading({ force: true });
    }
  }

  document.getElementById('btnPickTemplates')?.addEventListener('click', openTemplatePicker);
  document.getElementById('btnPickStudents')?.addEventListener('click', () => openStudentPicker('load'));
  document.getElementById('btnClearStudents')?.addEventListener('click', () => {
    selectedStudents = [];
    updateStudentSummary();
  });
  document.getElementById('btnPickAddStudents')?.addEventListener('click', () => openStudentPicker('add'));
  document.getElementById('btnClearAddStudents')?.addEventListener('click', () => {
    addStudents = [];
    updateAddStudentSummary();
  });
  document.getElementById('btnLoadMatrix')?.addEventListener('click', loadMatrix);
  document.getElementById('btnSaveSession')?.addEventListener('click', saveSession);
  document.getElementById('btnAddStudents')?.addEventListener('click', addStudentsAction);
  document.getElementById('btnSaveStudentPreview')?.addEventListener('click', savePreviewAnswers);

  renderTemplateChips();
  updateStudentSummary();
  updateAddStudentSummary();
  if (studentRows.length) renderMatrix();
})();
