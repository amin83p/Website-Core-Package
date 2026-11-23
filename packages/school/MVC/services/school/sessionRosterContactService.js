'use strict';

const schoolPersonAccessService = require('./schoolPersonAccessService');

function normalizePersonId(value) {
  return String(value || '').trim();
}

function isPlausibleEmail(value) {
  const email = String(value || '').trim();
  if (!email || !email.includes('@')) return false;
  const parts = email.split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

/**
 * @param {Array<{ personId?: string, name?: string }>} roster
 * @param {Map<string, object>|Record<string, object>} personById
 * @returns {Record<string, { name: string, email: string }>}
 */
function buildAttendanceRosterEmailMap(roster, personById) {
  const rows = Array.isArray(roster) ? roster : [];
  const lookup = personById instanceof Map
    ? (id) => personById.get(normalizePersonId(id))
    : (id) => (personById && typeof personById === 'object' ? personById[normalizePersonId(id)] : null);

  const map = {};
  rows.forEach((row) => {
    const personId = normalizePersonId(row?.personId);
    if (!personId || map[personId]) return;
    const person = lookup(personId) || null;
    const name = String(row?.name || '').trim()
      || schoolPersonAccessService.formatPersonName(person, personId)
      || personId;
    const email = schoolPersonAccessService.readPersonEmail(person || {});
    map[personId] = { name, email };
  });
  return map;
}

/**
 * @param {Array<{ email?: string }>|string[]} entries — objects with email or raw strings
 * @returns {string} comma-separated unique valid emails
 */
function formatEmailsForClipboard(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  const ordered = [];
  list.forEach((entry) => {
    const raw = typeof entry === 'string' ? entry : entry?.email;
    const email = String(raw || '').trim();
    if (!isPlausibleEmail(email)) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(email);
  });
  return ordered.join(', ');
}

module.exports = {
  buildAttendanceRosterEmailMap,
  formatEmailsForClipboard,
  isPlausibleEmail
};