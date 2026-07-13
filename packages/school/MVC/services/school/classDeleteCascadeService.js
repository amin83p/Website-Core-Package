const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

async function cascadeDeleteClassSessionAssets(classId, reqUser, orgId) {
  const normalizedClassId = toPublicId(classId);
  const normalizedOrgId = toPublicId(orgId || reqUser?.activeOrgId);
  if (!normalizedClassId) throw new Error('classId is required.');

  const caseRows = await schoolDataService.fetchData(
    'sessionStudentCases',
    { page: 1, classId__eq: normalizedClassId },
    reqUser
  );

  const deletedCases = [];
  const errors = [];

  for (const row of Array.isArray(caseRows) ? caseRows : []) {
    const caseId = toPublicId(row?.id);
    if (!caseId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.deleteData('sessionStudentCases', caseId, reqUser, {
        orgId: normalizedOrgId || row?.orgId,
        skipDeletionGuard: true
      });
      deletedCases.push(caseId);
    } catch (error) {
      errors.push(`${caseId}: ${error.message}`);
    }
  }

  return {
    deletedCases,
    deletedCaseCount: deletedCases.length,
    errors
  };
}

module.exports = {
  cascadeDeleteClassSessionAssets
};
