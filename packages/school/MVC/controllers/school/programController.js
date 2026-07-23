// MVC/controllers/school/programController.js
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const schoolRepositories = require('../../repositories/school');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields, normalizeSearchKeyword } = requireCoreModule('MVC/utils/generalTools');
const {
  FEE_CATEGORIES,
  ALL_FEE_CATEGORIES_KEY,
  ALL_FEE_CATEGORIES_LABEL
} = require('../../models/school/feeCategoryCatalog');
const { PROGRAM_STATUSES, SUBJECT_TYPES } = require('../../models/school/programModel');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const postingPolicyService = require('../../services/school/postingPolicyService');
const programTransactionService = require('../../services/school/programTransactionService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
  canCreateOrgScopedItem,
  assertOrgAccess
} = requireCoreModule('MVC/utils/orgContextUtils');

function parseJsonSafe(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function sendGuardedResponse(res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    res.status(duplicateStatus).json({
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    });
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    res.json(payload);
    return true;
  }
  return false;
}

function normalizeOrgRoles(orgMembership) {
  const raw = Array.isArray(orgMembership?.roles)
    ? orgMembership.roles
    : (orgMembership?.role ? [orgMembership.role] : []);
  return raw
    .map((r) => String(r || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((r, i, arr) => arr.indexOf(r) === i);
}

function personHasTeacherOrStaffRoleInOrg(person, orgId) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId || !person) return false;
  const memberships = Array.isArray(person.organizations) ? person.organizations : [];
  return memberships.some((org) => {
    if (!idsEqual(org?.orgId, targetOrgId)) return false;
    const memberStatus = String(org?.memberStatus || 'active').trim().toLowerCase();
    if (memberStatus && memberStatus !== 'active') return false;
    const roles = normalizeOrgRoles(org);
    return roles.includes('school_teacher') || roles.includes('school_staff');
  });
}

async function resolveEligibleProgramAdministrators(reqUser, orgId, query = {}) {
  const targetOrgId = String(orgId || '').trim();
  if (!targetOrgId || String(targetOrgId).toUpperCase() === 'SYSTEM') return [];

  const scopedUser = { ...(reqUser || {}), activeOrgId: targetOrgId };
  const persons = await schoolPersonAccessService.listActiveOrgPersons({
    reqUser: scopedUser,
    q: String(query.q || '').trim(),
    query: { ...query, limit: query.limit || 5000 },
    requireSchoolRole: true,
    allowedSchoolRoles: ['teacher', 'staff']
  });

  return (persons || [])
    .sort((a, b) => {
      const aName = schoolPersonAccessService.formatPersonName(a, '').toLowerCase();
      const bName = schoolPersonAccessService.formatPersonName(b, '').toLowerCase();
      return aName.localeCompare(bName);
    });
}

async function assertProgramAdministratorEligibleOrThrow(personId, orgId, reqUser) {
  const candidateId = String(personId || '').trim();
  if (!candidateId) throw new Error('Program Administrator is required.');
  const person = await schoolPersonAccessService.getPersonById({
    reqUser: { ...(reqUser || {}), activeOrgId: orgId },
    personId: candidateId,
    requireSchoolRole: true,
    allowedSchoolRoles: ['teacher', 'staff']
  });
  if (!person) throw new Error('Selected Program Administrator was not found.');
}

function buildDuration(body) {
  const parsed = parseJsonSafe(body.duration, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return {
    years: body.durationYears,
    months: body.durationMonths,
    days: body.durationDays
  };
}

function buildProgramPayload(body, activeOrgId) {
  return {
    orgId: String(activeOrgId),
    name: String(body.name || '').trim(),
    code: String(body.code || '').trim(),
    description: String(body.description || '').trim(),
    departmentId: String(body.departmentId || '').trim(),
    departmentCode: String(body.departmentCode || '').trim().toUpperCase(),
    departmentName: String(body.departmentName || '').trim(),
    programAdministratorPersonId: String(body.programAdministratorPersonId || '').trim(),
    duration: buildDuration(body),
    credits: body.credits,
    minimumPassingScore: body.minimumPassingScore,
    minimumPassingAverage: body.minimumPassingAverage,
    academicRules: parseJsonSafe(body.academicRules, {}),
    feeGroups: parseJsonSafe(body.feeGroups, {}),
    postingPolicies: parseJsonSafe(body.postingPolicies, []),
    terms: parseJsonSafe(body.terms, []),
    subjects: parseJsonSafe(body.subjects, []),
    status: String(body.status || 'active').trim(),
    notes: String(body.notes || '').trim()
  };
}

async function resolveProgramDepartmentFromBody(body, reqUser, activeOrgId) {
  const departmentId = String(body.departmentId || '').trim();
  if (!departmentId) {
    throw new Error('Department is required.');
  }

  const department = await dataService.getDataById('departments', departmentId, reqUser);
  if (!department) throw new Error('Selected Department was not found.');
  if (!idsEqual(department.orgId || '', activeOrgId || '')) {
    throw new Error('Selected Department belongs to another organization.');
  }

  return {
    departmentId: String(department.id || ''),
    departmentCode: String(department.code || '').trim().toUpperCase(),
    departmentName: String(department.name || '').trim()
  };
}

async function assertProgramTermsAccessibleOrThrow(terms, orgId, reqUser) {
  const selectedTerms = Array.isArray(terms) ? terms : [];
  if (!selectedTerms.length) return;
  const accessibleTerms = await dataService.fetchData('terms', {}, reqUser);
  const termMap = new Map(accessibleTerms.map((term) => [String(term.id || ''), term]));
  selectedTerms.forEach((termRef) => {
    const termId = String(termRef?.termId || '').trim();
    if (!termId) return;
    const term = termMap.get(termId);
    if (!term) throw new Error(`Selected term ${termId} is not accessible in this organization.`);
    if (!idsEqual(term.orgId || '', orgId || '')) {
      throw new Error(`Selected term ${termId} belongs to another organization.`);
    }
  });
}

async function assertProgramSubjectsAccessibleOrThrow(subjects, orgId, reqUser) {
  const selectedSubjects = Array.isArray(subjects) ? subjects : [];
  if (!selectedSubjects.length) return;
  const accessibleSubjects = await dataService.fetchData('subjects', {}, reqUser);
  const subjectMap = new Map(accessibleSubjects.map((subject) => [String(subject.id || ''), subject]));
  selectedSubjects.forEach((subjectRef) => {
    const subjectId = String(subjectRef?.subjectId || '').trim();
    if (!subjectId) return;
    const subject = subjectMap.get(subjectId);
    if (!subject) throw new Error(`Selected subject ${subjectId} is not accessible in this organization.`);
    if (!idsEqual(subject.orgId || '', orgId || '')) {
      throw new Error(`Selected subject ${subjectId} belongs to another organization.`);
    }
  });
}

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'programs' });
}

function assertProgramOrgAccess(program, activeOrgId, reqUser) {
  assertOrgAccess(program, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function buildOrgScopedListScope(orgId, reqUser, { allowSystemFallback = false } = {}) {
  const scopeOrgId = toPublicId(orgId || reqUser?.activeOrgId);
  const isSystemScopedSuperAdmin = adminAuthorityService.isSuperAdmin(reqUser)
    && String(toPublicId(reqUser?.activeOrgId)).toUpperCase() === 'SYSTEM';

  if (isSystemScopedSuperAdmin) {
    return {
      canViewAll: true,
      activeOrgId: scopeOrgId,
      allowSystemFallback: false
    };
  }

  return {
    denyAll: false,
    canViewAll: false,
    activeOrgId: scopeOrgId,
    allowSystemFallback
  };
}

async function getAccessibleTransactionDefinitionsForOrg(orgId, reqUser) {
  return await schoolRepositories.transactionDefinitions.list({
    query: {},
    scope: buildOrgScopedListScope(orgId, reqUser, { allowSystemFallback: true })
  });
}

async function getAccessibleAccountsForOrg(orgId, reqUser) {
  return await schoolRepositories.schoolAccounts.list({
    query: {},
    scope: buildOrgScopedListScope(orgId, reqUser, { allowSystemFallback: true })
  });
}

function normalizeFeeGroupsWithTransactionDefinitions(feeGroups, transactionDefinitions) {
  const txMap = new Map((transactionDefinitions || []).map((d) => [String(d.id), d]));
  const out = {};
  const categories = (Array.isArray(FEE_CATEGORIES) ? FEE_CATEGORIES : []).concat([ALL_FEE_CATEGORIES_KEY]);

  function sumDefinitionEntries(entries) {
    return (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
      const amount = Number(entry?.amount);
      return Number.isFinite(amount) ? (sum + amount) : sum;
    }, 0);
  }

  categories.forEach((cat) => {
    const lines = Array.isArray(feeGroups?.[cat]) ? feeGroups[cat] : [];
    out[cat] = lines.map((line, index) => {
      const row = (line && typeof line === 'object') ? { ...line } : {};
      const txId = String(row.transactionDefinitionId || '').trim();
      if (!txId) {
        throw new Error(`Transaction template is required for ${cat === ALL_FEE_CATEGORIES_KEY ? 'All Categories' : cat} row #${index + 1}.`);
      }

      const txDef = txMap.get(txId);
      if (!txDef) {
        throw new Error(`Invalid transaction template for ${cat} row #${index + 1}.`);
      }
      if (String(txDef.status || '').toLowerCase() !== 'active') {
        throw new Error(`Transaction template "${txDef.code || txDef.id}" is not active.`);
      }

      const firstEntry = Array.isArray(txDef.entries) && txDef.entries.length ? txDef.entries[0] : null;
      const totalDefinitionAmount = sumDefinitionEntries(txDef.entries);
      const normalizedAmount = Number.isFinite(totalDefinitionAmount)
        ? Number(totalDefinitionAmount.toFixed(2))
        : null;

      return {
        ...row,
        transactionDefinitionId: txId,
        transactionDefinitionCode: String(txDef.code || '').trim().toUpperCase(),
        transactionDefinitionName: String(txDef.name || '').trim(),
        code: String(row.code || txDef.code || '').trim().toUpperCase(),
        label: String(row.label || txDef.name || '').trim(),
        currency: String(row.currency || txDef.currency || '').trim().toUpperCase(),
        frequency: String(row.frequency || txDef.frequency || 'one_time').trim().toLowerCase() || 'one_time',
        amount: normalizedAmount,
        validFrom: String(txDef.validFrom || '').trim(),
        validTo: String(txDef.validTo || '').trim(),
        isOptional: row.isOptional === undefined ? Boolean(txDef.isOptional) : Boolean(row.isOptional)
      };
    });
  });

  return out;
}

function normalizeProgramTermsWithTransactionDefinitions(terms, transactionDefinitions) {
  const rows = Array.isArray(terms) ? terms : [];
  return rows.map((term) => ({
    ...term,
    termRegistrationFeeGroups: normalizeFeeGroupsWithTransactionDefinitions(
      term?.termRegistrationFeeGroups || term?.registrationFeeGroups || {},
      transactionDefinitions
    )
  }));
}

exports.listPrograms = async (req, res) => {
  try {
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const canCreatePrograms = await canCreateOrgScopedItem(req.user, { scopeLabel: 'programs' });

    const programs = await dataService.fetchData('programs', query, req.user);
    const personById = await schoolPersonAccessService.buildPersonByIdMap({
      reqUser: req.user,
      personIds: (Array.isArray(programs) ? programs : []).map((program) => program.programAdministratorPersonId)
    });

    const enrichedPrograms = programs.map((program) => {
      const admin = personById.get(toPublicId(program.programAdministratorPersonId));
      const adminName = admin ? schoolPersonAccessService.formatPersonName(admin, '') : 'N/A';
      return {
        ...program,
        administratorName: adminName || 'N/A',
        subjectCount: Array.isArray(program.subjects) ? program.subjects.length : 0
      };
    });

    const searchableFields = await inferSearchableFields(enrichedPrograms, {
      exclude: ['audit', 'feeGroups', 'subjects']
    });
    const { data, pagination } = paginate(enrichedPrograms, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/program/programList', {
      title: 'Program Catalog',
      tableName: 'Programs_Catalog',
      newUrl: 'school/programs',
      newLabel: canCreatePrograms ? 'Add Program' : null,
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listEligibleAdministrators = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const isSuperAdmin = adminAuthorityService.isSuperAdmin(req.user);
    const requestedOrgId = String(req.query.orgId || '').trim();
    if (requestedOrgId && !isSuperAdmin && !idsEqual(requestedOrgId, activeOrgId)) {
      throw new Error('Not allowed to view administrators for another organization.');
    }

    const targetOrgId = requestedOrgId || activeOrgId;
    if (String(targetOrgId).toUpperCase() === 'SYSTEM') {
      return res.json({ status: 'success', results: [] });
    }
    const query = {
      ...req.query,
      q: normalizeSearchKeyword(req.query.q || '')
    };

    const eligible = await resolveEligibleProgramAdministrators(req.user, targetOrgId, query || {});
    return res.json({ status: 'success', results: eligible });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

async function renderProgramFormView(req, res, viewName) {
  try {
    const isEdit = !!req.params.id;
    const activeOrgId = isEdit
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    let program = {};
    let administratorName = '';

    if (isEdit) {
      program = await dataService.getDataById('programs', req.params.id, req.user);
      if (!program) throw new Error('Program not found.');
      assertProgramOrgAccess(program, activeOrgId, req.user);

      const admin = await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: program.programAdministratorPersonId });
      if (admin) administratorName = schoolPersonAccessService.formatPersonName(admin, '');
    }

    const transactionDefinitions = await getAccessibleTransactionDefinitionsForOrg(program.orgId || activeOrgId, req.user);
    const subjectCatalog = await dataService.fetchData('subjects', {}, req.user);
    const termCatalog = await dataService.fetchData('terms', {}, req.user);
    const departments = await dataService.fetchData('departments', {}, req.user);
    const programOrgId = toPublicId(program.orgId || activeOrgId);
    const eligibleAdministrators = await resolveEligibleProgramAdministrators(req.user, programOrgId, {});
    const selectableDefinitions = transactionDefinitions
      .filter((d) =>
        String(d.status || '').toLowerCase() === 'active' &&
        (idsEqual(d.orgId, programOrgId) || toPublicId(d.orgId) === 'SYSTEM')
      )
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));

    res.render(viewName, {
      title: isEdit ? `Edit Program: ${program.code || program.id}` : 'Create Program',
      program,
      programOrgId,
      administratorName,
      eligibleAdministrators,
      transactionDefinitions: selectableDefinitions,
      subjectCatalog,
      termCatalog,
      departments: (departments || []).filter((department) => idsEqual(department.orgId, programOrgId)),
      feeCategories: FEE_CATEGORIES,
      allFeeCategoryKey: ALL_FEE_CATEGORIES_KEY,
      allFeeCategoryLabel: ALL_FEE_CATEGORIES_LABEL,
      programStatuses: PROGRAM_STATUSES,
      subjectTypes: SUBJECT_TYPES,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

exports.showForm = async (req, res) => {
  return renderProgramFormView(req, res, 'school/program/programForm');
};

exports.showAddWizardForm = async (req, res) => {
  return renderProgramFormView(req, res, 'school/program/programWizardForm');
};

exports.showEditWizardForm = async (req, res) => {
  return renderProgramFormView(req, res, 'school/program/programWizardForm');
};

exports.saveProgram = async (req, res) => {
  try {
    const { id } = req.params;
    const activeOrgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);

    let existingProgram = null;
    if (id) {
      existingProgram = await dataService.getDataById('programs', id, req.user);
      if (!existingProgram) throw new Error('Program not found.');
      assertProgramOrgAccess(existingProgram, activeOrgId, req.user);
    }

    const payload = buildProgramPayload(req.body, existingProgram?.orgId || activeOrgId);
    Object.assign(payload, await resolveProgramDepartmentFromBody(req.body, req.user, payload.orgId));
    await assertProgramAdministratorEligibleOrThrow(payload.programAdministratorPersonId, payload.orgId, req.user);
    await assertProgramTermsAccessibleOrThrow(payload.terms, payload.orgId, req.user);
    await assertProgramSubjectsAccessibleOrThrow(payload.subjects, payload.orgId, req.user);
    const transactionDefinitions = await getAccessibleTransactionDefinitionsForOrg(existingProgram?.orgId || activeOrgId, req.user);
    payload.feeGroups = normalizeFeeGroupsWithTransactionDefinitions(payload.feeGroups, transactionDefinitions);
    payload.postingPolicies = await postingPolicyService.resolvePostingPoliciesOrThrow(payload.postingPolicies, payload.orgId, req.user);
    payload.terms = normalizeProgramTermsWithTransactionDefinitions(payload.terms, transactionDefinitions);
    if (!id && req.body.programId) payload.id = String(req.body.programId).trim();

    if (id) {
      await dataService.updateData('programs', id, payload, req.user);
    } else {
      await dataService.addData('programs', payload, req.user);
    }

    if (isAjax(req)) return res.json({ status: 'success', message: 'Program saved successfully.' });
    res.redirect('/school/programs');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.applyProgramTransactionsForStudent = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const programId = String(req.params.id || '').trim();
    const studentId = String(req.body.studentId || req.query.studentId || '').trim();
    if (!studentId) throw new Error('studentId is required.');

    const program = await dataService.getDataById('programs', programId, req.user);
    if (!program) throw new Error('Program not found.');
    assertProgramOrgAccess(program, activeOrgId, req.user);

    const student = await dataService.getDataById('students', studentId, req.user);
    if (!student) throw new Error('Student not found.');
    if (!idsEqual(student.orgId || '', program.orgId || '')) {
      throw new Error('<b>Security Violation</b><br>Student and Program organization mismatch.');
    }

    const transactionDefinitions = await getAccessibleTransactionDefinitionsForOrg(program.orgId, req.user);
    const allAccounts = await getAccessibleAccountsForOrg(program.orgId, req.user);

    const { items, skipped } = programTransactionService.buildProgramTransactionsForStudent({
      program,
      student,
      transactionDefinitions,
      allAccounts,
      reqUser: req.user,
      requestBody: req.body || {}
    });

    if (!items.length) {
      throw new Error(skipped.length ? skipped.join('<br>') : 'No transactions were generated.');
    }

    const previewItems = programTransactionService.buildPreviewRowsFromTransactions(items);

    const approve = String(req.body.approve || '').toLowerCase() === 'true';
    if (!approve) {
      return res.json({
        status: 'preview',
        message: 'Preview generated. Send approve=true to post these transactions.',
        preview: previewItems,
        skipped
      });
    }

    const guardKey = idempotencyGuardService.createGuardKey([
      'program_apply_transactions',
      activeOrgId,
      programId,
      studentId,
      String(req.body.effectiveDate || '').trim(),
      String(req.body.externalReference || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Program transaction posting is already in progress. Please wait.')) return;

    try {
      const created = await dataService.addData('globalTransactions', items, req.user);
      const result = {
        status: 'success',
        message: 'Program transactions applied successfully.',
        summary: {
          createdTransactionCount: created.length,
          createdEntryCount: Math.floor(created.length / 2),
          skipped
        }
      };
      idempotencyGuardService.completeGuard(guardKey, result);

      if (isAjax(req)) return res.json(result);
      return res.redirect(`/school/programs/edit/${program.id}`);
    } catch (error) {
      idempotencyGuardService.failGuard(guardKey);
      throw error;
    }
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deleteProgram = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'program_delete',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(res, guardResult, 'Program delete is already in progress. Please wait.')) return;

    const existingProgram = await dataService.getDataById('programs', req.params.id, req.user);
    if (!existingProgram) throw new Error('Program not found.');
    assertProgramOrgAccess(existingProgram, activeOrgId, req.user);

    await dataService.deleteData('programs', req.params.id, req.user);
    const payloadOut = { status: 'success', message: 'Program deleted successfully.' };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/programs');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return respondSchoolDeleteError(req, res, error, { user: req.user });
  }
};
