'use strict';

function normalizePresence(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return 'X';
  return text;
}

function slotPresence(value) {
  const marks = [...new Set(String(value ?? '')
    .split(/[\n/]/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part && part !== 'X'))];
  if (!marks.length) return 'X';
  if (marks.length === 1) return marks[0];
  return marks.join('/');
}

function mergeTwoClassPresence(amPresence, pmPresence) {
  const am = slotPresence(amPresence);
  const pm = slotPresence(pmPresence);
  if (am === 'X' && pm === 'X') return 'X';
  if (am === pm) return am;
  return `${am}/${pm}`;
}

function collapsePresence(value) {
  const text = String(value ?? '').trim();
  if (!text.includes('/')) return normalizePresence(text);
  const parts = text.split('/').map((part) => normalizePresence(part));
  if (parts.length && parts.every((part) => part === parts[0])) return parts[0];
  return parts.join('/');
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

const SLOT_POPULATED_ANCHOR_KEYS = [
  'student_full_name',
  'class_name',
  'report_period_start_date',
  'report_period_due_date'
];

function isSourceSlotPopulated(slotBag) {
  if (!slotBag || typeof slotBag !== 'object') return false;
  if (SLOT_POPULATED_ANCHOR_KEYS.some((key) => String(slotBag[key] ?? '').trim())) return true;
  return Object.values(slotBag).some((value) => String(value ?? '').trim() !== '');
}

function hasClassThatDay(presence) {
  return slotPresence(presence) !== 'X';
}

function flexTwoClassPresence(amPresence, pmPresence, pmSlotActive) {
  if (!pmSlotActive) return slotPresence(amPresence);
  const amActive = hasClassThatDay(amPresence);
  const pmActive = hasClassThatDay(pmPresence);
  if (amActive && pmActive) return mergeTwoClassPresence(amPresence, pmPresence);
  if (pmActive) return slotPresence(pmPresence);
  if (amActive) return slotPresence(amPresence);
  return 'X';
}

function cleanAttendanceNote(note) {
  return String(note ?? '').replace(/not in the report date range/ig, '').trim();
}

function flexTwoClassNote(amPresence, amNote, pmPresence, pmNote, pmSlotActive) {
  if (!pmSlotActive) {
    const am = normalizePresence(amPresence);
    if (am === 'X') return '';
    return cleanAttendanceNote(amNote);
  }
  const amActive = hasClassThatDay(amPresence);
  const pmActive = hasClassThatDay(pmPresence);
  if (amActive && pmActive) return mergeTwoClassNote(amPresence, cleanAttendanceNote(amNote), pmPresence, cleanAttendanceNote(pmNote));
  if (pmActive) return cleanAttendanceNote(pmNote);
  if (amActive) return cleanAttendanceNote(amNote);
  return '';
}

module.exports = {
  normalizePresence,
  mergeTwoClassPresence,
  collapsePresence,
  formatAttendanceNoteWithPeriod,
  mergeSlotNote,
  mergeTwoClassNote,
  isSourceSlotPopulated,
  flexTwoClassPresence,
  flexTwoClassNote
};
