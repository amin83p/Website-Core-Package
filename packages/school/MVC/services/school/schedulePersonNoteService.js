'use strict';

const MAX_NOTE_LENGTH = 5000;

function normalizePersonId(value) {
  return String(value || '').trim();
}

function normalizeNoteText(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length > MAX_NOTE_LENGTH) {
    throw new Error(`Schedule note cannot exceed ${MAX_NOTE_LENGTH} characters.`);
  }
  return text;
}

function emptyNoteDto(personId = '') {
  return {
    personId: normalizePersonId(personId),
    note: '',
    updatedAt: '',
    updatedBy: ''
  };
}

function toNoteDto(personId, stored = null) {
  const pid = normalizePersonId(personId);
  if (!stored || typeof stored !== 'object') {
    return emptyNoteDto(pid);
  }
  return {
    personId: pid,
    note: String(stored.note || '').trim(),
    updatedAt: String(stored.updatedAt || '').trim(),
    updatedBy: String(stored.updatedBy || '').trim()
  };
}

function buildStoredNote(noteText, auditUserId) {
  const note = normalizeNoteText(noteText);
  const nowIso = new Date().toISOString();
  if (!note) {
    return null;
  }
  return {
    note,
    updatedAt: nowIso,
    updatedBy: String(auditUserId || 'system').trim() || 'system'
  };
}

module.exports = {
  MAX_NOTE_LENGTH,
  normalizePersonId,
  normalizeNoteText,
  emptyNoteDto,
  toNoteDto,
  buildStoredNote
};
