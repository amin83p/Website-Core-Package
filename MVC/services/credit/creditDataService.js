const customerRepository = require('../../repositories/credit/customerRepository');
const adminChekersService = require('../adminChekersService');
const dataService = require('../dataService');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');

function getScopedActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId) || null;
}

function isSystemScopedSuperAdmin(requestingUser) {
  if (!requestingUser) return false;
  if (!adminChekersService.isSuperAdmin(requestingUser)) return false;
  return String(getScopedActiveOrgId(requestingUser) || '').toUpperCase() === 'SYSTEM';
}

function assertActiveOrg(requestingUser) {
  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) {
    throw new Error('No active organization context found.');
  }
  return activeOrgId;
}

function isRecordAccessible(record, requestingUser) {
  if (!record || !requestingUser) return false;
  if (isSystemScopedSuperAdmin(requestingUser)) return true;
  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) return false;
  return idsEqual(record.orgId, activeOrgId);
}

const creditDataService = {
  listCustomers: async (query, requestingUser) => {
    const activeOrgId = assertActiveOrg(requestingUser);
    return await customerRepository.list({
      query: query || {},
      scope: isSystemScopedSuperAdmin(requestingUser)
        ? { canViewAll: true, activeOrgId }
        : { canViewAll: false, activeOrgId }
    });
  },

  getCustomerById: async (id, requestingUser) => {
    assertActiveOrg(requestingUser);
    const item = await customerRepository.getById(id);
    if (!item) return null;
    if (!isRecordAccessible(item, requestingUser)) return null;
    return item;
  },

  createCustomer: async (payload, requestingUser) => {
    const activeOrgId = assertActiveOrg(requestingUser);
    return await customerRepository.create({
      ...payload,
      orgId: activeOrgId
    });
  },

  updateCustomer: async (id, payload, requestingUser) => {
    const existing = await creditDataService.getCustomerById(id, requestingUser);
    if (!existing) throw new Error('Customer not found or inaccessible.');
    return await customerRepository.update(id, {
      ...payload,
      orgId: existing.orgId
    });
  },

  deleteCustomer: async (id, requestingUser) => {
    const existing = await creditDataService.getCustomerById(id, requestingUser);
    if (!existing) throw new Error('Customer not found or inaccessible.');
    return await customerRepository.remove(id);
  },

  listPersonsForDirectory: async (query, requestingUser) => {
    const rows = await dataService.fetchData('persons', query || {}, requestingUser);
    return Array.isArray(rows) ? rows : [];
  }
};

module.exports = creditDataService;
