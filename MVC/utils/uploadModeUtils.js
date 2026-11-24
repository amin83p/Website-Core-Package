const settingService = require('../services/settingService');

const MODE_LOCAL = 'local';
const MODE_RAILWAY_PROXY = 'railway_proxy';
const MODE_AZURE_BLOB = 'azure_blob';
const MODE_S3 = 's3';

function clean(value) {
  return String(value || '').trim();
}

const VALID_MODES = new Set([MODE_LOCAL, MODE_RAILWAY_PROXY, MODE_AZURE_BLOB, MODE_S3]);

function normalizeUploadModeToken(token = '') {
  const raw = clean(token).toLowerCase();
  if (!raw) return '';
  if (raw === 'railway_gateway') return MODE_RAILWAY_PROXY;
  if (raw === 'azure_blob' || raw === 'azure') return MODE_AZURE_BLOB;
  if (VALID_MODES.has(raw)) return raw;
  return '';
}

function getUploadModeFromSettings() {
  try {
  return normalizeUploadModeToken(settingService.getValue('app', 'uploadStorageBackend'));
  } catch (_) {
    return '';
  }
}

function getUploadMode() {
  const fromEnv = normalizeUploadModeToken(process.env.UPLOAD_MODE);
  if (fromEnv) return fromEnv;
  const fromSettings = getUploadModeFromSettings();
  if (fromSettings) return fromSettings;
  return MODE_LOCAL;
}

function isRailwayProxyMode() {
  return getUploadMode() === MODE_RAILWAY_PROXY;
}

function isAzureBlobMode() {
  return getUploadMode() === MODE_AZURE_BLOB;
}

function getGatewayBaseUrl() {
  return clean(process.env.RAILWAY_GATEWAY_BASE_URL).replace(/\/+$/, '');
}

function isBrowserUnsafeGatewayBaseUrl(baseUrl = '') {
  const { isPrivateOrLocalHost } = require('./networkHostUtils');
  const token = clean(baseUrl);
  if (!token) return true;
  try {
    const parsed = new URL(token);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    return isPrivateOrLocalHost(parsed.hostname);
  } catch (_) {
    return true;
  }
}

function getGatewayTimeoutMs() {
  const raw = Number.parseInt(String(process.env.FILE_GATEWAY_TIMEOUT_MS || '').trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) return 25000;
  return raw;
}

function getUploadRemoteReadMode() {
  const fromEnv = clean(process.env.UPLOAD_REMOTE_READ_MODE).toLowerCase();
  if (fromEnv === 'proxy' || fromEnv === 'redirect') return fromEnv;
  try {
    const fromSettings = clean(settingService.getValue('app', 'uploadRemoteReadMode')).toLowerCase();
    if (fromSettings === 'proxy' || fromSettings === 'redirect') return fromSettings;
  } catch (_) {
    // ignore
  }
  return 'redirect';
}

function shouldPersistUploadsViaRemoteGateway() {
  const uploadStoragePolicy = require('../services/uploadStoragePolicyService');
  return uploadStoragePolicy.isRemoteUploadBackend();
}

function getAzureBlobContainerFromSettings() {
  try {
    const configured = clean(settingService.getValue('app', 'azureBlobContainer'));
    if (configured) return configured;
  } catch (_) {
    // ignore
  }
  return clean(process.env.AZURE_STORAGE_CONTAINER) || 'uploads';
}

function getAzureBlobPrefixFromSettings() {
  try {
    return clean(settingService.getValue('app', 'azureBlobPrefix'))
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  } catch (_) {
    return clean(process.env.AZURE_STORAGE_BLOB_PREFIX)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }
}

module.exports = {
  MODE_LOCAL,
  MODE_RAILWAY_PROXY,
  MODE_AZURE_BLOB,
  MODE_S3,
  getUploadMode,
  getUploadModeFromSettings,
  isRailwayProxyMode,
  isAzureBlobMode,
  getGatewayBaseUrl,
  getGatewayTimeoutMs,
  isBrowserUnsafeGatewayBaseUrl,
  shouldPersistUploadsViaRemoteGateway,
  getUploadRemoteReadMode,
  getAzureBlobContainerFromSettings,
  getAzureBlobPrefixFromSettings,
  normalizeUploadModeToken
};