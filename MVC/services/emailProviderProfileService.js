const adminChekersService = require('./adminChekersService');
const dataService = require('./dataService');
const emailProviderProfileRepository = require('../repositories/emailProviderProfileRepository');
const resendEmailService = require('./resendEmailService');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { resolveEmailManagementOrgContext } = require('../utils/emailTemplateOrgContext');

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function parseVerifiedDomainsInput(value = '') {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(/[,\n;]+/g)
    .map((item) => cleanString(item, { max: 253, allowEmpty: true }))
    .filter(Boolean);
}

function extractEmailDomain(email = '') {
  const token = cleanString(email, { max: 320, allowEmpty: true });
  if (!token) return '';
  const angleMatch = token.match(/<[^@]+@([^>]+)>/i);
  if (angleMatch) return cleanString(angleMatch[1], { max: 253, allowEmpty: true }).toLowerCase();
  const atIndex = token.lastIndexOf('@');
  if (atIndex < 0) return '';
  return cleanString(token.slice(atIndex + 1), { max: 253, allowEmpty: true }).toLowerCase();
}

async function getVerifiedDomainsForOrg(orgId = '', options = {}) {
  const activeOrgId = toPublicId(orgId) || '';
  if (!activeOrgId) return [];
  try {
    const profile = await emailProviderProfileRepository.getDefaultProfile(activeOrgId, {
      scope: { canViewAll: true },
      ...options
    });
    if (profile && Array.isArray(profile.verifiedDomains) && profile.verifiedDomains.length) {
      return normalizeVerifiedDomainList(profile.verifiedDomains);
    }
  } catch (_) {
    // Fall through to empty list when profile lookup fails.
  }
  return [];
}

function getPlatformVerifiedDomains() {
  const envList = cleanString(process.env.RESEND_VERIFIED_DOMAINS, { max: 4000, allowEmpty: true });
  if (envList) {
    return envList
      .split(/[,\n;]+/g)
      .map((item) => cleanString(item, { max: 253, allowEmpty: true }).toLowerCase().replace(/^@+/, ''))
      .filter(Boolean);
  }
  return [];
}

function ensureOrgAdmin(requestingUser = null) {
  if (!adminChekersService.isOrgAdmin(requestingUser)) {
    throw new Error('Access denied. Organization admin access is required.');
  }
}

function buildCreator(requestingUser = null, orgId = '') {
  const userId = toPublicId(requestingUser?.id) || '';
  return {
    type: userId ? 'user' : 'system',
    userId,
    username: cleanString(requestingUser?.username, { max: 120, allowEmpty: true }) || '',
    displayName: cleanString(requestingUser?.name, { max: 180, allowEmpty: true }) || userId || 'System',
    email: cleanString(requestingUser?.email, { max: 220, allowEmpty: true }) || '',
    orgId: toPublicId(orgId || requestingUser?.activeOrgId || '') || ''
  };
}

function buildProfileContextForSave(payload = {}, activeOrgId = '') {
  return {
    orgId: toPublicId(activeOrgId || payload?.orgId) || '',
    provider: cleanString(payload?.provider, { max: 40, allowEmpty: true }).toLowerCase() || 'resend',
    label: cleanString(payload?.label, { max: 220, allowEmpty: true }) || '',
    defaultFromEmail: cleanString(payload?.defaultFromEmail, { max: 320, allowEmpty: true }) || '',
    verifiedDomains: parseVerifiedDomainsInput(payload?.verifiedDomains),
    isActive: normalizeBoolean(payload?.isActive, true),
    isDefault: normalizeBoolean(payload?.isDefault, false),
    apiKey: cleanString(payload?.apiKey, { max: 8000, allowEmpty: true }) || ''
  };
}

function validateSenderDomain(fromEmail = '', verifiedDomains = []) {
  const domains = Array.isArray(verifiedDomains) ? verifiedDomains : [];
  if (!domains.length) return;
  const senderDomain = extractEmailDomain(fromEmail);
  if (!senderDomain) {
    throw new Error('Sender address is missing or invalid.');
  }
  const allowed = domains.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(senderDomain)) {
    throw new Error(`Sender domain '${senderDomain}' is not in the verified domains allowlist.`);
  }
}

function normalizeVerifiedDomainList(value = []) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  source.forEach((item) => {
    const domain = cleanString(item, { max: 253, allowEmpty: true }).toLowerCase().replace(/^@+/, '');
    if (!domain || seen.has(domain)) return;
    seen.add(domain);
    out.push(domain);
  });
  return out;
}

function mapProfileOptionRow(row = {}, source = 'org') {
  return {
    id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
    label: cleanString(row?.label, { max: 220, allowEmpty: true }) || cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
    verifiedDomains: normalizeVerifiedDomainList(row?.verifiedDomains),
    isDefault: row?.isDefault === true,
    isActive: row?.isActive !== false,
    source
  };
}

async function listActiveProfilesByOrgId(orgId = '', options = {}) {
  const activeOrgId = toPublicId(orgId);
  if (!activeOrgId) return [];
  const rows = await emailProviderProfileRepository.list({
    ...(options || {}),
    scope: { canViewAll: true },
    query: {
      orgId__eq: activeOrgId,
      isActive__eq: true,
      page: 1,
      limit: 5000
    },
    sort: { isDefault: -1, label: 1, id: 1 }
  });
  return Array.isArray(rows) ? rows : [];
}

function parseSenderTemplateParts(senderTemplate = '') {
  const token = cleanString(senderTemplate, { max: 320, allowEmpty: true });
  if (!token) return { localPart: '', domain: '' };
  const angleMatch = token.match(/^(.+)<[^@]+@([^>]+)>$/i);
  if (angleMatch) {
    return {
      localPart: cleanString(angleMatch[1], { max: 120, allowEmpty: true }).replace(/^["'\s]+|["'\s]+$/g, ''),
      domain: cleanString(angleMatch[2], { max: 253, allowEmpty: true }).toLowerCase()
    };
  }
  const atIndex = token.lastIndexOf('@');
  if (atIndex < 0) return { localPart: token, domain: '' };
  return {
    localPart: cleanString(token.slice(0, atIndex), { max: 120, allowEmpty: true }),
    domain: cleanString(token.slice(atIndex + 1), { max: 253, allowEmpty: true }).toLowerCase()
  };
}

function composeSenderTemplate(localPart = '', domain = '') {
  const local = cleanString(localPart, { max: 120, allowEmpty: true });
  const domainToken = cleanString(domain, { max: 253, allowEmpty: true }).toLowerCase().replace(/^@+/, '');
  if (!local && !domainToken) return '';
  if (!domainToken) return local;
  if (!local) return `noreply@${domainToken}`;
  return `${local}@${domainToken}`;
}

async function buildProviderOptionsForOrgId(activeOrgId = '') {
  const orgToken = toPublicId(activeOrgId) || '';
  let source = 'org';
  let rows = await listActiveProfilesByOrgId(orgToken);
  if (!rows.length && String(orgToken).toUpperCase() !== 'SYSTEM') {
    rows = await listActiveProfilesByOrgId('SYSTEM');
    source = rows.length ? 'system' : 'org';
  }
  return {
    orgId: orgToken,
    source,
    profiles: rows.map((row) => mapProfileOptionRow(row, source))
  };
}

const emailProviderProfileService = {
  extractEmailDomain,
  getPlatformVerifiedDomains,
  validateSenderDomain,

  async listProfiles(query = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const pagination = {
      page: Math.max(1, Number.parseInt(String(query?.page || '1'), 10) || 1),
      limit: Math.max(1, Number.parseInt(String(query?.limit || '20'), 10) || 20)
    };
    return dataService.fetchDataPaged('emailProviderProfiles', query, requestingUser, { pagination });
  },

  async getProfileById(id, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    return dataService.getDataById('emailProviderProfiles', id, requestingUser);
  },

  async createProfile(payload = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const activeOrgId = await resolveEmailManagementOrgContext(requestingUser, { scopeLabel: 'email provider profiles' });
    const normalized = buildProfileContextForSave(payload, activeOrgId);
    if (!normalized.label) throw new Error('Profile label is required.');
    if (!normalized.apiKey) throw new Error('API key is required.');

    const creator = buildCreator(requestingUser, activeOrgId);
    try {
      return await dataService.addData('emailProviderProfiles', {
        ...normalized,
        orgId: activeOrgId,
        creator
      }, requestingUser);
    } catch (error) {
      if (emailProviderProfileRepository.isUniqueConflict(error)) {
        throw new Error('A provider profile with this label already exists in this organization.');
      }
      throw error;
    }
  },

  async updateProfile(id, payload = {}, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const existing = await dataService.getDataById('emailProviderProfiles', id, requestingUser);
    if (!existing) throw new Error('Email provider profile not found.');

    const normalized = buildProfileContextForSave(
      { ...existing, ...(payload || {}) },
      existing.orgId
    );
    if (!normalized.label) throw new Error('Profile label is required.');
    if (!normalized.apiKey) delete normalized.apiKey;

    const creator = buildCreator(requestingUser, existing.orgId);
    try {
      return await dataService.updateData('emailProviderProfiles', id, {
        ...normalized,
        orgId: existing.orgId,
        creator,
        audit: {
          ...(existing.audit || {}),
          lastUpdateUser: creator.userId || 'System',
          lastUpdateDateTime: new Date().toISOString()
        }
      }, requestingUser);
    } catch (error) {
      if (emailProviderProfileRepository.isUniqueConflict(error)) {
        throw new Error('A provider profile with this label already exists in this organization.');
      }
      throw error;
    }
  },

  async deleteProfile(id, requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    return dataService.deleteData('emailProviderProfiles', id, requestingUser);
  },

  async listProviderOptionsForTemplate(requestingUser = null) {
    ensureOrgAdmin(requestingUser);
    const activeOrgId = await resolveEmailManagementOrgContext(requestingUser, { scopeLabel: 'email provider profiles' });
    return buildProviderOptionsForOrgId(activeOrgId);
  },

  async resolveSelectableProviderProfile(profileId = '', activeOrgId = '', options = {}) {
    const token = cleanString(profileId, { max: 120, allowEmpty: true });
    if (!token) return null;
    const orgId = toPublicId(activeOrgId) || '';
    const profile = await emailProviderProfileRepository.getById(token, {
      scope: { canViewAll: true },
      ...(options || {})
    });
    if (!profile || profile.isActive === false) {
      throw new Error('Email provider profile not found or inactive.');
    }
    const profileOrgId = toPublicId(profile.orgId);
    if (idsEqual(profileOrgId, orgId)) {
      return mapProfileOptionRow(profile, 'org');
    }
    if (String(orgId).toUpperCase() !== 'SYSTEM' && idsEqual(profileOrgId, 'SYSTEM')) {
      const orgProfiles = await listActiveProfilesByOrgId(orgId, options);
      if (!orgProfiles.length) {
        return mapProfileOptionRow(profile, 'system');
      }
    }
    throw new Error('Email provider profile is not available for this organization.');
  },

  async listProfilesForPicker(query = {}, requestingUser = null) {
    const { profiles } = await this.listProviderOptionsForTemplate(requestingUser);
    return profiles.map((row) => ({
      id: row.id,
      label: row.label || row.id,
      name: row.label || row.id,
      provider: 'resend',
      defaultFromEmail: '',
      verifiedDomains: Array.isArray(row.verifiedDomains) ? row.verifiedDomains : [],
      isDefault: row.isDefault === true,
      isActive: row.isActive !== false
    }));
  },

  async resolveProviderCredentials(orgId = '', profileId = '', options = {}) {
    const activeOrgId = toPublicId(orgId) || '';
    let profile = null;

    if (profileId) {
      profile = await emailProviderProfileRepository.getById(profileId, {
        scope: { canViewAll: true },
        ...options
      });
      if (!profile) throw new Error('Email provider profile not found.');
      if (activeOrgId && !idsEqual(profile.orgId, activeOrgId)) {
        throw new Error('Email provider profile does not belong to this organization.');
      }
      if (profile.isActive === false) {
        throw new Error('Email provider profile is not active.');
      }
    } else if (activeOrgId) {
      profile = await emailProviderProfileRepository.getDefaultProfile(activeOrgId, {
        scope: { canViewAll: true },
        ...options
      });
    }

    if (profile) {
      const apiKey = await emailProviderProfileRepository.getDecryptedApiKeyById(profile.id, {
        scope: { canViewAll: true },
        ...options
      });
      if (!apiKey) throw new Error('Email provider profile is missing an API key.');
      return {
        provider: profile.provider || 'resend',
        providerProfileId: profile.id,
        apiKey,
        fromEmail: cleanString(profile.defaultFromEmail, { max: 320, allowEmpty: true }) || '',
        verifiedDomains: Array.isArray(profile.verifiedDomains) ? profile.verifiedDomains.slice() : [],
        source: 'org_profile'
      };
    }

    throw new Error('No default email provider profile configured for this organization.');
  },

  async getVerifiedDomainsForOrg(orgId = '', options = {}) {
    return getVerifiedDomainsForOrg(orgId, options);
  },

  __testables: Object.freeze({
    buildProfileContextForSave,
    extractEmailDomain,
    validateSenderDomain,
    getPlatformVerifiedDomains,
    parseVerifiedDomainsInput,
    mapProfileOptionRow,
    listActiveProfilesByOrgId,
    buildProviderOptionsForOrgId,
    parseSenderTemplateParts,
    composeSenderTemplate
  })
};

module.exports = emailProviderProfileService;
