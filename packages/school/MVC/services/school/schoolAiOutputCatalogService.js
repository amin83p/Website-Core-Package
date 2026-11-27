'use strict';

const { sanitizeDefinitionOutputsForClient } = require('./schoolAiOutputFieldSyncService');

function cleanText(value) {
  return String(value || '').trim();
}

function inferWidgetFromSchema(prop = {}) {
  const type = cleanText(prop.type).toLowerCase();
  if (type === 'array') return 'stringList';
  if (type === 'string') {
    if (Array.isArray(prop.enum) && prop.enum.length) return 'radioGroup';
    return 'text';
  }
  return 'text';
}

function extractFormUi(jsonSchema = {}) {
  const schema = jsonSchema && typeof jsonSchema === 'object' ? jsonSchema : {};
  const raw = schema['x-formUi'];
  if (!raw || typeof raw !== 'object') return null;
  const fields = Array.isArray(raw.fields)
    ? raw.fields.map((row) => {
      if (!row || typeof row !== 'object') return null;
      const resultKey = cleanText(row.resultKey);
      if (!resultKey) return null;
      return {
        resultKey,
        label: cleanText(row.label) || resultKey,
        widget: cleanText(row.widget) || '',
        enumSource: cleanText(row.enumSource) || '',
        minItems: Number.isFinite(Number(row.minItems)) ? Number(row.minItems) : null,
        maxItems: Number.isFinite(Number(row.maxItems)) ? Number(row.maxItems) : null
      };
    }).filter(Boolean)
    : [];
  if (!fields.length) return null;
  return { fields };
}

function typeToWidget(type) {
  const t = cleanText(type).toLowerCase();
  if (t === 'textarea') return 'textarea';
  if (t === 'stringList') return 'stringList';
  if (t === 'select') return 'radioGroup';
  if (t === 'checkboxGroup') return 'checkboxGroup';
  return 'text';
}

function buildOutputCatalog(definition = {}) {
  const output = definition?.output && typeof definition.output === 'object' ? definition.output : {};
  const mode = cleanText(output.mode).toLowerCase() || 'text';
  const jsonSchema = output.jsonSchema && typeof output.jsonSchema === 'object' ? output.jsonSchema : null;
  const persisted = sanitizeDefinitionOutputsForClient(definition);
  if (persisted.length) {
    const fields = persisted
      .filter((row) => row.status !== 'schema_missing')
      .map((row) => ({
        resultKey: row.resultKey,
        label: row.label || row.resultKey,
        widget: typeToWidget(row.type),
        enumSource: '',
        required: Boolean(row.required),
        minItems: null,
        maxItems: null,
        schemaType: row.type,
        enumValues: Array.isArray(row.options) ? row.options.map((o) => o.value) : []
      }));
    return { outputMode: mode, fields, formUi: null, outputs: persisted };
  }
  if (!jsonSchema) {
    return { outputMode: mode, fields: [], formUi: null };
  }
  const formUi = extractFormUi(jsonSchema);
  const uiByKey = new Map((formUi?.fields || []).map((row) => [row.resultKey, row]));
  const properties = jsonSchema.properties && typeof jsonSchema.properties === 'object'
    ? jsonSchema.properties
    : {};
  const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];
  const fields = Object.keys(properties).map((resultKey) => {
    const prop = properties[resultKey] || {};
    const ui = uiByKey.get(resultKey) || {};
    const widget = cleanText(ui.widget) || inferWidgetFromSchema(prop);
    return {
      resultKey,
      label: cleanText(ui.label) || resultKey,
      widget,
      enumSource: cleanText(ui.enumSource) || '',
      required: required.includes(resultKey),
      minItems: ui.minItems != null ? ui.minItems : (prop.minItems ?? null),
      maxItems: ui.maxItems != null ? ui.maxItems : (prop.maxItems ?? null),
      schemaType: cleanText(prop.type) || 'string',
      enumValues: Array.isArray(prop.enum) ? [...prop.enum] : (Array.isArray(prop.items?.enum) ? [...prop.items.enum] : [])
    };
  });
  return {
    outputMode: mode,
    fields,
    formUi
  };
}

module.exports = {
  extractFormUi,
  inferWidgetFromSchema,
  buildOutputCatalog
};