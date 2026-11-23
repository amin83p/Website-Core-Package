'use strict';

const { getAiServiceByKey, listAiServices } = require('../../config/schoolAiServiceRegistry');

const BINDING_SOURCES = Object.freeze(['field', 'prefill', 'static', 'empty']);

function cleanText(value) {
  return String(value || '').trim();
}

function parseAiServicesJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return null;
}

function normalizeBindingRow(binding = {}) {
  const source = cleanText(binding?.source).toLowerCase();
  const normalizedSource = BINDING_SOURCES.includes(source) ? source : 'empty';
  return {
    source: normalizedSource,
    value: normalizedSource === 'empty' ? '' : cleanText(binding?.value)
  };
}

function normalizeAiServiceRow(row, index = 0) {
  const serviceKey = cleanText(row?.serviceKey);
  if (!serviceKey || !getAiServiceByKey(serviceKey)) return null;
  const inputBindings = {};
  const rawBindings = row?.inputBindings && typeof row.inputBindings === 'object' && !Array.isArray(row.inputBindings)
    ? row.inputBindings
    : {};
  Object.keys(rawBindings).forEach((inputId) => {
    const id = cleanText(inputId);
    if (!id) return;
    inputBindings[id] = normalizeBindingRow(rawBindings[inputId]);
  });
  const id = cleanText(row?.id) || `ai_${index + 1}`;
  return {
    id,
    serviceKey,
    label: cleanText(row?.label),
    isActive: row?.isActive !== false,
    inputBindings
  };
}

function normalizeStoredAiServices(raw) {
  const parsed = parseAiServicesJson(raw);
  const rows = parsed === null ? (Array.isArray(raw) ? raw : []) : parsed;
  return rows
    .map((row, index) => normalizeAiServiceRow(row, index))
    .filter(Boolean);
}

function normalizeAiServicesFromBody(body = {}, existingTemplate = null) {
  const parsed = parseAiServicesJson(body?.aiServicesJson);
  if (parsed === null) {
    if (Array.isArray(existingTemplate?.aiServices)) {
      return normalizeStoredAiServices(existingTemplate.aiServices);
    }
    return [];
  }
  return normalizeStoredAiServices(parsed);
}

function collectTemplateFieldIds(schema = {}) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  return new Set(fields.map((field) => cleanText(field?.id)).filter(Boolean));
}

function collectPrefillCatalogKeys(catalog = {}) {
  const keys = new Set();
  Object.values(catalog).forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((item) => {
      const key = cleanText(item?.key || item?.id);
      if (key) keys.add(key);
    });
  });
  return keys;
}

function validateAiServicesForTemplate(templatePayload = {}, { strict = false, prefillCatalog = {} } = {}) {
  const rows = normalizeStoredAiServices(templatePayload?.aiServices || []);
  if (!strict) {
    return { rows, errors: [] };
  }
  const fieldIds = collectTemplateFieldIds(templatePayload?.schema);
  const prefillKeys = collectPrefillCatalogKeys(prefillCatalog);
  const errors = [];
  rows.forEach((row) => {
    const registry = getAiServiceByKey(row.serviceKey);
    if (!registry) {
      errors.push(`Unknown AI service: ${row.serviceKey}`);
      return;
    }
    Object.entries(row.inputBindings || {}).forEach(([inputId, binding]) => {
      const source = binding?.source || 'empty';
      const value = cleanText(binding?.value);
      if (source === 'field' && value && !fieldIds.has(value)) {
        errors.push(`${row.serviceKey} input "${inputId}": field "${value}" is not on this template.`);
      }
      if (source === 'prefill' && value && prefillKeys.size && !prefillKeys.has(value)) {
        errors.push(`${row.serviceKey} input "${inputId}": prefill key "${value}" is not in the catalog.`);
      }
      if (source === 'static' && !value) {
        errors.push(`${row.serviceKey} input "${inputId}": static binding requires text.`);
      }
    });
  });
  return { rows, errors };
}

function listActiveBindings(template = {}) {
  return normalizeStoredAiServices(template?.aiServices).filter((row) => row.isActive !== false);
}

function resolveBindingValue(binding = {}, mergedData = {}, prefillSnapshot = {}) {
  const source = binding?.source || 'empty';
  const value = cleanText(binding?.value);
  const merged = mergedData && typeof mergedData === 'object' ? mergedData : {};
  const prefill = prefillSnapshot && typeof prefillSnapshot === 'object' ? prefillSnapshot : merged;
  switch (source) {
    case 'field':
      if (!value) return '';
      return merged[value] !== undefined && merged[value] !== null ? String(merged[value]) : '';
    case 'prefill':
      if (!value) return '';
      if (prefill[value] !== undefined && prefill[value] !== null) return String(prefill[value]);
      if (merged[value] !== undefined && merged[value] !== null) return String(merged[value]);
      return '';
    case 'static':
      return value;
    case 'empty':
    default:
      return '';
  }
}

function resolveInputsForService(bindingRow, definition = {}, mergedData = {}, prefillSnapshot = {}) {
  const inputs = Array.isArray(definition?.inputs) ? definition.inputs : [];
  const bindings = bindingRow?.inputBindings && typeof bindingRow.inputBindings === 'object'
    ? bindingRow.inputBindings
    : {};
  const resolved = {};
  inputs.forEach((field) => {
    const id = cleanText(field?.id);
    if (!id) return;
    const binding = bindings[id] || { source: 'empty', value: '' };
    resolved[id] = resolveBindingValue(binding, mergedData, prefillSnapshot);
  });
  return resolved;
}

function resolveInputsForInstance(template = {}, definitionsByKey = {}, mergedData = {}, prefillSnapshot = {}) {
  const bindings = listActiveBindings(template);
  const out = new Map();
  bindings.forEach((row) => {
    const definition = definitionsByKey[row.serviceKey] || {};
    out.set(row.id, {
      bindingRow: row,
      inputs: resolveInputsForService(row, definition, mergedData, prefillSnapshot)
    });
  });
  return out;
}

function buildFieldMetaById(template = {}) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const map = new Map();
  fields.forEach((field) => {
    const id = cleanText(field?.id);
    if (!id) return;
    map.set(id, {
      id,
      sharedAcrossStudents: field?.sharedAcrossStudents === true,
      readOnly: field?.readOnly === true
    });
  });
  return map;
}

function bindingRowUsesPrivateField(bindingRow = {}, fieldMetaById = new Map()) {
  const bindings = bindingRow?.inputBindings && typeof bindingRow.inputBindings === 'object'
    ? bindingRow.inputBindings
    : {};
  return Object.values(bindings).some((binding) => {
    if (cleanText(binding?.source).toLowerCase() !== 'field') return false;
    const fieldId = cleanText(binding?.value);
    if (!fieldId) return false;
    const meta = fieldMetaById.get(fieldId);
    if (!meta) return true;
    if (meta.sharedAcrossStudents === true) return false;
    // Read-only fields surface as matrix-wide/common values on Fill Reports, not per-student columns.
    if (meta.readOnly === true) return false;
    return true;
  });
}

function analyzeAiAssistContexts(template = {}) {
  const bindings = listActiveBindings(template);
  const fieldMetaById = buildFieldMetaById(template);
  const hasPrivateFieldBinding = bindings.some((row) => bindingRowUsesPrivateField(row, fieldMetaById));
  return {
    instanceAllowed: bindings.length > 0,
    matrixAllowed: bindings.length > 0 && !hasPrivateFieldBinding,
    matrixBlockedReason: hasPrivateFieldBinding
      ? 'AI Assist on Fill Reports is unavailable when a service input is bound to a private (per-student) field. Use Report Instance (V2) for that student.'
      : '',
    bindings,
    fieldMetaById
  };
}

function resolveMatrixMergedData({
  template = {},
  sharedAnswers = {},
  commonFieldAnswers = {},
  prefillSnapshot = {}
} = {}) {
  const merged = {};
  const shared = sharedAnswers && typeof sharedAnswers === 'object' ? sharedAnswers : {};
  const common = commonFieldAnswers && typeof commonFieldAnswers === 'object' ? commonFieldAnswers : {};
  const prefill = prefillSnapshot && typeof prefillSnapshot === 'object' ? prefillSnapshot : {};
  const fieldMeta = buildFieldMetaById(template);
  fieldMeta.forEach((meta, fieldId) => {
    if (meta.sharedAcrossStudents && Object.prototype.hasOwnProperty.call(shared, fieldId)) {
      merged[fieldId] = shared[fieldId];
    }
  });
  Object.assign(merged, common);
  Object.keys(prefill).forEach((key) => {
    if (merged[key] === undefined) merged[key] = prefill[key];
  });
  return merged;
}

function findBindingById(template = {}, bindingRowId = '') {
  const token = cleanText(bindingRowId);
  if (!token) return null;
  return listActiveBindings(template).find((row) => cleanText(row.id) === token) || null;
}

function buildCatalogEntryFromBinding(bindingRow, definition = {}, registry = null, resolvedInputs = {}) {
  const reg = registry || getAiServiceByKey(bindingRow.serviceKey);
  if (!reg) return null;
  const configured = Boolean(definition?.prompt?.userPromptTemplate?.trim());
  const active = definition?.isActive !== false;
  if (!configured || !active) return null;
  const inputBindings = bindingRow?.inputBindings && typeof bindingRow.inputBindings === 'object'
    ? bindingRow.inputBindings
    : {};
  return {
    bindingRowId: bindingRow.id,
    serviceKey: bindingRow.serviceKey,
    label: cleanText(bindingRow.label) || reg.label || bindingRow.serviceKey,
    description: reg.description || '',
    inputs: sanitizeDefinitionInputsForClient(definition),
    inputDefaults: resolvedInputs,
    inputBindings,
    configured,
    active
  };
}

function sanitizeDefinitionInputsForClient(definition = {}) {
  const inputs = Array.isArray(definition?.inputs) ? definition.inputs : [];
  return inputs.map((field) => ({
    id: cleanText(field?.id),
    label: cleanText(field?.label) || cleanText(field?.id),
    type: cleanText(field?.type) || 'text',
    required: Boolean(field?.required),
    helpText: cleanText(field?.helpText),
    options: Array.isArray(field?.options) ? field.options : []
  })).filter((row) => row.id);
}

module.exports = {
  BINDING_SOURCES,
  normalizeAiServicesFromBody,
  normalizeStoredAiServices,
  validateAiServicesForTemplate,
  listActiveBindings,
  resolveBindingValue,
  resolveInputsForService,
  resolveInputsForInstance,
  sanitizeDefinitionInputsForClient,
  collectTemplateFieldIds,
  collectPrefillCatalogKeys,
  buildFieldMetaById,
  bindingRowUsesPrivateField,
  analyzeAiAssistContexts,
  resolveMatrixMergedData,
  findBindingById,
  buildCatalogEntryFromBinding
};