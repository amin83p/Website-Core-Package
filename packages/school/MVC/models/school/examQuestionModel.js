const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const path = require('path');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanInteger,
  cleanNumber,
  cleanBoolean,
  cleanStringArray,
  cleanIdArray,
  createJsonEntityModel
} = require('./examModelUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/examQuestions.json');

const QUESTION_STATUSES = Object.freeze(['draft', 'active', 'archived']);
const QUESTION_TYPES = Object.freeze(['objective', 'subjective']);
const OBJECTIVE_MODES = Object.freeze(['single_choice', 'multiple_choice', 'true_false']);

function sanitizeMediaRefs(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row) => (isPlainObject(row) ? row : null))
    .filter(Boolean)
    .map((row) => ({
      id: cleanId(row.id, { max: 120, allowEmpty: true }) || '',
      fileId: cleanId(row.fileId, { max: 120, allowEmpty: true }) || '',
      label: cleanString(row.label, { max: 160, allowEmpty: true }),
      fileName: cleanString(row.fileName, { max: 260, allowEmpty: true }),
      originalName: cleanString(row.originalName, { max: 260, allowEmpty: true }),
      mimeType: cleanString(row.mimeType, { max: 120, allowEmpty: true }),
      storagePath: cleanString(row.storagePath, { max: 600, allowEmpty: true }),
      url: cleanString(row.url, { max: 800, allowEmpty: true }),
      sizeBytes: cleanInteger(row.sizeBytes, { min: 0, max: Number.MAX_SAFE_INTEGER, allowEmpty: true }) ?? 0
    }))
    .filter((row) => row.fileId || row.url || row.storagePath);
}

function sanitizeObjectiveOptions(value) {
  const rows = Array.isArray(value) ? value : [];
  const seenOptionIds = new Set();
  const out = [];
  rows.forEach((row, index) => {
    const raw = isPlainObject(row) ? row : { text: String(row || '') };
    const optionId = cleanId(raw.id, { max: 80, allowEmpty: true }) || `OPT_${index + 1}`;
    if (seenOptionIds.has(optionId)) return;
    seenOptionIds.add(optionId);
    out.push({
      id: optionId,
      text: cleanString(raw.text, { max: 3000, allowEmpty: false }) || `Option ${index + 1}`,
      isCorrect: cleanBoolean(raw.isCorrect, false),
      order: cleanInteger(raw.order, { min: 1, max: 10000, allowEmpty: true }) ?? (index + 1)
    });
  });
  return out;
}

function sanitizeScoring(value) {
  const raw = isPlainObject(value) ? value : {};
  const maxScore = cleanNumber(raw.maxScore, { min: 0, max: 100000, allowEmpty: true });
  const negativeScore = cleanNumber(raw.negativeScore, { min: -100000, max: 0, allowEmpty: true });
  return {
    maxScore: maxScore !== null ? Number(maxScore.toFixed(2)) : 1,
    negativeScore: negativeScore !== null ? Number(negativeScore.toFixed(2)) : 0,
    partialAllowed: cleanBoolean(raw.partialAllowed, false),
    rubricCriteria: cleanStringArray(raw.rubricCriteria, { maxItem: 800, maxItems: 30 })
  };
}

function sanitizeQuestionInput(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid exam question payload.');
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 120, allowEmpty: false });
  const revisionId = cleanId(input.revisionId, { max: 120, allowEmpty: false });
  if (!orgId || !templateId || !revisionId) throw new Error('orgId, templateId, and revisionId are required.');

  const questionType = cleanString(input.questionType, { max: 30, allowEmpty: false }).toLowerCase();
  if (!QUESTION_TYPES.includes(questionType)) throw new Error('Invalid questionType.');

  const promptText = cleanString(input.promptText, { max: 20000, allowEmpty: true });
  const mediaRefs = sanitizeMediaRefs(input.mediaRefs);
  if (!promptText && mediaRefs.length === 0) {
    throw new Error('Question promptText or mediaRefs is required.');
  }

  const objectiveMode = cleanString(input.objectiveMode, { max: 30, allowEmpty: true }).toLowerCase()
    || (questionType === 'objective' ? 'single_choice' : '');
  if (questionType === 'objective' && !OBJECTIVE_MODES.includes(objectiveMode)) {
    throw new Error('Invalid objectiveMode for objective question.');
  }

  const objectiveOptions = questionType === 'objective'
    ? sanitizeObjectiveOptions(input.objectiveOptions)
    : [];

  if (questionType === 'objective' && objectiveOptions.length < 2) {
    throw new Error('Objective questions require at least 2 options.');
  }
  if (questionType === 'objective' && !objectiveOptions.some((row) => row.isCorrect)) {
    throw new Error('Objective questions require at least one correct option.');
  }

  const statusToken = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';
  if (!QUESTION_STATUSES.includes(statusToken)) throw new Error('Invalid question status.');

  const scoring = sanitizeScoring(input.scoring);
  const out = {
    orgId,
    templateId,
    revisionId,
    sequenceNo: cleanInteger(input.sequenceNo, { min: 1, max: 100000, allowEmpty: true })
      ?? (cleanInteger(existing?.sequenceNo, { min: 1, max: 100000, allowEmpty: true }) || 1),
    questionType,
    objectiveMode: questionType === 'objective' ? objectiveMode : '',
    promptText,
    promptHtml: cleanString(input.promptHtml, { max: 50000, allowEmpty: true }),
    mediaRefs,
    objectiveOptions,
    acceptedOptionIds: questionType === 'objective'
      ? cleanIdArray(input.acceptedOptionIds, { maxItem: 80, maxItems: 100 })
      : [],
    subjectiveConfig: questionType === 'subjective' && isPlainObject(input.subjectiveConfig)
      ? {
          minLength: cleanInteger(input.subjectiveConfig.minLength, { min: 0, max: 20000, allowEmpty: true }) ?? 0,
          maxLength: cleanInteger(input.subjectiveConfig.maxLength, { min: 1, max: 200000, allowEmpty: true }) ?? 4000,
          rubricHint: cleanString(input.subjectiveConfig.rubricHint, { max: 6000, allowEmpty: true }),
          allowAttachments: cleanBoolean(input.subjectiveConfig.allowAttachments, false)
        }
      : { minLength: 0, maxLength: 4000, rubricHint: '', allowAttachments: false },
    scoring,
    tags: cleanStringArray(input.tags, { maxItem: 80, maxItems: 40 }),
    status: statusToken,
    extensions: isPlainObject(input.extensions) ? input.extensions : {}
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }

  return out;
}

const store = createJsonEntityModel({
  dataPath,
  idPrefix: 'EXMQUE',
  entityLabel: 'Exam question',
  sanitizeInput: sanitizeQuestionInput,
  mergeForUpdate: (existing, updates) => ({
    ...existing,
    ...(isPlainObject(updates) ? updates : {}),
    orgId: existing.orgId,
    templateId: existing.templateId,
    revisionId: existing.revisionId
  })
});

module.exports = {
  QUESTION_STATUSES,
  QUESTION_TYPES,
  OBJECTIVE_MODES,
  getAllQuestions: store.getAll,
  getQuestionById: store.getById,
  addQuestion: store.add,
  updateQuestion: store.update,
  deleteQuestion: store.remove,
  clearByOrg: store.clearByOrg
};

