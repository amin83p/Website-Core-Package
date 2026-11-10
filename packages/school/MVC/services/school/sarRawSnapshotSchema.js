'use strict';

const SAR_RAW_SNAPSHOT_VERSION = 1;

function clean(value = '') {
  return String(value ?? '').trim();
}

function validateSarRawSnapshot(snapshot = {}, { requireMatrix = true } = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Snapshot must be a JSON object.');
  }
  if (Number(snapshot.schemaVersion) !== SAR_RAW_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot schema version (expected ${SAR_RAW_SNAPSHOT_VERSION}).`);
  }
  const manifest = snapshot.manifest;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Snapshot is missing manifest.');
  }
  if (!clean(manifest.startDate) || !clean(manifest.endDate)) {
    throw new Error('Snapshot manifest must include startDate and endDate.');
  }
  if (requireMatrix && (!snapshot.matrix || typeof snapshot.matrix !== 'object')) {
    throw new Error('Snapshot is missing matrix.');
  }
  if (!snapshot.exportPlan || typeof snapshot.exportPlan !== 'object') {
    throw new Error('Snapshot is missing exportPlan.');
  }
  if (!snapshot.reportTemplatesById || typeof snapshot.reportTemplatesById !== 'object') {
    throw new Error('Snapshot is missing reportTemplatesById.');
  }
  return true;
}

module.exports = {
  SAR_RAW_SNAPSHOT_VERSION,
  validateSarRawSnapshot
};
