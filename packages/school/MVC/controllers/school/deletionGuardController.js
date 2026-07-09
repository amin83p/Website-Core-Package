const schoolDeletionGuardService = require('../../services/school/schoolDeletionGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');

function parseContext(req) {
  const context = {};
  const classId = String(req.query?.classId || req.body?.classId || '').trim();
  if (classId) context.classId = classId;
  return context;
}

async function previewDeletion(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const entityKey = String(req.params.entityKey || '').trim();
    const id = String(req.params.id || '').trim();
    const preview = await schoolDeletionGuardService.previewDelete({
      entityKey,
      id,
      orgId,
      reqUser: req.user,
      context: parseContext(req)
    });
    return res.json({ status: 'success', preview });
  } catch (error) {
    const message = String(error?.message || 'Could not build deletion preview.');
    if (isAjax(req)) return res.status(400).json({ status: 'error', message });
    return res.status(400).render('error', { title: 'Error', message, error, user: req.user });
  }
}

async function executeDeletion(req, res) {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const entityKey = String(req.params.entityKey || '').trim();
    const id = String(req.params.id || '').trim();
    const result = await schoolDeletionGuardService.executeDelete({
      entityKey,
      id,
      orgId,
      reqUser: req.user,
      context: parseContext(req)
    });
    return res.json({
      status: 'success',
      message: 'Record deleted successfully.',
      preview: result.preview,
      result: result.result
    });
  } catch (error) {
    return schoolDeletionGuardService.handleDeleteError(req, res, error);
  }
}

module.exports = {
  previewDeletion,
  executeDeletion
};
