'use strict';

const uploadStoragePolicy = require('./uploadStoragePolicyService');
const azureBlob = require('./azureBlobUploadClientService');
const fileGateway = require('./fileGatewayClientService');

function ensureRemoteBackend() {
  if (!uploadStoragePolicy.isRemoteUploadBackend()) {
    throw new Error('Remote upload driver requires a remote storage backend.');
  }
}

function useAzure() {
  return uploadStoragePolicy.isAzureBlobBackend();
}

async function uploadFile(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.uploadFile(payload);
  return fileGateway.gatewayUploadFile(payload);
}

async function uploadBlob(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) {
    const { blob, buffer, ...rest } = payload;
    let source = buffer;
    if (!source && blob) {
      source = Buffer.from(await blob.arrayBuffer());
    }
    return azureBlob.uploadBuffer({ ...rest, buffer: source });
  }
  return fileGateway.gatewayUploadBlob(payload);
}

async function downloadRemoteUploadFile(scopeKey = '', relativePath = '') {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.downloadRemoteUploadFile(scopeKey, relativePath);
  return fileGateway.downloadRemoteUploadFile(scopeKey, relativePath);
}

async function deleteByUploadUrl(uploadUrl = '') {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.deleteByUploadUrl(uploadUrl);
  return fileGateway.gatewayDeleteByUploadUrl(uploadUrl);
}

async function deleteByRelativePath(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.deleteByRelativePath(payload);
  return fileGateway.gatewayDeleteByRelativePath(payload);
}

async function listDirectory(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.listDirectory(payload);
  return fileGateway.gatewayListDirectory(payload);
}

async function moveItem(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.moveItem(payload);
  return fileGateway.gatewayMoveItem(payload);
}

async function copyItem(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.copyItem(payload);
  return fileGateway.gatewayCopyItem(payload);
}

async function renameItem(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.renameItem(payload);
  return fileGateway.gatewayRenameItem(payload);
}

async function createFolder(payload = {}) {
  ensureRemoteBackend();
  if (useAzure()) return azureBlob.createFolder(payload);
  return fileGateway.gatewayCreateFolder(payload);
}

module.exports = {
  uploadFile,
  uploadBlob,
  downloadRemoteUploadFile,
  deleteByUploadUrl,
  deleteByRelativePath,
  listDirectory,
  moveItem,
  copyItem,
  renameItem,
  createFolder
};