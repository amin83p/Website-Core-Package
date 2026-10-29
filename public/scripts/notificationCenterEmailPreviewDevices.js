(function () {
  'use strict';

  const DEVICE_CLASSES = ['nc-preview--mobile', 'nc-preview--tablet', 'nc-preview--desktop'];

  function bindDevicePreview(options = {}) {
    const shellEl = options.shellEl;
    const buttons = options.buttons || {};
    if (!shellEl) return null;

    function setDevice(mode) {
      const token = String(mode || 'desktop').toLowerCase();
      shellEl.classList.remove(...DEVICE_CLASSES);
      if (token === 'mobile') shellEl.classList.add('nc-preview--mobile');
      else if (token === 'tablet') shellEl.classList.add('nc-preview--tablet');
      else shellEl.classList.add('nc-preview--desktop');

      Object.keys(buttons).forEach((key) => {
        const btn = buttons[key];
        if (!btn) return;
        const active = key === token;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    if (buttons.mobile) {
      buttons.mobile.addEventListener('click', (e) => {
        e.preventDefault();
        setDevice('mobile');
      });
    }
    if (buttons.tablet) {
      buttons.tablet.addEventListener('click', (e) => {
        e.preventDefault();
        setDevice('tablet');
      });
    }
    if (buttons.desktop) {
      buttons.desktop.addEventListener('click', (e) => {
        e.preventDefault();
        setDevice('desktop');
      });
    }

    setDevice('desktop');
    return { setDevice };
  }

  function prepareEmailPreviewSrcdoc(html) {
    let doc = String(html || '');
    if (!doc) return '';
    const origin = String(window.location.origin || '').trim().replace(/\/$/, '');
    if (origin) {
      doc = doc.replace(/\bsrc=(["'])(\/[^"']+)\1/gi, (_, quote, path) => `src=${quote}${origin}${path}${quote}`);
      doc = doc.replace(
        /\bsrc=(["'])https?:\/\/[^"']+(\/uploads\/[^"']+)\1/gi,
        (_, quote, path) => `src=${quote}${origin}${path}${quote}`
      );
      doc = doc.replace(/\bhref=(["'])(\/uploads\/[^"']+)\1/gi, (_, quote, path) => `href=${quote}${origin}${path}${quote}`);
    }
    if (/<base[\s>]/i.test(doc)) return doc;
    if (/<head[\s>]/i.test(doc)) {
      const safeOrigin = origin ? `${origin}/` : '/';
      return doc.replace(/<head(\s[^>]*)?>/i, (match) => `${match}<base href="${safeOrigin.replace(/"/g, '&quot;')}">`);
    }
    return doc;
  }

  window.NotificationCenterEmailPreviewDevices = {
    bindDevicePreview,
    prepareEmailPreviewSrcdoc
  };
})();
