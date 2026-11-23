'use strict';

/**
 * Canonical referring-organization list for referrals and any other school UI
 * that needs the same organization picker (read from this module only).
 */
const SCHOOL_REFERRING_ORGANIZATIONS = Object.freeze([
  { id: 'CBI', label: 'CBI' },
  { id: 'LIFEMARK', label: 'Lifemark' },
  { id: 'MILLARD_HEALTH', label: 'Millard Health' },
  { id: 'VERITUS', label: 'Veritus' },
  { id: 'WORK_SAFE_BC', label: 'Work Safe BC' },
  { id: 'WCB_ALBERTA', label: 'WCB Alberta' }
]);

const ORGANIZATION_BY_ID = new Map(
  SCHOOL_REFERRING_ORGANIZATIONS.map((row) => [String(row.id), row])
);

function listSchoolReferringOrganizationOptions() {
  return SCHOOL_REFERRING_ORGANIZATIONS.map((row) => ({ id: row.id, label: row.label }));
}

function isSchoolReferringOrganizationId(value) {
  const id = String(value || '').trim();
  return id.length > 0 && ORGANIZATION_BY_ID.has(id);
}

function sanitizeSchoolReferringOrganizationIds(raw) {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const out = [];
  list.forEach((entry) => {
    const id = String(entry || '').trim();
    if (!isSchoolReferringOrganizationId(id) || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function resolveSchoolReferringOrganizationLabel(id) {
  const key = String(id || '').trim();
  if (!key) return '';
  return String(ORGANIZATION_BY_ID.get(key)?.label || '').trim() || key;
}

function formatSchoolReferringOrganizationLabels(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => resolveSchoolReferringOrganizationLabel(id))
    .filter(Boolean)
    .join(', ');
}

module.exports = {
  SCHOOL_REFERRING_ORGANIZATIONS,
  listSchoolReferringOrganizationOptions,
  isSchoolReferringOrganizationId,
  sanitizeSchoolReferringOrganizationIds,
  resolveSchoolReferringOrganizationLabel,
  formatSchoolReferringOrganizationLabels
};