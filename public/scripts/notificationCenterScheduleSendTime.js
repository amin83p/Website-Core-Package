(function () {
  'use strict';

  const IMMEDIATE_SUMMARY = 'This email will be sent as soon as possible (next outbox dispatch).';

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

  function formatLocalDateTimeSummary(parts, timeZone) {
    if (!parts) return '';
    const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
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
      }).format(utcGuess);
    } catch (_) {
      return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
    }
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

  function bind(options = {}) {
    const inputEl = options.inputEl;
    const summaryEl = options.summaryEl;
    const sendNowInputEl = options.sendNowInputEl;
    const timeZone = asString(options.timeZone);
    const timeZoneHintEl = options.timeZoneHintEl;
    const sendNowBtn = options.sendNowBtn;
    const schedulePanelEl = options.schedulePanelEl;

    if (!inputEl || !summaryEl) return null;

    if (timeZoneHintEl && timeZone) {
      timeZoneHintEl.textContent = `Organization timezone: ${timeZone}`;
    }

    function setSendNowActive(active) {
      if (sendNowInputEl) sendNowInputEl.value = active ? '1' : '';
      if (schedulePanelEl) schedulePanelEl.classList.toggle('nc-schedule-send-immediate', Boolean(active));
      if (active) {
        inputEl.removeAttribute('required');
        summaryEl.innerHTML = `<strong>${IMMEDIATE_SUMMARY}</strong>`;
        return;
      }
      inputEl.setAttribute('required', 'required');
      updateSummaryFromInput();
    }

    function updateSummaryFromInput() {
      const parts = parseDateTimeLocalValue(inputEl.value);
      if (!parts) {
        summaryEl.textContent = 'Choose a send date and time below.';
        return;
      }
      const formatted = formatLocalDateTimeSummary(parts, timeZone);
      summaryEl.innerHTML = formatted
        ? `This email will be sent: <strong>${formatted}</strong>`
        : 'Choose a send date and time below.';
    }

    inputEl.addEventListener('input', () => {
      if (sendNowInputEl) sendNowInputEl.value = '';
      if (schedulePanelEl) schedulePanelEl.classList.remove('nc-schedule-send-immediate');
      updateSummaryFromInput();
    });
    inputEl.addEventListener('change', updateSummaryFromInput);

    sendNowBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      setSendNowActive(true);
    });

    setSendNowActive(sendNowInputEl && sendNowInputEl.value === '1');
    if (!sendNowInputEl || sendNowInputEl.value !== '1') {
      updateSummaryFromInput();
    }

    return {
      refresh: updateSummaryFromInput,
      activateSendNow: () => setSendNowActive(true),
      clearSendNow: () => setSendNowActive(false),
      formatIsoSummary: (iso) => formatIsoSummary(iso, timeZone)
    };
  }

  window.NotificationCenterScheduleSendTime = {
    bind,
    formatIsoSummary,
    formatLocalDateTimeSummary
  };
})();
