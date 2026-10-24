(function () {
  'use strict';

  const SCHEDULE_LABEL = 'Schedule';
  const CONFIRM_SCHEDULE_LABEL = 'Confirm schedule';
  const MODAL_PICKER_ID = 'ncScheduleSendAtMessageModalPicker';

  function asString(value) {
    return String(value == null ? '' : value);
  }

  function parseDateTimeLocalValue(value) {
    const raw = asString(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5])
    };
  }

  function formatIsoSummary(iso, timeZone) {
    const ms = Date.parse(asString(iso));
    if (!Number.isFinite(ms)) return '';
    const tz = asString(timeZone).trim() || 'UTC';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      }).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toLocaleString();
    }
  }

  function escapeHtml(text) {
    return asString(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildScheduleMessageModalHtml(timeZone, defaultSendAtLocal) {
    const tzLine = timeZone
      ? `<div class="form-text small mb-0 mt-1">Organization timezone: ${escapeHtml(timeZone)}</div>`
      : '';
    const valueAttr = escapeHtml(defaultSendAtLocal);
    return (
      '<p class="mb-3 small text-muted">Choose when this email should be sent. Times use your organization timezone.</p>'
      + '<label class="form-label fw-bold small mb-1" for="' + MODAL_PICKER_ID + '">'
      + '<i class="bi bi-calendar-event me-1 text-primary"></i>Send at</label>'
      + '<input class="form-control size-md" type="datetime-local" id="' + MODAL_PICKER_ID + '" value="' + valueAttr + '">'
      + tzLine
    );
  }

  function readPickerValueAfterModalClose() {
    const picker = document.getElementById(MODAL_PICKER_ID);
    return picker ? asString(picker.value).trim() : '';
  }

  /**
   * Opens the global message modal to pick send datetime (above other modals).
   * @returns {Promise<string|null>} sendAtLocal value, or null if cancelled / unavailable
   */
  async function promptScheduleSendAtMessageModal(options = {}) {
    const timeZone = asString(options.timeZone);
    const defaultSendAtLocal = asString(options.defaultSendAtLocal);
    const showModal = typeof window.showMessageModal === 'function'
      ? window.showMessageModal
      : null;

    if (!showModal) {
      return null;
    }

    const choice = await showModal({
      title: 'Schedule send time',
      icon: 'info',
      size: 'sm',
      message: buildScheduleMessageModalHtml(timeZone, defaultSendAtLocal),
      buttons: [
        { text: 'Cancel', class: 'btn-secondary' },
        { text: CONFIRM_SCHEDULE_LABEL, class: 'btn-primary' }
      ]
    });

    if (choice !== CONFIRM_SCHEDULE_LABEL) {
      return null;
    }

    const picked = readPickerValueAfterModalClose();
    if (!parseDateTimeLocalValue(picked)) {
      await showModal({
        title: 'Invalid time',
        icon: 'warning',
        message: 'Please choose a valid date and time.',
        buttons: [{ text: 'OK', class: 'btn-primary' }]
      });
      return null;
    }

    return picked;
  }

  /**
   * Footer-driven schedule flow: Send now vs message modal for datetime, then submit.
   */
  function createScheduleController(options = {}) {
    const sendAtInput = options.sendAtInput;
    const sendNowInput = options.sendNowInput;
    const scheduleBtn = options.scheduleBtn;
    const timeZone = asString(options.timeZone);
    const onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : () => {};

    let defaultSendAtLocal = asString(options.defaultSendAtLocal);

    function setScheduleButtonLabel() {
      if (!scheduleBtn) return;
      scheduleBtn.innerHTML = `<i class="bi bi-calendar-event me-1"></i>${SCHEDULE_LABEL}`;
      scheduleBtn.classList.remove('btn-primary');
      scheduleBtn.classList.add('btn-outline-primary');
    }

    function reset() {
      setScheduleButtonLabel();
      if (sendNowInput) sendNowInput.value = '';
      if (sendAtInput) {
        sendAtInput.value = defaultSendAtLocal;
      }
    }

    function setDefaultSendAtLocal(value) {
      defaultSendAtLocal = asString(value);
      if (sendAtInput) {
        sendAtInput.value = defaultSendAtLocal;
      }
    }

    function submitSendNow() {
      if (sendNowInput) sendNowInput.value = '1';
      if (sendAtInput) sendAtInput.value = '';
      onSubmit();
    }

    async function submitSchedule() {
      const currentDefault = asString(sendAtInput?.value).trim() || defaultSendAtLocal;
      const picked = await promptScheduleSendAtMessageModal({
        timeZone,
        defaultSendAtLocal: currentDefault
      });
      if (!picked) return;

      if (sendNowInput) sendNowInput.value = '';
      if (sendAtInput) sendAtInput.value = picked;
      onSubmit();
    }

    reset();

    return {
      reset,
      setDefaultSendAtLocal,
      submitSendNow,
      submitSchedule,
      isScheduleStepOpen: () => false
    };
  }

  /** @deprecated Use createScheduleController */
  function bind(options = {}) {
    return createScheduleController({
      sendAtInput: options.inputEl,
      sendNowInput: options.sendNowInputEl,
      scheduleBtn: options.sendNowBtn,
      timeZone: options.timeZone,
      defaultSendAtLocal: options.defaultSendAtLocal,
      onSubmit: () => {}
    });
  }

  window.NotificationCenterScheduleSendTime = {
    createScheduleController,
    bind,
    formatIsoSummary,
    promptScheduleSendAtMessageModal,
    parseDateTimeLocalValue,
    buildScheduleMessageModalHtml,
    MODAL_PICKER_ID
  };
})();
