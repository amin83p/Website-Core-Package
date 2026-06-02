const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
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

const dataPath = path.join(resolveCoreRoot(), 'data/school/examAssignments.json');

const ASSIGNMENT_STATUSES = Object.freeze([
  'pending',
  'available',
  'started',
  'submitted',
  'auto_submitted',
  'graded',
  'expired',
  'cancelled'
]);

function sanitizeAssignmentInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid exam assignment payload.');
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  const allocationId = cleanId(input.allocationId, { max: 120, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 120, allowEmpty: false });
  const studentId = cleanId(input.studentId, { max: 120, allowEmpty: false });
  const revisionId = cleanId(input.revisionId, { max: 120, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 120, allowEmpty: false });
  if (!orgId || !allocationId || !classId || !studentId || !revisionId || !templateId) {
    throw new Error('orgId, allocationId, classId, studentId, revisionId, and templateId are required.');
  }

  const statusToken = cleanString(input.status, { max: 30, allowEmpty: true }).toLowerCase() || 'pending';
  if (!ASSIGNMENT_STATUSES.includes(statusToken)) throw new Error('Invalid assignment status.');

  const startWindowUtc = cleanIsoUtc(input.startWindowUtc, { allowEmpty: false });
  const endWindowUtc = cleanIsoUtc(input.endWindowUtc, { allowEmpty: false });
  if (!startWindowUtc || !endWindowUtc) throw new Error('startWindowUtc and endWindowUtc are required.');
  if (endWindowUtc <= startWindowUtc) throw new Error('endWindowUtc must be later than startWindowUtc.');

  const out = {
    orgId,
    allocationId,
    classId,
    studentId,
    personId: cleanId(input.personId, { max: 120, allowEmpty: true }) || '',
    templateId,
    revisionId,
    revisionNo: cleanInteger(input.revisionNo, { min: 1, max: 100000, allowEmpty: true }) ?? 1,
    status: statusToken,
    assignedAtUtc: cleanIsoUtc(input.assignedAtUtc, { allowEmpty: true }) || new Date().toISOString(),
    startWindowUtc,
    endWindowUtc,
    durationMinutes: cleanInteger(input.durationMinutes, { min: 1, max: 1440, allowEmpty: true }) ?? 60,
    allowLateStart: cleanBoolean(input.allowLateStart, false),
    maxAttemptsAllowed: cleanInteger(input.maxAttemptsAllowed, { min: 1, max: 20, allowEmpty: true }) ?? 1,
    startedAttemptId: cleanId(input.startedAttemptId, { max: 120, allowEmpty: true }) || '',
    submittedAttemptId: cleanId(input.submittedAttemptId, { max: 120, allowEmpty: true }) || '',
    scoreComputed: cleanInteger(input.scoreComputed, { min: 0, max: 1000000, allowEmpty: true }) ?? 0,
    maxScoreComputed: cleanInteger(input.maxScoreComputed, { min: 0, max: 1000000, allowEmpty: true }) ?? 0,
    percentageComputed: cleanInteger(input.percentageComputed, { min: 0, max: 100, allowEmpty: true }) ?? 0,
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
  idPrefix: 'EXMASG',
  entityLabel: 'Exam assignment',
  sanitizeInput: sanitizeAssignmentInput,
  mergeForUpdate: (existing, updates) => ({
    ...existing,
    ...(isPlainObject(updates) ? updates : {}),
    orgId: existing.orgId,
    allocationId: existing.allocationId,
    classId: existing.classId,
    studentId: existing.studentId,
    templateId: existing.templateId,
    revisionId: existing.revisionId,
    revisionNo: existing.revisionNo
  })
});

module.exports = {
  ASSIGNMENT_STATUSES,
  getAllAssignments: store.getAll,
  getAssignmentById: store.getById,
  addAssignment: store.add,
  updateAssignment: store.update,
  deleteAssignment: store.remove,
  clearByOrg: store.clearByOrg
};
