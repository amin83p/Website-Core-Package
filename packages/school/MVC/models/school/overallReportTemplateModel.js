const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportTemplateModel = require('./reportTemplateModel');
const reportRuleEngineService = require('../../services/school/reportRuleEngineService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/overallReportTemplates.json');
if (!fsSync.existsSync(dataPath)) fsSync.writeFileSync(dataPath, '[]');

const TEMPLATE_STATUSES = new Set(['draft', 'active', 'inactive', 'archived']);
const OVERALL_VALUE_MODES = new Set(['manual', 'derived_editable', 'derived_locked']);
const SLOT_KEY_PATTERN = /^T[1-9]\d*$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clean(value, max = 4000) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { allowEmpty = false, max = 80 } = {}) {
  const text = clean(value, max);
  if (!text && allowEmpty) return '';
  if (!text || !/^[A-Za-z0-9:_-]+$/.test(text)) throw new Error('Invalid id format.');
  return text;
}

function cleanInteger(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 1000000) return fallback;
  return number;
}

function clonePlain(value, fallback = null) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function sanitizeSourceSlots(rawSlots) {
  const rows = Array.isArray(rawSlots) ? rawSlots : [];
  if (rows.length < 1) throw new Error('Overall report templates require at least one source template slot.');
  const seen = new Set();
  return rows.map((raw, index) => {
    const slotKey = clean(raw?.slotKey || `T${index + 1}`, 30).toUpperCase();
    if (!SLOT_KEY_PATTERN.test(slotKey)) throw new Error(`Invalid source slot key "${slotKey}".`);
    if (seen.has(slotKey)) throw new Error(`Duplicate source slot key "${slotKey}".`);
    seen.add(slotKey);
    return {
      slotKey,
      order: cleanInteger(raw?.order, index + 1),
      templateId: cleanId(raw?.templateId),
      templateVersionAtSelection: cleanInteger(raw?.templateVersionAtSelection || raw?.templateVersion, 1)
    };
  }).sort((a, b) => a.order - b.order || a.slotKey.localeCompare(b.slotKey))
    .map((row, index) => ({ ...row, order: index + 1 }));
}

function extractSourceReferences(expression = '') {
  const text = String(expression || '');
  const refs = [];
  const regex = /source\s*\(\s*(["'])(T[1-9]\d*)\1\s*,\s*(["'])([^"'\\]+)\3\s*\)/gi;
  let match;
  while ((match = regex.exec(text))) {
    refs.push({ slotKey: String(match[2]).toUpperCase(), key: clean(match[4], 180) });
  }
  const callCount = (text.match(/\bsource\s*\(/gi) || []).length;
  if (callCount !== refs.length) {
    throw new Error('source() requires literal slot and key arguments, for example source("T1", "score").');
  }
  return refs;
}

function extractAnswerDependencies(expression = '') {
  const deps = [];
  const seen = new Set();
  const regex = /\banswers\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let match;
  while ((match = regex.exec(String(expression || '')))) {
    const fieldId = String(match[1]);
    if (seen.has(fieldId)) continue;
    seen.add(fieldId);
    deps.push(fieldId);
  }
  return deps;
}

function assertNoCalculationCycles(fields = []) {
  const derived = new Map(
    fields
      .filter((field) => String(field?.overallValueMode || 'manual') !== 'manual')
      .map((field) => [String(field.id), field])
  );
  const state = new Map();
  const stack = [];
  function visit(fieldId) {
    const status = state.get(fieldId) || 0;
    if (status === 2) return;
    if (status === 1) {
      const start = stack.indexOf(fieldId);
      throw new Error(`Overall field calculation cycle detected: ${stack.slice(start).concat(fieldId).join(' -> ')}.`);
    }
    state.set(fieldId, 1);
    stack.push(fieldId);
    const field = derived.get(fieldId);
    (field?.calculationDependencies || []).forEach((dependencyId) => {
      if (derived.has(dependencyId)) visit(dependencyId);
    });
    stack.pop();
    state.set(fieldId, 2);
  }
  derived.forEach((_, fieldId) => visit(fieldId));
}

function sanitizeSchema(rawSchema, sourceSlots, inputPlaceholderMap = {}) {
  const raw = isObject(rawSchema) ? rawSchema : {};
  const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
  const mappedFields = rawFields.map((field) => ({
    ...(field || {}),
    valueMode: 'manual',
    calculationRule: { enabled: false, expression: '', onError: 'keep_last' },
    calculationDependencies: []
  }));
  const base = reportTemplateModel.sanitizeTemplate({
    orgId: 'overall-schema',
    type: 'overall_report',
    version: 1,
    title: 'Overall report schema',
    status: 'draft',
    description: '',
    schema: { version: cleanInteger(raw.version, 1), fields: mappedFields },
    placeholderMap: inputPlaceholderMap || {},
    docxTemplatesByFunder: []
  });
  const slotKeys = new Set(sourceSlots.map((slot) => slot.slotKey));
  const fieldIds = new Set(base.schema.fields.map((field) => String(field.id)));
  const fields = base.schema.fields.map((field, index) => {
    const original = rawFields[index] || {};
    const visual = ['section', 'subheader', 'row_break'].includes(String(field.type));
    const requestedMode = clean(original.overallValueMode || original.valueMode || 'manual', 30).toLowerCase();
    const overallValueMode = visual ? 'manual' : requestedMode;
    if (!OVERALL_VALUE_MODES.has(overallValueMode)) {
      throw new Error(`Invalid value mode for overall field "${field.label || field.id}".`);
    }
    const expression = overallValueMode === 'manual'
      ? ''
      : clean(original?.calculationRule?.expression || original?.expression, 20000);
    if (overallValueMode !== 'manual' && !expression) {
      throw new Error(`Derived overall field "${field.label || field.id}" requires a calculation expression.`);
    }
    if (expression) {
      reportRuleEngineService.validateExpressionSyntax(expression);
      reportRuleEngineService.validateExpressionSymbols(expression, {
        additionalHelpers: ['source'],
        allowedRoots: ['value', 'answers']
      });
    }
    const sourceReferences = expression ? extractSourceReferences(expression) : [];
    sourceReferences.forEach((reference) => {
      if (!slotKeys.has(reference.slotKey)) {
        throw new Error(`Overall field "${field.label || field.id}" references unknown source slot "${reference.slotKey}".`);
      }
    });
    const calculationDependencies = expression ? extractAnswerDependencies(expression) : [];
    calculationDependencies.forEach((dependencyId) => {
      if (!fieldIds.has(dependencyId)) {
        throw new Error(`Overall field "${field.label || field.id}" references unknown field "${dependencyId}".`);
      }
      if (dependencyId === field.id) throw new Error(`Overall field "${field.label || field.id}" cannot depend on itself.`);
    });
    return {
      ...field,
      readOnly: visual ? false : overallValueMode === 'derived_locked',
      overallValueMode,
      defaultValue: visual ? '' : clonePlain(original.defaultValue, ''),
      calculationRule: overallValueMode === 'manual'
        ? { enabled: false, expression: '', onError: 'keep_last' }
        : {
            enabled: true,
            expression,
            onError: ['empty', 'keep_last'].includes(String(original?.calculationRule?.onError || 'keep_last'))
              ? String(original.calculationRule.onError || 'keep_last')
              : 'keep_last'
          },
      calculationDependencies,
      sourceReferences
    };
  });
  assertNoCalculationCycles(fields);
  const placeholderMap = {};
  fields.forEach((field) => {
    if (['section', 'subheader', 'row_break'].includes(String(field.type))) return;
    placeholderMap[field.id] = `{{O.${field.id}}}`;
  });
  return { schema: { version: cleanInteger(raw.version, 1), fields }, placeholderMap };
}

function sanitizeTemplate(input, { existing = null, isUpdate = false } = {}) {
  if (!isObject(input)) throw new Error('Invalid overall report template payload.');
  const orgId = cleanId(input.orgId);
  const title = clean(input.title, 180);
  if (!title) throw new Error('Overall report template title is required.');
  const status = clean(input.status || 'draft', 20).toLowerCase();
  if (!TEMPLATE_STATUSES.has(status)) throw new Error('Invalid overall report template status.');
  const sourceSlots = sanitizeSourceSlots(input.sourceSlots);
  const maxSlotNumber = Math.max(...sourceSlots.map((slot) => Number(slot.slotKey.slice(1)) || 0));
  const nextSlotNumber = Math.max(cleanInteger(input.nextSlotNumber, maxSlotNumber + 1), maxSlotNumber + 1);
  const normalizedSchema = sanitizeSchema(input.schema, sourceSlots, input.placeholderMap);
  const docxTemplate = reportTemplateModel.sanitizeDocxTemplate(input.docxTemplate)
    || reportTemplateModel.sanitizeDocxTemplate(existing?.docxTemplate);
  const docxTemplatesByFunder = reportTemplateModel.sanitizeDocxTemplatesByFunder(
    input.docxTemplatesByFunder,
    existing?.docxTemplatesByFunder
  );
  const now = new Date().toISOString();
  const out = {
    orgId,
    title,
    version: cleanInteger(input.version, 1),
    status,
    description: clean(input.description, 4000),
    sourceSlots,
    nextSlotNumber,
    schema: normalizedSchema.schema,
    placeholderMap: normalizedSchema.placeholderMap,
    docxTemplate,
    docxTemplatesByFunder,
    audit: {
      createUser: clean(input?.audit?.createUser || existing?.audit?.createUser, 80),
      createDateTime: clean(input?.audit?.createDateTime || existing?.audit?.createDateTime, 60) || now,
      lastUpdateUser: clean(input?.audit?.lastUpdateUser, 80),
      lastUpdateDateTime: clean(input?.audit?.lastUpdateDateTime, 60) || now
    }
  };
  if (!isUpdate && input.id) out.id = cleanId(input.id);
  return out;
}

async function getAllTemplates() {
  try {
    return JSON.parse(await fs.readFile(dataPath, 'utf8') || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function getTemplateById(id) {
  return (await getAllTemplates()).find((row) => idsEqual(row?.id, id)) || null;
}

function generateId(existingIds) {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i += 1) {
    const id = `OVRTPL-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (!existingIds.has(id)) return id;
  }
  return `OVRTPL-${Date.now()}`;
}

async function addTemplate(input) {
  return queueWrite(async () => {
    const rows = await getAllTemplates();
    const record = sanitizeTemplate(input);
    const ids = new Set(rows.map((row) => toPublicId(row?.id)).filter(Boolean));
    record.id = record.id || generateId(ids);
    if (ids.has(record.id)) throw new Error('Overall report template id already exists.');
    rows.push(record);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return record;
  });
}

async function updateTemplate(id, updates) {
  return queueWrite(async () => {
    const rows = await getAllTemplates();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Overall report template not found.');
    const existing = rows[index];
    rows[index] = {
      ...existing,
      ...sanitizeTemplate({ ...existing, ...updates }, { existing, isUpdate: true }),
      id: existing.id
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteTemplate(id) {
  return queueWrite(async () => {
    const rows = await getAllTemplates();
    await fs.writeFile(dataPath, JSON.stringify(rows.filter((row) => !idsEqual(row?.id, id)), null, 2));
  });
}

module.exports = {
  TEMPLATE_STATUSES: Object.freeze([...TEMPLATE_STATUSES]),
  OVERALL_VALUE_MODES: Object.freeze([...OVERALL_VALUE_MODES]),
  SLOT_KEY_PATTERN,
  extractSourceReferences,
  extractAnswerDependencies,
  sanitizeTemplate,
  getAllTemplates,
  getTemplateById,
  addTemplate,
  updateTemplate,
  deleteTemplate
};
