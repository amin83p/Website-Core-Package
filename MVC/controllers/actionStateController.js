// MVC/controllers/actionStateController.js
const dataService = require('../services/dataService');
const actionStateRepository = require('../repositories/actionStateRepository');
const actionStateRetentionService = require('../services/actionStateRetentionService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { checkAdminVerificationCode } = require('../utils/encyptors');
const { idsEqual } = require('../utils/idAdapter');

function normalizeToken(value) {
  return String(value ?? '').trim();
}

function resolveUserDisplayName(userObj = null, fallbackState = {}) {
  const user = userObj && typeof userObj === 'object' ? userObj : {};
  const state = fallbackState && typeof fallbackState === 'object' ? fallbackState : {};
  const ctx = state?.initialContext && typeof state.initialContext === 'object' ? state.initialContext : {};

  const candidate =
    (typeof user.displayName === 'string' && user.displayName.trim())
    || (typeof user.name === 'string' && user.name.trim())
    || (user.name && typeof user.name === 'object'
      ? `${user.name.first || ''} ${user.name.last || ''}`.trim()
      : '')
    || (typeof user.username === 'string' && user.username.trim())
    || (typeof ctx.displayName === 'string' && ctx.displayName.trim())
    || (typeof ctx.username === 'string' && ctx.username.trim())
    || '';

  return candidate || 'Unknown / Deleted User';
}

async function enrichContextDisplayNames(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const sectionIds = Array.from(new Set(
    list.map((row) => normalizeToken(row?.sectionId)).filter(Boolean)
  ));
  const operationIds = Array.from(new Set(
    list.map((row) => normalizeToken(row?.operationId)).filter(Boolean)
  ));

  if (!sectionIds.length && !operationIds.length) return list;

  const [sections, operations] = await Promise.all([
    sectionIds.length
      ? dataService.fetchData(
        'sections',
        { id__in: sectionIds.join(','), limit: Math.max(sectionIds.length * 2, 1000) },
        SYSTEM_CONTEXT
      )
      : Promise.resolve([]),
    operationIds.length
      ? dataService.fetchData(
        'operations',
        { id__in: operationIds.join(','), limit: Math.max(operationIds.length * 2, 1000) },
        SYSTEM_CONTEXT
      )
      : Promise.resolve([])
  ]);

  const sectionMap = new Map();
  (Array.isArray(sections) ? sections : []).forEach((row) => {
    const id = normalizeToken(row?.id);
    if (!id) return;
    const name = normalizeToken(row?.name) || id;
    sectionMap.set(id, name);
  });

  const operationMap = new Map();
  (Array.isArray(operations) ? operations : []).forEach((row) => {
    const id = normalizeToken(row?.id);
    if (!id) return;
    const name = normalizeToken(row?.name) || id;
    operationMap.set(id, name);
  });

  return list.map((row) => {
    const sectionId = normalizeToken(row?.sectionId);
    const operationId = normalizeToken(row?.operationId);
    return {
      ...row,
      sectionDisplayName: sectionMap.get(sectionId) || sectionId || '',
      operationDisplayName: operationMap.get(operationId) || operationId || ''
    };
  });
}

// View: List all tracked activities
async function listActionStates(req, res) {
  try {
    const rawQuery = {
      q: req.query.q,
      id: req.query.id,
      userId: req.query.userId,
      sectionId: req.query.sectionId,
      targetKey: req.query.targetKey,
      operationId: req.query.operationId,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const query = {};
    Object.keys(rawQuery).forEach((key) => {
      const val = rawQuery[key];
      if (val !== undefined && val !== null && val !== '') {
        query[key] = val;
      }
    });

    const pageResult = await actionStateRepository.listPageWithSummary({
      query: {
        ...query,
        page: req.query.page,
        limit: req.query.limit
      },
      scope: { canViewAll: true }
    });

    let data = Array.isArray(pageResult?.data) ? pageResult.data : [];

    // Keep observer-effect protection to avoid counting/showing current tracker row.
    if (req.actionStateId) {
      data = data.filter((row) => row.id !== req.actionStateId);
    }

    data = await enrichContextDisplayNames(data);

    const pagination = pageResult?.pagination || {
      currentPage: 1,
      totalPages: 1,
      totalItems: 0,
      limit: 30,
      startItem: 0,
      endItem: 0
    };

    const summary = pageResult?.summary || {
      totalActivities: 0,
      totalVolumeKB: 0,
      activeSessions: 0,
      failures: 0
    };

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', results: data, pagination, summary });
    }

    res.render('actionState/list', {
      title: 'Activity Tracking',
      tableName: 'ActionState_Logs',
      newUrl: 'actionStates',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      data,
      pagination,
      summary,
      filters: req.query,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

// API: Get Details (With Names & Decrypted Payload)
async function getActionStateDetails(req, res) {
  try {
    const { id } = req.params;

    // 1. Fetch the Log Record
    const state = await dataService.getDataById('actionStates', id, req.user);
    if (!state) return res.status(404).json({ status: 'error', message: 'Record not found' });

    // 2. Fetch Decrypted Data
    const payload = await actionStateRepository.getDecryptedData(id);

    // 3. Fetch Related Entity Names for the UI
    const [userObj, sectionObj, opObj] = await Promise.all([
      dataService.getDataById('users', state.userId, SYSTEM_CONTEXT).catch(() => null),
      dataService.getDataById('sections', state.sectionId, SYSTEM_CONTEXT).catch(() => null),
      dataService.getDataById('operations', state.operationId, SYSTEM_CONTEXT).catch(() => null)
    ]);

    const meta = {
      userName: resolveUserDisplayName(userObj, state),
      username: normalizeToken(userObj?.username) || normalizeToken(state?.initialContext?.username),
      requestId: normalizeToken(state?.initialContext?.requestId),
      sectionName: sectionObj ? sectionObj.name : state.sectionId,
      opName: opObj ? opObj.name : state.operationId
    };

    const changeEvents = Array.isArray(state?.changeEvents) ? state.changeEvents : [];
    let entityTimeline = [];
    if (changeEvents.length > 0) {
      const latestEvent = changeEvents[changeEvents.length - 1];
      const entityType = normalizeToken(latestEvent?.entityType);
      const entityId = normalizeToken(latestEvent?.entityId);
      if (entityType && entityId) {
        entityTimeline = await dataService.getActionStateEntityTimeline(entityType, entityId).catch(() => []);
      }
    }

    res.json({
      status: 'success',
      record: state,
      meta,
      decryptedPayload: payload || null,
      changeEvents,
      entityTimeline
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function getActionStateEntityTimeline(req, res) {
  try {
    const entityType = normalizeToken(req.query?.entityType);
    const entityId = normalizeToken(req.query?.entityId);
    if (!entityType || !entityId) {
      return res.status(400).json({ status: 'error', message: 'entityType and entityId are required.' });
    }

    const timeline = await dataService.getActionStateEntityTimeline(entityType, entityId);
    return res.json({
      status: 'success',
      entityType,
      entityId,
      timeline: Array.isArray(timeline) ? timeline : []
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function cancelAction(req, res) {
  try {
    const { id } = req.body; // Expecting { id: "ASI..." }
    if (!id) throw new Error('Missing Action State ID');

    // Optional: Verify the user owns this state to prevent cancelling others' work
    const state = await actionStateRepository.getById(id);
    if (state && !idsEqual(state.userId, req.user.id)) {
      throw new Error('Unauthorized to cancel this action.');
    }

    await dataService.cancelActionState(id, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Action cancelled.' });
    }
    // If called via standard link (fallback), redirect back
    res.redirect('back');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}
/* ============================================================
   DELETE: All Logs (Protected)
============================================================ */
async function deleteAllActionStates(req, res) {
  try {
    // 1. Verify Admin Code (High Security Action)
    if (!checkAdminVerificationCode(req)) {
      throw new Error('Security Violation: High Privilege Access requested without valid Admin Verification.');
    }

    // 2. Execute Delete via Service
    await dataService.deleteAllData('actionStates', req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'All logs cleared.' });

    // Redirect to correct route (lowercase)
    res.redirect('/actionStates');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   DELETE: Single Log Item
============================================================ */
async function deleteActionState(req, res) {
  try {
    const results = await dataService.deleteData('actionStates', req.params.id, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Action State deleted successfully.', results });
    }
    // Redirect to correct route (lowercase)
    res.redirect('/actionStates');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function runActionStateRetentionCleanup(req, res) {
  try {
    if (!checkAdminVerificationCode(req)) {
      throw new Error('Security Violation: High Privilege Access requested without valid Admin Verification.');
    }

    const report = await actionStateRetentionService.runCleanupPass();
    if (!report) {
      throw new Error('Cleanup is already running or could not be executed at this moment.');
    }

    return res.json({
      status: 'success',
      message: `Cleanup completed. Backfilled: ${report.backfilled}, Deleted: ${report.deleted}.`,
      report
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listActionStates,
  getActionStateDetails,
  getActionStateEntityTimeline,
  cancelAction,
  deleteAllActionStates,
  deleteActionState,
  runActionStateRetentionCleanup
};
