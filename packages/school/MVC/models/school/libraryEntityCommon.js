'use strict';

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const cleaned = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function cleanId(value, { max = 80, allowEmpty = false } = {}) {
  const cleaned = cleanString(value, { max, allowEmpty });
  if (cleaned === null) return null;
  if (!cleaned) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) throw new Error('Invalid id format.');
  return cleaned;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(fallback);
}

function cleanInt(value, { min = 0, max = 99999, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return Number(fallback);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) throw new Error(`Value must be between ${min} and ${max}.`);
  return rounded;
}

function generateEntityId(prefix) {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${year}-${random}`;
}

function buildAudit(existing = {}, userId = 'SYSTEM') {
  const now = new Date().toISOString();
  const current = existing && typeof existing === 'object' ? existing : {};
  return {
    createUser: cleanString(current.createUser, { max: 80, allowEmpty: true }) || String(userId || 'SYSTEM'),
    createDateTime: cleanString(current.createDateTime, { max: 40, allowEmpty: true }) || now,
    lastUpdateUser: String(userId || 'SYSTEM'),
    lastUpdateDateTime: now
  };
}

module.exports = {
  cleanString,
  cleanId,
  cleanBoolean,
  cleanInt,
  generateEntityId,
  buildAudit
};
