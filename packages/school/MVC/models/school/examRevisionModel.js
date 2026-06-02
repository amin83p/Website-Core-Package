const { requireCoreModule, resolveCoreRoot } = requireCoreModule('MVC/services/school/schoolCoreModuleResolver');
const path = require('path');
const crypto = require('crypto');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanInteger,
  cleanIsoUtc,
  cleanStringArray,
  createJsonEntityModel
} = require('./examModelUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/examRevisions.json');

const REVISION_STATUSES = Object.freeze(['draft', 'published', 'retired', 'archived']);

function sanitizeBlueprintSummary(value) {
  const raw = isPlainObject(value) ? value : {};
  return {
    sectionCount: cleanInteger(raw.sectionCount, { min: 0, max: 200, allowEmpty: true }) ?? 0,
    objectiveQuestionCount: cleanInteger(raw.objectiveQuestionCount, { min: 0, max: 2000, allowEmpty: true }) ?? 0,
    subjectiveQuestionCount: cleanInteger(raw.subjectiveQuestionCount, { min: 0, max: 2000, allowEmpty: true }) ?? 0,
    guidance: cleanString(raw.guidance, { max: 5000, allowEmpty: true })
  };
}

function sanitizeRevisionInput(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid exam revision payload.');
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 120, allowEmpty: false });
  if (!orgId || !templateId) throw new Error('orgId and templateId are required.');

  const revisionNo = cleanInteger(input.revisionNo, { min: 1, max: 10000, allowEmpty: false });
  if (!revisionNo) throw new Error('revisionNo is required.');

  const statusToken = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';
  if (!REVISION_STATUSES.includes(statusToken)) {
    throw new Error('Invalid exam revision status.');
  }

  const instructions = cleanString(input.instructions, { max: 20000, allowEmpty: true });
  const title = cleanString(input.title, { max: 220, allowEmpty: false }) || `Revision ${revisionNo}`;
  const nowIso = new Date().toISOString();
  const publishedAt = cleanIsoUtc(input.publishedAt, { allowEmpty: true });
  const publishUser = cleanString(input.publishedBy, { max: 120, allowEmpty: true });
  const totalQuestions = cleanInteger(input.totalQuestions, { min: 0, max: 100000, allowEmpty: true }) ?? 0;
  const totalScore = cleanInteger(input.totalScore, { min: 0, max: 1000000, allowEmpty: true }) ?? 0;
  const checksumSource = JSON.stringify({
    templateId,
    revisionNo,
    title,
    instructions,
    totalQuestions,
    totalScore
  });
  const checksum = cleanString(input.checksum, { max: 80, allowEmpty: true })
    || crypto.createHash('sha1').update(checksumSource).digest('hex');

  const out = {
    orgId,
    templateId,
    revisionNo,
    title,
    status: statusToken,
    instructions,
    totalQuestions,
    totalScore,
    durationMinutes: cleanInteger(input.durationMinutes, { min: 1, max: 1440, allowEmpty: true }) ?? 60,
    blueprintSummary: sanitizeBlueprintSummary(input.blueprintSummary),
    tags: cleanStringArray(input.tags, { maxItem: 80, maxItems: 40 }),
    checksum,
    isImmutable: statusToken === 'published' || input.isImmutable === true,
    publishedAt: statusToken === 'published' ? (publishedAt || nowIso) : '',
    publishedBy: statusToken === 'published' ? (publishUser || cleanString(input.audit?.lastUpdateUser, { max: 120, allowEmpty: true })) : '',
    retiredAt: cleanIsoUtc(input.retiredAt, { allowEmpty: true }),
    retiredBy: cleanString(input.retiredBy, { max: 120, allowEmpty: true }),
    extensions: isPlainObject(input.extensions) ? input.extensions : {}
  };

  if (isUpdate && existing?.isImmutable === true) {
    out.isImmutable = true;
    out.status = existing.status;
    out.publishedAt = existing.publishedAt || out.publishedAt;
    out.publishedBy = existing.publishedBy || out.publishedBy;
  }

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }

  return out;
}

const store = createJsonEntityModel({
  dataPath,
  idPrefix: 'EXMREV',
  entityLabel: 'Exam revision',
  sanitizeInput: sanitizeRevisionInput,
  mergeForUpdate: (existing, updates) => ({
    ...existing,
    ...(isPlainObject(updates) ? updates : {}),
    orgId: existing.orgId,
    templateId: existing.templateId,
    revisionNo: existing.revisionNo
  })
});

module.exports = {
  REVISION_STATUSES,
  getAllRevisions: store.getAll,
  getRevisionById: store.getById,
  addRevision: store.add,
  updateRevision: store.update,
  deleteRevision: store.remove,
  clearByOrg: store.clearByOrg
};
