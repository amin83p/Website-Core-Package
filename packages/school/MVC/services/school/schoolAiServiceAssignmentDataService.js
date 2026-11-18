'use strict';

const schoolDataService = require('./schoolDataService');
const { listAiServices } = require('../../config/schoolAiServiceRegistry');
const schoolAiProviderDataService = require('./schoolAiProviderDataService');
const {
  getActiveOrgIdOrThrow,
  idsEqual,
  cleanString,
  assertOrgRow
} = require('./schoolAiAssistCommon');

const ENTITY = 'schoolAiServiceAssignments';

async function validateProviderModel(orgId, providerRecordId, modelEntryId, requestingUser, accessContext) {
  const raw = await schoolAiProviderDataService.getRawProviderById(providerRecordId);
  if (!raw) throw new Error('Selected provider key was not found.');
  assertOrgRow(raw, orgId);
  if (raw.isActive === false) throw new Error('Selected provider key is inactive.');
  const model = schoolAiProviderDataService.findModelEntry(raw, modelEntryId);
  if (!model) throw new Error('Selected model does not belong to this provider key.');
  if (model.isActive === false) throw new Error('Selected model is inactive.');
  return { provider: raw, model };
}

const schoolAiServiceAssignmentDataService = {
  async listMatrix(requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const services = listAiServices();
    const assignments = await schoolDataService.fetchAllData(
      ENTITY,
      { orgId__eq: orgId },
      requestingUser,
      accessContext
    );
    const byKey = new Map(
      (Array.isArray(assignments) ? assignments : []).map((row) => [String(row.serviceKey), row])
    );
    const providers = await schoolDataService.fetchAllData(
      'schoolAiProviders',
      { orgId__eq: orgId, isActive__eq: true },
      requestingUser,
      accessContext
    );
    return {
      orgId,
      services,
      providers: Array.isArray(providers) ? providers : [],
      assignments: services.map((svc) => {
        const saved = byKey.get(String(svc.serviceKey)) || null;
        return {
          serviceKey: svc.serviceKey,
          label: svc.label,
          status: svc.status,
          assignment: saved
        };
      })
    };
  },

  async upsertForService(serviceKey, payload, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const key = cleanString(serviceKey, { max: 120, allowEmpty: false });
    const providerRecordId = cleanString(payload?.providerRecordId, { max: 120, allowEmpty: false });
    const modelEntryId = cleanString(payload?.modelEntryId, { max: 120, allowEmpty: false });
    await validateProviderModel(orgId, providerRecordId, modelEntryId, requestingUser, accessContext);
    const body = {
      orgId,
      serviceKey: key,
      providerRecordId,
      modelEntryId,
      isActive: payload?.isActive !== false,
      notes: cleanString(payload?.notes, { max: 4000, allowEmpty: true }) || '',
      lastUpdateUser: String(requestingUser?.id || 'SYSTEM')
    };
    return schoolDataService.addData(ENTITY, body, requestingUser, { accessContext });
  },

  async getAssignmentForService(orgId, serviceKey, requestingUser, accessContext = {}) {
    const rows = await schoolDataService.fetchAllData(
      ENTITY,
      { orgId__eq: orgId, serviceKey__eq: serviceKey, isActive__eq: true },
      requestingUser,
      accessContext
    );
    return (Array.isArray(rows) ? rows : []).find((row) => (
      idsEqual(row?.orgId, orgId) && String(row?.serviceKey) === String(serviceKey)
    )) || null;
  }
};

module.exports = schoolAiServiceAssignmentDataService;