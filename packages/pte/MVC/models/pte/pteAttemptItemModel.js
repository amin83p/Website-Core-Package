const path = require('path');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanIso,
  cleanNumber,
  cleanNonNegativeInteger,
  cleanStringArray,
  sanitizeCreator,
  sanitizeAudit,
  sanitizeSource,
  createJsonStore
} = require('./pteAttemptModelUtils');

const DATA_PATH = path.join(__dirname, '../../../../../data/pteAttemptItems.json');

const ATTEMPT_TYPES = new Set(['test_run', 'single_question_practice', 'skill_practice_run']);
const ITEM_STATUSES = new Set([
  'pending',
  'in_progress',
  'saved',
  'submitted',
  'auto_submitted',
  'scored',
  'feedback_provided',
  'abandoned'
]);
const SKILLS = new Set(['speaking', 'writing', 'reading', 'listening']);
const SELF_DIFFICULTY_VALUES = new Set(['very_easy', 'easy', 'medium', 'hard', 'very_hard']);

function normalizeAttemptType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ATTEMPT_TYPES.has(token)) return token;
  if (ATTEMPT_TYPES.has(fallback)) return fallback;
  return '';
}

function normalizeStatus(value, fallback = 'pending') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ITEM_STATUSES.has(token)) return token;
  return ITEM_STATUSES.has(fallback) ? fallback : 'pending';
}

function normalizeSkill(value, fallback = '') {
  const token = cleanString(value, { max: 30, allowEmpty: true }).toLowerCase();
  if (SKILLS.has(token)) return token;
  if (SKILLS.has(fallback)) return fallback;
  return '';
}

function normalizeSelfDifficulty(value, fallback = '') {
  const token = cleanString(value, { max: 30, allowEmpty: true }).toLowerCase();
  if (SELF_DIFFICULTY_VALUES.has(token)) return token;
  const fallbackToken = cleanString(fallback, { max: 30, allowEmpty: true }).toLowerCase();
  return SELF_DIFFICULTY_VALUES.has(fallbackToken) ? fallbackToken : '';
}

function sanitizeResponseSummary(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : {};
  return {
    kind: cleanString(input.kind || prev.kind, { max: 80, allowEmpty: true }) || '',
    payloadBytes: cleanNonNegativeInteger(input.payloadBytes, cleanNonNegativeInteger(prev.payloadBytes, 0)),
    textLength: cleanNonNegativeInteger(input.textLength, cleanNonNegativeInteger(prev.textLength, 0)),
    wordCount: cleanNonNegativeInteger(input.wordCount, cleanNonNegativeInteger(prev.wordCount, 0)),
    optionCount: cleanNonNegativeInteger(input.optionCount, cleanNonNegativeInteger(prev.optionCount, 0)),
    blankCount: cleanNonNegativeInteger(input.blankCount, cleanNonNegativeInteger(prev.blankCount, 0)),
    pairCount: cleanNonNegativeInteger(input.pairCount, cleanNonNegativeInteger(prev.pairCount, 0)),
    audioDurationSeconds: cleanNumber(input.audioDurationSeconds, cleanNumber(prev.audioDurationSeconds, 0)),
    artifactCount: cleanNonNegativeInteger(input.artifactCount, cleanNonNegativeInteger(prev.artifactCount, 0))
  };
}

function sanitizeItem(raw = {}, { isUpdate = false, existing = null } = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : null;

  const orgId = cleanId(input.orgId || prev?.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId || prev?.userId, { max: 120, allowEmpty: false });
  const attemptSessionId = cleanId(input.attemptSessionId || prev?.attemptSessionId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!userId) throw new Error('userId is required.');
  if (!attemptSessionId) throw new Error('attemptSessionId is required.');

  const attemptType = normalizeAttemptType(input.attemptType || prev?.attemptType, prev?.attemptType || '');
  if (!attemptType) throw new Error('attemptType is required.');

  const questionVersionId = cleanId(input.questionVersionId || prev?.questionVersionId, { max: 120, allowEmpty: false });
  if (!questionVersionId) throw new Error('questionVersionId is required.');

  const skill = normalizeSkill(input.skill || prev?.skill, prev?.skill || '');
  if (!skill) throw new Error('skill is required.');

  const questionType = cleanString(input.questionType || prev?.questionType, { max: 120, allowEmpty: true }).toLowerCase();
  if (!questionType) throw new Error('questionType is required.');

  const questionOrder = Math.max(1, cleanNonNegativeInteger(input.questionOrder, cleanNonNegativeInteger(prev?.questionOrder, 1)));
  const startedAt = cleanIso(input.startedAt || prev?.startedAt, { allowEmpty: true }) || '';
  const submittedAt = cleanIso(input.submittedAt || prev?.submittedAt, { allowEmpty: true }) || '';
  const finishedAt = cleanIso(input.finishedAt || prev?.finishedAt, { allowEmpty: true }) || '';
  const feedbackProvidedAt = cleanIso(input.feedbackProvidedAt || prev?.feedbackProvidedAt, { allowEmpty: true }) || '';

  const creator = sanitizeCreator(input.creator || prev?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: prev?.audit || null });

  const out = {
    id: cleanId(input.id || prev?.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    userId,
    personId: cleanId(input.personId || prev?.personId, { max: 120, allowEmpty: true }) || '',
    applicantId: cleanId(input.applicantId || prev?.applicantId, { max: 120, allowEmpty: true }) || '',
    attemptSessionId,
    attemptType,
    status: normalizeStatus(input.status || prev?.status, prev?.status || 'pending'),
    testVersionId: cleanId(input.testVersionId || prev?.testVersionId, { max: 120, allowEmpty: true }) || '',
    questionVersionId,
    questionFamilyId: cleanId(input.questionFamilyId || prev?.questionFamilyId, { max: 140, allowEmpty: true }) || '',
    questionType,
    skill,
    questionOrder,
    startedAt,
    firstSavedAt: cleanIso(input.firstSavedAt || prev?.firstSavedAt, { allowEmpty: true }) || '',
    lastSavedAt: cleanIso(input.lastSavedAt || prev?.lastSavedAt, { allowEmpty: true }) || '',
    submittedAt,
    finishedAt,
    feedbackProvidedAt,
    timeSpentSeconds: cleanNonNegativeInteger(input.timeSpentSeconds, cleanNonNegativeInteger(prev?.timeSpentSeconds, 0)),
    saveCount: cleanNonNegativeInteger(input.saveCount, cleanNonNegativeInteger(prev?.saveCount, 0)),
    submitCount: cleanNonNegativeInteger(input.submitCount, cleanNonNegativeInteger(prev?.submitCount, 0)),
    skipCount: cleanNonNegativeInteger(input.skipCount, cleanNonNegativeInteger(prev?.skipCount, 0)),
    viewCount: cleanNonNegativeInteger(input.viewCount, cleanNonNegativeInteger(prev?.viewCount, 0)),
    totalSeenSeconds: cleanNonNegativeInteger(input.totalSeenSeconds, cleanNonNegativeInteger(prev?.totalSeenSeconds, 0)),
    scoreRevisionCount: cleanNonNegativeInteger(input.scoreRevisionCount, cleanNonNegativeInteger(prev?.scoreRevisionCount, 0)),
    feedbackRevisionCount: cleanNonNegativeInteger(input.feedbackRevisionCount, cleanNonNegativeInteger(prev?.feedbackRevisionCount, 0)),
    revisionNo: cleanNonNegativeInteger(input.revisionNo, cleanNonNegativeInteger(prev?.revisionNo, 0)),
    scoreRaw: cleanNumber(input.scoreRaw, cleanNumber(prev?.scoreRaw, 0)),
    scoreFinal: cleanNumber(input.scoreFinal, cleanNumber(prev?.scoreFinal, 0)),
    maxScore: cleanNumber(input.maxScore, cleanNumber(prev?.maxScore, 0)),
    percentage: cleanNumber(input.percentage, cleanNumber(prev?.percentage, 0)),
    traitScores: isPlainObject(input.traitScores)
      ? input.traitScores
      : (isPlainObject(prev?.traitScores) ? prev.traitScores : {}),
    isCorrect: input.isCorrect === undefined
      ? (prev?.isCorrect === true ? true : (prev?.isCorrect === false ? false : null))
      : (input.isCorrect === true ? true : (input.isCorrect === false ? false : null)),
    selfDifficultyRating: normalizeSelfDifficulty(input.selfDifficultyRating, prev?.selfDifficultyRating || ''),
    selfDifficultyRatedAt: cleanIso(input.selfDifficultyRatedAt || prev?.selfDifficultyRatedAt, { allowEmpty: true }) || '',
    latestFeedback: cleanString(input.latestFeedback || prev?.latestFeedback, { max: 20000, allowEmpty: true }) || '',
    responseSummary: sanitizeResponseSummary(input.responseSummary, prev?.responseSummary || {}),
    artifactIds: cleanStringArray(input.artifactIds !== undefined ? input.artifactIds : (prev?.artifactIds || []), { maxItem: 120 }),
    metadata: isPlainObject(input.metadata)
      ? input.metadata
      : (isPlainObject(prev?.metadata) ? prev.metadata : {}),
    source: sanitizeSource(input.source || prev?.source || {}, {
      module: 'pte_attempt_runtime',
      eventType: 'attempt_item',
      eventIdPrefix: 'PTA-ITM'
    }),
    creator,
    audit
  };

  if (isUpdate && prev) {
    out.orgId = prev.orgId;
    out.userId = prev.userId;
    out.attemptSessionId = prev.attemptSessionId;
    out.attemptType = prev.attemptType;
    out.questionVersionId = prev.questionVersionId;
    out.questionType = prev.questionType;
    out.skill = prev.skill;
    out.questionOrder = prev.questionOrder;
  }

  return out;
}

const store = createJsonStore({
  dataPath: DATA_PATH,
  entityLabel: 'PTE attempt item',
  idPrefix: 'PTAI',
  sanitizeEntity: sanitizeItem
});

module.exports = {
  ATTEMPT_TYPES: Object.freeze(Array.from(ATTEMPT_TYPES)),
  ITEM_STATUSES: Object.freeze(Array.from(ITEM_STATUSES)),
  SKILLS: Object.freeze(Array.from(SKILLS)),
  SELF_DIFFICULTY_VALUES: Object.freeze(Array.from(SELF_DIFFICULTY_VALUES)),
  sanitizeItem,
  getAllItems: store.getAll,
  getItemById: store.getById,
  addItem: store.add,
  updateItem: store.update,
  deleteItem: store.remove
};
