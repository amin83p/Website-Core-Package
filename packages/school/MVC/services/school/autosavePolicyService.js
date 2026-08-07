'use strict';

const { listAutosaveSections, listAutosaveSectionKeys } = require('../../config/autosaveSectionCatalog');

const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

const DEFAULT_POLICY = Object.freeze({
  defaultMinutes: 5,
  sections: Object.freeze({
    'manage-session': Object.freeze({
      enabledByDefault: true,
      defaultMinutes: null
    })
  })
});

function clampMinutes(value, fallback = DEFAULT_POLICY.defaultMinutes) {
  const n = Number(value);
  if (!Number.isFinite(n)) return clampMinutes(fallback, DEFAULT_POLICY.defaultMinutes);
  return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(n)));
}

function normalizeNullableMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  return clampMinutes(value);
}

function boolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback === true;
  if (value === true || value === 1) return true;
  const token = String(value).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(token)) return true;
  if (['false', '0', 'off', 'no'].includes(token)) return false;
  return fallback === true;
}

function defaultSectionRows() {
  const sections = {};
  listAutosaveSections().forEach((row) => {
    const catalogDefault = DEFAULT_POLICY.sections[row.key];
    sections[row.key] = {
      enabledByDefault: catalogDefault?.enabledByDefault === true,
      defaultMinutes: catalogDefault?.defaultMinutes ?? null
    };
  });
  return sections;
}

function normalizeSectionRow(input = {}, sectionKey) {
  const catalogDefault = DEFAULT_POLICY.sections[sectionKey] || {};
  return {
    enabledByDefault: boolFlag(
      input.enabledByDefault,
      catalogDefault.enabledByDefault === true
    ),
    defaultMinutes: normalizeNullableMinutes(
      input.defaultMinutes !== undefined ? input.defaultMinutes : catalogDefault.defaultMinutes
    )
  };
}

function normalizePolicyFromStored(input = {}) {
  const sections = defaultSectionRows();
  const storedSections = input.sections && typeof input.sections === 'object' ? input.sections : {};
  listAutosaveSectionKeys().forEach((sectionKey) => {
    if (storedSections[sectionKey] && typeof storedSections[sectionKey] === 'object') {
      sections[sectionKey] = normalizeSectionRow(storedSections[sectionKey], sectionKey);
    }
  });
  return {
    defaultMinutes: clampMinutes(input.defaultMinutes, DEFAULT_POLICY.defaultMinutes),
    sections
  };
}

function normalizePolicyFromForm(input = {}) {
  let sectionsInput = input.sections;
  if (typeof sectionsInput === 'string' && sectionsInput.trim()) {
    try {
      sectionsInput = JSON.parse(sectionsInput);
    } catch (_) {
      const error = new Error('Autosave section settings must be valid JSON.');
      error.statusCode = 400;
      throw error;
    }
  }
  const sections = defaultSectionRows();
  const storedSections = sectionsInput && typeof sectionsInput === 'object' ? sectionsInput : {};
  listAutosaveSectionKeys().forEach((sectionKey) => {
    if (storedSections[sectionKey] && typeof storedSections[sectionKey] === 'object') {
      sections[sectionKey] = normalizeSectionRow(storedSections[sectionKey], sectionKey);
    }
  });
  return {
    defaultMinutes: clampMinutes(input.defaultMinutes, DEFAULT_POLICY.defaultMinutes),
    sections
  };
}

function resolvePolicy(input = {}) {
  return normalizePolicyFromStored(input);
}

function resolveSectionConfig(policy = {}, sectionKey) {
  const key = String(sectionKey || '').trim();
  const normalized = resolvePolicy(policy);
  const section = normalized.sections[key] || defaultSectionRows()[key] || {
    enabledByDefault: false,
    defaultMinutes: null
  };
  const minutes = section.defaultMinutes == null
    ? normalized.defaultMinutes
    : section.defaultMinutes;
  return {
    sectionKey: key,
    enabledByDefault: section.enabledByDefault === true,
    defaultMinutes: clampMinutes(minutes, normalized.defaultMinutes)
  };
}

function validatePolicyInput(input = {}) {
  const normalized = normalizePolicyFromForm(input);
  const unknownKeys = Object.keys(input.sections && typeof input.sections === 'object' ? input.sections : {})
    .filter((key) => !listAutosaveSectionKeys().includes(key));
  if (unknownKeys.length) {
    const error = new Error(`Unknown autosave section key(s): ${unknownKeys.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

module.exports = {
  MIN_MINUTES,
  MAX_MINUTES,
  DEFAULT_POLICY,
  clampMinutes,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  resolvePolicy,
  resolveSectionConfig,
  validatePolicyInput,
  defaultSectionRows
};
