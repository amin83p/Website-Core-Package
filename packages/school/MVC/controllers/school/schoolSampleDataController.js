const schoolSampleDataService = require('../../services/school/schoolSampleDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = requireCoreModule('MVC/utils/orgContextUtils');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');

/** Bump when `clearSampleTransactionalData` behavior or response shape changes so replay cache is not reused. */
const CLEAR_TRANSACTIONAL_IDEMPOTENCY_VERSION = 'v6';
/** Bump when sample people cleanup behavior or response shape changes so replay cache is not reused. */
const PEOPLE_DELETE_IDEMPOTENCY_VERSION = 'v2';

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'sample school data' });
}

function sendGuardedResponse(req, res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    const payload = {
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    };
    if (isAjax(req)) {
      res.status(duplicateStatus).json(payload);
    } else {
      res.status(duplicateStatus).render('error', { title: 'Error', message: payload.message, user: req.user });
    }
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    if (isAjax(req)) {
      res.json(payload);
    } else {
      const message = String(payload.message || 'Operation already completed.');
      res.render('error', { title: 'Info', message, user: req.user });
    }
    return true;
  }
  return false;
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function parseIdList(input) {
  const rows = Array.isArray(input) ? input : (input === undefined ? [] : [input]);
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    const id = String(row || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function parseMasterDefinitions(body = {}) {
  return schoolSampleDataService.normalizeMasterDefinitions({
    classes: body.masterDefinitions_classes,
    programs: body.masterDefinitions_programs,
    terms: body.masterDefinitions_terms,
    subjects: body.masterDefinitions_subjects,
    departments: body.masterDefinitions_departments,
    reportTemplates: body.masterDefinitions_reportTemplates,
    timesheetPeriods: body.masterDefinitions_timesheetPeriods,
    activityCategories: body.masterDefinitions_activityCategories,
    examDefinitions: body.masterDefinitions_examDefinitions,
    schoolAccounts: body.masterDefinitions_schoolAccounts
  });
}

function parseBooleanFlag(value) {
  return value === true || value === 'true' || value === 'on';
}

function parseMasterDefinitionsFromQuery(query = {}) {
  return parseMasterDefinitions(query);
}

function buildClearTransactionalMessage(result = {}) {
  const masterDefinitions = result?.masterDefinitions || {};
  const selectedMasters = Object.entries(masterDefinitions)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key);
  const masterNote = selectedMasters.length
    ? ` Selected master definitions were also purged: ${selectedMasters.join(', ')}.`
    : ' Master definitions were preserved unless explicitly selected.';
  return `Org workspace reset completed: transactional/runtime school data was cleared or rebuilt (activities, leave requests, tasks, session issues, exam runtime data, ledgers, registrations, workspaces, reports, timesheets, and related indexes).${masterNote}`;
}

exports.showForm = async (req, res) => {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const activeOrgMeta = (Array.isArray(req.user?.allowedOrgs) ? req.user.allowedOrgs : [])
      .find((o) => idsEqual(o?.orgId || '', activeOrgId));

    res.render('school/sampleData/generatorForm', {
      title: 'Generate Sample School Data',
      activeOrgId,
      activeOrgName: String(activeOrgMeta?.name || activeOrgMeta?.orgName || '').trim() || activeOrgId,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId,
      lastResult: null,
      lastResetResult: null
    });
  } catch (error) {
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.generate = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const studentCount = parsePositiveInt(req.body.studentCount);
    const teacherCount = parsePositiveInt(req.body.teacherCount);
    const staffCount = parsePositiveInt(req.body.staffCount);
    const prefix = String(req.body.prefix || 'Sample').trim() || 'Sample';
    const createLinkedAccounts = req.body.createLinkedAccounts === 'true' || req.body.createLinkedAccounts === 'on' || req.body.createLinkedAccounts === true;
    guardKey = idempotencyGuardService.createGuardKey([
      'sample_data_generate',
      activeOrgId,
      studentCount,
      teacherCount,
      staffCount,
      prefix,
      createLinkedAccounts
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 240000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Sample data generation is already in progress. Please wait.')) return;

    const result = await schoolSampleDataService.generateSampleSchoolPeople({
      orgId: activeOrgId,
      reqUser: req.user,
      studentCount,
      teacherCount,
      staffCount,
      prefix,
      createLinkedAccounts
    });
    const payloadOut = {
      status: 'success',
      message: 'Sample data generation completed.',
      result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);

    if (isAjax(req)) {
      return res.json(payloadOut);
    }

    const activeOrgMeta = (Array.isArray(req.user?.allowedOrgs) ? req.user.allowedOrgs : [])
      .find((o) => idsEqual(o?.orgId || '', activeOrgId));
    return res.render('school/sampleData/generatorForm', {
      title: 'Generate Sample School Data',
      activeOrgId,
      activeOrgName: String(activeOrgMeta?.name || activeOrgMeta?.orgName || '').trim() || activeOrgId,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId,
      lastResult: result,
      lastResetResult: null
    });
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message, error });
    }
    return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.clearTransactionalData = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const includeAcademicSnapshots = req.body.includeAcademicSnapshots === 'true'
      || req.body.includeAcademicSnapshots === 'on'
      || req.body.includeAcademicSnapshots === true;
    const masterDefinitions = parseMasterDefinitions(req.body || {});
    guardKey = idempotencyGuardService.createGuardKey([
      'sample_data_clear_transactional',
      CLEAR_TRANSACTIONAL_IDEMPOTENCY_VERSION,
      activeOrgId,
      includeAcademicSnapshots,
      masterDefinitions
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Transactional data clear is already in progress. Please wait.')) return;

    const result = await schoolSampleDataService.clearSampleTransactionalData({
      orgId: activeOrgId,
      includeAcademicSnapshots,
      masterDefinitions
    });
    const payloadOut = {
      status: 'success',
      message: buildClearTransactionalMessage(result),
      result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);

    if (isAjax(req)) {
      return res.json(payloadOut);
    }

    const activeOrgMeta = (Array.isArray(req.user?.allowedOrgs) ? req.user.allowedOrgs : [])
      .find((o) => idsEqual(o?.orgId || '', activeOrgId));
    return res.render('school/sampleData/generatorForm', {
      title: 'Generate Sample School Data',
      activeOrgId,
      activeOrgName: String(activeOrgMeta?.name || activeOrgMeta?.orgName || '').trim() || activeOrgId,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId,
      lastResult: null,
      lastResetResult: result
    });
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message, error });
    }
    return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listPeopleDeletePreview = async (req, res) => {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const preview = await schoolSampleDataService.buildSamplePeopleDeletePreview({
      orgId: activeOrgId,
      reqUser: req.user
    });
    return res.json({
      status: 'success',
      message: 'Preview loaded.',
      preview
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message, error });
  }
};

exports.listClearTransactionalPreview = async (req, res) => {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const includeAcademicSnapshots = parseBooleanFlag(req.query?.includeAcademicSnapshots);
    const masterDefinitions = parseMasterDefinitionsFromQuery(req.query || {});
    const preview = await schoolSampleDataService.buildOrgWorkspaceResetPreview({
      orgId: activeOrgId,
      includeAcademicSnapshots,
      masterDefinitions
    });
    return res.json({
      status: 'success',
      message: 'Org workspace reset preview loaded.',
      preview
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message, error });
  }
};

exports.deleteSelectedSamplePeople = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const studentIds = parseIdList(req.body?.studentIds);
    const teacherIds = parseIdList(req.body?.teacherIds);
    const staffIds = parseIdList(req.body?.staffIds);
    const personIds = parseIdList(req.body?.personIds);

    guardKey = idempotencyGuardService.createGuardKey([
      'sample_data_people_delete',
      PEOPLE_DELETE_IDEMPOTENCY_VERSION,
      activeOrgId,
      studentIds,
      teacherIds,
      staffIds,
      personIds
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 240000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Sample people deletion is already in progress. Please wait.')) return;

    const result = await schoolSampleDataService.deleteSelectedSamplePeople({
      orgId: activeOrgId,
      reqUser: req.user,
      studentIds,
      teacherIds,
      staffIds,
      personIds
    });
    const payloadOut = {
      status: result?.status || 'success',
      message: result?.message || 'Sample people cleanup completed.',
      summary: result?.summary || null,
      results: Array.isArray(result?.results) ? result.results : []
    };

    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message, error });
  }
};
