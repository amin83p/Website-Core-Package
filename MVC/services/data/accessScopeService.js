const userRepository = require('../../repositories/userRepository');
const personRepository = require('../../repositories/personRepository');
const organizationRepository = require('../../repositories/organizationRepository');
const contractRepository = require('../../repositories/contractRepository');
const sectionRepository = require('../../repositories/sectionRepository');
const operationRepository = require('../../repositories/operationRepository');
const scopeRepository = require('../../repositories/scopeRepository');
const accessRepository = require('../../repositories/accessRepository');
const accessPolicyRepository = require('../../repositories/accessPolicyRepository');
const tableSettingsRepository = require('../../repositories/tableSettingsRepository');
const logRepository = require('../../repositories/logRepository');
const actionStateRepository = require('../../repositories/actionStateRepository');
const orgPolicyRepository = require('../../repositories/orgPolicyRepository');
const symbolRepository = require('../../repositories/symbolRepository');
const sessionRepository = require('../../repositories/sessionRepository');
const newsRepository = require('../../repositories/newsRepository');
const contactRepository = require('../../repositories/contactRepository');
const newsletterRepository = require('../../repositories/newsletterRepository');
const subscriptionGroupRepository = require('../../repositories/subscriptionGroupRepository');
const userMembershipRepository = require('../../repositories/userMembershipRepository');
const { toIdArray } = require('../../utils/idAdapter');
const {
  buildPersonScope,
  buildOrganizationScope,
  buildSectionScope,
  buildAccessScope,
  buildAccessPolicyScope,
  buildTableSettingsScope,
  buildOrgPolicyScope,
  buildSymbolScope,
  buildSessionScope,
  buildContactScope,
  buildNewsletterScope,
  buildSubscriptionGroupScope,
  buildNewsScope,
  buildUserMembershipScope
} = require('../security/dataScopeBuilder');

const accessScopeService = {
  async getAccessibleUsers() {
    return await userRepository.list({ scope: { canViewAll: true } });
  },

  async getAccessiblePersons(requestingUser) {
    return await personRepository.list({
      scope: buildPersonScope(requestingUser),
      enrichment: { includeSchoolRoles: false }
    });
  },

  async getAccessiblePersonsByIds(requestingUser, personIds) {
    if (!personIds || personIds.length === 0) return [];
    return await personRepository.list({
      query: { id__in: toIdArray(personIds) },
      scope: buildPersonScope(requestingUser),
      enrichment: { includeSchoolRoles: false }
    });
  },

  async getAccessibleOrganizations(requestingUser) {
    return await organizationRepository.list({ scope: buildOrganizationScope(requestingUser) });
  },

  async getAccessibleContracts() {
    return await contractRepository.list({ scope: { canViewAll: true } });
  },

  async getAccessibleOperations() {
    return await operationRepository.list({ scope: { canViewAll: true } });
  },

  async getAccessibleScopes() {
    return await scopeRepository.list({ scope: { canViewAll: true } });
  },

  async getAccessibleAccesses(requestingUser) {
    return await accessRepository.list({ scope: buildAccessScope(requestingUser) });
  },

  async getAccessibleSections(requestingUser) {
    return await sectionRepository.list({ scope: buildSectionScope(requestingUser) });
  },

  async getAccessiblePolicies(requestingUser) {
    return await accessPolicyRepository.list({ scope: buildAccessPolicyScope(requestingUser) });
  },

  async getAccessibleTableSettings(requestingUser) {
    return await tableSettingsRepository.list({ scope: buildTableSettingsScope(requestingUser) });
  },

  async getAccessibleLogs(_requestingUser, filters = {}) {
    if (filters && Object.keys(filters).length > 0) return await logRepository.getReport(filters);
    return await logRepository.list({ scope: { canViewAll: true } });
  },

  async getAccessibleActionStates() {
    return await actionStateRepository.list({ scope: { canViewAll: true } });
  },

  async getAccessibleOrgPolicies(requestingUser) {
    return await orgPolicyRepository.list({ scope: buildOrgPolicyScope(requestingUser) });
  },

  async getAccessibleSymbols(requestingUser) {
    return await symbolRepository.list({ scope: buildSymbolScope(requestingUser) });
  },

  async getAccessibleSessions(requestingUser) {
    return await sessionRepository.list({ scope: buildSessionScope(requestingUser) });
  },

  async getAccessibleNews(requestingUser) {
    return await newsRepository.list({ scope: buildNewsScope(requestingUser) });
  },

  async getAccessibleContactMessages(requestingUser) {
    return await contactRepository.list({ scope: buildContactScope(requestingUser) });
  },

  async getAccessibleNewsletterSubscribers(requestingUser) {
    return await newsletterRepository.list({ scope: buildNewsletterScope(requestingUser) });
  },

  async getAccessibleSubscriptionGroups(requestingUser) {
    return await subscriptionGroupRepository.list({ scope: buildSubscriptionGroupScope(requestingUser) });
  },

  async getAccessibleUserMemberships(requestingUser) {
    return await userMembershipRepository.list({ scope: buildUserMembershipScope(requestingUser) });
  }
};

module.exports = accessScopeService;
