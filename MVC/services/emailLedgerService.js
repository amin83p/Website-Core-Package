const emailLedgerRepository = require('../repositories/emailLedgerRepository');
const adminChekersService = require('./adminChekersService');
const settingService = require('./settingService');
const startupLogger = require('../utils/startupLogger');
const { toPublicId, toIdArray, idsEqual } = require('../utils/idAdapter');

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeKeyToken(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toUpperCase();
}

function normalizePositiveInteger(value, { fallback = 20, min = 1, max = 200 } = {}) {
  const numeric = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function resolveDefaultPageSize() {
  const configured = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

function createPagination(totalItems, page, limit) {
  const safeTotal = Math.max(0, Number(totalItems || 0));
  const safeLimit = Math.max(1, Number(limit || 20));
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page || 1)), totalPages);
  const startItem = safeTotal === 0 ? 0 : ((currentPage - 1) * safeLimit) + 1;
  const endItem = safeTotal === 0 ? 0 : Math.min(safeTotal, currentPage * safeLimit);
  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem,
    endItem
  };
}

function ensureOrgAdmin(requestingUser = null) {
  if (!adminChekersService.isOrgAdmin(requestingUser)) {
    throw new Error('Access denied. Organization admin access is required.');
  }
}

function buildScope(requestingUser = null) {
  if (adminChekersService.isSuperAdmin(requestingUser)) return { canViewAll: true };
  const activeOrgId = toPublicId(requestingUser?.activeOrgId || '');
  if (!activeOrgId) return { canViewAll: false, orgIds: [] };
  return { canViewAll: false, orgIds: [activeOrgId] };
}

function buildCreator(actor = {}, orgId = '') {
  const source = actor && typeof actor === 'object' ? actor : {};
  const userId = toPublicId(source.userId || source.id || '');
  if (!userId) {
    return {
      type: 'system',
      userId: '',
      username: '',
      displayName: cleanString(source.displayName || source.name, { max: 180, allowEmpty: true }) || 'System',
      email: cleanString(source.email, { max: 220, allowEmpty: true }) || '',
      orgId: toPublicId(orgId || source.orgId || '') || ''
    };
  }
  return {
    type: 'user',
    userId,
    username: cleanString(source.username, { max: 120, allowEmpty: true }) || '',
    displayName: cleanString(source.displayName || source.name, { max: 180, allowEmpty: true }) || userId,
    email: cleanString(source.email, { max: 220, allowEmpty: true }) || '',
    orgId: toPublicId(orgId || source.orgId || '') || ''
  };
}

function mapLedgerRowForView(row = {}) {
  const toRows = Array.isArray(row?.envelope?.to) ? row.envelope.to : [];
  return {
    ...row,
    recipientsCount: toRows.length,
    recipientsPreview: toRows.slice(0, 3).join(', '),
    sender: cleanString(row?.envelope?.from, { max: 320, allowEmpty: true }) || '',
    subject: cleanString(row?.content?.subject, { max: 260, allowEmpty: true }) || '',
    dateTime: cleanString(row?.dateTime || row?.createdAt, { max: 40, allowEmpty: true }) || ''
  };
}

function normalizeListQuery(raw = {}, requestingUser = null) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const limit = normalizePositiveInteger(source.limit, {
    fallback: resolveDefaultPageSize(),
    min: 5,
    max: 200
  });
  const page = normalizePositiveInteger(source.page, { fallback: 1, min: 1, max: 100000 });
  const query = {
    page,
    limit,
    q: cleanString(source.q, { max: 200, allowEmpty: true }) || '',
    sort: cleanString(source.sort, { max: 80, allowEmpty: true }) || 'dateTime',
    order: cleanString(source.order, { max: 20, allowEmpty: true }) || 'desc',
    startDate: cleanString(source.startDate, { max: 20, allowEmpty: true }) || '',
    endDate: cleanString(source.endDate, { max: 20, allowEmpty: true }) || ''
  };

  const status = cleanString(source.status__eq || source.status, { max: 40, allowEmpty: true }).toLowerCase();
  if (status) query.status__eq = status;

  const eventKey = normalizeKeyToken(source.eventKey__eq || source.eventKey || '');
  if (eventKey) query.eventKey__eq = eventKey;

  const sectionId = normalizeKeyToken(source.sectionId__eq || source.sectionId || '');
  if (sectionId) query.sectionId__eq = sectionId;

  const operationId = normalizeKeyToken(source.operationId__eq || source.operationId || '');
  if (operationId) query.operationId__eq = operationId;

  const provider = cleanString(source.provider__eq || source.provider, { max: 80, allowEmpty: true }).toLowerCase();
  if (provider) query.provider__eq = provider;

  const scope = buildScope(requestingUser);
  if (scope.canViewAll && source.orgId__eq) {
    const orgId = toPublicId(source.orgId__eq);
    if (orgId) query.orgId__eq = orgId;
  }

  return query;
}

const emailLedgerService = {
  async listEntries(rawQuery = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const scope = buildScope(requestingUser);
    const query = normalizeListQuery(rawQuery, requestingUser);
    const countQuery = { ...query };
    delete countQuery.page;
    delete countQuery.limit;
    const [rows, total] = await Promise.all([
      emailLedgerRepository.list({
        scope,
        query
      }),
      emailLedgerRepository.count({
        scope,
        query: countQuery
      })
    ]);
    const mappedRows = (Array.isArray(rows) ? rows : []).map((row) => mapLedgerRowForView(row));
    return {
      rows: mappedRows,
      totalRows: Number(total || 0),
      pagination: createPagination(Number(total || 0), query.page, query.limit)
    };
  },

  async getEntryById(id, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const entry = await emailLedgerRepository.getById(id);
    if (!entry) return null;
    const scope = buildScope(requestingUser);
    if (scope?.canViewAll !== true) {
      const orgIds = toIdArray(scope?.orgIds || []);
      if (!orgIds.some((orgId) => idsEqual(orgId, entry?.orgId))) return null;
    }
    return mapLedgerRowForView(entry);
  },

  async recordOutboundEmail(payload = {}) {
    const meta = payload && typeof payload === 'object' ? payload : {};
    const orgId = toPublicId(meta.orgId || meta?.context?.orgId || '') || 'SYSTEM';

    const toRows = Array.isArray(meta.to)
      ? meta.to.map((item) => cleanString(item, { max: 320, allowEmpty: true })).filter(Boolean)
      : (cleanString(meta.to, { max: 320, allowEmpty: true }) ? [cleanString(meta.to, { max: 320, allowEmpty: true })] : []);

    const row = {
      orgId,
      sectionId: normalizeKeyToken(meta.sectionId || meta?.context?.sectionId || ''),
      operationId: normalizeKeyToken(meta.operationId || meta?.context?.operationId || ''),
      eventKey: normalizeKeyToken(meta.eventKey || meta?.context?.eventKey || ''),
      status: cleanString(meta.status, { max: 40, allowEmpty: true }).toLowerCase() || 'accepted',
      provider: cleanString(meta.provider, { max: 80, allowEmpty: true }).toLowerCase() || 'resend',
      errorMessage: cleanString(meta.errorMessage, { max: 5000, allowEmpty: true }) || '',
      envelope: {
        from: cleanString(meta.from, { max: 320, allowEmpty: true }) || '',
        to: toRows,
        replyTo: cleanString(meta.replyTo, { max: 320, allowEmpty: true }) || ''
      },
      content: {
        subject: cleanString(meta.subject, { max: 260, allowEmpty: true }) || '',
        text: cleanString(meta.text, { max: 100000, allowEmpty: true }) || '',
        html: cleanString(meta.html, { max: 200000, allowEmpty: true }) || ''
      },
      providerMeta: {
        statusCode: Number(meta.providerStatusCode || 0) || 0,
        messageId: cleanString(meta.providerMessageId, { max: 240, allowEmpty: true }) || '',
        raw: meta.providerRaw && typeof meta.providerRaw === 'object' ? meta.providerRaw : {}
      },
      meta: meta.meta && typeof meta.meta === 'object' ? meta.meta : {},
      creator: buildCreator(meta.actor || {}, orgId),
      dateTime: cleanString(meta.dateTime, { max: 40, allowEmpty: true }) || new Date().toISOString()
    };

    try {
      return await emailLedgerRepository.create(row);
    } catch (error) {
      startupLogger.error('EMAIL_LEDGER', 'WRITE', 'Failed to persist outbound email ledger entry.', {
        status: row.status,
        orgId: row.orgId,
        sectionId: row.sectionId,
        operationId: row.operationId,
        eventKey: row.eventKey,
        error: error?.message || String(error)
      });
      return null;
    }
  }
};

module.exports = emailLedgerService;

