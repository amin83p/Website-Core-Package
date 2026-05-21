const path = require('path');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanIso,
  cleanNumber,
  cleanNonNegativeInteger,
  sanitizeCreator,
  sanitizeAudit,
  sanitizeSource,
  createJsonStore
} = require('./pteAttemptModelUtils');

const DATA_PATH = path.join(__dirname, '../../../data/pteAttemptLedgerEvents.json');

const ATTEMPT_TYPES = new Set(['test_run', 'single_question_practice', 'skill_practice_run']);
const EVENT_TYPES = new Set([
  'attempt_started',
  'question_started',
  'response_saved',
  'question_skipped',
  'question_submitted',
  'question_auto_submitted',
  'score_recorded',
  'score_updated',
  'feedback_added',
  'feedback_updated',
  'difficulty_rated',
  'attempt_submitted',
  'attempt_finished',
  'attempt_abandoned'
]);
const SKILLS = new Set(['speaking', 'writing', 'reading', 'listening']);
const SELF_DIFFICULTY_VALUES = new Set(['very_easy', 'easy', 'medium', 'hard', 'very_hard']);

function normalizeAttemptType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ATTEMPT_TYPES.has(token)) return token;
  if (ATTEMPT_TYPES.has(fallback)) return fallback;
  return '';
}

function normalizeEventType(value) {
  const token = cleanString(value, { max: 80, allowEmpty: true }).toLowerCase();
  if (!EVENT_TYPES.has(token)) throw new Error(`Unsupported eventType '${token || ''}'.`);
  return token;
}

function normalizeSkill(value) {
  const token = cleanString(value, { max: 30, allowEmpty: true }).toLowerCase();
  if (!token) return '';
  if (!SKILLS.has(token)) throw new Error(`Invalid skill '${token}'.`);
  return token;
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

function sanitizeArtifactRefs(raw = []) {
  const rows = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  rows.forEach((entry) => {
    const row = isPlainObject(entry) ? entry : {};
    const artifactId = cleanId(row.artifactId || row.id, { max: 120, allowEmpty: true }) || '';
    if (artifactId && seen.has(artifactId)) return;
    if (artifactId) seen.add(artifactId);
    out.push({
      artifactId,
      artifactType: cleanString(row.artifactType || row.type, { max: 80, allowEmpty: true }) || '',
      name: cleanString(row.name, { max: 260, allowEmpty: true }) || '',
      mimeType: cleanString(row.mimeType, { max: 120, allowEmpty: true }) || '',
      sizeBytes: cleanNonNegativeInteger(row.sizeBytes || row.size, 0),
      url: cleanString(row.url, { max: 1200, allowEmpty: true }) || '',
      path: cleanString(row.path, { max: 1200, allowEmpty: true }) || '',
      referenceId: cleanId(row.referenceId, { max: 160, allowEmpty: true }) || ''
    });
  });
  return out;
}

function sanitizeEvent(raw = {}, { isUpdate = false, existing = null } = {}) {
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

  const eventType = normalizeEventType(input.eventType || prev?.eventType || '');
  const creator = sanitizeCreator(input.creator || prev?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: prev?.audit || null });

  const out = {
    id: cleanId(input.id || prev?.id, { max: 120, allowEmpty: true }) || '',
    eventAt: cleanIso(input.eventAt || prev?.eventAt, { allowEmpty: true }) || new Date().toISOString(),
    orgId,
    userId,
    personId: cleanId(input.personId || prev?.personId, { max: 120, allowEmpty: true }) || '',
    applicantId: cleanId(input.applicantId || prev?.applicantId, { max: 120, allowEmpty: true }) || '',
    attemptSessionId,
    attemptItemId: cleanId(input.attemptItemId || prev?.attemptItemId, { max: 120, allowEmpty: true }) || '',
    attemptType,
    eventType,
    testVersionId: cleanId(input.testVersionId || prev?.testVersionId, { max: 120, allowEmpty: true }) || '',
    questionVersionId: cleanId(input.questionVersionId || prev?.questionVersionId, { max: 120, allowEmpty: true }) || '',
    questionFamilyId: cleanId(input.questionFamilyId || prev?.questionFamilyId, { max: 140, allowEmpty: true }) || '',
    questionType: cleanString(input.questionType || prev?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
    skill: normalizeSkill(input.skill || prev?.skill || ''),
    questionOrder: Math.max(0, cleanNonNegativeInteger(input.questionOrder, cleanNonNegativeInteger(prev?.questionOrder, 0))),
    startedAt: cleanIso(input.startedAt || prev?.startedAt, { allowEmpty: true }) || '',
    finishedAt: cleanIso(input.finishedAt || prev?.finishedAt, { allowEmpty: true }) || '',
    feedbackProvidedAt: cleanIso(input.feedbackProvidedAt || prev?.feedbackProvidedAt, { allowEmpty: true }) || '',
    timeSpentSeconds: cleanNumber(input.timeSpentSeconds, cleanNumber(prev?.timeSpentSeconds, 0)),
    scoreRaw: cleanNumber(input.scoreRaw, cleanNumber(prev?.scoreRaw, 0)),
    scoreFinal: cleanNumber(input.scoreFinal, cleanNumber(prev?.scoreFinal, 0)),
    maxScore: cleanNumber(input.maxScore, cleanNumber(prev?.maxScore, 0)),
    percentage: cleanNumber(input.percentage, cleanNumber(prev?.percentage, 0)),
    traitScores: isPlainObject(input.traitScores)
      ? input.traitScores
      : (isPlainObject(prev?.traitScores) ? prev.traitScores : {}),
    selfDifficultyRating: normalizeSelfDifficulty(input.selfDifficultyRating, prev?.selfDifficultyRating || ''),
    responseSummary: sanitizeResponseSummary(input.responseSummary, prev?.responseSummary || {}),
    artifactRefs: sanitizeArtifactRefs(input.artifactRefs !== undefined ? input.artifactRefs : (prev?.artifactRefs || [])),
    metadata: isPlainObject(input.metadata)
      ? input.metadata
      : (isPlainObject(prev?.metadata) ? prev.metadata : {}),
    source: sanitizeSource(input.source || prev?.source || {}, {
      module: 'pte_attempt_runtime',
      eventType,
      eventIdPrefix: 'PTA-EVT'
    }),
    creator,
    audit
  };

  if (isUpdate && prev) {
    out.orgId = prev.orgId;
    out.userId = prev.userId;
    out.attemptSessionId = prev.attemptSessionId;
    out.attemptType = prev.attemptType;
  }

  return out;
}

const store = createJsonStore({
  dataPath: DATA_PATH,
  entityLabel: 'PTE attempt ledger event',
  idPrefix: 'PTAE',
  sanitizeEntity: sanitizeEvent
});

module.exports = {
  ATTEMPT_TYPES: Object.freeze(Array.from(ATTEMPT_TYPES)),
  EVENT_TYPES: Object.freeze(Array.from(EVENT_TYPES)),
  sanitizeEvent,
  getAllEvents: store.getAll,
  getEventById: store.getById,
  addEvent: store.add,
  updateEvent: store.update,
  deleteEvent: store.remove
};
