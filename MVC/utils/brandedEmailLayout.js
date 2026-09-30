'use strict';

const NEWS_BLUE = '#1d5fb8';
const NEWS_TEAL = '#087f8c';
const NEWS_INK = '#13222c';
const NEWS_MUTED = '#53636f';
const NEWS_LINE = '#d7e1e7';

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveBrand() {
  try {
    const appBrandingService = require('../services/appBrandingService');
    return appBrandingService.getBrand?.() || {};
  } catch (_) {
    return {};
  }
}

function resolveAbsoluteAssetUrl(path = '', baseUrl = '') {
  const token = String(path || '').trim();
  if (!token) return '';
  if (/^https?:\/\//i.test(token)) return token;
  const origin = String(baseUrl || '').trim().replace(/\/$/, '');
  const relative = token.startsWith('/') ? token : `/${token}`;
  return origin ? `${origin}${relative}` : relative;
}

/**
 * News-inspired responsive email shell (inline styles for client compatibility).
 */
function buildBrandedEmailLayout({
  baseUrl = '',
  eyebrow = '',
  title = '',
  bodyHtml = '',
  footerHtml = ''
} = {}) {
  const brand = resolveBrand();
  const appName = String(brand.appName || brand.appShortName || 'School Portal').trim();
  const logoUrl = resolveAbsoluteAssetUrl(
    brand.logoUrl || '/uploads/GLOBAL/logo/Logo1.png',
    baseUrl
  );

  const logoBlock = logoUrl
    ? [
      `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(appName)}" width="160" height="auto"`,
      ' style="display:block;max-width:160px;width:160px;height:auto;border:0;outline:none;margin:0 0 14px;">'
    ].join('')
    : `<p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;font-family:Segoe UI,Arial,sans-serif;">${escapeHtml(appName)}</p>`;

  const eyebrowBlock = eyebrow
    ? `<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.9);font-family:Segoe UI,Arial,sans-serif;">${escapeHtml(eyebrow)}</p>`
    : '';

  const titleBlock = title
    ? `<h1 style="margin:0;font-size:22px;font-weight:800;line-height:1.32;color:#ffffff;letter-spacing:-0.03em;font-family:Segoe UI,Arial,sans-serif;">${escapeHtml(title)}</h1>`
    : '';

  const defaultFooter = [
    `<p style="margin:0;font-size:12px;line-height:1.55;color:${NEWS_MUTED};font-family:Segoe UI,Arial,sans-serif;">`,
    `This notification was sent by <strong style="color:${NEWS_INK};">${escapeHtml(appName)}</strong>`,
    '</p>'
  ].join('');

  const footer = footerHtml || defaultFooter;

  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body style="margin:0;padding:0;background:#f8fbff;">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"',
    ' style="background:linear-gradient(135deg,#f8fbff 0%,#eef8f5 52%,#ffffff 100%);padding:32px 16px;">',
    '<tr><td align="center">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"',
    ' style="max-width:640px;border-collapse:collapse;">',
    '<tr>',
    `<td style="padding:26px 28px 22px;background:linear-gradient(135deg,${NEWS_TEAL} 0%,${NEWS_BLUE} 100%);border-radius:20px 20px 0 0;">`,
    logoBlock,
    eyebrowBlock,
    titleBlock,
    '</td>',
    '</tr>',
    '<tr>',
    `<td style="padding:28px;background:#ffffff;border-left:1px solid ${NEWS_LINE};border-right:1px solid ${NEWS_LINE};`,
    `font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.65;color:${NEWS_INK};">`,
    bodyHtml,
    '</td>',
    '</tr>',
    '<tr>',
    `<td style="padding:16px 28px 22px;background:rgba(248,251,255,0.95);border:1px solid ${NEWS_LINE};border-top:0;border-radius:0 0 20px 20px;`,
    'box-shadow:0 22px 60px rgba(19,34,44,0.1);text-align:center;">',
    footer,
    '</td>',
    '</tr>',
    '</table>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

module.exports = {
  NEWS_BLUE,
  NEWS_TEAL,
  NEWS_INK,
  NEWS_MUTED,
  NEWS_LINE,
  escapeHtml,
  resolveAbsoluteAssetUrl,
  buildBrandedEmailLayout
};
