const userRepository = require('../../repositories/userRepository');
const personRepository = require('../../repositories/personRepository');
const actionStateRepository = require('../../repositories/actionStateRepository');
const websitePolicyRepository = require('../../repositories/websitePolicyRepository');
const symbolRepository = require('../../repositories/symbolRepository');
const newsRepository = require('../../repositories/newsRepository');
const contactRepository = require('../../repositories/contactRepository');
const contractRepository = require('../../repositories/contractRepository');
const logRepository = require('../../repositories/logRepository');
const entityGatewayService = require('./entityGatewayService');
const adminChekersService = require('../adminChekersService');
const { normalizeOrgRoles, getPrimaryOrgRole } = require('../../utils/orgContextUtils');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');

function normalizeIdList(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = toPublicId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function normalizeManagedAccessProfiles(values = []) {
  const rows = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const profileId = toPublicId(row.profileId || row.id || row.accessProfileId || '');
    if (!profileId) return;
    const sourceType = String(row.sourceType || row.type || row.originType || 'external').trim().toLowerCase() || 'external';
    const sourceRefId = toPublicId(row.sourceRefId || row.sourceId || row.originId || row.refId || '');
    const sourceLabel = String(row.sourceLabel || row.label || row.originLabel || '').trim().slice(0, 240);
    const key = `${profileId}::${sourceType}::${sourceRefId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      profileId,
      sourceType,
      sourceRefId,
      sourceLabel,
      locked: true,
      createdAt: String(row.createdAt || row.createDateTime || '').trim() || new Date().toISOString(),
      createdBy: String(row.createdBy || row.createUser || '').trim() || 'System'
    });
  });
  return out;
}

const domainOpsService = {
  async unlinkPersonFromUser(userId, personId) {
    return await userRepository.unlinkPerson(userId, personId);
  },

  async deleteAllLogs() {
    return await logRepository.deleteAllLog();
  },

  async syncUserOrganizations(personId, requestingUser) {
    const person = await personRepository.getById(personId, {
      enrichment: { includeSchoolRoles: false }
    });
    if (!person) return;

    const linkedUser = await userRepository.getByPersonId(person.id);
    if (!linkedUser) return;

    if (adminChekersService.isSuperAdmin(linkedUser)) return;

    const personOrgs = Array.isArray(person.organizations) ? person.organizations : [];
    const oldUserOrgs = linkedUser.organizations || [];

    const newUserOrgs = personOrgs.map((pOrg) => {
      const existingUserOrg = oldUserOrgs.find((userOrg) => idsEqual(userOrg?.orgId, pOrg?.orgId));
      const roles = normalizeOrgRoles(pOrg);
      const managedAccessProfiles = normalizeManagedAccessProfiles(existingUserOrg?.managedAccessProfiles || []);
      const managedProfileIds = normalizeIdList(managedAccessProfiles.map((row) => row.profileId));
      const directAccessProfileIds = Array.isArray(existingUserOrg?.directAccessProfileIds)
        ? normalizeIdList(existingUserOrg.directAccessProfileIds)
        : normalizeIdList(existingUserOrg?.accessProfileIds || []);
      return {
        orgId: toPublicId(pOrg.orgId),
        name: pOrg.name,
        roles,
        role: getPrimaryOrgRole(pOrg),
        memberStatus: pOrg.memberStatus,
        joinedAt: pOrg.joinedAt,
        directAccessProfileIds,
        managedAccessProfiles,
        accessProfileIds: normalizeIdList([...directAccessProfileIds, ...managedProfileIds])
      };
    });

    await userRepository.update(linkedUser.id, {
      organizations: newUserOrgs,
      audit: { lastUpdateUser: requestingUser?.id || 'SYSTEM_SYNC', lastUpdateDateTime: new Date().toISOString() }
    });
  },

  async logActionStateAttempt(userId, sectionId, operationId, targetKey, limits, forceId, context = {}) {
    return await actionStateRepository.logAttempt(userId, sectionId, operationId, targetKey, limits, forceId, context);
  },

  async updateActionStateProgress(id, volumeKB, context = {}) {
    return await actionStateRepository.updateProgress(id, volumeKB, context);
  },

  async completeActionState(id, payload, volumeKB, context = {}) {
    return await actionStateRepository.completeState(id, payload, volumeKB, context);
  },

  async appendActionStateChangeEvent(id, changeEvent, context = {}) {
    return await actionStateRepository.appendChangeEvent(id, changeEvent, context);
  },

  async failActionState(id, volumeKB, context = {}) {
    return await actionStateRepository.failAttempt(id, volumeKB, context);
  },

  async recordActionStateRetryableError(id, msg, volumeKB, context = {}) {
    return await actionStateRepository.recordRetryableError(id, msg, volumeKB, context);
  },

  async cancelActionState(id) {
    return await actionStateRepository.cancelState(id);
  },

  async getActionStateEntityTimeline(entityType, entityId) {
    return await actionStateRepository.getEntityTimeline(entityType, entityId);
  },

  async getWebsitePolicy() {
    return await websitePolicyRepository.getPolicy();
  },

  async updateWebsitePolicy(updates, requestingUser) {
    return await websitePolicyRepository.updatePolicy(updates, requestingUser);
  },

  async getSymbolByLabel(label, requestingUser) {
    if (!label) return null;
    const results = await entityGatewayService.fetchData('symbols', { tags: label }, requestingUser);
    return results.length > 0 ? results[0] : null;
  },

  async OrgHasActiveContract(orgId) {
    if (!orgId) return false;
    try {
      return await contractRepository.hasActiveContractForOrg(orgId);
    } catch (error) {
      console.error(`Error checking contract for Org ${orgId}:`, error);
      return false;
    }
  },

  async getContextSymbols(requestingUser) {
    if (!requestingUser) return [];

    const activeOrgId = toPublicId(requestingUser.activeOrgId) || null;
    const scopedSymbols = await symbolRepository.list({
      scope: {
        canViewAll: false,
        includeGlobal: true,
        orgId: activeOrgId
      }
    });

    const orgSymbols = [];
    const systemSymbols = [];

    scopedSymbols.forEach((s) => {
      const symOrgId = toPublicId(s.orgId) || null;
      if (symOrgId === 'SYSTEM') {
        systemSymbols.push(s);
      } else if (activeOrgId && idsEqual(symOrgId, activeOrgId)) {
        orgSymbols.push(s);
      }
    });

    const overriddenLabels = new Set();
    orgSymbols.forEach((s) => {
      if (s.name) overriddenLabels.add(s.name.trim().toUpperCase());
      if (Array.isArray(s.tags)) {
        s.tags.forEach((t) => overriddenLabels.add(t.trim().toUpperCase()));
      }
    });

    const filteredSystemSymbols = systemSymbols.filter((s) => {
      if (Array.isArray(s.tags)) {
        const hasConflict = s.tags.some((t) => overriddenLabels.has(t.trim().toUpperCase()));
        if (hasConflict) return false;
      }
      return true;
    });

    return [...orgSymbols, ...filteredSystemSymbols];
  },

  async getPublicNewsBySlug(slug) {
    const item = await newsRepository.getNewsBySlug(slug);
    if (!item) return null;
    if (item.status !== 'published') return null;
    return item.visibility === 'public' ? item : null;
  },

  async logNewsView(newsId, user) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      userId: user ? user.id : null,
      userRole: user ? (user.role || 'user') : 'guest',
      orgId: user ? user.activeOrgId : 'public'
    };
    return await newsRepository.logView(newsId, logEntry);
  },

  async getPublicContactMessageStatus(code, email) {
    if (!code || !email) return null;

    const msg = await contactRepository.getById(String(code).trim());
    if (!msg) return null;

    const storedEmail = String(msg.email || '').toLowerCase().trim();
    const providedEmail = String(email || '').toLowerCase().trim();
    if (!storedEmail || storedEmail !== providedEmail) return null;

    return {
      id: msg.id,
      status: msg.status || 'Unread',
      receivedAt: msg.audit?.createDateTime || null,
      lastUpdatedAt: msg.audit?.lastUpdateDateTime || null,
      userNote: msg.userNote || ''
    };
  },

  async getSystemLogStats() {
    return await logRepository.getSystemLogStats();
  },

  async getSystemActionStateStats() {
    return await actionStateRepository.getSystemActionStateStats();
  }
};

module.exports = domainOpsService;
