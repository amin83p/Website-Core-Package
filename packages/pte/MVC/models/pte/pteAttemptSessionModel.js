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

const DATA_PATH = path.join(__dirname, '../../../../../data/pteAttemptSessions.json');

const ATTEMPT_TYPES = new Set(['test_run', 'single_question_practice', 'skill_practice_run']);
const SESSION_STATUSES = new Set(['in_progress', 'submitted', 'finished', 'abandoned']);
const SKILLS = ['speaking', 'writing', 'reading', 'listening'];
const EVENT_TYPES = [
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
];

function sanitizeEventCounters(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prior = isPlainObject(existing) ? existing : {};
  const out = {};
  EVENT_TYPES.forEach((key) => {
    const fallback = cleanNonNegativeInteger(prior[key], 0);
    out[key] = cleanNonNegativeInteger(input[key], fallback);
  });
  return out;
}

function sanitizeSkillSummary(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prior = isPlainObject(existing) ? existing : {};
  const out = {};
  SKILLS.forEach((skill) => {
    const row = isPlainObject(input[skill]) ? input[skill] : {};
    const prev = isPlainObject(prior[skill]) ? prior[skill] : {};
    out[skill] = {
      itemCount: cleanNonNegativeInteger(row.itemCount, cleanNonNegativeInteger(prev.itemCount, 0)),
      submittedCount: cleanNonNegativeInteger(row.submittedCount, cleanNonNegativeInteger(prev.submittedCount, 0)),
      averagePercentage: cleanNumber(row.averagePercentage, cleanNumber(prev.averagePercentage, 0)),
      averageTimeSeconds: cleanNumber(row.averageTimeSeconds, cleanNumber(prev.averageTimeSeconds, 0)),
      latestPercentage: cleanNumber(row.latestPercentage, cleanNumber(prev.latestPercentage, 0))
    };
  });
  return out;
}

function normalizeAttemptType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ATTEMPT_TYPES.has(token)) return token;
  if (ATTEMPT_TYPES.has(fallback)) return fallback;
  return '';
}

function normalizeStatus(value, fallback = 'in_progress') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (SESSION_STATUSES.has(token)) return token;
  return SESSION_STATUSES.has(fallback) ? fallback : 'in_progress';
}

function sanitizeSession(raw = {}, { isUpdate = false, existing = null } = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : null;

  const orgId = cleanId(input.orgId || prev?.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId || prev?.userId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!userId) throw new Error('userId is required.');

  const attemptType = normalizeAttemptType(input.attemptType || prev?.attemptType, prev?.attemptType || '');
  if (!attemptType) throw new Error('attemptType is required.');

  const startedAt = cleanIso(input.startedAt || prev?.startedAt, { allowEmpty: true }) || new Date().toISOString();
  const status = normalizeStatus(input.status || prev?.status, 'in_progress');

  const creator = sanitizeCreator(input.creator || prev?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: prev?.audit || null });

  const totalQuestions = cleanNonNegativeInteger(input.totalQuestions, cleanNonNegativeInteger(prev?.totalQuestions, 0));
  const submittedQuestions = cleanNonNegativeInteger(input.submittedQuestions, cleanNonNegativeInteger(prev?.submittedQuestions, 0));
  if (submittedQuestions > totalQuestions) {
    throw new Error('submittedQuestions cannot exceed totalQuestions.');
  }

  const testVersionId = cleanId(input.testVersionId || prev?.testVersionId, { max: 120, allowEmpty: true }) || '';
  if (attemptType === 'test_run' && !testVersionId) {
    throw new Error('testVersionId is required for test_run attempt sessions.');
  }

  const out = {
    id: cleanId(input.id || prev?.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    userId,
    personId: cleanId(input.personId || prev?.personId, { max: 120, allowEmpty: true }) || '',
    applicantId: cleanId(input.applicantId || prev?.applicantId, { max: 120, allowEmpty: true }) || '',
    attemptType,
    status,
    testVersionId,
    testFamilyId: cleanId(input.testFamilyId || prev?.testFamilyId, { max: 140, allowEmpty: true }) || '',
    startedAt,
    submittedAt: cleanIso(input.submittedAt || prev?.submittedAt, { allowEmpty: true }) || '',
    finishedAt: cleanIso(input.finishedAt || prev?.finishedAt, { allowEmpty: true }) || '',
    abandonedAt: cleanIso(input.abandonedAt || prev?.abandonedAt, { allowEmpty: true }) || '',
    firstEventAt: cleanIso(input.firstEventAt || prev?.firstEventAt, { allowEmpty: true }) || '',
    lastEventAt: cleanIso(input.lastEventAt || prev?.lastEventAt, { allowEmpty: true }) || '',
    firstQuestionStartedAt: cleanIso(input.firstQuestionStartedAt || prev?.firstQuestionStartedAt, { allowEmpty: true }) || '',
    lastQuestionFinishedAt: cleanIso(input.lastQuestionFinishedAt || prev?.lastQuestionFinishedAt, { allowEmpty: true }) || '',
    totalQuestions,
    submittedQuestions,
    feedbackCount: cleanNonNegativeInteger(input.feedbackCount, cleanNonNegativeInteger(prev?.feedbackCount, 0)),
    scoreRaw: cleanNumber(input.scoreRaw, cleanNumber(prev?.scoreRaw, 0)),
    scoreFinal: cleanNumber(input.scoreFinal, cleanNumber(prev?.scoreFinal, 0)),
    maxScore: cleanNumber(input.maxScore, cleanNumber(prev?.maxScore, 0)),
    percentage: cleanNumber(input.percentage, cleanNumber(prev?.percentage, 0)),
    accuracyRate: cleanNumber(input.accuracyRate, cleanNumber(prev?.accuracyRate, 0)),
    averageTimePerQuestionSeconds: cleanNumber(
      input.averageTimePerQuestionSeconds,
      cleanNumber(prev?.averageTimePerQuestionSeconds, 0)
    ),
    latestEventType: cleanString(input.latestEventType || prev?.latestEventType, { max: 80, allowEmpty: true }) || '',
    latestEventId: cleanId(input.latestEventId || prev?.latestEventId, { max: 120, allowEmpty: true }) || '',
    eventCounters: sanitizeEventCounters(input.eventCounters, prev?.eventCounters || {}),
    skillSummary: sanitizeSkillSummary(input.skillSummary, prev?.skillSummary || {}),
    metadata: isPlainObject(input.metadata)
      ? input.metadata
      : (isPlainObject(prev?.metadata) ? prev.metadata : {}),
    source: sanitizeSource(input.source || prev?.source || {}, {
      module: 'pte_attempt_runtime',
      eventType: 'attempt_session',
      eventIdPrefix: 'PTA-SES'
    }),
    creator,
    audit
  };

  if (isUpdate && prev) {
    out.orgId = prev.orgId;
    out.userId = prev.userId;
    out.attemptType = prev.attemptType;
    out.startedAt = prev.startedAt;
    out.testVersionId = prev.testVersionId;
  }

  return out;
}

const store = createJsonStore({
  dataPath: DATA_PATH,
  entityLabel: 'PTE attempt session',
  idPrefix: 'PTAS',
  sanitizeEntity: sanitizeSession
});

module.exports = {
  ATTEMPT_TYPES: Object.freeze(Array.from(ATTEMPT_TYPES)),
  SESSION_STATUSES: Object.freeze(Array.from(SESSION_STATUSES)),
  EVENT_TYPES: Object.freeze(EVENT_TYPES),
  sanitizeSession,
  getAllSessions: store.getAll,
  getSessionById: store.getById,
  addSession: store.add,
  updateSession: store.update,
  deleteSession: store.remove
};
