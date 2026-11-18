'use strict';

const schoolAiServiceAssignmentDataService = require('./schoolAiServiceAssignmentDataService');
const schoolAiProviderDataService = require('./schoolAiProviderDataService');
const schoolAiUsageLimitService = require('./schoolAiUsageLimitService');
const { getAiServiceByKey } = require('../../config/schoolAiServiceRegistry');
const {
  getActiveOrgIdOrThrow,
  toPublicId,
  idsEqual,
  cleanString
} = require('./schoolAiAssistCommon');

async function resolveForService({ serviceKey, requestingUser }, accessContext = {}) {
  const orgId = getActiveOrgIdOrThrow(requestingUser);
  const userId = toPublicId(requestingUser?.id);
  const key = cleanString(serviceKey, { max: 120, allowEmpty: false });
  const registry = getAiServiceByKey(key);
  if (!registry) throw new Error(`Unknown school AI service key: ${key}`);

  await schoolAiUsageLimitService.assertWithinLimit({
    orgId,
    userId,
    serviceKey: key,
    requestingUser
  });

  let assignment = await schoolAiServiceAssignmentDataService.getAssignmentForService(
    orgId,
    key,
    requestingUser,
    accessContext
  );

  let provider = null;
  let model = null;
  let selectionSource = 'assignment';

  if (assignment) {
    const raw = await schoolAiProviderDataService.getRawProviderById(assignment.providerRecordId);
    provider = raw;
    model = schoolAiProviderDataService.findModelEntry(raw, assignment.modelEntryId);
  }

  if (!provider || !model || provider.isActive === false || model.isActive === false) {
    const all = await schoolAiProviderDataService.listProviders(requestingUser, {}, accessContext);
    const rows = Array.isArray(all?.rows) ? all.rows : [];
    const defaultRow = rows.find((row) => row.isDefault && row.isActive !== false)
      || rows.find((row) => row.isActive !== false);
    if (!defaultRow) {
      throw new Error('No active AI provider is configured. Add a provider key in School AI Assist.');
    }
    provider = await schoolAiProviderDataService.getRawProviderById(defaultRow.id);
    const activeModel = (Array.isArray(provider?.models) ? provider.models : []).find((m) => m.isActive !== false);
    model = activeModel || (provider.models || [])[0];
    selectionSource = assignment ? 'default_fallback' : 'org_default';
  }

  schoolAiProviderDataService.assertUserNotBanned(provider, userId);

  const apiKey = await schoolAiProviderDataService.decryptApiKeyForProvider(provider.id, requestingUser);

  return {
    serviceKey: key,
    serviceLabel: registry.label,
    orgId,
    userId,
    providerRecordId: provider.id,
    providerId: provider.providerId,
    providerName: provider.name,
    modelEntryId: model?.id || '',
    modelId: model?.modelId || '',
    modelLabel: model?.label || model?.modelId || '',
    selectionSource,
    credentials: {
      apiKey,
      baseUrl: provider.baseUrl || '',
      project: provider.project || '',
      location: provider.location || ''
    }
  };
}

module.exports = {
  resolveForService
};