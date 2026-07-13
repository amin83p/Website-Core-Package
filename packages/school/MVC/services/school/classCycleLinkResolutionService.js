const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const LINK_TYPE_INCOMING_NEXT = 'incoming_next';
const LINK_TYPE_INCOMING_PREVIOUS = 'incoming_previous';

function resolveActor(requestingUser, fallback = 'system') {
  const candidate = String(
    requestingUser?.id ||
    requestingUser?.userId ||
    requestingUser?.personId ||
    requestingUser?.username ||
    requestingUser?.email ||
    fallback
  ).trim();
  return candidate || fallback;
}

function normalizeCycleNo(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildResolverHref(targetClassId, referringClassId = '', returnTo = 'delete') {
  const classDeletePreparationHrefs = require('./classDeletePreparationHrefs');
  return classDeletePreparationHrefs.buildDeletePreparationHref(targetClassId, referringClassId, returnTo);
}

function mapClassToLinkRow(classRow, linkType, fieldToClear) {
  const id = toPublicId(classRow?.id);
  return {
    linkType,
    fieldToClear,
    referencingClassId: id,
    referencingClassTitle: String(classRow?.title || classRow?.name || id || '').trim(),
    cycleNo: normalizeCycleNo(classRow?.cycleNo),
    cycleStartDate: String(classRow?.cycleStartDate || '').trim(),
    cycleEndDate: String(classRow?.cycleEndDate || '').trim(),
    registrationMode: String(classRow?.registrationMode || '').trim().toLowerCase()
  };
}

async function fetchClassesByField(field, targetId, reqUser) {
  const normalizedTargetId = toPublicId(targetId);
  if (!normalizedTargetId || !field) return [];
  const query = { page: 1, [`${field}__eq`]: normalizedTargetId };
  const rows = await schoolDataService.fetchData('classes', query, reqUser);
  return Array.isArray(rows) ? rows : [];
}

async function getTargetClassOrThrow(classId, reqUser) {
  const normalizedClassId = toPublicId(classId);
  if (!normalizedClassId) throw new Error('classId is required.');
  const classRow = await schoolDataService.getDataById('classes', normalizedClassId, reqUser);
  if (!classRow) throw new Error('Class not found or inaccessible.');
  return classRow;
}

async function collectCycleLinkBlockers(classId, reqUser) {
  const targetClass = await getTargetClassOrThrow(classId, reqUser);
  const normalizedClassId = toPublicId(targetClass.id);

  const [previousCyclesRaw, nextCyclesRaw] = await Promise.all([
    fetchClassesByField('nextClassId', normalizedClassId, reqUser),
    fetchClassesByField('previousClassId', normalizedClassId, reqUser)
  ]);

  const previousCycles = previousCyclesRaw.map((row) =>
    mapClassToLinkRow(row, LINK_TYPE_INCOMING_NEXT, 'nextClassId')
  );
  const nextCycles = nextCyclesRaw.map((row) =>
    mapClassToLinkRow(row, LINK_TYPE_INCOMING_PREVIOUS, 'previousClassId')
  );
  const links = [...previousCycles, ...nextCycles];

  return {
    targetClass: {
      id: normalizedClassId,
      title: String(targetClass?.title || targetClass?.name || normalizedClassId).trim(),
      cycleNo: normalizeCycleNo(targetClass?.cycleNo),
      cycleStartDate: String(targetClass?.cycleStartDate || '').trim(),
      cycleEndDate: String(targetClass?.cycleEndDate || '').trim(),
      registrationMode: String(targetClass?.registrationMode || '').trim().toLowerCase(),
      previousClassId: toPublicId(targetClass?.previousClassId),
      nextClassId: toPublicId(targetClass?.nextClassId)
    },
    previousCycles,
    nextCycles,
    links,
    blockerCount: links.length,
    resolverHref: buildResolverHref(normalizedClassId)
  };
}

async function clearReciprocalOnTarget(targetClass, referencingClassId, linkType, reqUser, options = {}) {
  const targetClassId = toPublicId(targetClass?.id);
  const referrerId = toPublicId(referencingClassId);
  if (!targetClassId || !referrerId) return null;

  const patch = {};
  if (linkType === LINK_TYPE_INCOMING_NEXT && idsEqual(targetClass?.previousClassId, referrerId)) {
    patch.previousClassId = '';
  }
  if (linkType === LINK_TYPE_INCOMING_PREVIOUS && idsEqual(targetClass?.nextClassId, referrerId)) {
    patch.nextClassId = '';
  }
  if (!Object.keys(patch).length) return null;

  patch.updatedBy = resolveActor(reqUser);
  return schoolDataService.updateData('classes', targetClassId, patch, reqUser, options);
}

async function unlinkCycleReference({
  targetClassId,
  referencingClassId,
  linkType,
  reqUser,
  options = {}
} = {}) {
  const normalizedTargetId = toPublicId(targetClassId);
  const normalizedReferrerId = toPublicId(referencingClassId);
  const normalizedLinkType = String(linkType || '').trim();

  if (!normalizedTargetId) throw new Error('targetClassId is required.');
  if (!normalizedReferrerId) throw new Error('referencingClassId is required.');
  if (![LINK_TYPE_INCOMING_NEXT, LINK_TYPE_INCOMING_PREVIOUS].includes(normalizedLinkType)) {
    throw new Error('linkType must be incoming_next or incoming_previous.');
  }

  const [targetClass, referencingClass] = await Promise.all([
    getTargetClassOrThrow(normalizedTargetId, reqUser),
    schoolDataService.getDataById('classes', normalizedReferrerId, reqUser)
  ]);
  if (!referencingClass) throw new Error('Referencing class not found or inaccessible.');
  if (!idsEqual(referencingClass?.orgId, targetClass?.orgId)) {
    throw new Error('Referencing class is outside the target class organization.');
  }

  const patch = { updatedBy: resolveActor(reqUser) };
  if (normalizedLinkType === LINK_TYPE_INCOMING_NEXT) {
    if (!idsEqual(referencingClass?.nextClassId, normalizedTargetId)) {
      throw new Error('This previous-cycle link no longer points at the target class.');
    }
    patch.nextClassId = '';
  } else {
    if (!idsEqual(referencingClass?.previousClassId, normalizedTargetId)) {
      throw new Error('This next-cycle link no longer points at the target class.');
    }
    patch.previousClassId = '';
  }

  const updatedReferencing = await schoolDataService.updateData(
    'classes',
    normalizedReferrerId,
    patch,
    reqUser,
    options
  );
  await clearReciprocalOnTarget(targetClass, normalizedReferrerId, normalizedLinkType, reqUser, options);

  const state = await collectCycleLinkBlockers(normalizedTargetId, reqUser);
  return {
    updatedReferencingClassId: normalizedReferrerId,
    updatedReferencing,
    ...state
  };
}

async function unlinkAllCycleReferences(targetClassId, reqUser, options = {}) {
  const snapshot = await collectCycleLinkBlockers(targetClassId, reqUser);
  const unlinked = [];
  const issues = [];

  for (const link of snapshot.links) {
    try {
      await unlinkCycleReference({
        targetClassId,
        referencingClassId: link.referencingClassId,
        linkType: link.linkType,
        reqUser,
        options
      });
      unlinked.push({
        referencingClassId: link.referencingClassId,
        linkType: link.linkType
      });
    } catch (error) {
      issues.push(`${link.referencingClassTitle || link.referencingClassId}: ${error.message}`);
    }
  }

  const state = await collectCycleLinkBlockers(targetClassId, reqUser);
  return {
    unlinked,
    issues,
    ...state
  };
}

/**
 * System-internal: clear inbound previousClassId / nextClassId pointers before class delete.
 * Previous cycles pointing at this class are unlinked automatically (no manual unlink step).
 */
async function clearInboundCycleReferencesForClassDelete(targetClassId, reqUser, options = {}) {
  const before = await collectCycleLinkBlockers(targetClassId, reqUser);
  if (!before.blockerCount) {
    return { cleared: 0, unlinked: [] };
  }

  const result = await unlinkAllCycleReferences(targetClassId, reqUser, options);
  if (result.issues.length) {
    throw new Error(`Rolling cycle link cleanup failed: ${result.issues.join(' | ')}`);
  }
  if (result.blockerCount > 0) {
    throw new Error(`Rolling cycle links still reference this class (${result.blockerCount} remaining).`);
  }

  return {
    cleared: result.unlinked.length,
    unlinked: result.unlinked
  };
}

module.exports = {
  LINK_TYPE_INCOMING_NEXT,
  LINK_TYPE_INCOMING_PREVIOUS,
  buildResolverHref,
  collectCycleLinkBlockers,
  unlinkCycleReference,
  unlinkAllCycleReferences,
  clearInboundCycleReferencesForClassDelete
};
