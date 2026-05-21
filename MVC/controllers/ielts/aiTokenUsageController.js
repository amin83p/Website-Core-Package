const ieltsService = require('../../services/ielts/ieltsDataService');
const paginate = require('../../utils/paginationHelper');
const { inferSearchableFields } = require('../../utils/generalTools');
const adminChekersService = require('../../services/adminChekersService');
const { SECTIONS } = require('../../../config/accessConstants');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const BILLING_STATUS_OPTIONS = Object.freeze([
  { id: 'unbilled', label: 'Unbilled' },
  { id: 'billed', label: 'Billed' },
  { id: 'waived', label: 'Waived' }
]);
const SHORTCUT_OPTIONS = Object.freeze([
  { id: 'today', label: 'Today' },
  { id: 'two_days', label: 'Two Days' },
  { id: 'three_days', label: 'Three Days' },
  { id: 'this_week', label: 'This Week' },
  { id: 'two_weeks', label: 'Two Weeks' },
  { id: 'this_month', label: 'This Month' },
  { id: 'three_months', label: 'Three Months' },
  { id: 'year', label: 'Year' }
]);

function s(value) {
  return String(value ?? '').trim();
}

function normalizeTargetType(value) {
  const token = s(value).toLowerCase();
  if (token === 'org') return 'org';
  if (token === 'user') return 'user';
  return 'all';
}

function getActiveUserLabel(user = null) {
  if (!user || typeof user !== 'object') return 'Active User';
  return s(user.fullName) || s(user.username) || s(user.email) || s(user.id) || 'Active User';
}

function hasSectionAdminAccess(user = null, sectionId = '') {
  if (!user || !sectionId) return false;
  const sections = Array.isArray(user?.activeProfile?.sections) ? user.activeProfile.sections : [];
  return sections.some((row) => idsEqual(row?.sectionId, sectionId) && row?.adminAccess === true);
}

function canSelectUserOrOrg(user = null) {
  if (!user) return false;
  if (adminChekersService.isAdmin(user)) return true;
  if (adminChekersService.isOrgAdmin(user)) return true;
  if (hasSectionAdminAccess(user, SECTIONS.IELTS_AI_TOKEN_USAGE)) return true;
  return false;
}

function buildSelectableOptions(rows = [], reqUser = null) {
  const activeUserId = toPublicId(reqUser?.id) || '';
  const activeUserLabel = getActiveUserLabel(reqUser);
  const allowedOrgMap = new Map();
  const allowedOrgs = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
  allowedOrgs.forEach((org) => {
    const orgId = toPublicId(org?.orgId || org?.id);
    if (!orgId) return;
    const orgLabel = s(org?.name) || s(org?.displayName) || orgId;
    allowedOrgMap.set(orgId, orgLabel);
  });

  const userMap = new Map();
  const orgMap = new Map();

  rows.forEach((row) => {
    const userId = toPublicId(row?.userId);
    const orgId = toPublicId(row?.orgId) || 'SYSTEM';
    if (userId && !userMap.has(userId)) {
      userMap.set(userId, userId === activeUserId ? `${activeUserLabel} (${userId})` : userId);
    }
    if (!orgMap.has(orgId)) {
      orgMap.set(orgId, allowedOrgMap.get(orgId) || orgId);
    }
  });

  if (activeUserId && !userMap.has(activeUserId)) {
    userMap.set(activeUserId, `${activeUserLabel} (${activeUserId})`);
  }

  return {
    userOptions: Array.from(userMap.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    orgOptions: Array.from(orgMap.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)))
  };
}

function normalizeBillingStatus(value) {
  const token = s(value).toLowerCase();
  if (token === 'billed' || token === 'waived') return token;
  return 'unbilled';
}

function buildUpdatePayload(body = {}) {
  return {
    billingStatus: normalizeBillingStatus(body.billingStatus),
    billingReference: s(body.billingReference) || null,
    billingNotes: s(body.billingNotes)
  };
}

function toDateInputValue(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateFromInput(value, endOfDay = false) {
  const raw = s(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const date = new Date(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday-based
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfYear(date = new Date()) {
  const d = new Date(date.getFullYear(), 0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(base, months) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function buildShortcutRange(shortcutId = 'today', now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (String(shortcutId || '').trim().toLowerCase()) {
    case 'two_days':
      return { start: addDays(todayStart, -1), end: todayEnd };
    case 'three_days':
      return { start: addDays(todayStart, -2), end: todayEnd };
    case 'this_week':
      return { start: startOfWeek(now), end: todayEnd };
    case 'two_weeks':
      return { start: addDays(todayStart, -13), end: todayEnd };
    case 'this_month':
      return { start: startOfMonth(now), end: todayEnd };
    case 'three_months':
      return { start: addMonths(startOfMonth(now), -2), end: todayEnd };
    case 'year':
      return { start: startOfYear(now), end: todayEnd };
    case 'today':
    default:
      return { start: todayStart, end: todayEnd };
  }
}

function normalizeScope(value) {
  const token = s(value).toLowerCase();
  return token === 'org' ? 'org' : 'user';
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildTimeline(filteredRows = [], startDate, endDate) {
  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const singleDay = toDateInputValue(startDay) === toDateInputValue(endDay);

  const labels = [];
  const bucketMap = new Map();

  if (singleDay) {
    for (let hour = 0; hour < 24; hour += 1) {
      const label = `${String(hour).padStart(2, '0')}:00`;
      labels.push(label);
      bucketMap.set(label, { label, callCount: 0, totalTokens: 0, promptTokens: 0, outputTokens: 0, successCount: 0, failedCount: 0 });
    }
  } else {
    const cursor = new Date(startDay);
    while (cursor <= endDay) {
      const label = toDateInputValue(cursor);
      labels.push(label);
      bucketMap.set(label, { label, callCount: 0, totalTokens: 0, promptTokens: 0, outputTokens: 0, successCount: 0, failedCount: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  filteredRows.forEach((row) => {
    const date = new Date(row?.consumedAt || row?.createdAt || 0);
    if (Number.isNaN(date.getTime())) return;
    const label = singleDay ? `${String(date.getHours()).padStart(2, '0')}:00` : toDateInputValue(date);
    const bucket = bucketMap.get(label);
    if (!bucket) return;
    bucket.callCount += 1;
    bucket.promptTokens += toNumber(row?.promptTokenCount);
    bucket.outputTokens += toNumber(row?.candidatesTokenCount);
    bucket.totalTokens += toNumber(row?.totalTokenCount);
    if (String(row?.status || '').toLowerCase() === 'failed') bucket.failedCount += 1;
    else bucket.successCount += 1;
  });

  return {
    singleDay,
    rows: labels.map((label) => bucketMap.get(label))
  };
}

function buildBreakdown(filteredRows = [], scope = 'user') {
  const map = new Map();
  filteredRows.forEach((row) => {
    const key = scope === 'org' ? s(row?.orgId, 'SYSTEM') : s(row?.userId, 'unknown');
    if (!map.has(key)) {
      map.set(key, {
        key,
        callCount: 0,
        totalTokens: 0,
        promptTokens: 0,
        outputTokens: 0,
        successCount: 0,
        failedCount: 0,
        providers: new Set()
      });
    }
    const item = map.get(key);
    item.callCount += 1;
    item.promptTokens += toNumber(row?.promptTokenCount);
    item.outputTokens += toNumber(row?.candidatesTokenCount);
    item.totalTokens += toNumber(row?.totalTokenCount);
    item.providers.add(s(row?.providerId));
    if (String(row?.status || '').toLowerCase() === 'failed') item.failedCount += 1;
    else item.successCount += 1;
  });

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      providerCount: item.providers.size
    }))
    .sort((a, b) => {
      if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
      return String(a.key).localeCompare(String(b.key));
    });
}

function buildProviderBreakdown(filteredRows = []) {
  const map = new Map();
  filteredRows.forEach((row) => {
    const key = s(row?.providerId, 'unknown');
    if (!map.has(key)) {
      map.set(key, {
        key,
        callCount: 0,
        totalTokens: 0,
        promptTokens: 0,
        outputTokens: 0,
        successCount: 0,
        failedCount: 0
      });
    }
    const item = map.get(key);
    item.callCount += 1;
    item.promptTokens += toNumber(row?.promptTokenCount);
    item.outputTokens += toNumber(row?.candidatesTokenCount);
    item.totalTokens += toNumber(row?.totalTokenCount);
    if (String(row?.status || '').toLowerCase() === 'failed') item.failedCount += 1;
    else item.successCount += 1;
  });

  return Array.from(map.values()).sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return String(a.key).localeCompare(String(b.key));
  });
}

exports.showAiTokenUsageList = async (req, res) => {
  try {
    const records = await ieltsService.fetchData('aiTokenUsages', req.query, req.user);
    const searchableFields = await inferSearchableFields(records, {
      exclude: ['requestMeta', 'usage']
    });
    const sorted = (Array.isArray(records) ? records : [])
      .slice()
      .sort((a, b) => new Date(b?.consumedAt || b?.createdAt || 0) - new Date(a?.consumedAt || a?.createdAt || 0));
    const { data, pagination } = paginate(sorted, req.query.page, req.query.limit);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', data, pagination });
    }

    return res.render('ielts/aiTokenUsageList', {
      title: 'AI Token Usage',
      data,
      newUrl: 'ielts/ai-token-usage',
      newLabel: null,
      tableName: 'IELTS_AITokenUsage',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      searchableFields,
      filters: req.query,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
};

exports.showEditAiTokenUsageForm = async (req, res) => {
  try {
    const record = await ieltsService.getDataById('aiTokenUsages', req.params.id, req.user);
    if (!record) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'AI token usage record not found.',
        user: req.user || null
      });
    }

    return res.render('ielts/aiTokenUsageForm', {
      title: 'AI Token Usage Detail',
      usageRecord: record,
      billingStatusOptions: BILLING_STATUS_OPTIONS,
      includeModal: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
};

exports.editAiTokenUsage = async (req, res) => {
  try {
    const payload = buildUpdatePayload(req.body);
    await ieltsService.updateData('aiTokenUsages', req.params.id, payload, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'AI token usage record updated.' });
    }

    return res.redirect('/ielts/ai-token-usage');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
};

exports.showAiTokenUsageAnalytics = async (req, res) => {
  try {
    const shortcutRaw = s(req.query.shortcut).toLowerCase();
    const validShortcut = SHORTCUT_OPTIONS.some((item) => item.id === shortcutRaw) ? shortcutRaw : 'today';

    let startDate = parseDateFromInput(req.query.startDate, false);
    let endDate = parseDateFromInput(req.query.endDate, true);
    if (!startDate || !endDate) {
      const fallback = buildShortcutRange(validShortcut, new Date());
      startDate = fallback.start;
      endDate = fallback.end;
    }
    if (startDate > endDate) {
      const swap = startDate;
      startDate = new Date(endDate);
      endDate = new Date(swap);
    }

    const adminSelectable = canSelectUserOrOrg(req.user);
    const activeUserId = toPublicId(req.user?.id) || '';
    const activeUserLabel = getActiveUserLabel(req.user);
    const scope = adminSelectable ? normalizeScope(req.query.scope) : 'user';
    const selectedTargetType = adminSelectable ? normalizeTargetType(req.query.targetType) : 'user';
    const requestedTargetId = adminSelectable ? toPublicId(req.query.targetId) : activeUserId;

    const rows = await ieltsService.fetchData('aiTokenUsages', {}, req.user);
    const allRows = Array.isArray(rows) ? rows : [];
    const selectableOptions = buildSelectableOptions(allRows, req.user);
    const validTargetId = (
      selectedTargetType === 'org'
        ? selectableOptions.orgOptions.some((row) => idsEqual(row.id, requestedTargetId))
        : selectedTargetType === 'user'
          ? selectableOptions.userOptions.some((row) => idsEqual(row.id, requestedTargetId))
          : false
    ) ? requestedTargetId : '';

    const filteredRows = allRows
      .filter((row) => {
        const consumedAt = new Date(row?.consumedAt || row?.createdAt || 0);
        if (Number.isNaN(consumedAt.getTime())) return false;
        if (!(consumedAt >= startDate && consumedAt <= endDate)) return false;

        if (!adminSelectable) {
          return idsEqual(row?.userId, activeUserId);
        }

        if (!validTargetId || selectedTargetType === 'all') return true;
        if (selectedTargetType === 'org') return idsEqual(row?.orgId, validTargetId);
        if (selectedTargetType === 'user') return idsEqual(row?.userId, validTargetId);
        return true;
      })
      .sort((a, b) => new Date(a?.consumedAt || a?.createdAt || 0) - new Date(b?.consumedAt || b?.createdAt || 0));

    const totals = filteredRows.reduce((acc, row) => {
      acc.callCount += 1;
      acc.promptTokens += toNumber(row?.promptTokenCount);
      acc.outputTokens += toNumber(row?.candidatesTokenCount);
      acc.totalTokens += toNumber(row?.totalTokenCount);
      if (String(row?.status || '').toLowerCase() === 'failed') acc.failedCount += 1;
      else acc.successCount += 1;
      return acc;
    }, {
      callCount: 0,
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      successCount: 0,
      failedCount: 0
    });

    const timeline = buildTimeline(filteredRows, startDate, endDate);
    const breakdownRows = buildBreakdown(filteredRows, scope);
    const providerRows = buildProviderBreakdown(filteredRows);

    return res.render('ielts/aiTokenUsageAnalytics', {
      title: 'AI Token Usage Analytics',
      user: req.user || null,
      includeModal: true,
      filters: {
        startDate: toDateInputValue(startDate),
        endDate: toDateInputValue(endDate),
        shortcut: validShortcut,
        scope,
        targetType: selectedTargetType,
        targetId: validTargetId
      },
      analyticsAccess: {
        allowTargetSelect: adminSelectable,
        activeUserLabel,
        activeUserId
      },
      selectableOptions,
      shortcutOptions: SHORTCUT_OPTIONS,
      totals,
      timeline,
      breakdownRows,
      providerRows,
      filteredRowsCount: filteredRows.length
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
};
