'use strict';

const { ensureRootRelativeWebPath, isAbsoluteWebUrl } = require('./newsHtmlAssetUrls');
const { isBrowserUnsafeHttpUrl } = require('./networkHostUtils');
const uploadPathUtils = require('./uploadPathUtils');

const FIGURE_LAYOUTS = Object.freeze(['center', 'float-left', 'float-right', 'block']);

function clampWidthPct(value, fallback = 72) {
  const numeric = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(25, numeric));
}

function normalizeLayoutToken(value = '') {
  const token = String(value || '').trim().toLowerCase();
  return FIGURE_LAYOUTS.includes(token) ? token : 'center';
}

function escapeHtmlAttr(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function isEmbeddedImageUrl(value = '') {
  const token = String(value || '').trim().toLowerCase();
  return token.startsWith('data:') || token.startsWith('blob:');
}

function normalizeFigureAssetUrl(value = '') {
  const token = String(value || '').trim();
  if (!token || isEmbeddedImageUrl(token)) return '';
  if (isBrowserUnsafeHttpUrl(token)) {
    const uploadsRelative = uploadPathUtils.extractRelativeUploadPath(token);
    return uploadsRelative ? `/uploads/${uploadsRelative}` : '';
  }
  return ensureRootRelativeWebPath(token);
}

function buildFigureHtml({ src = '', layout = 'center', widthPct = 72, alt = '' } = {}) {
  const url = normalizeFigureAssetUrl(src);
  if (!url) return '';
  const layoutToken = normalizeLayoutToken(layout);
  const pct = clampWidthPct(widthPct);
  const altText = escapeHtmlAttr(alt);
  const safeUrl = escapeHtmlAttr(url);
  return `<figure class="news-figure news-figure--layout-${layoutToken}" data-news-figure="1" data-src="${safeUrl}" data-width-pct="${pct}" data-layout="${layoutToken}" style="max-width:${pct}%"><img src="${safeUrl}" alt="${altText}" loading="lazy"></figure>`;
}

function normalizeSingleFigureOpenTag(attrs = '', innerHtml = '') {
  const srcMatch = attrs.match(/\bdata-src\s*=\s*(["'])([^"']*)\1/i)
    || attrs.match(/\bsrc\s*=\s*(["'])([^"']*)\1/i);
  const layoutMatch = attrs.match(/\bdata-layout\s*=\s*(["'])([^"']*)\1/i);
  const widthMatch = attrs.match(/\bdata-width-pct\s*=\s*(["'])([^"']*)\1/i);
  let rawSrc = srcMatch ? srcMatch[2] : '';
  if (!rawSrc && innerHtml) {
    const imgMatch = String(innerHtml).match(/<img\b[^>]*\ssrc\s*=\s*(["'])([^"']*)\1/i);
    if (imgMatch) rawSrc = imgMatch[2];
  }
  const url = normalizeFigureAssetUrl(rawSrc);
  if (!url) return '';
  const layoutToken = normalizeLayoutToken(layoutMatch ? layoutMatch[2] : 'center');
  const pct = clampWidthPct(widthMatch ? widthMatch[2] : 72);
  const safeUrl = escapeHtmlAttr(url);
  return `<figure class="news-figure news-figure--layout-${layoutToken}" data-news-figure="1" data-src="${safeUrl}" data-width-pct="${pct}" data-layout="${layoutToken}" style="max-width:${pct}%"><img src="${safeUrl}" alt="" loading="lazy"></figure>`;
}

function normalizeFiguresInHtml(html = '') {
  const source = String(html || '');
  if (!source.includes('news-figure') && !source.includes('data-news-figure')) {
    return source;
  }
  return source.replace(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi, (full, attrs, innerHtml) => {
    const rebuilt = normalizeSingleFigureOpenTag(attrs || '', innerHtml || '');
    return rebuilt || full;
  });
}

function stripEmbeddedImagesFromHtml(html = '') {
  let out = String(html || '');
  if (!out) return out;
  out = out.replace(/<figure\b[^>]*data-news-figure[^>]*>[\s\S]*?<\/figure>/gi, (figureHtml) => {
    if (/data-src\s*=\s*["'](?:data:|blob:)/i.test(figureHtml)
      || /<img\b[^>]*\ssrc\s*=\s*["'](?:data:|blob:)/i.test(figureHtml)) {
      return '';
    }
    return figureHtml;
  });
  out = out.replace(/<img\b([^>]*)\ssrc\s*=\s*["'](?:data:|blob:)[^"']*["']([^>]*)>/gi, '');
  return out;
}

function isAllowedNewsAssetUrl(value = '') {
  const token = normalizeFigureAssetUrl(value);
  if (!token) return false;
  if (isEmbeddedImageUrl(token)) return false;
  if (token.startsWith('/uploads/') || token.startsWith('/images/')) return true;
  if (isAbsoluteWebUrl(token) && /^https?:\/\//i.test(token)) return true;
  return false;
}

module.exports = {
  FIGURE_LAYOUTS,
  clampWidthPct,
  normalizeLayoutToken,
  isEmbeddedImageUrl,
  normalizeFigureAssetUrl,
  buildFigureHtml,
  normalizeFiguresInHtml,
  stripEmbeddedImagesFromHtml,
  isAllowedNewsAssetUrl
};
