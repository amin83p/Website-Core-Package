/**
 * Public upload/read API for core and packages. All durable storage goes through this module.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const uploadStoragePolicy = require('./uploadStoragePolicyService');
const fileAssetStorage = require('./fileAssetStorageService');
const coreFilesService = require('./coreFilesService');
const uploadPathUtils = require('../utils/uploadPathUtils');
const { streamUploadFromGateway } = require('./uploadGatewayStreamService');

function clean(value) {
  return String(value || '').trim();
}

function assertReady() {
  uploadStoragePolicy.assertStorageReadyForOperation();
}

function normalizeReference(ref = '') {
  assertReady();
  const token = clean(ref);
  if (!token) throw new Error('Upload reference is required.');
  if (fileAssetStorage.isUploadReference(token)) {
    const relative = uploadPathUtils.extractRelativeUploadPath(token);
    if (!relative) throw new Error('Invalid upload reference.');
    return `/uploads/${relative}`;
  }
  const fromDisk = uploadPathUtils.fromDiskPathToUploadsUrl(token);
  if (fromDisk) return fromDisk;
  if (uploadStoragePolicy.isRailwayGatewayBackend()) {
    throw new Error('Stored file reference must be an /uploads/ URL when using railway_proxy mode.');
  }
  throw new Error('Unable to normalize upload reference.');
}

function getStoredRefFromFile(file = {}) {
  return clean(file?.storedRef || file?.uploadUrl || file?.storagePath || file?.path || '');
}

async function persistMulterUploads({ category = '', req = {}, options = {} } = {}) {
  assertReady();
  const fixedCategory = clean(category);
  const requestPath = String(req.originalUrl || req.url || '').toLowerCase();
  if (requestPath.includes('/files/upload') && !options.force) {
    return { files: [] };
  }
  await coreFilesService.mirrorUploadedFilesIfNeeded(req, fixedCategory);
  const rows = [];
  const files = [];
  if (req?.file) files.push(req.file);
  if (Array.isArray(req?.files)) files.push(...req.files);
  if (req?.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
    Object.values(req.files).forEach((entry) => {
      if (Array.isArray(entry)) files.push(...entry);
    });
  }
  files.forEach((file) => {
    if (!file) return;
    const storedRef = getStoredRefFromFile(file);
    if (storedRef) {
      file.storedRef = normalizeReference(storedRef);
      file.uploadUrl = file.storedRef;
      file.storagePath = file.storedRef;
      if (uploadStoragePolicy.isRailwayGatewayBackend()) {
        file.path = file.storedRef;
      }
    }
    rows.push(file);
  });
  return { files: rows };
}

const fileManager = {
  buildCurrentPathFromUploadBody: (...args) => coreFilesService.buildCurrentPathFromUploadBody(...args),
  resolveContextFromPath: (...args) => coreFilesService.resolveContextFromPath(...args),
  parseRelativePathsMap: (...args) => coreFilesService.parseRelativePathsMap(...args),
  uploadFilesToContext: async (...args) => {
    assertReady();
    return coreFilesService.uploadFilesToContext(...args);
  },
  listContextDirectory: async (...args) => {
    assertReady();
    return coreFilesService.listContextDirectory(...args);
  },
  transferSingleItem: async (...args) => {
    assertReady();
    return coreFilesService.transferSingleItem(...args);
  },
  deletePathByContext: async (...args) => {
    assertReady();
    return coreFilesService.deletePathByContext(...args);
  },
  renamePathByContext: async (...args) => {
    assertReady();
    return coreFilesService.renamePathByContext(...args);
  },
  createFolderByContext: async (...args) => {
    assertReady();
    return coreFilesService.createFolderByContext(...args);
  }
};

async function saveBuffer(payload = {}) {
  assertReady();
  return fileAssetStorage.saveBuffer(payload);
}

async function saveJson(payload = {}) {
  assertReady();
  return fileAssetStorage.saveJson(payload);
}

async function readBuffer(ref = '') {
  assertReady();
  return fileAssetStorage.readBuffer(ref);
}

async function sendDownload(res, ref = '', downloadName = '') {
  assertReady();
  return fileAssetStorage.sendDownload(res, ref, downloadName);
}

async function ensureDirectory(scopeKey = '', relativeDir = '') {
  assertReady();
  return fileAssetStorage.ensureDirectory(scopeKey, relativeDir);
}

async function listDirectory(payload = {}) {
  assertReady();
  return fileAssetStorage.listDirectory(payload);
}

async function deleteByReference(ref = '') {
  assertReady();
  return fileAssetStorage.deleteByUploadUrl(ref);
}

async function deleteRelativePath(payload = {}) {
  assertReady();
  return fileAssetStorage.deleteRelativePath(payload);
}

async function moveReference(payload = {}) {
  assertReady();
  return fileAssetStorage.moveUploadReference(payload);
}

async function copyRelativePath(payload = {}) {
  assertReady();
  return fileAssetStorage.copyRelativePath(payload);
}

async function streamPublicUpload(req, res) {
  assertReady();
  if (uploadStoragePolicy.isRailwayGatewayBackend()) {
    return streamUploadFromGateway(req, res);
  }
  return null;
}

function getMaxUploadFileMb() {
  return coreFilesService.getMaxUploadFileMb();
}

function resolveUploadCategory(fixedCategory, isDynamic, req) {
  return coreFilesService.resolveUploadCategory(fixedCategory, isDynamic, req);
}

async function readUploadedFileAsUtf8(file = {}) {
  assertReady();
  const rawRef = getStoredRefFromFile(file);
  if (!rawRef) throw new Error('Uploaded file reference is missing.');
  if (fileAssetStorage.isUploadReference(rawRef)) {
    const ref = normalizeReference(rawRef);
    const { buffer } = await readBuffer(ref);
    return Buffer.from(buffer).toString('utf8');
  }
  if (uploadStoragePolicy.isRailwayGatewayBackend()) {
    throw new Error('Uploaded file must be stored as an /uploads/ URL when using remote upload storage.');
  }
  const diskPath = path.isAbsolute(rawRef) ? rawRef : path.resolve(process.cwd(), rawRef);
  return fs.readFileSync(diskPath, 'utf8');
}

async function removeUploadedMulterFile(fileOrRef = '') {
  const ref = typeof fileOrRef === 'string'
    ? clean(fileOrRef)
    : getStoredRefFromFile(fileOrRef);
  if (!ref) return;
  if (fileAssetStorage.isUploadReference(ref)) {
    try {
      await deleteByReference(normalizeReference(ref));
    } catch (_) { /* best-effort cleanup */ }
    return;
  }
  const diskPath = path.isAbsolute(ref) ? ref : path.resolve(process.cwd(), ref);
  await fsp.unlink(diskPath).catch(() => {});
}

module.exports = {
  getStorageBackend: uploadStoragePolicy.getStorageBackend,
  isRailwayGatewayBackend: uploadStoragePolicy.isRailwayGatewayBackend,
  isRemoteUploadBackend: uploadStoragePolicy.isRemoteUploadBackend,
  assertStorageReady: assertReady,
  isUploadReference: fileAssetStorage.isUploadReference,
  normalizeReference,
  normalizeScopeKey: fileAssetStorage.normalizeScopeKey,
  uploadsUrlForParts: fileAssetStorage.uploadsUrlForParts,
  getStoredRefFromFile,
  persistMulterUploads,
  saveBuffer,
  saveJson,
  readBuffer,
  sendDownload,
  ensureDirectory,
  listDirectory,
  deleteByReference,
  deleteRelativePath,
  moveReference,
  copyRelativePath,
  streamPublicUpload,
  getMaxUploadFileMb,
  resolveUploadCategory,
  readUploadedFileAsUtf8,
  removeUploadedMulterFile,
  fileManager,
  // Multer middleware compatibility (core routes only during migration)
  getStoredFilePath: coreFilesService.getStoredFilePath,
  getStoredFileUrl: coreFilesService.getStoredFileUrl
};
