'use strict';

const schoolPersonAccessService = require('./schoolPersonAccessService');
const {
  buildAllowedWrapperTokens
} = require('./sessionNotificationEmailWrapperPlaceholders');

const MAX_CUSTOM_MAPPINGS = 20;
const VALUE_KINDS = Object.freeze(['source', 'literal', 'template']);
const WRAPPER_TOKEN_PATTERN = /^[A-Z][A-Z0-9_]*$/;

let wrapperContextSourcesCache = null;

function getSessionAccessPolicyHelpers() {
  return require('./sessionAccessPolicyService');
}

function getWrapperContextSources() {
  if (!wrapperContextSourcesCache) {
    const { TEMPLATE_TOKENS } = getSessionAccessPolicyHelpers();
    wrapperContextSourcesCache = Object.freeze(
      [...TEMPLATE_TOKENS, 'teacherEmail'].filter((token, index, list) => list.indexOf(token) === index)
    );
  }
  return wrapperContextSourcesCache;
}

const WRAPPER_BUILTIN_MAPPINGS = Object.freeze([
  { label: 'Built-in Body', token: 'BODY_CONTENT', sourceDescription: 'Rendered notification body (editor below)' },
  { label: 'Teacher display name', token: 'TEACHER_NAME', sourceDescription: 'teacherName' },
  { label: 'Teacher email', token: 'TEACHER_EMAIL', sourceDescription: 'teacherEmail' },
  { label: 'Teacher email (event alias)', token: 'USER_EMAIL', sourceDescription: 'teacherEmail' },
  { label: 'Organization name', token: 'ORG_NAME', sourceDescription: 'orgName' },
  { label: 'Session count', token: 'SESSION_COUNT', sourceDescription: 'sessionCount' },
  { label: 'Session list', token: 'SESSION_LIST', sourceDescription: 'sessionList' },
  { label: 'Class name', token: 'CLASS_NAME', sourceDescription: 'className' },
  { label: 'Class id', token: 'CLASS_ID', sourceDescription: 'classId' },
  { label: 'Session name', token: 'SESSION_NAME', sourceDescription: 'sessionName' },
  { label: 'Session id', token: 'SESSION_ID', sourceDescription: 'sessionId' },
  { label: 'Session date', token: 'SESSION_DATE', sourceDescription: 'sessionDate' },
  { label: 'Session time', token: 'SESSION_TIME', sourceDescription: 'sessionTime' },
  { label: 'Session manager URL', token: 'SESSION_MANAGER_URL', sourceDescription: 'sessionManagerUrl' }
]);

const BUILTIN_CONTEXT_TO_WRAPPER = Object.freeze({
  teacherName: 'TEACHER_NAME',
  teacherEmail: ['TEACHER_EMAIL', 'USER_EMAIL'],
  orgName: 'ORG_NAME',
  sessionCount: 'SESSION_COUNT',
  sessionList: 'SESSION_LIST',
  className: 'CLASS_NAME',
  classId: 'CLASS_ID',
  sessionName: 'SESSION_NAME',
  sessionId: 'SESSION_ID',
  sessionDate: 'SESSION_DATE',
  sessionTime: 'SESSION_TIME',
  sessionManagerUrl: 'SESSION_MANAGER_URL'
});

function cleanText(value) {
  return String(value ?? '').trim();
}

function cleanWrapperToken(value = '') {
  return cleanText(value).toUpperCase().replace(/^\{\{|\}\}$/g, '');
}

function normalizeValueKind(value = '') {
  const token = cleanText(value).toLowerCase();
  return VALUE_KINDS.includes(token) ? token : 'source';
}

function isReservedWrapperToken(token = '') {
  return buildAllowedWrapperTokens([]).has(cleanWrapperToken(token));
}

function normalizeCustomMappingRow(input = {}, index = 0) {
  const row = input && typeof input === 'object' ? input : {};
  const token = cleanWrapperToken(row.token);
  const valueKind = normalizeValueKind(row.valueKind);
  const label = cleanText(row.label).slice(0, 120);
  const sourceKey = cleanText(row.sourceKey).slice(0, 64);
  const literalValue = cleanText(row.literalValue).slice(0, 500);
  const templateValue = cleanText(row.templateValue).slice(0, 2000);
  return {
    token,
    label,
    valueKind,
    sourceKey,
    literalValue,
    templateValue,
    _index: index
  };
}

function validateCustomMappingRow(row = {}, { existingTokens = new Set() } = {}) {
  const token = cleanWrapperToken(row?.token);
  if (!token) {
    throw new Error('Wrapper placeholder mapping requires a token name.');
  }
  if (!WRAPPER_TOKEN_PATTERN.test(token)) {
    throw new Error(`Wrapper token '${token}' must use UPPER_SNAKE_CASE (for example SITE_CONTACT).`);
  }
  if (isReservedWrapperToken(token)) {
    throw new Error(`Wrapper token '${token}' is reserved for built-in school mappings.`);
  }
  if (existingTokens.has(token)) {
    throw new Error(`Duplicate wrapper token '${token}' in custom mappings.`);
  }
  existingTokens.add(token);

  const valueKind = normalizeValueKind(row?.valueKind);
  if (valueKind === 'source') {
    const sourceKey = cleanText(row?.sourceKey);
    if (!sourceKey) {
      throw new Error(`Source field is required for wrapper token '${token}'.`);
    }
    const allowed = new Set(getWrapperContextSources().map((entry) => entry.toLowerCase()));
    if (!allowed.has(sourceKey.toLowerCase())) {
      throw new Error(`Unknown source field '${sourceKey}' for wrapper token '${token}'.`);
    }
    return {
      token,
      label: cleanText(row?.label).slice(0, 120),
      valueKind: 'source',
      sourceKey,
      literalValue: '',
      templateValue: ''
    };
  }
  if (valueKind === 'literal') {
    const literalValue = cleanText(row?.literalValue);
    if (!literalValue) {
      throw new Error(`Literal value is required for wrapper token '${token}'.`);
    }
    return {
      token,
      label: cleanText(row?.label).slice(0, 120),
      valueKind: 'literal',
      sourceKey: '',
      literalValue: literalValue.slice(0, 500),
      templateValue: ''
    };
  }
  const templateValue = cleanText(row?.templateValue);
  if (!templateValue) {
    throw new Error(`Template value is required for wrapper token '${token}'.`);
  }
  const { findInvalidTemplateTokens } = getSessionAccessPolicyHelpers();
  const invalidTokens = findInvalidTemplateTokens([templateValue]);
  if (invalidTokens.length) {
    throw new Error(`Unknown body placeholder(s) in template for '${token}': ${invalidTokens.join(', ')}`);
  }
  return {
    token,
    label: cleanText(row?.label).slice(0, 120),
    valueKind: 'template',
    sourceKey: '',
    literalValue: '',
    templateValue: templateValue.slice(0, 2000)
  };
}

function normalizeCustomMappings(input = []) {
  const rows = Array.isArray(input) ? input : [];
  if (rows.length > MAX_CUSTOM_MAPPINGS) {
    const error = new Error(`At most ${MAX_CUSTOM_MAPPINGS} custom wrapper placeholder mappings are allowed.`);
    error.statusCode = 400;
    throw error;
  }
  const existingTokens = new Set();
  return rows.map((row, index) => validateCustomMappingRow(normalizeCustomMappingRow(row, index), { existingTokens }));
}

function validateCustomMappings(input = []) {
  return normalizeCustomMappings(input);
}

function listBuiltinMappingRows() {
  return WRAPPER_BUILTIN_MAPPINGS.map((row) => ({ ...row }));
}

function buildNotificationContextBase(context = {}, teacher = null) {
  const base = context && typeof context === 'object' ? { ...context } : {};
  if (!cleanText(base.teacherEmail) && teacher) {
    const email = schoolPersonAccessService.readPersonEmail
      ? schoolPersonAccessService.readPersonEmail(teacher)
      : cleanText(teacher?.contact?.email || teacher?.email);
    if (email) base.teacherEmail = email;
  }
  return base;
}

function applyBuiltinWrapperMap(bodyContext = {}, bodyContent = '') {
  const output = { BODY_CONTENT: bodyContent };
  Object.entries(BUILTIN_CONTEXT_TO_WRAPPER).forEach(([contextKey, wrapperKeys]) => {
    const value = cleanText(bodyContext[contextKey]);
    const keys = Array.isArray(wrapperKeys) ? wrapperKeys : [wrapperKeys];
    keys.forEach((wrapperKey) => {
      output[wrapperKey] = value;
    });
  });
  return output;
}

function resolveCustomMappingValue(row = {}, bodyContext = {}) {
  const { renderTemplate } = getSessionAccessPolicyHelpers();
  const valueKind = normalizeValueKind(row?.valueKind);
  if (valueKind === 'literal') {
    return cleanText(row?.literalValue);
  }
  if (valueKind === 'template') {
    return renderTemplate(row?.templateValue, bodyContext);
  }
  const sourceKey = cleanText(row?.sourceKey);
  if (!sourceKey) return '';
  const resolvedKey = Object.keys(bodyContext).find((entry) => entry.toLowerCase() === sourceKey.toLowerCase()) || sourceKey;
  const value = bodyContext[resolvedKey];
  return value == null ? '' : String(value);
}

function resolveWrapperPlaceholderValues({
  context = {},
  emailChannel = {},
  customMappings = [],
  bodyContent = null,
  teacher = null
} = {}) {
  const { buildSchoolEmailBodyContent } = getSessionAccessPolicyHelpers();
  const bodyContext = buildNotificationContextBase(context, teacher);
  const renderedBody = bodyContent != null
    ? String(bodyContent)
    : buildSchoolEmailBodyContent(emailChannel, bodyContext) || cleanText(bodyContext.sessionList);
  const output = applyBuiltinWrapperMap(bodyContext, renderedBody);
  const mappings = Array.isArray(customMappings) ? customMappings : [];
  mappings.forEach((row) => {
    const token = cleanWrapperToken(row?.token);
    if (!token || isReservedWrapperToken(token)) return;
    output[token] = resolveCustomMappingValue(row, bodyContext);
  });
  return output;
}

module.exports = {
  MAX_CUSTOM_MAPPINGS,
  VALUE_KINDS,
  getWrapperContextSources,
  WRAPPER_BUILTIN_MAPPINGS,
  listBuiltinMappingRows,
  normalizeCustomMappings,
  validateCustomMappings,
  buildNotificationContextBase,
  resolveWrapperPlaceholderValues,
  isReservedWrapperToken
};
