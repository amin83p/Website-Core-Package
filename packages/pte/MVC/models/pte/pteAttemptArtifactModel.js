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

const DATA_PATH = path.join(__dirname, '../../../../../data/pteAttemptArtifacts.json');

const ATTEMPT_TYPES = new Set(['test_run', 'single_question_practice', 'skill_practice_run']);
const ARTIFACT_TYPES = new Set(['text', 'audio', 'video', 'file', 'json', 'other']);
const ARTIFACT_STATUSES = new Set(['active', 'archived']);

function normalizeAttemptType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ATTEMPT_TYPES.has(token)) return token;
  if (ATTEMPT_TYPES.has(fallback)) return fallback;
  return '';
}

function normalizeArtifactType(value, fallback = 'other') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ARTIFACT_TYPES.has(token)) return token;
  return ARTIFACT_TYPES.has(fallback) ? fallback : 'other';
}

function normalizeStatus(value, fallback = 'active') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ARTIFACT_STATUSES.has(token)) return token;
  return ARTIFACT_STATUSES.has(fallback) ? fallback : 'active';
}

function sanitizeArtifact(raw = {}, { isUpdate = false, existing = null } = {}) {
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

  const creator = sanitizeCreator(input.creator || prev?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: prev?.audit || null });

  const out = {
    id: cleanId(input.id || prev?.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    userId,
    personId: cleanId(input.personId || prev?.personId, { max: 120, allowEmpty: true }) || '',
    applicantId: cleanId(input.applicantId || prev?.applicantId, { max: 120, allowEmpty: true }) || '',
    attemptSessionId,
    attemptItemId: cleanId(input.attemptItemId || prev?.attemptItemId, { max: 120, allowEmpty: true }) || '',
    attemptType,
    artifactType: normalizeArtifactType(input.artifactType || prev?.artifactType, prev?.artifactType || 'other'),
    status: normalizeStatus(input.status || prev?.status, prev?.status || 'active'),
    clientArtifactId: cleanId(input.clientArtifactId || prev?.clientArtifactId, { max: 160, allowEmpty: true }) || '',
    name: cleanString(input.name || prev?.name, { max: 260, allowEmpty: true }) || '',
    mimeType: cleanString(input.mimeType || prev?.mimeType, { max: 120, allowEmpty: true }) || '',
    sizeBytes: cleanNonNegativeInteger(input.sizeBytes, cleanNonNegativeInteger(prev?.sizeBytes, 0)),
    checksum: cleanString(input.checksum || prev?.checksum, { max: 200, allowEmpty: true }) || '',
    url: cleanString(input.url || prev?.url, { max: 1200, allowEmpty: true }) || '',
    path: cleanString(input.path || prev?.path, { max: 1200, allowEmpty: true }) || '',
    referenceId: cleanId(input.referenceId || prev?.referenceId, { max: 200, allowEmpty: true }) || '',
    durationSeconds: cleanNumber(input.durationSeconds, cleanNumber(prev?.durationSeconds, 0)),
    payloadBytes: cleanNonNegativeInteger(input.payloadBytes, cleanNonNegativeInteger(prev?.payloadBytes, 0)),
    summary: isPlainObject(input.summary)
      ? input.summary
      : (isPlainObject(prev?.summary) ? prev.summary : {}),
    metadata: isPlainObject(input.metadata)
      ? input.metadata
      : (isPlainObject(prev?.metadata) ? prev.metadata : {}),
    createdAt: cleanIso(input.createdAt || prev?.createdAt, { allowEmpty: true }) || new Date().toISOString(),
    source: sanitizeSource(input.source || prev?.source || {}, {
      module: 'pte_attempt_runtime',
      eventType: 'artifact',
      eventIdPrefix: 'PTA-ART'
    }),
    creator,
    audit
  };

  if (isUpdate && prev) {
    out.orgId = prev.orgId;
    out.userId = prev.userId;
    out.attemptSessionId = prev.attemptSessionId;
    out.attemptType = prev.attemptType;
    out.createdAt = prev.createdAt;
  }

  return out;
}

const store = createJsonStore({
  dataPath: DATA_PATH,
  entityLabel: 'PTE attempt artifact',
  idPrefix: 'PTAA',
  sanitizeEntity: sanitizeArtifact
});

module.exports = {
  ATTEMPT_TYPES: Object.freeze(Array.from(ATTEMPT_TYPES)),
  ARTIFACT_TYPES: Object.freeze(Array.from(ARTIFACT_TYPES)),
  ARTIFACT_STATUSES: Object.freeze(Array.from(ARTIFACT_STATUSES)),
  sanitizeArtifact,
  getAllArtifacts: store.getAll,
  getArtifactById: store.getById,
  addArtifact: store.add,
  updateArtifact: store.update,
  deleteArtifact: store.remove
};
