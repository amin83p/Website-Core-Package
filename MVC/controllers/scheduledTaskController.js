'use strict';

const scheduledTaskDefinitionService = require('../services/scheduledTaskDefinitionService');
const scheduledTaskRunService = require('../services/scheduledTaskRunService');
const scheduledTaskOrchestratorService = require('../services/scheduledTaskOrchestratorService');
const emailOutboxService = require('../services/emailOutboxService');
const smsOutboxService = require('../services/smsOutboxService');
const scheduledTaskUiService = require('../services/scheduledTaskUiService');
const { listRegisteredScheduledTaskHandlers } = require('../services/scheduledTaskRegistry');
const { formatMsToDateTimeLocalInput, resolveDefaultTimezone } = require('../utils/timezoneUtils');

function buildPagination(totalRows, page, limit) {
  const safeLimit = Math.max(1, Number(limit) || 30);
  const safePage = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Math.ceil(totalRows / safeLimit));
  const currentPage = Math.min(safePage, totalPages);
  return {
    currentPage,
    totalPages,
    totalItems: totalRows,
    limit: safeLimit,
    startItem: totalRows > 0 ? ((currentPage - 1) * safeLimit + 1) : 0,
    endItem: Math.min(currentPage * safeLimit, totalRows)
  };
}

function cleanText(value) {
  return String(value || '').trim();
}

function resolveSchedulingTimezone(req) {
  return cleanText(req?.orgTimeZone) || resolveDefaultTimezone();
}

function buildToNextRunLocalInput(timezone = '') {
  const tz = cleanText(timezone) || resolveDefaultTimezone();
  return (iso = '') => {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '';
    return formatMsToDateTimeLocalInput(ms, tz);
  };
}

function isAjax(req) {
  const requestedWith = String(req?.headers?.['x-requested-with'] || '').toLowerCase();
  const ajaxHeader = String(req?.headers?.['x-ajax-request'] || '').toLowerCase();
  const accept = String(req?.headers?.accept || '').toLowerCase();
  return requestedWith === 'xmlhttprequest' || ajaxHeader === 'true' || accept.includes('application/json');
}

function respondMutation(req, res, {
  successRedirect,
  successMessage,
  errorMessage = 'Unable to complete the operation.'
}, runner) {
  return Promise.resolve()
    .then(runner)
    .then((runnerResult) => {
      const resultSummary = cleanText(runnerResult?.resultSummary || '');
      const message = resultSummary || cleanText(runnerResult?.message || successMessage);
      if (isAjax(req)) {
        return res.json({
          status: 'success',
          message,
          resultSummary,
          metrics: runnerResult?.metrics && typeof runnerResult.metrics === 'object'
            ? runnerResult.metrics
            : null
        });
      }
      return res.redirect(successRedirect);
    })
    .catch((error) => {
      const message = cleanText(error?.message || errorMessage);
      if (isAjax(req)) {
        return res.status(400).json({ status: 'error', message });
      }
      return res.status(500).render('error', {
        title: 'Error',
        message,
        user: req.user || null
      });
    });
}

function parseIdList(body = {}) {
  const raw = body?.ids ?? body?.idList ?? body?.entryIds ?? '';
  if (Array.isArray(raw)) return raw.map((id) => cleanText(id)).filter(Boolean);
  return String(raw || '').split(',').map((id) => cleanText(id)).filter(Boolean);
}

function toNextRunLocalInput(iso = '', timezone = '') {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  return formatMsToDateTimeLocalInput(ms, cleanText(timezone) || resolveDefaultTimezone());
}

function buildListQuery(req, defaults = {}) {
  const query = { ...(defaults || {}) };
  const page = Number.parseInt(String(req.query.page || '1'), 10);
  const limit = Number.parseInt(String(req.query.limit || '30'), 10);
  query.page = Number.isFinite(page) && page > 0 ? page : 1;
  query.limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 30;
  [
    'orgId__eq',
    'packageName__eq',
    'taskKey__eq',
    'status__eq',
    'enabled__eq',
    'paused__eq',
    'definitionId__eq',
    'eventKey__eq'
  ].forEach((key) => {
    const value = cleanText(req.query[key]);
    if (value) query[key] = value;
  });
  if (req.query.search) query.search = cleanText(req.query.search);
  if (req.query.q) query.q = cleanText(req.query.q);
  if (req.query.type) query.type = cleanText(req.query.type);
  if (req.query.searchFields) query.searchFields = cleanText(req.query.searchFields);
  return query;
}

function buildListRenderLocals(req, {
  title,
  tableName,
  data,
  pagination,
  filters,
  searchableFields,
  baseUrlPath,
  extra = {}
}) {
  return {
    title,
    user: req.user || null,
    tableName,
    data,
    pagination,
    filters,
    searchableFields,
    baseUrlPath,
    includeModal: true,
    includeModal_Table: true,
    print: true,
    actionStateId: req?.actionStateId || '',
    ...extra
  };
}

async function showDefinitionList(req, res) {
  try {
    const query = buildListQuery(req, { sortBy: 'nextRunAt', sortDir: 'asc' });
    const [rows, totalRows, handlers, definitionAccess, manageBtns] = await Promise.all([
      scheduledTaskDefinitionService.listDefinitions(query),
      scheduledTaskDefinitionService.countDefinitions({ ...query, page: undefined, limit: undefined }),
      Promise.resolve(listRegisteredScheduledTaskHandlers()),
      scheduledTaskUiService.buildDefinitionAccessFlags(req),
      scheduledTaskUiService.buildNavButtons(req, 'definitions')
    ]);
    const pagination = buildPagination(totalRows, query.page, query.limit);
    const packageOptions = [...new Set((handlers || []).map((row) => cleanText(row.packageName)).filter(Boolean))].sort();
    const schedulingTimezone = resolveSchedulingTimezone(req);
    const formatNextRunForSettings = buildToNextRunLocalInput(schedulingTimezone);

    if (isAjax(req)) {
      return res.json({ status: 'success', data: rows, pagination, schedulingTimezone });
    }

    return res.render('scheduledTasks/definitionList', buildListRenderLocals(req, {
      title: 'Auto Scheduled Tasks',
      tableName: 'Scheduled_Task_Definitions',
      data: rows,
      pagination,
      filters: query,
      baseUrlPath: 'scheduled-tasks',
      searchableFields: ['id', 'label', 'taskKey', 'packageName', 'orgId', 'source', 'sourceRef', 'timezone'],
      extra: {
        handlers: handlers || [],
        packageOptions,
        definitionAccess: definitionAccess || {},
        manageBtns: manageBtns || [],
        schedulingTimezone,
        toNextRunLocalInput: formatNextRunForSettings
      }
    }));
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to load scheduled task definitions.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load scheduled task definitions.',
      user: req.user || null
    });
  }
}

async function showRunList(req, res) {
  try {
    const query = buildListQuery(req, { sortBy: 'scheduledFor', sortDir: 'desc' });
    const [rows, totalRows, runAccess, manageBtns] = await Promise.all([
      scheduledTaskRunService.listRuns(query),
      scheduledTaskRunService.countRuns({ ...query, page: undefined, limit: undefined }),
      scheduledTaskUiService.buildRunAccessFlags(req),
      scheduledTaskUiService.buildNavButtons(req, 'runs')
    ]);
    const pagination = buildPagination(totalRows, query.page, query.limit);

    if (isAjax(req)) {
      return res.json({ status: 'success', data: rows, pagination });
    }

    return res.render('scheduledTasks/runList', buildListRenderLocals(req, {
      title: 'Scheduled Task Runs',
      tableName: 'Scheduled_Task_Runs',
      data: rows,
      pagination,
      filters: query,
      baseUrlPath: 'scheduled-tasks/runs',
      searchableFields: ['id', 'taskKey', 'packageName', 'orgId', 'status', 'resultSummary', 'errorMessage'],
      extra: {
        runAccess: runAccess || {},
        manageBtns: manageBtns || []
      }
    }));
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to load scheduled task runs.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load scheduled task runs.',
      user: req.user || null
    });
  }
}

async function showOutboxList(req, res) {
  try {
    const query = buildListQuery(req, { sortBy: 'sendAt', sortDir: 'desc' });
    const [rows, totalRows, outboxAccess, manageBtns] = await Promise.all([
      emailOutboxService.listEntries(query),
      emailOutboxService.countEntries({ ...query, page: undefined, limit: undefined }),
      scheduledTaskUiService.buildOutboxAccessFlags(req),
      scheduledTaskUiService.buildNavButtons(req, 'outbox')
    ]);
    const pagination = buildPagination(totalRows, query.page, query.limit);

    if (isAjax(req)) {
      return res.json({ status: 'success', data: rows, pagination });
    }

    return res.render('scheduledTasks/outboxList', buildListRenderLocals(req, {
      title: 'Email Outbox',
      tableName: 'Email_Outbox',
      data: rows,
      pagination,
      filters: query,
      baseUrlPath: 'scheduled-tasks/outbox',
      searchableFields: ['id', 'to', 'subject', 'orgId', 'eventKey', 'status', 'dedupeKey', 'lastError'],
      extra: {
        outboxAccess: outboxAccess || {},
        manageBtns: manageBtns || []
      }
    }));
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to load email outbox entries.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load email outbox entries.',
      user: req.user || null
    });
  }
}

async function pauseDefinition(req, res) {
  const id = cleanText(req.params.id);
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks',
    successMessage: 'Task definition paused.'
  }, async () => {
    await scheduledTaskDefinitionService.setPaused(id, true);
  });
}

async function resumeDefinition(req, res) {
  const id = cleanText(req.params.id);
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks',
    successMessage: 'Task definition resumed.'
  }, async () => {
    await scheduledTaskDefinitionService.setPaused(id, false);
  });
}

async function deleteDefinition(req, res) {
  const id = cleanText(req.params.id);
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks',
    successMessage: 'Task definition deleted.'
  }, async () => {
    await scheduledTaskDefinitionService.deleteDefinition(id);
  });
}

async function runDefinitionNow(req, res) {
  const id = cleanText(req.params.id);
  const prepareMode = cleanText(req.body?.prepareMode || 'additive').toLowerCase() === 'replace'
    ? 'replace'
    : 'additive';
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks',
    successMessage: 'Task run completed successfully.'
  }, async () => {
    const outcome = await scheduledTaskOrchestratorService.runDefinitionNow(id, { prepareMode });
    return {
      resultSummary: cleanText(outcome?.result?.resultSummary || outcome?.run?.resultSummary || ''),
      metrics: outcome?.result?.metrics || outcome?.run?.metrics || null
    };
  });
}

async function updateDefinitionNextRun(req, res) {
  const id = cleanText(req.params.id);
  const nextRunAt = cleanText(req.body?.nextRunAt);
  const timezone = cleanText(req.body?.timezone) || resolveSchedulingTimezone(req);
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks',
    successMessage: 'Next run time updated.'
  }, async () => {
    await scheduledTaskDefinitionService.setNextRunAt(id, nextRunAt, { timezone });
    return { message: 'Next run time updated.' };
  });
}

async function getPrepareConflicts(req, res) {
  try {
    const orgId = cleanText(req.query?.orgId);
    if (!orgId) {
      return res.status(400).json({ status: 'error', message: 'Organization ID is required.' });
    }
    const channel = cleanText(req.query?.channel).toLowerCase() === 'sms' ? 'sms' : 'email';
    const count = channel === 'sms'
      ? await smsOutboxService.countPrepareConflicts(orgId)
      : await emailOutboxService.countPrepareConflicts(orgId);
    return res.json({ status: 'success', count, channel });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: cleanText(error?.message || error) });
  }
}

async function cancelRun(req, res) {
  const id = cleanText(req.params.id);
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks/runs',
    successMessage: 'Task run cancelled.'
  }, async () => {
    await scheduledTaskRunService.cancelRun(id);
  });
}

async function cancelOutboxEntry(req, res) {
  const id = cleanText(req.params.id);
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks/outbox',
    successMessage: 'Outbox email cancelled.'
  }, async () => {
    await emailOutboxService.cancelById(id);
  });
}

async function bulkCancelOutbox(req, res) {
  const ids = parseIdList(req.body || {});
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks/outbox',
    successMessage: 'Selected outbox emails cancelled.'
  }, async () => {
    if (!ids.length) throw new Error('Select at least one outbox email to cancel.');
    const result = await emailOutboxService.cancelByIds(ids);
    const message = `Cancelled ${result.succeeded.length} email(s).${result.failed.length ? ` ${result.failed.length} failed.` : ''}`;
    return { message, resultSummary: message, metrics: result };
  });
}

async function bulkDeleteOutbox(req, res) {
  const ids = parseIdList(req.body || {});
  return respondMutation(req, res, {
    successRedirect: '/scheduled-tasks/outbox',
    successMessage: 'Selected outbox emails deleted.'
  }, async () => {
    if (!ids.length) throw new Error('Select at least one outbox email to delete.');
    const result = await emailOutboxService.deleteByIds(ids);
    const message = `Deleted ${result.succeeded.length} email(s).${result.failed.length ? ` ${result.failed.length} failed.` : ''}`;
    return { message, resultSummary: message, metrics: result };
  });
}

module.exports = {
  showDefinitionList,
  showRunList,
  showOutboxList,
  pauseDefinition,
  resumeDefinition,
  deleteDefinition,
  runDefinitionNow,
  updateDefinitionNextRun,
  getPrepareConflicts,
  cancelRun,
  cancelOutboxEntry,
  bulkCancelOutbox,
  bulkDeleteOutbox
};
