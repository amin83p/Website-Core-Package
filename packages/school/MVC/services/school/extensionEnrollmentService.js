const schoolRepositories = require('../../repositories/school');
const classEnrollmentPeriodService = require('./classEnrollmentPeriodService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

let dependencies = {
  repositories: schoolRepositories,
  enrollmentPeriodService: classEnrollmentPeriodService
};

const EXTENSION_KINDS = new Set(['additional_sessions', 'additional_hours', 'extended_end_date']);

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function resolveActor(requestingUser, fallback = 'system') {
  return String(
    requestingUser?.id ||
    requestingUser?.userId ||
    requestingUser?.personId ||
    requestingUser?.username ||
    requestingUser?.email ||
    fallback
  ).trim() || fallback;
}

async function getSourcePeriodOrThrow(periodId, options = {}) {
  const id = toPublicId(periodId);
  if (!id) throw new Error('sourcePeriodId is required.');
  const period = await dependencies.repositories.classEnrollmentPeriods.getById(id, options);
  if (!period) throw new Error('Source enrollment period not found.');
  return period;
}

async function createExtensionEnrollment({
  sourcePeriodId,
  extensionKind,
  additionalSessions = 0,
  additionalHours = 0,
  newEndDate = '',
  startDate = '',
  reason = '',
  requestingUser = null,
  options = {}
} = {}) {
  const kind = String(extensionKind || '').trim().toLowerCase();
  if (!EXTENSION_KINDS.has(kind)) {
    throw new Error('extensionKind must be additional_sessions, additional_hours, or extended_end_date.');
  }
  const note = String(reason || '').trim();
  if (!note) throw new Error('reason is required for extension enrollment.');

  const source = await getSourcePeriodOrThrow(sourcePeriodId, options);
  const actor = resolveActor(requestingUser);
  const normalizedStart = normalizeDateOnly(startDate) || normalizeDateOnly(source.startDate);
  if (!normalizedStart) throw new Error('startDate is required for extension enrollment.');

  const createPayload = {
    orgId: source.orgId,
    classId: source.classId,
    studentId: source.studentId,
    personId: toPublicId(source.personId),
    startDate: normalizedStart,
    endDate: '',
    status: 'active',
    programId: toPublicId(source.programId),
    termId: toPublicId(source.termId),
    programRegistrationId: toPublicId(source.programRegistrationId),
    enrollmentSource: String(source.enrollmentSource || '').trim(),
    feeCategory: String(source.feeCategory || '').trim(),
    pricing: (source.pricing && typeof source.pricing === 'object') ? { ...source.pricing } : {},
    funderType: String(source.funderType || '').trim(),
    funderId: String(source.funderId || '').trim(),
    authorizationRef: String(source.authorizationRef || '').trim(),
    claimNumber: String(source.claimNumber || '').trim(),
    enrollmentKind: 'extension',
    extensionOfPeriodId: source.id,
    reasonStart: `Extension (${kind}): ${note}`,
    notes: note,
    targetSessionCount: 0,
    targetHours: 0,
    skipCyclePolicyCheck: false
  };

  if (kind === 'additional_sessions') {
    const count = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(additionalSessions);
    if (!count) throw new Error('additionalSessions must be greater than zero.');
    createPayload.targetSessionCount = count;
    createPayload.sessionCountPolicy = classEnrollmentSessionApplicabilityService.normalizeSessionCountPolicy(source.sessionCountPolicy);
  } else if (kind === 'additional_hours') {
    const hours = classEnrollmentSessionApplicabilityService.normalizeTargetHours(additionalHours);
    if (!hours) throw new Error('additionalHours must be greater than zero.');
    createPayload.targetHours = hours;
  } else {
    const end = normalizeDateOnly(newEndDate);
    if (!end) throw new Error('newEndDate is required for extended_end_date extension.');
    const sourceEnd = normalizeDateOnly(source.endDate);
    if (sourceEnd && end <= sourceEnd) {
      throw new Error('newEndDate must be after the source enrollment end date.');
    }
    createPayload.endDate = end;
  }

  const created = await dependencies.enrollmentPeriodService.createPeriod(createPayload, requestingUser, options);
  const extensionPeriod = created?.period;
  if (!extensionPeriod?.id) throw new Error('Failed to create extension enrollment.');

  const extensions = Array.isArray(source.enrollmentExtensions) ? [...source.enrollmentExtensions] : [];
  extensions.push({
    extensionPeriodId: extensionPeriod.id,
    extensionKind: kind,
    reason: note,
    createdAt: new Date().toISOString(),
    createdBy: actor
  });

  await dependencies.repositories.classEnrollmentPeriods.update(source.id, {
    enrollmentExtensions: extensions,
    updatedBy: actor
  }, options);

  return {
    sourcePeriodId: source.id,
    extensionPeriod,
    overlapCheck: created.overlapCheck,
    reentryCheck: created.reentryCheck
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    repositories: schoolRepositories,
    enrollmentPeriodService: classEnrollmentPeriodService
  };
}

module.exports = {
  EXTENSION_KINDS,
  createExtensionEnrollment,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
