(function (global) {
  'use strict';

  const CANONICAL_SCOPES = ['class', 'each_student', 'selected_students'];
  const SCOPE_LABELS = {
    class: 'Whole Class',
    each_student: 'Each Student',
    selected_students: 'Specific Students'
  };

  function normalizeSessionReportTemplateScopes(value) {
    if (!Array.isArray(value)) return [...CANONICAL_SCOPES];
    const selected = new Set(value.map((scope) => String(scope || '').trim().toLowerCase()));
    return CANONICAL_SCOPES.filter((scope) => selected.has(scope));
  }

  function isSessionReportStudentScoped(scope) {
    const token = String(scope || '').trim().toLowerCase();
    return token === 'each_student' || token === 'selected_students';
  }

  function filterActiveReportTemplates(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const status = String(row?.status || '').trim().toLowerCase();
      return status === 'active' && String(row?.id || '').trim();
    });
  }

  function normalizeTemplateTargetDepartmentIds(template) {
    const ids = Array.isArray(template?.targetDepartmentIds) ? template.targetDepartmentIds : [];
    return ids.map((id) => String(id || '').trim()).filter(Boolean);
  }

  function templateMatchesDeliveryDepartment(template, deliveryDepartmentId) {
    const targets = normalizeTemplateTargetDepartmentIds(template);
    if (!targets.length) return true;
    const deptId = String(deliveryDepartmentId || '').trim();
    if (!deptId) return false;
    return targets.some((id) => id === deptId);
  }

  function filterTemplatesForDeliveryDepartment(templates, deliveryDepartmentId, options = {}) {
    const alwaysIncludeTemplateId = String(options.alwaysIncludeTemplateId || '').trim();
    return (Array.isArray(templates) ? templates : []).filter((row) => {
      const rowId = String(row?.id || '').trim();
      if (alwaysIncludeTemplateId && rowId === alwaysIncludeTemplateId) return true;
      return templateMatchesDeliveryDepartment(row, deliveryDepartmentId);
    });
  }

  function formatReportTemplateOptionLabel(template) {
    const title = String(template?.title || template?.id || 'Template').trim();
    const version = Number(template?.version || 1);
    const type = String(template?.type || '').trim();
    const typePart = type ? ` · ${type}` : '';
    return `${title} (v${version})${typePart}`;
  }

  function buildExistingReportDisplayRows({ instanceRows = [], embeddedReports = [] } = {}) {
    const output = [];
    const seen = new Set();
    (Array.isArray(instanceRows) ? instanceRows : []).forEach((row) => {
      const title = String(row?.templateTitle || row?.title || 'Report').trim();
      const student = String(row?.studentName || row?.studentId || '').trim();
      const scope = String(row?.scopeLabel || row?.scope || '').trim();
      const status = String(row?.statusLabel || row?.status || '—').trim();
      const key = `inst:${title}|${student}|${status}`;
      if (seen.has(key)) return;
      seen.add(key);
      output.push({
        title,
        detail: student || scope || '—',
        status
      });
    });
    (Array.isArray(embeddedReports) ? embeddedReports : []).forEach((report) => {
      const title = String(report?.title || report?.className || report?.templateTitle || 'Report').trim();
      const time = [report?.start, report?.end].filter(Boolean).join('–');
      const key = `emb:${title}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);
      output.push({
        title,
        detail: time ? `Scheduled ${time}` : 'On session',
        status: String(report?.status || 'scheduled').trim()
      });
    });
    return output;
  }

  function installSessionReportAssignmentClient(deps = {}) {
    const escapeHtml = typeof deps.escapeHtml === 'function'
      ? deps.escapeHtml
      : (value) => String(value ?? '');
    const showMessage = typeof deps.showMessage === 'function'
      ? deps.showMessage
      : async (title, message) => { window.alert(`${title}: ${message}`); };

    let ctx = {};
    let actionStateId = String(deps.initialActionStateId || '').trim();
    let assignmentModalInstance = null;
    let selectedStudents = new Map();
    let selectedTemplateScopes = [];
    let templateCatalog = new Map();
    let pickerEligibleStudents = [];
    let pickerSelectedIds = [];
    let isLoadingPickerStudents = false;
    let saving = false;
    let opening = false;
    let eventsBound = false;
    let startDateUserEdited = false;
    let lastAutoSuggestedStartDate = '';

    function getModal() {
      const modal = document.getElementById('sessionReportAssignmentModal');
      if (modal && global.bootstrap && !assignmentModalInstance) {
        assignmentModalInstance = global.bootstrap.Modal.getOrCreateInstance(modal);
      }
      return modal;
    }

    function getStudentPickerModal() {
      const el = document.getElementById('sessionReportStudentPickerModal');
      if (!el || !global.bootstrap?.Modal) return null;
      return global.bootstrap.Modal.getOrCreateInstance(el);
    }

    function setModalLoading(isLoading) {
      const modal = getModal();
      if (!modal) return;
      modal.querySelector('#sessionReportAssignmentLoading')?.classList.toggle('d-none', !isLoading);
      modal.querySelector('#sessionReportAssignmentFormWrap')?.classList.toggle('d-none', isLoading);
      const saveBtn = modal.querySelector('#btnSaveSessionReportAssignment');
      if (saveBtn) saveBtn.disabled = isLoading || saving;
    }

    function parseTimeToMinutes(value) {
      const token = String(value || '').trim();
      if (!/^\d{2}:\d{2}$/.test(token)) return null;
      const parts = token.split(':').map(Number);
      if (!Number.isInteger(parts[0]) || !Number.isInteger(parts[1])) return null;
      return (parts[0] * 60) + parts[1];
    }

    function applyTimeConstraints(modal) {
      if (!modal || !ctx.sessionDate) return;
      const startDate = modal.querySelector('#sessionReportStartDate');
      const taskStart = modal.querySelector('#sessionReportTaskStart');
      const taskEnd = modal.querySelector('#sessionReportTaskEnd');
      if (startDate) startDate.max = ctx.sessionDate;
      if (taskStart && ctx.startTime) {
        taskStart.min = ctx.startTime;
        if (ctx.endTime) taskStart.max = ctx.endTime;
      }
      if (taskEnd && ctx.startTime) {
        taskEnd.min = ctx.startTime;
        if (ctx.endTime) taskEnd.max = ctx.endTime;
      }
    }

    function calculateAllocatedHours(modal) {
      const start = parseTimeToMinutes(modal.querySelector('#sessionReportTaskStart')?.value || '');
      const end = parseTimeToMinutes(modal.querySelector('#sessionReportTaskEnd')?.value || '');
      if (start === null || end === null || end <= start) return 0;
      return Math.round(((end - start) / 60) * 100) / 100;
    }

    function syncAllocatedHours(force = false) {
      const modal = getModal();
      if (!modal) return;
      const reflect = modal.querySelector('#sessionReportTimesheetReflection')?.checked === true;
      const input = modal.querySelector('#sessionReportAllocatedHours');
      if (!input) return;
      input.disabled = !reflect;
      if (reflect && (force || !Number(input.value || 0))) {
        input.value = String(calculateAllocatedHours(modal) || 0);
      }
      if (!reflect) input.value = '0';
    }

    function renderSelectedStudents() {
      const modal = getModal();
      if (!modal) return;
      const rows = Array.from(selectedStudents.values());
      const summary = modal.querySelector('#sessionReportStudentSummary');
      const chips = modal.querySelector('#sessionReportSelectedStudents');
      if (summary) {
        summary.value = rows.length
          ? `${rows.length} ${rows.length === 1 ? 'student' : 'students'} selected`
          : '';
      }
      if (chips) {
        chips.innerHTML = rows.length
          ? rows.map((row) => `<span class="badge bg-light text-dark border">${escapeHtml(row.name || row.id)}</span>`).join('')
          : '<span class="small text-muted">No specific students selected.</span>';
      }
    }

    function syncScope() {
      const modal = getModal();
      if (!modal) return;
      const scope = String(modal.querySelector('#sessionReportScope')?.value || 'class').trim();
      const wrap = modal.querySelector('#sessionReportSpecificStudentsWrap');
      const hint = modal.querySelector('#sessionReportStudentHint');
      const wrapVisible = isSessionReportStudentScoped(scope);
      if (wrap) wrap.classList.toggle('d-none', !wrapVisible);
      if (hint) {
        hint.textContent = scope === 'each_student'
          ? 'All enrollment-eligible students are selected by default. Use Pick Students to review or exclude students.'
          : 'Pick one or more students enrolled for this report period.';
      }
    }

    function applyTemplateScopePolicy() {
      const modal = getModal();
      if (!modal) return;
      const scopeSelect = modal.querySelector('#sessionReportScope');
      const help = modal.querySelector('#sessionReportScopeHelp');
      const templateSelect = modal.querySelector('#sessionReportTemplateId');
      if (!scopeSelect || !templateSelect) return;
      const templateId = String(templateSelect.value || '').trim();
      const hasTemplate = Boolean(templateId);
      const templateMeta = templateCatalog.get(templateId);
      const allowedScopes = hasTemplate
        ? normalizeSessionReportTemplateScopes(templateMeta?.allowedReportScopes || selectedTemplateScopes)
        : [];
      scopeSelect.disabled = !hasTemplate;
      Array.from(scopeSelect.options).forEach((option) => {
        const value = String(option.value || '').trim();
        if (!value) return;
        option.disabled = !hasTemplate || !allowedScopes.includes(value);
      });
      const currentScope = String(scopeSelect.value || '').trim().toLowerCase();
      if (hasTemplate && !allowedScopes.includes(currentScope)) {
        scopeSelect.value = allowedScopes.length === 1 ? allowedScopes[0] : '';
      }
      if (help) {
        help.textContent = !hasTemplate
          ? 'Select a template to see its approved report scopes.'
          : `Approved by this template: ${allowedScopes.map((scope) => SCOPE_LABELS[scope] || scope).join(', ')}.`;
      }
      syncScope();
    }

    async function applySuggestedStartDate() {
      const modal = getModal();
      if (!modal) return;
      const startInput = modal.querySelector('#sessionReportStartDate');
      const hintEl = modal.querySelector('#sessionReportStartDateHint');
      const sessionDate = String(ctx.sessionDate || '').trim();
      if (!startInput || !sessionDate) return;
      const templateId = String(modal.querySelector('#sessionReportTemplateId')?.value || '').trim();
      const templateMeta = templateCatalog.get(templateId) || {};
      if (!templateId) {
        if (hintEl) hintEl.textContent = '';
        return;
      }
      const reportScope = String(modal.querySelector('#sessionReportScope')?.value || 'class').trim();
      const targetStudentIds = Array.from(selectedStudents.keys());
      const resolveFn = typeof global.resolveSuggestedReportStartDate === 'function'
        ? global.resolveSuggestedReportStartDate
        : null;
      let suggestedStartDate = '';
      let hint = '';
      if (resolveFn) {
        const result = await resolveFn({
          template: templateMeta,
          sessionDate,
          classId: ctx.classId,
          templateId,
          reportScope,
          targetStudentIds
        });
        suggestedStartDate = String(result?.suggestedStartDate || '').trim();
        hint = String(result?.hint || '').trim();
      } else if (typeof global.computeSuggestedReportStartDateSync === 'function') {
        suggestedStartDate = global.computeSuggestedReportStartDateSync({
          reportPeriodBase: templateMeta.reportPeriodBase,
          reportPeriodOffset: templateMeta.reportPeriodOffset,
          sessionDate
        });
        hint = typeof global.buildSuggestionHint === 'function' ? global.buildSuggestionHint(templateMeta) : '';
      }
      const current = String(startInput.value || '').trim();
      if (suggestedStartDate && (!startDateUserEdited || !current || current === lastAutoSuggestedStartDate)) {
        startInput.value = suggestedStartDate;
        lastAutoSuggestedStartDate = suggestedStartDate;
      }
      if (hintEl) hintEl.textContent = hint;
    }

    function onTemplateSelectionChanged() {
      const modal = getModal();
      if (!modal) return;
      const templateSelect = modal.querySelector('#sessionReportTemplateId');
      const templateId = String(templateSelect?.value || '').trim();
      const templateMeta = templateCatalog.get(templateId);
      selectedTemplateScopes = normalizeSessionReportTemplateScopes(templateMeta?.allowedReportScopes);
      const conductRequired = templateMeta?.conductRequiredBeforeFill !== false;
      const conductCheckbox = modal.querySelector('#sessionReportConductRequiredBeforeFill');
      if (conductCheckbox && templateMeta) conductCheckbox.checked = conductRequired;
      applyTemplateScopePolicy();
      applySuggestedStartDate().catch(() => {});
    }

    function populateTemplateSelect(templates) {
      const modal = getModal();
      if (!modal) return;
      const select = modal.querySelector('#sessionReportTemplateId');
      if (!select) return;
      const active = filterActiveReportTemplates(templates)
        .sort((a, b) => formatReportTemplateOptionLabel(a).localeCompare(formatReportTemplateOptionLabel(b)));
      templateCatalog = new Map(active.map((row) => [String(row.id).trim(), row]));
      if (!active.length) {
        select.innerHTML = '<option value="">No active templates</option>';
        select.disabled = true;
        return;
      }
      select.disabled = false;
      select.innerHTML = [
        '<option value="">Select a template…</option>',
        ...active.map((row) => {
          const id = String(row.id).trim();
          const label = escapeHtml(formatReportTemplateOptionLabel(row));
          return `<option value="${escapeHtml(id)}">${label}</option>`;
        })
      ].join('');
    }

    function renderExistingReports(instanceRows, embeddedReports) {
      const section = document.getElementById('sessionReportExistingReportsSection');
      const body = document.getElementById('sessionReportExistingReportsBody');
      if (!section || !body) return;
      const rows = buildExistingReportDisplayRows({ instanceRows, embeddedReports });
      if (!rows.length) {
        section.classList.add('d-none');
        body.innerHTML = '';
        return;
      }
      section.classList.remove('d-none');
      body.innerHTML = rows.map((row) => `
        <tr>
          <td class="fw-semibold">${escapeHtml(row.title)}</td>
          <td class="small text-muted">${escapeHtml(row.detail || '—')}</td>
          <td><span class="badge bg-light text-dark border text-capitalize">${escapeHtml(row.status || '—')}</span></td>
        </tr>
      `).join('');
    }

    async function fetchActiveReportTemplates(context = {}) {
      const classId = String(context?.classId || '').trim();
      const params = new URLSearchParams({ limit: '1000' });
      if (classId) params.set('classId', classId);
      const res = await fetch(`/school/reports/templates?${params.toString()}`, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-AJAX-Request': 'true'
        }
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.status === 'error') {
        throw new Error(payload?.message || 'Unable to load report templates.');
      }
      return filterActiveReportTemplates(payload.results);
    }

    async function fetchReportInstancesForSession(context) {
      const classId = String(context?.classId || '').trim();
      const sessionId = String(context?.sessionId || '').trim();
      const sessionDate = String(context?.sessionDate || '').trim();
      if (!classId || !sessionId) return [];
      const qs = sessionDate ? `?sessionDate=${encodeURIComponent(sessionDate)}` : '';
      const res = await fetch(`/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}/report-instances${qs}`, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'x-ajax-request': 'true'
        }
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.status !== 'success') return [];
      return Array.isArray(payload.rows) ? payload.rows : [];
    }

    function renderStudentPickerTable() {
      const rows = Array.isArray(pickerEligibleStudents) ? pickerEligibleStudents : [];
      const body = document.getElementById('sessionReportStudentPickerBody');
      const emptyEl = document.getElementById('sessionReportStudentPickerEmpty');
      const selectAll = document.getElementById('sessionReportStudentPickerSelectAll');
      const summary = document.getElementById('sessionReportStudentPickerSummary');
      const selectedSet = new Set(pickerSelectedIds);
      if (!rows.length) {
        if (body) body.innerHTML = '';
        emptyEl?.classList.remove('d-none');
        if (summary) summary.textContent = '';
        if (selectAll) selectAll.checked = false;
        return;
      }
      emptyEl?.classList.add('d-none');
      if (body) {
        body.innerHTML = rows.map((student) => {
          const id = String(student?.id || student?.personId || '').trim();
          const name = String(student?.name || id).trim();
          const count = Number(student?.eligibleSessionCount || 0);
          const checked = selectedSet.has(id);
          return `<tr>
            <td><input type="checkbox" class="form-check-input js-session-report-student-picker-check" data-student-id="${escapeHtml(id)}" ${checked ? 'checked' : ''}></td>
            <td>${escapeHtml(name)}</td>
            <td class="text-end">${count}</td>
          </tr>`;
        }).join('');
      }
      const selectedCount = rows.filter((student) => selectedSet.has(String(student?.id || student?.personId || '').trim())).length;
      if (summary) summary.textContent = `${selectedCount} of ${rows.length} selected`;
      if (selectAll) selectAll.checked = selectedCount === rows.length && rows.length > 0;
    }

    function buildTargetRowDraft(modal) {
      const sessionId = String(ctx.sessionId || '').trim();
      const reportStartDate = String(modal.querySelector('#sessionReportStartDate')?.value || '').trim();
      const reportDueDate = String(modal.querySelector('#sessionReportDueDate')?.value || '').trim();
      const taskStartTime = String(modal.querySelector('#sessionReportTaskStart')?.value || '').trim();
      const taskEndTime = String(modal.querySelector('#sessionReportTaskEnd')?.value || '').trim();
      const reportScope = String(modal.querySelector('#sessionReportScope')?.value || 'class').trim();
      const conflictPermitted = modal.querySelector('#sessionReportConflictPermitted')?.checked === true;
      const timesheetReflection = modal.querySelector('#sessionReportTimesheetReflection')?.checked === true;
      const conductRequiredBeforeFill = modal.querySelector('#sessionReportConductRequiredBeforeFill')?.checked !== false;
      const allocatedHours = Number(modal.querySelector('#sessionReportAllocatedHours')?.value || 0) || 0;
      const notes = String(modal.querySelector('#sessionReportNotes')?.value || '').trim();
      const targetStudentIds = Array.from(selectedStudents.keys());
      const rowId = sessionId && reportStartDate ? `session:${sessionId}:${reportStartDate}` : '';
      const studentScoped = isSessionReportStudentScoped(reportScope);
      return {
        rowId,
        targetType: 'session',
        sessionId,
        sessionDate: ctx.sessionDate || '',
        dueDate: '',
        reportStartDate,
        reportDueDate,
        taskStartTime,
        taskEndTime,
        conflictPermitted,
        timesheetReflection,
        allocatedHours,
        conductRequiredBeforeFill,
        teacherId: ctx.teacherId || '',
        status: 'active',
        notes,
        ...(studentScoped && targetStudentIds.length ? { targetStudentIds } : {})
      };
    }

    async function fetchEligibleStudents(options = {}) {
      const { autoSelectAll = false } = options;
      const modal = getModal();
      if (!modal) return [];
      const classId = String(ctx.classId || '').trim();
      const startDate = String(modal.querySelector('#sessionReportStartDate')?.value || '').trim();
      const endDate = String(modal.querySelector('#sessionReportDueDate')?.value || '').trim();
      if (!classId) throw new Error('Class is required.');
      if (!startDate || !endDate) throw new Error('Set report start and due dates first.');
      const rowDraft = buildTargetRowDraft(modal);
      const response = await fetch('/school/reports/assignments/eligible-students', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-AJAX-Request': 'true'
        },
        body: JSON.stringify({
          classId,
          startDate,
          endDate,
          targetRows: [rowDraft]
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.message || 'Unable to load eligible students.');
      }
      const students = Array.isArray(payload.students) ? payload.students : [];
      pickerEligibleStudents = students.map((student) => ({
        id: String(student?.id || student?.personId || '').trim(),
        personId: String(student?.id || student?.personId || '').trim(),
        name: String(student?.name || '').trim(),
        eligibleSessionCount: Number(student?.eligibleSessionCount || 0)
      })).filter((student) => Boolean(student.id));
      const eligibleIds = pickerEligibleStudents.map((student) => student.id);
      const previousSelection = new Set(pickerSelectedIds.length
        ? pickerSelectedIds
        : Array.from(selectedStudents.keys()));
      if (autoSelectAll || !previousSelection.size) {
        pickerSelectedIds = [...eligibleIds];
      } else {
        pickerSelectedIds = eligibleIds.filter((id) => previousSelection.has(id));
      }
      renderStudentPickerTable();
      return pickerEligibleStudents;
    }

    function applyStudentPickerSelection() {
      const itemMap = new Map(pickerEligibleStudents.map((row) => [row.id, row]));
      selectedStudents = new Map();
      pickerSelectedIds.forEach((id) => {
        if (itemMap.has(id)) selectedStudents.set(id, itemMap.get(id));
      });
      renderSelectedStudents();
      applySuggestedStartDate().catch(() => {});
    }

    function applyFormDefaults() {
      const modal = getModal();
      if (!modal) return;
      startDateUserEdited = false;
      lastAutoSuggestedStartDate = '';
      selectedStudents = new Map();
      selectedTemplateScopes = [];
      const templateSelect = modal.querySelector('#sessionReportTemplateId');
      if (templateSelect) templateSelect.value = '';
      modal.querySelector('#sessionReportScope').value = 'class';
      modal.querySelector('#sessionReportStartDate').value = ctx.sessionDate || '';
      modal.querySelector('#sessionReportDueDate').value = ctx.sessionDate || '';
      modal.querySelector('#sessionReportTaskStart').value = ctx.startTime || '';
      modal.querySelector('#sessionReportTaskEnd').value = ctx.endTime || '';
      modal.querySelector('#sessionReportConflictPermitted').checked = true;
      modal.querySelector('#sessionReportTimesheetReflection').checked = false;
      modal.querySelector('#sessionReportConductRequiredBeforeFill').checked = true;
      modal.querySelector('#sessionReportAllocatedHours').value = '0';
      modal.querySelector('#sessionReportNotes').value = '';
      applyTimeConstraints(modal);
      const teacherLabel = ctx.teacherName || ctx.teacherId || 'No teacher assigned';
      const subtitle = document.getElementById('sessionReportAssignmentModalSubtitle');
      if (subtitle) {
        const classTitle = String(ctx.classTitle || ctx.classId || 'Class').trim();
        const when = [ctx.sessionDate, [ctx.startTime, ctx.endTime].filter(Boolean).join('–')].filter(Boolean).join(' · ');
        subtitle.textContent = when ? `${classTitle} · ${when}` : classTitle;
      }
      const contextHtml = typeof deps.buildContextHtml === 'function'
        ? deps.buildContextHtml(ctx, escapeHtml)
        : [
          `<strong>Class:</strong> ${escapeHtml(ctx.classTitle || ctx.classId || '')}`,
          `<strong>Session:</strong> ${escapeHtml(ctx.sessionDate || ctx.sessionId || '')} ${escapeHtml(ctx.startTime || '')}-${escapeHtml(ctx.endTime || '')}`,
          `<strong>Teacher:</strong> ${escapeHtml(teacherLabel)}`,
          '<strong>Target mode:</strong> Session'
        ].join('<br>');
      modal.querySelector('#sessionReportAssignmentContext').innerHTML = contextHtml;
      renderSelectedStudents();
      onTemplateSelectionChanged();
      syncAllocatedHours(true);
      const saveBtn = modal.querySelector('#btnSaveSessionReportAssignment');
      if (saveBtn) saveBtn.disabled = false;
      const hintEl = modal.querySelector('#sessionReportStartDateHint');
      if (hintEl) hintEl.textContent = '';
    }

    async function openStudentPicker() {
      if (isLoadingPickerStudents) return;
      const modal = getModal();
      if (!modal) return;
      const scope = String(modal.querySelector('#sessionReportScope')?.value || 'class').trim();
      const startDate = String(modal.querySelector('#sessionReportStartDate')?.value || '').trim();
      const endDate = String(modal.querySelector('#sessionReportDueDate')?.value || '').trim();
      if (!startDate || !endDate) {
        await showMessage('Dates Required', 'Set report start and due dates before picking students.', 'warning');
        return;
      }
      pickerSelectedIds = Array.from(selectedStudents.keys());
      try {
        isLoadingPickerStudents = true;
        const autoSelectAll = scope === 'each_student' && !pickerSelectedIds.length;
        const items = await fetchEligibleStudents({ autoSelectAll });
        if (!items.length) {
          await showMessage('No Eligible Students', 'No enrollment-eligible students were found for this report period.', 'info');
          return;
        }
        const pickerModal = getStudentPickerModal();
        if (pickerModal) pickerModal.show();
        else document.getElementById('sessionReportStudentPickerModal')?.classList.add('show');
      } catch (error) {
        await showMessage('Students Unavailable', String(error?.message || 'Unable to load eligible students.'), 'warning');
      } finally {
        isLoadingPickerStudents = false;
      }
    }

    function validatePayload(payload) {
      if (!payload.templateId) return 'Select a report template.';
      if (!payload.reportScope) return 'Select a report scope approved by the template.';
      if (!payload.reportStartDate) return 'Select the report start date.';
      if (!payload.reportDueDate) return 'Select the report due date.';
      if (payload.reportStartDate > payload.reportDueDate) return 'Report Start Date cannot be after the due date.';
      if (ctx.sessionDate && payload.reportStartDate > ctx.sessionDate) return 'Report Start Date cannot be after the session date.';
      if (!payload.taskStartTime || !payload.taskEndTime) return 'Task Start and Task End are required.';
      if (payload.taskStartTime >= payload.taskEndTime) return 'Task End must be later than Task Start.';
      if (ctx.startTime && payload.taskStartTime < ctx.startTime) {
        return `Task Start cannot be before the session start time (${ctx.startTime}).`;
      }
      if (ctx.endTime && payload.taskEndTime > ctx.endTime) {
        return `Task End cannot be after the session end time (${ctx.endTime}).`;
      }
      if (isSessionReportStudentScoped(payload.reportScope) && !payload.targetStudentIds.length) {
        return payload.reportScope === 'each_student'
          ? 'Pick students for this report (use Pick Students).'
          : 'Select at least one student for Specific Students scope.';
      }
      if (payload.timesheetReflection && Number(payload.allocatedHours || 0) <= 0) {
        return 'Allocated Hours must be greater than zero when timesheet reflection is enabled.';
      }
      return '';
    }

    function rememberActionStateId(value) {
      const token = String(value || '').trim();
      if (token) actionStateId = token;
    }

    async function saveAssignment() {
      if (saving) return;
      const modal = getModal();
      if (!modal) return;
      const classId = String(ctx.classId || '').trim();
      const sessionId = String(ctx.sessionId || '').trim();
      if (!classId || !sessionId) {
        await showMessage('Assignment Failed', 'Session context is missing.', 'error');
        return;
      }
      const button = modal.querySelector('#btnSaveSessionReportAssignment');
      const oldHtml = button ? button.innerHTML : '';
      const payload = {
        templateId: String(modal.querySelector('#sessionReportTemplateId')?.value || '').trim(),
        reportScope: String(modal.querySelector('#sessionReportScope')?.value || 'class').trim(),
        reportStartDate: String(modal.querySelector('#sessionReportStartDate')?.value || '').trim(),
        reportDueDate: String(modal.querySelector('#sessionReportDueDate')?.value || '').trim(),
        taskStartTime: String(modal.querySelector('#sessionReportTaskStart')?.value || '').trim(),
        taskEndTime: String(modal.querySelector('#sessionReportTaskEnd')?.value || '').trim(),
        conflictPermitted: modal.querySelector('#sessionReportConflictPermitted')?.checked === true,
        timesheetReflection: modal.querySelector('#sessionReportTimesheetReflection')?.checked === true,
        conductRequiredBeforeFill: modal.querySelector('#sessionReportConductRequiredBeforeFill')?.checked !== false,
        allocatedHours: String(modal.querySelector('#sessionReportAllocatedHours')?.value || '0').trim(),
        notes: String(modal.querySelector('#sessionReportNotes')?.value || '').trim(),
        targetStudentIds: Array.from(selectedStudents.keys())
      };
      const issue = validatePayload(payload);
      if (issue) {
        await showMessage('Assignment Incomplete', issue, 'warning');
        return;
      }
      const body = new URLSearchParams();
      body.set('actionStateId', actionStateId || '');
      Object.entries(payload).forEach(([key, value]) => {
        if (Array.isArray(value)) body.set(key, value.join(','));
        else body.set(key, String(value));
      });
      try {
        saving = true;
        if (button) {
          button.disabled = true;
          button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
        }
        if (typeof deps.showLoading === 'function') deps.showLoading('Assigning report to session...');
        const res = await fetch(`/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}/report-assignments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-ajax-request': 'true',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json',
            ...(actionStateId ? { 'X-Action-State-Id': actionStateId } : {})
          },
          credentials: 'same-origin',
          body
        });
        const result = await res.json().catch(() => ({ status: 'error', message: 'Unable to read server response.' }));
        rememberActionStateId(result.actionStateId || res.headers.get('x-action-state-id'));
        if (!res.ok || result.status !== 'success') throw new Error(result.message || 'Could not assign report to this session.');
        if (assignmentModalInstance) assignmentModalInstance.hide();
        if (typeof deps.onSuccess === 'function') {
          await deps.onSuccess(result, ctx);
        }
        await showMessage('Report Assigned', result.message || 'Report assigned to this session.', 'success');
      } catch (error) {
        await showMessage('Assignment Failed', error.message || 'Could not assign report to this session.', 'error');
      } finally {
        if (typeof deps.hideLoading === 'function') deps.hideLoading({ force: true });
        if (button) {
          button.disabled = false;
          button.innerHTML = oldHtml;
        }
        saving = false;
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      document.getElementById('sessionReportTemplateId')?.addEventListener('change', onTemplateSelectionChanged);
      document.getElementById('btnPickSessionReportStudents')?.addEventListener('click', () => {
        openStudentPicker().catch((error) => showMessage('Student Picker', error.message, 'error'));
      });
      document.getElementById('sessionReportScope')?.addEventListener('change', () => {
        syncScope();
        applySuggestedStartDate().catch(() => {});
      });
      document.getElementById('sessionReportStartDate')?.addEventListener('change', () => {
        const modal = getModal();
        const value = String(modal?.querySelector('#sessionReportStartDate')?.value || '').trim();
        if (value && value !== lastAutoSuggestedStartDate) startDateUserEdited = true;
      });
      document.getElementById('sessionReportStudentPickerBody')?.addEventListener('change', (event) => {
        const checkbox = event.target?.closest?.('.js-session-report-student-picker-check');
        if (!checkbox) return;
        const id = String(checkbox.getAttribute('data-student-id') || '').trim();
        if (!id) return;
        if (checkbox.checked) {
          if (!pickerSelectedIds.includes(id)) pickerSelectedIds.push(id);
        } else {
          pickerSelectedIds = pickerSelectedIds.filter((studentId) => studentId !== id);
        }
        renderStudentPickerTable();
      });
      document.getElementById('sessionReportStudentPickerSelectAll')?.addEventListener('change', (event) => {
        const checked = Boolean(event.target?.checked);
        const rows = Array.isArray(pickerEligibleStudents) ? pickerEligibleStudents : [];
        pickerSelectedIds = checked
          ? rows.map((student) => String(student?.id || student?.personId || '').trim()).filter(Boolean)
          : [];
        renderStudentPickerTable();
      });
      document.getElementById('btnConfirmSessionReportStudentPicker')?.addEventListener('click', () => {
        applyStudentPickerSelection();
        const pickerModal = getStudentPickerModal();
        if (pickerModal) pickerModal.hide();
      });
      document.getElementById('sessionReportTaskStart')?.addEventListener('change', () => syncAllocatedHours(true));
      document.getElementById('sessionReportTaskEnd')?.addEventListener('change', () => syncAllocatedHours(true));
      document.getElementById('sessionReportTimesheetReflection')?.addEventListener('change', () => syncAllocatedHours(true));
      document.getElementById('btnSaveSessionReportAssignment')?.addEventListener('click', () => {
        saveAssignment().catch((error) => showMessage('Assignment Failed', error.message, 'error'));
      });
      if (typeof deps.bindExtraOpenTriggers === 'function') {
        deps.bindExtraOpenTriggers(() => open(ctx));
      }
    }

    async function open(nextCtx = {}) {
      if (opening) return;
      const modal = getModal();
      if (!modal) return;
      opening = true;
      ctx = { ...nextCtx };
      setModalLoading(true);
      if (assignmentModalInstance) assignmentModalInstance.show();
      else modal.classList.add('show');
      try {
        let resolvedCtx = { ...ctx };
        const hasResolveOpenContext = typeof deps.resolveOpenContext === 'function';
        const hasFetchExistingReports = typeof deps.fetchExistingReports === 'function';
        if (hasResolveOpenContext) {
          const patch = await deps.resolveOpenContext(resolvedCtx);
          if (patch && typeof patch === 'object') resolvedCtx = { ...resolvedCtx, ...patch };
        }
        ctx = resolvedCtx;
        const loadTasks = [fetchActiveReportTemplates(ctx)];
        if (hasFetchExistingReports) {
          loadTasks.push(deps.fetchExistingReports(ctx));
        }
        const loadResults = await Promise.all(loadTasks);
        const templates = loadResults[0];
        const instanceRows = hasFetchExistingReports ? (loadResults[1] || []) : [];
        populateTemplateSelect(templates);
        applyFormDefaults();
        await applySuggestedStartDate();
        renderExistingReports(instanceRows, ctx.embeddedReports);
      } catch (error) {
        if (assignmentModalInstance) assignmentModalInstance.hide();
        await showMessage('Unable to Open', error.message || 'Could not load assignment data.', 'error');
      } finally {
        setModalLoading(false);
        opening = false;
      }
    }

    bindEvents();

    return {
      open,
      rememberActionStateId,
      getActionStateId: () => actionStateId
    };
  }

  const api = {
    installSessionReportAssignmentClient,
    normalizeSessionReportTemplateScopes,
    isSessionReportStudentScoped,
    filterActiveReportTemplates,
    filterTemplatesForDeliveryDepartment,
    templateMatchesDeliveryDepartment,
    formatReportTemplateOptionLabel,
    buildExistingReportDisplayRows
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    Object.assign(global, api);
  }
}(typeof window !== 'undefined' ? window : global));
