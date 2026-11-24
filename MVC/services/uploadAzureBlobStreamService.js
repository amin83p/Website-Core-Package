'use strict';

const uploadPathUtils = require('../utils/uploadPathUtils');
const azureBlob = require('./azureBlobUploadClientService');
const uploadRemoteDriver = require('./uploadRemoteDriverService');
const {
  parseUploadsRelativePath,
  isBrowserStreamableMediaPath,
  mimeTypeForUploadRelativePath
} = require('./uploadGatewayStreamService');
const { getUploadRemoteReadMode } = require('../utils/uploadModeUtils');

function shouldRedirectRemoteUploadRead() {
  return getUploadRemoteReadMode() !== 'proxy';
}

async function streamUploadFromAzureBlob(req, res) {
  const relative = uploadPathUtils.extractRelativeUploadPath(req.originalUrl || req.url || '');
  if (!relative) {
    res.status(404).send('Not found');
    return;
  }
  const parsed = parseUploadsRelativePath(relative);
  if (!parsed) {
    res.status(404).send('Not found');
    return;
  }

  const uploadUrl = `/uploads/${relative}`;
  const forceSameOriginStream = isBrowserStreamableMediaPath(relative);
  if (shouldRedirectRemoteUploadRead() && !forceSameOriginStream) {
    const remoteUrl = azureBlob.getBlobSasUrlForUploadPath(uploadUrl);
    if (remoteUrl) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.redirect(307, remoteUrl);
    }
  }

  try {
    let decodedRelativePath = String(parsed.relativePath || '');
    try {
      decodedRelativePath = decodeURIComponent(decodedRelativePath);
    } catch (_) {
      // keep encoded path when URI decoding fails
    }
    const downloaded = await uploadRemoteDriver.downloadRemoteUploadFile(parsed.scopeKey, decodedRelativePath);
    const buffer = Buffer.from(await downloaded.blob.arrayBuffer());
    const mediaMime = mimeTypeForUploadRelativePath(relative);
    res.setHeader('Content-Type', mediaMime || downloaded.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(buffer);
  } catch (error) {
    console.warn('[UploadAzureBlobStream] Failed to stream upload:', error?.message || error);
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProd) {
      res.status(404).send('Not found');
      return;
    }
    res.status(502).send(error?.message || 'Azure blob upload stream failed.');
  }
}

module.exports = {
  streamUploadFromAzureBlob
};