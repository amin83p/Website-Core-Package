const fs = require('fs');
const path = require('path');
const pathResolver = require('../utils/pathResolver');
const uploadPathUtils = require('../utils/uploadPathUtils');

const INVALID_NAME_PATTERN = /[<>:"/\\|?*\x00-\x1F]/;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function clean(value) {
  return String(value || '').trim();
}

function assertValidName(name, label = 'name') {
  const token = clean(name);
  if (!token || token === '.' || token === '..') throw new Error(`Invalid ${label}.`);
  if (INVALID_NAME_PATTERN.test(token)) throw new Error(`Invalid ${label}.`);
  if (WINDOWS_RESERVED_NAMES.has(token.toUpperCase())) throw new Error(`Invalid ${label}.`);
  return token;
}

function assertValidRelativePath(rawPath = '', label = 'path') {
  const normalized = clean(rawPath).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return '';
  if (path.isAbsolute(normalized)) throw new Error(`Invalid ${label}.`);
  const parts = normalized.split('/').filter(Boolean).map((part) => assertValidName(part, label));
  return parts.join('/');
}

function normalizeScopeKey(scopeKey = '') {
  const token = clean(scopeKey).toUpperCase();
  if (!token || token === 'GLOBAL') return 'GLOBAL';
  return token.replace(/^ORG_/, '');
}

function resolveDir(scopeKey = '', relativeDir = '') {
  const scope = normalizeScopeKey(scopeKey);
  const baseDir = pathResolver.getRootPath(scope);
  const safeRelative = assertValidRelativePath(relativeDir, 'relative path');
  const targetDir = pathResolver.resolveSafePath(baseDir, safeRelative);
  pathResolver.ensureDir(targetDir);
  return { scope, safeRelative, targetDir };
}

function resolveAvailableFilePath(directory, desiredName) {
  const ext = path.extname(desiredName);
  const base = path.basename(desiredName, ext);
  let candidate = path.join(directory, desiredName);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${base}_${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function serializeUploadResult({ filePath = '', originalName = '', mimeType = '' } = {}) {
  const finalName = path.basename(filePath);
  const url = uploadPathUtils.fromDiskPathToUploadsUrl(filePath);
  const relativePath = uploadPathUtils.extractRelativeUploadPath(url);
  return {
    url,
    relativePath,
    fileName: finalName,
    originalName: clean(originalName) || finalName,
    type: clean(mimeType).startsWith('image/') ? 'image' : 'file'
  };
}

async function writeGatewayUploadBuffer({
  scopeKey = 'GLOBAL',
  relativeDir = '',
  desiredName = '',
  buffer = null,
  mimeType = 'application/octet-stream'
} = {}) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length <= 0) {
    throw new Error('No file uploaded.');
  }
  const safeName = assertValidName(desiredName || 'file', 'file name');
  const { targetDir } = resolveDir(scopeKey, relativeDir);
  const availablePath = resolveAvailableFilePath(targetDir, safeName);
  const renamed = path.basename(availablePath) !== safeName;
  await fs.promises.writeFile(availablePath, buffer);

  const payload = serializeUploadResult({
    filePath: availablePath,
    originalName: safeName,
    mimeType
  });

  return {
    status: 'success',
    message: 'File uploaded via gateway.',
    renamed,
    ...payload
  };
}

module.exports = {
  writeGatewayUploadBuffer
};
