'use strict';

const path = require('path');
const express = require('express');

const LONG_CACHE_SECONDS = 31536000;
const SHORT_CACHE_SECONDS = 300;
const UPLOAD_CACHE_SECONDS = 3600;

const STATIC_EXTENSIONS = new Set([
  '.css', '.js', '.mjs', '.map',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.webmanifest'
]);

function isProductionEnv() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function readRequestPath(req) {
  const raw = String(req?.path || req?.url || req?.originalUrl || '').trim();
  if (!raw) return '';
  const withoutQuery = raw.split('?')[0];
  return withoutQuery;
}

function readVersionQuery(req) {
  if (req?.query && req.query.v !== undefined && req.query.v !== null) {
    return String(req.query.v).trim().toLowerCase();
  }
  const raw = String(req?.originalUrl || req?.url || '').trim();
  const qIndex = raw.indexOf('?');
  if (qIndex === -1) return '';
  try {
    const params = new URLSearchParams(raw.slice(qIndex + 1));
    return String(params.get('v') || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function isVersionedRequest(req, buildVersionShort = '') {
  const version = readVersionQuery(req);
  if (!version) return false;
  const current = String(buildVersionShort || '').trim().toLowerCase();
  if (current && version === current) return true;
  return /^[a-f0-9]{6,64}$/.test(version);
}

function resolveCacheControl(req, options = {}) {
  const isProduction = options.isProduction !== undefined ? options.isProduction : isProductionEnv();
  const cacheProfile = String(options.cacheProfile || 'static').trim().toLowerCase();

  if (!isProduction) {
    return 'no-cache';
  }

  if (cacheProfile === 'upload') {
    return `public, max-age=${UPLOAD_CACHE_SECONDS}, must-revalidate`;
  }

  const ext = path.extname(readRequestPath(req)).toLowerCase();
  if (!STATIC_EXTENSIONS.has(ext)) {
    return `public, max-age=${SHORT_CACHE_SECONDS}, must-revalidate`;
  }

  if (isVersionedRequest(req, options.buildVersionShort)) {
    return `public, max-age=${LONG_CACHE_SECONDS}, immutable`;
  }

  return `public, max-age=${SHORT_CACHE_SECONDS}, must-revalidate`;
}

function createStaticAssetMiddleware(rootPath, options = {}) {
  const resolvedRoot = path.resolve(String(rootPath || ''));
  const isProduction = options.isProduction !== undefined ? options.isProduction : isProductionEnv();
  const cacheProfile = String(options.cacheProfile || 'static').trim().toLowerCase();
  const getBuildVersionShort = typeof options.getBuildVersionShort === 'function'
    ? options.getBuildVersionShort
    : () => '';

  const maxAgeMs = isProduction
    ? (cacheProfile === 'upload' ? UPLOAD_CACHE_SECONDS : SHORT_CACHE_SECONDS) * 1000
    : 0;

  return express.static(resolvedRoot, {
    etag: true,
    lastModified: true,
    maxAge: maxAgeMs,
    setHeaders(res, _filePath) {
      const req = res.req;
      const cacheControl = resolveCacheControl(req, {
        isProduction,
        cacheProfile,
        buildVersionShort: getBuildVersionShort()
      });
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('Vary', 'Accept-Encoding');
    }
  });
}

module.exports = {
  createStaticAssetMiddleware,
  isVersionedRequest,
  resolveCacheControl,
  STATIC_EXTENSIONS,
  LONG_CACHE_SECONDS,
  SHORT_CACHE_SECONDS,
  UPLOAD_CACHE_SECONDS
};
