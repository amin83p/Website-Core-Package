(function initNewsNotifySchedule(global) {
  if (!global) return;

  function asString(value) {
    return String(value == null ? '' : value);
  }

  function parseDateTimeLocalValue(value) {
    const raw = asString(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return null;
    return raw;
  }

  function createNewsNotifyScheduleController(options = {}) {
    const sendAtInput = options.sendAtInput;
    const sendNowInput = options.sendNowInput;
    const scheduleBtn = options.scheduleBtn;
    const sendNowBtn = options.sendNowBtn;
    const timeZone = asString(options.timeZone);
    let defaultSendAtLocal = asString(options.defaultSendAtLocal);

    function setSendAtLocal(value) {
      if (sendAtInput) sendAtInput.value = asString(value);
    }

    function clearSendNow() {
      if (sendNowInput) sendNowInput.value = '';
    }

    function markSendNow() {
      if (sendNowInput) sendNowInput.value = '1';
      if (sendAtInput) sendAtInput.value = '';
    }

    function resetScheduleLabel() {
      if (!scheduleBtn) return;
      scheduleBtn.innerHTML = '<i class="bi bi-calendar-event me-1"></i>Schedule send';
      scheduleBtn.classList.remove('btn-primary');
      scheduleBtn.classList.add('btn-outline-primary');
    }

    if (sendNowBtn) {
      sendNowBtn.addEventListener('click', () => {
        markSendNow();
        resetScheduleLabel();
      });
    }

    if (scheduleBtn && sendAtInput) {
      scheduleBtn.addEventListener('click', async () => {
        const current = parseDateTimeLocalValue(sendAtInput.value) || defaultSendAtLocal;
        const picked = global.prompt
          ? null
          : current;
        if (typeof global.showMessageModal === 'function') {
          const tzLine = timeZone
            ? `<div class="form-text small">Organization timezone: ${timeZone}</div>`
            : '';
          const choice = await global.showMessageModal({
            title: 'Schedule send time',
            icon: 'info',
            size: 'sm',
            message: `<label class="form-label fw-bold small">Send at</label>`
              + `<input type="datetime-local" class="form-control" id="newsNotifySchedulePicker" value="${current}">`
              + tzLine,
            buttons: [
              { text: 'Cancel', class: 'btn-secondary', value: 'cancel' },
              { text: 'Confirm', class: 'btn-primary', value: 'confirm' }
            ]
          });
          if (choice !== 'confirm') return;
          const picker = document.getElementById('newsNotifySchedulePicker');
          const value = picker ? asString(picker.value).trim() : '';
          if (!parseDateTimeLocalValue(value)) {
            await global.showMessageModal({
              title: 'Invalid time',
              icon: 'warning',
              message: 'Choose a valid future date and time.',
              buttons: [{ text: 'OK', class: 'btn-primary', value: 'ok' }]
            });
            return;
          }
          clearSendNow();
          setSendAtLocal(value);
          scheduleBtn.innerHTML = '<i class="bi bi-calendar-check me-1"></i>Scheduled';
          scheduleBtn.classList.add('btn-primary');
          scheduleBtn.classList.remove('btn-outline-primary');
          return;
        }
        clearSendNow();
        setSendAtLocal(picked || current);
      });
    }

    setSendAtLocal(defaultSendAtLocal);

    return {
      markSendNow,
      setDefaultSendAtLocal(value) {
        defaultSendAtLocal = asString(value);
        if (!parseDateTimeLocalValue(sendAtInput?.value)) {
          setSendAtLocal(defaultSendAtLocal);
        }
      }
    };
  }

  global.NewsNotifySchedule = {
    createNewsNotifyScheduleController
  };
}(typeof window !== 'undefined' ? window : null));
