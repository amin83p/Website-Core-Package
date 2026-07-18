/* eslint-disable no-console */
const fs = require('fs').promises;
const path = require('path');
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');

function parseArgs(argv = []) {
  const value = (name) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${name}=`));
    return token ? String(token.slice(name.length + 1)).trim() : '';
  };
  return { orgId: value('--org'), backend: value('--backend').toLowerCase() };
}

function buildLegacyStudentFundingReport(students = [], accounts = [], { orgId = '' } = {}) {
  const targetOrgId = String(orgId || '').trim();
  const accountById = new Map((Array.isArray(accounts) ? accounts : []).map((account) => [String(account?.id || ''), account]));
  const candidates = (Array.isArray(students) ? students : []).filter((student) => !targetOrgId || String(student?.orgId || '') === targetOrgId).map((student) => {
    const funderAccountId = String(student?.funderAccountId || '').trim();
    const funderOrganization = String(student?.funderOrganization || '').trim();
    const studentIdAtFunder = String(student?.studentIdAtFunder || '').trim();
    const funderNote = String(student?.funderNote || '').trim();
    const selfFund = student?.selfFund === true;
    const linkedAccount = accountById.get(funderAccountId) || null;
    const studentAccount = accountById.get(String(student?.studentAccountId || '').trim()) || null;
    const parentAccount = studentAccount?.parentId ? accountById.get(String(studentAccount.parentId)) || null : null;
    const hasLegacyValues = Boolean(funderAccountId || funderOrganization || studentIdAtFunder || funderNote || selfFund);
    const parentHeadCategory = String(parentAccount?.headCategory || '').toLowerCase();
    const accountParentDiffersFromStudentHead = Boolean(studentAccount && parentAccount && parentHeadCategory !== 'students' && !parentHeadCategory.startsWith('student_'));
    if (!hasLegacyValues && !accountParentDiffersFromStudentHead) return null;
    return {
      studentId: String(student?.id || ''),
      orgId: String(student?.orgId || ''),
      legacyFunding: { funderAccountId, funderOrganization, studentIdAtFunder, selfFund, hasFunderNote: Boolean(funderNote) },
      linkedFunderAccount: linkedAccount ? { id: String(linkedAccount.id || ''), code: String(linkedAccount.code || ''), name: String(linkedAccount.name || ''), orgId: String(linkedAccount.orgId || '') } : null,
      studentAccount: studentAccount ? { id: String(studentAccount.id || ''), parentId: String(studentAccount.parentId || ''), code: String(studentAccount.code || '') } : null,
      parentAccount: parentAccount ? { id: String(parentAccount.id || ''), code: String(parentAccount.code || ''), name: String(parentAccount.name || ''), headCategory: String(parentAccount.headCategory || 'none') } : null,
      flags: {
        legacyFundingValues: hasLegacyValues,
        missingLinkedFunderAccount: Boolean(funderAccountId && !linkedAccount),
        accountParentRequiresReview: accountParentDiffersFromStudentHead
      }
    };
  }).filter(Boolean);
  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    mutationPerformed: false,
    orgId: targetOrgId || null,
    scannedStudents: (Array.isArray(students) ? students : []).filter((student) => !targetOrgId || String(student?.orgId || '') === targetOrgId).length,
    candidates,
    summary: {
      candidates: candidates.length,
      legacyFundingValues: candidates.filter((row) => row.flags.legacyFundingValues).length,
      missingLinkedFunderAccounts: candidates.filter((row) => row.flags.missingLinkedFunderAccount).length,
      accountParentRequiresReview: candidates.filter((row) => row.flags.accountParentRequiresReview).length
    }
  };
}

async function readJsonRows(fileName) {
  try { return JSON.parse(await fs.readFile(path.join(__dirname, '../../../data/school', fileName), 'utf8') || '[]'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const backend = resolveDataBackendConfig(process.env, { preferredMode: args.backend || undefined });
  setActiveDataBackendConfig(backend);
  let students; let accounts;
  if (backend.mode === 'mongo') {
    const uri = String(backend?.mongo?.uri || '').trim();
    if (!uri) throw new Error('Mongo report requires a configured Mongo URI.');
    await connectMongo({ uri });
    const filter = args.orgId ? { orgId: args.orgId } : {};
    [students, accounts] = await Promise.all([getMongoCollection('schoolStudents').find(filter).toArray(), getMongoCollection('schoolAccounts').find(filter).toArray()]);
  } else {
    [students, accounts] = await Promise.all([readJsonRows('students.json'), readJsonRows('accounts.json')]);
  }
  const report = buildLegacyStudentFundingReport(students, accounts, { orgId: args.orgId });
  console.log('[LegacyStudentFundingReport] Completed without changing students, accounts, balances, or transactions.');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  main().then(async () => { await disconnectMongo().catch(() => {}); process.exit(0); }).catch(async (error) => { await disconnectMongo().catch(() => {}); console.error(`[LegacyStudentFundingReport] Failed: ${error.message}`); process.exit(1); });
}

module.exports = { parseArgs, buildLegacyStudentFundingReport, main };
