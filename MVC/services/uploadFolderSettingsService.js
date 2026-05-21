const path = require('path');

const GROUPS = Object.freeze({
  CORE: 'Core Uploads',
  SCHOOL: 'School Uploads',
  PTE: 'PTE Uploads',
  GENERATED: 'Generated Assets'
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

const DEFINITIONS = Object.freeze([
  { key: 'core.fileManager', group: GROUPS.CORE, label: 'File Manager Staging', defaultTemplate: 'misc', placeholders: [] },
  { key: 'core.tasks', group: GROUPS.CORE, label: 'Task Attachments', defaultTemplate: 'tasks/{taskId}', placeholders: ['taskId'] },
  { key: 'core.symbols', group: GROUPS.CORE, label: 'Symbol Images', defaultTemplate: 'symbols', placeholders: [] },
  { key: 'core.news', group: GROUPS.CORE, label: 'News Media', defaultTemplate: 'news', placeholders: [] },
  { key: 'core.chat', group: GROUPS.CORE, label: 'Chat Attachments', defaultTemplate: 'chat/{conversationId}', placeholders: ['conversationId'] },
  { key: 'core.contacts', group: GROUPS.CORE, label: 'Contact Attachments', defaultTemplate: 'contacts', placeholders: [] },
  { key: 'core.ielts', group: GROUPS.CORE, label: 'IELTS Attachments', defaultTemplate: 'ielts', placeholders: [] },

  { key: 'school.students', group: GROUPS.SCHOOL, label: 'School Student Attachments', defaultTemplate: 'students/{personId}', placeholders: ['personId'] },
  { key: 'school.reportTemplates', group: GROUPS.SCHOOL, label: 'School Report Templates', defaultTemplate: 'reports', placeholders: [] },
  { key: 'school.examMedia', group: GROUPS.SCHOOL, label: 'School Exam Media', defaultTemplate: 'school-exams/{templateId}/{questionId}', placeholders: ['templateId', 'questionId'] },
  { key: 'school.classWorkspace', group: GROUPS.SCHOOL, label: 'School Class Workspaces', defaultTemplate: 'school/classes/{classId}', placeholders: ['classId'] },
  { key: 'school.subjectWorkspace', group: GROUPS.SCHOOL, label: 'School Subject Workspaces', defaultTemplate: 'school/subjects/{subjectId}', placeholders: ['subjectId'] },

  { key: 'pte.questionBank', group: GROUPS.PTE, label: 'PTE Question Bank', defaultTemplate: 'PTE/Question_Bank', placeholders: [] },
  { key: 'pte.students', group: GROUPS.PTE, label: 'PTE Student Root', defaultTemplate: 'PTE/Students', placeholders: [] },
  { key: 'pte.studentItem', group: GROUPS.PTE, label: 'PTE Student Files', defaultTemplate: 'PTE/Students/{itemId}', placeholders: ['itemId'] },
  { key: 'pte.publicApplicants', group: GROUPS.PTE, label: 'PTE Public Applicant Root', defaultTemplate: 'PTE/Public_Applicants', placeholders: [] },
  { key: 'pte.publicApplicantItem', group: GROUPS.PTE, label: 'PTE Public Applicant Files', defaultTemplate: 'PTE/Public_Applicants/{itemId}', placeholders: ['itemId'] },
  { key: 'pte.practiceAttempt', group: GROUPS.PTE, label: 'PTE Practice Audio', defaultTemplate: 'PTE/Practice_By_Skills/{userId}/{practiceName}/{sessionId}/{itemId}', placeholders: ['userId', 'practiceName', 'sessionId', 'itemId'] },
  { key: 'pte.smartPracticeAttempt', group: GROUPS.PTE, label: 'PTE Smart Practice Audio', defaultTemplate: 'PTE/Smart_Practice/{userId}/{practiceName}/{sessionId}/{itemId}', placeholders: ['userId', 'practiceName', 'sessionId', 'itemId'] },
  { key: 'pte.mockExamAttempt', group: GROUPS.PTE, label: 'PTE Mock Exam Audio', defaultTemplate: 'PTE/Mock_Exams/{userId}/{testName}/{sessionId}/{itemId}', placeholders: ['userId', 'testName', 'sessionId', 'itemId'] },

  { key: 'generated.heic', group: GROUPS.GENERATED, label: 'HEIC Converter Jobs', defaultTemplate: 'heic-converter/{jobDate}/{jobId}', placeholders: ['jobDate', 'jobId'] },
  { key: 'generated.importReports', group: GROUPS.GENERATED, label: 'Import Reports', defaultTemplate: 'importReports', placeholders: [] },
  { key: 'generated.benchpathReports', group: GROUPS.GENERATED, label: 'BenchPath Reports', defaultTemplate: 'benchpath/reports', placeholders: [] }
]);

const DEFINITION_MAP = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));
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

function getDefaultUploadFolders() {
  return DEFINITIONS.reduce((out, definition) => {
    out[definition.key] = definition.defaultTemplate;
    return out;
  }, {});
}

function getDefinition(key) {
  const definition = DEFINITION_MAP.get(String(key || '').trim());
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
  DEFINITIONS.forEach((definition) => {
    sanitized[definition.key] = validateTemplateForDefinition(definition, source[definition.key], options);
  });
  return sanitized;
}

function mergeUploadFolderSettings(...settingsObjects) {
  const merged = getDefaultUploadFolders();
  settingsObjects.forEach((settings) => {
    if (!settings || typeof settings !== 'object') return;
    DEFINITIONS.forEach((definition) => {
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

function getUploadFolderDefinitions() {
  return DEFINITIONS.map((definition) => ({
    ...definition,
    placeholders: [...(definition.placeholders || [])],
    defaultTemplate: definition.defaultTemplate,
    currentTemplate: getUploadFolderTemplate(definition.key)
  }));
}

module.exports = {
  GROUPS,
  PLACEHOLDER_DEFAULTS,
  getDefaultUploadFolders,
  getUploadFolderDefinitions,
  getUploadFolderTemplate,
  resolveUploadFolder,
  resolveDefaultUploadFolder,
  sanitizeFolderToken,
  sanitizeUploadFolderSettings,
  mergeUploadFolderSettings,
  validateTemplateForDefinition
};
