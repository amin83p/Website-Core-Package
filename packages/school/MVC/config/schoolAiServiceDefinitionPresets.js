'use strict';

/**
 * Default service definitions when no org-specific row exists yet.
 * Each registered preset is a JSON file:
 *   packages/school/MVC/config/schoolAiServiceDefinitionPresets/<serviceKey>.json
 * Admins can copy output.jsonSchema (including x-reportUi) into
 * School AI Assist → Service Definitions → Edit → JSON schema.
 */

const fs = require('fs');
const path = require('path');

const PRESET_DIR = path.join(__dirname, 'schoolAiServiceDefinitionPresets');
const presetCache = new Map();

function listPresetServiceKeys() {
  if (!fs.existsSync(PRESET_DIR)) return [];
  return fs.readdirSync(PRESET_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5));
}

function loadPresetFile(serviceKey = '') {
  const key = String(serviceKey || '').trim();
  if (!key) return null;
  if (presetCache.has(key)) return presetCache.get(key);
  const filePath = path.join(PRESET_DIR, `${key}.json`);
  if (!fs.existsSync(filePath)) {
    presetCache.set(key, null);
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    presetCache.set(key, parsed);
    return parsed;
  } catch (_) {
    presetCache.set(key, null);
    return null;
  }
}

function getDefinitionPreset(serviceKey = '') {
  const preset = loadPresetFile(serviceKey);
  if (!preset || typeof preset !== 'object') return null;
  const output = preset.output && typeof preset.output === 'object'
    ? JSON.parse(JSON.stringify(preset.output))
    : {};
  return {
    inputs: Array.isArray(preset.inputs)
      ? preset.inputs.map((row) => ({ ...row, options: Array.isArray(row.options) ? [...row.options] : [] }))
      : [],
    prompt: preset.prompt && typeof preset.prompt === 'object' ? { ...preset.prompt } : {},
    output
  };
}

function getPresetJsonSchema(serviceKey = '') {
  const preset = loadPresetFile(serviceKey);
  const schema = preset?.output?.jsonSchema;
  return schema && typeof schema === 'object' ? schema : null;
}

module.exports = {
  PRESET_DIR,
  listPresetServiceKeys,
  loadPresetFile,
  getDefinitionPreset,
  getPresetJsonSchema
};