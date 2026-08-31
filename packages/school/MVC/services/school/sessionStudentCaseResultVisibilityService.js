'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function cleanString(value = '', max = 3000) {
  const out = String(value ?? '').replace(/\0/g, '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const token = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(token);
}

function normalizeCaseStatus(value = '') {
  return cleanString(value, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'open';
}

function getViewerUserId(reqUser = null) {
  return toPublicId(reqUser?.id || reqUser?._id || reqUser?.userId || reqUser?.username || '');
}

function getCreatorUserId(caseRow = {}) {
  return toPublicId(caseRow?.audit?.createdBy || caseRow?.createdBy || '');
}

function isCaseCreator(caseRow = {}, reqUser = null) {
  const creatorId = getCreatorUserId(caseRow);
  const viewerId = getViewerUserId(reqUser);
  return Boolean(creatorId && viewerId && idsEqual(creatorId, viewerId));
}

function isClosedCaseStatus(status = '') {
  return ['resolved', 'cancelled'].includes(normalizeCaseStatus(status));
}

function isLockedClosedCase(caseRow = {}) {
  return caseRow?.locked === true && isClosedCaseStatus(caseRow?.status);
}

function canManageResultFields(capabilities = {}) {
  return capabilities?.canResolve === true;
}

function canManageLockedField(capabilities = {}) {
  return capabilities?.canResolve === true;
}

function canEditCase(caseRow = {}, capabilities = {}) {
  if (isLockedClosedCase(caseRow)) return capabilities?.canResolve === true;
  return capabilities?.canUpdate === true || capabilities?.canEdit === true;
}

function canDeleteCase(caseRow = {}, capabilities = {}) {
  if (isLockedClosedCase(caseRow)) return capabilities?.canResolve === true;
  return capabilities?.canDelete === true;
}

function canReopenCase(caseRow = {}, capabilities = {}) {
  if (!isClosedCaseStatus(caseRow?.status)) return false;
  if (isLockedClosedCase(caseRow)) return capabilities?.canResolve === true;
  return capabilities?.canUpdate === true || capabilities?.canEdit === true;
}

function canViewResultNote(caseRow = {}, reqUser = null, capabilities = {}) {
  if (canManageResultFields(capabilities)) return true;
  if (!cleanString(caseRow?.resultNote, 3000)) return false;
  return isCaseCreator(caseRow, reqUser) && caseRow?.revealResultToCreator === true;
}

function redactCaseForViewer(caseRow = {}, { reqUser = null, capabilities = {} } = {}) {
  if (!caseRow || typeof caseRow !== 'object') return caseRow;
  const output = { ...caseRow };
  const canView = canViewResultNote(output, reqUser, capabilities);
  const canManage = canManageResultFields(capabilities);

  if (!canView) {
    delete output.resultNote;
  }
  if (!canManage) {
    delete output.revealResultToCreator;
  }
  return output;
}

function applyResultFieldsForSave({
  input = {},
  existing = null,
  canManageResultFields: canManage = false,
  nextStatus = ''
} = {}) {
  const status = normalizeCaseStatus(nextStatus || input?.status || existing?.status || 'open');
  const reopening = status === 'reopened' && isClosedCaseStatus(existing?.status);
  const base = !canManage
    ? {
      resultNote: cleanString(existing?.resultNote, 3000),
      revealResultToCreator: existing?.revealResultToCreator === true,
      locked: reopening ? false : (existing?.locked === true)
    }
    : (() => {
      const hasResultNote = Object.prototype.hasOwnProperty.call(input || {}, 'resultNote');
      const hasRevealFlag = Object.prototype.hasOwnProperty.call(input || {}, 'revealResultToCreator');
      const hasLocked = Object.prototype.hasOwnProperty.call(input || {}, 'locked');
      return {
        resultNote: hasResultNote
          ? cleanString(input.resultNote, 3000)
          : cleanString(existing?.resultNote, 3000),
        revealResultToCreator: hasRevealFlag
          ? normalizeBoolean(input.revealResultToCreator)
          : (existing?.revealResultToCreator === true),
        locked: reopening
          ? false
          : (hasLocked ? normalizeBoolean(input.locked) : (existing?.locked === true))
      };
    })();

  if (status === 'resolved' || status === 'cancelled') {
    if (!canManage && !Object.prototype.hasOwnProperty.call(input || {}, 'locked')) {
      base.locked = existing?.locked === true;
    }
  } else if (!isClosedCaseStatus(status)) {
    base.locked = false;
  }

  return base;
}

function assertCaseMutationAllowed(existing = null, capabilities = {}, { action = 'edit' } = {}) {
  if (!existing || !isLockedClosedCase(existing)) return;
  if (capabilities?.canResolve === true) return;
  const messages = {
    edit: 'This resolved case is locked. Only users with resolve access can modify it.',
    delete: 'This resolved case is locked. Only users with resolve access can delete it.',
    reopen: 'This resolved case is locked. Only users with resolve access can reopen it.'
  };
  const error = new Error(messages[action] || messages.edit);
  error.statusCode = 403;
  throw error;
}

function enrichCapabilities(caseRow = {}, reqUser = null, capabilities = {}) {
  return {
    ...capabilities,
    canViewResultNote: canViewResultNote(caseRow, reqUser, capabilities),
    canManageLockedField: canManageLockedField(capabilities),
    canEditCase: canEditCase(caseRow, capabilities),
    canDeleteCase: canDeleteCase(caseRow, capabilities),
    canReopenCase: canReopenCase(caseRow, capabilities)
  };
}

module.exports = {
  canManageResultFields,
  canManageLockedField,
  canViewResultNote,
  canEditCase,
  canDeleteCase,
  canReopenCase,
  isClosedCaseStatus,
  isLockedClosedCase,
  isCaseCreator,
  redactCaseForViewer,
  applyResultFieldsForSave,
  assertCaseMutationAllowed,
  enrichCapabilities
};
