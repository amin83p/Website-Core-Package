'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');

function getIntegrationVariableService() {
  return requireCoreModule('MVC/services/integrationVariableService');
}

function getExportConcurrency() {
  const raw = String(getIntegrationVariableService().getIntegrationVariable('SAR_EXPORT_CONCURRENCY') || '4').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 4;
  return Math.min(parsed, 8);
}

function isExportTimingEnabled() {
  const flag = String(getIntegrationVariableService().getIntegrationVariable('SAR_EXPORT_TIMING') || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(flag)) return true;
  return String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
}

function getAsyncExportMinTargets() {
  const raw = String(getIntegrationVariableService().getIntegrationVariable('SAR_EXPORT_ASYNC_MIN_TARGETS') || '12').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12;
  return Math.min(parsed, 100);
}

module.exports = {
  getExportConcurrency,
  isExportTimingEnabled,
  getAsyncExportMinTargets
};
