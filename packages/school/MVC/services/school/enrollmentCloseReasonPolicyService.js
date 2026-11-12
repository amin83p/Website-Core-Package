'use strict';

const MAX_REASON_LENGTH = 200;

const DEFAULT_REASONS = Object.freeze([
  'Completed program requirements.',
  'Completed agreed session count or hours.',
  'Student withdrew — personal or family reasons.',
  'Student withdrew — relocation.',
  'Transferred to another class.',
  'Funding or claim period ended.',
  'No longer able to attend.',
  'Scheduling conflict — could not continue.',
  'Student requested closure.',
  'Administrative closure.',
  'Moved to extension enrollment.',
  'Placed on hold — enrollment closed pending return.'
]);

const DEFAULT_POLICY = Object.freeze({
  reasons: DEFAULT_REASONS.map((row) => String(row)),
  usesCustomList: false
});

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeReasons(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  rows.forEach((row) => {
    const text = cleanText(row).slice(0, MAX_REASON_LENGTH);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function sortReasonsForDisplay(reasons) {
  const rows = Array.isArray(reasons) ? reasons : [];
  return [...rows].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
}

function normalizePolicyFromStored(stored) {
  const custom = normalizeReasons(stored?.reasons);
  if (!custom.length) {
    return {
      reasons: sortReasonsForDisplay([...DEFAULT_REASONS]),
      usesCustomList: false
    };
  }
  return {
    reasons: sortReasonsForDisplay(custom),
    usesCustomList: true
  };
}

function normalizePolicyFromForm(patch) {
  const reasons = normalizeReasons(patch?.reasons);
  if (!reasons.length) {
    throw new Error('At least one enrollment close reason is required.');
  }
  return {
    reasons: sortReasonsForDisplay(reasons),
    usesCustomList: true
  };
}

function resolvePolicy(stored) {
  if (!stored || typeof stored !== 'object') {
    return {
      reasons: sortReasonsForDisplay([...DEFAULT_REASONS]),
      usesCustomList: false
    };
  }
  return normalizePolicyFromStored(stored);
}

module.exports = {
  DEFAULT_REASONS,
  DEFAULT_POLICY,
  MAX_REASON_LENGTH,
  normalizeReasons,
  sortReasonsForDisplay,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy
};
