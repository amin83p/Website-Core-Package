'use strict';

const DASHBOARD_ALL_SECTIONS_CACHE_TTL_MS = 60 * 1000;
const dashboardAllSectionsCache = new Map();

function buildDashboardAllSectionsCacheKey(user = null) {
  const safeUser = user && typeof user === 'object' ? user : {};
  const userId = String(safeUser.id || '').trim() || 'ANON';
  const activeOrgId = String(safeUser.activeOrgId || '').trim() || 'NO_ORG';
  const role = String(safeUser.role || '').trim() || 'NO_ROLE';
  const activeProfileId = String(safeUser.activeProfile?.id || safeUser.accessProfileId || '').trim() || 'NO_ACTIVE_PROFILE';
  const activeProfileStamp = String(
    safeUser.activeProfile?.updatedAt
    || safeUser.activeProfile?.audit?.lastUpdateDateTime
    || ''
  ).trim() || 'NO_PROFILE_STAMP';
  const profileMode = String(safeUser.currentProfileMode || '').trim() || 'NO_PROFILE_MODE';
  const systemAccessProfileId = String(safeUser.systemAccessProfileId || '').trim() || 'NO_SYSTEM_ACCESS_PROFILE';
  const virtualFlag = safeUser.isVirtualSuperAdmin ? 'VSA1' : 'VSA0';
  return [userId, activeOrgId, role, activeProfileId, activeProfileStamp, profileMode, systemAccessProfileId, virtualFlag].join('|');
}

function readDashboardAllSectionsCache(cacheKey) {
  if (!cacheKey) return null;
  const cached = dashboardAllSectionsCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardAllSectionsCache.delete(cacheKey);
    return null;
  }
  return Array.isArray(cached.rows) ? cached.rows.slice() : [];
}

function writeDashboardAllSectionsCache(cacheKey, rows) {
  if (!cacheKey) return;
  dashboardAllSectionsCache.set(cacheKey, {
    rows: Array.isArray(rows) ? rows.slice() : [],
    expiresAt: Date.now() + DASHBOARD_ALL_SECTIONS_CACHE_TTL_MS
  });
}

function clearDashboardFilteredSectionsCache() {
  dashboardAllSectionsCache.clear();
}

module.exports = {
  DASHBOARD_ALL_SECTIONS_CACHE_TTL_MS,
  buildDashboardAllSectionsCacheKey,
  readDashboardAllSectionsCache,
  writeDashboardAllSectionsCache,
  clearDashboardFilteredSectionsCache,
  _dashboardAllSectionsCache: dashboardAllSectionsCache
};
