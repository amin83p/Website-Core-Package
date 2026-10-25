'use strict';

const uploadPathUtils = require('./uploadPathUtils');
const { isBrowserUnsafeHttpUrl } = require('./networkHostUtils');

function isAbsoluteWebUrl(value = '') {
  const token = String(value || '').trim();
  if (!token) return false;
  return /^(?:https?:|data:|blob:|mailto:|tel:|#)/i.test(token);
}

function ensureRootRelativeWebPath(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (isBrowserUnsafeHttpUrl(token)) {
    const uploadsRelative = uploadPathUtils.extractRelativeUploadPath(token);
    if (uploadsRelative) return `/uploads/${uploadsRelative}`;
    return '';
  }
  if (isAbsoluteWebUrl(token)) return token;
  if (token.startsWith('/')) return token;
  return `/${token.replace(/^\/+/, '')}`;
}

/**
 * Normalize img/src and a/href in news HTML so root-relative paths work on nested routes
 * (e.g. /news/article/slug).
 */
function normalizeNewsHtmlAssetUrls(html = '') {
  const { stripEmbeddedImagesFromHtml, normalizeFiguresInHtml } = require('./newsFigureHtml');
  let source = stripEmbeddedImagesFromHtml(String(html || ''));
  source = normalizeFiguresInHtml(source);
  if (!source) return source;

  return source.replace(
    /\s(src|href)\s*=\s*(["'])([^"']+)\2/gi,
    (match, attr, quote, rawUrl) => {
      const trimmed = String(rawUrl || '').trim();
      if (!trimmed) return match;
      if (isBrowserUnsafeHttpUrl(trimmed)) {
        const uploadsRelative = uploadPathUtils.extractRelativeUploadPath(trimmed);
        if (uploadsRelative) {
          return ` ${attr}=${quote}/uploads/${uploadsRelative}${quote}`;
        }
        return match;
      }
      if (isAbsoluteWebUrl(trimmed)) {
        return match;
      }
      const normalized = ensureRootRelativeWebPath(trimmed);
      if (normalized === trimmed) return match;
      return ` ${attr}=${quote}${normalized}${quote}`;
    }
  );
}

function extractImgSrcList(html = '') {
  const source = String(html || '');
  const srcs = [];
  const re = /<img\b[^>]*\ssrc\s*=\s*(["'])([^"']+)\1/gi;
  let m = re.exec(source);
  while (m) {
    srcs.push(String(m[2] || '').trim());
    m = re.exec(source);
  }
  return srcs;
}

module.exports = {
  isAbsoluteWebUrl,
  ensureRootRelativeWebPath,
  normalizeNewsHtmlAssetUrls,
  extractImgSrcList
};
