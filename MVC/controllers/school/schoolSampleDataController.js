const schoolSampleDataService = require('../../services/school/schoolSampleDataService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { idsEqual } = require('../../utils/idAdapter');

const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = require('../../utils/orgContextUtils');
const { isAjax } = require('../../utils/generalTools');

/** Bump when `clearSampleTransactionalData` behavior or response shape changes so replay cache is not reused. */
const CLEAR_TRANSACTIONAL_IDEMPOTENCY_VERSION = 'v5';
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
    guardKey = idempotencyGuardService.createGuardKey([
      'sample_data_clear_transactional',
      CLEAR_TRANSACTIONAL_IDEMPOTENCY_VERSION,
      activeOrgId,
      includeAcademicSnapshots
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Transactional data clear is already in progress. Please wait.')) return;

    const result = await schoolSampleDataService.clearSampleTransactionalData({
      orgId: activeOrgId,
      includeAcademicSnapshots
    });
    const payloadOut = {
      status: 'success',
      message: 'Academic and accounting transactions, registrations, prior subject credits (transfer/placement), withdrawals, class enrollments and enrollment periods, class workspaces (sessions, gradebooks, materials), report runs, timesheets, attendance matrix policy for this org, official final grades on classes, and related indexes were cleared or rebuilt. Master definitions (including report templates and timesheet periods) were preserved.',
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
