'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const coreFilesService = requireCoreModule('MVC/services/coreFilesService');
const {
  listUploadLimitSections,
  listUploadLimitSectionKeys,
  getUploadLimitSection
} = require('../../config/uploadLimitsSectionCatalog');

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultSectionRows() {
  const sections = {};
  listUploadLimitSections().forEach((row) => {
    sections[row.key] = {
      maxFileSizeMb: null
    };
  });
  return sections;
}

function clampMaxFileSizeMb(value, sectionKey) {
  const catalog = getUploadLimitSection(sectionKey);
  const minMb = Number(catalog?.minMb || 1);
  const adminMaxMb = Number(catalog?.adminMaxMb || 500);
  const fallback = Number(catalog?.defaultMaxMb || 200);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error(`${catalog?.title || sectionKey}: max file size must be a number.`);
    error.statusCode = 400;
    throw error;
  }
  const rounded = Math.round(parsed);
  if (rounded < minMb || rounded > adminMaxMb) {
    const error = new Error(
      `${catalog?.title || sectionKey}: max file size must be between ${minMb} and ${adminMaxMb} MB.`
    );
    error.statusCode = 400;
    throw error;
  }
  return rounded;
}

function resolveEnvDefaultMb(sectionKey) {
  if (sectionKey === 'bookPdf') {
    return toPositiveInteger(process.env.SCHOOL_BOOK_PDF_MAX_UPLOAD_MB, 0) || null;
  }
  return null;
}

function resolveFallbackMaxMb(sectionKey) {
  const catalog = getUploadLimitSection(sectionKey);
  const catalogDefault = Number(catalog?.defaultMaxMb || 200);
  const envDefault = resolveEnvDefaultMb(sectionKey);
  if (envDefault) return envDefault;
  return catalogDefault;
}

function getGlobalDefaultMb() {
  return coreFilesService.getMaxUploadFileMb();
}

function effectiveMaxFileSizeMb(sectionKey, storedRow = {}) {
  const key = String(sectionKey || '').trim();
  const catalog = getUploadLimitSection(key);
  if (!catalog) return getGlobalDefaultMb();
  const stored = storedRow && typeof storedRow === 'object' ? storedRow : {};
  const hasStored = stored.maxFileSizeMb !== null
    && stored.maxFileSizeMb !== undefined
    && String(stored.maxFileSizeMb).trim() !== '';
  const effective = hasStored
    ? clampMaxFileSizeMb(stored.maxFileSizeMb, key)
    : resolveFallbackMaxMb(key);
  return effective;
}

function normalizeSectionRow(input = {}, sectionKey) {
  const stored = input && typeof input === 'object' ? input : {};
  if (stored.maxFileSizeMb === null || stored.maxFileSizeMb === undefined || stored.maxFileSizeMb === '') {
    return { maxFileSizeMb: null };
  }
  return { maxFileSizeMb: clampMaxFileSizeMb(stored.maxFileSizeMb, sectionKey) };
}

function normalizePolicyFromStored(input = {}) {
  const sections = defaultSectionRows();
  const storedSections = input.sections && typeof input.sections === 'object' ? input.sections : {};
  listUploadLimitSectionKeys().forEach((sectionKey) => {
    if (storedSections[sectionKey] && typeof storedSections[sectionKey] === 'object') {
      sections[sectionKey] = normalizeSectionRow(storedSections[sectionKey], sectionKey);
    }
  });
  return { sections };
}

function normalizePolicyFromForm(input = {}) {
  let sectionsInput = input.sections;
  if (typeof sectionsInput === 'string' && sectionsInput.trim()) {
    try {
      sectionsInput = JSON.parse(sectionsInput);
    } catch (_) {
      const error = new Error('Upload limit section settings must be valid JSON.');
      error.statusCode = 400;
      throw error;
    }
  }
  const sections = defaultSectionRows();
  const storedSections = sectionsInput && typeof sectionsInput === 'object' ? sectionsInput : {};
  listUploadLimitSectionKeys().forEach((sectionKey) => {
    if (storedSections[sectionKey] && typeof storedSections[sectionKey] === 'object') {
      sections[sectionKey] = normalizeSectionRow(storedSections[sectionKey], sectionKey);
    }
  });
  if (input.bookPdfMaxFileSizeMb !== undefined) {
    sections.bookPdf = input.bookPdfMaxFileSizeMb === '' || input.bookPdfMaxFileSizeMb === null
      ? { maxFileSizeMb: null }
      : normalizeSectionRow({ maxFileSizeMb: input.bookPdfMaxFileSizeMb }, 'bookPdf');
  }
  return { sections };
}

function enrichPolicyForDisplay(policy = {}) {
  const normalized = normalizePolicyFromStored(policy);
  const globalDefaultMb = getGlobalDefaultMb();
  const sections = {};
  listUploadLimitSections().forEach((catalogRow) => {
    const key = catalogRow.key;
    const row = normalized.sections[key] || { maxFileSizeMb: null };
    sections[key] = {
      ...row,
      title: catalogRow.title,
      description: catalogRow.description,
      notes: catalogRow.notes,
      catalogDefaultMb: catalogRow.defaultMaxMb,
      adminMaxMb: catalogRow.adminMaxMb,
      minMb: catalogRow.minMb,
      globalDefaultMb,
      effectiveMaxFileSizeMb: effectiveMaxFileSizeMb(key, row)
    };
  });
  return { sections };
}

function resolvePolicy(input = {}) {
  return enrichPolicyForDisplay(input);
}

function validatePolicyInput(input = {}) {
  const normalized = normalizePolicyFromForm(input);
  const rawSections = input.sections && typeof input.sections === 'object'
    ? input.sections
    : (typeof input.sections === 'string' ? (() => {
      try { return JSON.parse(input.sections); } catch (_) { return {}; }
    })() : {});
  const unknownKeys = Object.keys(rawSections || {})
    .filter((key) => !listUploadLimitSectionKeys().includes(key));
  if (unknownKeys.length) {
    const error = new Error(`Unknown upload limit section key(s): ${unknownKeys.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

async function resolveMaxFileSizeMb(activeOrgId, sectionKey) {
  const uploadLimitsPolicyModel = require('../../models/school/uploadLimitsPolicyModel');
  const policy = await uploadLimitsPolicyModel.getPolicyForOrg(activeOrgId);
  const key = String(sectionKey || '').trim();
  const section = policy?.sections?.[key];
  if (section && Number.isFinite(Number(section.effectiveMaxFileSizeMb))) {
    return Number(section.effectiveMaxFileSizeMb);
  }
  const storedRow = section && typeof section === 'object'
    ? { maxFileSizeMb: section.maxFileSizeMb }
    : {};
  return effectiveMaxFileSizeMb(key, storedRow);
}

module.exports = {
  defaultSectionRows,
  clampMaxFileSizeMb,
  getGlobalDefaultMb,
  resolveFallbackMaxMb,
  effectiveMaxFileSizeMb,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  enrichPolicyForDisplay,
  resolvePolicy,
  validatePolicyInput,
  resolveMaxFileSizeMb
};
