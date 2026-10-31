const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { allocateWithRetry } = require('./schoolEntityIdAllocationService');

const REPORT_TEMPLATE_KIND = 'rpt';
const OVERALL_REPORT_TEMPLATE_KIND = 'ovr';

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatOrgKindTemplateId(orgId, kind, seq) {
  const orgToken = toPublicId(orgId);
  const kindToken = String(kind || '').trim().toLowerCase();
  if (!orgToken) throw new Error('orgId is required to allocate a template id.');
  if (!kindToken) throw new Error('Template id kind is required.');
  const n = Number(seq);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error('Template sequence must be a positive integer.');
  }
  return `${orgToken}-${kindToken}-${n}`;
}

function parseOrgKindSeq(id, orgId, kind) {
  const orgToken = toPublicId(orgId);
  const kindToken = String(kind || '').trim().toLowerCase();
  const token = String(id || '').trim();
  if (!orgToken || !kindToken || !token) return 0;
  const prefix = `${orgToken}-${kindToken}-`;
  if (!token.startsWith(prefix)) return 0;
  const suffix = token.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return 0;
  const n = Number.parseInt(suffix, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function maxSeqFromIdSet(ids = [], orgId = '', kind = '') {
  const orgToken = toPublicId(orgId);
  if (!orgToken) return 0;
  let maxSeq = 0;
  (Array.isArray(ids) ? ids : []).forEach((rawId) => {
    const id = String(rawId || '').trim();
    if (!id) return;
    const scoped = parseOrgKindSeq(id, orgToken, kind);
    if (scoped > maxSeq) maxSeq = scoped;
    if (/^\d+$/.test(id)) {
      const legacy = Number.parseInt(id, 10);
      if (Number.isFinite(legacy) && legacy > maxSeq) maxSeq = legacy;
    }
  });
  return maxSeq;
}

async function maxSeqFromMongoCollection(collection, orgId, kind) {
  const orgToken = toPublicId(orgId);
  const kindToken = String(kind || '').trim().toLowerCase();
  if (!collection || !orgToken || !kindToken) return 0;
  const scopedPattern = new RegExp(`^${escapeRegExp(orgToken)}-${escapeRegExp(kindToken)}-(\\d+)$`);
  const rows = await collection.find(
    { orgId: orgToken },
    { projection: { id: 1 } }
  ).toArray();
  let maxSeq = 0;
  rows.forEach((row) => {
    const id = String(row?.id || '').trim();
    if (!id) return;
    const scopedMatch = id.match(scopedPattern);
    if (scopedMatch) {
      const n = Number.parseInt(scopedMatch[1], 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      return;
    }
    if (/^\d+$/.test(id)) {
      const legacy = Number.parseInt(id, 10);
      if (Number.isFinite(legacy) && legacy > maxSeq) maxSeq = legacy;
    }
  });
  return maxSeq;
}

async function allocateNextOrgKindTemplateId(orgId, kind, options = {}) {
  const orgToken = toPublicId(orgId);
  const kindToken = String(kind || '').trim().toLowerCase();
  if (!orgToken) throw new Error('orgId is required to allocate a template id.');

  let maxSeq = 0;
  if (options.collection) {
    maxSeq = await maxSeqFromMongoCollection(options.collection, orgToken, kindToken);
  } else if (options.existingIds instanceof Set) {
    maxSeq = maxSeqFromIdSet([...options.existingIds], orgToken, kindToken);
  } else if (Array.isArray(options.existingIds)) {
    maxSeq = maxSeqFromIdSet(options.existingIds, orgToken, kindToken);
  } else if (Array.isArray(options.templatesForOrg)) {
    maxSeq = maxSeqFromIdSet(
      options.templatesForOrg.map((row) => row?.id),
      orgToken,
      kindToken
    );
  }

  const reserved = options.reservedIds instanceof Set
    ? options.reservedIds
    : new Set(Array.isArray(options.reservedIds) ? options.reservedIds : []);

  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: reserved,
    reservedIds: null,
    maxAttempts: options.maxAttempts || 1000,
    generateCandidate: (attempt) => formatOrgKindTemplateId(orgToken, kindToken, maxSeq + 1 + attempt)
  });
}

function allocateNextReportTemplateId(orgId, options = {}) {
  return allocateNextOrgKindTemplateId(orgId, REPORT_TEMPLATE_KIND, options);
}

function allocateNextOverallReportTemplateId(orgId, options = {}) {
  return allocateNextOrgKindTemplateId(orgId, OVERALL_REPORT_TEMPLATE_KIND, options);
}

module.exports = {
  REPORT_TEMPLATE_KIND,
  OVERALL_REPORT_TEMPLATE_KIND,
  formatOrgKindTemplateId,
  parseOrgKindSeq,
  maxSeqFromIdSet,
  allocateNextReportTemplateId,
  allocateNextOverallReportTemplateId
};
