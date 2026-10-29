(function (global) {
  'use strict';

  let ctx = null;
  let loadedStudents = [];
  let modalInstance = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function getModal() {
    const el = qs('smmrByFunderModal');
    if (!el || !global.bootstrap?.Modal) return null;
    if (!modalInstance) modalInstance = global.bootstrap.Modal.getOrCreateInstance(el);
    return modalInstance;
  }

  function escape(value) {
    return typeof ctx?.escapeHtml === 'function' ? ctx.escapeHtml(value) : String(value ?? '');
  }

  function showMessage(options) {
    if (typeof ctx?.showReportMessage === 'function') ctx.showReportMessage(options);
  }

  function countSelectedStudents() {
    const tbody = qs('smmrByFunderTableBody');
    if (!tbody) return 0;
    return tbody.querySelectorAll('.js-smmr-by-funder-student-check:checked').length;
  }

  function updateSelectionUi() {
    const tbody = qs('smmrByFunderTableBody');
    const applyBtn = qs('btn_smmrByFunderApply');
    const countEl = qs('smmrByFunderSelectionCount');
    const checkAll = qs('smmrByFunderCheckAll');
    if (!tbody) return;
    const boxes = [...tbody.querySelectorAll('.js-smmr-by-funder-student-check')];
    const checked = countSelectedStudents();
    const totalStudents = boxes.length;
    if (countEl) {
      countEl.textContent = totalStudents
        ? `${checked} of ${totalStudents} student${totalStudents === 1 ? '' : 's'} selected`
        : '0 selected';
    }
    if (applyBtn) applyBtn.disabled = checked === 0;
    if (checkAll) {
      checkAll.indeterminate = checked > 0 && checked < totalStudents;
      checkAll.checked = totalStudents > 0 && checked === totalStudents;
    }
  }

  function setAllChecked(checked) {
    const tbody = qs('smmrByFunderTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('.js-smmr-by-funder-student-check').forEach((box) => {
      box.checked = checked;
    });
    updateSelectionUi();
  }

  function renderEnrollmentDetailCell(classRow) {
    if (!classRow) return '<span class="text-muted">—</span>';
    const status = escape(classRow.status || '');
    const dates = `${escape(classRow.startDate || '')} → ${escape(classRow.effectiveEndDate || '')}`;
    const claim = classRow.claimNumber
      ? `<div class="text-muted">Claim ${escape(classRow.claimNumber)}</div>`
      : '';
    const manual = classRow.manualScheduledClose
      ? '<span class="badge bg-info-subtle text-info ms-1">Scheduled close</span>'
      : '';
    return `<div class="smmr-by-funder-enrollment-detail">
      <div class="text-muted">${dates} · <span class="text-uppercase">${status}</span>${manual}</div>
      <div>${escape(classRow.capSummary || '')}</div>
      ${claim}
    </div>`;
  }

  function buildFlatClassRows(students = []) {
    const flat = [];
    (Array.isArray(students) ? students : []).forEach((student, studentIndex) => {
      const classes = Array.isArray(student.classes) ? student.classes : [];
      if (!classes.length) {
        flat.push({ student, studentIndex, classRow: null, isFirst: true, rowSpan: 1 });
        return;
      }
      classes.forEach((classRow, classIdx) => {
        flat.push({
          student,
          studentIndex,
          classRow,
          isFirst: classIdx === 0,
          rowSpan: classes.length
        });
      });
    });
    return flat;
  }

  function renderStudentTable(students = []) {
    loadedStudents = Array.isArray(students) ? students : [];
    const tbody = qs('smmrByFunderTableBody');
    const wrap = qs('smmrByFunderTableWrap');
    const empty = qs('smmrByFunderEmpty');
    if (!tbody || !wrap || !empty) return;
    if (!loadedStudents.length) {
      tbody.innerHTML = '';
      wrap.classList.add('d-none');
      empty.classList.remove('d-none');
      updateSelectionUi();
      return;
    }
    empty.classList.add('d-none');
    wrap.classList.remove('d-none');
    const flatRows = buildFlatClassRows(loadedStudents);
    tbody.innerHTML = flatRows.map((entry) => {
      const student = entry.student;
      const sid = escape(student.studentRecordId || '');
      const classRow = entry.classRow;
      const className = classRow
        ? escape(classRow.className || classRow.classId)
        : '<span class="text-muted">—</span>';
      const studentCells = entry.isFirst
        ? `<td class="ps-3 align-middle" rowspan="${entry.rowSpan}">
            <input type="checkbox" class="form-check-input js-smmr-by-funder-student-check" checked data-student-index="${entry.studentIndex}">
          </td>
          <td class="align-middle" rowspan="${entry.rowSpan}">
            <div class="smmr-by-funder-student-name">${escape(student.name || sid)}</div>
            <div class="smmr-by-funder-student-id text-muted font-monospace">${sid}</div>
          </td>`
        : '';
      return `<tr data-student-index="${entry.studentIndex}">
        ${studentCells}
        <td class="align-middle"><div class="smmr-by-funder-class-name">${className}</div></td>
        <td class="align-middle">${renderEnrollmentDetailCell(classRow)}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.js-smmr-by-funder-student-check').forEach((box) => {
      box.addEventListener('change', updateSelectionUi);
    });
    updateSelectionUi();
  }

  function seedModalDates() {
    const startEl = qs('smmrByFunderStartDate');
    const endEl = qs('smmrByFunderEndDate');
    const pageStart = qs('filter_startDate');
    const pageEnd = qs('filter_endDate');
    if (startEl && pageStart?.value) startEl.value = pageStart.value;
    if (endEl && pageEnd?.value) endEl.value = pageEnd.value;
  }

  function openModal() {
    seedModalDates();
    loadedStudents = [];
    renderStudentTable([]);
    qs('smmrByFunderLoading')?.classList.add('d-none');
    qs('smmrByFunderEmpty')?.classList.add('d-none');
    qs('smmrByFunderTableWrap')?.classList.add('d-none');
    getModal()?.show();
  }

  async function loadStudents() {
    const funderId = String(qs('smmrByFunderSelect')?.value || '').trim();
    const startDate = String(qs('smmrByFunderStartDate')?.value || '').trim();
    const endDate = String(qs('smmrByFunderEndDate')?.value || '').trim();
    if (!funderId) {
      showMessage({ icon: 'warning', message: 'Choose a funder.' });
      return;
    }
    if (!startDate || !endDate) {
      showMessage({ icon: 'warning', message: 'Start date and end date are required.' });
      return;
    }
    const loadBtn = qs('btn_smmrByFunderLoad');
    const loading = qs('smmrByFunderLoading');
    const loadHtml = loadBtn?.innerHTML;
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    }
    loading?.classList.remove('d-none');
    qs('smmrByFunderTableWrap')?.classList.add('d-none');
    qs('smmrByFunderEmpty')?.classList.add('d-none');
    try {
      const params = new URLSearchParams({ funderId, startDate, endDate });
      const response = await fetch(`/school/reports/semi-monthly/api/funder-students?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { 'X-AJAX-Request': 'true' }
      });
      const payload = await response.json();
      if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Could not load students.');
      }
      renderStudentTable(payload.students || []);
    } catch (error) {
      showMessage({ icon: 'error', message: error.message || 'Load failed.' });
      renderStudentTable([]);
    } finally {
      loading?.classList.add('d-none');
      if (loadBtn) {
        loadBtn.disabled = false;
        if (loadHtml) loadBtn.innerHTML = loadHtml;
      }
    }
  }

  function applySelection() {
    const tbody = qs('smmrByFunderTableBody');
    if (!tbody || !ctx) return;
    const picked = [];
    const seen = new Set();
    tbody.querySelectorAll('.js-smmr-by-funder-student-check:checked').forEach((box) => {
      const index = Number(box.getAttribute('data-student-index'));
      if (seen.has(index)) return;
      seen.add(index);
      const row = loadedStudents[index];
      if (!row) return;
      picked.push({
        id: row.studentRecordId,
        studentRecordId: row.studentRecordId,
        personId: row.personId,
        name: row.name
      });
    });
    if (!picked.length) {
      showMessage({ icon: 'warning', message: 'Select at least one student.' });
      return;
    }
    const startDate = String(qs('smmrByFunderStartDate')?.value || '').trim();
    const endDate = String(qs('smmrByFunderEndDate')?.value || '').trim();
    if (typeof ctx.setDateRange === 'function' && startDate && endDate) {
      const startParts = startDate.split('-').map(Number);
      const endParts = endDate.split('-').map(Number);
      if (startParts.length === 3 && endParts.length === 3) {
        ctx.setDateRange(
          new Date(startParts[0], startParts[1] - 1, startParts[2]),
          new Date(endParts[0], endParts[1] - 1, endParts[2])
        );
      } else {
        qs('filter_startDate').value = startDate;
        qs('filter_endDate').value = endDate;
      }
    }
    if (typeof ctx.replaceSelectedStudents === 'function') {
      ctx.replaceSelectedStudents(picked);
    }
    getModal()?.hide();
    if (typeof ctx.loadSemiMonthlyReport === 'function') {
      ctx.loadSemiMonthlyReport().catch((error) => {
        showMessage({ icon: 'error', message: error.message || 'Load failed.' });
      });
    }
  }

  function bindEvents() {
    qs('btn_openSmmrByFunderModal')?.addEventListener('click', openModal);
    qs('btn_smmrByFunderLoad')?.addEventListener('click', () => {
      loadStudents().catch((error) => showMessage({ icon: 'error', message: error.message || 'Load failed.' }));
    });
    qs('btn_smmrByFunderSelectAll')?.addEventListener('click', () => setAllChecked(true));
    qs('btn_smmrByFunderSelectNone')?.addEventListener('click', () => setAllChecked(false));
    qs('smmrByFunderCheckAll')?.addEventListener('change', (event) => {
      setAllChecked(event.target.checked);
    });
    qs('btn_smmrByFunderApply')?.addEventListener('click', applySelection);
  }

  function init(context) {
    ctx = context && typeof context === 'object' ? context : {};
    bindEvents();
  }

  global.SmmrByFunderModal = { init };
})(window);
