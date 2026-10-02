'use strict';

const {
  listDefaultTimeFrames,
  defaultDayBounds
} = require('../../config/schedulingTimePolicyCatalog');

function normalizeClockTime(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  const match = token.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Math.max(0, Math.min(23, Number(match[1] || 0)));
  const mm = Math.max(0, Math.min(59, Number(match[2] || 0)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const clock = normalizeClockTime(value);
  if (!clock) return NaN;
  const [hh, mm] = clock.split(':').map(Number);
  return hh * 60 + mm;
}

function minutesToClock(totalMinutes) {
  const mins = Number(totalMinutes);
  if (!Number.isFinite(mins)) return '';
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function slugFrameId(label, index) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'frame';
  return `${base}_${index + 1}`;
}

function normalizeDayBounds(input = {}) {
  const defaults = defaultDayBounds();
  const earliestStart = normalizeClockTime(input.earliestStart) || defaults.earliestStart;
  const latestEnd = normalizeClockTime(input.latestEnd) || defaults.latestEnd;
  const startMin = timeToMinutes(earliestStart);
  const endMin = timeToMinutes(latestEnd);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
    const error = new Error('Earliest class start must be before latest class end.');
    error.statusCode = 400;
    throw error;
  }
  return { earliestStart, latestEnd };
}

function normalizeTimeFrames(input = [], dayBounds = null) {
  const bounds = dayBounds || defaultDayBounds();
  const boundStart = timeToMinutes(bounds.earliestStart);
  const boundEnd = timeToMinutes(bounds.latestEnd);
  const raw = Array.isArray(input) ? input : [];
  const source = raw.length ? raw : listDefaultTimeFrames();
  const frames = source.map((row, index) => {
    const startTime = normalizeClockTime(row?.startTime);
    const endTime = normalizeClockTime(row?.endTime);
    const label = String(row?.label || '').trim() || `Frame ${index + 1}`;
    const id = String(row?.id || '').trim() || slugFrameId(label, index);
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
      const error = new Error(`Time frame "${label}" must have a valid start before end.`);
      error.statusCode = 400;
      throw error;
    }
    if (startMin < boundStart || endMin > boundEnd) {
      const error = new Error(`Time frame "${label}" must fall within day bounds (${bounds.earliestStart}–${bounds.latestEnd}).`);
      error.statusCode = 400;
      throw error;
    }
    return {
      id,
      label,
      startTime,
      endTime,
      sortOrder: Number(row?.sortOrder) > 0 ? Number(row.sortOrder) : index + 1
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));

  if (!frames.length) {
    const error = new Error('At least one scheduling time frame is required.');
    error.statusCode = 400;
    throw error;
  }

  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      const a = frames[i];
      const b = frames[j];
      const aStart = timeToMinutes(a.startTime);
      const aEnd = timeToMinutes(a.endTime);
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);
      if (aStart < bEnd && bStart < aEnd) {
        const error = new Error(`Time frames "${a.label}" and "${b.label}" overlap.`);
        error.statusCode = 400;
        throw error;
      }
    }
  }
  return frames;
}

function normalizePolicyFromStored(input = {}) {
  const dayBounds = normalizeDayBounds(input.dayBounds || {});
  const timeFrames = normalizeTimeFrames(input.timeFrames, dayBounds);
  return { dayBounds, timeFrames };
}

function parseTimeFramesJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      const error = new Error('Time frames must be valid JSON.');
      error.statusCode = 400;
      throw error;
    }
  }
  return [];
}

function normalizePolicyFromForm(input = {}) {
  const dayBounds = normalizeDayBounds({
    earliestStart: input.earliestStart ?? input?.dayBounds?.earliestStart,
    latestEnd: input.latestEnd ?? input?.dayBounds?.latestEnd
  });
  const timeFrames = normalizeTimeFrames(parseTimeFramesJson(input.timeFrames), dayBounds);
  return { dayBounds, timeFrames };
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function validatePolicyInput(input = {}) {
  return normalizePolicyFromForm(input);
}

function intersectIntervalMinutes(frameStart, frameEnd, busyStart, busyEnd) {
  const start = Math.max(frameStart, busyStart);
  const end = Math.min(frameEnd, busyEnd);
  return end > start ? end - start : 0;
}

function freeMinutesInFrame(frame, busyIntervals = []) {
  const frameStart = timeToMinutes(frame.startTime);
  const frameEnd = timeToMinutes(frame.endTime);
  if (!Number.isFinite(frameStart) || !Number.isFinite(frameEnd) || frameStart >= frameEnd) return 0;
  let busy = 0;
  (Array.isArray(busyIntervals) ? busyIntervals : []).forEach((row) => {
    const s = timeToMinutes(row?.startTime || row?.start);
    const e = timeToMinutes(row?.endTime || row?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) return;
    busy += intersectIntervalMinutes(frameStart, frameEnd, s, e);
  });
  const total = frameEnd - frameStart;
  return Math.max(0, total - busy);
}

module.exports = {
  normalizeClockTime,
  timeToMinutes,
  minutesToClock,
  normalizeDayBounds,
  normalizeTimeFrames,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  validatePolicyInput,
  freeMinutesInFrame,
  intersectIntervalMinutes
};
