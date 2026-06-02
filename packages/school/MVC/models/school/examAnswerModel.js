const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const path = require('path');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanInteger,
  cleanNumber,
  cleanBoolean,
  cleanIsoUtc,
  cleanIdArray,
  createJsonEntityModel
} = require('./examModelUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/examAnswers.json');

const ANSWER_STATUSES = Object.freeze(['saved', 'submitted', 'graded', 'voided']);
const ANSWER_TYPES = Object.freeze(['objective', 'subjective']);

function sanitizeAttachmentRefs(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row) => (isPlainObject(row) ? row : null))
    .filter(Boolean)
    .map((row) => ({
      fileId: cleanId(row.fileId, { max: 120, allowEmpty: true }) || '',
      fileName: cleanString(row.fileName, { max: 260, allowEmpty: true }),
      mimeType: cleanString(row.mimeType, { max: 120, allowEmpty: true }),
      storagePath: cleanString(row.storagePath, { max: 600, allowEmpty: true }),
      url: cleanString(row.url, { max: 800, allowEmpty: true }),
      sizeBytes: cleanInteger(row.sizeBytes, { min: 0, max: Number.MAX_SAFE_INTEGER, allowEmpty: true }) ?? 0
    }))
    .filter((row) => row.fileId || row.url || row.storagePath);
}

function sanitizeAnswerInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid exam answer payload.');
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  const attemptId = cleanId(input.attemptId, { max: 120, allowEmpty: false });
  const assignmentId = cleanId(input.assignmentId, { max: 120, allowEmpty: false });
  const questionId = cleanId(input.questionId, { max: 120, allowEmpty: false });
  const revisionId = cleanId(input.revisionId, { max: 120, allowEmpty: false });
  const studentId = cleanId(input.studentId, { max: 120, allowEmpty: false });
  if (!orgId || !attemptId || !assignmentId || !questionId || !revisionId || !studentId) {
    throw new Error('orgId, attemptId, assignmentId, questionId, revisionId, and studentId are required.');
  }

  const answerType = cleanString(input.answerType, { max: 30, allowEmpty: false }).toLowerCase();
  if (!ANSWER_TYPES.includes(answerType)) throw new Error('Invalid answerType.');

  const statusToken = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'saved';
  if (!ANSWER_STATUSES.includes(statusToken)) throw new Error('Invalid answer status.');

  const objectiveResponse = answerType === 'objective'
    ? {
        selectedOptionIds: cleanIdArray(input.objectiveResponse?.selectedOptionIds || input.selectedOptionIds, {
          maxItem: 80,
          maxItems: 80
        }),
        rawValue: cleanString(input.objectiveResponse?.rawValue || input.rawValue, { max: 2000, allowEmpty: true })
      }
    : { selectedOptionIds: [], rawValue: '' };

  const subjectiveResponse = answerType === 'subjective'
    ? {
        text: cleanString(input.subjectiveResponse?.text || input.text, { max: 100000, allowEmpty: true }),
        attachments: sanitizeAttachmentRefs(input.subjectiveResponse?.attachments || input.attachments)
      }
    : { text: '', attachments: [] };

  const autoScore = cleanNumber(input.autoScore, { min: 0, max: 100000, allowEmpty: true });
  const manualScore = cleanNumber(input.manualScore, { min: 0, max: 100000, allowEmpty: true });
  const finalScore = manualScore !== null
    ? Number(manualScore.toFixed(2))
    : (autoScore !== null ? Number(autoScore.toFixed(2)) : 0);

  const out = {
    orgId,
    attemptId,
    assignmentId,
    questionId,
    revisionId,
    studentId,
    answerType,
    status: statusToken,
    objectiveResponse,
    subjectiveResponse,
    autoScore: autoScore !== null ? Number(autoScore.toFixed(2)) : null,
    manualScore: manualScore !== null ? Number(manualScore.toFixed(2)) : null,
    finalScore,
    isCorrect: cleanBoolean(input.isCorrect, false),
    feedback: cleanString(input.feedback, { max: 8000, allowEmpty: true }),
    gradedBy: cleanString(input.gradedBy, { max: 120, allowEmpty: true }),
    gradedAtUtc: cleanIsoUtc(input.gradedAtUtc, { allowEmpty: true }) || '',
    answeredAtUtc: cleanIsoUtc(input.answeredAtUtc, { allowEmpty: true }) || new Date().toISOString(),
    updatedFromClientAtUtc: cleanIsoUtc(input.updatedFromClientAtUtc, { allowEmpty: true }) || '',
    extensions: isPlainObject(input.extensions) ? input.extensions : {}
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }
  return out;
}

const store = createJsonEntityModel({
  dataPath,
  idPrefix: 'EXMANS',
  entityLabel: 'Exam answer',
  sanitizeInput: sanitizeAnswerInput,
  mergeForUpdate: (existing, updates) => ({
    ...existing,
    ...(isPlainObject(updates) ? updates : {}),
    orgId: existing.orgId,
    attemptId: existing.attemptId,
    assignmentId: existing.assignmentId,
    questionId: existing.questionId,
    revisionId: existing.revisionId,
    studentId: existing.studentId,
    answerType: existing.answerType
  })
});

module.exports = {
  ANSWER_STATUSES,
  ANSWER_TYPES,
  getAllAnswers: store.getAll,
  getAnswerById: store.getById,
  addAnswer: store.add,
  updateAnswer: store.update,
  deleteAnswer: store.remove,
  clearByOrg: store.clearByOrg
};
