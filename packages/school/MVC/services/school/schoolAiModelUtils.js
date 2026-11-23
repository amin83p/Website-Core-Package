'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { encrypt, decrypt } = requireCoreModule('MVC/utils/encyptors');

const PROVIDER_VENDOR_OPTIONS = Object.freeze([
  { id: 'google-gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI (ChatGPT/API)' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'azure-openai', label: 'Azure OpenAI' },
  { id: 'custom', label: 'Custom Provider' }
]);

const USAGE_PERIOD_TYPES = Object.freeze(['daily', 'weekly', 'monthly']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanId(value, { max = 120, allowEmpty = true } = {}) {
  const token = cleanString(value, { max, allowEmpty });
  if (token === null) return null;
  if (!token && allowEmpty) return '';
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) throw new Error('Invalid id format.');
  return token;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function buildKeyHint(rawApiKey = '') {
  const key = String(rawApiKey || '').trim();
  if (!key) return '';
  if (key.length <= 4) return `***${key}`;
  return `***${key.slice(-4)}`;
}

function generateDatedId(prefix, existingRows = []) {
  const existing = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  const dateToken = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `${prefix}${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${prefix}${Date.now()}`;
}

function normalizeModelsList(rawList, { strict = false } = {}) {
  const source = Array.isArray(rawList) ? rawList : [];
  const out = [];
  const seen = new Set();
  source.forEach((entry, index) => {
    const row = isPlainObject(entry) ? entry : {};
    const modelId = cleanString(row.modelId, { max: 220, allowEmpty: true });
    if (!modelId && strict) throw new Error(`Model row ${index + 1} requires a model id.`);
    if (!modelId) return;
    if (/\s/.test(modelId)) {
      throw new Error(`Model row ${index + 1}: "${modelId}" is not a valid API model id (use Fetch from vendor, not the display name).`);
    }
    if (modelId.includes('models/')) {
      throw new Error(`Model row ${index + 1}: use the model id only (e.g. gemini-2.5-flash), without the models/ prefix.`);
    }
    const key = modelId.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const id = cleanId(row.id, { max: 120, allowEmpty: true }) || `mdl_${out.length + 1}`;
    out.push({
      id,
      label: cleanString(row.label, { max: 220, allowEmpty: true }) || modelId,
      modelId,
      isActive: hasOwn(row, 'isActive') ? normalizeBoolean(row.isActive, true) : normalizeBoolean(row.isActive, true),
      notes: cleanString(row.notes, { max: 2000, allowEmpty: true }) || ''
    });
  });
  return out;
}

function normalizeBannedUserIds(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',').map((t) => t.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    const id = cleanId(item, { max: 120, allowEmpty: true });
    if (!id) return;
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
  });
  return out;
}

function buildAudit(userId = 'SYSTEM', existing = null) {
  const now = new Date().toISOString();
  const base = isPlainObject(existing) ? existing : {};
  const actor = cleanString(userId, { max: 120, allowEmpty: true }) || 'SYSTEM';
  return {
    createUser: cleanString(base.createUser, { max: 120, allowEmpty: true }) || actor,
    createDateTime: cleanString(base.createDateTime, { max: 80, allowEmpty: true }) || now,
    lastUpdateUser: actor,
    lastUpdateDateTime: now
  };
}

module.exports = {
  PROVIDER_VENDOR_OPTIONS,
  USAGE_PERIOD_TYPES,
  encrypt,
  decrypt,
  isPlainObject,
  hasOwn,
  cleanString,
  cleanId,
  normalizeBoolean,
  cleanIsoDateTime,
  buildKeyHint,
  generateDatedId,
  normalizeModelsList,
  normalizeBannedUserIds,
  buildAudit
};