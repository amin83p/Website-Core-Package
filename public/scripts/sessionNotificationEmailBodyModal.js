(function () {
  'use strict';

  const MODAL_ID = 'sessionNotificationEmailBodyModal';
  const EDITOR_ID = 'sessionNotificationEmailBodyEditor';
  const CUSTOM_ROWS_ID = 'sessionNotificationEmailWrapperCustomRows';
  const VALUE_KINDS = ['source', 'literal', 'template'];

  const state = {
    canUpdate: false,
    contextSources: [],
    onSave: null
  };

  function asString(value) {
    return String(value == null ? '' : value);
  }

  function getModalElement() {
    return document.getElementById(MODAL_ID);
  }

  function ensureModalInstance() {
    const modalEl = getModalElement();
    if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) return null;
    return window.bootstrap.Modal.getOrCreateInstance(modalEl);
  }

  function cleanWrapperToken(value = '') {
    return asString(value).trim().toUpperCase().replace(/^\{\{|\}\}$/g, '');
  }

  function normalizeValueKind(value = '') {
    const token = asString(value).trim().toLowerCase();
    return VALUE_KINDS.includes(token) ? token : 'source';
  }

  function normalizeCustomMappingRow(row = {}) {
    return {
      token: cleanWrapperToken(row.token),
      label: asString(row.label).trim().slice(0, 120),
      valueKind: normalizeValueKind(row.valueKind),
      sourceKey: asString(row.sourceKey).trim(),
      literalValue: asString(row.literalValue).trim(),
      templateValue: asString(row.templateValue).trim()
    };
  }

  function buildSourceOptions(selected = '') {
    const options = ['<option value="">Select source field</option>'];
    state.contextSources.forEach((sourceKey) => {
      const value = asString(sourceKey).trim();
      if (!value) return;
      const isSelected = value.toLowerCase() === asString(selected).trim().toLowerCase() ? ' selected' : '';
      options.push(`<option value="${value.replace(/"/g, '&quot;')}"${isSelected}>${value}</option>`);
    });
    return options.join('');
  }

  function buildValueKindOptions(selected = 'source') {
    const valueKind = normalizeValueKind(selected);
    return VALUE_KINDS.map((kind) => {
      const label = kind === 'source' ? 'Context field' : (kind === 'literal' ? 'Literal text' : 'Body template');
      const isSelected = kind === valueKind ? ' selected' : '';
      return `<option value="${kind}"${isSelected}>${label}</option>`;
    }).join('');
  }

  function renderValueInput(row = {}, disabled = false) {
    const valueKind = normalizeValueKind(row.valueKind);
    const disabledAttr = disabled ? ' disabled' : '';
    if (valueKind === 'literal') {
      return `<input class="form-control form-control-sm js-wrapper-mapping-literal" type="text" maxlength="500" placeholder="Literal value" value="${asString(row.literalValue).replace(/"/g, '&quot;')}"${disabledAttr}>`;
    }
    if (valueKind === 'template') {
      return `<input class="form-control form-control-sm js-wrapper-mapping-template" type="text" maxlength="2000" placeholder="e.g. {{teacherName}} at {{orgName}}" value="${asString(row.templateValue).replace(/"/g, '&quot;')}"${disabledAttr}>`;
    }
    return `<select class="form-select form-select-sm js-wrapper-mapping-source"${disabledAttr}>${buildSourceOptions(row.sourceKey)}</select>`;
  }

  function buildCustomRowHtml(row = {}, { readOnly = false } = {}) {
    const normalized = normalizeCustomMappingRow(row);
    const disabledAttr = readOnly ? ' disabled' : '';
    const removeBtn = readOnly
      ? ''
      : '<button class="btn btn-sm btn-outline-danger js-wrapper-mapping-remove" type="button" title="Remove mapping" aria-label="Remove mapping"><i class="bi bi-trash"></i></button>';
    return `
      <tr class="js-wrapper-mapping-custom-row">
        <td><input class="form-control form-control-sm js-wrapper-mapping-label" type="text" maxlength="120" placeholder="Optional label" value="${normalized.label.replace(/"/g, '&quot;')}"${disabledAttr}></td>
        <td><input class="form-control form-control-sm font-monospace js-wrapper-mapping-token" type="text" maxlength="64" placeholder="SITE_CONTACT" value="${normalized.token.replace(/"/g, '&quot;')}"${disabledAttr}></td>
        <td><select class="form-select form-select-sm js-wrapper-mapping-kind"${disabledAttr}>${buildValueKindOptions(normalized.valueKind)}</select></td>
        <td class="js-wrapper-mapping-value-cell">${renderValueInput(normalized, readOnly)}</td>
        <td class="text-center">${removeBtn}</td>
      </tr>
    `;
  }

  function getCustomRowsContainer() {
    return document.getElementById(CUSTOM_ROWS_ID);
  }

  function renderCustomRows(rows = []) {
    const container = getCustomRowsContainer();
    if (!container) return;
    const list = Array.isArray(rows) ? rows : [];
    container.innerHTML = list.map((row) => buildCustomRowHtml(row, { readOnly: !state.canUpdate })).join('');
  }

  function addCustomRow(row = {}) {
    if (!state.canUpdate) return;
    const container = getCustomRowsContainer();
    if (!container) return;
    container.insertAdjacentHTML('beforeend', buildCustomRowHtml(row, { readOnly: false }));
  }

  function collectCustomMappings() {
    const container = getCustomRowsContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.js-wrapper-mapping-custom-row')).map((rowEl) => {
      const valueKind = normalizeValueKind(rowEl.querySelector('.js-wrapper-mapping-kind')?.value);
      return normalizeCustomMappingRow({
        label: rowEl.querySelector('.js-wrapper-mapping-label')?.value,
        token: rowEl.querySelector('.js-wrapper-mapping-token')?.value,
        valueKind,
        sourceKey: valueKind === 'source' ? rowEl.querySelector('.js-wrapper-mapping-source')?.value : '',
        literalValue: valueKind === 'literal' ? rowEl.querySelector('.js-wrapper-mapping-literal')?.value : '',
        templateValue: valueKind === 'template' ? rowEl.querySelector('.js-wrapper-mapping-template')?.value : ''
      });
    }).filter((row) => row.token || row.label || row.sourceKey || row.literalValue || row.templateValue);
  }

  function setEditorValue(value) {
    if (!window.HtmlTemplateEditor || typeof window.HtmlTemplateEditor.setValue !== 'function') return false;
    return window.HtmlTemplateEditor.setValue(EDITOR_ID, asString(value || ''), { mode: 'design' });
  }

  function getEditorValue() {
    if (!window.HtmlTemplateEditor || typeof window.HtmlTemplateEditor.getValue !== 'function') return '';
    return asString(window.HtmlTemplateEditor.getValue(EDITOR_ID));
  }

  function open(config = {}) {
    const modalInstance = ensureModalInstance();
    if (!modalInstance) return false;

    renderCustomRows(config.customMappings || []);
    setEditorValue(config.bodyValue || '');

    state.onSave = typeof config.onSave === 'function' ? config.onSave : null;
    modalInstance.show();
    return true;
  }

  function close() {
    const modalInstance = ensureModalInstance();
    if (!modalInstance) return;
    modalInstance.hide();
  }

  function save() {
    const payload = {
      bodyTemplate: getEditorValue(),
      wrapperPlaceholderMappings: collectCustomMappings()
    };
    if (typeof state.onSave === 'function') {
      state.onSave(payload);
    }
    close();
    return payload;
  }

  function bindDomEvents() {
    const modalEl = getModalElement();
    if (!modalEl) return;

    document.getElementById('sessionNotificationEmailWrapperMappingAddBtn')?.addEventListener('click', () => {
      addCustomRow();
    });

    document.getElementById('sessionNotificationEmailBodyModalSaveBtn')?.addEventListener('click', () => {
      save();
    });

    const customContainer = getCustomRowsContainer();
    if (customContainer) {
      customContainer.addEventListener('click', (event) => {
        const removeBtn = event.target.closest('.js-wrapper-mapping-remove');
        if (!removeBtn) return;
        event.preventDefault();
        removeBtn.closest('.js-wrapper-mapping-custom-row')?.remove();
      });

      customContainer.addEventListener('change', (event) => {
        const kindSelect = event.target.closest('.js-wrapper-mapping-kind');
        if (!kindSelect) return;
        const rowEl = kindSelect.closest('.js-wrapper-mapping-custom-row');
        if (!rowEl) return;
        const valueCell = rowEl.querySelector('.js-wrapper-mapping-value-cell');
        if (!valueCell) return;
        const row = normalizeCustomMappingRow({
          valueKind: kindSelect.value,
          sourceKey: rowEl.querySelector('.js-wrapper-mapping-source')?.value,
          literalValue: rowEl.querySelector('.js-wrapper-mapping-literal')?.value,
          templateValue: rowEl.querySelector('.js-wrapper-mapping-template')?.value
        });
        valueCell.innerHTML = renderValueInput(row, !state.canUpdate);
      });
    }
  }

  function init(config = {}) {
    state.canUpdate = config.canUpdate === true;
    state.contextSources = Array.isArray(config.contextSources) ? config.contextSources.slice() : [];
    const dataNode = document.getElementById('sessionNotificationEmailContextSourcesData');
    if (dataNode && !state.contextSources.length) {
      try {
        const parsed = JSON.parse(dataNode.textContent || '[]');
        if (Array.isArray(parsed)) state.contextSources = parsed;
      } catch (_) {
        state.contextSources = [];
      }
    }
    bindDomEvents();
  }

  window.SessionNotificationEmailBodyModal = {
    init,
    open,
    close,
    save,
    collectCustomMappings
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init({}));
  } else {
    init({});
  }
})();
