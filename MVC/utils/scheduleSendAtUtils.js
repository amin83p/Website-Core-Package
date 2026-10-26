'use strict';

const { zonedWallClockToIso, normalizeTimezoneToken, resolveDefaultTimezone } = require('./timezoneUtils');

function cleanText(value) {
  return String(value || '').trim();
}

function isTruthySendNow(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function buildImmediateSendAtIso() {
  return new Date(Date.now() + 60_000).toISOString();
}

function parseSendAtLocalInput(sendAtLocal, timeZone) {
  const raw = cleanText(sendAtLocal);
  if (!raw) throw new Error('Send date and time are required.');
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) throw new Error('Invalid send date/time format.');
  const tz = normalizeTimezoneToken(timeZone, resolveDefaultTimezone());
  const iso = zonedWallClockToIso(match[1], match[2], tz);
  if (!iso) throw new Error('Could not resolve send time in organization timezone.');
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid send date/time.');
  if (parsed.getTime() < Date.now() - 60000) {
    throw new Error('Send time must be in the future.');
  }
  return iso;
}

function resolveSendAtForSchedule({ sendAtLocal, sendNow, timeZone } = {}) {
  const tz = normalizeTimezoneToken(timeZone, resolveDefaultTimezone());
  if (isTruthySendNow(sendNow)) return buildImmediateSendAtIso();
  return parseSendAtLocalInput(sendAtLocal, tz);
}

function defaultSendAtLocalFromNow(timeZone, offsetMinutes = 60) {
  const tz = normalizeTimezoneToken(timeZone, resolveDefaultTimezone());
  const target = new Date(Date.now() + offsetMinutes * 60_000);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(target);
    const bag = {};
    parts.forEach((part) => {
      if (part.type !== 'literal') bag[part.type] = part.value;
    });
    return `${bag.year}-${bag.month}-${bag.day}T${bag.hour}:${bag.minute}`;
  } catch (_) {
    return target.toISOString().slice(0, 16);
  }
}

module.exports = {
  isTruthySendNow,
  buildImmediateSendAtIso,
  parseSendAtLocalInput,
  resolveSendAtForSchedule,
  defaultSendAtLocalFromNow
};
