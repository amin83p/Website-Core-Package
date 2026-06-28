const DEFAULT_TIMEOUT_MS = 12000;
const RESEND_API_URL = 'https://api.resend.com/emails';
const startupLogger = require('../utils/startupLogger');
const emailLedgerService = require('./emailLedgerService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

function cleanText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseAddressList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(/[;,]+/g)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function getConfig() {
  const apiKey = cleanText(process.env.RESEND_API_KEY);
  const from = cleanText(process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM);
  const defaultContactRecipients = parseAddressList(
    process.env.RESEND_CONTACT_TO || process.env.CONTACT_NOTIFY_TO || process.env.ADMIN_NOTIFY_EMAILS
  );
  return {
    apiKey,
    from,
    defaultContactRecipients
  };
}

function hasApiKey() {
  const cfg = getConfig();
  return Boolean(cfg.apiKey);
}

function hasDefaultSender() {
  const cfg = getConfig();
  return Boolean(cfg.from);
}

function maskSecret(value = '') {
  const token = cleanText(value);
  if (!token) return '';
  if (token.length <= 8) return `${token.slice(0, 2)}***`;
  return `${token.slice(0, 4)}***${token.slice(-3)}`;
}

function maskEmail(value = '') {
  const token = cleanText(value).toLowerCase();
  if (!token.includes('@')) return token;
  const [local, domain] = token.split('@');
  if (!local) return `***@${domain || ''}`;
  if (local.length <= 2) return `${local[0] || '*'}*@${domain || ''}`;
  return `${local.slice(0, 2)}***@${domain || ''}`;
}

function isConfigured(options = {}) {
  const requireFrom = options && Object.prototype.hasOwnProperty.call(options, 'requireFrom')
    ? Boolean(options.requireFrom)
    : true;
  if (requireFrom) return hasApiKey() && hasDefaultSender();
  return hasApiKey();
}

async function sendEmail({ to, subject, html, text, replyTo, from, meta } = {}) {
  const cfg = getConfig();
  const sendMeta = meta && typeof meta === 'object' ? meta : {};
  const createdAt = new Date().toISOString();
  let sender = '';
  let recipients = [];
  let normalizedSubject = '';
  let normalizedReplyTo = '';
  let contentText = '';
  let contentHtml = '';

  startupLogger.info('RESEND', 'SEND_EMAIL', 'Preparing outbound email request.', {
    hasApiKey: Boolean(cfg.apiKey),
    apiKeyPreview: maskSecret(cfg.apiKey),
    defaultFrom: cfg.from || ''
  });
  try {
    if (!cfg.apiKey) {
      throw new Error('RESEND_API_KEY is missing.');
    }
    sender = cleanText(from || cfg.from);
    if (!sender) {
      throw new Error('RESEND_FROM_EMAIL is missing.');
    }

    recipients = Array.isArray(to)
      ? to.map((item) => cleanText(item)).filter(Boolean)
      : [cleanText(to)].filter(Boolean);
    if (!recipients.length) {
      throw new Error('Email recipient is missing.');
    }

    normalizedSubject = cleanText(subject);
    if (!normalizedSubject) {
      throw new Error('Email subject is missing.');
    }

    const payload = {
      from: sender,
      to: recipients,
      subject: normalizedSubject
    };

    if (cleanText(html)) payload.html = String(html);
    if (cleanText(text)) payload.text = String(text);
    if (!payload.html && !payload.text) {
      throw new Error('Either html or text content is required.');
    }
    contentText = payload.text || '';
    contentHtml = payload.html || '';

    normalizedReplyTo = cleanText(replyTo);
    if (normalizedReplyTo) payload.reply_to = normalizedReplyTo;

    startupLogger.info('RESEND', 'SEND_EMAIL', 'Dispatching email to Resend API.', {
      toCount: recipients.length,
      toPreview: recipients.slice(0, 5).map((item) => maskEmail(item)).join(','),
      sender,
      subject: normalizedSubject.slice(0, 120),
      hasHtml: Boolean(payload.html),
      hasText: Boolean(payload.text),
      hasReplyTo: Boolean(normalizedReplyTo),
      timeoutMs: DEFAULT_TIMEOUT_MS
    });

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    if (typeof timeoutHandle?.unref === 'function') timeoutHandle.unref();

    let response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    let body = null;
    try {
      body = await response.json();
    } catch (_) {
      body = null;
    }

    if (!response.ok) {
      const apiError = cleanText(body?.message)
        || cleanText(body?.error)
        || `${response.status} ${response.statusText}`;
      startupLogger.error('RESEND', 'SEND_EMAIL', 'Resend API request failed.', {
        statusCode: Number(response.status || 0),
        statusText: String(response.statusText || ''),
        apiError
      });
      throw new Error(`Resend request failed: ${apiError}`);
    }

    startupLogger.success('RESEND', 'SEND_EMAIL', 'Email accepted by Resend API.', {
      statusCode: Number(response.status || 0),
      resendMessageId: String(body?.id || body?.message_id || '')
    });

    await emailLedgerService.recordOutboundEmail({
      dateTime: createdAt,
      provider: 'resend',
      orgId: cleanText(sendMeta.orgId || sendMeta?.context?.orgId),
      sectionId: cleanText(sendMeta.sectionId || sendMeta?.context?.sectionId),
      operationId: cleanText(sendMeta.operationId || sendMeta?.context?.operationId),
      eventKey: cleanText(sendMeta.eventKey || sendMeta?.context?.eventKey),
      from: sender,
      to: recipients,
      replyTo: normalizedReplyTo,
      subject: normalizedSubject,
      text: contentText,
      html: contentHtml,
      actor: sendMeta.actor || {},
      meta: sendMeta,
      status: 'accepted',
      providerStatusCode: Number(response.status || 0),
      providerMessageId: String(body?.id || body?.message_id || ''),
      providerRaw: body && typeof body === 'object' ? body : {}
    });

    return body || { ok: true };
  } catch (error) {
    await emailLedgerService.recordOutboundEmail({
      dateTime: createdAt,
      provider: 'resend',
      orgId: cleanText(sendMeta.orgId || sendMeta?.context?.orgId),
      sectionId: cleanText(sendMeta.sectionId || sendMeta?.context?.sectionId),
      operationId: cleanText(sendMeta.operationId || sendMeta?.context?.operationId),
      eventKey: cleanText(sendMeta.eventKey || sendMeta?.context?.eventKey),
      from: sender,
      to: recipients,
      replyTo: normalizedReplyTo,
      subject: normalizedSubject,
      text: contentText,
      html: contentHtml,
      actor: sendMeta.actor || {},
      meta: sendMeta,
      status: 'failed',
      errorMessage: cleanText(error?.message || String(error)),
      providerStatusCode: 0,
      providerMessageId: '',
      providerRaw: {}
    });
    throw error;
  }
}

async function sendContactTask(contactRecord = {}) {
  const cfg = getConfig();
  if (!cfg.defaultContactRecipients.length) {
    return { skipped: true, reason: 'No contact recipients configured.' };
  }

  const senderName = cleanText(contactRecord.name) || 'Website Visitor';
  const senderEmail = cleanText(contactRecord.email) || 'Not provided';
  const subject = cleanText(contactRecord.subject) || 'No subject';
  const timeline = cleanText(contactRecord.timeline) || 'Not specified';
  const type = cleanText(contactRecord.type) || 'general';
  const message = cleanText(contactRecord.message) || '';
  const refId = cleanText(contactRecord.id) || cleanText(contactRecord.referenceId) || 'N/A';

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">',
    '<h2 style="margin:0 0 12px 0;">New Contact Message</h2>',
    `<p><strong>Reference:</strong> ${escapeHtml(refId)}</p>`,
    `<p><strong>Name:</strong> ${escapeHtml(senderName)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(senderEmail)}</p>`,
    `<p><strong>Type:</strong> ${escapeHtml(type)}</p>`,
    `<p><strong>Timeline:</strong> ${escapeHtml(timeline)}</p>`,
    `<p><strong>Subject:</strong> ${escapeHtml(subject)}</p>`,
    `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>`,
    '</div>'
  ].join('');

  const text = [
    'New Contact Message',
    `Reference: ${refId}`,
    `Name: ${senderName}`,
    `Email: ${senderEmail}`,
    `Type: ${type}`,
    `Timeline: ${timeline}`,
    `Subject: ${subject}`,
    '',
    message
  ].join('\n');

  return sendEmail({
    to: cfg.defaultContactRecipients,
    subject: `[Contact] ${subject} (${refId})`,
    html,
    text,
    replyTo: senderEmail.includes('@') ? senderEmail : '',
    meta: {
      sectionId: SECTIONS.CONTACT_MESSAGES,
      operationId: OPERATIONS.CREATE,
      eventKey: 'CONTACT_NOTIFICATION',
      orgId: cleanText(contactRecord?.orgId || ''),
      actor: {
        userId: cleanText(contactRecord?.creator?.userId || ''),
        username: cleanText(contactRecord?.creator?.username || ''),
        displayName: cleanText(contactRecord?.creator?.displayName || '')
      }
    }
  });
}

async function sendNewsletterWelcome({ toEmail, unsubscribeUrl } = {}) {
  const email = cleanText(toEmail);
  if (!email) {
    throw new Error('toEmail is required for welcome email.');
  }

  const unsubscribeBlock = cleanText(unsubscribeUrl)
    ? `<p style="margin-top:16px;">If you no longer want updates, <a href="${escapeHtml(unsubscribeUrl)}">unsubscribe here</a>.</p>`
    : '';

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">',
    '<h2 style="margin:0 0 12px 0;">Welcome to our newsletter</h2>',
    '<p>Thanks for subscribing. We will send practical updates when new content is available.</p>',
    unsubscribeBlock,
    '</div>'
  ].join('');

  const text = [
    'Welcome to our newsletter.',
    'Thanks for subscribing. We will send practical updates when new content is available.',
    cleanText(unsubscribeUrl) ? `Unsubscribe: ${unsubscribeUrl}` : ''
  ].filter(Boolean).join('\n');

  return sendEmail({
    to: email,
    subject: 'Welcome to our newsletter',
    html,
    text,
    meta: {
      sectionId: SECTIONS.NEWSLETTERS,
      operationId: OPERATIONS.CREATE,
      eventKey: 'NEWSLETTER_WELCOME'
    }
  });
}

module.exports = {
  getConfig,
  hasApiKey,
  hasDefaultSender,
  isConfigured,
  sendEmail,
  sendContactTask,
  sendNewsletterWelcome
};
