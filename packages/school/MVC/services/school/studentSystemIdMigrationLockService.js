const { requireCoreModule } = require('./schoolCoreContracts');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');

const LOCK_COLLECTION = 'schoolStudentSystemIdMigrationLocks';
const AFFECTED_ENTITY_TYPES = new Set([
  'students', 'studentProgramRegistrations', 'studentTermRegistrations', 'studentProgramPriorSubjects',
  'classEnrollmentPeriods', 'classes', 'academicLedger', 'academicSnapshots', 'globalTransactions',
  'withdrawals', 'reportInstances', 'reportAssignments', 'examAllocations', 'examAssignments',
  'examAttempts', 'examAnswers'
]);

async function assertWriteAllowed(entityType, orgId, options = {}) {
  if (!AFFECTED_ENTITY_TYPES.has(String(entityType || ''))) return;
  const normalizedOrgId = String(orgId || '').trim();
  if (!normalizedOrgId || options.skipStudentSystemIdMigrationLock === true) return;
  await runByRepositoryBackend(options, {
    json: async () => {},
    mongo: async () => {
      const lock = await getMongoCollection(LOCK_COLLECTION).findOne({
        orgId: normalizedOrgId,
        expiresAt: { $gt: new Date() }
      });
      if (lock) {
        const error = new Error('A Student System Record ID migration is in progress. Please wait and try again.');
        error.code = 'STUDENT_ID_MIGRATION_IN_PROGRESS';
        error.status = 409;
        throw error;
      }
    }
  }, 'school.studentSystemId.assertWriteAllowed');
}

module.exports = { LOCK_COLLECTION, AFFECTED_ENTITY_TYPES, assertWriteAllowed };
