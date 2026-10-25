'use strict';

function isPrivateOrLocalHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d+)\./);
  if (private172) {
    const second = Number(private172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function isBrowserUnsafeHttpUrl(urlString = '') {
  const token = String(urlString || '').trim();
  if (!token || !/^https?:\/\//i.test(token)) return false;
  try {
    const parsed = new URL(token);
    return isPrivateOrLocalHost(parsed.hostname);
  } catch (_) {
    return false;
  }
}

module.exports = {
  isPrivateOrLocalHost,
  isBrowserUnsafeHttpUrl
};
