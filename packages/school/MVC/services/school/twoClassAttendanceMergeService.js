'use strict';

function normalizePresence(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return 'X';
  return text;
}

function mergeTwoClassPresence(amPresence, pmPresence) {
  const am = normalizePresence(amPresence);
  const pm = normalizePresence(pmPresence);
  if (am === 'X' && pm === 'X') return 'X';
  return `${am}/${pm}`;
}

function formatAttendanceNoteWithPeriod(note, period) {
  const suffix = ` ${period}`;
  const text = String(note ?? '').trim();
  if (!text) return `Present${suffix}`;
  return text
    .split(' - ')
    .map((part) => {
      const trimmed = String(part || '').trim();
      if (!trimmed) return '';
      if (/\s(AM|PM)$/i.test(trimmed)) return trimmed;
      return `${trimmed}${suffix}`;
    })
    .filter(Boolean)
    .join(' - ');
}

function mergeSlotNote(presence, note, period, otherPresence) {
  const normalized = normalizePresence(presence);
  const other = normalizePresence(otherPresence);
  if (normalized === 'X') {
    if (other === 'X') return '';
    return `No Class ${period}`;
  }
  if (normalized === '*') return `Not Marked ${period}`;
  return formatAttendanceNoteWithPeriod(note, period);
}

function mergeTwoClassNote(amPresence, amNote, pmPresence, pmNote) {
  const am = normalizePresence(amPresence);
  const pm = normalizePresence(pmPresence);
  if (am === 'X' && pm === 'X') return '';
  const amPart = mergeSlotNote(am, amNote, 'AM', pm);
  const pmPart = mergeSlotNote(pm, pmNote, 'PM', am);
  return `${amPart}/${pmPart}`;
}

module.exports = {
  normalizePresence,
  mergeTwoClassPresence,
  formatAttendanceNoteWithPeriod,
  mergeSlotNote,
  mergeTwoClassNote
};
