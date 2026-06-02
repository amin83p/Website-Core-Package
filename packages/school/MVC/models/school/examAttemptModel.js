const { requireCoreModule, resolveCoreRoot } = requireCoreModule('MVC/services/school/schoolCoreModuleResolver');
const path = require('path');
const {
  isPlainObject,
  cleanString,
  cleanId,
  cleanInteger,
  cleanIsoUtc,
  cleanBoolean,
  createJsonEntityModel
} = require('./examModelUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/examAttempts.json');

const ATTEMPT_STATUSES = Object.freeze([
  'in_progress',
  'submitted',
  'auto_submitted',
  'graded',
  'abandoned',
  'cancelled'
]);

function sanitizeAttemptInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid exam attempt payload.');
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  const assignmentId = cleanId(input.assignmentId, { max: 120, allowEmpty: false });
  const allocationId = cleanId(input.allocationId, { max: 120, allowEmpty: false });
  const studentId = cleanId(input.studentId, { max: 120, allowEmpty: false });
  const revisionId = cleanId(input.revisionId, { max: 120, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 120, allowEmpty: false });
  if (!orgId || !assignmentId || !allocationId || !studentId || !revisionId || !templateId) {
    throw new Error('orgId, assignmentId, allocationId, studentId, revisionId, and templateId are required.');
  }

  const statusToken = cleanString(input.status, { max: 30, allowEmpty: true }).toLowerCase() || 'in_progress';
  if (!ATTEMPT_STATUSES.includes(statusToken)) throw new Error('Invalid attempt status.');

  const startedAtUtc = cleanIsoUtc(input.startedAtUtc, { allowEmpty: false });
  if (!startedAtUtc) throw new Error('startedAtUtc is required.');
  const expiresAtUtc = cleanIsoUtc(input.expiresAtUtc, { allowEmpty: false });
  if (!expiresAtUtc) throw new Error('expiresAtUtc is required.');
  if (expiresAtUtc <= startedAtUtc) throw new Error('expiresAtUtc must be after startedAtUtc.');

  const submittedAtUtc = cleanIsoUtc(input.submittedAtUtc, { allowEmpty: true }) || '';
  const autoSubmittedAtUtc = cleanIsoUtc(input.autoSubmittedAtUtc, { allowEmpty: true }) || '';
  if (submittedAtUtc && submittedAtUtc < startedAtUtc) throw new Error('submittedAtUtc cannot be before startedAtUtc.');
  if (autoSubmittedAtUtc && autoSubmittedAtUtc < startedAtUtc) throw new Error('autoSubmittedAtUtc cannot be before startedAtUtc.');

  const maxScoreComputed = cleanInteger(input.maxScoreComputed, { min: 0, max: 1000000, allowEmpty: true }) ?? 0;
  const totalScoreComputed = cleanInteger(input.totalScoreComputed, { min: 0, max: 1000000, allowEmpty: true }) ?? 0;
  const percentageComputed = maxScoreComputed > 0
    ? Math.round((totalScoreComputed / maxScoreComputed) * 100)
    : (cleanInteger(input.percentageComputed, { min: 0, max: 100, allowEmpty: true }) ?? 0);

  const out = {
    orgId,
    assignmentId,
    allocationId,
    studentId,
    personId: cleanId(input.personId, { max: 120, allowEmpty: true }) || '',
    templateId,
    revisionId,
    revisionNo: cleanInteger(input.revisionNo, { min: 1, max: 100000, allowEmpty: true }) ?? 1,
    attemptNo: cleanInteger(input.attemptNo, { min: 1, max: 50, allowEmpty: true }) ?? 1,
    status: statusToken,
    startedAtUtc,
    expiresAtUtc,
    submittedAtUtc,
    autoSubmittedAtUtc,
    isAutoSubmitted: cleanBoolean(input.isAutoSubmitted, false),
    isLateSubmission: cleanBoolean(input.isLateSubmission, false),
    durationSecondsUsed: cleanInteger(input.durationSecondsUsed, { min: 0, max: 86400, allowEmpty: true }) ?? 0,
    answerCount: cleanInteger(input.answerCount, { min: 0, max: 100000, allowEmpty: true }) ?? 0,
    totalScoreComputed,
    maxScoreComputed,
    percentageComputed,
    gradeState: cleanString(input.gradeState, { max: 30, allowEmpty: true }) || 'ungraded',
    gradedBy: cleanString(input.gradedBy, { max: 120, allowEmpty: true }),
    gradedAtUtc: cleanIsoUtc(input.gradedAtUtc, { allowEmpty: true }) || '',
    note: cleanString(input.note, { max: 2000, allowEmpty: true }),
    extensions: isPlainObject(input.extensions) ? input.extensions : {}
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }
  return out;
}

const store = createJsonEntityModel({
  dataPath,
  idPrefix: 'EXMATP',
  entityLabel: 'Exam attempt',
  sanitizeInput: sanitizeAttemptInput,
  mergeForUpdate: (existing, updates) => ({
    ...existing,
    ...(isPlainObject(updates) ? updates : {}),
    orgId: existing.orgId,
    assignmentId: existing.assignmentId,
    allocationId: existing.allocationId,
    studentId: existing.studentId,
    templateId: existing.templateId,
    revisionId: existing.revisionId,
    revisionNo: existing.revisionNo,
    attemptNo: existing.attemptNo
  })
});

module.exports = {
  ATTEMPT_STATUSES,
  getAllAttempts: store.getAll,
  getAttemptById: store.getById,
  addAttempt: store.add,
  updateAttempt: store.update,
  deleteAttempt: store.remove,
  clearByOrg: store.clearByOrg
};
