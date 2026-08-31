'use strict';

const smsProviderService = require('./sms/smsProviderService');
const smsOutboxService = require('./smsOutboxService');

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
  const to = cleanText(row.to);
  const body = cleanText(row.body);
  const eventKey = cleanText(row.eventKey) || 'SMS_OUTBOX';

  await smsProviderService.sendMessage({
    phoneE164: to,
    body,
    orgId,
    eventKey,
    meta: row.meta || {}
  });
}

const smsOutboxDispatchService = {
  async dispatchDue({ now = new Date(), orgId = '', logger = null } = {}) {
    const batchLimit = parsePositiveInt(process.env.SMS_OUTBOX_DISPATCH_BATCH_SIZE, 50);
    const dueRows = await smsOutboxService.listDue(now, { limit: batchLimit, orgId });
    const metrics = { sent: 0, failed: 0, skipped: 0 };

    for (const row of dueRows) {
      const id = cleanText(row?.id);
      if (!id) {
        metrics.skipped += 1;
        continue;
      }
      try {
        await smsOutboxService.markSending(id);
        await sendOutboxRow(row);
        await smsOutboxService.markSent(id);
        metrics.sent += 1;
        if (logger) logger.info(`Sent outbox SMS ${id} to ${cleanText(row.to)}`);
      } catch (error) {
        await smsOutboxService.markFailed(id, error?.message || String(error));
        metrics.failed += 1;
        if (logger) logger.error(`Failed outbox SMS ${id}: ${error?.message || error}`);
      }
    }

    return metrics;
  }
};

module.exports = smsOutboxDispatchService;
