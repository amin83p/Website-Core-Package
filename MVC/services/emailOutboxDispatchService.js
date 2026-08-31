'use strict';

const emailDispatchService = require('./emailDispatchService');
const resendEmailService = require('./resendEmailService');
const emailProviderProfileService = require('./emailProviderProfileService');
const emailOutboxService = require('./emailOutboxService');

function cleanText(value) {
  return String(value || '').trim();
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function sendOutboxRow(row = {}) {
  const orgId = cleanText(row.orgId);
  const eventKey = cleanText(row.eventKey);
  const to = cleanText(row.to);
  const templateId = cleanText(row.templateId);
  const providerProfileId = cleanText(row.providerProfileId);
  const injectedValues = row.injectedValues && typeof row.injectedValues === 'object' ? row.injectedValues : {};

  if (eventKey && templateId) {
    await emailDispatchService.sendByEvent({
      orgId,
      eventKey,
      to,
      injectedValues,
      templateId,
      providerProfileId,
      meta: row.meta || {}
    });
    return;
  }

  const credentials = await emailProviderProfileService.resolveProviderCredentials(orgId, providerProfileId);
  const sender = cleanText(row.from) || cleanText(credentials.fromEmail) || undefined;
  if (sender) {
    emailProviderProfileService.validateSenderDomain(sender, credentials.verifiedDomains);
  }
  await resendEmailService.sendEmail({
    to,
    subject: cleanText(row.subject),
    text: cleanText(row.text),
    html: cleanText(row.html),
    from: sender,
    replyTo: cleanText(row.replyTo) || undefined,
    credentials: {
      apiKey: credentials.apiKey,
      from: credentials.fromEmail || sender
    },
    meta: {
      orgId,
      eventKey: eventKey || 'EMAIL_OUTBOX',
      purpose: 'scheduled_outbox_dispatch',
      ...(row.meta || {})
    }
  });
}

const emailOutboxDispatchService = {
  async dispatchDue({ now = new Date(), orgId = '', logger = null } = {}) {
    const batchLimit = parsePositiveInt(process.env.EMAIL_OUTBOX_DISPATCH_BATCH_SIZE, 50);
    const dueRows = await emailOutboxService.listDue(now, { limit: batchLimit, orgId });
    const metrics = { sent: 0, failed: 0, skipped: 0 };

    for (const row of dueRows) {
      const id = cleanText(row?.id);
      if (!id) {
        metrics.skipped += 1;
        continue;
      }
      try {
        await emailOutboxService.markSending(id);
        await sendOutboxRow(row);
        await emailOutboxService.markSent(id);
        metrics.sent += 1;
        if (logger) logger.info(`Sent outbox email ${id} to ${cleanText(row.to)}`);
      } catch (error) {
        await emailOutboxService.markFailed(id, error?.message || String(error));
        metrics.failed += 1;
        if (logger) logger.error(`Failed outbox email ${id}: ${error?.message || error}`);
      }
    }

    return metrics;
  }
};

module.exports = emailOutboxDispatchService;
