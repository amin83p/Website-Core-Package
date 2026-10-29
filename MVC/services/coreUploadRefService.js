'use strict';

const uploadMiddleware = require('../middleware/upload');
const uploadStorage = require('./uploadStorageService');

function clean(value = '', max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function resolveMulterStoredRef(file = {}) {
  const rawRef = uploadStorage.getStoredRefFromFile(file)
    || clean(uploadMiddleware.getStoredFileUrl(file))
    || clean(uploadMiddleware.getStoredFilePath(file));
  if (!rawRef) throw new Error('Uploaded file was not stored correctly.');
  try {
    return uploadStorage.normalizeReference(rawRef);
  } catch (error) {
    if (uploadStorage.isRailwayGatewayBackend()) {
      throw new Error('Uploaded file must be stored as an /uploads/ URL.');
    }
    throw error;
  }
}

function resolveMulterStoredRefOrEmpty(file = {}) {
  try {
    return resolveMulterStoredRef(file);
  } catch (_) {
    return '';
  }
}

function normalizePersistedUploadRef(value = '') {
  const token = clean(value, 4000);
  if (!token) return '';
  if (uploadStorage.isUploadReference(token)) {
    try {
      return uploadStorage.normalizeReference(token);
    } catch (_) {
      return token;
    }
  }
  try {
    return uploadStorage.normalizeReference(token);
  } catch (error) {
    if (uploadStorage.isRailwayGatewayBackend()) {
      throw new Error('File reference must be an /uploads/ URL when using remote upload storage.');
    }
    throw error;
  }
}

module.exports = {
  resolveMulterStoredRef,
  resolveMulterStoredRefOrEmpty,
  normalizePersistedUploadRef
};
