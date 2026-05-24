const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  paginate
} = require('./attemptControllerDependencies');
const pteAttemptLedgerService = require('../services/pte/pteAttemptLedgerService');
const pteQuestionBankDataService = require('../services/pte/pteQuestionBankDataService');

const RUNTIME_PICKER_USER_QUERY_OPTIONS = Object.freeze({
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

function normalizeMultiValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function buildRuntimeLedgerFilters(query = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  return {
    q: cleanText(source.q, 220),
    type: cleanText(source.type, 40).toLowerCase(),
    searchFields: cleanText(source.searchFields, 400),
    startDate: cleanText(source.startDate || source.eventFrom, 80),
    endDate: cleanText(source.endDate || source.eventTo, 80),
    attemptTypes: normalizeMultiValue(source.attemptTypes),
    eventTypes: normalizeMultiValue(source.eventTypes),
    skills: normalizeMultiValue(source.skills),
    userIds: normalizeMultiValue(source.userIds),
    sessionStatus: cleanText(source.sessionStatus, 40).toLowerCase(),
    itemStatus: cleanText(source.itemStatus, 40).toLowerCase(),
    questionType: cleanText(source.questionType, 120).toLowerCase(),
    sessionId: cleanText(source.sessionId, 120),
    itemId: cleanText(source.itemId, 120),
    testVersionId: cleanText(source.testVersionId, 120),
    questionVersionId: cleanText(source.questionVersionId, 120),
    withFeedback: cleanText(source.withFeedback, 10).toLowerCase(),
    minScoreFinal: cleanText(source.minScoreFinal, 40),
    maxScoreFinal: cleanText(source.maxScoreFinal, 40),
    minTimeSpentSeconds: cleanText(source.minTimeSpentSeconds, 40),
    maxTimeSpentSeconds: cleanText(source.maxTimeSpentSeconds, 40)
  };
}

function buildDetailsFilters(query = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  return {
    q: cleanText(source.q || source.search, 220),
    sessionId: cleanText(source.sessionId, 120),
    attemptType: cleanText(source.attemptType, 40).toLowerCase(),
    status: cleanText(source.status, 40).toLowerCase(),
    userId: cleanText(source.userId, 120),
    startedFrom: cleanText(source.startedFrom, 80),
    startedTo: cleanText(source.startedTo, 80)
  };
}

function buildOverallFilters(query = {}) {
  const source = (query && typeof query === 'object') ? query : {};
  return {
    q: cleanText(source.q || source.search, 220),
    attemptType: cleanText(source.attemptType, 40).toLowerCase(),
    status: cleanText(source.status, 40).toLowerCase(),
    userId: cleanText(source.userId, 120),
    startedFrom: cleanText(source.startedFrom || source.from || source.startDate, 80),
    startedTo: cleanText(source.startedTo || source.to || source.endDate, 80)
  };
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

async function listAttemptLedger(req, res) {
  try {
    const filters = buildRuntimeLedgerFilters(req.query || {});
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const selectedUserRows = filters.userIds.length
      ? await pteAttemptLedgerService.listRuntimePickerUsers(
        { id__in: filters.userIds.join(',') },
        req.user,
        { scopeId: req.accessScope }
      )
      : [];

    const result = await pteAttemptLedgerService.listRuntimeLedgerEvents(
      {
        ...filters,
        page,
        limit
      },
      req.user,
      { scopeId: req.accessScope },
      { pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const searchableFields = await inferSearchableFields(rows, {
      exclude: ['audit', 'source', 'traitScores', 'responseSummary', 'artifactRefs', 'metadata', 'creator']
    });
    const data = rows;
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;
    const filterOptions = pteAttemptLedgerService.getRuntimeFilterOptions();

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('pte/attempt/attemptLedgerList', {
      title: 'PTE Attempt Ledger',
      tableName: 'PTE_Attempt_Ledger',
      data,
      searchableFields,
      newUrl: 'pte/attempt/ledger',
      newLabel: null,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters,
      selectedUsers: Array.isArray(selectedUserRows) ? selectedUserRows : [],
      filterOptions,
      questionTypeOptions: Array.isArray(result?.optionSets?.questionTypes) ? result.optionSets.questionTypes : [],
      user: req.user,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function pickerAttemptUsers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, RUNTIME_PICKER_USER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await pteAttemptLedgerService.listRuntimePickerUsers(
      filtered,
      req.user,
      { scopeId: req.accessScope }
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

async function showAttemptDetails(req, res) {
  try {
    const filters = buildDetailsFilters(req.query || {});
    const requestedSessionId = cleanText(req.params.sessionId || filters.sessionId, 120);
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const result = await pteAttemptLedgerService.listAttemptSessionsForDetails(
      {
        ...filters,
        page,
        limit
      },
      req.user,
      { scopeId: req.accessScope },
      { pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

    let detail = null;
    let detailError = '';
    const selectedSessionId = requestedSessionId || '';
    if (selectedSessionId) {
      try {
        detail = await pteAttemptLedgerService.getAttemptSessionDetail(
          selectedSessionId,
          req.user,
          { scopeId: req.accessScope },
          { includeEvents: true, includeArtifacts: true, includeLifecycle: true, eventLimit: 2000 }
        );

        const questionIds = Array.from(new Set(
          (Array.isArray(detail?.items) ? detail.items : [])
            .map((item) => cleanText(item?.questionVersionId, 120))
            .filter(Boolean)
        ));
        const questionRowsResult = questionIds.length
          ? await pteQuestionBankDataService.listQuestions(
            { id__in: questionIds.join(',') },
            req.user,
            { scopeId: req.accessScope },
            { paginated: false }
          )
          : [];
        const questionRows = Array.isArray(questionRowsResult)
          ? questionRowsResult
          : (Array.isArray(questionRowsResult?.rows) ? questionRowsResult.rows : []);
        const questionMap = new Map(questionRows.map((row) => [cleanText(row?.id, 120), row]));
        if (Array.isArray(detail?.items)) {
          detail.items = detail.items.map((item) => ({
            ...item,
            question: resolveAttemptItemQuestion(item, questionMap)
          }));
        }
      } catch (error) {
        detailError = error.message;
      }
    }

    const selectedUsers = filters.userId
      ? await pteAttemptLedgerService.listRuntimePickerUsers(
        { id__in: filters.userId },
        req.user,
        { scopeId: req.accessScope }
      )
      : [];

    return res.render('pte/attempt/attemptDetails', {
      title: 'PTE Attempt Details',
      sessions: rows,
      pagination,
      filters: result?.filters || filters,
      selectedSessionId,
      detail,
      detailError,
      selectedUsers: Array.isArray(selectedUsers) ? selectedUsers : [],
      optionSets: result?.optionSets || pteAttemptLedgerService.getAttemptDetailsFilterOptions(),
      includeModal: true,
      user: req.user || null
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showOverallPerformance(req, res) {
  try {
    const filters = buildOverallFilters(req.query || {});
    const result = await pteAttemptLedgerService.getAttemptOverallPerformance(
      filters,
      req.user,
      { scopeId: req.accessScope }
    );
    const selectedUsers = filters.userId
      ? await pteAttemptLedgerService.listRuntimePickerUsers(
        { id__in: filters.userId },
        req.user,
        { scopeId: req.accessScope }
      )
      : [];

    return res.render('pte/attempt/attemptOverallPerformance', {
      title: 'PTE Attempt Overall Performance',
      report: result,
      filters: result?.filters || filters,
      selectedUsers: Array.isArray(selectedUsers) ? selectedUsers : [],
      optionSets: result?.optionSets || pteAttemptLedgerService.getAttemptDetailsFilterOptions(),
      includeModal: true,
      user: req.user || null
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function exportAttemptDetailsLifecycle(req, res) {
  try {
    const sessionId = cleanText(req.params.sessionId, 120);
    if (!sessionId) throw new Error('Session id is required.');
    const format = normalizeExportFormat(req.query?.format || req.query?.exportFormat || 'csv');

    const detail = await pteAttemptLedgerService.getAttemptSessionDetail(
      sessionId,
      req.user,
      { scopeId: req.accessScope },
      { includeEvents: true, includeArtifacts: false, includeLifecycle: true, eventLimit: 2000 }
    );
    const rows = buildLifecycleExportRows(detail);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `pte-attempt-lifecycle-${sessionId}-${stamp}`;

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
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listAttemptLedger,
  pickerAttemptUsers,
  showAttemptDetails,
  showOverallPerformance,
  exportAttemptDetailsLifecycle
};

