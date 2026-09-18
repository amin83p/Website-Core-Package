'use strict';

const schoolRecordAccessService = require('./schoolRecordAccessService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const notificationCenterOperationPolicyService = require('./notificationCenterOperationPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');

const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function cleanText(value) {
  return String(value || '').trim();
}

function getViewerPersonId(user) {
  return cleanText(toPublicId(user?.personId || user?.person?.id || user?.id));
}

function isOrgWideReadAll(access = {}) {
  if (access?.isAdminViewer) return true;
  const mode = notificationCenterOperationPolicyService.normalizeScopeMode(access?.readAllScopeId);
  return mode === 'organization' || mode === 'admin' || mode === 'global';
}

function isOwnerReadAll(access = {}) {
  return notificationCenterOperationPolicyService.normalizeScopeMode(access?.readAllScopeId) === 'owner';
}

function isAssignmentReadAll(access = {}) {
  const mode = notificationCenterOperationPolicyService.normalizeScopeMode(access?.readAllScopeId);
  return mode === 'department' || mode === 'division';
}

function isFindingVisibleToOwner(item = {}, batch = {}, personId = '') {
  if (!personId) return false;
  if (cleanText(batch.recipientPersonId) === personId) return true;
  const recipientIds = Array.isArray(item.recipientPersonIds) ? item.recipientPersonIds : [];
  if (recipientIds.some((id) => cleanText(toPublicId(id)) === personId)) return true;
  const session = item?.payload?.session;
  if (session && sessionDeliveryTeamService.isPersonSessionEditor(session, personId)) return true;
  return false;
}

function isFindingVisibleToAssignment(item = {}, listAccess = {}) {
  const classData = item?.payload?.classData;
  const session = item?.payload?.session;
  if (!classData && !session) {
    return false;
  }
  if (classData && !schoolRecordAccessService.isClassAccessible(classData, listAccess)) {
    return false;
  }
  if (session) {
    return schoolRecordAccessService.isSessionAccessible({
      classRow: classData,
      session,
      access: listAccess,
      context: 'list'
    });
  }
  return schoolRecordAccessService.isClassAccessible(classData, listAccess);
}

function filterBatchForViewer(batch = {}, user, access = {}) {
  if (!batch || typeof batch !== 'object') return null;
  if (isOrgWideReadAll(access)) return batch;

  const personId = getViewerPersonId(user);
  const listAccess = schoolRecordAccessService.resolveAccessFromUser(user);
  const items = (Array.isArray(batch.items) ? batch.items : []).filter((item) => {
    if (isOwnerReadAll(access)) {
      return isFindingVisibleToOwner(item, batch, personId);
    }
    if (isAssignmentReadAll(access)) {
      return isFindingVisibleToAssignment(item, listAccess);
    }
    return false;
  });

  if (!items.length) return null;
  return {
    ...batch,
    items,
    itemCount: items.length
  };
}

function filterRunForViewer(run = {}, user, access = {}) {
  if (!run || typeof run !== 'object') return run;
  if (isOrgWideReadAll(access)) return run;
  const batches = (Array.isArray(run.batches) ? run.batches : [])
    .map((batch) => filterBatchForViewer(batch, user, access))
    .filter(Boolean);
  return {
    ...run,
    batches,
    batchCount: batches.length
  };
}

function filterRunsForViewer(runs = [], user, access = {}) {
  return (Array.isArray(runs) ? runs : [])
    .map((run) => filterRunForViewer(run, user, access))
    .filter((run) => isOrgWideReadAll(access) || (Array.isArray(run.batches) && run.batches.length > 0));
}

module.exports = {
  filterRunForViewer,
  filterRunsForViewer,
  isOrgWideReadAll
};
