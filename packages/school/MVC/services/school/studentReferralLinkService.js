'use strict';

const studentModel = require('../../models/school/studentModel');
const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  isSchoolReferringOrganizationId,
  resolveSchoolReferringOrganizationLabel,
  listSchoolReferringOrganizationOptions
} = require('../../../config/schoolReferringOrganizations');

function readReferralOrganizationIds(row) {
  if (Array.isArray(row?.organizationIds) && row.organizationIds.length) return row.organizationIds;
  return Array.isArray(row?.funderIds) ? row.funderIds : [];
}

function sanitizeReferralOrgIdsForReferral(row) {
  return readReferralOrganizationIds(row)
    .map((id) => String(id || '').trim())
    .filter((id) => isSchoolReferringOrganizationId(id));
}

async function loadReferralMaps(reqUser, options = {}) {
  const referrals = await schoolDataService.fetchAllData('referrals', {}, reqUser, options);
  const referralById = new Map();
  (Array.isArray(referrals) ? referrals : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (id) referralById.set(id, row);
  });
  return { referralById, referrals };
}

async function loadProgramMaps(reqUser, options = {}) {
  const programs = await schoolDataService.fetchAllData('programs', {}, reqUser, options);
  const programById = new Map();
  (Array.isArray(programs) ? programs : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (id) programById.set(id, row);
  });
  return { programById, programs };
}

async function validateAndNormalizeReferralLinks(rawLinks, { reqUser, options = {} } = {}) {
  const links = studentModel.cleanReferralLinks(rawLinks);
  const { referralById } = await loadReferralMaps(reqUser, options);
  const { programById } = await loadProgramMaps(reqUser, options);

  return links.map((row, index) => {
    const referral = referralById.get(toPublicId(row.referralId));
    if (!referral) {
      throw new Error(`Referral link entry ${index + 1}: referral not found.`);
    }
    if (String(referral.status || 'Active').trim() !== 'Active') {
      throw new Error(`Referral link entry ${index + 1}: referral is not active.`);
    }
    const orgIds = sanitizeReferralOrgIdsForReferral(referral);
    if (!orgIds.length) {
      throw new Error(`Referral link entry ${index + 1}: referral has no organizations; update the referral contact first.`);
    }
    let organizationId = String(row.organizationId || '').trim();
    if (orgIds.length === 1) {
      organizationId = orgIds[0];
    } else if (!organizationId || !orgIds.some((id) => idsEqual(id, organizationId))) {
      throw new Error(`Referral link entry ${index + 1}: select an organization for this referral.`);
    }
    const program = programById.get(toPublicId(row.programId));
    if (!program) {
      throw new Error(`Referral link entry ${index + 1}: program not found.`);
    }
    return {
      ...row,
      organizationId
    };
  });
}

async function enrichReferralLinksForApi(links, { reqUser, options = {} } = {}) {
  const cleaned = studentModel.cleanReferralLinks(links);
  const { referralById } = await loadReferralMaps(reqUser, options);
  const { programById } = await loadProgramMaps(reqUser, options);
  const personIds = [];
  cleaned.forEach((row) => {
    const referral = referralById.get(toPublicId(row.referralId));
    if (referral?.personId) personIds.push(referral.personId);
  });
  const personById = await schoolPersonAccessService.buildPersonByIdMap({ reqUser, personIds });

  return cleaned.map((row) => {
    const referral = referralById.get(toPublicId(row.referralId));
    const program = programById.get(toPublicId(row.programId));
    const person = referral ? personById.get(toPublicId(referral.personId)) : null;
    const referralLabel = referral
      ? (schoolPersonAccessService.formatPersonName(person, '') || String(referral.id || '').trim())
      : String(row.referralId || '').trim();
    const programLabel = String(program?.name || program?.programCode || row.programId || '').trim();
    const organizationLabel = resolveSchoolReferringOrganizationLabel(row.organizationId);
    return {
      ...row,
      referralLabel,
      organizationLabel,
      programLabel
    };
  });
}

async function buildReferralLinkPickerOptions(reqUser, activeOrgId, options = {}) {
  const orgId = toPublicId(activeOrgId);
  const { referrals } = await loadReferralMaps(reqUser, options);
  const { programs } = await loadProgramMaps(reqUser, options);
  const visibleReferrals = (Array.isArray(referrals) ? referrals : []).filter((row) => {
    if (String(row?.status || 'Active').trim() !== 'Active') return false;
    if (orgId && String(row.orgId || '').trim() && !idsEqual(row.orgId, orgId)) return false;
    return true;
  });
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: visibleReferrals.map((row) => row.personId)
  });
  const orgCatalog = listSchoolReferringOrganizationOptions();
  const orgOptionById = new Map(orgCatalog.map((row) => [String(row.id), row]));

  const referralOptions = visibleReferrals.map((row) => {
    const id = String(row.id || '').trim();
    const person = personById.get(toPublicId(row.personId));
    const label = schoolPersonAccessService.formatPersonName(person, '') || id;
    const organizationIds = sanitizeReferralOrgIdsForReferral(row);
    const organizationOptions = organizationIds
      .map((oid) => orgOptionById.get(String(oid)) || { id: oid, label: resolveSchoolReferringOrganizationLabel(oid) });
    return {
      id,
      label,
      organizationIds,
      organizationOptions
    };
  }).sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const programOptions = (Array.isArray(programs) ? programs : [])
    .filter((row) => {
      if (String(row?.status || 'Active').trim() === 'Archived') return false;
      if (orgId && String(row.orgId || '').trim() && !idsEqual(row.orgId, orgId)) return false;
      return true;
    })
    .map((row) => ({
      id: String(row.id || '').trim(),
      label: String(row.name || row.programCode || row.id || '').trim()
    }))
    .filter((row) => row.id)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const referringOrganizations = listSchoolReferringOrganizationOptions();

  return {
    referrals: referralOptions,
    programs: programOptions,
    referringOrganizations
  };
}

async function buildReferralPickerOptionFromRecord(row, reqUser, options = {}) {
  if (!row || !row.id) return null;
  const orgCatalog = listSchoolReferringOrganizationOptions();
  const orgOptionById = new Map(orgCatalog.map((entry) => [String(entry.id), entry]));
  const person = row.personId
    ? await schoolPersonAccessService.getPersonById({ reqUser, personId: row.personId, requireSchoolRole: false })
    : null;
  const label = schoolPersonAccessService.formatPersonName(person, '') || String(row.id || '').trim();
  const organizationIds = sanitizeReferralOrgIdsForReferral(row);
  const organizationOptions = organizationIds
    .map((oid) => orgOptionById.get(String(oid)) || { id: oid, label: resolveSchoolReferringOrganizationLabel(oid) });
  return {
    id: String(row.id || '').trim(),
    label,
    organizationIds,
    organizationOptions,
    status: String(row.status || 'Active').trim()
  };
}

module.exports = {
  readReferralOrganizationIds,
  validateAndNormalizeReferralLinks,
  enrichReferralLinksForApi,
  buildReferralLinkPickerOptions,
  buildReferralPickerOptionFromRecord,
  sanitizeReferralOrgIdsForReferral
};