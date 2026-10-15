'use strict';

const TITLE_MAX_LENGTH = 160;

const FORMAT_TOKENS = Object.freeze({
  one_on_one: '1',
  group: 'G'
});

const PLACEHOLDER_PATTERN = /\{\{\s*(teacherName|period|format|startDate)\s*\}\}/gi;
const DEPRECATED_DELIVERY_PLACEHOLDER = /\{\{\s*delivery\s*\}\}/i;

function cleanString(value, max = TITLE_MAX_LENGTH) {
  const s = String(value || '').replace(/\0/g, '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function normalizePeriod(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'AM' || raw === 'PM') return raw;
  throw new Error('Period must be AM or PM.');
}

function normalizeFormat(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'one_on_one' || raw === '1-on-1' || raw === '1on1' || raw === '1') return FORMAT_TOKENS.one_on_one;
  if (raw === 'group' || raw === 'g') return FORMAT_TOKENS.group;
  throw new Error('Format must be 1-on-1 or Group.');
}

function normalizeStartDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Start date must use YYYY-MM-DD.');
  return s;
}

function assertTitlePatternAllowsNoDeliveryPlaceholder(pattern) {
  const rawPattern = String(pattern || '').trim();
  if (DEPRECATED_DELIVERY_PLACEHOLDER.test(rawPattern)) {
    throw new Error(
      'Title pattern must not use {{delivery}}. Use separate templates for In-Person vs Online and put the delivery segment as literal text (e.g. I, OL).'
    );
  }
}

function buildTokenMap(inputs = {}) {
  return {
    teacherName: cleanString(inputs.teacherName, 120),
    period: inputs.period ? normalizePeriod(inputs.period) : '',
    format: inputs.format ? normalizeFormat(inputs.format) : '',
    startDate: inputs.startDate ? normalizeStartDate(inputs.startDate) : ''
  };
}

function collapseSeparators(title) {
  return String(title || '')
    .replace(/[-_/]{2,}/g, (match) => match[0])
    .replace(/^[-_/]+|[-_/]+$/g, '')
    .trim();
}

function applyTitlePattern(pattern, inputs = {}) {
  assertTitlePatternAllowsNoDeliveryPlaceholder(pattern);
  const tokenMap = buildTokenMap(inputs);
  const rawPattern = String(pattern || '').trim();
  if (!rawPattern) throw new Error('Class title pattern is required on the template.');

  let title = rawPattern.replace(PLACEHOLDER_PATTERN, (_full, key) => {
    const lookup = String(key || '').trim().toLowerCase();
    if (lookup === 'teachername') return tokenMap.teacherName;
    if (lookup === 'period') return tokenMap.period;
    if (lookup === 'format') return tokenMap.format;
    if (lookup === 'startdate') return tokenMap.startDate;
    return '';
  });

  title = collapseSeparators(title);
  title = cleanString(title, TITLE_MAX_LENGTH);
  if (!title) throw new Error('Resolved class title is empty. Check the template pattern and inputs.');
  return title;
}

function previewTitle(pattern, inputs = {}) {
  return applyTitlePattern(pattern, inputs);
}

module.exports = {
  TITLE_MAX_LENGTH,
  FORMAT_TOKENS,
  applyTitlePattern,
  previewTitle,
  buildTokenMap,
  assertTitlePatternAllowsNoDeliveryPlaceholder,
  normalizePeriod,
  normalizeFormat
};
