const path = require('path');
const fs = require('fs');
const settingService = require('../services/settingService');

const UPLOADS_URL_PREFIX = '/uploads';
const DEFAULT_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
let lastWarnedInvalidRoot = '';

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeAbsolutePath(inputPath) {
  const token = cleanString(inputPath);
  if (!token) return '';
  return path.resolve(token);
}

function normalizeForCompare(inputPath) {
  const resolved = normalizeAbsolutePath(inputPath);
  if (!resolved) return '';
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInsideUploadRoot(targetPath, baseRoot = '') {
  const root = normalizeForCompare(baseRoot || getUploadRootAbsolute());
  const target = normalizeForCompare(targetPath);
  if (!root || !target) return false;
  if (root === target) return true;
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveConfiguredRoot(value) {
  const token = cleanString(value);
  if (!token) return '';
  if (path.isAbsolute(token)) {
    return normalizeAbsolutePath(token);
  }
  return normalizeAbsolutePath(path.resolve(process.cwd(), token));
}

function getUploadRootAbsolute() {
  let configured = '';
  try {
    configured = cleanString(settingService.getValue('app', 'uploadsPath'));
  } catch (_) {
    configured = '';
  }
  const resolved = resolveConfiguredRoot(configured);
  if (!resolved) return DEFAULT_UPLOAD_ROOT;

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return resolved;
    }
  } catch (_) {
    try {
      fs.mkdirSync(resolved, { recursive: true });
      return resolved;
    } catch (_) {
      // fall back below
    }
  }

  if (lastWarnedInvalidRoot !== resolved) {
    lastWarnedInvalidRoot = resolved;
    console.warn(`[UploadPath] Configured uploadsPath is not a readable directory: "${resolved}". Falling back to "${DEFAULT_UPLOAD_ROOT}".`);
  }
  return DEFAULT_UPLOAD_ROOT;
}

function extractRelativeUploadPath(uploadUrl = '') {
  const token = cleanString(uploadUrl);
  if (!token) return '';
  const withoutHost = token.replace(/^https?:\/\/[^/]+/i, '');
  const normalized = withoutHost.replace(/\\/g, '/');
  const match = normalized.match(/^\/?uploads\/(.+)$/i);
  if (!match || !match[1]) return '';
  return String(match[1]).replace(/^\/+/, '');
}

function fromUploadsUrlToDiskPath(uploadUrl = '', rootPath = '') {
  const relativePath = extractRelativeUploadPath(uploadUrl);
  if (!relativePath) return '';
  const root = normalizeAbsolutePath(rootPath || getUploadRootAbsolute());
  if (!root) return '';
  const candidate = normalizeAbsolutePath(path.join(root, relativePath));
  if (!isInsideUploadRoot(candidate, root)) return '';
  return candidate;
}

function fromDiskPathToUploadsUrl(absolutePath = '', rootPath = '') {
  const token = cleanString(absolutePath).replace(/\\/g, '/');
  if (/^https?:\/\/[^/]+\/uploads\//i.test(token) || /^\/uploads\//i.test(token)) {
    const relative = extractRelativeUploadPath(token);
    return relative ? `${UPLOADS_URL_PREFIX}/${relative}` : '';
  }

  const root = normalizeAbsolutePath(rootPath || getUploadRootAbsolute());
  const target = normalizeAbsolutePath(absolutePath);
  if (!root || !target || !isInsideUploadRoot(target, root)) return '';
  const relative = path.relative(root, target).split(path.sep).join('/');
  const cleanedRelative = String(relative || '').replace(/^\/+/, '');
  if (!cleanedRelative) return '';
  return `${UPLOADS_URL_PREFIX}/${cleanedRelative}`;
}

module.exports = {
  UPLOADS_URL_PREFIX,
  DEFAULT_UPLOAD_ROOT,
  getUploadRootAbsolute,
  isInsideUploadRoot,
  extractRelativeUploadPath,
  fromUploadsUrlToDiskPath,
  fromDiskPathToUploadsUrl
};
