const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const path = require('path');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanInteger,
  cleanBoolean,
  cleanIsoUtc,
  cleanDateOnly,
  cleanStringArray,
  createJsonEntityModel
} = require('./examModelUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/examAllocations.json');

const ALLOCATION_STATUSES = Object.freeze(['draft', 'scheduled', 'open', 'closed', 'cancelled', 'archived']);
const WINDOW_POLICY_OPTIONS = Object.freeze(['strict_fixed_window', 'suggested_window']);
const QUESTION_PRESENTATION_MODE_OPTIONS = Object.freeze(['sequential_one_by_one', 'all_questions_on_one_page']);

function sanitizeScheduling(value) {
  const raw = isPlainObject(value) ? value : {};
  const timezone = cleanString(raw.timezone, { max: 80, allowEmpty: true }) || 'UTC';
  const windowStartUtc = cleanIsoUtc(raw.windowStartUtc, { allowEmpty: false });
  const windowEndUtc = cleanIsoUtc(raw.windowEndUtc, { allowEmpty: false });
  if (!windowStartUtc || !windowEndUtc) {
    throw new Error('windowStartUtc and windowEndUtc are required.');
  }
  if (windowEndUtc <= windowStartUtc) {
    throw new Error('windowEndUtc must be later than windowStartUtc.');
  }
  return {
    timezone,
    windowStartUtc,
    windowEndUtc,
    windowStartLocalDate: cleanDateOnly(raw.windowStartLocalDate, { allowEmpty: true }) || '',
    windowEndLocalDate: cleanDateOnly(raw.windowEndLocalDate, { allowEmpty: true }) || '',
    windowStartLocalTime: cleanString(raw.windowStartLocalTime, { max: 8, allowEmpty: true }),
    windowEndLocalTime: cleanString(raw.windowEndLocalTime, { max: 8, allowEmpty: true })
  };
}

function sanitizeAllocationInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid exam allocation payload.');
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 120, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 120, allowEmpty: false });
  const revisionId = cleanId(input.revisionId, { max: 120, allowEmpty: false });
  if (!orgId || !classId || !templateId || !revisionId) {
    throw new Error('orgId, classId, templateId, and revisionId are required.');
  }

  const statusToken = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';
  if (!ALLOCATION_STATUSES.includes(statusToken)) throw new Error('Invalid allocation status.');

  const scheduling = sanitizeScheduling(input.scheduling || input);
  const windowPolicyToken = cleanString(input.windowPolicy, { max: 64, allowEmpty: true }).toLowerCase();
  const questionPresentationModeToken = cleanString(input.questionPresentationMode, { max: 64, allowEmpty: true }).toLowerCase();
  const out = {
    orgId,
    classId,
    templateId,
    revisionId,
    revisionNo: cleanInteger(input.revisionNo, { min: 1, max: 100000, allowEmpty: true }) ?? 1,
    allocationName: cleanString(input.allocationName || input.title, { max: 220, allowEmpty: false }) || 'Exam Allocation',
    instructionsForStudents: cleanString(input.instructionsForStudents, { max: 12000, allowEmpty: true }),
    status: statusToken,
    scheduling,
    timezone: scheduling.timezone,
    windowStartUtc: scheduling.windowStartUtc,
    windowEndUtc: scheduling.windowEndUtc,
    durationMinutes: cleanInteger(input.durationMinutes, { min: 1, max: 1440, allowEmpty: true }) ?? 60,
    autoSubmitOnExpire: cleanBoolean(input.autoSubmitOnExpire, true),
    allowLateStart: cleanBoolean(input.allowLateStart, false),
    maxAttemptsPerStudent: cleanInteger(input.maxAttemptsPerStudent, { min: 1, max: 20, allowEmpty: true }) ?? 1,
    shuffleQuestions: cleanBoolean(input.shuffleQuestions, false),
    windowPolicy: WINDOW_POLICY_OPTIONS.includes(windowPolicyToken) ? windowPolicyToken : 'strict_fixed_window',
    questionPresentationMode: QUESTION_PRESENTATION_MODE_OPTIONS.includes(questionPresentationModeToken)
      ? questionPresentationModeToken
      : 'all_questions_on_one_page',
    countsInFinalScore: cleanBoolean(input.countsInFinalScore, true),
    tags: cleanStringArray(input.tags, { maxItem: 80, maxItems: 40 }),
    extensions: isPlainObject(input.extensions) ? input.extensions : {}
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }
  return out;
}

const store = createJsonEntityModel({
  dataPath,
  idPrefix: 'EXMALC',
  entityLabel: 'Exam allocation',
  sanitizeInput: sanitizeAllocationInput,
  mergeForUpdate: (existing, updates) => ({
    ...existing,
    ...(isPlainObject(updates) ? updates : {}),
    orgId: existing.orgId,
    classId: existing.classId,
    templateId: existing.templateId,
    revisionId: existing.revisionId,
    revisionNo: existing.revisionNo
  })
});

module.exports = {
  ALLOCATION_STATUSES,
  WINDOW_POLICY_OPTIONS,
  QUESTION_PRESENTATION_MODE_OPTIONS,
  getAllAllocations: store.getAll,
  getAllocationById: store.getById,
  addAllocation: store.add,
  updateAllocation: store.update,
  deleteAllocation: store.remove,
  clearByOrg: store.clearByOrg
};
