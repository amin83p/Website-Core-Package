'use strict';

const schoolDataService = require('./schoolDataService');
const { listAiServices, getAiServiceByKey } = require('../../config/schoolAiServiceRegistry');
const { getDefinitionPreset } = require('../../config/schoolAiServiceDefinitionPresets');
const {
  defaultDefinitionShape,
  normalizeDefinitionRecord,
  normalizeInputsList
} = require('../../models/school/schoolAiServiceDefinitionModel');
const {
  getActiveOrgIdOrThrow,
  cleanString,
  assertOrgRow
} = require('./schoolAiAssistCommon');

const ENTITY = 'schoolAiServiceDefinitions';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const TEMPLATE_TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;

function extractTemplateInputIds(template = '') {
  const ids = new Set();
  const text = String(template || '');
  let match;
  const re = new RegExp(TEMPLATE_TOKEN.source, 'g');
  while ((match = re.exec(text)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return ids;
}

function validatePromptTemplateReferences(prompt, inputIds) {
  const idSet = new Set(inputIds);
  const refs = [
    ...extractTemplateInputIds(prompt?.systemPrompt),
    ...extractTemplateInputIds(prompt?.userPromptTemplate)
  ];
  const unknown = refs.filter((id) => !idSet.has(id));
  if (unknown.length) {
    throw new Error(`Prompt template references unknown input(s): ${unknown.join(', ')}.`);
  }
}

function parseInputsPayload(payload = {}) {
  if (Array.isArray(payload.inputs)) return normalizeInputsList(payload.inputs);
  const rawJson = payload.inputsJson ?? payload.inputs_json;
  if (typeof rawJson === 'string' && rawJson.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (_) {
      throw new Error('Inputs JSON is invalid.');
    }
    if (!Array.isArray(parsed)) throw new Error('Inputs JSON must be an array.');
    return normalizeInputsList(parsed);
  }
  return [];
}

function normalizeFormPayload(serviceKey, payload = {}, requestingUser) {
  const inputs = parseInputsPayload(payload);
  let jsonSchema = null;
  const schemaRaw = payload.jsonSchema ?? payload.outputJsonSchema;
  if (schemaRaw !== undefined && schemaRaw !== null && String(schemaRaw).trim() !== '') {
    if (isPlainObject(schemaRaw)) {
      jsonSchema = schemaRaw;
    } else {
      try {
        jsonSchema = JSON.parse(String(schemaRaw));
      } catch (_) {
        throw new Error('Output JSON schema must be valid JSON.');
      }
      if (!jsonSchema || typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
        throw new Error('Output JSON schema must be a JSON object.');
      }
    }
  }
  const prompt = {
    systemPrompt: cleanString(payload.systemPrompt, { max: 32000, allowEmpty: true }) || '',
    userPromptTemplate: cleanString(payload.userPromptTemplate, { max: 32000, allowEmpty: true }) || ''
  };
  const output = {
    mode: cleanString(payload.outputMode, { max: 40, allowEmpty: true }).toLowerCase() || 'markdown',
    jsonSchema,
    jsonInstructions: cleanString(payload.jsonInstructions, { max: 8000, allowEmpty: true }) || ''
  };
  validatePromptTemplateReferences(prompt, inputs.map((row) => row.id));
  return {
    serviceKey,
    inputs,
    prompt,
    output,
    isActive: payload.isActive !== false && String(payload.isActive || '').toLowerCase() !== 'false',
    notes: cleanString(payload.notes, { max: 4000, allowEmpty: true }) || '',
    lastUpdateUser: String(requestingUser?.id || 'SYSTEM')
  };
}

const schoolAiServiceDefinitionDataService = {
  async listForOrg(requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const services = listAiServices();
    const rows = await schoolDataService.fetchAllData(
      ENTITY,
      { orgId__eq: orgId },
      requestingUser,
      accessContext
    );
    const byKey = new Map(
      (Array.isArray(rows) ? rows : []).map((row) => [String(row.serviceKey), row])
    );
    return {
      orgId,
      services: services.map((svc) => {
        const saved = byKey.get(String(svc.serviceKey)) || null;
        const configured = Boolean(saved?.prompt?.userPromptTemplate?.trim());
        return {
          ...svc,
          definition: saved,
          configured,
          isActive: saved?.isActive !== false
        };
      })
    };
  },

  async getActiveDefinition(orgId, serviceKey, requestingUser, accessContext = {}) {
    const rows = await schoolDataService.fetchAllData(
      ENTITY,
      { orgId__eq: orgId, serviceKey__eq: serviceKey, isActive__eq: true },
      requestingUser,
      accessContext
    );
    const row = (Array.isArray(rows) ? rows : []).find((item) => (
      String(item?.serviceKey) === String(serviceKey)
    )) || null;
    return row || null;
  },

  /**
   * Saved active org row, or built-in preset when no row exists yet (id empty).
   * Does not run against an inactive saved row without using the preset.
   */
  async getDefinitionForRun(serviceKey, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const key = cleanString(serviceKey, { max: 120, allowEmpty: false });
    const active = await this.getActiveDefinition(orgId, key, requestingUser, accessContext);
    if (active) return active;
    const candidate = await this.getByServiceKey(key, requestingUser, accessContext);
    if (!candidate) return null;
    const hasSavedId = Boolean(String(candidate.id || '').trim());
    if (hasSavedId) return null;
    if (candidate.isActive === false) return null;
    if (!candidate.prompt?.userPromptTemplate?.trim()) return null;
    return candidate;
  },

  async getByServiceKey(serviceKey, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const key = cleanString(serviceKey, { max: 120, allowEmpty: false });
    if (!getAiServiceByKey(key)) return null;
    const rows = await schoolDataService.fetchAllData(
      ENTITY,
      { orgId__eq: orgId, serviceKey__eq: key },
      requestingUser,
      accessContext
    );
    const saved = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (saved) {
      assertOrgRow(saved, orgId);
      return saved;
    }
    const preset = getDefinitionPreset(key);
    const base = defaultDefinitionShape(key);
    if (!preset) {
      return { ...base, orgId, serviceKey: key, id: '' };
    }
    return {
      ...base,
      ...preset,
      prompt: { ...(base.prompt || {}), ...(preset.prompt || {}) },
      output: { ...(base.output || {}), ...(preset.output || {}) },
      orgId,
      serviceKey: key,
      id: ''
    };
  },

  async upsertDefinition(serviceKey, payload, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const key = cleanString(serviceKey, { max: 120, allowEmpty: false });
    if (!getAiServiceByKey(key)) throw new Error('Unknown AI service key.');
    const partial = normalizeFormPayload(key, payload, requestingUser);
    const body = normalizeDefinitionRecord({
      ...partial,
      orgId,
      serviceKey: key
    }, null, true);
    return schoolDataService.addData(ENTITY, body, requestingUser, { accessContext });
  }
};

module.exports = schoolAiServiceDefinitionDataService;