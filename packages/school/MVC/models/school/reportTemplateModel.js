const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/MVC/utils/idAdapter');
const reportRuleEngineService = require('../../services/school/reportRuleEngineService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/reportTemplates.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const TEMPLATE_STATUSES = new Set(['draft', 'active', 'inactive', 'archived']);
const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'section', 'subheader', 'row_break']);
const VISUAL_ONLY_FIELD_TYPES = new Set(['section', 'subheader', 'row_break']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 80, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanInteger(v, { min = 1, max = 1000000, allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('Invalid integer value.');
  if (n < min || n > max) throw new Error('Integer out of range.');
  return n;
}

function cleanHexColor(v, { allowEmpty = true } = {}) {
  const raw = cleanString(v, { max: 7, allowEmpty: true });
  if (!raw) return allowEmpty ? '' : null;
  if (!/^#(?:[0-9A-Fa-f]{6})$/.test(raw)) throw new Error('Invalid color format.');
  return raw.toLowerCase();
}

function cleanOption(v, index) {
  if (isPlainObject(v)) {
    const value = cleanString(v.value, { max: 120, allowEmpty: false });
    const label = cleanString(v.label, { max: 160, allowEmpty: false }) || value;
    return { value, label, order: index + 1 };
  }
  const asText = cleanString(v, { max: 120, allowEmpty: false });
  return { value: asText, label: asText, order: index + 1 };
}

function sanitizeValidationRule(rawRule, index) {
  const normalized = reportRuleEngineService.normalizeValidationRule(rawRule, index);
  if (normalized.id.length > 80) throw new Error('Validation rule id is too long.');
  if (normalized.expression.length > reportRuleEngineService.MAX_EXPRESSION_LENGTH) {
    throw new Error(`Validation expression is too long for rule "${normalized.id}".`);
  }
  return {
    id: normalized.id,
    enabled: normalized.enabled,
    severity: normalized.severity,
    when: normalized.when,
    expression: normalized.expression,
    message: cleanString(normalized.message, { max: 300, allowEmpty: true })
  };
}

function sanitizeValidationRules(rawRules) {
  const rows = Array.isArray(rawRules) ? rawRules : [];
  const out = [];
  const idSet = new Set();
  rows.slice(0, 25).forEach((rule, index) => {
    const normalized = sanitizeValidationRule(rule, index);
    const key = String(normalized.id || '').toLowerCase();
    if (idSet.has(key)) throw new Error(`Duplicate validation rule id "${normalized.id}".`);
    idSet.add(key);
    out.push(normalized);
  });
  return out;
}

function sanitizeConversionRule(rawRule) {
  const normalized = reportRuleEngineService.normalizeConversionRule(rawRule || {});
  if (normalized.expression.length > reportRuleEngineService.MAX_EXPRESSION_LENGTH) {
    throw new Error('Conversion expression is too long.');
  }
  return {
    enabled: normalized.enabled,
    expression: normalized.expression,
    onError: normalized.onError
  };
}

function sanitizeCalculationRule(rawRule) {
  const normalized = reportRuleEngineService.normalizeCalculationRule(rawRule || {});
  const maxCalcExpressionLength = Number(reportRuleEngineService.MAX_CALCULATION_EXPRESSION_LENGTH || 0);
  if (maxCalcExpressionLength > 0 && normalized.expression.length > maxCalcExpressionLength) {
    throw new Error('Calculation expression is too long.');
  }
  return {
    enabled: normalized.enabled,
    expression: normalized.expression,
    onError: normalized.onError
  };
}

function sanitizeCalculationDependencies(rawDependencies) {
  return reportRuleEngineService.normalizeCalculationDependencies(rawDependencies || []);
}

function isVisualOnlyType(type) {
  return VISUAL_ONLY_FIELD_TYPES.has(String(type || '').trim().toLowerCase());
}

function sanitizeField(rawField, index) {
  if (!isPlainObject(rawField)) throw new Error('Each field row must be an object.');

  const type = cleanString(rawField.type, { max: 30, allowEmpty: true }).toLowerCase() || 'text';
  const visualOnly = isVisualOnlyType(type);
  const fallbackVisualId = `__${type}_${index + 1}`;
  const id = visualOnly
    ? (cleanId(rawField.id, { max: 80, allowEmpty: true }) || fallbackVisualId)
    : cleanId(rawField.id, { max: 80, allowEmpty: false });
  const label = cleanString(rawField.label, { max: 180, allowEmpty: false });
  if (!FIELD_TYPES.has(type)) throw new Error(`Unsupported field type for "${id}".`);

  const options = type === 'select'
    ? (Array.isArray(rawField.options) ? rawField.options : []).map(cleanOption)
    : [];
  if (type === 'select' && options.length === 0) {
    throw new Error(`Select field "${id}" must include at least one option.`);
  }

  const valueMode = visualOnly ? 'manual' : reportRuleEngineService.normalizeValueMode(rawField.valueMode);
  const calculationRule = visualOnly
    ? sanitizeCalculationRule({ enabled: false, expression: '', onError: 'keep_last' })
    : sanitizeCalculationRule(rawField.calculationRule);
  const calculationDependencies = visualOnly ? [] : sanitizeCalculationDependencies(rawField.calculationDependencies);
  if (!visualOnly && valueMode === 'calculated') {
    if (!calculationRule.expression) throw new Error(`Calculated field "${id}" must include calculation expression.`);
    if (calculationDependencies.length === 0) throw new Error(`Calculated field "${id}" must include dependencies.`);
  }

  return {
    id,
    label,
    type,
    required: rawField.required === true || String(rawField.required) === 'true',
    sharedAcrossStudents: rawField.sharedAcrossStudents === true || String(rawField.sharedAcrossStudents) === 'true',
    readOnly: (rawField.readOnly === true || String(rawField.readOnly) === 'true') || valueMode === 'calculated',
    fullPageWidth:
      rawField.fullPageWidth === true ||
      String(rawField.fullPageWidth) === 'true' ||
      rawField.fullWidth === true ||
      String(rawField.fullWidth) === 'true',
    valueMode,
    calculationRule: valueMode === 'calculated'
      ? {
          enabled: true,
          expression: calculationRule.expression,
          onError: calculationRule.onError
        }
      : sanitizeCalculationRule({ enabled: false, expression: '', onError: 'keep_last' }),
    calculationDependencies: valueMode === 'calculated' ? calculationDependencies : [],
    hasBorder: visualOnly ? false : (rawField.hasBorder === true || String(rawField.hasBorder) === 'true'),
    backgroundColor: visualOnly ? '' : cleanHexColor(rawField.backgroundColor, { allowEmpty: true }),
    helpText: cleanString(rawField.helpText, { max: 400, allowEmpty: true }),
    placeholder: cleanString(rawField.placeholder, { max: 200, allowEmpty: true }),
    prefillKey: cleanString(rawField.prefillKey, { max: 120, allowEmpty: true }),
    options,
    validationRules: visualOnly ? [] : sanitizeValidationRules(rawField.validationRules),
    conversionRule: visualOnly ? sanitizeConversionRule({ enabled: false, expression: '', onError: 'use_raw' }) : sanitizeConversionRule(rawField.conversionRule)
  };
}

function sanitizeSchema(v) {
  const raw = isPlainObject(v) ? v : {};
  const fieldsRaw = Array.isArray(raw.fields) ? raw.fields : [];
  const fieldIds = new Set();
  const fields = fieldsRaw.map((field, index) => {
    const normalized = sanitizeField(field, index);
    if (fieldIds.has(normalized.id)) throw new Error(`Duplicate field id "${normalized.id}".`);
    fieldIds.add(normalized.id);
    return normalized;
  });

  reportRuleEngineService.buildCalculatedFieldPlan({ schema: { fields } }, { strict: true });

  return {
    version: cleanInteger(raw.version, { min: 1, max: 1000, allowEmpty: true }) || 1,
    fields
  };
}

function sanitizePlaceholderMap(v, schema) {
  const out = {};
  const raw = isPlainObject(v) ? v : {};
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const dataFields = fields.filter((f) => !isVisualOnlyType(f?.type));
  const allowedFieldIds = new Set(dataFields.map((f) => String(f.id)));

  Object.keys(raw).forEach((key) => {
    const fieldId = cleanId(key, { max: 80, allowEmpty: false });
    if (!allowedFieldIds.has(fieldId)) return;
    const placeholderValue = cleanString(raw[key], { max: 180, allowEmpty: true });
    if (!placeholderValue) return;
    out[fieldId] = placeholderValue;
  });

  dataFields.forEach((field) => {
    if (!out[field.id]) out[field.id] = `{{${field.id}}}`;
  });

  return out;
}

function sanitizeDocxTemplate(v) {
  if (!isPlainObject(v)) return null;
  const fileName = cleanString(v.fileName || v.filename, { max: 260, allowEmpty: false });
  const originalName = cleanString(v.originalName, { max: 260, allowEmpty: true });
  const pathValue = cleanString(v.path, { max: 600, allowEmpty: true });
  const url = cleanString(v.url, { max: 600, allowEmpty: true });
  const uploadedAt = cleanString(v.uploadedAt, { max: 40, allowEmpty: true }) || new Date().toISOString();

  return {
    fileName,
    originalName,
    path: pathValue,
    url,
    uploadedAt
  };
}

function sanitizeAudit(v, existingAudit = {}) {
  const raw = isPlainObject(v) ? v : {};
  return {
    createUser: cleanString(raw.createUser || existingAudit.createUser, { max: 80, allowEmpty: true }),
    createDateTime: cleanString(raw.createDateTime || existingAudit.createDateTime, { max: 60, allowEmpty: true }) || new Date().toISOString(),
    lastUpdateUser: cleanString(raw.lastUpdateUser, { max: 80, allowEmpty: true }),
    lastUpdateDateTime: cleanString(raw.lastUpdateDateTime, { max: 60, allowEmpty: true })
  };
}

function sanitizeTemplate(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid report template payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const type = cleanString(input.type, { max: 80, allowEmpty: false }).toLowerCase();
  const title = cleanString(input.title, { max: 180, allowEmpty: false });
  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';
  if (!TEMPLATE_STATUSES.has(status)) throw new Error('Invalid template status.');

  const version = cleanInteger(input.version, { min: 1, max: 1000, allowEmpty: true }) || 1;
  const schema = sanitizeSchema(input.schema);
  const placeholderMap = sanitizePlaceholderMap(input.placeholderMap, schema);

  const out = {
    orgId,
    type,
    version,
    title,
    status,
    description: cleanString(input.description, { max: 4000, allowEmpty: true }),
    schema,
    placeholderMap,
    docxTemplate: sanitizeDocxTemplate(input.docxTemplate) || sanitizeDocxTemplate(existing?.docxTemplate),
    audit: sanitizeAudit(input.audit, existing?.audit || {})
  };

  if (!isUpdate && input.id) out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  return out;
}

function generateTemplateId(existingIds) {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i++) {
    const candidate = `RPTTPL-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `RPTTPL-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function getAllTemplates() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve report templates.');
  }
}

async function getTemplateById(id) {
  const all = await getAllTemplates();
  return all.find((row) => idsEqual(row.id, id)) || null;
}

function assertUniqueInOrg(list, candidate, { excludeId = null } = {}) {
  const duplicateVersion = list.some((row) => {
    if (excludeId && idsEqual(row.id, excludeId)) return false;
    return (
      idsEqual(row.orgId, candidate.orgId) &&
      String(row.type || '').toLowerCase() === String(candidate.type || '').toLowerCase() &&
      Number(row.version || 0) === Number(candidate.version || 0)
    );
  });
  if (duplicateVersion) {
    throw new Error(`Template version already exists for type "${candidate.type}" in this organization.`);
  }
}

async function addTemplate(input) {
  return queueWrite(async () => {
    const all = await getAllTemplates();
    const sanitized = sanitizeTemplate(input, { isUpdate: false });
    assertUniqueInOrg(all, sanitized);

    const existingIds = new Set(all.map((row) => toPublicId(row.id)).filter(Boolean));
    const id = sanitized.id || generateTemplateId(existingIds);
    if (existingIds.has(id)) throw new Error('Template id already exists.');

    const record = {
      ...sanitized,
      id,
      audit: {
        ...sanitized.audit,
        createDateTime: sanitized.audit.createDateTime || new Date().toISOString()
      }
    };

    all.push(record);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return record;
  });
}

async function updateTemplate(id, updates) {
  return queueWrite(async () => {
    const all = await getAllTemplates();
    const index = all.findIndex((row) => idsEqual(row.id, id));
    if (index === -1) throw new Error('Report template not found.');

    const existing = all[index];
    const mergedInput = { ...existing, ...updates };
    const sanitized = sanitizeTemplate(mergedInput, { isUpdate: true, existing });

    assertUniqueInOrg(all, sanitized, { excludeId: id });

    all[index] = {
      ...existing,
      ...sanitized,
      id: existing.id,
      audit: {
        ...existing.audit,
        ...sanitized.audit,
        createDateTime: existing.audit?.createDateTime || sanitized.audit?.createDateTime || new Date().toISOString(),
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteTemplate(id) {
  return queueWrite(async () => {
    const all = await getAllTemplates();
    const filtered = all.filter((row) => !idsEqual(row.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  TEMPLATE_STATUSES: Object.freeze([...TEMPLATE_STATUSES]),
  FIELD_TYPES: Object.freeze([...FIELD_TYPES]),
  getAllTemplates,
  getTemplateById,
  addTemplate,
  updateTemplate,
  deleteTemplate
};
