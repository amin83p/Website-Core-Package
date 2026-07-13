const dataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const schoolRepositories = require('../../repositories/school');
const programTransactionService = require('./programTransactionService');
const registrationIntegrityService = require('./registrationIntegrityService');
const programRegistrationDraftService = require('./programRegistrationDraftService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const {
  normalizeDraftTransactionItems,
  buildDraftPreviewRowsFromItems
} = programRegistrationDraftService;

function asIdArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
}

function resolveStudentName(person, student) {
  return schoolPersonAccessService.formatPersonName(person, String(student?.id || ''));
}

/** Fields exposed in the program registration list UI and advanced DB search modal. */
const PROGRAM_REGISTRATION_LIST_SEARCHABLE_FIELDS = Object.freeze([
  'id',
  'studentId',
  'studentName',
  'programId',
  'programLabel',
  'feeCategorySnapshot',
  'note',
  'status',
  'verificationStatus',
  'registrationDate'
]);

function rowMatchesQuery(row, query, type, searchField) {
  const q = String(query || '').trim();
  if (!q) return true;
  const normalizedType = String(type || 'contains').trim().toLowerCase().replace(/_/g, '');
  const fieldToken = String(searchField || '').trim().split(',')[0].trim();
  const useAll = !fieldToken || fieldToken === 'all';

  const defaultHaystack = [
    row.id,
    row.studentId,
    row.studentName,
    row.programId,
    row.programLabel,
    row.feeCategorySnapshot,
    row.note,
    row.status,
    row.verificationStatus,
    row.registrationDate
  ];
  const values = useAll
    ? defaultHaystack
    : [row[fieldToken]];

  return values.some((raw) => {
    const value = String(raw ?? '').toLowerCase();
    const qLower = q.toLowerCase();
    if (normalizedType === 'exactmatch') return value === qLower;
    if (normalizedType === 'startswith') return value.startsWith(qLower);
    return value.includes(qLower);
  });
}

function getVerificationBadgeClass(status) {
  if (status === 'verified') return 'bg-success';
  if (status === 'partial') return 'bg-warning text-dark';
  if (status === 'rolled_back') return 'bg-secondary';
  if (status === 'failed') return 'bg-danger';
  return 'bg-info text-dark';
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isRolledBackStatus(status) {
  return normalizeStatus(status) === 'rolled_back';
}

function buildStudentProgramKey(studentId, programId) {
  const studentKey = toPublicId(studentId);
  const programKey = toPublicId(programId);
  if (!studentKey || !programKey) return '';
  return `${studentKey}::${programKey}`;
}

async function buildRegistrationSummaries(reqUser, activeOrgId, { limit = null, registrationId = '', filters = {} } = {}) {
  const [registrations, students, programs, allTransactions, allEntries, termRegistrations, classEnrollmentPeriods] = await Promise.all([
    schoolRepositories.studentProgramRegistrations.list({ query: {}, scope: { canViewAll: true } }),
    dataService.fetchData('students', {}, reqUser),
    dataService.fetchData('programs', {}, reqUser),
    schoolRepositories.globalTransactions.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.academicLedger.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.studentTermRegistrations.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.classEnrollmentPeriods.list({ query: {}, scope: { canViewAll: true } })
  ]);

  const studentMap = new Map(students.map((row) => [toPublicId(row.id), row]));
  const personMap = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: (Array.isArray(students) ? students : []).map((student) => student.personId)
  });
  const programMap = new Map(programs.map((row) => [toPublicId(row.id), row]));
  const transactionMap = new Map(allTransactions.map((row) => [toPublicId(row.id), row]));
  const academicMap = new Map(allEntries.map((row) => [toPublicId(row.id), row]));

  const termRegCountsByProgramRegId = new Map();
  (termRegistrations || [])
    .filter((row) => idsEqual(row?.orgId, activeOrgId))
    .forEach((row) => {
      const prId = toPublicId(row?.programRegistrationId);
      if (!prId) return;
      if (isRolledBackStatus(row?.status)) return;
      termRegCountsByProgramRegId.set(prId, (termRegCountsByProgramRegId.get(prId) || 0) + 1);
    });

  const classEnrollmentCountsByStudentProgram = new Map();
  const isBlockingClassEnrollment = schoolRepositories.isBlockingClassEnrollmentForProgramRollback
    || ((status) => !['withdrawn', 'cancelled', 'archived', 'error'].includes(normalizeStatus(status)));
  (classEnrollmentPeriods || [])
    .filter((row) => idsEqual(row?.orgId, activeOrgId))
    .forEach((row) => {
      if (!isBlockingClassEnrollment(row?.status)) return;
      const key = buildStudentProgramKey(row?.studentId, row?.programId);
      if (!key) return;
      classEnrollmentCountsByStudentProgram.set(
        key,
        (classEnrollmentCountsByStudentProgram.get(key) || 0) + 1
      );
    });

  const normalizedStatus = String(filters.status || '').trim().toLowerCase();
  const normalizedVerification = String(filters.verificationStatus || '').trim().toLowerCase();
  const normalizedProgramId = String(filters.programId || '').trim();
  const normalizedStudentId = String(filters.studentId || '').trim();
  const searchQuery = String(filters.q || '').trim();
  const searchType = String(filters.type || 'contains').trim();
  const searchFields = String(filters.searchFields || '').trim();

  let rows = registrations
    .filter((row) => idsEqual(row.orgId, activeOrgId))
    .filter((row) => !registrationId || idsEqual(row.id, registrationId))
    .sort((a, b) => {
      const aTime = new Date(a?.audit?.lastUpdateDateTime || a?.audit?.createDateTime || a?.registrationDate || 0).getTime();
      const bTime = new Date(b?.audit?.lastUpdateDateTime || b?.audit?.createDateTime || b?.registrationDate || 0).getTime();
      return bTime - aTime;
    })
    .map((registration) => {
      const student = studentMap.get(toPublicId(registration.studentId)) || null;
      const person = student?.personId ? personMap.get(toPublicId(student.personId)) : null;
      const program = programMap.get(toPublicId(registration.programId)) || null;

      const transactionIds = asIdArray(registration?.transactionSummary?.transactionIds);
      const reversalIds = asIdArray(registration?.transactionSummary?.reversalIds);
      const academicEntryIds = asIdArray(registration?.academicSummary?.entryIds);
      const voidedEntryIds = asIdArray(registration?.academicSummary?.voidedEntryIds);

      const financeExpected = Math.max(transactionIds.length, Number(registration?.transactionSummary?.postedCount || 0));
      const academicExpected = Math.max(academicEntryIds.length, Number(registration?.academicSummary?.entryCount || 0));
      const postedTransactions = transactionIds.filter((id) => String(transactionMap.get(id)?.status || '').toLowerCase() === 'posted').length;
      const reversedTransactions = reversalIds.filter((id) => transactionMap.has(id)).length;
      const postedAcademicEntries = academicEntryIds.filter((id) => String(academicMap.get(id)?.status || '').toLowerCase() === 'posted').length;
      const voidedAcademicEntries = voidedEntryIds.filter((id) => String(academicMap.get(id)?.status || '').toLowerCase() === 'void').length;

      let verificationStatus = 'pending';
      if (String(registration.status || '').toLowerCase() === 'registered') {
        verificationStatus = postedTransactions === financeExpected && postedAcademicEntries === academicExpected
          ? 'verified'
          : 'partial';
      } else if (String(registration.status || '').toLowerCase() === 'rolled_back') {
        verificationStatus = 'rolled_back';
      } else if (String(registration.status || '').toLowerCase() === 'error') {
        verificationStatus = 'failed';
      }

      const termRegistrationsCount = termRegCountsByProgramRegId.get(toPublicId(registration.id)) || 0;
      const classEnrollmentsCount = classEnrollmentCountsByStudentProgram.get(
        buildStudentProgramKey(registration.studentId, registration.programId)
      ) || 0;
      const rollbackEligibleStatus = ['registered', 'error'].includes(String(registration.status || '').toLowerCase());

      return {
        id: registration.id,
        status: registration.status,
        verificationStatus,
        registrationDate: registration.registrationDate,
        studentId: registration.studentId,
        studentRecordId: toPublicId(registration.studentId),
        studentName: resolveStudentName(person, student || registration),
        programId: registration.programId,
        programLabel: [String(program?.code || registration.programId || ''), String(program?.name || '')].filter(Boolean).join(' - '),
        feeCategorySnapshot: registration.feeCategorySnapshot || '',
        note: registration.note || '',
        finance: {
          expected: financeExpected,
          posted: postedTransactions,
          reversed: reversedTransactions
        },
        academic: {
          expected: academicExpected,
          posted: postedAcademicEntries,
          voided: voidedAcademicEntries
        },
        statusBadgeClass: getVerificationBadgeClass(verificationStatus),
        canApprove: String(registration.status || '').toLowerCase() === 'draft',
        canDeleteDraft: String(registration.status || '').toLowerCase() === 'draft',
        canRollback: rollbackEligibleStatus
          && termRegistrationsCount === 0
          && classEnrollmentsCount === 0,
        termRegistrationsCount,
        classEnrollmentsCount,
        transactionIds,
        reversalIds,
        academicEntryIds,
        voidedEntryIds
      };
    });

  rows = rows.filter((row) => {
    if (normalizedStatus && String(row.status || '').toLowerCase() !== normalizedStatus) return false;
    if (normalizedVerification && String(row.verificationStatus || '').toLowerCase() !== normalizedVerification) return false;
    if (normalizedProgramId && !idsEqual(row.programId, normalizedProgramId)) return false;
    if (normalizedStudentId && !idsEqual(row.studentId, normalizedStudentId)) return false;
    if (!rowMatchesQuery(row, searchQuery, searchType, searchFields)) return false;
    return true;
  });

  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return rows;
}

async function buildRegistrationDetail(reqUser, activeOrgId, registrationId) {
  const rows = await buildRegistrationSummaries(reqUser, activeOrgId, { registrationId, limit: 1 });
  const summary = rows[0] || null;
  if (!summary) return null;
  const registrationRecord = await schoolRepositories.studentProgramRegistrations.getById(registrationId);

  const [allTransactions, allEntries] = await Promise.all([
    schoolRepositories.globalTransactions.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.academicLedger.list({ query: {}, scope: { canViewAll: true } })
  ]);

  const transactionMap = new Map(allTransactions.map((row) => [toPublicId(row.id), row]));
  const academicMap = new Map(allEntries.map((row) => [toPublicId(row.id), row]));

  const postedTransactions = summary.transactionIds
    .map((id) => transactionMap.get(toPublicId(id)))
    .filter(Boolean);
  const draftTransactionItems = normalizeDraftTransactionItems(registrationRecord?.transactionSummary?.draftTransactionItems || []);
  const draftPreviewRows = buildDraftPreviewRowsFromItems(draftTransactionItems);
  const pendingDraftTransactions = draftTransactionItems
    .filter(Boolean)
    .map((row, index) => ({
      ...row,
      id: String(row?.id || row?.source?.eventId || row?.source?.idempotencyKey || `DRAFT-TX-${index + 1}`),
      status: 'draft',
      __isPendingDraft: true
    }));
  const financialTransactions = postedTransactions
    .map((row) => ({ ...row, __isPendingDraft: false }))
    .concat(pendingDraftTransactions);
  const reversalTransactions = summary.reversalIds
    .map((id) => transactionMap.get(toPublicId(id)))
    .filter(Boolean);
  const academicEntries = summary.academicEntryIds
    .map((id) => academicMap.get(toPublicId(id)))
    .filter(Boolean);
  const voidedAcademicEntries = summary.voidedEntryIds
    .map((id) => academicMap.get(toPublicId(id)))
    .filter(Boolean);

  return {
    ...summary,
    postedTransactions,
    pendingDraftTransactions,
    financialTransactions,
    reversalTransactions,
    academicEntries,
    voidedAcademicEntries,
    draftTransactionItems,
    draftPreviewRows
  };
}

async function buildStudentRegistrationPreview(program, student, reqUser, requestBody = {}) {
  const person = student.personId
    ? await schoolPersonAccessService.getPersonById({ reqUser, personId: student.personId })
    : null;
  const preview = {
    studentId: String(student.id || ''),
    personId: String(student.personId || ''),
    studentName: resolveStudentName(person, student),
    feeCategory: String(student.feeCategory || ''),
    studentAccountId: String(student.studentAccountId || ''),
    status: 'ready',
    issues: [],
    previewTransactions: [],
    totalAmount: 0,
    transactionCount: 0
  };

  const dependencyState = await registrationIntegrityService.evaluateProgramPreviewDependencies(program, student);
  if (dependencyState.status === 'error') {
    preview.status = 'error';
    preview.issues.push(...dependencyState.issues);
    return preview;
  }

  const transactionDefinitions = await dataService.fetchData('transactionDefinitions', {}, reqUser);
  const allAccounts = await dataService.fetchData('schoolAccounts', {}, reqUser);
  const txResult = programTransactionService.buildProgramTransactionsForStudent({
    program,
    student,
    transactionDefinitions,
    allAccounts,
    reqUser,
    requestBody
  });

  preview.previewTransactions = programTransactionService.buildPreviewRowsFromTransactions(txResult.items);
  preview.transactionCount = txResult.items.length;
  preview.totalAmount = Number(
    preview.previewTransactions.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)
  );
  registrationIntegrityService.applyProgramPreviewTransactionResult(preview, txResult);

  preview.transactionItems = txResult.items;
  return preview;
}

async function buildBatchPreview(studentIds, programId, reqUser, requestBody = {}) {
  const program = await dataService.getDataById('programs', programId, reqUser);
  if (!program) throw new Error('Program not found or inaccessible.');
  const previews = [];
  for (const studentId of studentIds) {
    const student = await dataService.getDataById('students', studentId, reqUser);
    if (!student) {
      previews.push({
        studentId,
        personId: '',
        studentName: studentId,
        feeCategory: '',
        studentAccountId: '',
        status: 'error',
        issues: ['Student not found or inaccessible.'],
        previewTransactions: [],
        transactionItems: [],
        totalAmount: 0,
        transactionCount: 0
      });
      continue;
    }
    previews.push(await buildStudentRegistrationPreview(program, student, reqUser, requestBody));
  }
  return {
    program,
    previews
  };
}

module.exports = {
  PROGRAM_REGISTRATION_LIST_SEARCHABLE_FIELDS,
  normalizeDraftTransactionItems,
  buildDraftPreviewRowsFromItems,
  buildRegistrationSummaries,
  buildRegistrationDetail,
  buildStudentRegistrationPreview,
  buildBatchPreview
};
