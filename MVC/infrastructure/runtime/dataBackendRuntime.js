const { resolveDataBackendConfig } = require('../../../config/dataBackend');

let activeDataBackendConfig = null;

function setActiveDataBackendConfig(config) {
  if (!config || typeof config !== 'object') {
    activeDataBackendConfig = resolveDataBackendConfig(process.env);
    return activeDataBackendConfig;
  }
  activeDataBackendConfig = { ...config };
  return activeDataBackendConfig;
}

function getActiveDataBackendConfig() {
  if (!activeDataBackendConfig) {
    activeDataBackendConfig = resolveDataBackendConfig(process.env);
  }
  return activeDataBackendConfig;
}

function getActiveDataBackendMode() {
  return String(getActiveDataBackendConfig()?.mode || 'json').trim().toLowerCase();
}

function isMongoBackendActive() {
  return getActiveDataBackendMode() === 'mongo';
}

function isDataBackendRecoveryModeActive() {
  const config = getActiveDataBackendConfig();
  return Boolean(config?.fallback?.active);
}

module.exports = {
  setActiveDataBackendConfig,
  getActiveDataBackendConfig,
  getActiveDataBackendMode,
  isMongoBackendActive,
  isDataBackendRecoveryModeActive
};
