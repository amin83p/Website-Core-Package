'use strict';

const systemSettingsRepository = require('../../repositories/systemSettingsRepository');

function normalizeState(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    lastExportEndDate: String(src.lastExportEndDate || '').trim(),
    lastExportAt: String(src.lastExportAt || '').trim(),
    lastExportId: String(src.lastExportId || '').trim(),
    lastExportCounts: {
      logs: Number(src.lastExportCounts?.logs || 0),
      actionStates: Number(src.lastExportCounts?.actionStates || 0)
    }
  };
}

async function getLogArchiveState() {
  const settings = await systemSettingsRepository.getSettings();
  return normalizeState(settings?.logArchive);
}

async function saveLogArchiveState(patch = {}, auditUser = null) {
  const current = await getLogArchiveState();
  const next = normalizeState({ ...current, ...patch, lastExportCounts: { ...current.lastExportCounts, ...(patch.lastExportCounts || {}) } });
  await systemSettingsRepository.updateSettings({ logArchive: next }, auditUser);
  return next;
}

module.exports = {
  getLogArchiveState,
  saveLogArchiveState,
  normalizeState
};
