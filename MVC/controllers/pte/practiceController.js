const path = require('path');
const coreFilesService = require('../../services/coreFilesService');
const uploadMiddleware = require('../../middleware/upload');
const securityService = require('../../services/security');
const adminChekersService = require('../../services/adminChekersService');
const pteAttemptLedgerService = require('../../services/pte/pteAttemptLedgerService');
const pteSmartPracticeService = require('../../services/pte/pteSmartPracticeService');
const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');
const paginate = require('../../utils/paginationHelper');
const { buildDataServiceQuery, isAjax } = require('../../utils/generalTools');
const { SECTIONS, OPERATIONS } = require('../../../packages/pte/config/accessConstants');
const MAX_PTE_PRACTICE_QUESTIONS = 15;
const PRACTICE_RESCORING_SECTION_CANDIDATES = Object.freeze([
  SECTIONS.PTE_PRACTICE_BY_SKILLS,
  SECTIONS.PTE_PRACTICE,
  SECTIONS.PTE
]);

function buildPracticeAccessContext(req) {
  return {
    scopeId: req?.accessScope,
    adminContext: req?.adminContext || null
  };
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function cleanNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number(fallback || 0);
  return numeric;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const token = String(value).trim().toLowerCase();
  if (!token) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function hasExplicitAdminSignalOnUser(requestingUser = {}) {
  return normalizeBoolean(requestingUser?.isVirtualSuperAdmin, false)
    || normalizeBoolean(requestingUser?.isSuperAdmin, false)
    || normalizeBoolean(requestingUser?.isSystemAdmin, false)
    || normalizeBoolean(requestingUser?.isAdmin, false);
}

function hasPracticeRescoreAdminContext(adminContext = {}) {
  const context = isPlainObject(adminContext) ? adminContext : {};
  if (context.isSuperAdmin || context.isSystemAdmin) return true;
  if (!(context.isRequestAdmin || context.isSectionAdmin || context.isOperationAdminForRequest)) return false;
  const category = cleanText(context.category, 80).toUpperCase();
  if (category === 'PTE') return true;
  const sectionId = cleanText(context.sectionId, 160).toUpperCase();
  if (!sectionId) return false;
  return PRACTICE_RESCORING_SECTION_CANDIDATES.some((candidate) => cleanText(candidate, 160).toUpperCase() === sectionId);
}

async function canRequesterRescoreSameRevision(requestingUser = {}, accessContext = {}) {
  if (!requestingUser || typeof requestingUser !== 'object') return false;
  if (hasExplicitAdminSignalOnUser(requestingUser)) return true;
  if (
    adminChekersService.isSuperAdmin(requestingUser)
    || adminChekersService.isAdmin(requestingUser)
    || adminChekersService.isOrgAdmin(requestingUser)
  ) {
    return true;
  }
  if (hasPracticeRescoreAdminContext(accessContext?.adminContext || {})) return true;

  const orgId = cleanText(
    requestingUser?.activeOrgId
      || requestingUser?.primaryOrgId
      || requestingUser?.orgId,
    120
  );
  for (const sectionId of PRACTICE_RESCORING_SECTION_CANDIDATES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const isRequestAdmin = await adminChekersService.isAdminForRequestAsync(
        requestingUser,
        sectionId,
        OPERATIONS.AI_SCORING,
        {
          orgId,
          section: {
            id: sectionId,
            category: 'PTE'
          }
        }
      );
      if (isRequestAdmin) return true;
    } catch (_) {
      // keep graceful fallback behaviour
    }
  }
  return false;
}

function resolveAttemptItemQuestion(item = {}, questionMap = new Map()) {
  const metadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const snapshot = isPlainObject(metadata.questionSnapshot) ? metadata.questionSnapshot : null;
  if (snapshot?.id) {
    return {
      ...snapshot,
      payload: isPlainObject(snapshot.payload) ? snapshot.payload : {},
      mediaAssets: Array.isArray(snapshot.mediaAssets) ? snapshot.mediaAssets : []
    };
  }
  return questionMap.get(cleanText(item?.questionVersionId, 120)) || null;
}

function buildAttachmentUrlFromPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim();
  if (!normalized) return '';
  if (/^https?:\/\/[^/]+\/uploads\//i.test(normalized)) return normalized;
  if (/^\/uploads\//i.test(normalized)) return normalized;
  const dirPath = path.dirname(normalized);
  const dirUrl = coreFilesService.getWebUrlForUpload(dirPath);
  const filename = path.basename(normalized);
  if (!dirUrl || !filename) return '';
  return `${dirUrl}/${filename}`;
}

function parseMaybeJson(input, fallback = null) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid practice payload.');
  }
}

function readRuntimePayload(req) {
  const body = req?.body;
  if (body && Object.prototype.hasOwnProperty.call(body, 'runtimePlan')) {
    return parseMaybeJson(body.runtimePlan, {}) || {};
  }
  return (body && typeof body === 'object') ? body : {};
}

function hasExplicitRuntimeSelections(payload = {}) {
  const selectedQuestions = Array.isArray(payload?.selectedQuestions) ? payload.selectedQuestions : [];
  const smartSelectedQuestions = Array.isArray(payload?.smartSelectedQuestions) ? payload.smartSelectedQuestions : [];
  return selectedQuestions.length > 0 || smartSelectedQuestions.length > 0;
}

function mergePlannerMetadata(baseMetadata = {}, plannerMetadata = {}) {
  const base = isPlainObject(baseMetadata) ? baseMetadata : {};
  const planner = isPlainObject(plannerMetadata) ? plannerMetadata : {};
  return {
    ...base,
    ...planner,
    practice: {
      ...(isPlainObject(base.practice) ? base.practice : {}),
      ...(isPlainObject(planner.practice) ? planner.practice : {})
    },
    practiceBySkillPlanner: isPlainObject(planner.practiceBySkillPlanner)
      ? planner.practiceBySkillPlanner
      : (isPlainObject(base.practiceBySkillPlanner) ? base.practiceBySkillPlanner : {})
  };
}

function normalizeSmartPracticeOptions(source = {}) {
  const input = source && typeof source === 'object' ? source : {};
  const skillPlans = Object.prototype.hasOwnProperty.call(input, 'skillPlans')
    ? parseMaybeJson(input.skillPlans, [])
    : [];
  return {
    windowDays: input.windowDays,
    targetQuestionCount: input.targetQuestionCount,
    priorityMode: input.priorityMode || 'balanced_gaps',
    includeMaintenance: input.includeMaintenance,
    requestedSkillPlans: Array.isArray(skillPlans) ? skillPlans : []
  };
}

const PRACTICE_PICKER_USER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'status'],
  defaultSearchFields: ['id', 'name', 'username', 'email'],
  allowMetaKeys: true
});

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function buildAttemptsFilters(query = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  return {
    q: cleanText(source.q || source.search, 220),
    status: cleanText(source.status, 40).toLowerCase(),
    skill: cleanText(source.skill, 30).toLowerCase(),
    feedbackState: cleanText(source.feedbackState || source.withFeedback, 30).toLowerCase(),
    userId: cleanText(source.userId || source.studentId, 120),
    startedFrom: cleanText(source.startedFrom, 80),
    startedTo: cleanText(source.startedTo, 80)
  };
}

async function resolveDeletePracticeAttemptAccess(req) {
  try {
    const evaluation = await securityService.evaluateAccess({
      user: req.user,
      sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
      operationId: OPERATIONS.DELETE,
      ipAddress: req.ip
    });
    return Boolean(evaluation?.allowed);
  } catch (_) {
    return false;
  }
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  if (!text.includes('"') && !text.includes(',') && !text.includes('\n')) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows = [], headers = []) {
  const keys = Array.isArray(headers) ? headers : [];
  const headerLine = keys.map((key) => csvEscape(key)).join(',');
  const bodyLines = (Array.isArray(rows) ? rows : []).map((row) => {
    return keys.map((key) => csvEscape(row?.[key])).join(',');
  });
  return [headerLine, ...bodyLines].join('\n');
}

function normalizeExportFormat(value) {
  const token = cleanText(value, 12).toLowerCase();
  return token === 'json' ? 'json' : 'csv';
}

function buildLifecycleExportRows(detail = {}) {
  const session = detail?.session || {};
  const lifecycle = (detail?.lifecycle && typeof detail.lifecycle === 'object') ? detail.lifecycle : {};
  const summary = (lifecycle?.summary && typeof lifecycle.summary === 'object') ? lifecycle.summary : {};
  const matrix = Array.isArray(lifecycle?.questionMatrix) ? lifecycle.questionMatrix : [];
  const intervals = Array.isArray(lifecycle?.intervals) ? lifecycle.intervals : [];
  const anomalies = Array.isArray(lifecycle?.anomalies) ? lifecycle.anomalies : [];

  const summaryRow = {
    sessionId: cleanText(session?.id, 120),
    attemptType: cleanText(session?.attemptType, 80),
    status: cleanText(session?.status, 80),
    startedAt: cleanText(session?.startedAt, 80),
    finishedAt: cleanText(session?.finishedAt, 80),
    itemCount: Number(summary?.itemCount || 0),
    startCount: Number(summary?.startCount || 0),
    saveCount: Number(summary?.saveCount || 0),
    submitCount: Number(summary?.submitCount || 0),
    autoSubmitCount: Number(summary?.autoSubmitCount || 0),
    skipCount: Number(summary?.skipCount || 0),
    noSaveStartCount: Number(summary?.noSaveStartCount || 0),
    avgStartDurationSeconds: Number(summary?.avgStartDurationSeconds || 0),
    totalActiveSeconds: Number(summary?.totalActiveSeconds || 0),
    anomalyCount: Number(summary?.anomalyCount || 0)
  };

  const matrixRows = matrix.map((row) => ({
    sessionId: cleanText(session?.id, 120),
    itemId: cleanText(row?.itemId, 120),
    questionOrder: Number(row?.questionOrder || 0),
    questionVersionId: cleanText(row?.questionVersionId, 140),
    questionTitle: cleanText(row?.questionTitle, 260),
    skill: cleanText(row?.skill, 40),
    questionType: cleanText(row?.questionType, 140),
    startCount: Number(row?.startCount || 0),
    saveCount: Number(row?.saveCount || 0),
    submitCount: Number(row?.submitCount || 0),
    autoSubmitCount: Number(row?.autoSubmitCount || 0),
    skipCount: Number(row?.skipCount || 0),
    noSaveStartCount: Number(row?.noSaveStartCount || 0),
    avgStartDurationSeconds: Number(row?.avgStartDurationSeconds || 0),
    totalActiveSeconds: Number(row?.totalActiveSeconds || 0),
    anomalyCount: Number(row?.anomalyCount || 0)
  }));

  const intervalRows = intervals.map((row) => ({
    sessionId: cleanText(session?.id, 120),
    itemId: cleanText(row?.itemId, 120),
    questionOrder: Number(row?.questionOrder || 0),
    questionVersionId: cleanText(row?.questionVersionId, 140),
    questionTitle: cleanText(row?.questionTitle, 260),
    skill: cleanText(row?.skill, 40),
    questionType: cleanText(row?.questionType, 140),
    startNo: Number(row?.startNo || 0),
    startedAt: cleanText(row?.startedAt, 80),
    endedAt: cleanText(row?.endedAt, 80),
    endReason: cleanText(row?.endReason, 80),
    durationSeconds: Number(row?.durationSeconds || 0),
    saveCountInInterval: Number(row?.saveCountInInterval || 0),
    submitOccurred: row?.submitOccurred === true ? 'yes' : 'no',
    viewInstanceId: cleanText(row?.viewInstanceId, 200),
    startEventId: cleanText(row?.startEventId, 140),
    endEventId: cleanText(row?.endEventId, 140)
  }));

  const anomalyRows = anomalies.map((row) => ({
    sessionId: cleanText(session?.id, 120),
    itemId: cleanText(row?.itemId, 120),
    questionOrder: Number(row?.questionOrder || 0),
    questionVersionId: cleanText(row?.questionVersionId, 140),
    skill: cleanText(row?.skill, 40),
    questionType: cleanText(row?.questionType, 140),
    type: cleanText(row?.type, 80),
    eventId: cleanText(row?.eventId, 140),
    eventType: cleanText(row?.eventType, 80),
    eventAt: cleanText(row?.eventAt, 80),
    message: cleanText(row?.message, 500)
  }));

  return {
    summaryRow,
    matrixRows,
    intervalRows,
    anomalyRows
  };
}

async function showBySkills(req, res) {
  try {
    const overview = await pteAttemptLedgerService.getPracticeOverview(
      req.user,
      buildPracticeAccessContext(req)
    );

    return res.render('pte/practice/bySkills', {
      title: 'PTE Practice By Skills',
      overview,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function showSmartPractice(req, res) {
  try {
    const recommendation = await pteSmartPracticeService.buildRecommendation(
      req.user,
      buildPracticeAccessContext(req),
      normalizeSmartPracticeOptions(req.query || {})
    );

    return res.render('pte/practice/smartPractice', {
      title: 'PTE Smart Practice',
      recommendation,
      maxQuestionCount: pteSmartPracticeService.MAX_TARGET_QUESTION_COUNT,
      defaultQuestionCount: pteSmartPracticeService.DEFAULT_TARGET_QUESTION_COUNT,
      defaultWindowDays: pteSmartPracticeService.DEFAULT_WINDOW_DAYS,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function apiSmartRecommendation(req, res) {
  try {
    const recommendation = await pteSmartPracticeService.buildRecommendation(
      req.user,
      buildPracticeAccessContext(req),
      normalizeSmartPracticeOptions(req.query || {})
    );
    return res.json({
      status: 'success',
      results: recommendation
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function issueSmartStartToken(req, res) {
  try {
    return res.json({
      status: 'success',
      results: {
        actionStateId: cleanText(req.actionStateId, 220)
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function startSmartPractice(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const recommendation = await pteSmartPracticeService.buildRecommendation(
      req.user,
      buildPracticeAccessContext(req),
      normalizeSmartPracticeOptions(payload)
    );
    const selectedQuestions = Array.isArray(recommendation.selectedQuestions) ? recommendation.selectedQuestions : [];
    if (!selectedQuestions.length) {
      throw new Error('Smart Practice could not find any published practice-enabled questions for this plan.');
    }

    const practiceName = cleanText(payload.practiceName || recommendation?.summary?.recommendedName, 120);
    if (!practiceName) throw new Error('Practice name is required.');
    const metadata = pteSmartPracticeService.buildStartMetadata(recommendation);
    metadata.practice = {
      ...(metadata.practice || {}),
      name: practiceName
    };

    const result = await pteAttemptLedgerService.startAttemptSession(
      {
        practiceName,
        selectedQuestions,
        metadata,
        activityQuotaPolicy: req.activityQuotaPolicy || null,
        attemptType: 'skill_practice_run',
        source: {
          module: 'pte_smart_practice_ui',
          eventType: 'attempt_started',
          eventId: `PTE-SMART-PRACTICE-START-${Date.now()}`,
          idempotencyKey: req.actionStateId
            ? `${cleanText(req.actionStateId, 180)}:smart-practice-start`
            : ''
        }
      },
      req.user,
      buildPracticeAccessContext(req)
    );

    return res.json({
      status: 'success',
      message: 'Smart practice session started.',
      results: {
        ...result,
        recommendation,
        redirectUrl: `/pte/practice/smart/session/${encodeURIComponent(result?.session?.id || '')}`
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function showAttemptsList(req, res) {
  try {
    const filters = buildAttemptsFilters(req.query || {});
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const [result, canDeleteAttempt] = await Promise.all([
      pteAttemptLedgerService.listMyPracticeAttempts(
        {
          ...filters,
          page,
          limit
        },
        req.user,
        buildPracticeAccessContext(req),
        { pagination: { page, limit } }
      ),
      resolveDeletePracticeAttemptAccess(req)
    ]);
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const attempts = rows;
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

    await pteAttemptLedgerService.consumePracticeAccessQuota(
      {
        operation: 'READ_ALL',
        volumeUnits: 1,
        activityQuotaPolicy: req.activityQuotaPolicy || null,
        source: {
          module: 'pte_practice_attempts_list_ui',
          eventType: 'practice_attempts_list_viewed',
          eventId: `PTE-PRACTICE-ATTEMPTS-LIST-${Date.now()}`
        }
      },
      req.user,
      buildPracticeAccessContext(req)
    );

    return res.render('pte/practice/attemptsList', {
      title: 'My Practice Attempts',
      tableName: 'PTE_Practice_Attempts',
      attempts,
      pagination,
      filters: result?.filters || filters,
      canSelectStudent: result?.canSelectStudent === true,
      canDeleteAttempt: canDeleteAttempt === true,
      filterOptions: result?.optionSets || pteAttemptLedgerService.getMyPracticeAttemptsFilterOptions(),
      includeModal: true,
      includeModal_Table: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function showAttemptFeedback(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    if (!sessionId) throw new Error('Session id is required.');

    const detail = await pteAttemptLedgerService.getMyPracticeAttemptFeedbackDetail(
      sessionId,
      req.user,
      buildPracticeAccessContext(req)
    );

    return res.render('pte/practice/attemptFeedback', {
      title: `Attempt Feedback ${sessionId}`,
      detail,
      includeModal: true,
      user: req.user || null
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function showAttemptDetails(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    if (!sessionId) throw new Error('Session id is required.');

    const detail = await pteAttemptLedgerService.getMyPracticeAttemptLifecycleDetail(
      sessionId,
      req.user,
      buildPracticeAccessContext(req)
    );

    await pteAttemptLedgerService.consumePracticeAccessQuota(
      {
        operation: 'READ',
        volumeUnits: 1,
        activityQuotaPolicy: req.activityQuotaPolicy || null,
        source: {
          module: 'pte_practice_attempt_details_ui',
          eventType: 'practice_attempt_detail_viewed',
          eventId: `PTE-PRACTICE-ATTEMPT-DETAIL-${sessionId}-${Date.now()}`
        }
      },
      req.user,
      buildPracticeAccessContext(req)
    );

    return res.render('pte/practice/attemptDetails', {
      title: `Attempt Details ${sessionId}`,
      detail,
      includeModal: true,
      user: req.user || null
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function exportAttemptDetails(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    if (!sessionId) throw new Error('Session id is required.');
    const format = normalizeExportFormat(req.query?.format || req.query?.exportFormat || 'csv');

    const detail = await pteAttemptLedgerService.getMyPracticeAttemptLifecycleDetail(
      sessionId,
      req.user,
      buildPracticeAccessContext(req)
    );
    const rows = buildLifecycleExportRows(detail);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `pte-practice-lifecycle-${sessionId}-${stamp}`;

    if (format === 'json') {
      const payload = {
        generatedAt: new Date().toISOString(),
        session: detail?.session || {},
        lifecycle: detail?.lifecycle || {},
        export: rows
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.json"`);
      return res.send(JSON.stringify(payload, null, 2));
    }

    const csvRows = rows.intervalRows.map((row) => ({
      ...row,
      sessionStartCount: rows.summaryRow.startCount,
      sessionSaveCount: rows.summaryRow.saveCount,
      sessionSubmitCount: rows.summaryRow.submitCount,
      sessionNoSaveStartCount: rows.summaryRow.noSaveStartCount
    }));
    const headers = [
      'sessionId',
      'itemId',
      'questionOrder',
      'questionVersionId',
      'questionTitle',
      'skill',
      'questionType',
      'startNo',
      'startedAt',
      'endedAt',
      'endReason',
      'durationSeconds',
      'saveCountInInterval',
      'submitOccurred',
      'viewInstanceId',
      'startEventId',
      'endEventId',
      'sessionStartCount',
      'sessionSaveCount',
      'sessionSubmitCount',
      'sessionNoSaveStartCount'
    ];
    const csv = toCsv(csvRows, headers);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    return res.send(csv);
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function deleteAttempt(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    if (!sessionId) throw new Error('Session id is required.');
    const canDeleteAttempt = await resolveDeletePracticeAttemptAccess(req);
    if (!canDeleteAttempt) {
      if (isAjax(req)) {
        return res.status(403).json({
          status: 'error',
          message: 'You do not have permission to delete practice attempts.'
        });
      }
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to delete practice attempts.',
        user: req.user || null
      });
    }

    const result = await pteAttemptLedgerService.deleteMyPracticeAttempt(
      sessionId,
      req.user,
      buildPracticeAccessContext(req)
    );

    const counts = result?.counts || {};
    const uploadStats = result?.uploads || {};
    const summary = [
      `Deleted session ${result?.deletedSessionId || sessionId}.`,
      `Removed ${Number(counts.items || 0)} item(s), ${Number(counts.events || 0)} event(s), ${Number(counts.artifacts || 0)} artifact record(s).`,
      `Deleted ${Number(uploadStats.removedFiles || 0)} local file(s), ${Number(uploadStats.removedRemoteFiles || 0)} remote upload file(s), and ${Number(uploadStats.removedDirectories || 0)} folder(s).`
    ].join(' ');
    const message = result?.warning
      ? `${summary} Note: ${result.warning}`
      : summary;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message,
        results: result
      });
    }

    return res.redirect('/pte/practice/attempts');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function issueAttemptDeleteToken(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    if (!sessionId) throw new Error('Session id is required.');
    const canDeleteAttempt = await resolveDeletePracticeAttemptAccess(req);
    if (!canDeleteAttempt) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to delete practice attempts.'
      });
    }

    return res.json({
      status: 'success',
      results: {
        actionStateId: cleanText(req.actionStateId, 220)
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerPracticeUsers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PRACTICE_PICKER_USER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await pteAttemptLedgerService.listRuntimePickerUsers(
      filtered,
      req.user,
      buildPracticeAccessContext(req)
    );
    const { data, pagination } = paginate(rows, page, limit);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function showPracticeRunner(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    if (!sessionId) throw new Error('Session id is required.');

    const detail = await pteAttemptLedgerService.getAttemptSessionDetail(
      sessionId,
      req.user,
      buildPracticeAccessContext(req),
      { includeEvents: false, includeArtifacts: true }
    );
    const session = detail?.session || null;
    if (!session) throw new Error('Practice session was not found.');
    if (String(session.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      throw new Error('This session is not a skill practice run.');
    }

    const itemRows = Array.isArray(detail?.items) ? detail.items : [];
    const questionIds = Array.from(new Set(
      itemRows.map((row) => cleanText(row?.questionVersionId, 120)).filter(Boolean)
    ));
    const sessionOrgId = cleanText(session?.orgId, 120);
    const questionRows = questionIds.length
      ? await pteQuestionVersionRepository.list({
        query: {
          id__in: questionIds.join(','),
          ...(sessionOrgId ? { orgId__eq: sessionOrgId } : {})
        },
        scope: { canViewAll: true },
        projection: {
          id: 1,
          orgId: 1,
          familyId: 1,
          status: 1,
          code: 1,
          title: 1,
          instructions: 1,
          testType: 1,
          skill: 1,
          questionType: 1,
          payload: 1,
          scoringConfig: 1,
          responseContract: 1,
          mediaAssets: 1
        }
      })
      : [];
    const questionMap = new Map(questionRows.map((row) => [cleanText(row?.id, 120), row]));
    const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
    const artifactMap = new Map();
    artifacts.forEach((artifact) => {
      const key = cleanText(artifact?.attemptItemId, 120);
      if (!key) return;
      if (!artifactMap.has(key)) artifactMap.set(key, []);
      artifactMap.get(key).push(artifact);
    });

    const runnerItems = itemRows.map((item) => ({
      ...item,
      question: resolveAttemptItemQuestion(item, questionMap),
      artifacts: artifactMap.get(cleanText(item?.id, 120)) || []
    }));

    await pteAttemptLedgerService.consumePracticeReopenQuota(
      {
        sessionId: session.id,
        session,
        activityQuotaPolicy: req.activityQuotaPolicy || null,
        questionCount: Math.max(
          cleanNumber(session?.totalQuestions, 0),
          Array.isArray(runnerItems) ? runnerItems.length : 0
        ),
        source: {
          module: 'pte_practice_runner_ui',
          eventType: 'practice_attempt_reopened',
          eventId: `PTE-PRACTICE-REOPEN-${session.id}-${Date.now()}`,
          idempotencyKey: req.actionStateId
            ? `${cleanText(req.actionStateId, 180)}:practice-reopen:${cleanText(session.id, 120)}`
            : ''
        }
      },
      req.user,
      buildPracticeAccessContext(req)
    );

    const canRescoreSameRevision = await canRequesterRescoreSameRevision(
      req.user,
      buildPracticeAccessContext(req)
    );
    const runnerConfig = {
      ...(req.ptePracticeRunnerConfig || {}),
      permissions: {
        ...((req.ptePracticeRunnerConfig && typeof req.ptePracticeRunnerConfig === 'object' && req.ptePracticeRunnerConfig.permissions && typeof req.ptePracticeRunnerConfig.permissions === 'object')
          ? req.ptePracticeRunnerConfig.permissions
          : {}),
        canRescoreSameRevision
      }
    };

    return res.render('pte/practice/practiceRunner', {
      title: `PTE Practice Session ${session.id}`,
      session,
      items: runnerItems,
      events: Array.isArray(detail?.events) ? detail.events : [],
      runnerConfig,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function apiOverview(req, res) {
  try {
    const overview = await pteAttemptLedgerService.getPracticeOverview(
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      results: overview
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function issueStartRuntimeToken(req, res) {
  try {
    return res.json({
      status: 'success',
      results: {
        actionStateId: cleanText(req.actionStateId, 220)
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function startRuntime(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const runtimePlan = (payload && typeof payload === 'object') ? payload : {};
    const skillPlans = Array.isArray(runtimePlan.skillPlans) ? runtimePlan.skillPlans : [];
    if (skillPlans.length) {
      let totalRequested = 0;
      for (const skillPlan of skillPlans) {
        const typePlans = Array.isArray(skillPlan?.typePlans) ? skillPlan.typePlans : [];
        for (const typePlan of typePlans) {
          const parsed = Number.parseInt(String(typePlan?.questionCount ?? ''), 10);
          const questionCount = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
          if (questionCount > MAX_PTE_PRACTICE_QUESTIONS) {
            throw new Error(`Each selected question type can include at most ${MAX_PTE_PRACTICE_QUESTIONS} questions.`);
          }
          totalRequested += questionCount;
        }
      }
      if (totalRequested > MAX_PTE_PRACTICE_QUESTIONS) {
        throw new Error(`A skill practice attempt can include at most ${MAX_PTE_PRACTICE_QUESTIONS} questions.`);
      }
    } else {
      const parsedTotal = Number.parseInt(String(runtimePlan.questionCount ?? ''), 10);
      if (Number.isFinite(parsedTotal) && parsedTotal > MAX_PTE_PRACTICE_QUESTIONS) {
        throw new Error(`A skill practice attempt can include at most ${MAX_PTE_PRACTICE_QUESTIONS} questions.`);
      }
    }

    const accessContext = buildPracticeAccessContext(req);
    let sessionPayload = {
      ...payload,
      activityQuotaPolicy: req.activityQuotaPolicy || null,
      attemptType: 'skill_practice_run'
    };
    if (!hasExplicitRuntimeSelections(runtimePlan) && (skillPlans.length || runtimePlan.skill)) {
      try {
        const plannerResult = await pteSmartPracticeService.buildPracticeBySkillRuntimePlan(
          req.user,
          accessContext,
          runtimePlan
        );
        if (plannerResult?.selectedQuestions?.length) {
          sessionPayload = {
            ...sessionPayload,
            selectedQuestions: plannerResult.selectedQuestions,
            metadata: mergePlannerMetadata(payload.metadata, plannerResult.metadata)
          };
        }
      } catch (plannerError) {
        // Keep legacy random selection available if planning diagnostics cannot be built.
        console.warn('[PTE Practice] Practice-by-skill planner fallback:', plannerError.message);
      }
    }

    const result = await pteAttemptLedgerService.startAttemptSession(
      sessionPayload,
      req.user,
      accessContext
    );
    return res.json({
      status: 'success',
      message: 'Practice session started.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function startRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.startAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      message: 'Question view started.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function skipRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.skipAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      message: 'Question skipped.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function saveRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.saveAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      message: 'Progress saved.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function uploadRuntimeItemAudio(req, res) {
  try {
    if (!req.file) throw new Error('No audio file uploaded.');
    const sessionId = cleanText(req.params.sessionId, 120);
    const itemId = cleanText(req.params.itemId, 120);
    if (!sessionId || !itemId) throw new Error('sessionId and itemId are required.');

    const runtimePayload = readRuntimePayload(req);
    const normalizedPath = String(uploadMiddleware.getStoredFilePath(req.file) || '').replace(/\\/g, '/');
    const normalizedUrl = String(uploadMiddleware.getStoredFileUrl(req.file) || '').replace(/\\/g, '/');
    const artifact = {
      clientArtifactId: cleanText(req.body?.clientArtifactId, 160) || `AUDIO-${Date.now()}`,
      artifactType: 'audio',
      name: cleanText(req.file.originalname, 260) || cleanText(req.file.filename, 260) || 'practice-audio.webm',
      mimeType: cleanText(req.file.mimetype, 120) || 'audio/webm',
      sizeBytes: Math.max(0, Number(req.file.size || 0) || 0),
      path: normalizedPath,
      url: buildAttachmentUrlFromPath(normalizedUrl || normalizedPath),
      durationSeconds: Math.max(0, cleanNumber(req.body?.durationSeconds, 0)),
      metadata: {
        source: 'practice_runner_recording',
        originalName: cleanText(req.file.originalname, 260),
        filename: cleanText(req.file.filename, 260),
        localPath: cleanText(req.file.localPath, 1200),
        uploadUrl: cleanText(req.file.uploadUrl, 1200),
        storagePath: cleanText(req.file.storagePath, 1200),
        gatewayRelativePath: cleanText(req.file.gatewayRelativePath, 1200),
        gatewayFileName: cleanText(req.file.gatewayFileName, 260)
      }
    };

    const result = await pteAttemptLedgerService.saveAttemptItem(
      sessionId,
      itemId,
      {
        ...runtimePayload,
        artifacts: [artifact],
        source: {
          module: 'pte_practice_runner_ui',
          eventType: 'response_saved',
          eventId: `PTE-PRACTICE-AUDIO-UPLOAD-${itemId}-${Date.now()}`,
          ...(runtimePayload?.source && typeof runtimePayload.source === 'object' ? runtimePayload.source : {})
        }
      },
      req.user,
      buildPracticeAccessContext(req)
    );

    const createdArtifact = Array.isArray(result?.artifacts) && result.artifacts.length
      ? result.artifacts[result.artifacts.length - 1]
      : artifact;

    return res.json({
      status: 'success',
      message: 'Audio uploaded and linked to attempt item.',
      results: {
        session: result?.session || null,
        item: result?.item || null,
        artifact: createdArtifact
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function submitRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.submitAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      message: 'Question submitted.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function scoreRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.scoreAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      {
        ...payload,
        activityQuotaPolicy: req.activityQuotaPolicy || null
      },
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      message: 'Question scored.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function rateRuntimeItem(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.rateAttemptItem(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      message: 'Difficulty rating saved.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function finishRuntime(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.submitAttemptSession(
      req.params.sessionId,
      {
        ...payload,
        autoSubmitRemaining: false
      },
      req.user,
      buildPracticeAccessContext(req)
    );
    return res.json({
      status: 'success',
      message: 'Practice session finished.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getRuntimeSession(req, res) {
  try {
    const includeEvents = String(req.query?.includeEvents || 'true').toLowerCase() !== 'false';
    const eventLimit = Number.parseInt(req.query?.eventLimit, 10) || 300;
    const result = await pteAttemptLedgerService.getAttemptSessionDetail(
      req.params.sessionId,
      req.user,
      buildPracticeAccessContext(req),
      { includeEvents, eventLimit }
    );
    return res.json({
      status: 'success',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  showBySkills,
  showSmartPractice,
  apiSmartRecommendation,
  issueSmartStartToken,
  startSmartPractice,
  showAttemptsList,
  showAttemptFeedback,
  showAttemptDetails,
  exportAttemptDetails,
  deleteAttempt,
  issueAttemptDeleteToken,
  pickerPracticeUsers,
  showPracticeRunner,
  apiOverview,
  issueStartRuntimeToken,
  startRuntime,
  startRuntimeItem,
  skipRuntimeItem,
  saveRuntimeItem,
  uploadRuntimeItemAudio,
  submitRuntimeItem,
  scoreRuntimeItem,
  rateRuntimeItem,
  finishRuntime,
  getRuntimeSession
};
