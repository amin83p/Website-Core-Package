(function (global) {
  'use strict';

  let formatMessageBody = null;

  function htmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function plainTextFromHtml(value) {
    return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeIcon(iconOrType) {
    const token = String(iconOrType || 'info').trim().toLowerCase();
    if (['info', 'success', 'warning', 'error', 'question'].includes(token)) return token;
    if (token === 'danger') return 'error';
    return 'info';
  }

  function defaultButtonClass(icon) {
    if (icon === 'error') return 'btn-danger';
    if (icon === 'warning') return 'btn-warning';
    if (icon === 'success') return 'btn-success';
    return 'btn-primary';
  }

  function resolveBody(message, options = {}) {
    if (typeof formatMessageBody === 'function') {
      return formatMessageBody(message, options);
    }
    if (options.html === true) return String(message || '');
    return htmlEscape(String(message || ''));
  }

  async function showAlert(title, iconOrType, message, options = {}) {
    const icon = normalizeIcon(iconOrType);
    const body = resolveBody(message, options);
    const buttons = Array.isArray(options.buttons) && options.buttons.length
      ? options.buttons
      : [{ text: String(options.okText || 'OK').trim() || 'OK', class: options.buttonClass || defaultButtonClass(icon) }];

    if (typeof global.showMessageModal === 'function') {
      const modalOptions = { title: String(title || 'Message'), icon, message: body, buttons };
      if (options.size) modalOptions.size = options.size;
      await global.showMessageModal(modalOptions);
      return;
    }
    const plain = options.html ? plainTextFromHtml(body) : String(message || '');
    global.alert(plain || String(title || 'Message'));
  }

  async function showConfirm(message, title = 'Confirm', options = {}) {
    const icon = normalizeIcon(options.icon || 'warning');
    const body = resolveBody(message, options);
    const cancelText = String(options.cancelText || 'Cancel').trim() || 'Cancel';
    const confirmText = String(options.confirmText || 'Confirm').trim() || 'Confirm';

    if (typeof global.showMessageModal === 'function') {
      const result = await global.showMessageModal({
        title: String(title || 'Confirm'),
        icon,
        message: body,
        size: options.size || 'md',
        buttons: [
          { text: cancelText, class: String(options.cancelClass || 'btn-secondary').trim() || 'btn-secondary' },
          {
            text: confirmText,
            class: String(
              options.confirmClass || (icon === 'warning' ? 'btn-warning' : 'btn-primary')
            ).trim() || 'btn-primary'
          }
        ]
      });
      return result === confirmText || result === true;
    }
    const plain = options.html ? plainTextFromHtml(body) : String(message || '');
    return global.confirm(plain || String(title || 'Confirm'));
  }

  function createClaimManagerMessaging() {
    return {
      showMsg: (title, iconOrType, message, options) => showAlert(title, iconOrType, message, options),
      showConfirm: (message, title, options) => showConfirm(message, title, options)
    };
  }

  function configure(options = {}) {
    if (typeof options.formatMessageBody === 'function') {
      formatMessageBody = options.formatMessageBody;
    }
  }

  global.SchoolMessageUi = {
    configure,
    normalizeIcon,
    showAlert,
    showConfirm,
    createClaimManagerMessaging
  };
})(typeof window !== 'undefined' ? window : global);
