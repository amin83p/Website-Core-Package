const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  paginate,
  securityService,
  SECTIONS,
  OPERATIONS
} = require('./feedbackControllerDependencies');
const pteAttemptLedgerService = require('../services/pte/pteAttemptLedgerService');
const FEEDBACK_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['status', 'skill', 'withFeedback'],
  allowedSearchFields: [
    'id',
    'userId',
    'userLabel',
    'status',
    'practiceSkill',
    'startedAt',
    'finishedAt'
  ],
  defaultSearchFields: [
    'id',
    'userId',
    'userLabel',
    'status',
    'practiceSkill',
    'startedAt',
    'finishedAt'
  ],
  allowMetaKeys: true
});

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function parseMaybeJson(input, fallback = null) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid feedback payload.');
  }
}

function readRuntimePayload(req) {
  const body = req?.body;
  if (body && Object.prototype.hasOwnProperty.call(body, 'runtimePlan')) {
    return parseMaybeJson(body.runtimePlan, {}) || {};
  }
  return (body && typeof body === 'object') ? body : {};
}

function buildListFilters(query = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  const userIds = Array.isArray(source.userIds)
    ? source.userIds
    : (source.userIds ? String(source.userIds || '').split(',') : []);
  return {
    q: cleanText(source.q || source.search, 220),
    type: cleanText(source.type, 40).toLowerCase(),
    searchFields: cleanText(source.searchFields, 400),
    status: cleanText(source.status__eq || source.status, 40).toLowerCase(),
    skill: cleanText(source.skill__eq || source.skill, 30).toLowerCase(),
    withFeedback: cleanText(source.withFeedback__eq || source.withFeedback, 10).toLowerCase(),
    startedFrom: cleanText(source.startedFrom, 80),
    startedTo: cleanText(source.startedTo, 80),
    userIds: userIds.map((value) => cleanText(value, 120)).filter(Boolean)
  };
}

async function resolveCreateAccess(req) {
  try {
    const evaluation = await securityService.evaluateAccess({
      user: req.user,
      sectionId: SECTIONS.PTE_FEEDBACK_ON_PRACTICE,
      operationId: OPERATIONS.CREATE,
      ipAddress: req.ip
    });
    return Boolean(evaluation?.allowed);
  } catch (_) {
    return false;
  }
}

async function listPracticeFeedback(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, FEEDBACK_LIST_QUERY_OPTIONS);
    query.userIds = req.query?.userIds || req.query?.userId || '';
    const filters = buildListFilters(query);
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const [result, canCreateFeedback] = await Promise.all([
      pteAttemptLedgerService.listPracticeFeedbackSessions(
        {
          ...filters,
          page,
          limit
        },
        req.user,
        { scopeId: req.accessScope },
        { pagination: { page, limit } }
      ),
      resolveCreateAccess(req)
    ]);

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const searchableFields = await inferSearchableFields(rows, {
      exclude: ['audit', 'metadata']
    });
    const data = rows;
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;
    const optionSets = result?.optionSets || {};

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination,
        searchableFields
      });
    }

    return res.render('pte/feedback/practiceFeedbackList', {
      title: 'PTE Feedback On Practice',
      tableName: 'PTE_Feedback_On_Practice',
      data,
      searchableFields,
      newUrl: 'pte/feedback/practice',
      newLabel: null,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters,
      filterOptions: {
        ...(pteAttemptLedgerService.getPracticeFeedbackFilterOptions() || {}),
        ...(optionSets || {})
      },
      canCreateFeedback,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function renderPracticeFeedbackSession(req, res, options = {}) {
  const editable = options?.editable === true;
  try {
    const [detail, canCreateFeedback] = await Promise.all([
      pteAttemptLedgerService.getPracticeFeedbackSessionDetail(
        req.params.sessionId,
        req.user,
        { scopeId: req.accessScope }
      ),
      resolveCreateAccess(req)
    ]);

    if (!detail || !detail.session) {
      return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    }

    return res.render('pte/feedback/practiceFeedbackSession', {
      title: editable
        ? 'Provide Feedback'
        : 'Practice Feedback',
      detail,
      canEdit: editable,
      canCreateFeedback,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function viewPracticeFeedbackSession(req, res) {
  return renderPracticeFeedbackSession(req, res, { editable: false });
}

async function editPracticeFeedbackSession(req, res) {
  return renderPracticeFeedbackSession(req, res, { editable: true });
}

async function savePracticeItemFeedback(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.savePracticeItemFeedback(
      req.params.sessionId,
      req.params.itemId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Feedback saved successfully.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function generatePracticeDetailedFeedback(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.generatePracticeSessionDetailedFeedback(
      req.params.sessionId,
      req.user,
      { scopeId: req.accessScope },
      payload
    );
    return res.json({
      status: 'success',
      message: 'Detailed student feedback generated successfully.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function savePracticeDetailedFeedback(req, res) {
  try {
    const payload = readRuntimePayload(req);
    const result = await pteAttemptLedgerService.savePracticeSessionDetailedFeedback(
      req.params.sessionId,
      payload,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'Detailed feedback saved successfully.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listPracticeFeedback,
  viewPracticeFeedbackSession,
  editPracticeFeedbackSession,
  savePracticeItemFeedback,
  generatePracticeDetailedFeedback,
  savePracticeDetailedFeedback
};

