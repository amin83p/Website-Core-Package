(function () {
  'use strict';

  const DEFAULT_MODAL_ID = 'htmlTemplateEditorModal';
  const DEFAULT_EDITOR_ID = 'htmlTemplateEditorModalEditor';

  const state = {
    modalId: DEFAULT_MODAL_ID,
    editorId: DEFAULT_EDITOR_ID,
    target: null,
    options: {}
  };

  function asString(value) {
    return String(value == null ? '' : value);
  }

  function getModalElement() {
    return document.getElementById(state.modalId);
  }

  function ensureModalInstance() {
    const modalEl = getModalElement();
    if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) return null;
    return window.bootstrap.Modal.getOrCreateInstance(modalEl);
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    if (typeof target === 'string') {
      try {
        return document.querySelector(target);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function dispatchChange(target) {
    if (!target) return;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setModalTitle(text) {
    const modalEl = getModalElement();
    if (!modalEl) return;
    const node = modalEl.querySelector('.js-html-template-modal-title');
    if (!node) return;
    node.textContent = asString(text || '').trim() || 'Template Editor';
  }

  function normalizeToken(value) {
    return asString(value || '').trim();
  }

  function buildTokenBadge(token, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary font-monospace';
    button.textContent = label || token;
    button.dataset.tokenValue = token;
    return button;
  }

  function renderTokens(tokens = []) {
    const modalEl = getModalElement();
    if (!modalEl) return;
    const wrap = modalEl.querySelector('.js-html-template-modal-tokens-wrap');
    const holder = modalEl.querySelector('.js-html-template-modal-tokens');
    if (!holder || !wrap) return;
    holder.innerHTML = '';

    const normalized = (Array.isArray(tokens) ? tokens : [])
      .map((token) => normalizeToken(token))
      .filter(Boolean);

    if (!normalized.length) {
      wrap.classList.add('d-none');
      return;
    }

    normalized.forEach((token) => {
      const wrapped = token.startsWith('{{') ? token : `{{${token}}}`;
      holder.appendChild(buildTokenBadge(wrapped, wrapped));
    });
    wrap.classList.remove('d-none');
  }

  function setEditorValue(value) {
    if (!window.HtmlTemplateEditor || typeof window.HtmlTemplateEditor.setValue !== 'function') return false;
    return window.HtmlTemplateEditor.setValue(state.editorId, asString(value || ''), { mode: state.options.mode || 'design' });
  }

  function getEditorValue() {
    if (!window.HtmlTemplateEditor || typeof window.HtmlTemplateEditor.getValue !== 'function') return '';
    return asString(window.HtmlTemplateEditor.getValue(state.editorId));
  }

  function insertToken(tokenValue) {
    if (!tokenValue) return;
    if (!window.HtmlTemplateEditor || typeof window.HtmlTemplateEditor.insertText !== 'function') return;
    window.HtmlTemplateEditor.insertText(state.editorId, tokenValue);
  }

  function saveToTarget() {
    const target = state.target;
    if (!target) return false;
    const html = getEditorValue();
    target.value = html;
    dispatchChange(target);
    return true;
  }

  function open(config = {}) {
    const target = resolveTarget(config.target || config.targetSelector || null);
    if (!target) return false;

    state.target = target;
    state.options = {
      ...config
    };

    setModalTitle(config.title || target.getAttribute('data-html-template-title') || 'Template Editor');
    renderTokens(Array.isArray(config.tokens) ? config.tokens : []);
    setEditorValue(asString(target.value || ''));

    const modalInstance = ensureModalInstance();
    if (!modalInstance) return false;
    modalInstance.show();
    return true;
  }

  function close() {
    const modalInstance = ensureModalInstance();
    if (!modalInstance) return;
    modalInstance.hide();
  }

  function bindDomEvents() {
    const modalEl = getModalElement();
    if (!modalEl) return;

    const saveBtn = modalEl.querySelector('.js-html-template-modal-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const ok = saveToTarget();
        if (ok) close();
      });
    }

    const tokenWrap = modalEl.querySelector('.js-html-template-modal-tokens');
    if (tokenWrap) {
      tokenWrap.addEventListener('click', (event) => {
        const button = event.target.closest('[data-token-value]');
        if (!button) return;
        event.preventDefault();
        insertToken(asString(button.getAttribute('data-token-value') || ''));
      });
    }

    modalEl.addEventListener('shown.bs.modal', () => {
      const instance = window.HtmlTemplateEditor && window.HtmlTemplateEditor.getInstance
        ? window.HtmlTemplateEditor.getInstance(state.editorId)
        : null;
      if (instance && instance.visual && !instance.visual.classList.contains('d-none')) {
        instance.visual.focus();
      } else if (instance && instance.code) {
        instance.code.focus();
      }
    });

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-open-html-template-modal]');
      if (!trigger) return;
      event.preventDefault();
      const targetSelector = asString(trigger.getAttribute('data-html-template-target') || '').trim();
      const title = asString(trigger.getAttribute('data-html-template-title') || '').trim();
      const tokensRaw = asString(trigger.getAttribute('data-html-template-tokens') || '').trim();
      const tokens = tokensRaw
        ? tokensRaw.split(',').map((token) => normalizeToken(token)).filter(Boolean)
        : [];
      open({
        target: targetSelector,
        title: title || 'Template Editor',
        tokens
      });
    });
  }

  window.HtmlTemplateEditorModal = {
    open,
    close,
    saveToTarget
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDomEvents);
  } else {
    bindDomEvents();
  }
})();
