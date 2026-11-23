'use strict';

const schoolAiServiceDefinitionDataService = require('./schoolAiServiceDefinitionDataService');
const schoolAiRuntimeService = require('./schoolAiRuntimeService');
const schoolAiProviderInvokeService = require('./schoolAiProviderInvokeService');
const { getActiveOrgIdOrThrow } = require('./schoolAiAssistCommon');

const TEMPLATE_TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function stringifyInputValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

function coerceInputs(inputDefs = [], rawInputs = {}) {
  const source = rawInputs && typeof rawInputs === 'object' ? rawInputs : {};
  const out = {};
  const errors = [];
  (Array.isArray(inputDefs) ? inputDefs : []).forEach((field) => {
    const id = String(field?.id || '').trim();
    if (!id) return;
    let value = source[id];
    const hasValue = value !== undefined && value !== null && String(value).trim() !== '';
    if (!hasValue) {
      if (field.defaultValue !== undefined && String(field.defaultValue).trim() !== '') {
        value = field.defaultValue;
      } else if (field.required) {
        errors.push(`Input "${field.label || id}" is required.`);
        return;
      } else {
        out[id] = '';
        return;
      }
    }
    const type = String(field.type || 'text').toLowerCase();
    if (type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        errors.push(`Input "${field.label || id}" must be a number.`);
        return;
      }
      out[id] = String(n);
      return;
    }
    if (type === 'boolean') {
      const token = String(value).trim().toLowerCase();
      out[id] = (token === 'true' || token === '1' || token === 'yes' || value === true) ? 'true' : 'false';
      return;
    }
    if (type === 'json') {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      try {
        JSON.parse(text);
      } catch (_) {
        errors.push(`Input "${field.label || id}" must be valid JSON.`);
        return;
      }
      out[id] = text;
      return;
    }
    if (type === 'select' && Array.isArray(field.options) && field.options.length) {
      const allowed = new Set(field.options.map((opt) => String(opt.value)));
      if (!allowed.has(String(value))) {
        errors.push(`Input "${field.label || id}" has an invalid option.`);
        return;
      }
    }
    out[id] = stringifyInputValue(value);
  });
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.validationErrors = errors;
    throw err;
  }
  return out;
}

function substituteTemplate(template, values = {}) {
  const text = String(template || '');
  return text.replace(TEMPLATE_TOKEN, (_, id) => stringifyInputValue(values[id]));
}

function schemaForModelPrompt(jsonSchema) {
  if (!jsonSchema || typeof jsonSchema !== 'object') return jsonSchema;
  const clone = JSON.parse(JSON.stringify(jsonSchema));
  delete clone['x-reportUi'];
  return clone;
}

function buildPrompt(definition, coercedInputs = {}) {
  const prompt = definition?.prompt && typeof definition.prompt === 'object' ? definition.prompt : {};
  let systemPrompt = substituteTemplate(prompt.systemPrompt, coercedInputs);
  let userPrompt = substituteTemplate(prompt.userPromptTemplate, coercedInputs);
  const output = definition?.output && typeof definition.output === 'object' ? definition.output : {};
  if (String(output.mode || '').toLowerCase() === 'json') {
    const parts = [];
    if (output.jsonInstructions) parts.push(String(output.jsonInstructions).trim());
    if (output.jsonSchema && typeof output.jsonSchema === 'object') {
      parts.push('Respond with JSON only matching this schema (no markdown fences):');
      parts.push(JSON.stringify(schemaForModelPrompt(output.jsonSchema)));
    } else {
      parts.push('Respond with JSON only (no markdown fences).');
    }
    const suffix = parts.filter(Boolean).join('\n\n');
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${suffix}` : suffix;
  }
  if (!userPrompt.trim()) throw new Error('Built user prompt is empty.');
  return { systemPrompt: systemPrompt.trim() || undefined, userPrompt: userPrompt.trim() };
}

function extractJsonFromModelText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (_err) {
        return null;
      }
    }
    return null;
  }
}

function validateJsonOutput(data, jsonSchema = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Model output is not a JSON object.'] };
  }
  const errors = [];
  if (jsonSchema && typeof jsonSchema === 'object') {
    const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];
    required.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        errors.push(`Missing required output key "${key}".`);
      }
    });
    const allowPartial = jsonSchema.additionalProperties === false
      || Boolean(jsonSchema['x-reportUi']);
    const properties = jsonSchema.properties && typeof jsonSchema.properties === 'object'
      ? jsonSchema.properties
      : {};
    Object.keys(data).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        errors.push(`Unexpected output key "${key}".`);
      }
    });
    if (!allowPartial) {
      Object.keys(properties).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          errors.push(`Missing expected output key "${key}".`);
        }
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

function formatOutput(outputSpec = {}, modelText = '', traceId = '') {
  const mode = String(outputSpec?.mode || 'markdown').toLowerCase();
  const rawText = String(modelText || '');
  const base = { rawText, traceId, mode, ok: true };
  if (mode === 'json') {
    const parsed = extractJsonFromModelText(rawText);
    if (!parsed) {
      return {
        ...base,
        ok: false,
        error: 'Could not parse JSON from model response.',
        displayText: rawText
      };
    }
    const validation = validateJsonOutput(parsed, outputSpec.jsonSchema);
    if (!validation.ok) {
      return {
        ...base,
        ok: false,
        error: validation.errors.join(' '),
        data: parsed,
        displayText: rawText
      };
    }
    return {
      ...base,
      data: parsed,
      displayText: JSON.stringify(parsed, null, 2)
    };
  }
  return {
    ...base,
    displayText: rawText
  };
}

async function run({ serviceKey, inputs = {}, requestingUser, accessContext = {} } = {}) {
  const orgId = getActiveOrgIdOrThrow(requestingUser);
  const definition = await schoolAiServiceDefinitionDataService.getDefinitionForRun(
    serviceKey,
    requestingUser,
    accessContext
  );
  if (!definition) {
    throw new Error('No active service definition found. Configure the service in School AI Assist first.');
  }
  if (!definition.prompt?.userPromptTemplate?.trim()) {
    throw new Error('Service definition is missing a user prompt template.');
  }
  const coerced = coerceInputs(definition.inputs, inputs);
  const { systemPrompt, userPrompt } = buildPrompt(definition, coerced);
  const binding = await schoolAiRuntimeService.resolveForService(
    { serviceKey, requestingUser },
    accessContext
  );
  const llm = await schoolAiProviderInvokeService.sendTextPrompt({
    binding,
    prompt: userPrompt,
    systemPrompt,
    requestingUser
  });
  const formatted = formatOutput(definition.output, llm.text, llm.traceId);
  return {
  ...formatted,
    serviceKey,
    modelId: llm.modelUsed || binding.modelId,
    traceId: llm.traceId || formatted.traceId
  };
}

module.exports = {
  coerceInputs,
  schemaForModelPrompt,
  buildPrompt,
  formatOutput,
  extractJsonFromModelText,
  run
};