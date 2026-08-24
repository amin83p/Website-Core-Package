'use strict';

const CLB_BAND_REGEX = /CLB[\s-]*(\d{1,2})/i;

/**
 * Parse the lower CLB band from subject code or title (e.g. EAL-CLB5-6 → 5).
 * @param {string} text
 * @returns {number|null}
 */
function parseLowerClbBandFromText(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const match = s.match(CLB_BAND_REGEX);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

module.exports = {
  CLB_BAND_REGEX,
  parseLowerClbBandFromText
};
