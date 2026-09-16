'use strict';

const settingService = require('./settingService');

function cleanText(value) {
  return String(value || '').trim();
}

/**
 * Normalize public site URL to origin only (scheme + host), or empty string.
 * @returns {{ url: string, error: string|null }}
 */
function normalizePublicSiteUrl(raw) {
  const token = cleanText(raw);
  if (!token) return { url: '', error: null };

  let parsed;
  try {
    parsed = new URL(token.includes('://') ? token : `https://${token}`);
  } catch (_) {
    return { url: '', error: 'Public website URL must be a valid http or https URL (for example, https://school.example.com).' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: '', error: 'Public website URL must use http or https.' };
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  return { url: origin.replace(/\/$/, ''), error: null };
}

function getConfiguredPublicSiteUrl() {
  const raw = settingService.getValue('app', 'publicSiteUrl');
  const { url } = normalizePublicSiteUrl(raw);
  return url;
}

function resolveRequestOrigin(req) {
  if (!req || typeof req !== 'object') return '';
  const proto = cleanText(req.get?.('x-forwarded-proto') || req.protocol || 'http');
  const host = cleanText(req.get?.('x-forwarded-host') || req.get?.('host') || '');
  if (!host) return '';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function resolvePublicSiteUrl({ req } = {}) {
  const configured = getConfiguredPublicSiteUrl();
  if (configured) return configured;
  return resolveRequestOrigin(req);
}

module.exports = {
  normalizePublicSiteUrl,
  getConfiguredPublicSiteUrl,
  resolveRequestOrigin,
  resolvePublicSiteUrl
};
