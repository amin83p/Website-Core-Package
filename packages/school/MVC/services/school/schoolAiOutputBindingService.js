'use strict';

const { getDefinitionPreset } = require('../../config/schoolAiServiceDefinitionPresets');
const { getFormBindingProfile } = require('../../config/schoolAiFormBindingProfiles');
const schoolAiOutputCatalogService = require('./schoolAiOutputCatalogService');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const { getValueAtResultPath } = require('./schoolAiOutputFieldSyncService');

const ENUM_SANITIZERS = Object.freeze({
  wordTypes: {
    sanitize(raw) {
      return wordOfDayModel.sanitizeWordTypes(raw);
    }
  },
  difficulty: {
    sanitize(raw) {
      return wordOfDayModel.normalizeDifficulty(raw);
    }
  }
});

function resolveDefinition(definition, serviceKey) {
  if (definition?.output) return definition;
  const key = String(serviceKey || '').trim();
  if (!key) return null;
  return getDefinitionPreset(key);
}

function resolveBindings(profile, catalog) {
  if (!profile || !catalog) return { ok: false, errors: ['Binding profile or catalog missing.'] };
  const keys = new Set((catalog.fields || []).map((row) => row.resultKey));
  const errors = [];
  (profile.outputBindings || []).forEach((binding) => {
    const resultKey = String(binding?.resultKey || '').trim();
    if (!resultKey) return;
    if (!keys.has(resultKey)) {
      errors.push(`Output binding "${resultKey}" is not in the service output catalog.`);
    }
  });
  return { ok: errors.length === 0, errors, bindings: profile.outputBindings || [] };
}

function sanitizeFieldValue(field, rawValue) {
  const widget = String(field?.widget || '').trim();
  const enumSource = String(field?.enumSource || '').trim();
  if (enumSource && ENUM_SANITIZERS[enumSource]) {
    const out = ENUM_SANITIZERS[enumSource].sanitize(rawValue);
    if (enumSource === 'wordTypes' && (!Array.isArray(out) || !out.length)) {
      throw new Error('AI response did not include valid word types.');
    }
    return out;
  }
  if (widget === 'stringList' || field?.schemaType === 'array') {
    const list = wordOfDayModel.sanitizeExamples(rawValue);
    const minItems = Number(field?.minItems) || 0;
    const maxItems = Number(field?.maxItems) || list.length;
    const sliced = list.slice(0, maxItems > 0 ? maxItems : list.length);
    if (minItems > 0 && sliced.length < minItems) {
      throw new Error(`AI response did not include ${minItems} example sentence(s).`);
    }
    return sliced;
  }
  const text = String(rawValue == null ? '' : rawValue).trim();
  if (!text && field?.required) {
    throw new Error(`AI response did not include ${field.label || field.resultKey}.`);
  }
  if (field?.resultKey === 'pronunciation' && text.length > 500) return text.slice(0, 500);
  if (field?.resultKey === 'meaning' && text.length > 8000) return text.slice(0, 8000);
  return text;
}

function mapAiResultToFormValues(data, options = {}) {
  const source = data && typeof data === 'object' ? data : {};
  const serviceKey = String(options.serviceKey || '').trim();
  const consumerKey = String(options.consumerKey || '').trim();
  const definition = resolveDefinition(options.definition, serviceKey);
  if (!definition) throw new Error('Service definition is required for output mapping.');
  let catalog = schoolAiOutputCatalogService.buildOutputCatalog(definition);
  if (!catalog.fields?.length && Array.isArray(definition?.outputs) && definition.outputs.length) {
    catalog = schoolAiOutputCatalogService.buildOutputCatalog({ ...definition, outputs: definition.outputs });
  }
  const profile = consumerKey && serviceKey
    ? getFormBindingProfile(consumerKey, serviceKey)
    : null;
  if (profile) {
    const bindingCheck = resolveBindings(profile, catalog);
    if (!bindingCheck.ok) {
      throw new Error(bindingCheck.errors[0] || 'Invalid output bindings.');
    }
  }
  const fields = {};
  (catalog.fields || []).forEach((field) => {
    const rawValue = getValueAtResultPath(source, field.resultKey);
    if (rawValue === undefined && !Object.prototype.hasOwnProperty.call(source, field.resultKey)) {
      if (field.required) {
        throw new Error(`AI response did not include ${field.label || field.resultKey}.`);
      }
      return;
    }
    fields[field.resultKey] = sanitizeFieldValue(field, rawValue);
  });
  return fields;
}

module.exports = {
  ENUM_SANITIZERS,
  resolveBindings,
  mapAiResultToFormValues
};