'use strict';

const schoolAdminAccessService = require('./schoolAdminAccessService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const KNOWN_SCOPE_MODE_BY_ID = Object.freeze({
  SCP_ADMIN: 'admin',
  SCP_ORG: 'organization',
  SCP_DEPT: 'department',
  SCP_DIV: 'division',
  SCP_OWNER: 'owner',
  SCP_USER: 'user'
});

const KNOWN_SCOPE_MODE_BY_NAME = Object.freeze({
  ADMIN: 'admin',
  ORGANIZATION: 'organization',
  ORG: 'organization',
  DEPARTMENT: 'department',
  DEPT: 'department',
  DIVISION: 'division',
  DIV: 'division',
  OWNER: 'owner',
  USER: 'user',
  GLOBAL: 'global'
});

const ROLLUP_READ_ALL_SCOPES = Object.freeze(['department', 'division', 'organization', 'admin', 'global']);
const CHANGE_HISTORY_READ_ALL_SCOPES = Object.freeze(['organization', 'admin', 'global']);
const EXPORT_PRINT_SCOPES = Object.freeze(['department', 'division', 'organization', 'admin', 'global']);
const UPLOAD_SCOPES = Object.freeze(['department', 'division', 'organization', 'admin', 'global']);
const EXCUSE_UPDATE_SCOPES = Object.freeze(['organization', 'admin', 'global']);

const OWNER_DATE_WINDOW_MONTHS = 3;
const DEPT_DATE_WINDOW_MONTHS = 12;

const EMPTY_ACCESS_FLAGS = Object.freeze({
  canOpenMatrix: false,
  canViewRosterFields: false,
  canEditRoster: false,
  canUploadFiles: false,
  canExportExcel: false,
  canPrintMatrix: false,
  canViewRollups: false,
  canViewChangeHistory: false,
  canDeleteFiles: false,
  canMarkExcused: false,
  canOverrideSessionLock: false,
  isAttendanceAdminViewer: false,
  readScopeId: null,
  readAllScopeId: null,
  updateScopeId: null,
  uploadScopeId: null,
  exportScopeId: null,
  printScopeId: null,
  deleteScopeId: null
});

function normalizeScopeMode(scopeId = '') {
  const token = String(scopeId || '').trim();
  if (!token) return '';
  const known = KNOWN_SCOPE_MODE_BY_ID[token] || KNOWN_SCOPE_MODE_BY_NAME[token.toUpperCase()];
  if (known) return known;
  const upper = token.toUpperCase();
  if (upper.includes('ADMIN')) return 'admin';
  if (upper.includes('ORG')) return 'organization';
  if (upper.includes('DEPT')) return 'department';
  if (upper.includes('DIV')) return 'division';
  if (upper.includes('OWNER')) return 'owner';
  if (upper.includes('USER')) return 'user';
  return '';
}

function scopeInList(scopeId, allowedModes = []) {
  const mode = normalizeScopeMode(scopeId);
  return Boolean(mode && allowedModes.includes(mode));
}

function isUserScope(scopeId) {
  return normalizeScopeMode(scopeId) === 'user';
}

function buildAttendanceOrgContext(user) {
  return {
    orgId: user?.activeOrgId || null,
    section: { id: SECTIONS.SCHOOL_ATTENDANCES, category: 'SCHOOL' }
  };
}

async function isAttendanceAdminBypass(user, operationId) {
  if (!user) return false;
  return schoolAdminAccessService.isAttendancesAdminViewerAsync(user, operationId);
}

async function applyOperationPolicy({
  user,
  operationId,
  evaluation = {},
  sectionId = SECTIONS.SCHOOL_ATTENDANCES
} = {}) {
  const normalizedOperationId = String(operationId || '').trim();
  const evalSectionId = String(sectionId || SECTIONS.SCHOOL_ATTENDANCES).trim();

  if (evalSectionId === SECTIONS.SCHOOL_ATTENDANCES
    && await isAttendanceAdminBypass(user, normalizedOperationId)) {
    return {
      allowed: true,
      operationId: normalizedOperationId,
      evaluation,
      scopeId: evaluation.scopeId || null,
      adminBypass: true,
      sectionId: evalSectionId
    };
  }

  if (evalSectionId === SECTIONS.SCHOOL_ATTENDANCE_REPORT
    && await schoolAdminAccessService.isAdminForRequestAsync(
      user,
      SECTIONS.SCHOOL_ATTENDANCE_REPORT,
      normalizedOperationId
    )) {
    return {
      allowed: true,
      operationId: normalizedOperationId,
      evaluation,
      scopeId: evaluation.scopeId || null,
      adminBypass: true,
      sectionId: evalSectionId
    };
  }

  if (!evaluation?.allowed) {
    return {
      allowed: false,
      operationId: normalizedOperationId,
      evaluation,
      reason: evaluation?.reason || 'Insufficient attendance permissions.',
      sectionId: evalSectionId
    };
  }

  if (isUserScope(evaluation.scopeId)) {
    return {
      allowed: false,
      operationId: normalizedOperationId,
      evaluation,
      reason: `${normalizedOperationId} access is not available at USER scope.`,
      sectionId: evalSectionId
    };
  }

  return {
    allowed: true,
    operationId: normalizedOperationId,
    evaluation,
    scopeId: evaluation.scopeId || null,
    adminBypass: false,
    sectionId: evalSectionId
  };
}

function canViewRollupsAtScope(scopeId) {
  return scopeInList(scopeId, ROLLUP_READ_ALL_SCOPES);
}

function canViewChangeHistoryAtScope(scopeId) {
  return scopeInList(scopeId, CHANGE_HISTORY_READ_ALL_SCOPES);
}

function canExportOrPrintAtScope(scopeId) {
  return scopeInList(scopeId, EXPORT_PRINT_SCOPES);
}

function canUploadAtScope(scopeId) {
  return scopeInList(scopeId, UPLOAD_SCOPES);
}

function canMarkExcusedAtScope(scopeId) {
  return scopeInList(scopeId, EXCUSE_UPDATE_SCOPES);
}

function addMonthsToDate(anchorDate, months) {
  const base = anchorDate instanceof Date ? new Date(anchorDate.getTime()) : new Date(String(anchorDate || ''));
  if (Number.isNaN(base.getTime())) return null;
  const copy = new Date(base.getTime());
  copy.setMonth(copy.getMonth() - Math.max(0, Number(months) || 0));
  return copy.toISOString().slice(0, 10);
}

function resolveAttendanceDateWindow(scopeId, anchorDate = new Date()) {
  const mode = normalizeScopeMode(scopeId);
  if (mode === 'owner') {
    return {
      startDate: addMonthsToDate(anchorDate, OWNER_DATE_WINDOW_MONTHS),
      endDate: null,
      months: OWNER_DATE_WINDOW_MONTHS
    };
  }
  if (['department', 'division', 'organization', 'admin', 'global'].includes(mode)) {
    return {
      startDate: addMonthsToDate(anchorDate, DEPT_DATE_WINDOW_MONTHS),
      endDate: null,
      months: DEPT_DATE_WINDOW_MONTHS
    };
  }
  return { startDate: null, endDate: null, months: null };
}

function clampDateWindow(requestedStart, requestedEnd, policyWindow = {}) {
  const start = String(requestedStart || '').trim();
  const end = String(requestedEnd || '').trim();
  const minStart = String(policyWindow.startDate || '').trim();
  if (!minStart) {
    return { startDate: start, endDate: end };
  }
  let clampedStart = start;
  if (!clampedStart || clampedStart < minStart) clampedStart = minStart;
  return { startDate: clampedStart, endDate: end };
}

function stripAttendanceRecordFields(record = {}, visibility = {}) {
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };
  if (!visibility.showStudentNote) {
    delete out.rosterStudentNotes;
    delete out.teacherNotes;
  }
  if (!visibility.showExcuseRef) delete out.excuseRef;
  if (!visibility.showExcuseAttachment) delete out.excuseAttachment;
  if (!visibility.showAdminDiscussion) delete out.comments;
  if (!visibility.showAttachedFiles) delete out.attachedFiles;
  if (!visibility.showExcuseMarks) {
    delete out.lateExcused;
    delete out.earlyLeaveExcused;
    delete out.absenceExcused;
  }
  if (!visibility.showChangeHistory) delete out.changeHistory;
  return out;
}

function resolveFieldVisibility({ readAllScopeId, updateScopeId, adminBypass = false } = {}) {
  if (adminBypass) {
    return {
      showStudentNames: true,
      showStatuses: true,
      showLateEarly: true,
      showStudentNote: true,
      showExcuseRef: true,
      showExcuseAttachment: true,
      showAdminDiscussion: true,
      showAttachedFiles: true,
      showExcuseMarks: true,
      showChangeHistory: true
    };
  }

  const readAllMode = normalizeScopeMode(readAllScopeId);
  const updateMode = normalizeScopeMode(updateScopeId);
  const effectiveMode = readAllMode || updateMode;

  return {
    showStudentNames: Boolean(effectiveMode && effectiveMode !== 'user'),
    showStatuses: Boolean(effectiveMode && effectiveMode !== 'user'),
    showLateEarly: Boolean(effectiveMode && effectiveMode !== 'user'),
    showStudentNote: Boolean(effectiveMode && effectiveMode !== 'user'),
    showExcuseRef: scopeInList(readAllScopeId, ['department', 'division', 'organization', 'admin', 'global']),
    showExcuseAttachment: scopeInList(readAllScopeId, ['department', 'division', 'organization', 'admin', 'global']),
    showAdminDiscussion: scopeInList(readAllScopeId, ['department', 'division', 'organization', 'admin', 'global']),
    showAttachedFiles: scopeInList(readAllScopeId, ['department', 'division', 'organization', 'admin', 'global']),
    showExcuseMarks: scopeInList(readAllScopeId, ['department', 'division', 'organization', 'admin', 'global']),
    showChangeHistory: canViewChangeHistoryAtScope(readAllScopeId)
  };
}

function filterMatrixPayloadForScope(payload = {}, flags = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const visibility = resolveFieldVisibility({
    readAllScopeId: flags.readAllScopeId,
    updateScopeId: flags.updateScopeId,
    adminBypass: flags.isAttendanceAdminViewer === true
  });
  const next = { ...payload };
  if (Array.isArray(next.matrix)) {
    next.matrix = next.matrix.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const records = Array.isArray(row.records)
        ? row.records.map((record) => stripAttendanceRecordFields(record, visibility))
        : row.records;
      return { ...row, records };
    });
  }
  next.fieldVisibility = visibility;
  return next;
}

function deriveAccessFlags(evaluations = {}, adminFlags = {}) {
  const read = evaluations.read || {};
  const readAll = evaluations.readAll || {};
  const update = evaluations.update || {};
  const del = evaluations.del || {};
  const upload = evaluations.upload || {};
  const exportEval = evaluations.export || {};
  const printEval = evaluations.print || {};

  const readAllAllowed = Boolean(adminFlags.readAll || readAll.allowed);
  const updateAllowed = Boolean(adminFlags.update || update.allowed);
  const readAllowed = Boolean(adminFlags.read || read.allowed);

  const canOpenMatrix = Boolean(adminFlags.read || readAllowed);
  const canViewRosterFields = Boolean(
    adminFlags.readAll
    || (readAllAllowed && !isUserScope(readAll.scopeId))
  );
  const canEditRoster = Boolean(
    adminFlags.update
    || (updateAllowed && !isUserScope(update.scopeId))
  );
  const canUploadFiles = Boolean(
    adminFlags.upload
    || (upload.allowed && canUploadAtScope(upload.scopeId))
  );
  const canExportExcel = Boolean(
    adminFlags.export
    || (exportEval.allowed && canExportOrPrintAtScope(exportEval.scopeId))
  );
  const canPrintMatrix = Boolean(
    adminFlags.print
    || (printEval.allowed && canExportOrPrintAtScope(printEval.scopeId))
  );
  const canViewRollups = Boolean(
    adminFlags.readAll
    || (readAllAllowed && canViewRollupsAtScope(readAll.scopeId))
  );
  const canViewChangeHistory = Boolean(
    adminFlags.readAll
    || (readAllAllowed && canViewChangeHistoryAtScope(readAll.scopeId))
  );
  const canDeleteFiles = Boolean(
    adminFlags.delete
    || (del.allowed && !isUserScope(del.scopeId) && normalizeScopeMode(del.scopeId) !== 'owner')
  );
  const canMarkExcused = Boolean(
    adminFlags.update
    || (updateAllowed && canMarkExcusedAtScope(update.scopeId))
  );
  const canOverrideSessionLock = Boolean(
    adminFlags.update
    || (updateAllowed && normalizeScopeMode(update.scopeId) === 'admin')
  );
  const isAttendanceAdminViewer = Boolean(
    adminFlags.readAll || adminFlags.update || adminFlags.read
  );

  return {
    canOpenMatrix,
    canViewRosterFields,
    canEditRoster,
    canUploadFiles,
    canExportExcel,
    canPrintMatrix,
    canViewRollups,
    canViewChangeHistory,
    canDeleteFiles,
    canMarkExcused,
    canOverrideSessionLock,
    isAttendanceAdminViewer,
    readScopeId: read.scopeId || null,
    readAllScopeId: readAll.scopeId || null,
    updateScopeId: update.scopeId || null,
    uploadScopeId: upload.scopeId || null,
    exportScopeId: exportEval.scopeId || null,
    printScopeId: printEval.scopeId || null,
    deleteScopeId: del.scopeId || null
  };
}

module.exports = {
  EMPTY_ACCESS_FLAGS,
  ROLLUP_READ_ALL_SCOPES,
  applyOperationPolicy,
  deriveAccessFlags,
  normalizeScopeMode,
  canViewRollupsAtScope,
  canViewChangeHistoryAtScope,
  canExportOrPrintAtScope,
  canUploadAtScope,
  canMarkExcusedAtScope,
  resolveAttendanceDateWindow,
  clampDateWindow,
  resolveFieldVisibility,
  filterMatrixPayloadForScope,
  stripAttendanceRecordFields,
  isAttendanceAdminBypass,
  buildAttendanceOrgContext
};
