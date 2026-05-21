(function () {
  'use strict';

  const EDITOR_SELECTOR = '.js-html-template-editor';
  const SOURCE_SELECTOR = '.js-html-template-editor-source';
  const VISUAL_SELECTOR = '.js-html-template-editor-visual';
  const CODE_SELECTOR = '.js-html-template-editor-code';
  const TOKEN_INPUT_SELECTOR = '.js-html-template-editor-token-input';

  const instances = new Map();

  function asString(value) {
    return String(value == null ? '' : value);
  }

  function hasMarkup(value) {
    return /<\/?[a-z][\s\S]*>/i.test(asString(value));
  }

  function escapeHtml(value) {
    return asString(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return asString(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function plainTextToHtml(text) {
    return escapeHtml(text).replace(/\r?\n/g, '<br>');
  }

  function normalizeForVisual(value) {
    const source = asString(value);
    if (!source.trim()) return '';
    return hasMarkup(source) ? source : plainTextToHtml(source);
  }

  function notify(instance) {
    if (!instance || !instance.root) return;
    const event = new CustomEvent('html-template-editor:change', {
      bubbles: true,
      detail: {
        id: instance.id,
        value: instance.source ? asString(instance.source.value) : ''
      }
    });
    instance.root.dispatchEvent(event);
  }

  function syncFromVisual(instance, { quiet = false } = {}) {
    if (!instance || !instance.visual || !instance.source || !instance.code) return;
    const html = asString(instance.visual.innerHTML || '').trim();
    instance.source.value = html;
    instance.code.value = html;
    if (!quiet) notify(instance);
  }

  function syncFromCode(instance, { quiet = false } = {}) {
    if (!instance || !instance.code || !instance.source || !instance.visual) return;
    const html = asString(instance.code.value || '').trim();
    instance.source.value = html;
    instance.visual.innerHTML = html;
    if (!quiet) notify(instance);
  }

  function setMode(instance, mode) {
    const isCode = mode === 'code';
    instance.mode = isCode ? 'code' : 'design';
    if (instance.visual) instance.visual.classList.toggle('d-none', isCode);
    if (instance.code) instance.code.classList.toggle('d-none', !isCode);
    instance.root.querySelectorAll('[data-html-editor-action="toggle-mode"]').forEach((button) => {
      const active = isCode;
      button.classList.toggle('btn-primary', active);
      button.classList.toggle('btn-outline-secondary', !active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.textContent = active ? 'Design' : 'Code';
      button.setAttribute('title', active ? 'Switch to design editor' : 'Switch to HTML code editor');
    });
  }

  let previewModalEl = null;
  let previewModalInstance = null;

  function ensurePreviewModalElement() {
    if (previewModalEl && document.body.contains(previewModalEl)) return previewModalEl;
    const existing = document.getElementById('htmlTemplateEditorPreviewModal');
    if (existing) {
      previewModalEl = existing;
      return previewModalEl;
    }

    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'htmlTemplateEditorPreviewModal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-dialog" style="width:min(1600px,96vw);max-width:min(1600px,96vw);height:94vh;margin:1.25rem auto;">
        <div class="modal-content border-0 shadow" style="height:100%;">
          <div class="modal-header bg-light">
            <h5 class="modal-title">Template Preview</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body p-0" style="overflow:hidden;">
            <iframe id="htmlTemplateEditorPreviewFrame" title="Template preview" style="width:100%;height:100%;border:0;background:#fff;" sandbox=""></iframe>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    previewModalEl = modal;
    return previewModalEl;
  }

  function ensurePreviewModalInstance() {
    if (!window.bootstrap || !window.bootstrap.Modal) return null;
    const modalEl = ensurePreviewModalElement();
    if (!modalEl) return null;
    previewModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
    return previewModalInstance;
  }

  function openPreviewModal(instance) {
    if (!instance) return;
    if (instance.mode === 'code') syncFromCode(instance, { quiet: true });
    else syncFromVisual(instance, { quiet: true });
    const html = asString(instance.source?.value || '').trim();
    const modalEl = ensurePreviewModalElement();
    const modalInstance = ensurePreviewModalInstance();
    if (!modalEl || !modalInstance) return;

    const titleNode = modalEl.querySelector('.modal-title');
    if (titleNode) {
      titleNode.textContent = 'Template Preview';
    }
    const frame = modalEl.querySelector('#htmlTemplateEditorPreviewFrame');
    if (frame) {
      frame.srcdoc = html || '<div style="font-family:Arial,sans-serif;color:#6c757d;padding:16px;">Preview is empty.</div>';
    }
    modalInstance.show();
  }

  function insertAtCursorInTextarea(textarea, text) {
    if (!textarea) return false;
    const value = asString(text);
    const start = Number(textarea.selectionStart || 0);
    const end = Number(textarea.selectionEnd || 0);
    const current = asString(textarea.value || '');
    textarea.value = current.slice(0, start) + value + current.slice(end);
    const cursor = start + value.length;
    textarea.selectionStart = cursor;
    textarea.selectionEnd = cursor;
    textarea.focus();
    return true;
  }

  function insertText(instance, value) {
    if (!instance || !value) return false;
    if (instance.mode === 'code') {
      const ok = insertAtCursorInTextarea(instance.code, value);
      if (ok) syncFromCode(instance);
      return ok;
    }
    if (instance.visual) instance.visual.focus();
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, value);
    } catch (_) {
      inserted = false;
    }
    if (!inserted && instance.visual) {
      inserted = document.execCommand('insertHTML', false, escapeHtml(value));
    }
    syncFromVisual(instance);
    return inserted;
  }

  function insertHtml(instance, htmlValue) {
    if (!instance) return false;
    const html = asString(htmlValue || '').trim();
    if (!html) return false;

    if (instance.mode === 'code') {
      const inserted = insertAtCursorInTextarea(instance.code, html);
      if (inserted) syncFromCode(instance);
      return inserted;
    }

    if (instance.visual) instance.visual.focus();
    const inserted = document.execCommand('insertHTML', false, html);
    syncFromVisual(instance);
    return Boolean(inserted);
  }

  function insertImage(instance, urlValue, altValue = '') {
    if (!instance) return false;
    const imageUrl = asString(urlValue || '').trim();
    if (!imageUrl) return false;
    const altText = asString(altValue || '').trim();

    if (instance.mode === 'code') {
      const snippet = altText
        ? `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(altText)}">`
        : `<img src="${escapeAttribute(imageUrl)}" alt="">`;
      const inserted = insertAtCursorInTextarea(instance.code, snippet);
      if (inserted) syncFromCode(instance);
      return inserted;
    }

    if (instance.visual) instance.visual.focus();
    document.execCommand('insertImage', false, imageUrl);
    if (altText && instance.visual) {
      const images = instance.visual.querySelectorAll('img');
      const latest = images && images.length ? images[images.length - 1] : null;
      if (latest) latest.setAttribute('alt', altText);
    }
    syncFromVisual(instance);
    return true;
  }

  function normalizeImageDimension(value) {
    const raw = asString(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'auto') return 'auto';
    if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}px`;
    if (/^\d+(\.\d+)?(px|%|em|rem|vw|vh)$/.test(raw)) return raw;
    return null;
  }

  function resolveImageSelectionNode(instance) {
    if (!instance || !instance.visual) return null;
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!selection || !selection.rangeCount) return null;
    let node = selection.anchorNode;
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !(node instanceof Element)) return null;
    if (!instance.visual.contains(node)) return null;
    return node;
  }

  function findSelectedImage(instance) {
    if (!instance || !instance.visual) return null;
    const selectionNode = resolveImageSelectionNode(instance);
    if (selectionNode) {
      if (selectionNode.tagName === 'IMG') return selectionNode;
      const imageNode = selectionNode.closest ? selectionNode.closest('img') : null;
      if (imageNode && instance.visual.contains(imageNode)) return imageNode;
    }
    if (instance.lastSelectedImage && instance.visual.contains(instance.lastSelectedImage)) {
      return instance.lastSelectedImage;
    }
    return null;
  }

  function markSelectedImage(instance, imageNode) {
    if (!instance || !instance.visual) return;
    instance.visual.querySelectorAll('img.__hte-selected-image').forEach((node) => {
      node.classList.remove('__hte-selected-image');
    });
    if (imageNode && imageNode.tagName === 'IMG' && instance.visual.contains(imageNode)) {
      imageNode.classList.add('__hte-selected-image');
      instance.lastSelectedImage = imageNode;
      return;
    }
    instance.lastSelectedImage = null;
  }

  function applyImageSize(instance, imageNode, widthValue, heightValue) {
    if (!instance || !imageNode) return false;
    const width = normalizeImageDimension(widthValue);
    const height = normalizeImageDimension(heightValue);
    if (width === null || height === null) {
      showInlineInfo('Invalid Size', 'Use values like 320, 320px, 50%, or auto.', 'warning');
      return false;
    }

    if (width === '' || width === 'auto') {
      imageNode.style.removeProperty('width');
      imageNode.removeAttribute('width');
      if (width === 'auto') imageNode.style.width = 'auto';
    } else {
      imageNode.style.width = width;
      imageNode.removeAttribute('width');
    }

    if (height === '' || height === 'auto') {
      imageNode.style.removeProperty('height');
      imageNode.removeAttribute('height');
      if (height === 'auto') imageNode.style.height = 'auto';
    } else {
      imageNode.style.height = height;
      imageNode.removeAttribute('height');
    }

    imageNode.style.maxWidth = '100%';
    syncFromVisual(instance);
    return true;
  }

  function openImageSizeDialog(instance) {
    if (!instance) return;
    if (instance.mode === 'code') {
      showInlineInfo('Design Mode Required', 'Switch to Design mode to resize images visually.', 'info');
      return;
    }
    const imageNode = findSelectedImage(instance);
    if (!imageNode) {
      showInlineInfo('Select Image', 'Click an image first, then set its size.', 'info');
      return;
    }
    markSelectedImage(instance, imageNode);
    const currentWidth = asString(imageNode.style.width || imageNode.getAttribute('width') || '').trim();
    const currentHeight = asString(imageNode.style.height || imageNode.getAttribute('height') || '').trim();
    openUtilityInputDialog({
      title: 'Set Image Size',
      confirmText: 'Apply Size',
      fields: [
        { name: 'imageWidth', label: 'Width (px/%/auto)', value: currentWidth, placeholder: '320px or 50%', required: false },
        { name: 'imageHeight', label: 'Height (px/%/auto)', value: currentHeight, placeholder: 'auto', required: false }
      ]
    }).then((values) => {
      if (!values) return;
      applyImageSize(instance, imageNode, values.imageWidth, values.imageHeight);
    });
  }

  function resetImageSize(instance) {
    if (!instance) return;
    if (instance.mode === 'code') {
      showInlineInfo('Design Mode Required', 'Switch to Design mode to resize images visually.', 'info');
      return;
    }
    const imageNode = findSelectedImage(instance);
    if (!imageNode) {
      showInlineInfo('Select Image', 'Click an image first, then reset its size.', 'info');
      return;
    }
    markSelectedImage(instance, imageNode);
    imageNode.style.removeProperty('width');
    imageNode.style.removeProperty('height');
    imageNode.style.maxWidth = '100%';
    imageNode.style.height = 'auto';
    imageNode.removeAttribute('width');
    imageNode.removeAttribute('height');
    syncFromVisual(instance);
  }

  function getEditorHooks() {
    const hooks = window.HtmlTemplateEditorHooks;
    return hooks && typeof hooks === 'object' ? hooks : null;
  }

  function showInlineInfo(title, message, icon = 'info') {
    if (typeof window.showMessageModal === 'function') {
      window.showMessageModal({
        title: asString(title || 'Notice'),
        icon,
        message: asString(message || ''),
        buttons: [{ text: 'OK', class: 'btn-primary' }]
      });
    }
  }

  let utilityModalEl = null;
  let utilityModalInstance = null;

  function ensureUtilityModal() {
    if (utilityModalEl && document.body.contains(utilityModalEl)) return utilityModalEl;
    const existing = document.getElementById('htmlTemplateEditorUtilityModal');
    if (existing) {
      utilityModalEl = existing;
      return utilityModalEl;
    }

    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'htmlTemplateEditorUtilityModal';
    modal.tabIndex = -1;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow">
          <div class="modal-header bg-light">
            <h5 class="modal-title" id="htmlTemplateEditorUtilityModalTitle">Input</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <form id="htmlTemplateEditorUtilityModalForm" class="d-flex flex-column gap-3"></form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="htmlTemplateEditorUtilityModalConfirm">Insert</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    utilityModalEl = modal;
    return utilityModalEl;
  }

  function ensureUtilityModalInstance() {
    if (!window.bootstrap || !window.bootstrap.Modal) return null;
    const modalEl = ensureUtilityModal();
    if (!modalEl) return null;
    utilityModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
    return utilityModalInstance;
  }

  function openUtilityInputDialog({
    title = 'Input',
    confirmText = 'Insert',
    fields = []
  } = {}) {
    return new Promise((resolve) => {
      const modalEl = ensureUtilityModal();
      const modalInstance = ensureUtilityModalInstance();
      if (!modalEl || !modalInstance) {
        resolve(null);
        return;
      }

      const titleEl = modalEl.querySelector('#htmlTemplateEditorUtilityModalTitle');
      const formEl = modalEl.querySelector('#htmlTemplateEditorUtilityModalForm');
      const confirmBtn = modalEl.querySelector('#htmlTemplateEditorUtilityModalConfirm');
      if (!titleEl || !formEl || !confirmBtn) {
        resolve(null);
        return;
      }

      titleEl.textContent = asString(title || 'Input');
      confirmBtn.textContent = asString(confirmText || 'Insert');
      formEl.innerHTML = '';

      const normalizedFields = (Array.isArray(fields) ? fields : []).map((field, idx) => ({
        name: asString(field?.name || `field_${idx + 1}`),
        label: asString(field?.label || `Field ${idx + 1}`),
        type: asString(field?.type || 'text').toLowerCase(),
        value: asString(field?.value || ''),
        placeholder: asString(field?.placeholder || ''),
        required: field?.required === true
      }));

      normalizedFields.forEach((field) => {
        const wrap = document.createElement('div');
        wrap.className = 'mb-1';

        const label = document.createElement('label');
        label.className = 'form-label small text-muted fw-bold text-uppercase';
        label.textContent = field.label + (field.required ? ' *' : '');
        label.setAttribute('for', `htmlTemplateEditorUtility_${field.name}`);

        const input = document.createElement('input');
        input.className = 'form-control';
        input.type = field.type || 'text';
        input.id = `htmlTemplateEditorUtility_${field.name}`;
        input.name = field.name;
        input.value = field.value;
        input.placeholder = field.placeholder;
        if (field.required) input.required = true;

        wrap.appendChild(label);
        wrap.appendChild(input);
        formEl.appendChild(wrap);
      });

      let settled = false;
      const cleanup = () => {
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        confirmBtn.removeEventListener('click', onConfirm);
      };
      const onHidden = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      };
      const onConfirm = () => {
        const values = {};
        let invalid = false;
        normalizedFields.forEach((field) => {
          const input = formEl.querySelector(`[name="${field.name}"]`);
          const value = asString(input?.value || '').trim();
          if (field.required && !value) invalid = true;
          values[field.name] = value;
        });
        if (invalid) {
          showInlineInfo('Missing Input', 'Please complete required fields.', 'warning');
          return;
        }
        settled = true;
        cleanup();
        resolve(values);
        modalInstance.hide();
      };

      modalEl.addEventListener('hidden.bs.modal', onHidden, { once: true });
      confirmBtn.addEventListener('click', onConfirm);
      modalInstance.show();
      setTimeout(() => {
        const firstInput = formEl.querySelector('input');
        if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
      }, 120);
    });
  }

  function executeCommand(instance, command, arg) {
    if (!instance) return;
    if (command === 'insertImage') {
      const hooks = getEditorHooks();
      if (hooks && typeof hooks.onInsertImage === 'function') {
        const handled = hooks.onInsertImage({
          editorId: instance.id,
          mode: instance.mode,
          command,
          instance
        });
        if (handled !== false) return;
      }
      openUtilityInputDialog({
        title: 'Insert Image',
        confirmText: 'Insert Image',
        fields: [
          { name: 'imageUrl', label: 'Image URL', placeholder: 'https://... or /uploads/...', required: true },
          { name: 'altText', label: 'Alt Text (Optional)', placeholder: 'Describe this image', required: false }
        ]
      }).then((values) => {
        if (!values) return;
        const imageUrl = asString(values.imageUrl || '').trim();
        const altText = asString(values.altText || '').trim();
        if (!imageUrl) return;
        insertImage(instance, imageUrl, altText);
      });
      return;
    }

    if (instance.mode === 'code') return;
    if (instance.visual) instance.visual.focus();
    if (command === 'createLink') {
      const hooks = getEditorHooks();
      if (hooks && typeof hooks.onCreateLink === 'function') {
        const handled = hooks.onCreateLink({
          editorId: instance.id,
          mode: instance.mode,
          command,
          instance
        });
        if (handled !== false) return;
      }
      openUtilityInputDialog({
        title: 'Insert Link',
        confirmText: 'Insert Link',
        fields: [
          { name: 'linkUrl', label: 'URL', placeholder: 'https://...', required: true }
        ]
      }).then((values) => {
        const link = asString(values?.linkUrl || '').trim();
        if (!link) return;
        if (instance.visual) instance.visual.focus();
        document.execCommand('createLink', false, link);
        syncFromVisual(instance);
      });
      return;
    }
    if (command === 'removeFormat') {
      document.execCommand('removeFormat', false, null);
      syncFromVisual(instance);
      return;
    }
    if (command === 'formatBlock') {
      document.execCommand('formatBlock', false, arg || 'p');
      syncFromVisual(instance);
      return;
    }
    document.execCommand(command, false, arg || null);
    syncFromVisual(instance);
  }

  function attachHandlers(instance) {
    if (!instance) return;
    const { root, visual, code, source, tokenInput } = instance;
    if (!root || !visual || !code || !source) return;

    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-html-editor-command], [data-html-editor-action]');
      if (!button) return;
      event.preventDefault();
      if (button.disabled) return;

      const command = button.getAttribute('data-html-editor-command');
      if (command) {
        const arg = button.getAttribute('data-html-editor-command-arg') || '';
        executeCommand(instance, command, arg);
        return;
      }

      const action = button.getAttribute('data-html-editor-action');
      if (!action) return;
      if (action === 'toggle-mode') {
        setMode(instance, instance.mode === 'code' ? 'design' : 'code');
        return;
      }
      if (action === 'toggle-preview') {
        openPreviewModal(instance);
        return;
      }
      if (action === 'image-size') {
        openImageSizeDialog(instance);
        return;
      }
      if (action === 'image-reset-size') {
        resetImageSize(instance);
        return;
      }
      if (action === 'insert-token') {
        const tokenRaw = tokenInput ? asString(tokenInput.value || '').trim() : '';
        if (!tokenRaw) return;
        insertText(instance, tokenRaw);
        if (tokenInput) tokenInput.focus();
      }
    });

    visual.addEventListener('input', () => syncFromVisual(instance));
    visual.addEventListener('blur', () => syncFromVisual(instance));
    visual.addEventListener('click', (event) => {
      const imageNode = event.target && event.target.closest ? event.target.closest('img') : null;
      if (imageNode && instance.visual.contains(imageNode)) {
        markSelectedImage(instance, imageNode);
        return;
      }
      markSelectedImage(instance, null);
    });
    visual.addEventListener('dblclick', (event) => {
      const imageNode = event.target && event.target.closest ? event.target.closest('img') : null;
      if (!imageNode || !instance.visual.contains(imageNode)) return;
      markSelectedImage(instance, imageNode);
      openImageSizeDialog(instance);
    });
    code.addEventListener('input', () => syncFromCode(instance));
    code.addEventListener('blur', () => syncFromCode(instance));

    const form = root.closest('form');
    if (form) {
      form.addEventListener('submit', () => {
        if (instance.mode === 'code') syncFromCode(instance, { quiet: true });
        else syncFromVisual(instance, { quiet: true });
      });
    }
  }

  function createInstance(root) {
    if (!root) return null;
    const id = asString(root.getAttribute('data-html-editor-id') || root.id || '').trim() || `htmlEditor_${instances.size + 1}`;
    const source = root.querySelector(SOURCE_SELECTOR);
    const visual = root.querySelector(VISUAL_SELECTOR);
    const code = root.querySelector(CODE_SELECTOR);
    const tokenInput = root.querySelector(TOKEN_INPUT_SELECTOR);
    if (!source || !visual || !code) return null;

    const instance = {
      id,
      root,
      source,
      visual,
      code,
      tokenInput,
      mode: 'design'
    };

    const initial = asString(source.value || '');
    visual.innerHTML = normalizeForVisual(initial);
    code.value = visual.innerHTML;
    source.value = visual.innerHTML;
    setMode(instance, root.getAttribute('data-default-mode') === 'code' ? 'code' : 'design');

    attachHandlers(instance);
    instances.set(id, instance);
    return instance;
  }

  function init(target) {
    if (target instanceof Element) {
      return createInstance(target);
    }
    const roots = target
      ? Array.from(document.querySelectorAll(target))
      : Array.from(document.querySelectorAll(EDITOR_SELECTOR));
    return roots.map((root) => createInstance(root)).filter(Boolean);
  }

  function getInstance(id) {
    return instances.get(asString(id).trim()) || null;
  }

  function insertTextById(id, value) {
    const instance = getInstance(id);
    if (!instance) return false;
    return insertText(instance, value);
  }

  function insertHtmlById(id, htmlValue) {
    const instance = getInstance(id);
    if (!instance) return false;
    return insertHtml(instance, htmlValue);
  }

  function insertImageById(id, urlValue, altValue = '') {
    const instance = getInstance(id);
    if (!instance) return false;
    return insertImage(instance, urlValue, altValue);
  }

  function syncOne(id, { quiet = true } = {}) {
    const instance = getInstance(id);
    if (!instance) return false;
    if (instance.mode === 'code') syncFromCode(instance, { quiet });
    else syncFromVisual(instance, { quiet });
    return true;
  }

  function setValue(id, value, { mode = '' } = {}) {
    const instance = getInstance(id);
    if (!instance) return false;
    const normalized = asString(value || '');
    instance.source.value = normalized;
    instance.visual.innerHTML = normalizeForVisual(normalized);
    instance.code.value = instance.visual.innerHTML;
    if (mode === 'code' || mode === 'design') {
      setMode(instance, mode);
    }
    notify(instance);
    return true;
  }

  function getValue(id) {
    const instance = getInstance(id);
    if (!instance) return '';
    if (instance.mode === 'code') syncFromCode(instance, { quiet: true });
    else syncFromVisual(instance, { quiet: true });
    return asString(instance.source.value || '');
  }

  function setModeById(id, mode) {
    const instance = getInstance(id);
    if (!instance) return false;
    setMode(instance, mode);
    return true;
  }

  function syncAll() {
    instances.forEach((instance) => {
      if (!instance) return;
      if (instance.mode === 'code') syncFromCode(instance, { quiet: true });
      else syncFromVisual(instance, { quiet: true });
    });
  }

  window.HtmlTemplateEditor = {
    init,
    getInstance,
    insertText: insertTextById,
    insertHtml: insertHtmlById,
    insertImage: insertImageById,
    sync: syncOne,
    syncAll,
    setValue,
    getValue,
    setMode: setModeById
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-html-editor-insert]');
    if (!trigger) return;
    const text = asString(trigger.getAttribute('data-html-editor-insert') || '').trim();
    const targetId = asString(trigger.getAttribute('data-html-editor-target') || '').trim();
    if (!text) return;
    if (!targetId) return;
    event.preventDefault();
    insertTextById(targetId, text);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();
