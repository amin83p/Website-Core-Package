const fs = require('fs/promises');
const path = require('path');
const coreFilesService = require('../coreFilesService');
const { getGatewayBaseUrl } = require('../../utils/uploadModeUtils');

const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 25000;

function s(value, max = 4000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value = '') {
  return /^https?:\/\//i.test(s(value, 2000));
}

function isAppUploadUrl(value = '') {
  const token = s(value, 2000);
  if (!isHttpUrl(token)) return /^\/uploads\//i.test(token);
  try {
    const parsed = new URL(token);
    return /^\/uploads\//i.test(parsed.pathname || '');
  } catch (_) {
    return /\/uploads\//i.test(token);
  }
}

function normalizeUploadUrlToken(value = '') {
  const token = s(value, 2000).replace(/\\/g, '/');
  if (!token) return '';
  const withoutHost = token.replace(/^https?:\/\/[^/]+/i, '');
  const withoutQuery = withoutHost.split(/[?#]/)[0];
  if (/^\/uploads\//i.test(withoutQuery)) return withoutQuery;
  if (/^uploads\//i.test(withoutQuery)) return `/${withoutQuery.replace(/^\/+/, '')}`;

  const uploadSegmentIndex = withoutQuery.toLowerCase().indexOf('/uploads/');
  if (uploadSegmentIndex >= 0) return withoutQuery.slice(uploadSegmentIndex);

  const fromDisk = coreFilesService.fromDiskPathToUploadsUrl(token);
  if (fromDisk) return fromDisk;
  return '';
}

function pushUniqueUrlCandidate(out = [], candidate = '') {
  const token = s(candidate, 2000);
  if (!token) return;
  const compare = token.toLowerCase();
  if (!out.some((row) => s(row, 2000).toLowerCase() === compare)) out.push(token);
}

function buildGatewayUploadUrl(uploadPath = '') {
  const pathToken = normalizeUploadUrlToken(uploadPath);
  if (!pathToken) return '';
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl) return '';
  return `${baseUrl}${pathToken}`;
}

function buildGatewayUploadUrlFromRelativePath(value = '') {
  const token = s(value, 2000).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!token) return '';
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl) return '';
  const uploadPath = /^uploads\//i.test(token) ? `/${token}` : `/uploads/${token}`;
  return `${baseUrl}${uploadPath}`;
}

function getArtifactUploadUrlCandidates(artifact = {}) {
  const metadata = isPlainObject(artifact?.metadata) ? artifact.metadata : {};
  const values = [
    artifact.url,
    artifact.path,
    artifact.filePath,
    artifact.localPath,
    artifact.storagePath,
    artifact.uploadUrl,
    metadata.url,
    metadata.path,
    metadata.filePath,
    metadata.localPath,
    metadata.storagePath,
    metadata.uploadUrl
  ].map((value) => s(value, 2000));

  const candidates = [];
  values.forEach((value) => {
    if (!value) return;
    if (isAppUploadUrl(value)) {
      const normalized = normalizeUploadUrlToken(value);
      if (/^https?:\/\//i.test(value)) pushUniqueUrlCandidate(candidates, value);
      const gatewayUrl = buildGatewayUploadUrl(normalized || value);
      if (gatewayUrl) pushUniqueUrlCandidate(candidates, gatewayUrl);
      return;
    }
    const gatewayUrl = buildGatewayUploadUrl(value);
    if (gatewayUrl) pushUniqueUrlCandidate(candidates, gatewayUrl);
  });

  const gatewayRelativePath = s(metadata.gatewayRelativePath || artifact.gatewayRelativePath, 2000)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (gatewayRelativePath) {
    pushUniqueUrlCandidate(candidates, buildGatewayUploadUrlFromRelativePath(gatewayRelativePath));
  }

  return candidates;
}

function resolveUploadPathFromUrl(url = '') {
  const token = s(url, 2000).replace(/^https?:\/\/[^/]+/i, '');
  if (!/^\/?uploads\//i.test(token)) return '';
  return coreFilesService.fromUploadsUrlToDiskPath(token);
}

function resolveUploadArtifactPath(artifact = {}) {
  const rawPath = s(artifact.path || artifact.filePath || artifact.localPath || '', 2000);
  if (rawPath && !/^https?:\/\//i.test(rawPath)) {
    if (/^\/?uploads\//i.test(rawPath)) return resolveUploadPathFromUrl(rawPath);
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  }

  const url = s(artifact.url || '', 2000);
  if (url) return resolveUploadPathFromUrl(url);
  return '';
}

async function readRemoteUploadArtifactForAi({
  artifact = {},
  maxBytes = 0,
  expectedMimePrefix = '',
  inferMimeType = null,
  tooLargeLabel = 'Uploaded artifact',
  timeoutMs = DEFAULT_REMOTE_FETCH_TIMEOUT_MS
} = {}) {
  const candidates = getArtifactUploadUrlCandidates(artifact);
  if (!candidates.length) return null;

  let lastError = null;
  for (const remoteUrl of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_REMOTE_FETCH_TIMEOUT_MS));
    try {
      const response = await fetch(remoteUrl, {
        method: 'GET',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Uploaded artifact URL could not be read (${response.status}).`);
      }

      const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
      if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`${tooLargeLabel} is too large for v1 scoring (max ${Math.floor(maxBytes / (1024 * 1024))}MB).`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        throw new Error(`${tooLargeLabel} file is empty.`);
      }
      if (maxBytes && buffer.length > maxBytes) {
        throw new Error(`${tooLargeLabel} is too large for v1 scoring (max ${Math.floor(maxBytes / (1024 * 1024))}MB).`);
      }

      const headerMime = s(response.headers.get('content-type') || '', 120).toLowerCase();
      const inferredMime = typeof inferMimeType === 'function' ? inferMimeType(artifact, remoteUrl) : '';
      const mimeType = headerMime.startsWith(expectedMimePrefix) ? headerMime : inferredMime;
      return {
        absolutePath: '',
        sourceUrl: remoteUrl,
        mimeType,
        dataBase64: buffer.toString('base64'),
        sizeBytes: buffer.length
      };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function readUploadArtifactForAi({
  artifact = {},
  maxBytes = 0,
  expectedMimePrefix = '',
  inferMimeType = null,
  tooLargeLabel = 'Uploaded artifact'
} = {}) {
  const absolutePath = resolveUploadArtifactPath(artifact);
  if (!absolutePath) {
    const remote = await readRemoteUploadArtifactForAi({
      artifact,
      maxBytes,
      expectedMimePrefix,
      inferMimeType,
      tooLargeLabel
    });
    if (remote) return remote;
    throw new Error(`${tooLargeLabel} does not have a readable local path.`);
  }

  let stat = null;
  try {
    stat = await fs.stat(absolutePath);
  } catch (_) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    const remote = await readRemoteUploadArtifactForAi({
      artifact,
      maxBytes,
      expectedMimePrefix,
      inferMimeType,
      tooLargeLabel
    });
    if (remote) return remote;
    throw new Error(`${tooLargeLabel} file is missing on disk.`);
  }
  if (Number(stat.size || 0) <= 0) {
    throw new Error(`${tooLargeLabel} file is empty.`);
  }
  if (maxBytes && Number(stat.size || 0) > maxBytes) {
    throw new Error(`${tooLargeLabel} is too large for v1 scoring (max ${Math.floor(maxBytes / (1024 * 1024))}MB).`);
  }

  const buffer = await fs.readFile(absolutePath);
  return {
    absolutePath,
    mimeType: typeof inferMimeType === 'function' ? inferMimeType(artifact, absolutePath) : '',
    dataBase64: buffer.toString('base64'),
    sizeBytes: Number(stat.size || buffer.length || 0)
  };
}

module.exports = {
  getArtifactUploadUrlCandidates,
  readRemoteUploadArtifactForAi,
  readUploadArtifactForAi,
  resolveUploadArtifactPath
};

module.exports = require('../../../packages/pte/MVC/services/pte/pteScoringArtifactReader.js');
