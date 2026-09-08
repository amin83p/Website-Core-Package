'use strict';

const activityService = require('./activityService');
const activityEntryIdService = require('./activityEntryIdService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const timesheetPayrollContextService = require('./timesheetPayrollContextService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function cleanId(value) {
  return String(value ?? '').trim();
}

function normalizePayrollRole(value) {
  return timesheetPayrollContextService.normalizePayrollRole(value);
}

function buildAssigneeRoleFields(role) {
  const normalized = normalizePayrollRole(role) || 'teacher';
  return { role: normalized, roles: [normalized] };
}

function buildImportRowNotes(row = {}) {
  const commentParts = [];
  if (row?.comment) commentParts.push(String(row.comment).trim());
  if (row?.studentName) commentParts.push(`Student: ${String(row.studentName).trim()}`);
  if (row?.optionalHours != null && Number.isFinite(Number(row.optionalHours))) {
    commentParts.push(`Optional hours: ${Number(row.optionalHours)}`);
  }
  return commentParts.filter(Boolean).join(' | ');
}

function stackCompiledRowsByDate(compiledRows = []) {
  const rows = (Array.isArray(compiledRows) ? compiledRows : [])
    .map((row) => ({
      ...row,
      date: cleanId(row?.date),
      hours: Number(parseFloat(row?.hours) || 0)
    }))
    .filter((row) => row.date && Number.isFinite(row.hours) && row.hours > 0);

  const dayStackCursor = new Map();
  return rows.map((row) => {
    const dayKey = row.date;
    const startTime = dayStackCursor.has(dayKey)
      ? dayStackCursor.get(dayKey)
      : '00:00';
    const endTime = sessionStatusPolicyService.addMinutesToClockTime(startTime, row.hours * 60) || startTime;
    dayStackCursor.set(dayKey, endTime);
    return {
      ...row,
      startTime,
      endTime,
      durationHours: Number(row.hours.toFixed(2))
    };
  });
}

function buildCompletedAssignee({
  activity = {},
  personId = '',
  personName = '',
  personRole = '',
  hours = 0,
  notes = '',
  importTrace = {}
}) {
  const evaluationType = activityService.normalizeEvaluationType(activity.evaluationType);
  const paid = activity.paid === true;
  const safeHours = Number(Number(hours || 0).toFixed(2));
  const roleFields = buildAssigneeRoleFields(personRole);
  const nowIso = new Date().toISOString();
  const base = {
    personId: cleanId(personId),
    personName: String(personName || personId || '').trim(),
    paid,
    paidHours: paid ? safeHours : 0,
    notes: String(notes || '').trim(),
    ...roleFields,
    ...importTrace
  };
  if (evaluationType === 'completion') {
    return {
      ...base,
      status: paid ? 'attended' : 'attended',
      completionStatus: 'completed',
      completedAt: nowIso,
      completedBy: cleanId(personId)
    };
  }
  return {
    ...base,
    status: 'attended',
    completionStatus: 'pending'
  };
}

function buildImportWorkSessionEntryDrafts({
  compiledRows = [],
  activity = {},
  personId = '',
  personName = '',
  personRole = '',
  periodId = '',
  batchId = '',
  sourceFileName = ''
}) {
  const targetPersonId = cleanId(personId);
  const targetPeriodId = cleanId(periodId);
  const importTrace = {
    legacyImportBatchId: cleanId(batchId),
    legacyImportSourceFileName: String(sourceFileName || '').trim(),
    legacyImportPeriodId: targetPeriodId,
    legacyImportPersonId: targetPersonId
  };

  return stackCompiledRowsByDate(compiledRows).map((row, index) => {
    const title = String(row?.className || '').trim();
    const notes = buildImportRowNotes(row);
    return {
      title,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      durationHours: row.durationHours,
      status: 'posted',
      notes,
      assignees: [buildCompletedAssignee({
        activity,
        personId: targetPersonId,
        personName,
        personRole,
        hours: row.durationHours,
        notes,
        importTrace
      })],
      excludedPersonIds: [],
      ...importTrace,
      legacyImportRowIndex: index + 1
    };
  });
}

function assignImportEntryIds(activityId, existingEntries = [], drafts = []) {
  const sequences = (Array.isArray(existingEntries) ? existingEntries : [])
    .map((row) => activityEntryIdService.parseEntryId(row?.entryId))
    .filter(Boolean)
    .map((parsed) => Number(parsed.sequence || 0))
    .filter((value) => Number.isFinite(value));
  let nextSequence = sequences.length ? Math.max(...sequences) : 0;
  return (Array.isArray(drafts) ? drafts : []).map((draft) => {
    nextSequence += 1;
    return {
      ...draft,
      entryId: activityEntryIdService.buildEntryId(activityId, nextSequence)
    };
  });
}

async function createImportWorkSessions({
  orgId,
  activity,
  compiledRows = [],
  personId,
  personName = '',
  personRole = '',
  periodId = '',
  batchId = '',
  sourceFileName = '',
  reqUser
}) {
  const targetPersonId = cleanId(personId);
  if (!targetPersonId) throw new Error('Person is required to create import work sessions.');
  if (!activity || !cleanId(activity.id)) throw new Error('Import activity is required.');
  if (!idsEqual(activity.orgId, orgId)) throw new Error('Import activity is not in the active organization.');
  if (!activityService.isPersonEligibleForActivity(activity, targetPersonId)) {
    throw new Error('The import person is not eligible for the configured import activity.');
  }

  const drafts = buildImportWorkSessionEntryDrafts({
    compiledRows,
    activity,
    personId: targetPersonId,
    personName,
    personRole,
    periodId,
    batchId,
    sourceFileName
  });
  if (!drafts.length) {
    throw new Error('No import rows were available to create work sessions.');
  }

  const existingEntries = activityService.getActivityEntries(activity);
  const entriesWithIds = assignImportEntryIds(activity.id, existingEntries, drafts);

  const saved = await activityService.saveActivity({
    ...activity,
    entries: [...existingEntries, ...entriesWithIds]
  }, reqUser);

  const createdEntryIds = entriesWithIds.map((row) => cleanId(row.entryId)).filter(Boolean);
  return {
    activityId: cleanId(activity.id),
    batchId: cleanId(batchId),
    createdEntryIds,
    rowCount: createdEntryIds.length,
    activity: saved
  };
}

async function removeImportWorkSessionsByBatchId({ activityId, batchId, reqUser }) {
  const targetActivityId = cleanId(activityId);
  const targetBatchId = cleanId(batchId);
  if (!targetActivityId || !targetBatchId) {
    return { removedEntries: 0, removedAssignees: 0 };
  }

  const activity = await activityService.getActivity(targetActivityId, reqUser);
  if (!activity) return { removedEntries: 0, removedAssignees: 0 };

  let removedEntries = 0;
  let removedAssignees = 0;
  const nextEntries = [];

  activityService.getActivityEntries(activity).forEach((entry) => {
    const entryBatchId = cleanId(entry?.legacyImportBatchId);
    if (entryBatchId && idsEqual(entryBatchId, targetBatchId)) {
      removedEntries += 1;
      return;
    }
    const assignees = Array.isArray(entry.assignees) ? entry.assignees : [];
    const keptAssignees = assignees.filter((assignee) => {
      const assigneeBatchId = cleanId(assignee?.legacyImportBatchId);
      if (assigneeBatchId && idsEqual(assigneeBatchId, targetBatchId)) {
        removedAssignees += 1;
        return false;
      }
      return true;
    });
    if (!keptAssignees.length && assignees.length) {
      removedEntries += 1;
      return;
    }
    if (keptAssignees.length !== assignees.length) {
      nextEntries.push({ ...entry, assignees: keptAssignees });
      return;
    }
    nextEntries.push(entry);
  });

  if (!removedEntries && !removedAssignees) {
    return { removedEntries: 0, removedAssignees: 0 };
  }

  await activityService.saveActivity({
    ...activity,
    entries: nextEntries
  }, reqUser);

  return { removedEntries, removedAssignees };
}

function buildImportBatchId({ periodId = '', personId = '', sourceFileName = '' } = {}) {
  const token = `${cleanId(periodId)}-${cleanId(personId)}-${Date.now()}`;
  const fileToken = String(sourceFileName || 'import')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .slice(0, 24)
    .toLowerCase();
  return `legacyimp-batch-${fileToken}-${token}`;
}

module.exports = {
  stackCompiledRowsByDate,
  buildImportRowNotes,
  buildCompletedAssignee,
  buildImportWorkSessionEntryDrafts,
  createImportWorkSessions,
  removeImportWorkSessionsByBatchId,
  buildImportBatchId
};
