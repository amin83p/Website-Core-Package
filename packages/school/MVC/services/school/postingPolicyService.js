const schoolDataService = require('./schoolDataService');
const {
  normalizePostingPolicyRows,
  selectPostingPolicy
} = require('../../models/school/postingPolicyModel');

async function resolvePostingPoliciesOrThrow(rowsInput, activeOrgId, reqUser) {
  const rows = normalizePostingPolicyRows(rowsInput);
  if (!rows.length) return rows;

  const definitions = await schoolDataService.fetchData('transactionDefinitions', {}, reqUser);
  const definitionMap = new Map(definitions.map((definition) => [String(definition.id || ''), definition]));
  const allowedOrgIds = new Set([String(activeOrgId || '').trim(), 'SYSTEM']);

  return rows.map((row) => {
    const feeCategory = String(row?.feeCategory || '').trim();
    const txId = String(row?.transactionDefinitionId || '').trim();
    if (!txId) throw new Error(`Posting Policy for ${feeCategory || 'the selected category'} requires a Transaction Template.`);

    const definition = definitionMap.get(txId);
    if (!definition) throw new Error(`Transaction Template ${txId} is not accessible.`);
    if (!allowedOrgIds.has(String(definition.orgId || ''))) {
      throw new Error(`Transaction Template ${definition.code || definition.id} is outside organization scope.`);
    }
    if (String(definition.status || '').toLowerCase() !== 'active') {
      throw new Error(`Transaction Template ${definition.code || definition.id} must be active.`);
    }

    return {
      ...row,
      transactionDefinitionId: String(definition.id || ''),
      transactionDefinitionCode: String(definition.code || '').trim().toUpperCase(),
      transactionDefinitionName: String(definition.name || definition.id || '').trim()
    };
  });
}

function buildAppliedPostingPolicy(row, sourceLevel, sourceRecord) {
  if (!row) return null;
  return {
    feeCategory: row.feeCategory,
    transactionDefinitionId: String(row.transactionDefinitionId || '').trim(),
    transactionDefinitionCode: String(row.transactionDefinitionCode || '').trim().toUpperCase(),
    transactionDefinitionName: String(row.transactionDefinitionName || '').trim(),
    notes: String(row.notes || '').trim(),
    sourceLevel: String(sourceLevel || '').trim(),
    sourceId: String(sourceRecord?.id || '').trim(),
    sourceCode: String(sourceRecord?.code || '').trim().toUpperCase(),
    sourceName: String(sourceRecord?.name || sourceRecord?.title || sourceRecord?.id || '').trim()
  };
}

function resolveInheritedPostingPolicy({ feeCategory, classItem = null, program = null, department = null } = {}) {
  const classRow = selectPostingPolicy(classItem?.postingTemplates, feeCategory);
  if (classRow) return buildAppliedPostingPolicy(classRow, 'class', classItem);

  const programRow = selectPostingPolicy(program?.postingPolicies, feeCategory);
  if (programRow) return buildAppliedPostingPolicy(programRow, 'program', program);

  const departmentRow = selectPostingPolicy(department?.postingPolicies, feeCategory);
  if (departmentRow) return buildAppliedPostingPolicy(departmentRow, 'department', department);

  return null;
}

module.exports = {
  normalizePostingPolicyRows,
  resolvePostingPoliciesOrThrow,
  resolveInheritedPostingPolicy
};
