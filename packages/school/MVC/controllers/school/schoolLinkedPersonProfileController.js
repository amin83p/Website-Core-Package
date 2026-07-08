const schoolLinkedPersonProfileService = require('../../services/school/schoolLinkedPersonProfileService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

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

module.exports = {
  getLinkedPersonProfile,
  patchLinkedPersonProfile
};
