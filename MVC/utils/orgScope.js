const { idsEqual, toPublicId } = require('./idAdapter');

const SYSTEM_ORG_ID = 'SYSTEM';

function resolveActiveOrgId(user) {
  const raw = toPublicId(user?.activeOrgId) || SYSTEM_ORG_ID;
  return String(raw).trim() || SYSTEM_ORG_ID;
}

function normalizeRecordOrgId(value) {
  const raw = toPublicId(value) || SYSTEM_ORG_ID;
  return String(raw).trim() || SYSTEM_ORG_ID;
}

function canAccessOrgRecord(recordOrgId, activeOrgId) {
  const scopedOrgId = resolveActiveOrgId({ activeOrgId });
  if (String(scopedOrgId).toUpperCase() === SYSTEM_ORG_ID) return true;
  const targetOrgId = normalizeRecordOrgId(recordOrgId);
  return String(targetOrgId).toUpperCase() === SYSTEM_ORG_ID || idsEqual(targetOrgId, scopedOrgId);
}

function filterRowsByOrg(rows, activeOrgId) {
  const list = Array.isArray(rows) ? rows : [];
  const scopedOrgId = resolveActiveOrgId({ activeOrgId });
  return list.filter((row) => canAccessOrgRecord(row?.orgId, scopedOrgId));
}

function assignPayloadOrgId(payload, activeOrgId, fallbackOrgId = null) {
  const scopedOrgId = resolveActiveOrgId({ activeOrgId });
  const fallback = fallbackOrgId ? normalizeRecordOrgId(fallbackOrgId) : null;
  return {
    ...(payload || {}),
    orgId: fallback || scopedOrgId
  };
}

module.exports = {
  SYSTEM_ORG_ID,
  resolveActiveOrgId,
  normalizeRecordOrgId,
  canAccessOrgRecord,
  filterRowsByOrg,
  assignPayloadOrgId
};
