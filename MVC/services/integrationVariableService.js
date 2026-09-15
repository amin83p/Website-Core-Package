const settingService = require('./settingService');
const integrationVariableModel = require('../models/integrationVariableModel');

function readRows() {
  const app = settingService.get()?.app || {};
  return Array.isArray(app.integrationVariables) ? app.integrationVariables : [];
}

function getIntegrationVariable(key = '', options = {}) {
  const normalizedKey = String(key || '').trim().toUpperCase();
  if (!normalizedKey) return '';

  const row = readRows().find((item) => String(item?.key || '').trim().toUpperCase() === normalizedKey);
  if (row) {
    if (row.isSecret) {
      const decrypted = integrationVariableModel.decryptStoredValue(row);
      if (decrypted) return decrypted;
    } else if (row.value !== undefined && row.value !== null && String(row.value).trim()) {
      return String(row.value).trim();
    }
  }

  if (options.allowEnvFallback !== false && process.env[normalizedKey]) {
    return String(process.env[normalizedKey]).trim();
  }
  return '';
}

module.exports = {
  getIntegrationVariable,
  readRows
};
