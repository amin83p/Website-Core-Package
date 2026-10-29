'use strict';

const NEWS_BLUE = '#1d5fb8';
const NEWS_TEAL = '#087f8c';
const NEWS_INK = '#13222c';
const NEWS_MUTED = '#53636f';
const NEWS_LINE = '#d7e1e7';
/** Fixed content width for desktop email clients (Outlook respects width attribute). */
const EMAIL_CONTAINER_WIDTH = 720;

const NC_EMAIL_CLASSES = Object.freeze({
  wrap: 'nc-email-wrap',
  container: 'nc-email-container',
  header: 'nc-email-header',
  body: 'nc-email-body',
  footer: 'nc-email-footer',
  title: 'nc-email-title',
  logo: 'nc-email-logo',
  eyebrow: 'nc-email-eyebrow',
  preheader: 'nc-email-preheader',
  sessionCard: 'nc-session-card',
  sessionRow: 'nc-session-row',
  sessionRowInner: 'nc-session-row-inner',
  sessionTimingChip: 'nc-session-timing-chip',
  sessionLink: 'nc-session-link',
  summaryTable: 'nc-summary-table',
  prose: 'nc-email-prose',
  button: 'nc-email-button'
});

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

function buildEmailHeadStyles() {
  const w = EMAIL_CONTAINER_WIDTH;
  return [
    '<style type="text/css">',
    'body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;overflow-x:hidden;}',
    'table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}',
    `img{max-width:100%!important;height:auto!important;-ms-interpolation-mode:bicubic;border:0;line-height:100%;outline:none;text-decoration:none;}`,
    `.${NC_EMAIL_CLASSES.preheader}{display:none!important;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;}`,
    `.${NC_EMAIL_CLASSES.container}{width:100%!important;max-width:${w}px!important;}`,
    `.${NC_EMAIL_CLASSES.sessionCard}{width:100%!important;max-width:100%!important;}`,
    `.${NC_EMAIL_CLASSES.sessionLink}{word-break:break-word;overflow-wrap:anywhere;}`,
    `.${NC_EMAIL_CLASSES.sessionTimingChip}{max-width:100%;box-sizing:border-box;}`,
    `.${NC_EMAIL_CLASSES.button} a{display:inline-block;text-decoration:none;}`,
    `@media screen and (max-width:600px){`,
    `body,html{overflow-x:hidden!important;}`,
    `.${NC_EMAIL_CLASSES.container}{width:100%!important;max-width:100%!important;}`,
    `.${NC_EMAIL_CLASSES.wrap}{padding:16px 8px!important;}`,
    `.${NC_EMAIL_CLASSES.header}{padding:18px 14px 16px!important;}`,
    `.${NC_EMAIL_CLASSES.body}{padding:18px 14px!important;}`,
    `.${NC_EMAIL_CLASSES.footer}{padding:12px 14px 16px!important;}`,
    `.${NC_EMAIL_CLASSES.title}{font-size:20px!important;line-height:1.35!important;}`,
    `.${NC_EMAIL_CLASSES.logo}{max-width:120px!important;width:120px!important;}`,
    `.${NC_EMAIL_CLASSES.sessionCard}{width:100%!important;max-width:100%!important;}`,
    `.${NC_EMAIL_CLASSES.sessionRow}>td:first-child{display:none!important;}`,
    `.${NC_EMAIL_CLASSES.sessionRow}>td:last-child{display:block!important;width:100%!important;padding:12px 14px!important;box-sizing:border-box!important;}`,
    `.${NC_EMAIL_CLASSES.sessionRowInner},.${NC_EMAIL_CLASSES.sessionRowInner} tbody,.${NC_EMAIL_CLASSES.sessionRowInner} tr,.${NC_EMAIL_CLASSES.sessionRowInner} td{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;}`,
    `.${NC_EMAIL_CLASSES.sessionRowInner} td{padding-right:0!important;padding-left:0!important;text-align:left!important;}`,
    `.${NC_EMAIL_CLASSES.sessionRowInner} td+td{margin-top:10px!important;}`,
    `.${NC_EMAIL_CLASSES.sessionTimingChip}{white-space:normal!important;word-break:break-word;overflow-wrap:anywhere;}`,
    `.${NC_EMAIL_CLASSES.button}{width:100%!important;max-width:100%!important;}`,
    `.${NC_EMAIL_CLASSES.button} a{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;text-align:center!important;}`,
    `.${NC_EMAIL_CLASSES.summaryTable} thead{display:none!important;}`,
    `.${NC_EMAIL_CLASSES.summaryTable} tr,.${NC_EMAIL_CLASSES.summaryTable} td{display:block!important;width:100%!important;box-sizing:border-box!important;}`,
    `.${NC_EMAIL_CLASSES.summaryTable} td{text-align:left!important;padding:10px 14px!important;border-bottom:1px solid ${NEWS_LINE}!important;}`,
    `.${NC_EMAIL_CLASSES.summaryTable} td.nc-summary-items{text-align:left!important;font-weight:700;}`,
    `.${NC_EMAIL_CLASSES.summaryTable} td.nc-summary-items:before{content:"Items: ";font-weight:600;color:${NEWS_MUTED};}`,
    `.${NC_EMAIL_CLASSES.summaryTable} td.nc-summary-teacher:before{content:"Teacher: ";font-weight:600;color:${NEWS_MUTED};}`,
    '}',
    `@media screen and (min-width:601px){`,
    `.${NC_EMAIL_CLASSES.wrap}{padding:40px 24px!important;}`,
    `.${NC_EMAIL_CLASSES.header}{padding:32px 36px 28px!important;}`,
    `.${NC_EMAIL_CLASSES.body}{padding:32px 36px!important;}`,
    `.${NC_EMAIL_CLASSES.footer}{padding:18px 36px 26px!important;}`,
    `.${NC_EMAIL_CLASSES.title}{font-size:26px!important;line-height:1.28!important;}`,
    '}',
    '</style>'
  ].join('');
}

/**
 * Primary CTA button for HTML emails (inline styles + class for responsive width).
 */
function buildEmailButton(href = '', label = 'Open', options = {}) {
  const url = String(href || '').trim();
  const text = escapeHtml(String(label || 'Open').trim() || 'Open');
  const margin = options.compact ? '0' : '12px 0 0';
  if (!url) return '';
  const safeHref = escapeHtml(url);
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="${NC_EMAIL_CLASSES.button}"`,
    ` style="margin:${margin};border-collapse:separate;">`,
    `<tr><td align="center" bgcolor="${NEWS_BLUE}"`,
    ` style="border-radius:6px;background-color:${NEWS_BLUE};">`,
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeHref}"`,
    ` style="height:44px;v-text-anchor:middle;width:200px;" arcsize="12%" strokecolor="${NEWS_BLUE}" fillcolor="${NEWS_BLUE}">`,
    '<w:anchorlock/>',
    `<center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:bold;">${text}</center>`,
    '</v:roundrect><![endif]-->',
    `<!--[if !mso]><!-->`,
    `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"`,
    ` style="display:inline-block;padding:12px 22px;min-height:44px;line-height:20px;`,
    `font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff!important;`,
    `background-color:${NEWS_BLUE};border-radius:6px;mso-padding-alt:0;text-decoration:none;">`,
    text,
    '</a>',
    '<!--<![endif]-->',
    '</td></tr></table>'
  ].join('');
}

/**
 * News-inspired responsive email shell (inline styles for client compatibility).
 */
function buildBrandedEmailLayout({
  baseUrl = '',
  eyebrow = '',
  title = '',
  bodyHtml = '',
  footerHtml = '',
  preheader = ''
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
      ` class="${NC_EMAIL_CLASSES.logo}"`,
      ' style="display:block;max-width:160px;width:160px;height:auto;border:0;outline:none;margin:0 0 14px;">'
    ].join('')
    : `<p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;font-family:Segoe UI,Arial,sans-serif;">${escapeHtml(appName)}</p>`;

  const eyebrowBlock = eyebrow
    ? [
      `<p class="${NC_EMAIL_CLASSES.eyebrow}"`,
      ' style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;',
      'color:#ffffff;font-family:Segoe UI,Arial,sans-serif;">',
      `${escapeHtml(eyebrow)}</p>`
    ].join('')
    : '';

  const titleBlock = title
    ? [
      `<h1 class="${NC_EMAIL_CLASSES.title}"`,
      ' style="margin:0;font-size:24px;font-weight:800;line-height:1.32;color:#ffffff!important;',
      'letter-spacing:-0.03em;font-family:Segoe UI,Arial,sans-serif;">',
      `${escapeHtml(title)}</h1>`
    ].join('')
    : '';

  const preheaderText = String(preheader || title || eyebrow || appName).trim();
  const preheaderBlock = preheaderText
    ? [
      `<div class="${NC_EMAIL_CLASSES.preheader}"`,
      ' style="display:none;max-height:0;overflow:hidden;mso-hide:all;">',
      `${escapeHtml(preheaderText)}`,
      '</div>'
    ].join('')
    : '';

  const defaultFooter = [
    `<p style="margin:0;font-size:12px;line-height:1.6;color:${NEWS_MUTED};font-family:Segoe UI,Arial,sans-serif;">`,
    `This notification was sent by <strong style="color:${NEWS_INK};">${escapeHtml(appName)}</strong>.`,
    ' Please do not reply to this automated message.',
    '</p>'
  ].join('');

  const footer = footerHtml || defaultFooter;

  return [
    '<!DOCTYPE html>',
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    buildEmailHeadStyles(),
    '</head>',
    `<body style="margin:0;padding:0;background-color:#f4f8fc;background:#f4f8fc;">`,
    preheaderBlock,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="${NC_EMAIL_CLASSES.wrap}"`,
    ' bgcolor="#f4f8fc" style="background-color:#f4f8fc;padding:32px 16px;width:100%;max-width:100%;">',
    '<tr><td align="center">',
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${EMAIL_CONTAINER_WIDTH}" class="${NC_EMAIL_CLASSES.container}"`,
    ` style="width:100%;max-width:${EMAIL_CONTAINER_WIDTH}px;border-collapse:collapse;">`,
    '<tr>',
    `<td class="${NC_EMAIL_CLASSES.header}" bgcolor="${NEWS_BLUE}"`,
    ` style="padding:28px 32px 24px;background-color:${NEWS_BLUE};`,
    `background-image:linear-gradient(135deg,${NEWS_TEAL} 0%,${NEWS_BLUE} 100%);`,
    'border-radius:16px 16px 0 0;">',
    logoBlock,
    eyebrowBlock,
    titleBlock,
    '</td>',
    '</tr>',
    '<tr>',
    `<td class="${NC_EMAIL_CLASSES.body}" bgcolor="#ffffff"`,
    ` style="padding:32px;background-color:#ffffff;border-left:1px solid ${NEWS_LINE};border-right:1px solid ${NEWS_LINE};`,
    `font-family:Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.65;color:${NEWS_INK};">`,
    bodyHtml,
    '</td>',
    '</tr>',
    '<tr>',
    `<td class="${NC_EMAIL_CLASSES.footer}" bgcolor="#f8fbfd"`,
    ` style="padding:18px 32px 24px;background-color:#f8fbfd;border:1px solid ${NEWS_LINE};border-top:0;border-radius:0 0 16px 16px;`,
    'text-align:center;">',
    footer,
    '</td>',
    '</tr>',
    '</table>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

function injectEmailPreviewBaseHref(html = '', baseHref = '') {
  const doc = String(html || '');
  let base = String(baseHref || '').trim();
  if (!doc || !base) return doc;
  if (/<base[\s>]/i.test(doc)) return doc;
  if (!base.endsWith('/')) base += '/';
  const safe = escapeHtml(base);
  if (/<head[\s>]/i.test(doc)) {
    return doc.replace(/<head(\s[^>]*)?>/i, (match) => `${match}<base href="${safe}">`);
  }
  return doc;
}

/**
 * Rewrites upload/logo asset URLs for in-app iframe preview (srcdoc) so images load from the
 * same host the user is browsing, not a mismatched APP_PUBLIC_URL.
 */
function prepareEmailHtmlForInAppPreview(html = '', previewOrigin = '') {
  const origin = String(previewOrigin || '').trim().replace(/\/$/, '');
  let doc = String(html || '');
  if (!doc || !origin) return doc;
  doc = doc.replace(/\bsrc=(["'])(\/[^"']+)\1/gi, (_, quote, path) => `src=${quote}${origin}${path}${quote}`);
  doc = doc.replace(
    /\bsrc=(["'])https?:\/\/[^"']+(\/uploads\/[^"']+)\1/gi,
    (_, quote, path) => `src=${quote}${origin}${path}${quote}`
  );
  return injectEmailPreviewBaseHref(doc, `${origin}/`);
}

module.exports = {
  NEWS_BLUE,
  NEWS_TEAL,
  NEWS_INK,
  NEWS_MUTED,
  NEWS_LINE,
  EMAIL_CONTAINER_WIDTH,
  NC_EMAIL_CLASSES,
  escapeHtml,
  resolveAbsoluteAssetUrl,
  injectEmailPreviewBaseHref,
  prepareEmailHtmlForInAppPreview,
  buildEmailButton,
  buildBrandedEmailLayout
};
