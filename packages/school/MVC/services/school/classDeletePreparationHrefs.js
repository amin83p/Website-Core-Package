const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function buildDeletePreparationHref(targetClassId, focusClassId = '', returnTo = 'delete') {
  const targetId = toPublicId(targetClassId);
  if (!targetId) return '';
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  const focusId = toPublicId(focusClassId);
  if (focusId) params.set('focus', focusId);
  const query = params.toString();
  return `/school/classes/${encodeURIComponent(targetId)}/delete-preparation${query ? `?${query}` : ''}`;
}

module.exports = {
  buildDeletePreparationHref
};
