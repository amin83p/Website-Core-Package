const { requireCoreModule, resolveCoreRoot } = requireCoreModule('MVC/services/school/schoolCoreModuleResolver');
const path = require('path');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanInteger,
  cleanBoolean,
  cleanStringArray,
  createJsonEntityModel
} = require('./examModelUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/examTemplates.json');

const TEMPLATE_STATUSES = Object.freeze(['draft', 'active', 'archived']);
const TEMPLATE_VISIBILITIES = Object.freeze(['private', 'public']);
const WINDOW_POLICY_OPTIONS = Object.freeze(['strict_fixed_window', 'suggested_window']);
const QUESTION_PRESENTATION_MODE_OPTIONS = Object.freeze(['sequential_one_by_one', 'all_questions_on_one_page']);

function sanitizeSubjectIds(value, fallbackSingle = '') {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim()
      ? value.split(',')
      : []);
  const seen = new Set();
  const out = [];
  source.forEach((row) => {
    const id = cleanId(row, { max: 80, allowEmpty: true });
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  if (!out.length) {
    const fallback = cleanId(fallbackSingle, { max: 80, allowEmpty: true });
    if (fallback) out.push(fallback);
  }
  return out;
}

function sanitizeTemplateSettings(value) {
  const raw = isPlainObject(value) ? value : {};
  const timezone = cleanString(raw.defaultTimezone, { max: 80, allowEmpty: true }) || 'UTC';
  const defaultDurationMinutes = cleanInteger(raw.defaultDurationMinutes, {
    min: 1,
    max: 1440,
    allowEmpty: true
  });
  const passScorePercent = cleanInteger(raw.passScorePercent, {
    min: 0,
    max: 100,
    allowEmpty: true
  });
  const defaultWindowPolicyToken = cleanString(raw.defaultWindowPolicy, { max: 64, allowEmpty: true }).toLowerCase();
  const defaultQuestionPresentationModeToken = cleanString(raw.defaultQuestionPresentationMode, { max: 64, allowEmpty: true }).toLowerCase();
  return {
    defaultTimezone: timezone,
    defaultDurationMinutes: defaultDurationMinutes ?? 60,
    passScorePercent: passScorePercent ?? 50,
    shuffleQuestions: cleanBoolean(raw.shuffleQuestions, false),
    allowBackNavigation: cleanBoolean(raw.allowBackNavigation, true),
    showResultImmediately: cleanBoolean(raw.showResultImmediately, false),
    defaultWindowPolicy: WINDOW_POLICY_OPTIONS.includes(defaultWindowPolicyToken)
      ? defaultWindowPolicyToken
      : 'strict_fixed_window',
    defaultQuestionPresentationMode: QUESTION_PRESENTATION_MODE_OPTIONS.includes(defaultQuestionPresentationModeToken)
      ? defaultQuestionPresentationModeToken
      : 'all_questions_on_one_page',
    defaultCountsInFinalScore: cleanBoolean(raw.defaultCountsInFinalScore, true)
  };
}

function sanitizeTemplateInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid exam template payload.');
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const title = cleanString(input.title, { max: 220, allowEmpty: false });
  if (!title) throw new Error('Template title is required.');

  const statusToken = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';
  if (!TEMPLATE_STATUSES.includes(statusToken)) {
    throw new Error('Invalid exam template status.');
  }

  const out = {
    orgId,
    code: cleanString(input.code, { max: 80, allowEmpty: true }).toUpperCase(),
    title,
    description: cleanString(input.description, { max: 5000, allowEmpty: true }),
    ownerUserId: cleanId(input.ownerUserId, { max: 80, allowEmpty: true }) || '',
    ownerTeacherId: cleanId(input.ownerTeacherId, { max: 80, allowEmpty: true }) || '',
    visibility: TEMPLATE_VISIBILITIES.includes(cleanString(input.visibility, { max: 20, allowEmpty: true }).toLowerCase())
      ? cleanString(input.visibility, { max: 20, allowEmpty: true }).toLowerCase()
      : 'private',
    departmentId: cleanId(input.departmentId, { max: 80, allowEmpty: true }) || '',
    departmentCode: cleanString(input.departmentCode, { max: 80, allowEmpty: true }).toUpperCase(),
    departmentName: cleanString(input.departmentName, { max: 220, allowEmpty: true }),
    subjectIds: sanitizeSubjectIds(input.subjectIds, input.subjectId),
    subjectId: cleanId(input.subjectId, { max: 80, allowEmpty: true }) || '',
    classLevel: cleanString(input.classLevel, { max: 80, allowEmpty: true }),
    status: statusToken,
    tags: cleanStringArray(input.tags, { maxItem: 80, maxItems: 30 }),
    parentTemplateId: cleanId(input.parentTemplateId, { max: 120, allowEmpty: true }) || '',
    rootTemplateId: cleanId(input.rootTemplateId, { max: 120, allowEmpty: true }) || '',
    revisionDepth: cleanInteger(input.revisionDepth, { min: 0, max: 1000, allowEmpty: true }) ?? 0,
    latestRevisionNo: cleanInteger(input.latestRevisionNo, { min: 0, max: 10000, allowEmpty: true }) ?? 0,
    publishedRevisionId: cleanId(input.publishedRevisionId, { max: 120, allowEmpty: true }) || '',
    settings: sanitizeTemplateSettings(input.settings),
    extensions: isPlainObject(input.extensions) ? input.extensions : {}
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }
  if (!out.subjectId && Array.isArray(out.subjectIds) && out.subjectIds.length) {
    out.subjectId = out.subjectIds[0];
  }

  return out;
}

const store = createJsonEntityModel({
  dataPath,
  idPrefix: 'EXMTPL',
  entityLabel: 'Exam template',
  sanitizeInput: sanitizeTemplateInput,
  mergeForUpdate: (existing, updates) => ({
    ...existing,
    ...(isPlainObject(updates) ? updates : {}),
    orgId: existing.orgId
  })
});

module.exports = {
  TEMPLATE_STATUSES,
  TEMPLATE_VISIBILITIES,
  WINDOW_POLICY_OPTIONS,
  QUESTION_PRESENTATION_MODE_OPTIONS,
  getAllTemplates: store.getAll,
  getTemplateById: store.getById,
  addTemplate: store.add,
  updateTemplate: store.update,
  deleteTemplate: store.remove,
  clearByOrg: store.clearByOrg
};
