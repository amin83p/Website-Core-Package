'use strict';

const path = require('path');
const emailOutboxRepository = require('../repositories/emailOutboxRepository');
const emailOutboxModel = require('../models/emailOutboxModel');

function cleanText(value) {
  return String(value || '').trim();
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function syncSchoolNotificationLedgerOnCancel(row = {}) {
  if (cleanText(row?.meta?.purpose) !== 'uncompleted_session_notification') return;
  const dedupeKey = cleanText(row?.dedupeKey);
  if (!dedupeKey) return;
  try {
    const ledgerModel = require(path.join(
      __dirname,
      '../../packages/school/MVC/models/school/sessionNotificationLedgerModel'
    ));
    await ledgerModel.markQueuedEntriesCancelled(dedupeKey);
  } catch (_) {
    // School package may be unavailable in some deployments.
  }
}

function isRequeueableStatus(status = '') {
  return ['cancelled', 'failed'].includes(cleanText(status));
}

function buildRequeuePatch(entry = {}) {
  return {
    orgId: entry.orgId,
    eventKey: entry.eventKey,
    to: entry.to,
    subject: entry.subject,
    html: entry.html,
    text: entry.text,
    from: entry.from,
    replyTo: entry.replyTo,
    providerProfileId: entry.providerProfileId,
    templateId: entry.templateId,
    injectedValues: entry.injectedValues,
    sendAt: entry.sendAt,
    dedupeKey: entry.dedupeKey,
    taskRunId: entry.taskRunId || '',
    meta: entry.meta,
    status: 'queued',
    sentAt: '',
    lastError: '',
    attemptCount: 0,
    preparedAt: new Date().toISOString()
  };
}

const emailOutboxService = {
  async enqueue(entry = {}, options = {}) {
    const rows = await emailOutboxService.enqueueBatch([entry], options);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  },

  async enqueueBatch(entries = [], options = {}) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return [];

    const created = [];
    for (const entry of list) {
      const dedupeKey = cleanText(entry?.dedupeKey);
      const forceInsert = cleanText(entry?.meta?.prepareRunId) !== '';
      if (dedupeKey && !forceInsert) {
        const existing = await emailOutboxRepository.list({
          ...options,
          query: {
            orgId__eq: cleanText(entry?.orgId),
            dedupeKey__eq: dedupeKey,
            page: 1,
            limit: 1
          }
        });
        if (Array.isArray(existing) && existing.length) {
          const row = existing[0];
          const status = cleanText(row?.status);
          if (['queued', 'sending', 'sent'].includes(status)) {
            continue;
          }
          if (isRequeueableStatus(status)) {
            // eslint-disable-next-line no-await-in-loop
            const reactivated = await emailOutboxRepository.update(row.id, buildRequeuePatch(entry), options);
            created.push(reactivated);
            continue;
          }
        }
      }
      // eslint-disable-next-line no-await-in-loop
      const row = await emailOutboxRepository.create(entry, options);
      created.push(row);
    }
    return created;
  },

  async listDue(now = new Date(), { limit = null, orgId = '', options = {} } = {}) {
    const cutoff = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const batchLimit = limit || parsePositiveInt(process.env.EMAIL_OUTBOX_DISPATCH_BATCH_SIZE, 50);
    const query = {
      status__eq: 'queued',
      sendAt__lte: cutoff,
      page: 1,
      limit: batchLimit,
      sortBy: 'sendAt',
      sortDir: 'asc'
    };
    const orgKey = cleanText(orgId);
    if (orgKey) query.orgId__eq = orgKey;
    return emailOutboxRepository.list({
      ...options,
      query
    });
  },

  async markSending(id, options = {}) {
    return emailOutboxRepository.update(id, {
      status: 'sending',
      attemptCount: 1
    }, options);
  },

  async markSent(id, options = {}) {
    return emailOutboxRepository.update(id, {
      status: 'sent',
      sentAt: new Date().toISOString(),
      lastError: ''
    }, options);
  },

  async markFailed(id, errorMessage = '', options = {}) {
    return emailOutboxRepository.update(id, {
      status: 'failed',
      lastError: cleanText(errorMessage).slice(0, 5000)
    }, options);
  },

  async hasActiveEntry(orgId, dedupeKey, options = {}) {
    const key = cleanText(dedupeKey);
    if (!key) return false;
    const rows = await emailOutboxRepository.list({
      ...options,
      query: {
        orgId__eq: cleanText(orgId),
        dedupeKey__eq: key,
        page: 1,
        limit: 5
      }
    });
    return (Array.isArray(rows) ? rows : []).some((row) => (
      ['queued', 'sending', 'sent'].includes(cleanText(row?.status))
    ));
  },

  async cancelById(id, options = {}) {
    const row = await emailOutboxRepository.getById(id, options);
    if (!row) throw new Error('Email outbox entry not found.');
    if (!['queued', 'sending'].includes(cleanText(row.status))) {
      throw new Error('Only queued or sending outbox emails can be cancelled.');
    }
    const updated = await emailOutboxRepository.update(id, { status: 'cancelled' }, options);
    await syncSchoolNotificationLedgerOnCancel(row);
    return updated;
  },

  async cancelByDedupeKey(orgId, dedupeKey, options = {}) {
    const rows = await emailOutboxRepository.list({
      ...options,
      query: {
        orgId__eq: cleanText(orgId),
        dedupeKey__eq: cleanText(dedupeKey),
        status__in: ['queued', 'sending'],
        page: 1,
        limit: 100
      }
    });
    const cancelled = [];
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      cancelled.push(await emailOutboxRepository.update(row.id, { status: 'cancelled' }, options));
      // eslint-disable-next-line no-await-in-loop
      await syncSchoolNotificationLedgerOnCancel(row);
    }
    return cancelled;
  },

  async listActiveNotificationEntries(orgId, options = {}) {
    const rows = await emailOutboxRepository.list({
      ...options,
      query: {
        orgId__eq: cleanText(orgId),
        status__in: ['queued', 'sending'],
        page: 1,
        limit: 500,
        sortBy: 'sendAt',
        sortDir: 'asc'
      }
    });
    return (Array.isArray(rows) ? rows : []).filter(
      (row) => cleanText(row?.meta?.purpose) === 'uncompleted_session_notification'
    );
  },

  async countPrepareConflicts(orgId, options = {}) {
    const rows = await emailOutboxService.listActiveNotificationEntries(orgId, options);
    return rows.length;
  },

  async cancelActiveNotificationEntries(orgId, options = {}) {
    const rows = await emailOutboxService.listActiveNotificationEntries(orgId, options);
    return emailOutboxService.cancelByIds(rows.map((row) => row.id), options);
  },

  async cancelByIds(ids = [], options = {}) {
    const list = (Array.isArray(ids) ? ids : []).map((id) => cleanText(id)).filter(Boolean);
    const succeeded = [];
    const failed = [];
    for (const id of list) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const row = await emailOutboxService.cancelById(id, options);
        succeeded.push(row);
      } catch (error) {
        failed.push({ id, message: cleanText(error?.message || error) });
      }
    }
    return { succeeded, failed, total: list.length };
  },

  async deleteById(id, options = {}) {
    const row = await emailOutboxRepository.getById(id, options);
    if (!row) throw new Error('Email outbox entry not found.');
    const status = cleanText(row.status);
    if (!['cancelled', 'failed', 'sent'].includes(status)) {
      throw new Error('Only cancelled, failed, or sent outbox emails can be deleted.');
    }
    await emailOutboxRepository.remove(id, options);
    return true;
  },

  async deleteByIds(ids = [], options = {}) {
    const list = (Array.isArray(ids) ? ids : []).map((id) => cleanText(id)).filter(Boolean);
    const succeeded = [];
    const failed = [];
    for (const id of list) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await emailOutboxService.deleteById(id, options);
        succeeded.push(id);
      } catch (error) {
        failed.push({ id, message: cleanText(error?.message || error) });
      }
    }
    return { succeeded, failed, total: list.length };
  },

  async listEntries(query = {}, options = {}) {
    return emailOutboxRepository.list({ ...options, query });
  },

  async countEntries(query = {}, options = {}) {
    return emailOutboxRepository.count({ ...options, query });
  },

  async getById(id, options = {}) {
    return emailOutboxRepository.getById(id, options);
  },

  normalizeRecord: emailOutboxModel.normalizeEmailOutboxRecord
};

module.exports = emailOutboxService;
