'use strict';

const reportTemplateAiBindingService = require('./reportTemplateAiBindingService');
const schoolAiServiceDefinitionDataService = require('./schoolAiServiceDefinitionDataService');

async function loadDefinitionsForBindings(bindings = [], reqUser, accessContext = {}) {
  const byKey = new Map();
  await Promise.all(bindings.map(async (row) => {
    const key = String(row?.serviceKey || '').trim();
    if (!key || byKey.has(key)) return;
    try {
      const definition = await schoolAiServiceDefinitionDataService.getByServiceKey(key, reqUser, accessContext);
      byKey.set(key, definition || {});
    } catch (_) {
      byKey.set(key, {});
    }
  }));
  return byKey;
}

async function buildReportAiAssistCatalog(template = {}, {
  context = 'instance',
  mergedData = {},
  prefillSnapshot = {},
  reqUser,
  accessContext = {}
} = {}) {
  const analysis = reportTemplateAiBindingService.analyzeAiAssistContexts(template);
  if (context === 'matrix' && !analysis.matrixAllowed) {
    return {
      catalog: [],
      analysis,
      canRun: false,
      matrixAllowed: false,
      matrixBlockedReason: analysis.matrixBlockedReason || ''
    };
  }
  if (context === 'instance' && !analysis.instanceAllowed) {
    return {
      catalog: [],
      analysis,
      canRun: false,
      matrixAllowed: analysis.matrixAllowed,
      matrixBlockedReason: analysis.matrixBlockedReason || ''
    };
  }
  const bindings = context === 'matrix'
    ? analysis.bindings
    : analysis.bindings;
  const definitionsByKey = await loadDefinitionsForBindings(bindings, reqUser, accessContext);
  const prefill = prefillSnapshot && typeof prefillSnapshot === 'object' ? prefillSnapshot : {};
  const merged = mergedData && typeof mergedData === 'object' ? mergedData : {};
  const catalog = [];
  bindings.forEach((bindingRow) => {
    const definition = definitionsByKey.get(bindingRow.serviceKey) || {};
    const resolvedInputs = reportTemplateAiBindingService.resolveInputsForService(
      bindingRow,
      definition,
      merged,
      prefill
    );
    const entry = reportTemplateAiBindingService.buildCatalogEntryFromBinding(
      bindingRow,
      definition,
      null,
      resolvedInputs
    );
    if (entry) catalog.push(entry);
  });
  return {
    catalog,
    analysis,
    canRun: catalog.length > 0,
    matrixAllowed: analysis.matrixAllowed,
    matrixBlockedReason: analysis.matrixBlockedReason || ''
  };
}

module.exports = {
  buildReportAiAssistCatalog,
  loadDefinitionsForBindings
};