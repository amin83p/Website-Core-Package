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

  window.NotificationCenterEmailPreviewDevices = {
    bindDevicePreview
  };
})();
