(function (global) {
  'use strict';

  const NO_ATTENDANCE_STATUS_NOTE = 'No attendance status during this report period.';

  function isSelectableStudent(row) {
    if (row && row.selectable === false) return false;
    if (row && row.selectable === true) return true;
    return Number(row?.eligibleSessionCount || 0) > 0;
  }

  function selectableStudents(students) {
    return (Array.isArray(students) ? students : []).filter((row) => isSelectableStudent(row));
  }

  function selectableIds(students) {
    return selectableStudents(students)
      .map((row) => String(row?.id || row?.personId || '').trim())
      .filter(Boolean);
  }

  function ineligibleNoteForStudent(row) {
    const note = String(row?.ineligibleNote || '').trim();
    if (note) return note;
    return isSelectableStudent(row) ? '' : NO_ATTENDANCE_STATUS_NOTE;
  }

  function buildPickerRowHtml({
    student,
    checked = false,
    checkboxClass = 'js-report-student-picker-check',
    checkboxExtraAttrs = '',
    escapeHtml = (value) => String(value ?? '')
  } = {}) {
    const id = String(student?.id || student?.personId || '').trim();
    const name = String(student?.name || id).trim();
    const count = Number(student?.eligibleSessionCount || 0);
    const selectable = isSelectableStudent(student);
    const isChecked = selectable && checked;
    const note = ineligibleNoteForStudent(student);
    const noteHtml = note
      ? `<div class="small text-muted">${escapeHtml(note)}</div>`
      : '';
    const rowClass = selectable ? '' : ' class="text-muted"';
    const extraAttrs = String(checkboxExtraAttrs || '').trim();
    const extraAttrText = extraAttrs ? ` ${extraAttrs}` : '';
    return `<tr${rowClass}>
      <td><input type="checkbox" class="form-check-input ${escapeHtml(checkboxClass)}" data-student-id="${escapeHtml(id)}"${extraAttrText}${isChecked ? ' checked' : ''}${selectable ? '' : ' disabled'}></td>
      <td><div>${escapeHtml(name)}</div>${noteHtml}</td>
      <td class="text-end">${count}</td>
    </tr>`;
  }

  function syncSelectionAfterFetch({
    students = [],
    selectedIds = [],
    autoSelectAll = false,
    reportScope = ''
  } = {}) {
    const rows = Array.isArray(students) ? students : [];
    const eligible = selectableIds(rows);
    const eligibleSet = new Set(eligible);
    const previousSelection = new Set(
      (Array.isArray(selectedIds) ? selectedIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const scope = String(reportScope || '').trim().toLowerCase();
    let nextIds;
    if (autoSelectAll || (!previousSelection.size && scope === 'each_student')) {
      nextIds = [...eligible];
    } else if (!previousSelection.size) {
      nextIds = [];
    } else {
      nextIds = eligible.filter((id) => previousSelection.has(id));
    }
    return {
      selectedIds: nextIds,
      selectableIds: eligible,
      selectableSet: eligibleSet
    };
  }

  function updateSelectAllState({
    students = [],
    selectedIds = [],
    selectAllEl = null,
    summaryEl = null
  } = {}) {
    const rows = Array.isArray(students) ? students : [];
    const selectable = selectableStudents(rows);
    const selectableIdSet = new Set(selectableIds(rows));
    const selectedSet = new Set(
      (Array.isArray(selectedIds) ? selectedIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const selectedSelectableCount = selectable.filter((row) => {
      const id = String(row?.id || row?.personId || '').trim();
      return id && selectedSet.has(id);
    }).length;

    if (summaryEl) {
      if (!rows.length) {
        summaryEl.textContent = '';
      } else if (!selectable.length) {
        summaryEl.textContent = '0 selectable students';
      } else {
        summaryEl.textContent = `${selectedSelectableCount} of ${selectable.length} selectable selected`;
      }
    }

    if (selectAllEl) {
      if (!selectable.length) {
        selectAllEl.checked = false;
        selectAllEl.indeterminate = false;
        selectAllEl.disabled = true;
      } else {
        selectAllEl.disabled = false;
        selectAllEl.checked = selectedSelectableCount === selectable.length;
        selectAllEl.indeterminate = selectedSelectableCount > 0 && selectedSelectableCount < selectable.length;
      }
    }

    return {
      selectableCount: selectable.length,
      selectedSelectableCount,
      selectableIdSet
    };
  }

  function applySelectAllToggle({
    students = [],
    checked = false
  } = {}) {
    return checked ? selectableIds(students) : [];
  }

  const api = {
    NO_ATTENDANCE_STATUS_NOTE,
    isSelectableStudent,
    selectableStudents,
    selectableIds,
    ineligibleNoteForStudent,
    buildPickerRowHtml,
    syncSelectionAfterFetch,
    updateSelectAllState,
    applySelectAllToggle
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    global.ReportAssignmentStudentPickerUi = api;
  }
}(typeof window !== 'undefined' ? window : global));
