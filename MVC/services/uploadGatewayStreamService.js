'use strict';

const uploadPathUtils = require('../utils/uploadPathUtils');

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
  try {
    const { readLocalUploadIfPresent, gatewayDownloadByUploadUrl } = require('./fileGatewayClientService');
    const local = await readLocalUploadIfPresent(parsed.scopeKey, parsed.relativePath);
    if (local) {
      res.setHeader('Content-Type', local.mimeType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(local.buffer);
    }
    const relativeUrl = `/uploads/${[
      parsed.scopeKey === 'GLOBAL' ? 'GLOBAL' : `ORG_${parsed.scopeKey}`,
      parsed.relativePath
    ].filter(Boolean).join('/')}`;
    const signed = await gatewayDownloadByUploadUrl(relativeUrl);
    res.setHeader('Content-Type', signed.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(signed.buffer);
  } catch (_) {
    res.status(404).send('Not found');
  }
}

module.exports = {
  parseUploadsRelativePath,
  streamUploadFromGateway
};
