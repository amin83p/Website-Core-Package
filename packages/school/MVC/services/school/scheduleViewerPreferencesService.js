'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const userSettingsService = requireCoreModule('MVC/services/userSettingsService');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const SETTINGS_ROOT = 'schoolScheduleViewer';
const MAX_PERSONS = 50;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function normalizeUserId(userId) {
  return toPublicId(userId);
}

function normalizeIsoDate(value) {
  const cleaned = String(value || '').trim();
  if (!ISO_DATE_RE.test(cleaned)) return '';
  const date = new Date(`${cleaned}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return cleaned;
}

function normalizePersonEntry(entry = {}) {
  const id = String(entry?.id || entry?.personId || '').trim();
  if (!id) return null;
  const name = String(entry?.name || entry?.displayName || '').trim() || id;
  const selectedRole = String(entry?.selectedRole || '').trim();
  return {
    id,
    name,
    ...(selectedRole ? { selectedRole } : {})
  };
}

function normalizePersons(persons = []) {
  const list = Array.isArray(persons) ? persons : [];
  const seen = new Set();
  const next = [];
  list.forEach((entry) => {
    const normalized = normalizePersonEntry(entry);
    if (!normalized || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    next.push(normalized);
  });
  return next.slice(0, MAX_PERSONS);
}

function emptyPreferences() {
  return {
    startDate: '',
    endDate: '',
    activePersonId: '',
    persons: [],
    autoChangeDetector: true
  };
}

function extractPreferences(source = {}) {
  if (!isPlainObject(source)) return emptyPreferences();
  const persons = normalizePersons(source.persons);
  const activePersonId = String(source.activePersonId || '').trim();
  const validActive = persons.some((person) => person.id === activePersonId)
    ? activePersonId
    : (persons[0]?.id || '');
  const startDate = normalizeIsoDate(source.startDate);
  const endDate = normalizeIsoDate(source.endDate);
  let autoChangeDetector = true;
  if (typeof source.autoChangeDetector === 'boolean') {
    autoChangeDetector = source.autoChangeDetector;
  }
  return {
    startDate,
    endDate,
    activePersonId: validActive,
    persons,
    autoChangeDetector
  };
}

function hasSavedPreferences(prefs = {}) {
  const normalized = extractPreferences(prefs);
  return Boolean(
    normalized.startDate
    || normalized.endDate
    || normalized.persons.length
  );
}

function sanitizeForAccess(prefs = {}, access = {}) {
  const normalized = extractPreferences(prefs);
  if (access.canSelectAnyPerson) {
    return normalized;
  }
  const lockedPersonId = String(access.lockedPersonId || '').trim();
  if (!lockedPersonId) {
    return {
      ...emptyPreferences(),
      autoChangeDetector: normalized.autoChangeDetector
    };
  }
  const lockedName = String(access.lockedPersonName || '').trim() || lockedPersonId;
  const lockedPerson = normalized.persons.find((person) => person.id === lockedPersonId);
  return {
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    activePersonId: lockedPersonId,
    persons: [{
      id: lockedPersonId,
      name: lockedPerson?.name || lockedName,
      ...(lockedPerson?.selectedRole ? { selectedRole: lockedPerson.selectedRole } : {})
    }],
    autoChangeDetector: normalized.autoChangeDetector
  };
}

function readEntry(settings = {}) {
  return isPlainObject(settings?.[SETTINGS_ROOT]) ? settings[SETTINGS_ROOT] : {};
}

function buildNextSettings(currentSettings = {}, prefs = {}) {
  const next = clonePlainObject(currentSettings);
  const normalized = extractPreferences(prefs);
  if (!hasSavedPreferences(normalized)) {
    delete next[SETTINGS_ROOT];
    return next;
  }
  next[SETTINGS_ROOT] = normalized;
  return next;
}

function mergePreferences(current = {}, incoming = {}) {
  const base = extractPreferences(current);
  const next = { ...base };
  if (Object.prototype.hasOwnProperty.call(incoming, 'startDate')) {
    next.startDate = normalizeIsoDate(incoming.startDate);
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'endDate')) {
    next.endDate = normalizeIsoDate(incoming.endDate);
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'activePersonId')) {
    next.activePersonId = String(incoming.activePersonId || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'persons')) {
    next.persons = normalizePersons(incoming.persons);
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'autoChangeDetector')) {
    next.autoChangeDetector = incoming.autoChangeDetector === true;
  }
  return extractPreferences(next);
}

function createService(deps = {}) {
  const settingsService = deps.userSettingsService || userSettingsService;

  async function getPreferences(userId, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return emptyPreferences();

    const settings = await settingsService.getSettings(normalizedUserId, options);
    const entry = readEntry(settings);
    const prefs = extractPreferences(entry);
    if (options.access) {
      return sanitizeForAccess(prefs, options.access);
    }
    return prefs;
  }

  async function savePreferences(userId, payload = {}, actor = null, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      throw new Error('User ID is required for schedule viewer preferences.');
    }

    const currentSettings = await settingsService.getSettings(normalizedUserId, options);
    const currentEntry = readEntry(currentSettings);
    const merged = mergePreferences(currentEntry, payload);
    const sanitized = options.access
      ? sanitizeForAccess(merged, options.access)
      : extractPreferences(merged);
    const nextSettings = buildNextSettings(currentSettings, sanitized);
    await settingsService.setSettings(
      normalizedUserId,
      nextSettings,
      actor || normalizedUserId,
      options
    );
    return sanitized;
  }

  return {
    SETTINGS_ROOT,
    getPreferences,
    savePreferences,
    emptyPreferences,
    extractPreferences,
    sanitizeForAccess,
    mergePreferences,
    hasSavedPreferences,
    readEntry,
    buildNextSettings
  };
}

const service = createService();

module.exports = {
  ...service,
  createService,
  emptyPreferences,
  extractPreferences,
  sanitizeForAccess,
  mergePreferences,
  hasSavedPreferences
};
