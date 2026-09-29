'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const userSettingsService = requireCoreModule('MVC/services/userSettingsService');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const SETTINGS_ROOT = 'schoolScheduleViewer';
const MAX_PERSONS = 50;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TIMELINE_START_HOUR = 7;
const DEFAULT_TIMELINE_END_HOUR = 22;
const TIMELINE_MIN_SPAN_HOURS = 2;
const DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE = 2;
const DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER = 2;
const MAX_STAGED_VIEW_PADDING_WEEKS = 12;

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

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeChipColor(value) {
  const cleaned = String(value || '').trim();
  if (!HEX_COLOR_RE.test(cleaned)) return '';
  if (cleaned.length === 4) {
    const r = cleaned[1];
    const g = cleaned[2];
    const b = cleaned[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return cleaned.toLowerCase();
}

function normalizePersonEntry(entry = {}) {
  const id = String(entry?.id || entry?.personId || '').trim();
  if (!id) return null;
  const name = String(entry?.name || entry?.displayName || '').trim() || id;
  const selectedRole = String(entry?.selectedRole || '').trim();
  const chipBgColor = normalizeChipColor(entry.chipBgColor);
  const chipTextColor = normalizeChipColor(entry.chipTextColor);
  return {
    id,
    name,
    ...(selectedRole ? { selectedRole } : {}),
    ...(chipBgColor ? { chipBgColor } : {}),
    ...(chipTextColor ? { chipTextColor } : {})
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

function normalizeTimelineHour(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function normalizeTimelineBounds(startHour, endHour) {
  let start = normalizeTimelineHour(startHour, DEFAULT_TIMELINE_START_HOUR);
  let end = normalizeTimelineHour(endHour, DEFAULT_TIMELINE_END_HOUR);
  start = Math.max(0, Math.min(23, start));
  end = Math.max(1, Math.min(24, end));
  if (end <= start || end - start < TIMELINE_MIN_SPAN_HOURS) {
    start = DEFAULT_TIMELINE_START_HOUR;
    end = DEFAULT_TIMELINE_END_HOUR;
  }
  return { timelineStartHour: start, timelineEndHour: end };
}

function normalizeStagedViewPaddingWeeks(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(MAX_STAGED_VIEW_PADDING_WEEKS, Math.floor(parsed)));
}

function emptyPreferences() {
  return {
    startDate: '',
    endDate: '',
    activePersonId: '',
    persons: [],
    autoChangeDetector: true,
    timelineStartHour: DEFAULT_TIMELINE_START_HOUR,
    timelineEndHour: DEFAULT_TIMELINE_END_HOUR,
    stagedViewPaddingWeeksBefore: DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE,
    stagedViewPaddingWeeksAfter: DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
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
  const timeline = normalizeTimelineBounds(source.timelineStartHour, source.timelineEndHour);
  const stagedViewPaddingWeeksBefore = normalizeStagedViewPaddingWeeks(
    source.stagedViewPaddingWeeksBefore,
    DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE
  );
  const stagedViewPaddingWeeksAfter = normalizeStagedViewPaddingWeeks(
    source.stagedViewPaddingWeeksAfter,
    DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
  );
  return {
    startDate,
    endDate,
    activePersonId: validActive,
    persons,
    autoChangeDetector,
    timelineStartHour: timeline.timelineStartHour,
    timelineEndHour: timeline.timelineEndHour,
    stagedViewPaddingWeeksBefore,
    stagedViewPaddingWeeksAfter
  };
}

function hasPersistableScheduleViewerExtras(prefs = {}) {
  const normalized = extractPreferences(prefs);
  return normalized.timelineStartHour !== DEFAULT_TIMELINE_START_HOUR
    || normalized.timelineEndHour !== DEFAULT_TIMELINE_END_HOUR
    || normalized.stagedViewPaddingWeeksBefore !== DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE
    || normalized.stagedViewPaddingWeeksAfter !== DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
    || normalized.autoChangeDetector === false;
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
  if (!hasSavedPreferences(normalized) && !hasPersistableScheduleViewerExtras(normalized)) {
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
  if (Object.prototype.hasOwnProperty.call(incoming, 'timelineStartHour')
    || Object.prototype.hasOwnProperty.call(incoming, 'timelineEndHour')) {
    const timeline = normalizeTimelineBounds(
      Object.prototype.hasOwnProperty.call(incoming, 'timelineStartHour')
        ? incoming.timelineStartHour
        : next.timelineStartHour,
      Object.prototype.hasOwnProperty.call(incoming, 'timelineEndHour')
        ? incoming.timelineEndHour
        : next.timelineEndHour
    );
    next.timelineStartHour = timeline.timelineStartHour;
    next.timelineEndHour = timeline.timelineEndHour;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'stagedViewPaddingWeeksBefore')) {
    next.stagedViewPaddingWeeksBefore = normalizeStagedViewPaddingWeeks(
      incoming.stagedViewPaddingWeeksBefore,
      DEFAULT_STAGED_VIEW_PADDING_WEEKS_BEFORE
    );
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'stagedViewPaddingWeeksAfter')) {
    next.stagedViewPaddingWeeksAfter = normalizeStagedViewPaddingWeeks(
      incoming.stagedViewPaddingWeeksAfter,
      DEFAULT_STAGED_VIEW_PADDING_WEEKS_AFTER
    );
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
