(function initReportSelectField(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReportSelectField = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createReportSelectField() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function normalizeSelectOptions(field) {
    if (!field || String(field.type || '').trim().toLowerCase() !== 'select') return [];
    return Array.isArray(field.options) ? field.options : [];
  }

  function shouldUseBinarySelect(field) {
    return normalizeSelectOptions(field).length === 2;
  }

  function buildReportSelectFieldHtml({
    field,
    value = '',
    disabled = false,
    readOnly = false,
    inputClass = '',
    name = '',
    size = '',
    idPrefix = ''
  } = {}) {
    const type = String(field?.type || '').trim().toLowerCase();
    const options = normalizeSelectOptions(field);
    const fieldId = String(field?.id || '').trim();
    if (type !== 'select' || !fieldId) return null;

    const isDisabled = disabled === true || readOnly === true;
    const valueStr = String(value ?? '');
    const groupName = String(name || `field__${fieldId}`).trim();
    const idBase = String(idPrefix || fieldId).trim();
    const sizeClass = size === 'sm' ? ' btn-group-sm' : '';
    const inputClassToken = String(inputClass || '').trim();
    const disabledAttr = isDisabled ? ' disabled' : '';
    const ariaLabel = escapeHtml(field?.label || 'Select option');

    if (options.length === 2) {
      const radios = options.map((opt, idx) => {
        const optValue = String(opt?.value ?? '');
        const optLabel = String(opt?.label || opt?.value || '');
        const inputId = `${idBase}_bin_${idx}`;
        const checked = valueStr === optValue ? ' checked' : '';
        return `<input type="radio" class="btn-check ${escapeHtml(inputClassToken)}" name="${escapeHtml(groupName)}" id="${escapeHtml(inputId)}" value="${escapeHtml(optValue)}" data-field-id="${escapeHtml(fieldId)}"${checked}${disabledAttr}><label class="btn btn-outline-primary" for="${escapeHtml(inputId)}">${escapeHtml(optLabel)}</label>`;
      }).join('');
      return `<div class="btn-group${sizeClass}" role="group" aria-label="${ariaLabel}">${radios}</div>`;
    }

    const selectClass = size === 'sm' ? 'form-select form-select-sm' : 'form-select';
    const bgClass = isDisabled ? ' bg-light' : '';
    const selectOpts = options.map((opt) => {
      const optValue = String(opt?.value ?? '');
      const selected = valueStr === optValue ? ' selected' : '';
      return `<option value="${escapeHtml(optValue)}"${selected}>${escapeHtml(opt.label || opt.value || '')}</option>`;
    }).join('');
    return `<select class="${selectClass}${bgClass} ${escapeHtml(inputClassToken)}" name="${escapeHtml(groupName)}" data-field-id="${escapeHtml(fieldId)}"${disabledAttr}><option value="">Select...</option>${selectOpts}</select>`;
  }

  return {
    escapeHtml,
    shouldUseBinarySelect,
    buildReportSelectFieldHtml
  };
}));
