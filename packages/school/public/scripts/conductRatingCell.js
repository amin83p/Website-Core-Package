(function initConductRatingCell(global) {
  'use strict';

  const NA_LEVEL = Object.freeze({
    code: 'NA',
    displayCode: 'N/A',
    label: 'Not Available',
    defaultPercent: null
  });

  function getPolicyLevels() {
    const policy = global.__conductRatingScalePolicy || global.__conductRatingScale || {};
    const levels = Array.isArray(policy.levels) ? policy.levels : [];
    return levels.length ? levels : [];
  }

  function getPickerLevels() {
    return [...getPolicyLevels(), NA_LEVEL];
  }

  function normalizeConductPercent(value, fallback = null) {
    if (value === null || value === undefined || value === '') {
      if (fallback === null || fallback === undefined) return null;
      return normalizeConductPercent(fallback, null);
    }
    const token = String(value).trim().toLowerCase();
    if (token === 'n/a' || token === 'na') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) {
      if (fallback === null || fallback === undefined) return null;
      const fallbackNumber = Number(fallback);
      if (!Number.isFinite(fallbackNumber)) return null;
      return Math.max(0, Math.min(100, Math.round(fallbackNumber * 10) / 10));
    }
    return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
  }

  function levelByConductCode(code) {
    const key = String(code || '').trim();
    if (key === 'NA' || key === 'N/A') return { ...NA_LEVEL };
    const match = getPolicyLevels().find((row) => row.code === key);
    return match ? { ...match } : null;
  }

  function percentToConductLevel(percent) {
    if (percent === null || percent === undefined || percent === '') return { ...NA_LEVEL };
    const value = normalizeConductPercent(percent, null);
    if (value === null) return { ...NA_LEVEL };
    const levels = getPolicyLevels();
    const match = levels.find((row) => value >= Number(row.minPercent) && value <= Number(row.maxPercent));
    return match ? { ...match } : (levels[0] ? { ...levels[0] } : { ...NA_LEVEL });
  }

  function updateConductCellUi(cell) {
    if (!cell) return;
    const percentInput = cell.querySelector('.conduct-percent-input');
    const raw = percentInput?.value;
    const isEmpty = raw === '' || raw === null || raw === undefined;
    const percent = isEmpty ? null : normalizeConductPercent(raw, null);
    const level = percentToConductLevel(percent);
    cell.querySelectorAll('.conduct-emoji-btn, .conduct-code-btn').forEach((btn) => {
      const active = btn.dataset.code === level.code;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (percentInput) {
      percentInput.value = percent === null ? '' : String(percent);
    }
    cell.dataset.levelCode = level.code;
  }

  function applyConductLevel(cell, code, options = {}) {
    const level = levelByConductCode(code);
    if (!level || !cell) return;
    const percentInput = cell.querySelector('.conduct-percent-input');
    if (percentInput && !options.keepPercent) {
      percentInput.value = level.code === 'NA' || level.defaultPercent == null ? '' : String(level.defaultPercent);
    }
    updateConductCellUi(cell);
  }

  function readConductPercentFromCell(cell, fallback = null) {
    if (!cell) return normalizeConductPercent(fallback, null);
    return normalizeConductPercent(cell.querySelector('.conduct-percent-input')?.value, fallback);
  }

  function bindConductRatingCell(cell, { readOnly = false, onChange } = {}) {
    if (!cell || cell.dataset.conductBound === '1') {
      updateConductCellUi(cell);
      return;
    }
    cell.dataset.conductBound = '1';
    updateConductCellUi(cell);
    cell.querySelectorAll('.conduct-emoji-btn, .conduct-code-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (readOnly) return;
        applyConductLevel(cell, btn.dataset.code);
        if (typeof onChange === 'function') onChange(cell);
      });
    });
    const percentInput = cell.querySelector('.conduct-percent-input');
    const notify = () => {
      updateConductCellUi(cell);
      if (typeof onChange === 'function') onChange(cell);
    };
    percentInput?.addEventListener('change', notify);
    percentInput?.addEventListener('input', notify);
    if (readOnly && percentInput) percentInput.disabled = true;
  }

  function buildConductRatingCellHtml(dimKey, dimLabel, pickerLevels, percentValue, readOnly) {
    const safeKey = String(dimKey || '').replace(/"/g, '&quot;');
    const safeLabel = String(dimLabel || '').replace(/"/g, '&quot;');
    const valueAttr = percentValue === null || percentValue === undefined || percentValue === ''
      ? ''
      : String(percentValue);
    const buttons = (pickerLevels || getPickerLevels()).map((level) => {
      const code = String(level.code || '').replace(/"/g, '&quot;');
      const title = String(level.label || level.code || '').replace(/"/g, '&quot;');
      const display = String(level.displayCode || level.code || '').replace(/</g, '&lt;');
      return `<button type="button" class="conduct-emoji-btn conduct-code-btn" data-code="${code}" title="${title}">${display}</button>`;
    }).join('');
    const disabled = readOnly ? ' disabled' : '';
    return `<div class="conduct-rating-cell" data-dimension="${safeKey}">
      <div class="conduct-emoji-picker" role="group" aria-label="${safeLabel} rating">${buttons}</div>
      <input type="number" class="form-control form-control-sm conduct-percent-input conduct-rating-input" min="0" max="100" step="0.5" value="${valueAttr.replace(/"/g, '&quot;')}"${disabled}>
    </div>`;
  }

  global.ConductRatingCell = {
    NA_LEVEL,
    getPolicyLevels,
    getPickerLevels,
    normalizeConductPercent,
    levelByConductCode,
    percentToConductLevel,
    updateConductCellUi,
    applyConductLevel,
    readConductPercentFromCell,
    bindConductRatingCell,
    buildConductRatingCellHtml
  };
}(window));
