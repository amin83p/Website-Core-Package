'use strict';

const BUNDLE_SCHEMA_VERSION = 1;
const SUPPORTED_RENDER_CORE_VERSION = 1;

function clean(value = '') {
  return String(value ?? '').trim();
}

function validateRenderBundle(bundle = {}) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Render bundle must be a JSON object.');
  }
  const schemaVersion = Number(bundle.schemaVersion);
  if (schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported render bundle schema version ${schemaVersion}. Expected ${BUNDLE_SCHEMA_VERSION}.`);
  }
  const manifest = bundle.manifest;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Render bundle is missing manifest.');
  }
  if (!clean(manifest.startDate) || !clean(manifest.endDate)) {
    throw new Error('Render bundle manifest must include startDate and endDate.');
  }
  const templates = bundle.templates;
  if (!templates || typeof templates !== 'object' || Array.isArray(templates)) {
    throw new Error('Render bundle is missing templates map.');
  }
  const targets = Array.isArray(bundle.targets) ? bundle.targets : [];
  if (!targets.length) {
    throw new Error('Render bundle has no render targets.');
  }
  targets.forEach((target, index) => {
    const ref = clean(target?.templateRefKey);
    if (!ref || !templates[ref]?.dataBase64) {
      throw new Error(`Render target ${index + 1} references missing template ${ref || '(empty)'}.`);
    }
    if (!clean(target?.fileName)) {
      throw new Error(`Render target ${index + 1} is missing fileName.`);
    }
  });
  const mergePolicy = manifest.mergePolicy || {};
  const mode = clean(mergePolicy.mode).toLowerCase() || 'single';
  if (!['single', 'zip'].includes(mode)) {
    throw new Error('Render bundle mergePolicy.mode must be single or zip.');
  }
  return true;
}

module.exports = {
  BUNDLE_SCHEMA_VERSION,
  SUPPORTED_RENDER_CORE_VERSION,
  validateRenderBundle
};
