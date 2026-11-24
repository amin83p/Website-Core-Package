const fs = require('fs');
const path = require('path');
const uploadPathUtils = require('../utils/uploadPathUtils');
const {
  getUploadMode,
  getGatewayBaseUrl,
  getAzureBlobContainerFromSettings,
  MODE_AZURE_BLOB,
  MODE_RAILWAY_PROXY
} = require('../utils/uploadModeUtils');
const settingService = require('./settingService');

const STORAGE_BACKEND_LOCAL = 'local';
const STORAGE_BACKEND_RAILWAY_GATEWAY = 'railway_gateway';
const STORAGE_BACKEND_AZURE_BLOB = 'azure_blob';
const STORAGE_BACKEND_S3 = 's3';

function clean(value) {
  return String(value || '').trim();
}

function getStorageBackend() {
  const mode = getUploadMode();
  if (mode === MODE_RAILWAY_PROXY) return STORAGE_BACKEND_RAILWAY_GATEWAY;
  if (mode === MODE_AZURE_BLOB) return STORAGE_BACKEND_AZURE_BLOB;
  if (mode === 's3') return STORAGE_BACKEND_S3;
  return STORAGE_BACKEND_LOCAL;
}

function isRailwayGatewayBackend() {
  return getStorageBackend() === STORAGE_BACKEND_RAILWAY_GATEWAY;
}

function isAzureBlobBackend() {
  return getStorageBackend() === STORAGE_BACKEND_AZURE_BLOB;
}

function isS3Backend() {
  return getStorageBackend() === STORAGE_BACKEND_S3;
}

function isRemoteUploadBackend() {
  return isRailwayGatewayBackend() || isAzureBlobBackend() || isS3Backend();
}

function preferRemoteUploadReads() {
  return isRemoteUploadBackend();
}

function allowLocalUploadFallback() {
  return !isRemoteUploadBackend();
}

function supportsGatewayOrgBackup() {
  return isRailwayGatewayBackend();
}

function resolveAzureConnectionString() {
  return clean(process.env.AZURE_STORAGE_CONNECTION_STRING)
    || clean(process.env.AZURE_STORAGE_CONNECTIONSTRING);
}

function resolveAzureAccountCredentials() {
  const account = clean(process.env.AZURE_STORAGE_ACCOUNT);
  const key = clean(process.env.AZURE_STORAGE_ACCOUNT_KEY);
  if (account && key) return { account, key };
  return null;
}

function assertAzureBlobReady() {
  if (!isAzureBlobBackend()) return;
  const container = getAzureBlobContainerFromSettings();
  const connectionString = resolveAzureConnectionString();
  const accountCreds = resolveAzureAccountCredentials();
  if (!container) {
    throw new Error(
      'Upload storage is azure_blob but app.azureBlobContainer is empty. Set it in App Defaults or AZURE_STORAGE_CONTAINER.'
    );
  }
  if (!connectionString && !accountCreds) {
    throw new Error(
      'Upload storage is azure_blob but Azure credentials are missing. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT + AZURE_STORAGE_ACCOUNT_KEY.'
    );
  }
}

function getUploadStorageHealthSummary() {
  const backend = getStorageBackend();
  const summary = { backend, ok: true, issues: [] };
  if (backend === STORAGE_BACKEND_RAILWAY_GATEWAY) {
    if (!getGatewayBaseUrl()) summary.issues.push('RAILWAY_GATEWAY_BASE_URL is not set.');
    if (!clean(process.env.FILE_GATEWAY_SHARED_KEY || '')) summary.issues.push('FILE_GATEWAY_SHARED_KEY is not set.');
  } else if (backend === STORAGE_BACKEND_AZURE_BLOB) {
    try {
      assertAzureBlobReady();
    } catch (error) {
      summary.issues.push(error.message);
    }
  }
  summary.ok = summary.issues.length === 0;
  return summary;
}

function assertRailwayGatewayReady() {
  if (!isRailwayGatewayBackend()) return;
  const baseUrl = getGatewayBaseUrl();
  const sharedKey = clean(process.env.FILE_GATEWAY_SHARED_KEY || '');
  if (!baseUrl) {
    throw new Error(
      'UPLOAD_MODE is railway_proxy but RAILWAY_GATEWAY_BASE_URL is not configured. Set the gateway URL in .env and restart.'
    );
  }
  if (!sharedKey) {
    throw new Error(
      'UPLOAD_MODE is railway_proxy but FILE_GATEWAY_SHARED_KEY is not configured. Set the shared key in .env and restart.'
    );
  }
}

function resolveConfiguredUploadRootStrict() {
  let configured = '';
  try {
    configured = clean(settingService.getValue('app', 'uploadsPath'));
  } catch (_) {
    configured = '';
  }
  const token = clean(configured);
  const resolved = token
    ? (path.isAbsolute(token) ? path.resolve(token) : path.resolve(process.cwd(), token))
    : uploadPathUtils.DEFAULT_UPLOAD_ROOT;

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Configured app.uploadsPath is not a directory: "${resolved}".`);
    }
    fs.accessSync(resolved, fs.constants.W_OK);
    return resolved;
  } catch (error) {
    if (error?.message?.includes('app.uploadsPath')) throw error;
    throw new Error(
      `Configured app.uploadsPath is not usable: "${resolved}". ${error?.message || error}`
    );
  }
}

function assertLocalUploadRootReady() {
  if (isRemoteUploadBackend()) return;
  resolveConfiguredUploadRootStrict();
}

function assertMulterStagingRootReady() {
  if (!isRemoteUploadBackend()) return;
  resolveConfiguredUploadRootStrict();
}

function assertS3BackendReady() {
  if (!isS3Backend()) return;
  throw new Error('UPLOAD_MODE is s3 but S3 upload storage is not configured yet.');
}

function assertStorageReadyForOperation() {
  if (isRailwayGatewayBackend()) {
    assertRailwayGatewayReady();
    return;
  }
  if (isAzureBlobBackend()) {
    assertAzureBlobReady();
    return;
  }
  if (isS3Backend()) {
    assertS3BackendReady();
    return;
  }
  assertLocalUploadRootReady();
}

function validateUploadStorageAtBoot(options = {}) {
  const failFast = options.failFast !== false;
  const backend = getStorageBackend();
  const issues = [];

  if (backend === STORAGE_BACKEND_RAILWAY_GATEWAY) {
    try {
      assertRailwayGatewayReady();
    } catch (error) {
      issues.push(error.message);
    }
    try {
      assertMulterStagingRootReady();
    } catch (error) {
      issues.push(error.message);
    }
  } else if (backend === STORAGE_BACKEND_AZURE_BLOB) {
    try {
      assertAzureBlobReady();
    } catch (error) {
      issues.push(error.message);
    }
    try {
      assertMulterStagingRootReady();
    } catch (error) {
      issues.push(error.message);
    }
  } else if (backend === STORAGE_BACKEND_S3) {
    try {
      assertS3BackendReady();
    } catch (error) {
      issues.push(error.message);
    }
  } else {
    try {
      assertLocalUploadRootReady();
    } catch (error) {
      issues.push(error.message);
    }
  }

  if (!issues.length) {
    return { ok: true, backend, issues: [] };
  }

  const message = `[UploadStorage] Startup validation failed:\n- ${issues.join('\n- ')}`;
  if (failFast) {
    throw new Error(message);
  }
  console.error(message);
  return { ok: false, backend, issues };
}

module.exports = {
  STORAGE_BACKEND_LOCAL,
  STORAGE_BACKEND_RAILWAY_GATEWAY,
  STORAGE_BACKEND_AZURE_BLOB,
  STORAGE_BACKEND_S3,
  getStorageBackend,
  isRailwayGatewayBackend,
  isAzureBlobBackend,
  isS3Backend,
  isRemoteUploadBackend,
  preferRemoteUploadReads,
  allowLocalUploadFallback,
  supportsGatewayOrgBackup,
  getUploadStorageHealthSummary,
  assertS3BackendReady,
  assertAzureBlobReady,
  assertRailwayGatewayReady,
  assertLocalUploadRootReady,
  assertMulterStagingRootReady,
  assertStorageReadyForOperation,
  resolveConfiguredUploadRootStrict,
  validateUploadStorageAtBoot
};