'use strict';

const sessionStatusPolicyService = require('./sessionStatusPolicyService');

function cleanText(value) {
  return String(value || '').trim();
}

function cleanDateKey(value) {
  const token = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function buildSelectionKey(batchId, findingId) {
  return `${cleanText(batchId)}:${cleanText(findingId)}`;
}

function computeDaysPassed(sessionDate, asOfDate) {
  const sessionKey = cleanDateKey(sessionDate);
  const asOfKey = cleanDateKey(asOfDate) || cleanDateKey(new Date().toISOString().slice(0, 10));
  if (!sessionKey || !asOfKey) return null;
  const sessionMs = Date.parse(`${sessionKey}T12:00:00Z`);
  const asOfMs = Date.parse(`${asOfKey}T12:00:00Z`);
  if (Number.isNaN(sessionMs) || Number.isNaN(asOfMs)) return null;
  const diff = Math.floor((asOfMs - sessionMs) / 86400000);
  return diff < 0 ? 0 : diff;
}

function formatDaysPassedLabel(daysPassed) {
  if (daysPassed === null || daysPassed === undefined) return '—';
  const n = Number(daysPassed);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return 'Today';
  if (n === 1) return '1 day';
  return `${n} days`;
}

function buildSessionTimeLine(session = {}) {
  const start = cleanText(session?.startTime).slice(0, 5);
  const end = cleanText(session?.endTime).slice(0, 5);
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
}

function enrichSessionFromFinding(item = {}, { asOfDate = '', statusMap = null } = {}) {
  const findingId = cleanText(item?.id);
  const sessionDate = cleanText(item.sessionDate);
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
  const session = payload.session && typeof payload.session === 'object' ? payload.session : {};
  const statusRaw = cleanText(session?.status || session?.sessionStatus);
  const notes = cleanText(session?.notes || session?.statusNotes);
  const map = statusMap instanceof Map ? statusMap : null;
  let statusCode = statusRaw || 'scheduled';
  let statusLabel = statusCode;
  let statusIsFinal = false;
  if (map) {
    const { normalized, definition } = sessionStatusPolicyService.resolveStatusDefinition(map, {
      status: statusRaw,
      notes
    });
    statusCode = normalized || statusCode;
    statusLabel = cleanText(definition?.label) || statusCode.replace(/_/g, ' ');
    statusIsFinal = definition?.isFinal === true;
  } else {
    statusLabel = statusCode.replace(/_/g, ' ');
  }
  const daysPassed = computeDaysPassed(sessionDate || cleanText(session?.date), asOfDate);
  return {
    selectionKey: '',
    findingId,
    batchId: '',
    title: cleanText(item.title) || findingId,
    sessionDate: sessionDate || cleanText(session?.date),
    sessionTime: buildSessionTimeLine(session),
    href: cleanText(item.href),
    unmarkedCount: item.unmarkedCount,
    statusCode,
    statusLabel,
    statusIsFinal,
    daysPassed,
    daysPassedLabel: formatDaysPassedLabel(daysPassed)
  };
}

function buildRunPresentationTree(run = {}, options = {}) {
  const asOfDate = cleanText(options.asOfDate || run.asOfDate);
  const statusMap = options.statusMap || null;
  const teachers = [];
  const batches = Array.isArray(run.batches) ? run.batches : [];

  batches.forEach((batch) => {
    const personId = cleanText(batch.recipientPersonId);
    if (!personId) return;
    const classMap = new Map();
    (Array.isArray(batch.items) ? batch.items : []).forEach((item) => {
      const findingId = cleanText(item?.id);
      if (!findingId) return;
      const classTitle = cleanText(item.classTitle) || 'General';
      if (!classMap.has(classTitle)) classMap.set(classTitle, []);
      const enriched = enrichSessionFromFinding(item, { asOfDate, statusMap });
      enriched.selectionKey = buildSelectionKey(batch.id, findingId);
      enriched.batchId = batch.id;
      classMap.get(classTitle).push(enriched);
    });
    const classes = [...classMap.entries()]
      .map(([classTitle, sessions]) => ({ classTitle, sessions }))
      .sort((a, b) => a.classTitle.localeCompare(b.classTitle));
    teachers.push({
      personId,
      name: cleanText(batch.recipientName) || personId,
      batchId: batch.id,
      classes,
      sessionCount: classes.reduce((sum, row) => sum + row.sessions.length, 0)
    });
  });

  teachers.sort((a, b) => a.name.localeCompare(b.name));
  return { teachers, asOfDate: asOfDate || cleanDateKey(new Date().toISOString().slice(0, 10)) };
}

function resolveSelectedItems(run = {}, selectionKeys = []) {
  const wanted = new Set((Array.isArray(selectionKeys) ? selectionKeys : []).map((k) => cleanText(k)).filter(Boolean));
  const items = [];
  let recipientPersonId = '';
  const batches = Array.isArray(run.batches) ? run.batches : [];
  batches.forEach((batch) => {
    (Array.isArray(batch.items) ? batch.items : []).forEach((item) => {
      const key = buildSelectionKey(batch.id, item.id);
      if (!wanted.has(key)) return;
      items.push(item);
      recipientPersonId = cleanText(batch.recipientPersonId);
    });
  });
  return { items, recipientPersonId, selectionKeys: [...wanted] };
}

module.exports = {
  buildSelectionKey,
  computeDaysPassed,
  formatDaysPassedLabel,
  enrichSessionFromFinding,
  buildRunPresentationTree,
  resolveSelectedItems
};
