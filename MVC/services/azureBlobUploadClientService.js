'use strict';

const fs = require('fs').promises;
const path = require('path');
const { BlobServiceClient, StorageSharedKeyCredential, BlobSASPermissions, generateBlobSASQueryParameters } = require('@azure/storage-blob');
const uploadStoragePolicy = require('./uploadStoragePolicyService');
const {
  getAzureBlobContainerFromSettings,
  getAzureBlobPrefixFromSettings
} = require('../utils/uploadModeUtils');
const uploadPathUtils = require('../utils/uploadPathUtils');

function clean(value) {
  return String(value || '').trim();
}

function cleanRelativePath(value = '') {
  return clean(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function normalizeScopeKey(scopeKey = '') {
  const token = clean(scopeKey).toUpperCase();
  if (!token || token === 'GLOBAL' || token === 'SYSTEM') return 'GLOBAL';
  return token.replace(/^ORG_/, '');
}

function scopeFolder(scopeKey = '') {
  const scope = normalizeScopeKey(scopeKey);
  return scope === 'GLOBAL' ? 'GLOBAL' : `ORG_${scope}`;
}

function buildConflictName(name = '', index = 0) {
  const token = clean(name);
  if (index <= 0) return token;
  const ext = path.extname(token);
  const base = path.basename(token, ext);
  return `${base}_${index}${ext}`;
}

function uploadsUrlForParts(scopeKey = '', relativeDir = '', fileName = '') {
  const parts = [scopeFolder(scopeKey), cleanRelativePath(relativeDir)].filter(Boolean);
  const safeName = clean(fileName) ? path.basename(clean(fileName)) : '';
  if (safeName) parts.push(safeName);
  return `/uploads/${parts.join('/')}`;
}

function parseUploadUrl(uploadUrl = '') {
  const relative = uploadPathUtils.extractRelativeUploadPath(uploadUrl);
  if (!relative) return null;
  const parts = relative.split('/').filter(Boolean);
  const first = parts.shift() || '';
  const scope = first.toUpperCase() === 'GLOBAL' ? 'GLOBAL' : first.replace(/^ORG_/i, '');
  const fileName = parts.length ? parts[parts.length - 1] : '';
  const relativeDir = parts.slice(0, -1).join('/');
  return {
    scopeKey: normalizeScopeKey(scope),
    relativePath: [relativeDir, fileName].filter(Boolean).join('/'),
    relativeDir,
    fileName,
    uploadUrl: `/uploads/${[first, ...parts].join('/')}`
  };
}

function buildBlobKey(scopeKey = '', relativeDir = '', fileName = '') {
  const prefix = getAzureBlobPrefixFromSettings();
  const parts = [
    prefix,
    scopeFolder(scopeKey),
    cleanRelativePath(relativeDir),
    clean(fileName) ? path.basename(clean(fileName)) : ''
  ].filter(Boolean);
  return parts.join('/');
}

function buildBlobKeyFromUploadUrl(uploadUrl = '') {
  const parsed = parseUploadUrl(uploadUrl);
  if (!parsed || !parsed.fileName) return '';
  return buildBlobKey(parsed.scopeKey, parsed.relativeDir, parsed.fileName);
}

let cachedBlobServiceClient = null;
let cachedCredential = null;

function resolveConnectionConfig() {
  const connectionString = clean(process.env.AZURE_STORAGE_CONNECTION_STRING)
    || clean(process.env.AZURE_STORAGE_CONNECTIONSTRING);
  if (connectionString) {
    return { connectionString };
  }
  const account = clean(process.env.AZURE_STORAGE_ACCOUNT);
  const key = clean(process.env.AZURE_STORAGE_ACCOUNT_KEY);
  if (account && key) {
    return { account, key };
  }
  uploadStoragePolicy.assertAzureBlobReady();
  throw new Error('Azure Blob credentials are not configured.');
}

function getBlobServiceClient() {
  if (cachedBlobServiceClient) return cachedBlobServiceClient;
  const config = resolveConnectionConfig();
  if (config.connectionString) {
    cachedBlobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
    return cachedBlobServiceClient;
  }
  const credential = new StorageSharedKeyCredential(config.account, config.key);
  cachedCredential = credential;
  cachedBlobServiceClient = new BlobServiceClient(
    `https://${config.account}.blob.core.windows.net`,
    credential
  );
  return cachedBlobServiceClient;
}

function getContainerClient() {
  const containerName = getAzureBlobContainerFromSettings();
  return getBlobServiceClient().getContainerClient(containerName);
}

async function ensureContainer() {
  const client = getContainerClient();
  await client.createIfNotExists();
  return client;
}

async function resolveAvailableBlobName(scopeKey = '', relativeDir = '', desiredName = '') {
  const container = await ensureContainer();
  let candidate = clean(desiredName) || 'file';
  for (let index = 0; index < 250; index += 1) {
    const name = buildConflictName(candidate, index);
    const key = buildBlobKey(scopeKey, relativeDir, name);
    const block = container.getBlockBlobClient(key);
    // eslint-disable-next-line no-await-in-loop
    if (!(await block.exists())) {
      return { fileName: name, blobKey: key };
    }
  }
  throw new Error('Unable to resolve a unique blob name.');
}

async function uploadBuffer({
  scopeKey = '',
  relativeDir = '',
  desiredName = '',
  buffer = null,
  mimeType = 'application/octet-stream',
  overwrite = false
} = {}) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  let fileName = clean(desiredName) || 'file';
  let blobKey = buildBlobKey(scopeKey, relativeDir, fileName);
  const container = await ensureContainer();
  let block = container.getBlockBlobClient(blobKey);
  if (!overwrite && (await block.exists())) {
    const resolved = await resolveAvailableBlobName(scopeKey, relativeDir, fileName);
    fileName = resolved.fileName;
    blobKey = resolved.blobKey;
    block = container.getBlockBlobClient(blobKey);
  } else if (overwrite && (await block.exists())) {
    await block.deleteIfExists();
    block = container.getBlockBlobClient(blobKey);
  }
  await block.uploadData(source, {
    blobHTTPHeaders: { blobContentType: clean(mimeType) || 'application/octet-stream' }
  });
  const url = uploadsUrlForParts(scopeKey, relativeDir, fileName);
  return {
    url,
    uploadUrl: url,
    relativePath: uploadPathUtils.extractRelativeUploadPath(url),
    fileName,
    originalName: fileName,
    size: source.length,
    renamed: clean(desiredName) !== fileName
  };
}

async function uploadFile({
  scopeKey = '',
  relativeDir = '',
  desiredName = '',
  localFilePath = '',
  mimeType = 'application/octet-stream',
  overwrite = false
} = {}) {
  const absolute = path.resolve(String(localFilePath || ''));
  const fileBuffer = await fs.readFile(absolute);
  return uploadBuffer({
    scopeKey,
    relativeDir,
    desiredName: clean(desiredName) || path.basename(absolute),
    buffer: fileBuffer,
    mimeType,
    overwrite
  });
}

async function downloadByUploadUrl(uploadUrl = '') {
  const blobKey = buildBlobKeyFromUploadUrl(uploadUrl);
  if (!blobKey) throw new Error('Invalid upload URL.');
  const container = await ensureContainer();
  const block = container.getBlockBlobClient(blobKey);
  if (!(await block.exists())) {
    const err = new Error(`Blob not found: ${blobKey}`);
    err.code = 'ENOENT';
    throw err;
  }
  const props = await block.getProperties();
  const buffer = await block.downloadToBuffer();
  return {
    buffer,
    mimeType: props.contentType || 'application/octet-stream',
    size: buffer.length,
    uploadUrl: clean(uploadUrl)
  };
}

async function downloadRemoteUploadFile(scopeKey = '', relativePath = '') {
  const safePath = cleanRelativePath(relativePath);
  const parts = safePath.split('/').filter(Boolean);
  const fileName = parts.pop() || '';
  const relativeDir = parts.join('/');
  const uploadUrl = uploadsUrlForParts(scopeKey, relativeDir, fileName);
  const downloaded = await downloadByUploadUrl(uploadUrl);
  return {
    blob: new Blob([downloaded.buffer], { type: downloaded.mimeType }),
    mimeType: downloaded.mimeType,
    size: downloaded.size,
    uploadUrl
  };
}

async function deleteByUploadUrl(uploadUrl = '') {
  const blobKey = buildBlobKeyFromUploadUrl(uploadUrl);
  if (!blobKey) return false;
  const container = await ensureContainer();
  await container.getBlockBlobClient(blobKey).deleteIfExists();
  return true;
}

async function deleteByRelativePath({ scopeKey = '', relativePath = '' } = {}) {
  const parsedPath = cleanRelativePath(relativePath);
  if (!parsedPath) return false;
  const parts = parsedPath.split('/');
  const fileName = parts.pop();
  if (!fileName) {
    const prefix = `${buildBlobKey(scopeKey, parsedPath, '').replace(/\/$/, '')}/`;
    const container = await ensureContainer();
    for await (const item of container.listBlobsFlat({ prefix })) {
      await container.getBlockBlobClient(item.name).deleteIfExists();
    }
    return true;
  }
  const relativeDir = parts.join('/');
  const url = uploadsUrlForParts(scopeKey, relativeDir, fileName);
  return deleteByUploadUrl(url);
}

async function listDirectory({ scopeKey = '', relativeDir = '' } = {}) {
  const container = await ensureContainer();
  const baseKey = buildBlobKey(scopeKey, relativeDir, '');
  const prefix = baseKey ? `${baseKey.replace(/\/$/, '')}/` : '';
  const delimiter = '/';
  const files = [];
  const seenDirs = new Set();
  for await (const item of container.listBlobsByHierarchy(delimiter, { prefix })) {
    if (item.kind === 'prefix') {
      const name = item.name.slice(prefix.length).replace(/\/$/, '');
      if (name) seenDirs.add(name);
    } else if (item.kind === 'blob') {
      const name = item.name.slice(prefix.length);
      if (!name || name.includes('/')) continue;
      files.push({
        name,
        isDir: false,
        size: Number(item.properties.contentLength || 0),
        modified: item.properties.lastModified
          ? new Date(item.properties.lastModified).toISOString()
          : ''
      });
    }
  }
  seenDirs.forEach((name) => {
    files.push({
      name,
      isDir: true,
      size: 0,
      modified: ''
    });
  });
  files.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return String(a.name).localeCompare(String(b.name));
  });
  return { files };
}

async function copyBlockBlob(sourceKey = '', destKey = '') {
  const container = await ensureContainer();
  const source = container.getBlockBlobClient(sourceKey);
  const dest = container.getBlockBlobClient(destKey);
  const poller = await dest.beginCopyFromURL(source.url);
  await poller.pollUntilDone();
  return dest;
}

async function moveItem({
  sourceScopeKey = '',
  sourceRelativePath = '',
  destinationScopeKey = '',
  destinationRelativeDir = ''
} = {}) {
  const sourcePath = cleanRelativePath(sourceRelativePath);
  const parts = sourcePath.split('/').filter(Boolean);
  const sourceName = parts.pop() || '';
  const sourceDir = parts.join('/');
  const sourceKey = buildBlobKey(sourceScopeKey, sourceDir, sourceName);
  const resolvedDest = await resolveAvailableBlobName(
    destinationScopeKey,
    destinationRelativeDir,
    sourceName
  );
  const destKey = buildBlobKey(destinationScopeKey, destinationRelativeDir, resolvedDest.fileName);
  await copyBlockBlob(sourceKey, destKey);
  await getContainerClient().getBlockBlobClient(sourceKey).deleteIfExists();
  return {
    finalName: resolvedDest.fileName,
    url: uploadsUrlForParts(destinationScopeKey, destinationRelativeDir, resolvedDest.fileName)
  };
}

async function copyItem({
  sourceScopeKey = '',
  sourceRelativePath = '',
  destinationScopeKey = '',
  destinationRelativeDir = ''
} = {}) {
  const sourcePath = cleanRelativePath(sourceRelativePath);
  const parts = sourcePath.split('/').filter(Boolean);
  const sourceName = parts.pop() || '';
  const sourceDir = parts.join('/');
  const sourceKey = buildBlobKey(sourceScopeKey, sourceDir, sourceName);
  const resolvedDest = await resolveAvailableBlobName(
    destinationScopeKey,
    destinationRelativeDir,
    sourceName
  );
  const destKey = buildBlobKey(destinationScopeKey, destinationRelativeDir, resolvedDest.fileName);
  await copyBlockBlob(sourceKey, destKey);
  return {
    finalName: resolvedDest.fileName,
    path: uploadsUrlForParts(destinationScopeKey, destinationRelativeDir, resolvedDest.fileName),
    url: uploadsUrlForParts(destinationScopeKey, destinationRelativeDir, resolvedDest.fileName)
  };
}

async function renameItem({
  scopeKey = '',
  relativePath = '',
  newName = ''
} = {}) {
  const safePath = cleanRelativePath(relativePath);
  const parts = safePath.split('/').filter(Boolean);
  const oldName = parts.pop() || '';
  const parentDir = parts.join('/');
  const safeNew = clean(newName);
  if (!safeNew || safeNew === oldName) throw new Error('New name must be different from the current name.');
  const sourceKey = buildBlobKey(scopeKey, parentDir, oldName);
  const destKey = buildBlobKey(scopeKey, parentDir, path.basename(safeNew));
  const container = await ensureContainer();
  if (await container.getBlockBlobClient(destKey).exists()) {
    throw new Error('A file or folder with this name already exists.');
  }
  await copyBlockBlob(sourceKey, destKey);
  await container.getBlockBlobClient(sourceKey).deleteIfExists();
  return {
    finalName: path.basename(safeNew),
    url: uploadsUrlForParts(scopeKey, parentDir, path.basename(safeNew))
  };
}

async function createFolder({ scopeKey = '', relativeDir = '', folderName = '' } = {}) {
  const safeFolder = clean(folderName);
  if (!safeFolder) throw new Error('Folder name is required.');
  const placeholderKey = `${buildBlobKey(scopeKey, [relativeDir, safeFolder].filter(Boolean).join('/'), '.keep')}`;
  const container = await ensureContainer();
  const block = container.getBlockBlobClient(placeholderKey);
  if (!(await block.exists())) {
    await block.uploadData(Buffer.from(''), {
      blobHTTPHeaders: { blobContentType: 'application/octet-stream' }
    });
  }
  return { ok: true };
}

function getBlobSasUrlForUploadPath(relativeUploadPath = '', expiresMinutes = 15) {
  const blobKey = buildBlobKeyFromUploadUrl(relativeUploadPath.startsWith('/uploads/')
    ? relativeUploadPath
    : `/uploads/${cleanRelativePath(relativeUploadPath)}`);
  if (!blobKey) return '';
  const containerName = getAzureBlobContainerFromSettings();
  const config = resolveConnectionConfig();
  let credential = cachedCredential;
  let accountName = clean(process.env.AZURE_STORAGE_ACCOUNT);
  if (config.connectionString && !credential) {
    const client = getBlobServiceClient();
    accountName = client.accountName;
    if (!accountName) return '';
  }
  if (config.account) accountName = config.account;
  if (!credential && config.account && config.key) {
    credential = new StorageSharedKeyCredential(config.account, config.key);
  }
  if (!credential || !accountName) return '';
  const startsOn = new Date();
  const expiresOn = new Date(Date.now() + Math.max(1, expiresMinutes) * 60 * 1000);
  const sas = generateBlobSASQueryParameters({
    containerName,
    blobName: blobKey,
    permissions: BlobSASPermissions.parse('r'),
    startsOn,
    expiresOn
  }, credential).toString();
  const encodedKey = blobKey.split('/').map(encodeURIComponent).join('/');
  return `https://${accountName}.blob.core.windows.net/${encodeURIComponent(containerName)}/${encodedKey}?${sas}`;
}

module.exports = {
  normalizeScopeKey,
  scopeFolder,
  buildBlobKey,
  buildBlobKeyFromUploadUrl,
  uploadsUrlForParts,
  parseUploadUrl,
  ensureContainer,
  uploadBuffer,
  uploadFile,
  downloadByUploadUrl,
  downloadRemoteUploadFile,
  deleteByUploadUrl,
  deleteByRelativePath,
  listDirectory,
  moveItem,
  copyItem,
  renameItem,
  createFolder,
  getBlobSasUrlForUploadPath
};