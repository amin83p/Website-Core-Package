(function (global) {
  'use strict';

  let ctx = null;
  let loadedStudents = [];
  let modalInstance = null;
  let sortState = { key: 'student', dir: 'asc' };

  function qs(id) {
    return document.getElementById(id);
  }

  function getModalDialog() {
    return document.querySelector('#reportByFunderModal .report-by-funder-modal-dialog');
  }

  function getModal() {
    const el = qs('reportByFunderModal');
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

  function apiUrl() {
    return String(ctx?.apiUrl || '').trim();
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatDateParts(year, monthIndex, day) {
    return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
  }

  function lastDayOfMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function monthHalfRange(year, monthIndex, half) {
    const lastDay = lastDayOfMonth(year, monthIndex);
    if (half === 1) {
      return {
        start: formatDateParts(year, monthIndex, 1),
        end: formatDateParts(year, monthIndex, 15)
      };
    }
    return {
      start: formatDateParts(year, monthIndex, 16),
      end: formatDateParts(year, monthIndex, lastDay)
    };
  }

  function fullMonthRange(year, monthIndex) {
    return {
      start: formatDateParts(year, monthIndex, 1),
      end: formatDateParts(year, monthIndex, lastDayOfMonth(year, monthIndex))
    };
  }

  function defaultOpenDateRange(ref = new Date()) {
    return fullMonthRange(ref.getFullYear(), ref.getMonth());
  }

  function resolveRangeChip(rangeKey, ref = new Date()) {
    const year = ref.getFullYear();
    const month = ref.getMonth();
    switch (rangeKey) {
      case 'lastMonthFirstHalf': {
        const d = new Date(year, month - 1, 1);
        return monthHalfRange(d.getFullYear(), d.getMonth(), 1);
      }
      case 'lastMonthSecondHalf': {
        const d = new Date(year, month - 1, 1);
        return monthHalfRange(d.getFullYear(), d.getMonth(), 2);
      }
      case 'currentMonthFirstHalf':
        return monthHalfRange(year, month, 1);
      case 'currentMonthSecondHalf':
        return monthHalfRange(year, month, 2);
      default:
        return defaultOpenDateRange(ref);
    }
  }

  function setModalExpanded(expanded) {
    getModalDialog()?.classList.toggle('report-by-funder-modal-dialog--expanded', Boolean(expanded));
  }

  function clearRangeChipActive() {
    document.querySelectorAll('#reportByFunderRangeChips .report-by-funder-range-chip.active').forEach((btn) => {
      btn.classList.remove('active');
    });
  }

  function setRangeChipActive(rangeKey) {
    clearRangeChipActive();
    if (!rangeKey) return;
    const btn = document.querySelector(
      `#reportByFunderRangeChips .report-by-funder-range-chip[data-range="${rangeKey}"]`
    );
    btn?.classList.add('active');
  }

  function applyDateRangeToInputs(range, { rangeKey = null } = {}) {
    const startEl = qs('reportByFunderStartDate');
    const endEl = qs('reportByFunderEndDate');
    if (startEl) startEl.value = range.start;
    if (endEl) endEl.value = range.end;
    if (rangeKey) setRangeChipActive(rangeKey);
    else clearRangeChipActive();
  }

  function compareText(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
  }

  function sortStudentsForDisplay(students, state) {
    const dir = state.dir === 'desc' ? -1 : 1;
    const list = (Array.isArray(students) ? students : []).map((student) => ({
      ...student,
      classes: [...(Array.isArray(student.classes) ? student.classes : [])]
    }));

    if (state.key === 'class') {
      list.forEach((student) => {
        student.classes.sort(
          (a, b) => dir * compareText(a.className || a.classId, b.className || b.classId)
        );
      });
      list.sort((a, b) => {
        const aName = a.classes[0] ? a.classes[0].className || a.classes[0].classId : '';
        const bName = b.classes[0] ? b.classes[0].className || b.classes[0].classId : '';
        return dir * compareText(aName, bName);
      });
      return list;
    }

    if (state.key === 'enrollment') {
      list.forEach((student) => {
        student.classes.sort((a, b) => dir * compareText(a.startDate, b.startDate));
      });
      list.sort((a, b) => {
        const aDate = a.classes[0] ? a.classes[0].startDate : '';
        const bDate = b.classes[0] ? b.classes[0].startDate : '';
        return dir * compareText(aDate, bDate);
      });
      return list;
    }

    list.sort(
      (a, b) => dir * compareText(a.name || a.studentRecordId, b.name || b.studentRecordId)
    );
    return list;
  }

  function sortIconClass(state, key) {
    if (state.key !== key) return 'bi bi-arrow-down-up report-by-funder-sort-icon ms-1 text-muted';
    return state.dir === 'asc'
      ? 'bi bi-caret-up-fill report-by-funder-sort-icon ms-1'
      : 'bi bi-caret-down-fill report-by-funder-sort-icon ms-1';
  }

  function updateSortHeaderUi() {
    document.querySelectorAll('#reportByFunderTable .js-report-by-funder-sort').forEach((th) => {
      const key = th.getAttribute('data-sort-key');
      const icon = th.querySelector('.report-by-funder-sort-icon');
      if (icon) icon.className = sortIconClass(sortState, key);
      if (sortState.key === key) {
        th.setAttribute('aria-sort', sortState.dir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
    });
  }

  function toggleSort(key) {
    if (sortState.key === key) {
      sortState = { key, dir: sortState.dir === 'asc' ? 'desc' : 'asc' };
    } else {
      sortState = { key, dir: 'asc' };
    }
    renderStudentTable(loadedStudents);
  }

  function countSelectedStudents() {
    const tbody = qs('reportByFunderTableBody');
    if (!tbody) return 0;
    return tbody.querySelectorAll('.js-report-by-funder-student-check:checked').length;
  }

  function updateSelectionUi() {
    const tbody = qs('reportByFunderTableBody');
    const applyBtn = qs('btn_reportByFunderApply');
    const countEl = qs('reportByFunderSelectionCount');
    const checkAll = qs('reportByFunderCheckAll');
    if (!tbody) return;
    const boxes = [...tbody.querySelectorAll('.js-report-by-funder-student-check')];
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

  function setSelectionToolbarVisible(visible) {
    qs('reportByFunderSelectionToolbar')?.classList.toggle('d-none', !visible);
  }

  function setAllChecked(checked) {
    const tbody = qs('reportByFunderTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('.js-report-by-funder-student-check').forEach((box) => {
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
    return `<div class="report-by-funder-enrollment-detail">
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
    const tbody = qs('reportByFunderTableBody');
    const wrap = qs('reportByFunderTableWrap');
    const empty = qs('reportByFunderEmpty');
    if (!tbody || !wrap || !empty) return;
    if (!loadedStudents.length) {
      tbody.innerHTML = '';
      wrap.classList.add('d-none');
      empty.classList.remove('d-none');
      setModalExpanded(false);
      setSelectionToolbarVisible(false);
      updateSortHeaderUi();
      updateSelectionUi();
      return;
    }
    empty.classList.add('d-none');
    wrap.classList.remove('d-none');
    setModalExpanded(true);
    setSelectionToolbarVisible(true);
    const sorted = sortStudentsForDisplay(loadedStudents, sortState);
    const flatRows = buildFlatClassRows(sorted);
    tbody.innerHTML = flatRows.map((entry) => {
      const student = entry.student;
      const sid = escape(student.studentRecordId || '');
      const classRow = entry.classRow;
      const className = classRow
        ? escape(classRow.className || classRow.classId)
        : '<span class="text-muted">—</span>';
      const studentCells = entry.isFirst
        ? `<td class="ps-3 align-middle" rowspan="${entry.rowSpan}">
            <input type="checkbox" class="form-check-input js-report-by-funder-student-check" checked data-student-index="${entry.studentIndex}">
          </td>
          <td class="align-middle" rowspan="${entry.rowSpan}">
            <div class="report-by-funder-student-name">${escape(student.name || sid)}</div>
            <div class="report-by-funder-student-id text-muted font-monospace">${sid}</div>
          </td>`
        : '';
      return `<tr data-student-index="${entry.studentIndex}">
        ${studentCells}
        <td class="align-middle"><div class="report-by-funder-class-name">${className}</div></td>
        <td class="align-middle">${renderEnrollmentDetailCell(classRow)}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.js-report-by-funder-student-check').forEach((box) => {
      box.addEventListener('change', updateSelectionUi);
    });
    updateSortHeaderUi();
    updateSelectionUi();
  }

  function seedModalDates() {
    applyDateRangeToInputs(defaultOpenDateRange());
  }

  function openModal() {
    sortState = { key: 'student', dir: 'asc' };
    seedModalDates();
    loadedStudents = [];
    renderStudentTable([]);
    qs('reportByFunderLoading')?.classList.add('d-none');
    qs('reportByFunderEmpty')?.classList.add('d-none');
    qs('reportByFunderTableWrap')?.classList.add('d-none');
    setModalExpanded(false);
    setSelectionToolbarVisible(false);
    getModal()?.show();
  }

  async function loadStudents() {
    const url = apiUrl();
    if (!url) {
      showMessage({ icon: 'error', message: 'Report By Funder is not configured.' });
      return;
    }
    const funderId = String(qs('reportByFunderSelect')?.value || '').trim();
    const startDate = String(qs('reportByFunderStartDate')?.value || '').trim();
    const endDate = String(qs('reportByFunderEndDate')?.value || '').trim();
    if (!funderId) {
      showMessage({ icon: 'warning', message: 'Choose a funder.' });
      return;
    }
    if (!startDate || !endDate) {
      showMessage({ icon: 'warning', message: 'Start date and end date are required.' });
      return;
    }
    const loadBtn = qs('btn_reportByFunderLoad');
    const loading = qs('reportByFunderLoading');
    const loadHtml = loadBtn?.innerHTML;
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    }
    loading?.classList.remove('d-none');
    qs('reportByFunderTableWrap')?.classList.add('d-none');
    qs('reportByFunderEmpty')?.classList.add('d-none');
    setModalExpanded(false);
    setSelectionToolbarVisible(false);
    try {
      const params = new URLSearchParams({ funderId, startDate, endDate });
      const response = await fetch(`${url}?${params.toString()}`, {
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
    const tbody = qs('reportByFunderTableBody');
    if (!tbody || !ctx) return;
    const sorted = sortStudentsForDisplay(loadedStudents, sortState);
    const picked = [];
    const seen = new Set();
    tbody.querySelectorAll('.js-report-by-funder-student-check:checked').forEach((box) => {
      const index = Number(box.getAttribute('data-student-index'));
      if (seen.has(index)) return;
      seen.add(index);
      const row = sorted[index];
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
    const startDate = String(qs('reportByFunderStartDate')?.value || '').trim();
    const endDate = String(qs('reportByFunderEndDate')?.value || '').trim();
    if (typeof ctx.setDateRange === 'function' && startDate && endDate) {
      const startParts = startDate.split('-').map(Number);
      const endParts = endDate.split('-').map(Number);
      if (startParts.length === 3 && endParts.length === 3) {
        ctx.setDateRange(
          new Date(startParts[0], startParts[1] - 1, startParts[2]),
          new Date(endParts[0], endParts[1] - 1, endParts[2])
        );
      } else {
        const pageStart = qs('filter_startDate');
        const pageEnd = qs('filter_endDate');
        if (pageStart) pageStart.value = startDate;
        if (pageEnd) pageEnd.value = endDate;
      }
    }
    if (typeof ctx.replaceSelectedStudents === 'function') {
      ctx.replaceSelectedStudents(picked);
    }
    getModal()?.hide();
    const loadReport = ctx.loadReport || ctx.loadSemiMonthlyReport;
    if (typeof loadReport === 'function') {
      Promise.resolve(loadReport()).catch((error) => {
        showMessage({ icon: 'error', message: error.message || 'Load failed.' });
      });
    }
  }

  function bindEvents() {
    qs('btn_openReportByFunderModal')?.addEventListener('click', openModal);
    qs('btn_reportByFunderLoad')?.addEventListener('click', () => {
      loadStudents().catch((error) => showMessage({ icon: 'error', message: error.message || 'Load failed.' }));
    });
    qs('btn_reportByFunderSelectAll')?.addEventListener('click', () => setAllChecked(true));
    qs('btn_reportByFunderSelectNone')?.addEventListener('click', () => setAllChecked(false));
    qs('reportByFunderCheckAll')?.addEventListener('change', (event) => {
      setAllChecked(event.target.checked);
    });
    qs('btn_reportByFunderApply')?.addEventListener('click', applySelection);
    qs('reportByFunderRangeChips')?.addEventListener('click', (event) => {
      const btn = event.target.closest('.report-by-funder-range-chip[data-range]');
      if (!btn) return;
      const rangeKey = btn.getAttribute('data-range');
      applyDateRangeToInputs(resolveRangeChip(rangeKey), { rangeKey });
    });
    qs('reportByFunderStartDate')?.addEventListener('change', clearRangeChipActive);
    qs('reportByFunderEndDate')?.addEventListener('change', clearRangeChipActive);
    qs('reportByFunderTable')?.addEventListener('click', (event) => {
      const th = event.target.closest('.js-report-by-funder-sort[data-sort-key]');
      if (!th) return;
      toggleSort(th.getAttribute('data-sort-key'));
    });
  }

  function init(context) {
    ctx = context && typeof context === 'object' ? context : {};
    bindEvents();
  }

  const dateRangeApi = {
    pad2,
    formatDateParts,
    lastDayOfMonth,
    monthHalfRange,
    fullMonthRange,
    defaultOpenDateRange,
    resolveRangeChip
  };

  global.ReportByFunderModal = { init, dateRangeApi };
  global.SmmrByFunderModal = global.ReportByFunderModal;
})(window);
