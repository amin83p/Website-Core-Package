'use strict';

/**
 * Fix common UTF-8 mojibake (smart punctuation read as Latin-1 / double-encoded).
 * Order matters: longer / more specific sequences first.
 */
const REPLACEMENTS = [
  ['أ¢â‚¬â€œ', '–'],
  ['أ¢â‚¬â„¢', "'"],
  ['\u00e2\u20ac\u201d', '—'],
  ['\u00e2\u20ac\u201c', '—'],
  ['\u00e2\u20ac\u2013', '–'],
  ['\u00e2\u20ac\u00a6', '…'],
  ['\u00e2\u20ac\u2122', "'"],
  ['\u00e2\u20ac\u0099', "'"],
  ['â€"', '—'],
  ['â€"', '—'],
  ['â€“', '–'],
  ['â€™', "'"],
  ['â€¦', '…']
];

function fixMojibakeText(value) {
  if (typeof value !== 'string' || !value) return value;
  let out = value;
  for (const [bad, good] of REPLACEMENTS) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out;
}

function fixMojibakeDeep(value) {
  if (typeof value === 'string') return fixMojibakeText(value);
  if (Array.isArray(value)) return value.map((item) => fixMojibakeDeep(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = fixMojibakeDeep(nested);
    }
    return out;
  }
  return value;
}

function containsMojibake(value) {
  if (typeof value === 'string') {
    return REPLACEMENTS.some(([bad]) => value.includes(bad));
  }
  if (Array.isArray(value)) return value.some((item) => containsMojibake(item));
  if (value && typeof value === 'object') {
    return Object.values(value).some((nested) => containsMojibake(nested));
  }
  return false;
}

module.exports = {
  REPLACEMENTS,
  fixMojibakeText,
  fixMojibakeDeep,
  containsMojibake
};
