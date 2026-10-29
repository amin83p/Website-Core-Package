'use strict';

const uploadPathUtils = require('../utils/uploadPathUtils');
const { getGatewayBaseUrl, isBrowserUnsafeGatewayBaseUrl } = require('../utils/uploadModeUtils');
const { downloadRemoteUploadFile } = require('./fileGatewayClientService');

function clean(value) {
  return String(value || '').trim();
}

function shouldRedirectRemoteUploadRead() {
  return clean(process.env.UPLOAD_REMOTE_READ_MODE).toLowerCase() !== 'proxy';
}

function buildPublicGatewayUploadUrlFromRequest(req = {}) {
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl || isBrowserUnsafeGatewayBaseUrl(baseUrl)) return '';
  const relative = uploadPathUtils.extractRelativeUploadPath(req.originalUrl || req.url || '');
  if (!relative) return '';
  const encoded = relative.split('/').filter(Boolean).map((part) => {
    let decoded = part;
    try {
      decoded = decodeURIComponent(part);
    } catch (_) {
      decoded = part;
    }
    return encodeURIComponent(decoded);
  }).join('/');
  return `${baseUrl.replace(/\/+$/, '')}/uploads/${encoded}`;
}

function cleanRelativePath(value = '') {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function parseUploadsRelativePath(relativePath = '') {
  const parts = cleanRelativePath(relativePath).split('/').filter(Boolean);
  if (!parts.length) return null;
  const head = parts[0].toUpperCase();
  if (head === 'GLOBAL') {
    return { scopeKey: 'GLOBAL', relativePath: parts.slice(1).join('/') };
  }
  if (head.startsWith('ORG_')) {
    return {
      scopeKey: head.replace(/^ORG_/, ''),
      relativePath: parts.slice(1).join('/')
    };
  }
  return null;
}

async function streamUploadFromGateway(req, res) {
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

  if (shouldRedirectRemoteUploadRead()) {
    const remoteUrl = buildPublicGatewayUploadUrlFromRequest(req);
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
    const downloaded = await downloadRemoteUploadFile(parsed.scopeKey, decodedRelativePath);
    const buffer = Buffer.from(await downloaded.blob.arrayBuffer());
    res.setHeader('Content-Type', downloaded.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(buffer);
  } catch (error) {
    console.warn('[UploadGatewayStream] Failed to stream upload:', error?.message || error);
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProd) {
      res.status(404).send('Not found');
      return;
    }
    res.status(502).send(error?.message || 'Gateway upload stream failed.');
  }
}

module.exports = {
  parseUploadsRelativePath,
  streamUploadFromGateway,
  buildPublicGatewayUploadUrlFromRequest,
  shouldRedirectRemoteUploadRead
};
