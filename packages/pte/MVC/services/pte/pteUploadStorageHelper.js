'use strict';

const { coreFilesService, uploadStorageService } = require('./pteCoreContracts');

function clean(value = '', max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function toCanonicalUploadReference(filePath = '', fileUrl = '') {
  const fromUrl = coreFilesService.extractRelativeUploadPath(fileUrl);
  if (fromUrl) {
    try {
      return uploadStorageService.normalizeReference(`/uploads/${fromUrl}`);
    } catch (_) {
      return `/uploads/${fromUrl}`;
    }
  }
  const fromPathUrl = coreFilesService.extractRelativeUploadPath(filePath);
  if (fromPathUrl) {
    try {
      return uploadStorageService.normalizeReference(`/uploads/${fromPathUrl}`);
    } catch (_) {
      return `/uploads/${fromPathUrl}`;
    }
  }
  if (uploadStorageService.isRemoteUploadBackend()) {
    return clean(fileUrl, 1600) || clean(filePath, 1600);
  }
  return coreFilesService.fromDiskPathToUploadsUrl(filePath)
    || String(filePath || '').replace(/\\/g, '/').trim();
}

function isUploadRefUnderRelativePrefixes(uploadRef = '', relativePrefixes = []) {
  const relative = coreFilesService.extractRelativeUploadPath(uploadRef);
  if (!relative) return false;
  const normalized = relative.replace(/\\/g, '/').toLowerCase();
  return (Array.isArray(relativePrefixes) ? relativePrefixes : [])
    .map((row) => String(row || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
    .filter(Boolean)
    .some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

async function uploadReferenceExists(uploadRef = '') {
  const ref = clean(uploadRef, 2000);
  if (!ref || !uploadStorageService.isUploadReference(ref)) return false;
  try {
    await uploadStorageService.readBuffer(ref);
    return true;
  } catch (_) {
    return false;
  }
}

async function readUploadReferenceBuffer(uploadRef = '', { maxBytes = 0 } = {}) {
  const ref = clean(uploadRef, 2000);
  if (!ref || !uploadStorageService.isUploadReference(ref)) {
    throw new Error('Upload reference must be an /uploads/ URL.');
  }
  const loaded = await uploadStorageService.readBuffer(ref);
  const buffer = Buffer.isBuffer(loaded?.buffer) ? loaded.buffer : Buffer.from(loaded?.buffer || []);
  if (!buffer.length) throw new Error('Upload file is empty.');
  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`Upload file is too large (max ${Math.floor(maxBytes / (1024 * 1024))}MB).`);
  }
  return {
    buffer,
    mimeType: clean(loaded?.mimeType, 200),
    sizeBytes: buffer.length,
    ref
  };
}

async function readArtifactUploadBuffer(artifact = {}, { maxBytes = 0, pickRef = null } = {}) {
  const resolver = typeof pickRef === 'function'
    ? pickRef
    : (row) => toCanonicalUploadReference(row?.path || row?.filePath || '', row?.url || row?.uploadUrl || '');
  const ref = resolver(artifact);
  if (!ref || !uploadStorageService.isUploadReference(ref)) return null;
  if (!uploadStorageService.isRemoteUploadBackend()) return null;
  return readUploadReferenceBuffer(ref, { maxBytes });
}

module.exports = {
  toCanonicalUploadReference,
  isUploadRefUnderRelativePrefixes,
  uploadReferenceExists,
  readUploadReferenceBuffer,
  readArtifactUploadBuffer,
  listDirectory: (payload) => uploadStorageService.listDirectory(payload)
};
