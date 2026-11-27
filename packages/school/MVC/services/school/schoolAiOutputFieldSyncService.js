'use strict';

const OUTPUT_TYPES = new Set(['text', 'textarea', 'number', 'boolean', 'select', 'stringList', 'json']);
const LEGACY_OBJECT_TYPE = 'object';
const OUTPUT_STATUSES = new Set(['active', 'schema_missing']);

function cleanText(value) {
  return String(value || '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOutputType(typeRaw = '') {
  const token = cleanText(typeRaw).toLowerCase();
  if (!token) return 'text';
  if (token === LEGACY_OBJECT_TYPE) return LEGACY_OBJECT_TYPE;
  for (const allowed of OUTPUT_TYPES) {
    if (allowed.toLowerCase() === token) return allowed;
  }
  return 'text';
}

function cleanResultKey(raw = '') {
  const token = cleanText(raw);
  if (!token) return '';
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(token)) {
    throw new Error(`Invalid output result key "${token}". Use letters, numbers, underscores, and dots.`);
  }
  return token;
}

function joinResultPath(prefix, segment) {
  const parent = cleanText(prefix);
  const child = cleanText(segment);
  if (!child) return parent;
  if (!parent) return child;
  return `${parent}.${child}`;
}

function humanizeResultKey(path = '') {
  const token = cleanText(path);
  if (!token) return '';
  const leaf = token.includes('.') ? token.slice(token.lastIndexOf('.') + 1) : token;
  const base = leaf.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (!token.includes('.')) return base;
  const parent = token.slice(0, token.lastIndexOf('.')).replace(/_/g, ' ');
  return `${parent} — ${base}`;
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
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'string') {
    if (Array.isArray(prop.enum) && prop.enum.length) return 'select';
    return 'text';
  }
  if (type === 'object') return 'json';
  return 'json';
}

function defaultActionsForType(type) {
  const t = cleanText(type);
  if (t === LEGACY_OBJECT_TYPE || t === 'text' || t === 'textarea' || t === 'select' || t === 'stringList') {
    return ['copy', 'apply'];
  }
  return ['copy'];
}

function inferFieldFromSchema(resultKey, prop, required) {
  const type = inferTypeFromSchemaProperty(prop);
  const options = type === 'select' && Array.isArray(prop.enum)
    ? prop.enum.map((v) => ({ value: String(v), label: String(v) }))
    : [];
  return {
    resultKey,
    label: humanizeResultKey(resultKey),
    type,
    required: Boolean(required),
    helpText: '',
    options,
    valueField: '',
    changeTypeField: '',
    changeSummaryField: '',
    actions: defaultActionsForType(type),
    status: 'active'
  };
}

function flattenJsonSchemaToOutputFields(jsonSchema = {}) {
  const schema = isPlainObject(jsonSchema) ? jsonSchema : {};
  const fields = [];
  const requiredPaths = new Set();

  function walk(prop, path, isRequired) {
    const type = cleanText(prop?.type).toLowerCase();
    if (type === 'object') {
      const properties = isPlainObject(prop.properties) ? prop.properties : {};
      const childKeys = Object.keys(properties);
      const childRequired = Array.isArray(prop.required) ? prop.required : [];
      if (!childKeys.length) {
        const field = inferFieldFromSchema(path, prop, isRequired);
        fields.push(field);
        if (field.required) requiredPaths.add(path);
        return;
      }
      childKeys.forEach((key) => {
        walk(properties[key], joinResultPath(path, key), childRequired.includes(key));
      });
      return;
    }
    const field = inferFieldFromSchema(path, prop, isRequired);
    fields.push(field);
    if (field.required) requiredPaths.add(path);
  }

  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const rootRequired = Array.isArray(schema.required) ? schema.required : [];
  Object.keys(properties).forEach((key) => {
    walk(properties[key], key, rootRequired.includes(key));
  });

  return { fields, requiredPaths };
}

function inferFieldsFromJsonSchema(jsonSchema = {}) {
  return flattenJsonSchemaToOutputFields(jsonSchema).fields;
}

function schemaLeafKeys(jsonSchema) {
  return new Set(flattenJsonSchemaToOutputFields(jsonSchema).fields.map((row) => row.resultKey));
}

function inferredFieldMap(jsonSchema) {
  const { fields } = flattenJsonSchemaToOutputFields(jsonSchema);
  return new Map(fields.map((row) => [row.resultKey, row]));
}

function isLegacyParentOutputRow(row, leafKeys) {
  const key = cleanText(row?.resultKey);
  if (!key || key.includes('.')) return false;
  for (const leaf of leafKeys) {
    if (String(leaf).startsWith(`${key}.`)) return true;
  }
  return false;
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

function compareOutputsToSchema(outputs = [], jsonSchema = {}) {
  const normalized = normalizeOutputsList(outputs);
  const leafKeys = schemaLeafKeys(jsonSchema);
  const inferredByKey = inferredFieldMap(jsonSchema);
  const outputByKey = new Map(normalized.map((row) => [row.resultKey, row]));

  const newKeys = [...leafKeys]
    .filter((key) => !outputByKey.has(key))
    .map((key) => inferredByKey.get(key))
    .filter(Boolean);

  const staleKeys = normalized
    .filter((row) => {
      if (String(row.type).toLowerCase() === LEGACY_OBJECT_TYPE) return true;
      if (isLegacyParentOutputRow(row, leafKeys)) return true;
      return !leafKeys.has(row.resultKey);
    })
    .map((row) => ({
      ...row,
      suggestedStatus: 'schema_missing'
    }));

  const typeChanges = [];
  const requiredChanges = [];
  normalized.forEach((row) => {
    if (!leafKeys.has(row.resultKey)) return;
    const inferred = inferredByKey.get(row.resultKey);
    if (!inferred) return;
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

function buildSectionsFromReportUi(jsonSchema) {
  const rawUi = jsonSchema?.['x-reportUi'];
  if (!isPlainObject(rawUi) || !Array.isArray(rawUi.sections)) return null;
  const sections = rawUi.sections.map((row) => {
    if (!isPlainObject(row)) return null;
    const resultKey = cleanText(row.resultKey);
    if (!resultKey) return null;
    const actions = Array.isArray(row.actions)
      ? row.actions.map((a) => cleanText(a).toLowerCase()).filter(Boolean)
      : [];
    return {
      resultKey,
      title: cleanText(row.title) || resultKey,
      actions: actions.length ? actions : ['copy', 'apply'],
      inputId: cleanText(row.inputId) || resultKey,
      valueField: cleanText(row.valueField) || '',
      changeTypeField: cleanText(row.changeTypeField) || 'changeType',
      changeSummaryField: cleanText(row.changeSummaryField) || 'changeSummary'
    };
  }).filter(Boolean);
  if (!sections.length) return null;
  return {
    layout: cleanText(rawUi.layout) || 'sections',
    sections
  };
}

function buildGroupedSectionsFromFlatOutputs(rows) {
  const byParent = new Map();
  const orphans = [];

  rows.forEach((row) => {
    const parts = String(row.resultKey || '').split('.');
    if (parts.length > 1) {
      const parent = parts[0];
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(row);
    } else {
      orphans.push(row);
    }
  });

  const sections = [];
  for (const [parent, children] of byParent) {
    const suffixes = new Set(children.map((c) => c.resultKey.slice(parent.length + 1)));
    const hasRevisionBundle = suffixes.has('revised')
      && (suffixes.has('changeType') || suffixes.has('changeSummary'));
    if (hasRevisionBundle) {
      const revisedRow = children.find((c) => c.resultKey.endsWith('.revised'));
      sections.push({
        resultKey: parent,
        title: revisedRow?.label?.replace(/\s+—\s+Revised$/i, '')?.replace(/\s+Revised$/i, '')
          || humanizeResultKey(parent),
        actions: ['copy', 'apply'],
        inputId: parent,
        valueField: 'revised',
        changeTypeField: 'changeType',
        changeSummaryField: 'changeSummary'
      });
    } else {
      children.forEach((row) => {
        sections.push({
          resultKey: row.resultKey,
          title: row.label || row.resultKey,
          actions: row.actions?.length ? [...row.actions] : defaultActionsForType(row.type),
          inputId: row.resultKey,
          valueField: '',
          changeTypeField: 'changeType',
          changeSummaryField: 'changeSummary'
        });
      });
    }
  }

  orphans.forEach((row) => {
    sections.push({
      resultKey: row.resultKey,
      title: row.label || row.resultKey,
      actions: row.actions?.length ? [...row.actions] : defaultActionsForType(row.type),
      inputId: row.resultKey,
      valueField: '',
      changeTypeField: 'changeType',
      changeSummaryField: 'changeSummary'
    });
  });

  return sections;
}

function buildReportUiFromOutputs(outputs = [], jsonSchema = null) {
  const fromSchema = jsonSchema ? buildSectionsFromReportUi(jsonSchema) : null;
  if (fromSchema) return fromSchema;

  const rows = normalizeOutputsList(outputs).filter((row) => row.status !== 'schema_missing');
  if (!rows.length) return null;

  const sections = buildGroupedSectionsFromFlatOutputs(rows);
  if (!sections.length) return null;
  return { layout: 'sections', sections };
}

function getValueAtResultPath(data, resultKey) {
  const path = cleanText(resultKey);
  if (!path) return undefined;
  if (!data || typeof data !== 'object') return undefined;
  if (!path.includes('.')) return data[path];
  let cur = data;
  for (const segment of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[segment];
  }
  return cur;
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
  const schema = isPlainObject(jsonSchema) ? jsonSchema : {};
  const formUi = schema['x-formUi'];
  const inferred = inferFieldsFromJsonSchema(schema);
  const byKey = new Map(inferred.map((row) => [row.resultKey, row]));

  if (formUi && Array.isArray(formUi.fields)) {
    formUi.fields.forEach((uiRow) => {
      const resultKey = cleanText(uiRow?.resultKey);
      if (!resultKey) return;
      const base = byKey.get(resultKey);
      if (!base) return;
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

  return normalizeOutputsList([...byKey.values()]);
}

function buildAiAssistDisplayUnits(definition = {}, reportUi = null) {
  const outputs = sanitizeDefinitionOutputsForClient(definition).filter((row) => row.status !== 'schema_missing');
  const outputByKey = new Map(outputs.map((row) => [row.resultKey, row]));
  const units = [];
  const coveredApplyKeys = new Set();

  const sections = reportUi?.layout === 'sections' && Array.isArray(reportUi.sections)
    ? reportUi.sections
    : [];

  sections.forEach((section) => {
    const resultKey = cleanText(section?.resultKey);
    if (!resultKey) return;
    const valueField = cleanText(section?.valueField);
    const dotApplyKey = valueField ? joinResultPath(resultKey, valueField) : resultKey;
    let applyBindingKey = dotApplyKey;
    if (valueField && outputByKey.has(dotApplyKey)) {
      applyBindingKey = dotApplyKey;
    } else if (outputByKey.has(resultKey)) {
      applyBindingKey = resultKey;
    } else {
      applyBindingKey = dotApplyKey;
    }
    const actions = Array.isArray(section?.actions)
      ? section.actions.map((a) => cleanText(a).toLowerCase()).filter(Boolean)
      : ['copy', 'apply'];
    units.push({
      mode: 'section',
      unitKey: resultKey,
      title: cleanText(section?.title) || resultKey,
      resultKey,
      applyBindingKey,
      inputId: cleanText(section?.inputId) || resultKey,
      valueField: valueField || '',
      changeTypeField: cleanText(section?.changeTypeField) || 'changeType',
      changeSummaryField: cleanText(section?.changeSummaryField) || 'changeSummary',
      actions: actions.length ? actions : ['copy', 'apply']
    });
    if (actions.includes('apply')) coveredApplyKeys.add(applyBindingKey);
  });

  outputs.forEach((row) => {
    const resultKey = cleanText(row.resultKey);
    if (!resultKey) return;
    const actions = Array.isArray(row.actions) && row.actions.length
      ? row.actions.map((a) => cleanText(a).toLowerCase()).filter(Boolean)
      : defaultActionsForType(row.type);
    const hasDisplayAction = actions.includes('copy') || actions.includes('apply');
    if (!hasDisplayAction) return;
    if (coveredApplyKeys.has(resultKey)) return;
    const parentPrefix = resultKey.includes('.') ? `${resultKey.split('.')[0]}.` : '';
    const coveredBySection = sections.some((sec) => {
      const sk = cleanText(sec?.resultKey);
      if (!sk) return false;
      if (sk === resultKey) return true;
      if (parentPrefix && resultKey.startsWith(`${sk}.`)) {
        const vf = cleanText(sec?.valueField);
        if (vf && coveredApplyKeys.has(joinResultPath(sk, vf))) return true;
        return actions.includes('apply') && !vf;
      }
      return false;
    });
    if (coveredBySection && actions.includes('apply')) return;
    const alreadyUnit = units.some((u) => u.mode === 'leaf' && u.unitKey === resultKey);
    if (alreadyUnit) return;
    units.push({
      mode: 'leaf',
      unitKey: resultKey,
      title: cleanText(row.label) || resultKey,
      resultKey,
      applyBindingKey: resultKey,
      inputId: resultKey,
      valueField: '',
      changeTypeField: 'changeType',
      changeSummaryField: 'changeSummary',
      actions
    });
    if (actions.includes('apply')) coveredApplyKeys.add(resultKey);
  });

  return units;
}

module.exports = {
  OUTPUT_TYPES,
  LEGACY_OBJECT_TYPE,
  OUTPUT_STATUSES,
  cleanResultKey,
  getValueAtResultPath,
  flattenJsonSchemaToOutputFields,
  inferFieldsFromJsonSchema,
  inferFieldFromSchema,
  normalizeOutputField,
  normalizeOutputsList,
  compareOutputsToSchema,
  applySyncChoices,
  buildReportUiFromOutputs,
  buildAiAssistDisplayUnits,
  sanitizeDefinitionOutputsForClient,
  validateTemplateOutputBindings,
  outputsFromFormUiAndReportUi
};