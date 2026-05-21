const { idsEqual, toPublicId } = require('../utils/idAdapter');

function cleanToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isPublished(item = {}) {
  return cleanToken(item.status) === 'published';
}

function isPublic(item = {}) {
  return cleanToken(item.visibility || 'public') === 'public';
}

function isUsersOnly(item = {}) {
  return cleanToken(item.visibility) === 'users';
}

function isOrgOnly(item = {}) {
  return cleanToken(item.visibility) === 'org';
}

function targetsOrg(item = {}, activeOrgId = '') {
  const orgId = toPublicId(activeOrgId);
  if (!orgId) return false;
  if (idsEqual(item.targetOrgId, orgId)) return true;
  const targetOrgIds = Array.isArray(item.targetOrgIds) ? item.targetOrgIds : [];
  return targetOrgIds.some((target) => idsEqual(target, orgId));
}

function canViewNewsItem(item = {}, scope = {}) {
  if (scope?.canViewAll !== false) return true;
  if (!isPublished(item)) return false;
  if (isPublic(item)) return true;
  if (!scope?.isAuthenticated) return false;
  if (isUsersOnly(item)) return true;
  if (isOrgOnly(item)) return targetsOrg(item, scope.activeOrgId);
  return false;
}

function filterVisibleNews(rows = [], scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((item) => canViewNewsItem(item, scope));
}

function buildMongoNewsScopeFilter(scope = {}) {
  if (scope?.canViewAll !== false) return {};

  const clauses = [
    { visibility: { $regex: /^public$/i } }
  ];

  if (scope?.isAuthenticated) {
    clauses.push({ visibility: { $regex: /^users$/i } });

    const activeOrgId = toPublicId(scope.activeOrgId);
    if (activeOrgId) {
      clauses.push({
        $and: [
          { visibility: { $regex: /^org$/i } },
          {
            $or: [
              { targetOrgId: activeOrgId },
              { targetOrgIds: activeOrgId }
            ]
          }
        ]
      });
    }
  }

  return {
    $and: [
      { status: { $regex: /^published$/i } },
      { $or: clauses }
    ]
  };
}

module.exports = {
  canViewNewsItem,
  filterVisibleNews,
  buildMongoNewsScopeFilter
};
