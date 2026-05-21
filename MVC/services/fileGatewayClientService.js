const fs = require('fs').promises;
const path = require('path');
const { buildSignedHeaders } = require('./fileGatewayAuthService');
const { getGatewayBaseUrl, getGatewayTimeoutMs } = require('../utils/uploadModeUtils');

function clean(value) {
  return String(value || '').trim();
}

function normalizeScopeKey(scopeKey = '') {
  const token = clean(scopeKey).toUpperCase();
  if (!token || token === 'GLOBAL') return 'GLOBAL';
  return token.replace(/^ORG_/, '');
}

function cleanRelativePath(value = '') {
  return clean(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function joinRelative(...parts) {
  return parts
    .map((part) => cleanRelativePath(part))
    .filter(Boolean)
    .join('/');
}

function splitRelativePath(relativePath = '') {
  const parts = cleanRelativePath(relativePath).split('/').filter(Boolean);
  const name = parts.pop() || '';
  return {
    dir: parts.join('/'),
    name
  };
}

function isSameOrInsideRelativePath(basePath = '', targetPath = '') {
  const base = cleanRelativePath(basePath);
  const target = cleanRelativePath(targetPath);
  return Boolean(base && target && (base === target || target.startsWith(`${base}/`)));
}

function buildConflictName(name = '', index = 0) {
  const token = clean(name);
  if (index <= 0) return token;
  const ext = path.extname(token);
  const base = path.basename(token, ext);
  return `${base}_${index}${ext}`;
}

function buildUploadUrl(scopeKey = '', relativePath = '') {
  const scope = normalizeScopeKey(scopeKey);
  const scopeFolder = scope === 'GLOBAL' ? 'GLOBAL' : `ORG_${scope}`;
  const parts = [scopeFolder, ...cleanRelativePath(relativePath).split('/').filter(Boolean)];
  const encoded = parts.map((part) => encodeURIComponent(part)).join('/');
  return `${clean(getGatewayBaseUrl()).replace(/\/+$/, '')}/uploads/${encoded}`;
}

function getRoutePath(routePath = '') {
  const token = `/${clean(routePath).replace(/^\/+/, '')}`;
  return token;
}

function getGatewayUrl(routePath = '') {
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl) {
    throw new Error('RAILWAY_GATEWAY_BASE_URL is not configured.');
  }
  return `${baseUrl}${getRoutePath(routePath)}`;
}

function looksLikeHtml(value = '') {
  return /^\s*<!doctype html/i.test(value) || /^\s*<html[\s>]/i.test(value);
}

function summarizeGatewayTextError(text = '', status = 0, fallbackMessage = '') {
  const raw = clean(text);
  if (!raw) return fallbackMessage || `Gateway request failed (${status}).`;
  if (looksLikeHtml(raw)) {
    return status === 404
      ? 'Railway file gateway route was not found. Deploy the latest app changes and restart the Railway service, then try again.'
      : `Railway file gateway returned an HTML error page (${status}). Check the Railway deployment logs.`;
  }
  return raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
}

async function fetchJson(routePath = '', options = {}) {
  const route = getRoutePath(routePath);
  const url = getGatewayUrl(route);
  const method = String(options.method || 'POST').toUpperCase();
  const signedHeaders = buildSignedHeaders({ method, routePath: route });
  const headers = {
    ...signedHeaders,
    ...(options.headers || {})
  };

  const controller = new AbortController();
  const timeoutMs = getGatewayTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.status === 'error') {
      const error = new Error(result?.message || `Gateway request failed (${response.status}).`);
      error.statusCode = response.status;
      error.gatewayPayload = result;
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGatewayResponse(routePath = '', options = {}) {
  const route = getRoutePath(routePath);
  const url = getGatewayUrl(route);
  const method = String(options.method || 'POST').toUpperCase();
  const signedHeaders = buildSignedHeaders({ method, routePath: route });
  const headers = {
    ...signedHeaders,
    ...(options.headers || {})
  };

  const controller = new AbortController();
  const timeoutMs = getGatewayTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      let message = `Gateway request failed (${response.status}).`;
      if (contentType.includes('application/json')) {
        const result = await response.json().catch(() => ({}));
        message = result?.message || message;
      } else {
        const text = await response.text().catch(() => '');
        message = summarizeGatewayTextError(text, response.status, message);
      }
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function gatewayUploadBlob({
  scopeKey = '',
  relativeDir = '',
  desiredName = '',
  blob = null,
  mimeType = 'application/octet-stream'
} = {}) {
  const form = new FormData();
  form.append('scopeKey', clean(scopeKey));
  form.append('relativeDir', clean(relativeDir));
  form.append('desiredName', clean(desiredName));
  form.append('file', blob, clean(desiredName) || 'file');

  return fetchJson('/internal/file-gateway/upload', {
    method: 'POST',
    body: form
  });
}

async function gatewayUploadFile({
  scopeKey = '',
  relativeDir = '',
  desiredName = '',
  localFilePath = '',
  mimeType = 'application/octet-stream'
} = {}) {
  const absolute = path.resolve(String(localFilePath || ''));
  const fileBuffer = await fs.readFile(absolute);
  const blob = new Blob([fileBuffer], { type: clean(mimeType) || 'application/octet-stream' });
  return gatewayUploadBlob({
    scopeKey,
    relativeDir,
    desiredName: clean(desiredName) || path.basename(absolute),
    blob,
    mimeType
  });
}

async function gatewayDeleteByUploadUrl(uploadUrl = '') {
  return fetchJson('/internal/file-gateway/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadUrl: clean(uploadUrl) })
  });
}

async function gatewayDeleteByRelativePath({ scopeKey = '', relativePath = '' } = {}) {
  return fetchJson('/internal/file-gateway/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scopeKey: clean(scopeKey),
      relativePath: clean(relativePath)
    })
  });
}

async function downloadRemoteUploadFile(scopeKey = '', relativePath = '') {
  const uploadUrl = buildUploadUrl(scopeKey, relativePath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getGatewayTimeoutMs());
  try {
    const response = await fetch(uploadUrl, {
      method: 'GET',
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`Unable to download source file (${response.status}).`);
      error.statusCode = response.status;
      throw error;
    }
    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
      size: buffer.length,
      uploadUrl
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function createAvailableRemoteFolder(scopeKey = '', relativeDir = '', folderName = '') {
  const desiredName = clean(folderName);
  if (!desiredName) throw new Error('Destination folder name is required.');

  for (let index = 0; index < 250; index += 1) {
    const candidateName = buildConflictName(desiredName, index);
    try {
      await gatewayCreateFolder({
        scopeKey,
        relativeDir,
        folderName: candidateName
      });
      return {
        folderName: candidateName,
        relativeDir: joinRelative(relativeDir, candidateName)
      };
    } catch (error) {
      if (!/already exists/i.test(String(error?.message || ''))) throw error;
    }
  }

  throw new Error('Unable to create a unique destination folder name.');
}

async function copyRemoteFileFallback({
  sourceScopeKey = '',
  sourceRelativePath = '',
  destinationScopeKey = '',
  destinationRelativeDir = ''
} = {}) {
  const source = splitRelativePath(sourceRelativePath);
  if (!source.name) throw new Error('Source file name is required.');
  const downloaded = await downloadRemoteUploadFile(sourceScopeKey, sourceRelativePath);
  return gatewayUploadBlob({
    scopeKey: destinationScopeKey || sourceScopeKey,
    relativeDir: destinationRelativeDir,
    desiredName: source.name,
    blob: downloaded.blob,
    mimeType: downloaded.mimeType
  });
}

async function copyRemoteDirectoryFallback({
  sourceScopeKey = '',
  sourceRelativePath = '',
  destinationScopeKey = '',
  destinationRelativeDir = ''
} = {}) {
  const sourceScope = normalizeScopeKey(sourceScopeKey);
  const destinationScope = normalizeScopeKey(destinationScopeKey || sourceScopeKey);
  const sourcePath = cleanRelativePath(sourceRelativePath);
  const destinationDir = cleanRelativePath(destinationRelativeDir);
  const source = splitRelativePath(sourcePath);
  if (!source.name) throw new Error('Source folder name is required.');
  if (sourceScope === destinationScope && isSameOrInsideRelativePath(sourcePath, destinationDir)) {
    throw new Error('A folder cannot be moved or copied into itself.');
  }

  const created = await createAvailableRemoteFolder(destinationScope, destinationDir, source.name);
  const listed = await gatewayListDirectory({
    scopeKey: sourceScope,
    relativeDir: sourcePath
  });
  const entries = Array.isArray(listed?.files) ? listed.files : [];

  for (const entry of entries) {
    const name = clean(entry?.name);
    if (!name) continue;
    const childSourcePath = joinRelative(sourcePath, name);
    if (entry.isDir) {
      // eslint-disable-next-line no-await-in-loop
      await copyRemoteDirectoryFallback({
        sourceScopeKey: sourceScope,
        sourceRelativePath: childSourcePath,
        destinationScopeKey: destinationScope,
        destinationRelativeDir: created.relativeDir
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await copyRemoteFileFallback({
        sourceScopeKey: sourceScope,
        sourceRelativePath: childSourcePath,
        destinationScopeKey: destinationScope,
        destinationRelativeDir: created.relativeDir
      });
    }
  }

  return {
    status: 'success',
    message: 'Copied via gateway compatibility fallback.',
    finalName: created.folderName,
    relativePath: joinRelative(destinationScope === 'GLOBAL' ? 'GLOBAL' : `ORG_${destinationScope}`, created.relativeDir)
  };
}

async function gatewayCopyItemFallback({
  sourceScopeKey = '',
  sourceRelativePath = '',
  destinationScopeKey = '',
  destinationRelativeDir = ''
} = {}) {
  const sourceScope = normalizeScopeKey(sourceScopeKey);
  const destinationScope = normalizeScopeKey(destinationScopeKey || sourceScopeKey);
  const sourcePath = cleanRelativePath(sourceRelativePath);
  const destinationDir = cleanRelativePath(destinationRelativeDir);

  try {
    const copiedFile = await copyRemoteFileFallback({
      sourceScopeKey: sourceScope,
      sourceRelativePath: sourcePath,
      destinationScopeKey: destinationScope,
      destinationRelativeDir: destinationDir
    });
    return {
      ...copiedFile,
      message: 'Copied via gateway compatibility fallback.',
      finalName: clean(copiedFile?.fileName) || splitRelativePath(sourcePath).name
    };
  } catch (fileError) {
    if (![403, 404].includes(Number(fileError?.statusCode || 0))) throw fileError;
    return copyRemoteDirectoryFallback({
      sourceScopeKey: sourceScope,
      sourceRelativePath: sourcePath,
      destinationScopeKey: destinationScope,
      destinationRelativeDir: destinationDir
    });
  }
}

async function gatewayMoveItem({
  sourceScopeKey = '',
  sourceRelativePath = '',
  destinationScopeKey = '',
  destinationRelativeDir = ''
} = {}) {
  const payload = {
    sourceScopeKey: clean(sourceScopeKey),
    sourceRelativePath: clean(sourceRelativePath),
    destinationScopeKey: clean(destinationScopeKey),
    destinationRelativeDir: clean(destinationRelativeDir)
  };
  try {
    return await fetchJson('/internal/file-gateway/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (Number(error?.statusCode || 0) !== 404) throw error;
    const copied = await gatewayCopyItemFallback(payload);
    await gatewayDeleteByRelativePath({
      scopeKey: payload.sourceScopeKey,
      relativePath: payload.sourceRelativePath
    });
    return {
      ...copied,
      message: 'Moved via gateway compatibility fallback.'
    };
  }
}

async function gatewayCopyItem({
  sourceScopeKey = '',
  sourceRelativePath = '',
  destinationScopeKey = '',
  destinationRelativeDir = ''
} = {}) {
  const payload = {
    sourceScopeKey: clean(sourceScopeKey),
    sourceRelativePath: clean(sourceRelativePath),
    destinationScopeKey: clean(destinationScopeKey),
    destinationRelativeDir: clean(destinationRelativeDir)
  };
  try {
    return await fetchJson('/internal/file-gateway/copy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (Number(error?.statusCode || 0) !== 404) throw error;
    return gatewayCopyItemFallback(payload);
  }
}

async function gatewayRenameItem({
  scopeKey = '',
  relativePath = '',
  newName = ''
} = {}) {
  return fetchJson('/internal/file-gateway/rename', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scopeKey: clean(scopeKey),
      relativePath: clean(relativePath),
      newName: clean(newName)
    })
  });
}

async function gatewayCreateFolder({ scopeKey = '', relativeDir = '', folderName = '' } = {}) {
  return fetchJson('/internal/file-gateway/mkdir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scopeKey: clean(scopeKey),
      relativeDir: clean(relativeDir),
      folderName: clean(folderName)
    })
  });
}

async function gatewayListDirectory({ scopeKey = '', relativeDir = '' } = {}) {
  return fetchJson('/internal/file-gateway/list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scopeKey: clean(scopeKey),
      relativeDir: clean(relativeDir)
    })
  });
}

async function gatewayDownloadOrgBackup({ orgId = '' } = {}) {
  return fetchGatewayResponse('/internal/file-gateway/org-backup/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orgId: clean(orgId) })
  });
}

async function gatewayRestoreOrgBackup({
  orgId = '',
  buffer = null,
  fileName = 'org-upload-backup.tar.gz',
  mimeType = 'application/gzip'
} = {}) {
  const form = new FormData();
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const blob = new Blob([source], { type: clean(mimeType) || 'application/gzip' });
  form.append('orgId', clean(orgId));
  form.append('backupFile', blob, clean(fileName) || 'org-upload-backup.tar.gz');

  return fetchJson('/internal/file-gateway/org-backup/restore', {
    method: 'POST',
    body: form
  });
}

module.exports = {
  gatewayUploadBlob,
  gatewayUploadFile,
  downloadRemoteUploadFile,
  gatewayDeleteByUploadUrl,
  gatewayDeleteByRelativePath,
  gatewayMoveItem,
  gatewayCopyItem,
  gatewayRenameItem,
  gatewayCreateFolder,
  gatewayListDirectory,
  gatewayDownloadOrgBackup,
  gatewayRestoreOrgBackup
};
