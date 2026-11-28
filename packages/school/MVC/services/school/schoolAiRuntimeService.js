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

function serviceAssignmentError(registry, detail) {
  const label = registry?.label || 'This AI service';
  return new Error(
    `${detail} Open School AI Assist → Service assignments, select a provider key and model for "${label}", then save.`
  );
}

async function resolveAssignedProviderModel({
  orgId,
  serviceKey,
  registry,
  requestingUser,
  accessContext = {}
}) {
  const assignment = await schoolAiServiceAssignmentDataService.getAssignmentForService(
    orgId,
    serviceKey,
    requestingUser,
    accessContext
  );
  if (!assignment) {
    throw serviceAssignmentError(
      registry,
      `${registry.label} is not assigned to a provider and model yet.`
    );
  }
  const provider = await schoolAiProviderDataService.getRawProviderById(
    assignment.providerRecordId,
    requestingUser,
    accessContext
  );
  if (!provider || provider.isActive === false) {
    throw serviceAssignmentError(
      registry,
      `The provider key saved for ${registry.label} is missing or inactive.`
    );
  }
  const model = schoolAiProviderDataService.findModelEntry(provider, assignment.modelEntryId);
  if (!model || model.isActive === false) {
    throw serviceAssignmentError(
      registry,
      `The model saved for ${registry.label} is missing or inactive.`
    );
  }
  return { assignment, provider, model, selectionSource: 'assignment' };
}

/**
 * Whether Service assignments has a usable provider + model (no usage limits).
 */
async function getRoutingStatus({ serviceKey, requestingUser }, accessContext = {}) {
  const key = cleanString(serviceKey, { max: 120, allowEmpty: false });
  const registry = getAiServiceByKey(key);
  if (!registry) {
    return { configured: false, message: 'AI service is not registered.' };
  }
  try {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    await resolveAssignedProviderModel({
      orgId,
      serviceKey: key,
      registry,
      requestingUser,
      accessContext
    });
    return { configured: true, message: '' };
  } catch (error) {
    return { configured: false, message: String(error?.message || 'Service assignment is not configured.') };
  }
}

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

  const { provider, model, selectionSource } = await resolveAssignedProviderModel({
    orgId,
    serviceKey: key,
    registry,
    requestingUser,
    accessContext
  });

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
  resolveForService,
  getRoutingStatus
};