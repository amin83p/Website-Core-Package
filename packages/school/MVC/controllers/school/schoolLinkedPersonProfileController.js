const schoolLinkedPersonProfileService = require('../../services/school/schoolLinkedPersonProfileService');
const personDenormalizedNameSyncService = require('../../services/school/personDenormalizedNameSyncService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

function readLinkContext(req) {
  const linkType = String(req.query?.linkType || req.body?.linkType || '').trim().toLowerCase();
  const linkId = toPublicId(req.query?.linkId || req.body?.linkId || '');
  return { linkType, linkId };
}

async function getLinkedPersonProfile(req, res) {
  try {
    const personId = toPublicId(req.params?.personId || '');
    const { linkType, linkId } = readLinkContext(req);
    const data = await schoolLinkedPersonProfileService.getLinkedPersonProfile({
      reqUser: req.user,
      personId,
      linkType,
      linkId
    });
    return res.json({ status: 'success', data });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function patchLinkedPersonProfile(req, res) {
  try {
    const personId = toPublicId(req.params?.personId || '');
    const { linkType, linkId } = readLinkContext(req);
    const data = await schoolLinkedPersonProfileService.updateLinkedPersonProfile({
      reqUser: req.user,
      personId,
      linkType,
      linkId,
      body: req.body || {}
    });
    return res.json({
      status: 'success',
      message: 'Person profile updated successfully.',
      data
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function syncDenormalizedNames(req, res) {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const personId = toPublicId(req.body?.personId || req.query?.personId || '');
    const linkType = String(req.body?.linkType || req.query?.linkType || '').trim().toLowerCase();
    const canSync = await Promise.all([
      adminChekersService.isAdminForRequestAsync(req.user, SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { section: { id: SECTIONS.SCHOOL_TEACHERS } }),
      adminChekersService.isAdminForRequestAsync(req.user, SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { section: { id: SECTIONS.SCHOOL_STAFF } }),
      adminChekersService.isAdminForRequestAsync(req.user, SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { section: { id: SECTIONS.SCHOOL_STUDENTS } })
    ]);
    const isIntegratedBulk = !personId;
    if ((isIntegratedBulk && !canSync.every(Boolean)) || (!isIntegratedBulk && !canSync.some(Boolean))) {
      return res.status(403).json({
        status: 'error',
        message: isIntegratedBulk
          ? 'Update permission for Teachers, Students, and Staff is required to sync all saved names.'
          : 'You do not have permission to sync denormalized person names.'
      });
    }

    if (isIntegratedBulk) {
      guardKey = idempotencyGuardService.createGuardKey(['school_people_saved_name_sync', activeOrgId]);
      const guardResult = idempotencyGuardService.beginGuard({ key: guardKey, runningTtlMs: 180000, replayTtlMs: 15000 });
      if (guardResult.status === 'busy') {
        return res.status(409).json({
          status: 'warning',
          message: 'Saved-name synchronization is already running for this organization.',
          idempotency: { state: 'busy', retryAfterMs: Number(guardResult.retryAfterMs || 0) }
        });
      }
      if (guardResult.status === 'replay') {
        return res.json({ ...(guardResult.payload || {}), idempotency: { state: 'replayed' } });
      }
    }

    const result = isIntegratedBulk
      ? await personDenormalizedNameSyncService.syncAllSchoolPeopleSavedNamesForOrg({ activeOrgId, reqUser: req.user })
      : await personDenormalizedNameSyncService.syncDenormalizedNamesForOrg({ activeOrgId, reqUser: req.user, personId, linkType });

    const payload = {
      status: 'success',
      partial: result.partial === true,
      message: result.partial
        ? 'Saved-name synchronization completed with warnings. Review the reported errors.'
        : (personId
          ? 'Denormalized names were refreshed for the selected person.'
          : 'Saved names were refreshed for Teachers, Students, and Staff in the active organization.'),
      data: result
    };
    if (guardKey) idempotencyGuardService.completeGuard(guardKey, payload);
    return res.json(payload);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  getLinkedPersonProfile,
  patchLinkedPersonProfile,
  syncDenormalizedNames
};
