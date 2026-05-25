const path = require('path');

const GROUPS = Object.freeze({
  CORE: 'Core Uploads',
  SCHOOL: 'School Uploads',
  GENERATED: 'Generated Assets'
});

const PACKAGE_NAMES = Object.freeze({
  CORE: 'Core',
  SCHOOL: 'School',
  IELTS: 'IELTS',
  BENCHPATH: 'BenchPath',
  CREDIT: 'Credit',
  PTE: 'PTE'
});

const PLACEHOLDER_DEFAULTS = Object.freeze({
  taskId: 'task_unsaved',
  conversationId: 'conversation_unsaved',
  personId: 'person_unsaved',
  templateId: 'template_unsaved',
  questionId: '_unsaved',
  classId: 'class_unsaved',
  subjectId: 'subject_unsaved',
  jobDate: 'date_unspecified',
  jobId: 'job_unsaved',
  userId: 'user_unsaved',
  practiceName: 'practice_unspecified',
  testName: 'test_unspecified',
  sessionId: 'session_unsaved',
  itemId: 'item_unsaved'
});

const BUILTIN_DEFINITIONS = Object.freeze([
  { key: 'core.fileManager', packageName: 'CORE', group: GROUPS.CORE, label: 'File Manager Staging', defaultTemplate: 'misc', placeholders: [] },
  { key: 'core.tasks', packageName: 'CORE', group: GROUPS.CORE, label: 'Task Attachments', defaultTemplate: 'tasks/{taskId}', placeholders: ['taskId'] },
  { key: 'core.symbols', packageName: 'CORE', group: GROUPS.CORE, label: 'Symbol Images', defaultTemplate: 'symbols', placeholders: [] },
  { key: 'core.news', packageName: 'CORE', group: GROUPS.CORE, label: 'News Media', defaultTemplate: 'news', placeholders: [] },
  { key: 'core.chat', packageName: 'CORE', group: GROUPS.CORE, label: 'Chat Attachments', defaultTemplate: 'chat/{conversationId}', placeholders: ['conversationId'] },
  { key: 'core.contacts', packageName: 'CORE', group: GROUPS.CORE, label: 'Contact Attachments', defaultTemplate: 'contacts', placeholders: [] },
  { key: 'core.ielts', packageName: 'IELTS', group: GROUPS.CORE, label: 'IELTS Attachments', defaultTemplate: 'ielts', placeholders: [] },
  { key: 'core.emailTemplates', packageName: 'CORE', group: GROUPS.CORE, label: 'Email Template Media', defaultTemplate: 'email-templates', placeholders: [] },

  { key: 'school.students', packageName: 'SCHOOL', group: GROUPS.SCHOOL, label: 'School Student Attachments', defaultTemplate: 'students/{personId}', placeholders: ['personId'] },
  { key: 'school.reportTemplates', packageName: 'SCHOOL', group: GROUPS.SCHOOL, label: 'School Report Templates', defaultTemplate: 'reports', placeholders: [] },
  { key: 'school.examMedia', packageName: 'SCHOOL', group: GROUPS.SCHOOL, label: 'School Exam Media', defaultTemplate: 'school-exams/{templateId}/{questionId}', placeholders: ['templateId', 'questionId'] },
  { key: 'school.classWorkspace', packageName: 'SCHOOL', group: GROUPS.SCHOOL, label: 'School Class Workspaces', defaultTemplate: 'school/classes/{classId}', placeholders: ['classId'] },
  { key: 'school.subjectWorkspace', packageName: 'SCHOOL', group: GROUPS.SCHOOL, label: 'School Subject Workspaces', defaultTemplate: 'school/subjects/{subjectId}', placeholders: ['subjectId'] },

  { key: 'generated.heic', packageName: 'CORE', group: GROUPS.GENERATED, label: 'HEIC Converter Jobs', defaultTemplate: 'heic-converter/{jobDate}/{jobId}', placeholders: ['jobDate', 'jobId'] },
  { key: 'generated.importReports', packageName: 'CORE', group: GROUPS.GENERATED, label: 'Import Reports', defaultTemplate: 'importReports', placeholders: [] },
  { key: 'generated.benchpathReports', packageName: 'BENCHPATH', group: GROUPS.GENERATED, label: 'BenchPath Reports', defaultTemplate: 'benchpath/reports', placeholders: [] }
]);

const RUNTIME_DEFINITIONS = [];
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function clean(value) {
  return String(value || '').replace(/\0/g, '').trim();
}

function normalizeSeparators(value = '') {
  return clean(value).replace(/\\/g, '/').replace(/\/+/g, '/');
}

function normalizePackageName(value, fallback = '') {
  const token = clean(value).toUpperCase();
  if (!token) return fallback;
  if (Object.prototype.hasOwnProperty.call(PACKAGE_NAMES, token)) return token;
  return fallback;
}

function sanitizeFolderToken(value, fallback = 'unspecified', max = 120) {
  const token = clean(value).slice(0, max);
  if (!token) return fallback;
  const normalized = token
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  return normalized || fallback;
}

function cloneDefinition(definition = {}) {
  return {
    key: clean(definition.key),
    label: clean(definition.label),
    group: clean(definition.group),
    packageName: normalizePackageName(definition.packageName, 'CORE'),
    defaultTemplate: normalizeSeparators(definition.defaultTemplate),
    placeholders: Array.isArray(definition.placeholders)
      ? definition.placeholders.map((row) => clean(row)).filter(Boolean)
      : []
  };
}

function getAllDefinitions() {
  const rows = [...BUILTIN_DEFINITIONS, ...RUNTIME_DEFINITIONS].map(cloneDefinition);
  const seen = new Set();
  return rows.filter((row) => {
    if (!row.key || seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

function getDefinitionMap() {
  return new Map(getAllDefinitions().map((definition) => [definition.key, definition]));
}

function getDefaultUploadFolders() {
  return getAllDefinitions().reduce((out, definition) => {
    out[definition.key] = definition.defaultTemplate;
    return out;
  }, {});
}

function getDefinition(key) {
  const definition = getDefinitionMap().get(String(key || '').trim());
  if (!definition) throw new Error(`Unknown upload folder setting: ${key}`);
  return definition;
}

function validateTemplateForDefinition(definition, rawValue, options = {}) {
  const fallback = definition.defaultTemplate;
  const label = definition.label || definition.key;
  const required = options.required === true;
  const token = normalizeSeparators(rawValue);
  if (!token) {
    if (required) throw new Error(`${label} folder is required.`);
    return fallback;
  }

  if (path.isAbsolute(token) || /^[a-zA-Z]:\//.test(token)) {
    throw new Error(`${label} must be relative to the scoped upload folder.`);
  }
  if (/^uploads(?:\/|$)/i.test(token)) {
    throw new Error(`${label} must not include the /uploads prefix.`);
  }

  const parts = token.split('/').filter(Boolean);
  if (!parts.length) return fallback;
  const first = parts[0].toUpperCase();
  if (first === 'GLOBAL' || /^ORG_[A-Z0-9_-]+$/i.test(parts[0])) {
    throw new Error(`${label} must not include GLOBAL or ORG scope folders.`);
  }

  const allowed = new Set(definition.placeholders || []);
  const placeholders = [...token.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
  placeholders.forEach((placeholder) => {
    if (!allowed.has(placeholder)) {
      throw new Error(`${label} uses unsupported placeholder {${placeholder}}.`);
    }
  });
  if (token.replace(/\{[a-zA-Z0-9_]+\}/g, '').includes('{') || token.replace(/\{[a-zA-Z0-9_]+\}/g, '').includes('}')) {
    throw new Error(`${label} has an invalid placeholder.`);
  }

  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.includes('..')) {
      throw new Error(`${label} contains an invalid path segment.`);
    }
    if (/[<>:"|?*\x00-\x1F]/.test(part)) {
      throw new Error(`${label} contains unsupported characters.`);
    }
    const withoutPlaceholders = part.replace(/\{[a-zA-Z0-9_]+\}/g, 'placeholder');
    if (WINDOWS_RESERVED_NAMES.has(withoutPlaceholders.toUpperCase())) {
      throw new Error(`${label} uses a reserved folder name.`);
    }
  }

  return parts.join('/');
}

function sanitizeUploadFolderSettings(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const sanitized = {};
  getAllDefinitions().forEach((definition) => {
    sanitized[definition.key] = validateTemplateForDefinition(definition, source[definition.key], options);
  });
  return sanitized;
}

function sanitizeUploadFolderSettingsPatch(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const sanitized = {};
  Object.keys(source).forEach((key) => {
    const definition = getDefinitionMap().get(String(key || '').trim());
    if (!definition) return;
    sanitized[definition.key] = validateTemplateForDefinition(definition, source[definition.key], options);
  });
  return sanitized;
}

function mergeUploadFolderSettings(...settingsObjects) {
  const definitions = getAllDefinitions();
  const merged = getDefaultUploadFolders();
  settingsObjects.forEach((settings) => {
    if (!settings || typeof settings !== 'object') return;
    definitions.forEach((definition) => {
      const rawValue = settings[definition.key];
      if (rawValue === undefined || rawValue === null || rawValue === '') return;
      try {
        merged[definition.key] = validateTemplateForDefinition(definition, rawValue);
      } catch (_) {
        merged[definition.key] = definition.defaultTemplate;
      }
    });
  });
  return merged;
}

function getCurrentUploadFolders() {
  try {
    // Lazy require avoids a startup cycle with systemSettingsModel -> this service.
    // eslint-disable-next-line global-require
    const settingService = require('./settingService');
    return mergeUploadFolderSettings(settingService.getValue('app', 'uploadFolders') || {});
  } catch (_) {
    return getDefaultUploadFolders();
  }
}

function getUploadFolderTemplate(key) {
  const definition = getDefinition(key);
  const current = getCurrentUploadFolders();
  return validateTemplateForDefinition(definition, current[key] || definition.defaultTemplate);
}

function resolveUploadFolder(key, context = {}) {
  const definition = getDefinition(key);
  let template = getUploadFolderTemplate(key);
  const allowed = new Set(definition.placeholders || []);
  template = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, placeholder) => {
    if (!allowed.has(placeholder)) return '';
    const fallback = PLACEHOLDER_DEFAULTS[placeholder] || `${placeholder}_unspecified`;
    return sanitizeFolderToken(context[placeholder], fallback);
  });
  return normalizeSeparators(template)
    .split('/')
    .filter(Boolean)
    .join('/');
}

function resolveDefaultUploadFolder(key, context = {}) {
  const definition = getDefinition(key);
  let template = definition.defaultTemplate;
  template = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, placeholder) => {
    const fallback = PLACEHOLDER_DEFAULTS[placeholder] || `${placeholder}_unspecified`;
    return sanitizeFolderToken(context[placeholder], fallback);
  });
  return normalizeSeparators(template).split('/').filter(Boolean).join('/');
}

function getUploadFolderDefinitions(options = {}) {
  const filterPackage = normalizePackageName(options.packageName, '');
  return getAllDefinitions()
    .filter((definition) => !filterPackage || definition.packageName === filterPackage)
    .map((definition) => ({
      ...definition,
      placeholders: [...(definition.placeholders || [])],
      defaultTemplate: definition.defaultTemplate,
      currentTemplate: getUploadFolderTemplate(definition.key)
    }));
}

function getUploadFolderPackageOptions() {
  const counts = {};
  getAllDefinitions().forEach((definition) => {
    const token = normalizePackageName(definition.packageName, 'CORE');
    counts[token] = Number(counts[token] || 0) + 1;
  });
  return Object.keys(PACKAGE_NAMES)
    .filter((id) => Number(counts[id] || 0) > 0)
    .map((id) => ({
      id,
      label: PACKAGE_NAMES[id],
      count: counts[id]
    }));
}

function registerUploadFolderDefinitions(definitions = []) {
  const rows = Array.isArray(definitions) ? definitions : [definitions];
  if (!rows.length) return 0;

  const existingKeys = new Set(getAllDefinitions().map((definition) => definition.key));
  let inserted = 0;
  rows.forEach((rawDefinition) => {
    const next = cloneDefinition({
      key: rawDefinition?.key,
      label: rawDefinition?.label || rawDefinition?.key,
      group: rawDefinition?.group || GROUPS.CORE,
      packageName: rawDefinition?.packageName || 'CORE',
      defaultTemplate: rawDefinition?.defaultTemplate,
      placeholders: rawDefinition?.placeholders || []
    });
    if (!next.key || existingKeys.has(next.key)) return;
    if (!next.defaultTemplate) {
      throw new Error(`Upload folder definition ${next.key || '(unknown)'} is missing defaultTemplate.`);
    }
    validateTemplateForDefinition(next, next.defaultTemplate, { required: true });
    RUNTIME_DEFINITIONS.push(next);
    existingKeys.add(next.key);
    inserted += 1;
  });
  return inserted;
}

function removeUploadFolderDefinitions(definitions = []) {
  const keys = new Set(
    Array.isArray(definitions)
      ? definitions
        .map((value) => String(value || '').trim().replace(/\0/g, ''))
        .filter(Boolean)
      : []
  );
  if (!keys.size) return 0;

  let removed = 0;
  for (let i = RUNTIME_DEFINITIONS.length - 1; i >= 0; i -= 1) {
    const definition = RUNTIME_DEFINITIONS[i];
    if (!definition || !keys.has(definition.key)) continue;
    RUNTIME_DEFINITIONS.splice(i, 1);
    removed += 1;
  }
  return removed;
}

module.exports = {
  GROUPS,
  PACKAGE_NAMES,
  PLACEHOLDER_DEFAULTS,
  getDefaultUploadFolders,
  getUploadFolderDefinitions,
  getUploadFolderPackageOptions,
  getUploadFolderTemplate,
  normalizePackageName,
  resolveUploadFolder,
  resolveDefaultUploadFolder,
  sanitizeFolderToken,
  sanitizeUploadFolderSettings,
  sanitizeUploadFolderSettingsPatch,
  mergeUploadFolderSettings,
  registerUploadFolderDefinitions,
  removeUploadFolderDefinitions,
  validateTemplateForDefinition
};



