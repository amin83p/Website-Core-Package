function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) return Number(fallback || 0);
  return numeric;
}

function toIso(value) {
  const token = cleanString(value, { max: 80, allowEmpty: true }) || '';
  if (!token) return '';
  const ms = Date.parse(token);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toISOString();
  } catch (_) {
    return '';
  }
}

function toMs(value) {
  const iso = toIso(value);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function safeEventId(event = {}) {
  return cleanString(event?.id || event?._id, { max: 140, allowEmpty: true }) || '';
}

function safeItemId(value) {
  return cleanString(value, { max: 140, allowEmpty: true }) || '';
}

function normalizeEventType(value) {
  return cleanString(value, { max: 80, allowEmpty: true }).toLowerCase();
}

function safeDurationSeconds(startedAt = '', endedAt = '') {
  const startMs = toMs(startedAt);
  const endMs = toMs(endedAt);
  if (startMs === null || endMs === null || endMs < startMs) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

function stableSortEvents(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => {
      const aMs = toMs(a?.eventAt) || 0;
      const bMs = toMs(b?.eventAt) || 0;
      if (aMs !== bMs) return aMs - bMs;
      return safeEventId(a).localeCompare(safeEventId(b));
    });
}

function resolveQuestionTitle(item = {}) {
  return cleanString(
    item?.question?.title
      || item?.metadata?.questionTitle
      || item?.questionVersionId
      || '',
    { max: 260, allowEmpty: true }
  ) || '';
}

function resolveViewInstanceId(event = {}, fallback = '') {
  const metadata = (event && typeof event.metadata === 'object' && event.metadata) ? event.metadata : {};
  return cleanString(
    metadata.viewInstanceId
      || event?.viewInstanceId
      || fallback
      || '',
    { max: 200, allowEmpty: true }
  ) || '';
}

function createItemState(item = {}) {
  const id = safeItemId(item?.id);
  return {
    id,
    questionOrder: cleanNonNegativeInteger(item?.questionOrder, 0),
    questionVersionId: cleanString(item?.questionVersionId, { max: 140, allowEmpty: true }) || '',
    questionType: cleanString(item?.questionType, { max: 140, allowEmpty: true }).toLowerCase() || '',
    skill: cleanString(item?.skill, { max: 40, allowEmpty: true }).toLowerCase() || '',
    questionTitle: resolveQuestionTitle(item),
    counters: {
      startCount: 0,
      saveCount: 0,
      submitCount: 0,
      autoSubmitCount: 0,
      skipCount: 0
    },
    intervals: [],
    anomalies: [],
    activeInterval: null
  };
}

function createInterval(state = {}, event = {}) {
  const startNo = cleanNonNegativeInteger(state?.counters?.startCount, 0);
  const startedAt = toIso(event?.eventAt) || toIso(event?.startedAt) || '';
  return {
    itemId: safeItemId(state?.id),
    startNo,
    startedAt,
    endedAt: '',
    endReason: '',
    durationSeconds: 0,
    saveCountInInterval: 0,
    submitOccurred: false,
    viewInstanceId: resolveViewInstanceId(event, ''),
    startEventId: safeEventId(event),
    endEventId: '',
    startedFromEventType: normalizeEventType(event?.eventType),
    closeMetadata: {}
  };
}

function createAnomaly(type, state = {}, event = {}, extra = {}) {
  return {
    type: cleanString(type, { max: 80, allowEmpty: true }).toLowerCase(),
    itemId: safeItemId(state?.id || event?.attemptItemId || ''),
    questionOrder: cleanNonNegativeInteger(state?.questionOrder, cleanNonNegativeInteger(event?.questionOrder, 0)),
    questionVersionId: cleanString(state?.questionVersionId || event?.questionVersionId, { max: 140, allowEmpty: true }) || '',
    questionType: cleanString(state?.questionType || event?.questionType, { max: 140, allowEmpty: true }).toLowerCase() || '',
    skill: cleanString(state?.skill || event?.skill, { max: 40, allowEmpty: true }).toLowerCase() || '',
    eventId: safeEventId(event),
    eventType: normalizeEventType(event?.eventType),
    eventAt: toIso(event?.eventAt) || '',
    message: cleanString(extra?.message, { max: 600, allowEmpty: true }) || '',
    metadata: (extra && typeof extra.metadata === 'object' && extra.metadata) ? extra.metadata : {}
  };
}

function closeActiveInterval(state = {}, event = {}, { endReason = '', closeType = '', metadata = {} } = {}) {
  if (!state?.activeInterval) return null;
  const interval = state.activeInterval;
  const endedAt = toIso(event?.eventAt || event?.finishedAt) || '';
  interval.endedAt = endedAt;
  interval.endReason = cleanString(endReason, { max: 80, allowEmpty: true }).toLowerCase() || '';
  interval.endEventId = safeEventId(event);
  interval.durationSeconds = safeDurationSeconds(interval.startedAt, interval.endedAt);
  interval.closeMetadata = {
    ...interval.closeMetadata,
    closeType: cleanString(closeType, { max: 80, allowEmpty: true }).toLowerCase() || '',
    ...(metadata && typeof metadata === 'object' ? metadata : {})
  };
  state.intervals.push(interval);
  state.activeInterval = null;
  return interval;
}

function finalizeOpenInterval(state = {}, finalizeEvent = {}, anomalyRows = []) {
  if (!state?.activeInterval) return;
  const finalized = closeActiveInterval(state, finalizeEvent, {
    endReason: 'session_finalized',
    closeType: 'session_finalized'
  });
  if (!finalized) return;
  const anomaly = createAnomaly('open_interval_on_finalize', state, finalizeEvent, {
    message: 'Question interval remained open until session finalization.',
    metadata: {
      startEventId: finalized.startEventId,
      endEventId: finalized.endEventId
    }
  });
  state.anomalies.push(anomaly);
  anomalyRows.push(anomaly);
}

function resolveSessionFinalizeEvent(session = {}, events = []) {
  const sorted = stableSortEvents(events);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const token = normalizeEventType(sorted[i]?.eventType);
    if (token === 'attempt_finished' || token === 'attempt_submitted' || token === 'attempt_abandoned') {
      return sorted[i];
    }
  }
  const fallbackAt = toIso(session?.finishedAt || session?.submittedAt || '');
  if (!fallbackAt) return null;
  return {
    id: '',
    eventType: 'attempt_finished',
    eventAt: fallbackAt
  };
}

function appendOrphanEventAnomaly(event = {}, anomalyRows = []) {
  const anomaly = createAnomaly('orphan_event', {}, event, {
    message: 'Event references a missing or unknown attempt item.',
    metadata: {
      attemptItemId: safeItemId(event?.attemptItemId)
    }
  });
  anomalyRows.push(anomaly);
}

function summarizeItemState(state = {}) {
  const intervals = Array.isArray(state?.intervals) ? state.intervals : [];
  const endedIntervals = intervals.filter((row) => cleanString(row?.endedAt, { max: 80, allowEmpty: true }));
  const noSaveStartCount = endedIntervals.filter((row) => cleanNonNegativeInteger(row?.saveCountInInterval, 0) <= 0).length;
  const totalActiveSeconds = endedIntervals.reduce((sum, row) => sum + cleanNonNegativeInteger(row?.durationSeconds, 0), 0);
  const avgStartDurationSeconds = endedIntervals.length
    ? Number((totalActiveSeconds / endedIntervals.length).toFixed(2))
    : 0;

  return {
    itemId: safeItemId(state?.id),
    questionOrder: cleanNonNegativeInteger(state?.questionOrder, 0),
    questionVersionId: cleanString(state?.questionVersionId, { max: 140, allowEmpty: true }) || '',
    questionType: cleanString(state?.questionType, { max: 140, allowEmpty: true }).toLowerCase() || '',
    skill: cleanString(state?.skill, { max: 40, allowEmpty: true }).toLowerCase() || '',
    questionTitle: cleanString(state?.questionTitle, { max: 260, allowEmpty: true }) || '',
    startCount: cleanNonNegativeInteger(state?.counters?.startCount, 0),
    saveCount: cleanNonNegativeInteger(state?.counters?.saveCount, 0),
    submitCount: cleanNonNegativeInteger(state?.counters?.submitCount, 0),
    autoSubmitCount: cleanNonNegativeInteger(state?.counters?.autoSubmitCount, 0),
    skipCount: cleanNonNegativeInteger(state?.counters?.skipCount, 0),
    noSaveStartCount,
    avgStartDurationSeconds,
    totalActiveSeconds,
    intervals,
    anomalyCount: Array.isArray(state?.anomalies) ? state.anomalies.length : 0,
    anomalies: Array.isArray(state?.anomalies) ? state.anomalies : []
  };
}

function summarizeLifecycle(session = {}, matrixRows = [], anomalyRows = []) {
  const rows = Array.isArray(matrixRows) ? matrixRows : [];
  const totals = rows.reduce((acc, row) => {
    acc.startCount += cleanNonNegativeInteger(row?.startCount, 0);
    acc.saveCount += cleanNonNegativeInteger(row?.saveCount, 0);
    acc.submitCount += cleanNonNegativeInteger(row?.submitCount, 0);
    acc.autoSubmitCount += cleanNonNegativeInteger(row?.autoSubmitCount, 0);
    acc.skipCount += cleanNonNegativeInteger(row?.skipCount, 0);
    acc.noSaveStartCount += cleanNonNegativeInteger(row?.noSaveStartCount, 0);
    acc.totalActiveSeconds += cleanNonNegativeInteger(row?.totalActiveSeconds, 0);
    return acc;
  }, {
    startCount: 0,
    saveCount: 0,
    submitCount: 0,
    autoSubmitCount: 0,
    skipCount: 0,
    noSaveStartCount: 0,
    totalActiveSeconds: 0
  });
  const avgStartDurationSeconds = totals.startCount > 0
    ? Number((totals.totalActiveSeconds / totals.startCount).toFixed(2))
    : 0;

  return {
    sessionId: cleanString(session?.id, { max: 140, allowEmpty: true }) || '',
    itemCount: rows.length,
    startCount: totals.startCount,
    saveCount: totals.saveCount,
    submitCount: totals.submitCount,
    autoSubmitCount: totals.autoSubmitCount,
    skipCount: totals.skipCount,
    noSaveStartCount: totals.noSaveStartCount,
    totalActiveSeconds: totals.totalActiveSeconds,
    avgStartDurationSeconds,
    anomalyCount: Array.isArray(anomalyRows) ? anomalyRows.length : 0
  };
}

function buildQuestionIndex(items = []) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const id = safeItemId(item?.id);
    if (!id || map.has(id)) return;
    map.set(id, createItemState(item));
  });
  return map;
}

function buildAttemptLifecycle(session = {}, items = [], events = []) {
  const questionStates = buildQuestionIndex(items);
  const anomalyRows = [];
  const sortedEvents = stableSortEvents(events);
  const itemEventTypes = new Set([
    'question_started',
    'response_saved',
    'question_skipped',
    'question_submitted',
    'question_auto_submitted'
  ]);

  sortedEvents.forEach((event) => {
    const eventType = normalizeEventType(event?.eventType);
    if (!eventType || !itemEventTypes.has(eventType)) return;
    const itemId = safeItemId(event?.attemptItemId);
    const state = itemId ? questionStates.get(itemId) : null;
    if (!state) {
      appendOrphanEventAnomaly(event, anomalyRows);
      return;
    }

    if (eventType === 'question_started') {
      state.counters.startCount += 1;
      if (state.activeInterval) {
        const overlapped = closeActiveInterval(state, event, {
          endReason: 'overlapping_start',
          closeType: 'overlapping_start'
        });
        const anomaly = createAnomaly('overlapping_start', state, event, {
          message: 'A new start occurred while another start interval was still open.',
          metadata: {
            priorStartEventId: overlapped?.startEventId || '',
            closeEventId: safeEventId(event)
          }
        });
        state.anomalies.push(anomaly);
        anomalyRows.push(anomaly);
      }
      state.activeInterval = createInterval(state, event);
      return;
    }

    if (eventType === 'response_saved') {
      state.counters.saveCount += 1;
      if (!state.activeInterval) {
        const anomaly = createAnomaly('save_without_start', state, event, {
          message: 'Save event received without an active start interval.'
        });
        state.anomalies.push(anomaly);
        anomalyRows.push(anomaly);
        return;
      }
      state.activeInterval.saveCountInInterval += 1;
      state.activeInterval.viewInstanceId = resolveViewInstanceId(event, state.activeInterval.viewInstanceId);
      return;
    }

    if (eventType === 'question_skipped') {
      state.counters.skipCount += 1;
      if (!state.activeInterval) {
        const anomaly = createAnomaly('submit_without_start', state, event, {
          message: 'Skip event received without an active start interval.'
        });
        state.anomalies.push(anomaly);
        anomalyRows.push(anomaly);
        return;
      }
      state.activeInterval.viewInstanceId = resolveViewInstanceId(event, state.activeInterval.viewInstanceId);
      closeActiveInterval(state, event, {
        endReason: 'question_skipped',
        closeType: 'skip'
      });
      return;
    }

    if (eventType === 'question_submitted' || eventType === 'question_auto_submitted') {
      state.counters.submitCount += 1;
      if (eventType === 'question_auto_submitted') state.counters.autoSubmitCount += 1;
      if (!state.activeInterval) {
        const anomaly = createAnomaly('submit_without_start', state, event, {
          message: 'Submit event received without an active start interval.'
        });
        state.anomalies.push(anomaly);
        anomalyRows.push(anomaly);
        return;
      }
      state.activeInterval.submitOccurred = true;
      state.activeInterval.viewInstanceId = resolveViewInstanceId(event, state.activeInterval.viewInstanceId);
      closeActiveInterval(state, event, {
        endReason: eventType,
        closeType: 'submit'
      });
    }
  });

  const finalizeEvent = resolveSessionFinalizeEvent(session, sortedEvents);
  questionStates.forEach((state) => {
    if (state.activeInterval && finalizeEvent) {
      finalizeOpenInterval(state, finalizeEvent, anomalyRows);
    }
  });

  const matrix = Array.from(questionStates.values())
    .map((state) => summarizeItemState(state))
    .sort((a, b) => {
      const aOrder = cleanNonNegativeInteger(a?.questionOrder, 0);
      const bOrder = cleanNonNegativeInteger(b?.questionOrder, 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return safeItemId(a?.itemId).localeCompare(safeItemId(b?.itemId));
    });

  const intervals = [];
  matrix.forEach((row) => {
    (Array.isArray(row?.intervals) ? row.intervals : []).forEach((interval) => {
      intervals.push({
        ...interval,
        questionOrder: row.questionOrder,
        questionVersionId: row.questionVersionId,
        questionType: row.questionType,
        skill: row.skill,
        questionTitle: row.questionTitle
      });
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    sessionId: cleanString(session?.id, { max: 140, allowEmpty: true }) || '',
    summary: summarizeLifecycle(session, matrix, anomalyRows),
    questionMatrix: matrix,
    intervals,
    anomalies: anomalyRows
  };
}

module.exports = {
  buildAttemptLifecycle,
  stableSortEvents
};

