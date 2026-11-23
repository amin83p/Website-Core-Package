'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getAiServiceByKey } = require('../../config/schoolAiServiceRegistry');
const {
  isPlainObject,
  hasOwn,
  cleanString,
  cleanId,
  normalizeBoolean,
  cleanIsoDateTime,
  generateDatedId,
  buildAudit
} = require('../../services/school/schoolAiModelUtils');

const DATA_PATH = path.join(resolveCoreRoot(), 'data/school/schoolAiServiceDefinitions.json');
const ID_PREFIX = 'SCHAIDEF';

const INPUT_TYPES = new Set(['text', 'textarea', 'number', 'boolean', 'select', 'json']);
const OUTPUT_MODES = new Set(['text', 'markdown', 'json']);

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function cleanInputId(raw = '') {
  const token = cleanString(raw, { max: 80, allowEmpty: true });
  if (!token) return '';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
    throw new Error(`Invalid input id "${token}". Use letters, numbers, and underscores; start with a letter or underscore.`);
  }
  return token;
}

function normalizeSelectOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (typeof row === 'string') {
        const value = cleanString(row, { max: 200, allowEmpty: true });
        return value ? { value, label: value } : null;
      }
      if (!isPlainObject(row)) return null;
      const value = cleanString(row.value, { max: 200, allowEmpty: true });
      if (!value) return null;
      const label = cleanString(row.label, { max: 200, allowEmpty: true }) || value;
      return { value, label };
    })
    .filter(Boolean);
}

function normalizeInputField(raw = {}, index = 0) {
  const input = isPlainObject(raw) ? raw : {};
  const id = cleanInputId(input.id || `input_${index + 1}`);
  const typeRaw = cleanString(input.type, { max: 40, allowEmpty: true }).toLowerCase() || 'text';
  const type = INPUT_TYPES.has(typeRaw) ? typeRaw : 'text';
  const label = cleanString(input.label, { max: 220, allowEmpty: true }) || id;
  const required = normalizeBoolean(input.required, false);
  const helpText = cleanString(input.helpText, { max: 2000, allowEmpty: true }) || '';
  const defaultValue = input.defaultValue !== undefined && input.defaultValue !== null
    ? String(input.defaultValue)
    : '';
  const options = type === 'select' ? normalizeSelectOptions(input.options) : [];
  return { id, label, type, required, helpText, defaultValue, options };
}

function normalizeInputsList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return list.map((row, index) => {
    const field = normalizeInputField(row, index);
    if (seen.has(field.id)) {
      throw new Error(`Duplicate input id "${field.id}".`);
    }
    seen.add(field.id);
    return field;
  });
}

function normalizePromptBlock(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const base = isPlainObject(existing) ? existing : {};
  return {
    systemPrompt: cleanString(input.systemPrompt ?? base.systemPrompt, { max: 32000, allowEmpty: true }) || '',
    userPromptTemplate: cleanString(input.userPromptTemplate ?? base.userPromptTemplate, { max: 32000, allowEmpty: true }) || ''
  };
}

function normalizeOutputBlock(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const base = isPlainObject(existing) ? existing : {};
  const modeRaw = cleanString(input.mode ?? base.mode, { max: 40, allowEmpty: true }).toLowerCase() || 'markdown';
  const mode = OUTPUT_MODES.has(modeRaw) ? modeRaw : 'markdown';
  let jsonSchema = input.jsonSchema !== undefined ? input.jsonSchema : base.jsonSchema;
  if (jsonSchema === '' || jsonSchema === null) jsonSchema = null;
  if (jsonSchema !== null && jsonSchema !== undefined && !isPlainObject(jsonSchema)) {
    throw new Error('Output JSON schema must be a JSON object when provided.');
  }
  return {
    mode,
    jsonSchema: jsonSchema && isPlainObject(jsonSchema) ? jsonSchema : null,
    jsonInstructions: cleanString(input.jsonInstructions ?? base.jsonInstructions, { max: 8000, allowEmpty: true }) || ''
  };
}

function normalizeDefinitionRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const serviceKey = cleanString(input.serviceKey || base.serviceKey, { max: 120, allowEmpty: true });
  const inputs = normalizeInputsList(input.inputs !== undefined ? input.inputs : base.inputs);
  const prompt = normalizePromptBlock(input.prompt, base.prompt);
  const output = normalizeOutputBlock(input.output, base.output);
  const isActive = hasOwn(input, 'isActive') ? normalizeBoolean(input.isActive, true) : normalizeBoolean(base.isActive, true);
  const notes = cleanString(input.notes, { max: 4000, allowEmpty: true }) || '';
  const audit = buildAudit(input.lastUpdateUser, input.audit || base.audit);

  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!serviceKey) throw new Error('Service is required.');
    if (!getAiServiceByKey(serviceKey)) throw new Error('Unknown AI service key.');
    if (!prompt.userPromptTemplate.trim()) throw new Error('User prompt template is required.');
  }

  return {
    ...base,
    id: cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    serviceKey,
    inputs,
    prompt,
    output,
    isActive,
    notes,
    audit,
    updatedAt: cleanIsoDateTime(new Date().toISOString())
  };
}

function defaultDefinitionShape(serviceKey = '') {
  return normalizeDefinitionRecord({
    serviceKey,
    inputs: [],
    prompt: { systemPrompt: '', userPromptTemplate: '' },
    output: { mode: 'markdown', jsonSchema: null, jsonInstructions: '' },
    isActive: true
  });
}

async function getAllDefinitions() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function getDefinitionById(id) {
  const rows = await getAllDefinitions();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function getByOrgServiceKey(orgId, serviceKey) {
  const rows = await getAllDefinitions();
  return rows.find((row) => (
    idsEqual(row?.orgId, orgId) && String(row?.serviceKey) === String(serviceKey)
  )) || null;
}

async function upsertDefinition(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllDefinitions();
    const normalized = normalizeDefinitionRecord(payload, null, true);
    const existingIndex = rows.findIndex(
      (row) => idsEqual(row?.orgId, normalized.orgId) && String(row?.serviceKey) === String(normalized.serviceKey)
    );
    if (existingIndex >= 0) {
      normalized.id = rows[existingIndex].id;
      normalized.audit = buildAudit(payload.lastUpdateUser, rows[existingIndex].audit);
      rows[existingIndex] = normalizeDefinitionRecord(normalized, rows[existingIndex], true);
      await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
      return rows[existingIndex];
    }
    normalized.id = generateDatedId(ID_PREFIX, rows);
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function deleteDefinition(id) {
  return queueWrite(async () => {
    const rows = await getAllDefinitions();
    const next = rows.filter((row) => !idsEqual(row?.id, id));
    if (next.length === rows.length) throw new Error('Service definition not found.');
    await fs.writeFile(DATA_PATH, JSON.stringify(next, null, 2));
    return true;
  });
}

module.exports = {
  INPUT_TYPES,
  OUTPUT_MODES,
  normalizeDefinitionRecord,
  normalizeInputsList,
  defaultDefinitionShape,
  getAllDefinitions,
  getDefinitionById,
  getByOrgServiceKey,
  upsertDefinition,
  deleteDefinition
};