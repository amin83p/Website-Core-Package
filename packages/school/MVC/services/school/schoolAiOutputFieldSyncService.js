'use strict';

const OUTPUT_TYPES = new Set(['text', 'textarea', 'number', 'boolean', 'select', 'stringList', 'json', 'object']);
const OUTPUT_STATUSES = new Set(['active', 'schema_missing']);

function normalizeOutputType(typeRaw = '') {
  const token = cleanText(typeRaw).toLowerCase();
  if (!token) return 'text';
  for (const allowed of OUTPUT_TYPES) {
    if (allowed.toLowerCase() === token) return allowed;
  }
  return 'text';
}

function cleanText(value) {
  return String(value || '').trim();
}

function cleanResultKey(raw = '') {
  const token = cleanText(raw);
  if (!token) return '';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
    throw new Error(`Invalid output result key "${token}". Use letters, numbers, and underscores.`);
  }
  return token;
}

function normalizeSelectOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (typeof row === 'string') {
        const value = cleanText(row);
        return value ? { value, label: value } : null;
      }
      if (!row || typeof row !== 'object') return null;
      const value = cleanText(row.value);
      if (!value) return null;
      return { value, label: cleanText(row.label) || value };
    })
    .filter(Boolean);
}

function inferTypeFromSchemaProperty(prop = {}) {
  const type = cleanText(prop.type).toLowerCase();
  if (type === 'array') {
    const itemsType = cleanText(prop.items?.type).toLowerCase();
    return itemsType === 'string' ? 'stringList' : 'json';
  }
  if (type === 'object') return 'object';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'string') {
    if (Array.isArray(prop.enum) && prop.enum.length) return 'select';
    return 'text';
  }
  return 'json';
}

function inferObjectSubfields(prop = {}) {
  const properties = prop?.properties && typeof prop.properties === 'object' ? prop.properties : {};
  return {
    valueField: properties.revised ? 'revised' : (properties.value ? 'value' : ''),
    changeTypeField: properties.changeType ? 'changeType' : '',
    changeSummaryField: properties.changeSummary ? 'changeSummary' : ''
  };
}

function defaultActionsForType(type) {
  const t = cleanText(type);
  if (t === 'object' || t === 'text' || t === 'textarea' || t === 'select' || t === 'stringList') {
    return ['copy', 'apply'];
  }
  return ['copy'];
}

function inferFieldFromSchema(resultKey, prop, required) {
  const type = inferTypeFromSchemaProperty(prop);
  const options = type === 'select' && Array.isArray(prop.enum)
    ? prop.enum.map((v) => ({ value: String(v), label: String(v) }))
    : [];
  const sub = type === 'object' ? inferObjectSubfields(prop) : {
    valueField: '',
    changeTypeField: '',
    changeSummaryField: ''
  };
  return {
    resultKey,
    label: resultKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    type,
    required: Boolean(required),
    helpText: '',
    options,
    valueField: sub.valueField,
    changeTypeField: sub.changeTypeField,
    changeSummaryField: sub.changeSummaryField,
    actions: defaultActionsForType(type),
    status: 'active'
  };
}

function inferFieldsFromJsonSchema(jsonSchema = {}) {
  const schema = jsonSchema && typeof jsonSchema === 'object' ? jsonSchema : {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.keys(properties).map((key) => {
    const prop = properties[key] || {};
    return inferFieldFromSchema(key, prop, required.includes(key));
  });
}

function normalizeOutputField(raw = {}, index = 0) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const resultKey = cleanResultKey(input.resultKey || `output_${index + 1}`);
  const type = normalizeOutputType(input.type);
  const statusRaw = cleanText(input.status).toLowerCase() || 'active';
  const status = OUTPUT_STATUSES.has(statusRaw) ? statusRaw : 'active';
  let actions = Array.isArray(input.actions)
    ? input.actions.map((a) => cleanText(a).toLowerCase()).filter(Boolean)
    : defaultActionsForType(type);
  if (!actions.length) actions = ['copy'];
  return {
    resultKey,
    label: cleanText(input.label) || resultKey,
    type,
    required: Boolean(input.required),
    helpText: cleanText(input.helpText),
    options: type === 'select' ? normalizeSelectOptions(input.options) : [],
    valueField: cleanText(input.valueField),
    changeTypeField: cleanText(input.changeTypeField),
    changeSummaryField: cleanText(input.changeSummaryField),
    actions,
    status
  };
}

function normalizeOutputsList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return list.map((row, index) => {
    const field = normalizeOutputField(row, index);
    if (seen.has(field.resultKey)) {
      throw new Error(`Duplicate output result key "${field.resultKey}".`);
    }
    seen.add(field.resultKey);
    return field;
  });
}

function schemaPropertyKeys(jsonSchema) {
  const schema = jsonSchema && typeof jsonSchema === 'object' ? jsonSchema : {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  return new Set(Object.keys(properties));
}

function compareOutputsToSchema(outputs = [], jsonSchema = {}) {
  const normalized = normalizeOutputsList(outputs);
  const schemaKeys = schemaPropertyKeys(jsonSchema);
  const outputByKey = new Map(normalized.map((row) => [row.resultKey, row]));
  const required = Array.isArray(jsonSchema?.required) ? jsonSchema.required : [];
  const properties = jsonSchema?.properties && typeof jsonSchema.properties === 'object'
    ? jsonSchema.properties
    : {};

  const newKeys = [...schemaKeys].filter((key) => !outputByKey.has(key)).map((key) => {
    const prop = properties[key] || {};
    return inferFieldFromSchema(key, prop, required.includes(key));
  });

  const staleKeys = normalized
    .filter((row) => !schemaKeys.has(row.resultKey))
    .map((row) => ({
      ...row,
      suggestedStatus: 'schema_missing'
    }));

  const typeChanges = [];
  const requiredChanges = [];
  normalized.forEach((row) => {
    if (!schemaKeys.has(row.resultKey)) return;
    const prop = properties[row.resultKey] || {};
    const inferred = inferFieldFromSchema(row.resultKey, prop, required.includes(row.resultKey));
    if (inferred.type !== row.type) {
      typeChanges.push({
        resultKey: row.resultKey,
        currentType: row.type,
        schemaType: inferred.type,
        suggested: inferred
      });
    }
    if (Boolean(inferred.required) !== Boolean(row.required)) {
      requiredChanges.push({
        resultKey: row.resultKey,
        currentRequired: row.required,
        schemaRequired: inferred.required,
        suggested: inferred
      });
    }
  });

  return {
    ok: true,
    outputs: normalized,
    newKeys,
    staleKeys,
    typeChanges,
    requiredChanges,
    inSync: !newKeys.length && !staleKeys.length && !typeChanges.length && !requiredChanges.length
  };
}

function applySyncChoices(outputs = [], jsonSchema = {}, choices = {}) {
  const current = normalizeOutputsList(outputs);
  const byKey = new Map(current.map((row) => [row.resultKey, { ...row }]));
  const comparison = compareOutputsToSchema(current, jsonSchema);

  const addKeys = new Set(
    Array.isArray(choices.addKeys) ? choices.addKeys : comparison.newKeys.map((r) => r.resultKey)
  );
  comparison.newKeys.forEach((row) => {
    if (addKeys.has(row.resultKey)) byKey.set(row.resultKey, { ...row });
  });

  const updateKeys = new Set(Array.isArray(choices.updateKeys) ? choices.updateKeys : []);
  if (!Array.isArray(choices.updateKeys)) {
    comparison.typeChanges.forEach((c) => updateKeys.add(c.resultKey));
    comparison.requiredChanges.forEach((c) => updateKeys.add(c.resultKey));
  }
  [...comparison.typeChanges, ...comparison.requiredChanges].forEach((change) => {
    if (!updateKeys.has(change.resultKey)) return;
    const existing = byKey.get(change.resultKey);
    if (!existing) return;
    const suggested = change.suggested;
    byKey.set(change.resultKey, {
      ...existing,
      type: suggested.type,
      required: suggested.required,
      options: suggested.options?.length ? suggested.options : existing.options,
      status: 'active'
    });
  });

  const markStaleKeys = new Set(Array.isArray(choices.markStaleKeys) ? choices.markStaleKeys : []);
  if (!choices.markStaleKeys) {
    comparison.staleKeys.forEach((row) => markStaleKeys.add(row.resultKey));
  }
  comparison.staleKeys.forEach((row) => {
    const existing = byKey.get(row.resultKey);
    if (!existing) return;
    if (markStaleKeys.has(row.resultKey)) {
      byKey.set(row.resultKey, { ...existing, status: 'schema_missing' });
    }
  });

  return normalizeOutputsList([...byKey.values()]);
}

function buildReportUiFromOutputs(outputs = []) {
  const rows = normalizeOutputsList(outputs).filter((row) => row.status !== 'schema_missing');
  if (!rows.length) return null;
  const sections = rows.map((row) => ({
    resultKey: row.resultKey,
    title: row.label || row.resultKey,
    actions: row.actions?.length ? [...row.actions] : defaultActionsForType(row.type),
    inputId: row.resultKey,
    valueField: row.valueField || '',
    changeTypeField: row.changeTypeField || 'changeType',
    changeSummaryField: row.changeSummaryField || 'changeSummary'
  }));
  return { layout: 'sections', sections };
}

function sanitizeDefinitionOutputsForClient(definition = {}) {
  const outputs = Array.isArray(definition?.outputs) ? definition.outputs : [];
  return outputs.map((field) => ({
    resultKey: cleanText(field?.resultKey),
    label: cleanText(field?.label) || cleanText(field?.resultKey),
    type: cleanText(field?.type) || 'text',
    required: Boolean(field?.required),
    helpText: cleanText(field?.helpText),
    options: Array.isArray(field?.options) ? field.options : [],
    valueField: cleanText(field?.valueField),
    changeTypeField: cleanText(field?.changeTypeField),
    changeSummaryField: cleanText(field?.changeSummaryField),
    actions: Array.isArray(field?.actions) ? field.actions : [],
    status: cleanText(field?.status) || 'active'
  })).filter((row) => row.resultKey);
}

function validateTemplateOutputBindings(bindingRow, definition = {}, fieldIds = new Set()) {
  const warnings = [];
  const errors = [];
  const outputBindings = bindingRow?.outputBindings && typeof bindingRow.outputBindings === 'object'
    ? bindingRow.outputBindings
    : {};
  const catalog = sanitizeDefinitionOutputsForClient(definition);
  const byKey = new Map(catalog.map((row) => [row.resultKey, row]));
  Object.entries(outputBindings).forEach(([resultKey, binding]) => {
    const key = cleanText(resultKey);
    if (!key) return;
    const meta = byKey.get(key);
    if (!meta) {
      errors.push(`Output "${key}" is not defined on the AI service.`);
      return;
    }
    if (meta.status === 'schema_missing') {
      warnings.push(`Output "${key}" is missing from the service JSON schema (stale).`);
    }
    const source = cleanText(binding?.source).toLowerCase();
    const value = cleanText(binding?.value);
    if (source === 'field' && value && !fieldIds.has(value)) {
      errors.push(`Output "${key}": field "${value}" is not on this template.`);
    }
  });
  return { warnings, errors };
}

function outputsFromFormUiAndReportUi(jsonSchema = {}) {
  const schema = jsonSchema && typeof jsonSchema === 'object' ? jsonSchema : {};
  const formUi = schema['x-formUi'];
  const reportUi = schema['x-reportUi'];
  const inferred = inferFieldsFromJsonSchema(schema);
  const byKey = new Map(inferred.map((row) => [row.resultKey, row]));
  if (formUi && Array.isArray(formUi.fields)) {
    formUi.fields.forEach((uiRow) => {
      const resultKey = cleanText(uiRow?.resultKey);
      if (!resultKey) return;
      const base = byKey.get(resultKey) || inferFieldFromSchema(resultKey, schema.properties?.[resultKey] || {}, false);
      const widget = cleanText(uiRow?.widget).toLowerCase();
      let type = base.type;
      if (widget === 'textarea') type = 'textarea';
      else if (widget === 'stringlist') type = 'stringList';
      else if (widget === 'radiogroup') type = 'select';
      else if (widget === 'checkboxgroup') type = 'stringList';
      byKey.set(resultKey, {
        ...base,
        resultKey,
        label: cleanText(uiRow?.label) || base.label,
        type
      });
    });
  }
  if (reportUi && Array.isArray(reportUi.sections)) {
    reportUi.sections.forEach((sec) => {
      const resultKey = cleanText(sec?.resultKey);
      if (!resultKey) return;
      const base = byKey.get(resultKey) || inferFieldFromSchema(resultKey, schema.properties?.[resultKey] || {}, false);
      byKey.set(resultKey, {
        ...base,
        resultKey,
        label: cleanText(sec?.title) || base.label,
        actions: Array.isArray(sec?.actions) ? sec.actions.map((a) => cleanText(a).toLowerCase()).filter(Boolean) : base.actions,
        valueField: cleanText(sec?.valueField) || base.valueField,
        changeTypeField: cleanText(sec?.changeTypeField) || base.changeTypeField,
        changeSummaryField: cleanText(sec?.changeSummaryField) || base.changeSummaryField
      });
    });
  }
  return normalizeOutputsList([...byKey.values()]);
}

module.exports = {
  OUTPUT_TYPES,
  OUTPUT_STATUSES,
  cleanResultKey,
  inferFieldsFromJsonSchema,
  inferFieldFromSchema,
  normalizeOutputField,
  normalizeOutputsList,
  compareOutputsToSchema,
  applySyncChoices,
  buildReportUiFromOutputs,
  sanitizeDefinitionOutputsForClient,
  validateTemplateOutputBindings,
  outputsFromFormUiAndReportUi
};