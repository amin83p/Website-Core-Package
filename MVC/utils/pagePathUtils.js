'use strict';

const STATIC_PATH_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.webmanifest',
  '.pdf',
  '.csv',
  '.xlsx',
  '.docx',
  '.zip'
]);

function sanitizeCurrentPath(value, maxLength = 500) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const isAbsoluteHttpUrl = /^https?:\/\//i.test(raw);
  if (raw.startsWith('//') || (!raw.startsWith('/') && !isAbsoluteHttpUrl)) return '';

  let pathname = '';
  try {
    const parsed = new URL(raw, 'http://local.invalid');
    pathname = parsed.pathname || '';
  } catch (_) {
    pathname = raw.split(/[?#]/)[0] || '';
  }

  pathname = String(pathname || '').trim();
  if (!pathname.startsWith('/')) return '';
  pathname = pathname.replace(/[\u0000-\u001f\u007f]/g, '');
  pathname = pathname.replace(/\/{2,}/g, '/');
  return pathname.slice(0, Math.max(1, Number(maxLength) || 500));
}

function getExtension(pathname = '') {
  const clean = String(pathname || '').split('/').pop() || '';
  const dotIndex = clean.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return clean.slice(dotIndex).toLowerCase();
}

function requestWantsHtml(req) {
  const accept = String(req?.headers?.accept || '').toLowerCase();
  if (!accept) return true;
  return accept.includes('text/html') || accept.includes('*/*');
}

function isHtmlNavigationRequest(req) {
  const method = String(req?.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (req?.xhr || req?.headers?.['x-ajax-request'] || req?.headers?.['x-requested-with']) return false;
  if (!requestWantsHtml(req)) return false;

  const pathname = sanitizeCurrentPath(req?.originalUrl || req?.url || req?.path || '');
  if (!pathname) return false;
  if (pathname.startsWith('/uploads/')) return false;
  const ext = getExtension(pathname);
  return !STATIC_PATH_EXTENSIONS.has(ext);
}

module.exports = {
  isHtmlNavigationRequest,
  sanitizeCurrentPath
};
