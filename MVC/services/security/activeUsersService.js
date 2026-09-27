const dataService = require('../dataService');
const { getMongoCollection } = require('../../infrastructure/mongo/mongoConnection');
const { SYSTEM_CONTEXT, DEFAULTS } = require('../../../config/constants');
const { toPublicId } = require('../../utils/idAdapter');
const { sanitizeCurrentPath } = require('../../utils/pagePathUtils');

function readNamePart(source = {}, key = '') {
  if (!source || typeof source !== 'object') return '';
  return String(
    source?.name?.[key]
    || source?.[`${key}Name`]
    || ''
  ).trim();
}

function resolveActiveUserDisplayName(user = null, person = null) {
  const preferred = readNamePart(person, 'preferred') || readNamePart(user, 'preferred')
    || String(user?.preferredName || '').trim();
  if (preferred) return preferred;

  const first = readNamePart(person, 'first') || readNamePart(user, 'first')
    || String(user?.firstName || '').trim();
  const last = readNamePart(person, 'last') || readNamePart(user, 'last')
    || String(user?.lastName || '').trim();
  const composed = [first, last].filter(Boolean).join(' ').trim();
  if (composed) return composed;

  if (typeof user?.name === 'string' && user.name.trim()) return user.name.trim();

  const displayName = String(user?.displayName || '').trim();
  if (displayName) return displayName;

  const personDisplay = String(
    person?.displayName
    || person?.fullName
    || (typeof person?.name === 'string' ? person.name : '')
  ).trim();
  if (personDisplay) return personDisplay;

  return String(user?.username || '').trim();
}

function parseSafeInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getActiveUserStaleMinutes() {
  return Math.max(1, parseSafeInt(DEFAULTS.ACTIVE_USER_STALE_MINUTES, 5));
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecentlyActiveSession(session, now = new Date(), staleMinutes = getActiveUserStaleMinutes()) {
  if (!session || String(session.status || '').trim().toLowerCase() !== 'active') {
    return false;
  }

  const lastActive = toDate(session.lastActivityAt);
  const absoluteExpiry = toDate(session.absoluteExpiry);
  if (!lastActive) return false;
  if (absoluteExpiry && now > absoluteExpiry) return false;

  const staleLimitMs = Math.max(1, parseSafeInt(staleMinutes, getActiveUserStaleMinutes())) * 60 * 1000;
  return (now.getTime() - lastActive.getTime()) <= staleLimitMs;
}

function groupSessionsByUser(sessions = [], now = new Date(), staleMinutes = getActiveUserStaleMinutes()) {
  const grouped = new Map();

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (!isRecentlyActiveSession(session, now, staleMinutes)) return;

    const userId = toPublicId(session.userId);
    if (!userId) return;

    const lastActivityAt = toDate(session.lastActivityAt);
    if (!lastActivityAt) return;

    const existing = grouped.get(userId);
    if (!existing) {
      grouped.set(userId, {
        userId,
        lastActivityAt: lastActivityAt.toISOString(),
        sessionCount: 1,
        currentOrgId: session.currentOrgId || null,
        deviceFingerprint: session.deviceFingerprint || null,
        currentPath: sanitizeCurrentPath(session.currentPath || ''),
        currentPathUpdatedAt: session.currentPathUpdatedAt || null
      });
      return;
    }

    existing.sessionCount += 1;
    if (lastActivityAt.getTime() > new Date(existing.lastActivityAt).getTime()) {
      existing.lastActivityAt = lastActivityAt.toISOString();
      existing.currentOrgId = session.currentOrgId || existing.currentOrgId;
      existing.deviceFingerprint = session.deviceFingerprint || existing.deviceFingerprint;
      existing.currentPath = sanitizeCurrentPath(session.currentPath || '');
      existing.currentPathUpdatedAt = session.currentPathUpdatedAt || null;
    }
  });

  return Array.from(grouped.values()).sort((a, b) => (
    new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  ));
}

function filterSessionsByCurrentPath(sessions = [], currentPath = '') {
  const targetPath = sanitizeCurrentPath(currentPath);
  const rows = Array.isArray(sessions) ? sessions : [];
  if (!targetPath) return rows;
  return rows.filter((session) => sanitizeCurrentPath(session?.currentPath || '') === targetPath);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesSearch(row, searchText) {
  if (!searchText) return true;
  const haystack = [
    row.displayName,
    row.username,
    row.email,
    row.userId
  ].map(normalizeSearchText).join(' ');
  return haystack.includes(searchText);
}

function paginateRows(rows = [], page = 1, limit = 25) {
  const safePage = Math.max(1, parseSafeInt(page, 1));
  const safeLimit = Math.max(1, Math.min(parseSafeInt(limit, 25), 200));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const normalizedPage = Math.min(safePage, totalPages);
  const start = (normalizedPage - 1) * safeLimit;
  const pagedRows = rows.slice(start, start + safeLimit);

  return {
    rows: pagedRows,
    pagination: {
      page: normalizedPage,
      limit: safeLimit,
      total,
      totalPages,
      hasNext: normalizedPage < totalPages,
      hasPrev: normalizedPage > 1
    }
  };
}

async function loadUsersByIds(userIds = []) {
  const uniqueIds = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
    .map((id) => toPublicId(id))
    .filter(Boolean)));

  const userMap = new Map();
  await Promise.all(uniqueIds.map(async (userId) => {
    const user = await dataService.getDataById('users', userId, SYSTEM_CONTEXT).catch(() => null);
    if (user?.id) {
      userMap.set(String(user.id), user);
    }
  }));

  return userMap;
}

async function loadPersonsByUserMap(userMap = new Map()) {
  const personIds = Array.from(new Set(
    Array.from(userMap.values())
      .map((user) => toPublicId(user?.personId))
      .filter(Boolean)
  ));
  const personMap = new Map();
  await Promise.all(personIds.map(async (personId) => {
    const person = await dataService.getDataById('persons', personId, SYSTEM_CONTEXT).catch(() => null);
    if (person?.id) {
      personMap.set(String(person.id), person);
    }
  }));
  return personMap;
}

async function loadOrganizationsByIds(orgIds = []) {
  const uniqueIds = Array.from(new Set((Array.isArray(orgIds) ? orgIds : [])
    .map((id) => toPublicId(id))
    .filter(Boolean)));
  const orgMap = new Map();
  await Promise.all(uniqueIds.map(async (orgId) => {
    const org = await dataService.getDataById('organizations', orgId, SYSTEM_CONTEXT).catch(() => null);
    if (org?.id) {
      orgMap.set(String(org.id), org);
    }
  }));
  return orgMap;
}

function resolveOrganizationDisplayName(org = null, orgId = '') {
  const fallback = String(orgId || '').trim();
  if (!org || typeof org !== 'object') return fallback;
  return String(
    org?.identity?.displayName
    || org?.identity?.legalName
    || org?.name
    || org?.orgName
    || fallback
  ).trim() || fallback;
}

function computeSummaryMetrics(enrichedRows = [], groupedRows = [], now = new Date()) {
  const activeUserCount = enrichedRows.length;
  const activeSessionCount = groupedRows.reduce((sum, row) => sum + (row.sessionCount || 0), 0);
  const avgSessionsPerUser = activeUserCount
    ? Math.round((activeSessionCount / activeUserCount) * 10) / 10
    : 0;

  let totalMinutesSinceActivity = 0;
  enrichedRows.forEach((row) => {
    const lastActive = toDate(row.lastActivityAt);
    if (!lastActive) return;
    totalMinutesSinceActivity += Math.max(0, (now.getTime() - lastActive.getTime()) / 60000);
  });
  const avgMinutesSinceLastActivity = activeUserCount
    ? Math.round(totalMinutesSinceActivity / activeUserCount)
    : 0;

  const multiSessionUsers = enrichedRows.filter((row) => Number(row.sessionCount || 0) > 1).length;

  return {
    activeUserCount,
    activeSessionCount,
    avgSessionsPerUser,
    avgMinutesSinceLastActivity,
    multiSessionUsers
  };
}

async function computeAvgDailyActiveUsers(now = new Date(), lookbackDays = 7) {
  const safeDays = Math.max(1, parseSafeInt(lookbackDays, 7));
  const start = new Date(now.getTime() - (safeDays * 24 * 60 * 60 * 1000));
  const startIso = start.toISOString();
  const collection = getMongoCollection('logs');
  const pipeline = [
    {
      $match: {
        $or: [
          { timestamp: { $gte: start } },
          { timestamp: { $gte: startIso } }
        ],
        userId: { $exists: true, $nin: [null, ''] }
      }
    },
    {
      $addFields: {
        day: { $substr: ['$timestamp', 0, 10] }
      }
    },
    {
      $group: {
        _id: { day: '$day', userId: '$userId' }
      }
    },
    {
      $group: {
        _id: '$_id.day',
        userCount: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        avgDailyActiveUsers: { $avg: '$userCount' },
        sampledDays: { $sum: 1 }
      }
    }
  ];

  const rows = await collection.aggregate(pipeline).toArray();
  const row = rows[0] || {};
  return {
    avgDailyActiveUsers: Math.round((Number(row.avgDailyActiveUsers) || 0) * 10) / 10,
    sampledDays: Number(row.sampledDays) || 0,
    lookbackDays: safeDays
  };
}

async function buildSummary(enrichedRows = [], groupedRows = [], now = new Date(), staleMinutes = getActiveUserStaleMinutes()) {
  const base = computeSummaryMetrics(enrichedRows, groupedRows, now);
  let dailyStats = { avgDailyActiveUsers: 0, sampledDays: 0, lookbackDays: 7 };
  try {
    dailyStats = await computeAvgDailyActiveUsers(now, 7);
  } catch (_) {
    dailyStats = { avgDailyActiveUsers: 0, sampledDays: 0, lookbackDays: 7 };
  }

  return {
    ...base,
    ...dailyStats,
    staleMinutes: Math.max(1, parseSafeInt(staleMinutes, getActiveUserStaleMinutes()))
  };
}

function mapActiveUserRow(groupRow, userMap, personMap = new Map(), orgMap = new Map()) {
  const user = userMap.get(String(groupRow.userId || '').trim()) || null;
  const person = user?.personId
    ? personMap.get(String(toPublicId(user.personId) || '').trim()) || null
    : null;
  const displayName = resolveActiveUserDisplayName(user, person)
    || String(groupRow.userId || '').trim();
  const orgId = toPublicId(groupRow.currentOrgId) || String(groupRow.currentOrgId || '').trim() || null;
  const org = orgId ? orgMap.get(String(orgId)) || null : null;
  const currentOrgName = resolveOrganizationDisplayName(org, orgId || '');

  return {
    userId: groupRow.userId,
    username: String(user?.username || '').trim(),
    displayName,
    lastLoginAt: user?.lastLoginAt || null,
    lastActivityAt: groupRow.lastActivityAt,
    currentOrgId: orgId,
    currentOrgName,
    sessionCount: groupRow.sessionCount || 0,
    deviceFingerprint: groupRow.deviceFingerprint || null,
    currentPath: sanitizeCurrentPath(groupRow.currentPath || ''),
    currentPathUpdatedAt: groupRow.currentPathUpdatedAt || null,
    trackActivityUrl: `/security/track-activity/?userId=${encodeURIComponent(groupRow.userId)}`
  };
}

async function listActiveUsers({ query = {} } = {}) {
  const now = new Date();
  const staleMinutes = getActiveUserStaleMinutes();
  const cutoff = new Date(now.getTime() - (staleMinutes * 60 * 1000)).toISOString();
  const collection = getMongoCollection('sessions');
  const currentPath = sanitizeCurrentPath(query.currentPath || query.path);
  const mongoQuery = {
    status: 'active',
    lastActivityAt: { $gte: cutoff }
  };
  if (currentPath) mongoQuery.currentPath = currentPath;
  const sessions = filterSessionsByCurrentPath(await collection.find(mongoQuery).toArray(), currentPath);

  const grouped = groupSessionsByUser(sessions, now, staleMinutes);
  const userMap = await loadUsersByIds(grouped.map((row) => row.userId));
  const personMap = await loadPersonsByUserMap(userMap);
  const orgMap = await loadOrganizationsByIds(grouped.map((row) => row.currentOrgId));

  const searchText = normalizeSearchText(query.q);
  const enriched = grouped
    .map((row) => mapActiveUserRow(row, userMap, personMap, orgMap))
    .filter((row) => matchesSearch(row, searchText));

  const summary = {
    ...(await buildSummary(enriched, grouped, now, staleMinutes)),
    currentPath
  };

  const previewLimit = String(query.preview || '').trim() === '1'
    ? Math.max(1, Math.min(parseSafeInt(query.limit, 12), 50))
    : null;
  const page = query.page;
  const limit = previewLimit || query.limit;
  const { rows, pagination } = paginateRows(enriched, page, limit);

  return {
    rows,
    pagination,
    summary
  };
}

module.exports = {
  getActiveUserStaleMinutes,
  isRecentlyActiveSession,
  filterSessionsByCurrentPath,
  groupSessionsByUser,
  computeSummaryMetrics,
  listActiveUsers,
  resolveActiveUserDisplayName
};
