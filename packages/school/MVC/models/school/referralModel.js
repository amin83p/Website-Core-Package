'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const roleEntityIdService = require('../../services/school/roleEntityIdService');
const { resolveSchoolCreateId } = require('../../services/school/schoolEntityIdAllocationService');
const {
  sanitizeSchoolReferringOrganizationIds
} = require('../../../config/schoolReferringOrganizations');

const dataPath = path.join(resolveCoreRoot(), 'data/school/referrals.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const REFERRAL_STATUSES = new Set(['Active', 'Archived']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function sanitizeReferralInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid referral payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const personId = cleanId(input.personId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!personId) throw new Error('personId is required.');

  const status = cleanString(input.status, { max: 40, allowEmpty: true }) || 'Active';
  if (!REFERRAL_STATUSES.has(status)) throw new Error('Invalid referral status.');

  const out = {
    orgId: String(orgId),
    personId: String(personId),
    status,
    notes: cleanString(input.notes, { max: 5000, allowEmpty: true }),
    organizationIds: sanitizeSchoolReferringOrganizationIds(
      input.organizationIds !== undefined ? input.organizationIds : input.funderIds
    )
  };

  if (!isUpdate && input.id) out.id = cleanId(input.id, { max: 50, allowEmpty: false });
  return out;
}

async function getAllReferrals() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve referrals');
  }
}

async function getReferralById(id) {
  const all = await getAllReferrals();
  return all.find((row) => String(row.id) === String(id)) || null;
}

async function addReferral(data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllReferrals();
    const sanitized = sanitizeReferralInput(data, { isUpdate: false });

    if (all.some((row) => String(row.orgId) === String(sanitized.orgId) && String(row.personId) === String(sanitized.personId))) {
      throw new Error('This person is already registered as a referral contact.');
    }

    const existingIds = new Set(all.map((row) => String(row.id)));
    const finalId = await resolveSchoolCreateId({
      requestedId: sanitized.id,
      reservedIds: existingIds,
      allocateNext: () => roleEntityIdService.allocateUniqueReferralSystemId({
        existingIds,
        reservedIds: existingIds
      })
    });

    const record = {
      ...sanitized,
      id: finalId,
      audit: { createDateTime: new Date().toISOString() }
    };

    all.push(record);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return record;
  });
}

async function updateReferral(id, data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllReferrals();
    const index = all.findIndex((row) => String(row.id) === String(id));
    if (index === -1) throw new Error('Referral not found');

    const existing = all[index];
    const sanitized = sanitizeReferralInput(
      {
        ...data,
        orgId: existing.orgId || data?.orgId,
        personId: existing.personId || data?.personId
      },
      { isUpdate: true }
    );

    if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
      throw new Error('Security Violation: orgId mismatch.');
    }
    if (existing.personId && String(existing.personId) !== String(sanitized.personId)) {
      throw new Error('Security Violation: personId mismatch.');
    }

    delete sanitized.id;
    sanitized.orgId = existing.orgId || sanitized.orgId;
    sanitized.personId = existing.personId || sanitized.personId;

    all[index] = {
      ...existing,
      ...sanitized,
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteReferral(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllReferrals();
    const next = all.filter((row) => String(row.id) !== String(id));
    if (next.length === all.length) throw new Error('Referral not found.');
    await fs.writeFile(dataPath, JSON.stringify(next, null, 2));
    return true;
  });
}

module.exports = {
  REFERRAL_STATUSES,
  sanitizeReferralInput,
  getAllReferrals,
  getReferralById,
  addReferral,
  updateReferral,
  deleteReferral
};