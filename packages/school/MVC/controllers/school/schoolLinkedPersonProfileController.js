const schoolLinkedPersonProfileService = require('../../services/school/schoolLinkedPersonProfileService');
const personDenormalizedNameSyncService = require('../../services/school/personDenormalizedNameSyncService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
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
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const personId = toPublicId(req.body?.personId || req.query?.personId || '');
    const linkType = String(req.body?.linkType || req.query?.linkType || '').trim().toLowerCase();
    const canSync = await Promise.all([
      adminChekersService.isAdminForRequestAsync(req.user, SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { section: { id: SECTIONS.SCHOOL_TEACHERS } }),
      adminChekersService.isAdminForRequestAsync(req.user, SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { section: { id: SECTIONS.SCHOOL_STAFF } }),
      adminChekersService.isAdminForRequestAsync(req.user, SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { section: { id: SECTIONS.SCHOOL_STUDENTS } })
    ]);
    if (!canSync.some(Boolean)) {
      return res.status(403).json({ status: 'error', message: 'You do not have permission to sync denormalized person names.' });
    }

    const result = await personDenormalizedNameSyncService.syncDenormalizedNamesForOrg({
      activeOrgId,
      reqUser: req.user,
      personId,
      linkType
    });

    const sectionLabel = linkType === 'teacher'
      ? 'teacher'
      : (linkType === 'staff' ? 'staff' : (linkType === 'student' ? 'student' : 'organization'));

    return res.json({
      status: 'success',
      message: personId
        ? 'Denormalized names were refreshed for the selected person.'
        : `Denormalized names were refreshed for ${sectionLabel} records in the active organization.`,
      data: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  getLinkedPersonProfile,
  patchLinkedPersonProfile,
  syncDenormalizedNames
};
