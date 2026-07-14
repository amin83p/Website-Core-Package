/**
 * Central deletion guard for school package entities.
 */
function getSchoolDataService() {
  return require('./schoolDataService');
}

const {
  getEntityDefinition,
  scanEntityReferences,
  recordLabel
} = require('./schoolDeletionRuleRegistry');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');

const DELETE_BLOCKED_CODE = 'DELETE_BLOCKED';

class DeleteBlockedError extends Error {
  constructor(preview = {}, message = '') {
    super(message || buildPreviewMessage(preview));
    this.name = 'DeleteBlockedError';
    this.code = DELETE_BLOCKED_CODE;
    this.preview = preview;
  }
}

function buildPreviewMessage(preview = {}) {
  const label = String(preview?.label || preview?.entityKey || 'This record').trim();
  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  if (!blockers.length) {
    return `Cannot delete ${label} because related records exist.`;
  }
  const summary = `Cannot delete ${label}. ${blockers.length} blocking reference group${blockers.length === 1 ? '' : 's'}.`;
  const lines = blockers.map((blocker, index) => {
    const blockerLabel = String(blocker.label || blocker.code || 'Reference').trim();
    const count = Number(blocker.count || 0);
    const hint = blocker.resolveHint ? ` — ${blocker.resolveHint}` : '';
    return `${index + 1}. ${blockerLabel}: ${count} reference${count === 1 ? '' : 's'}${hint}`;
  });
  return [summary, ...lines].join('\n');
}

function buildRecordLabel(record = {}, def = {}, fallbackId = '') {
  const fields = Array.isArray(def?.labelFields) ? def.labelFields : ['name', 'title', 'code'];
  for (const field of fields) {
    const value = String(record?.[field] || '').trim();
    if (value) return value;
  }
  return recordLabel(record, fallbackId);
}

function resolveDeletePolicy(def = {}, blockers = []) {
  if (def.deleteMode === 'immutable') return 'immutable';
  if (def.deleteMode === 'archive_only') return 'archive_only';
  if (def.deleteMode === 'purge_only') return 'purge_only';
  if (def.deleteMode === 'void') return 'void';
  const hasImmutableChild = blockers.some((row) => row.childPolicy === 'immutable_child');
  if (hasImmutableChild) return 'blocked_immutable_children';
  return 'deletable';
}

async function loadTargetRecord({ entityKey, id, reqUser, context = {} }) {
  const def = getEntityDefinition(entityKey);
  if (!def) return { def: null, record: null };

  if (entityKey === 'session') {
    const classId = toPublicId(context?.classId);
    const sessionId = toPublicId(id);
    if (!classId || !sessionId) return { def, record: null };
    const sessions = await getSchoolDataService().getClassSessions(classId, reqUser);
    const session = (Array.isArray(sessions) ? sessions : []).find((row) =>
      toPublicId(row?.sessionId || row?.id) === sessionId
    );
    return { def, record: session || null };
  }

  if (!def.repositoryKey) return { def, record: null };
  const record = await getSchoolDataService().getDataById(def.repositoryKey, id, reqUser);
  return { def, record };
}

async function previewDelete({ entityKey, id, orgId, reqUser, context = {}, warnings = [] }) {
  const normalizedKey = String(entityKey || '').trim();
  const normalizedId = toPublicId(id);
  const { def, record } = await loadTargetRecord({
    entityKey: normalizedKey,
    id: normalizedId,
    reqUser,
    context
  });

  if (!def) {
    throw new Error(`Unknown deletion entity key: ${normalizedKey}`);
  }

  if (def.repositoryKey && !record && normalizedKey !== 'session') {
    throw new Error('Record not found.');
  }

  if (normalizedKey === 'session' && !record) {
    throw new Error('Session not found.');
  }

  const blockers = await scanEntityReferences({
    entityKey: normalizedKey,
    id: normalizedId,
    orgId,
    reqUser,
    context,
    record
  });

  const preview = {
    canDelete: blockers.length === 0,
    entityKey: normalizedKey,
    id: normalizedId,
    label: buildRecordLabel(record || {}, def, normalizedId),
    policy: resolveDeletePolicy(def, blockers),
    blockers,
    warnings: Array.isArray(warnings) ? warnings : [],
    actions: []
  };

  if (preview.policy === 'immutable') {
    preview.canDelete = false;
    preview.actions.push({
      code: 'NOT_DELETABLE',
      label: 'This record type cannot be deleted',
      href: ''
    });
  }

  if (normalizedKey === 'class' && blockers.length) {
    preview.actions.push({
      code: 'OPEN_STORAGE_INTEGRITY',
      label: 'Open Class Storage & Integrity',
      href: '/school/classes/storage-integrity'
    });
  }

  return preview;
}

async function assertCanDelete(params) {
  const preview = await previewDelete(params);
  if (!preview.canDelete) {
    throw new DeleteBlockedError(preview);
  }
  return preview;
}

async function executeDelete({
  entityKey,
  id,
  orgId,
  reqUser,
  context = {},
  options = {},
  warnings = []
}) {
  const preview = await assertCanDelete({
    entityKey,
    id,
    orgId,
    reqUser,
    context,
    warnings
  });

  const def = getEntityDefinition(entityKey);
  if (!def?.repositoryKey) {
    throw new Error(`Delete execution is not supported for entity key: ${entityKey}`);
  }

  const result = await getSchoolDataService().deleteData(def.repositoryKey, id, reqUser, {
    ...options,
    skipDeletionGuard: true
  });

  if (typeof options.onAfterDelete === 'function') {
    const hookResult = await options.onAfterDelete({ preview, result });
    return { preview, result, hookResult };
  }

  return { preview, result };
}

function isDeleteBlockedError(error) {
  return Boolean(error && (error instanceof DeleteBlockedError || error.code === DELETE_BLOCKED_CODE));
}

function buildDeleteBlockedPayload(preview = {}) {
  return {
    status: 'error',
    code: DELETE_BLOCKED_CODE,
    message: buildPreviewMessage(preview),
    preview,
    details: preview,
    data: preview
  };
}

function respondDeleteBlocked(req, res, preview, { statusCode = 409 } = {}) {
  const payload = buildDeleteBlockedPayload(preview);
  if (isAjax(req)) {
    return res.status(statusCode).json(payload);
  }
  return res.status(statusCode).render('error', {
    title: 'Delete blocked',
    statusCode,
    code: payload.code,
    error: new Error(payload.message),
    message: payload.message,
    details: preview,
    preview,
    user: req.user
  });
}

function handleDeleteError(req, res, error, { fallbackStatus = 400 } = {}) {
  if (isDeleteBlockedError(error)) {
    return respondDeleteBlocked(req, res, error.preview);
  }
  const message = String(error?.message || 'Delete failed.');
  if (isAjax(req)) {
    return res.status(fallbackStatus).json({ status: 'error', message });
  }
  return res.status(fallbackStatus).render('error', {
    title: 'Error',
    message,
    error,
    user: req.user
  });
}

module.exports = {
  DELETE_BLOCKED_CODE,
  DeleteBlockedError,
  previewDelete,
  assertCanDelete,
  executeDelete,
  isDeleteBlockedError,
  buildDeleteBlockedPayload,
  buildPreviewMessage,
  respondDeleteBlocked,
  handleDeleteError
};
