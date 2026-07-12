const dataService = require('../dataService');
const { getMongoCollection } = require('../../infrastructure/mongo/mongoConnection');
const { SYSTEM_CONTEXT } = require('../../../config/constants');
const { toPublicId } = require('../../utils/idAdapter');

function parseSafeInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSessionCurrentlyActive(session, now = new Date()) {
  if (!session || String(session.status || '').trim().toLowerCase() !== 'active') {
    return false;
  }

  const lastActive = toDate(session.lastActivityAt);
  const absoluteExpiry = toDate(session.absoluteExpiry);
  if (!lastActive) return false;
  if (absoluteExpiry && now > absoluteExpiry) return false;

  const idleMins = parseSafeInt(session.idleTimeoutMinutes, 30);
  const idleLimitMs = idleMins * 60 * 1000;
  return (now.getTime() - lastActive.getTime()) <= idleLimitMs;
}

function groupSessionsByUser(sessions = [], now = new Date()) {
  const grouped = new Map();

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (!isSessionCurrentlyActive(session, now)) return;

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
        deviceFingerprint: session.deviceFingerprint || null
      });
      return;
    }

    existing.sessionCount += 1;
    if (lastActivityAt.getTime() > new Date(existing.lastActivityAt).getTime()) {
      existing.lastActivityAt = lastActivityAt.toISOString();
      existing.currentOrgId = session.currentOrgId || existing.currentOrgId;
      existing.deviceFingerprint = session.deviceFingerprint || existing.deviceFingerprint;
    }
  });

  return Array.from(grouped.values()).sort((a, b) => (
    new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  ));
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
  const collection = getMongoCollection('logs');
  const pipeline = [
    {
      $match: {
        timestamp: { $gte: start.toISOString() },
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

async function buildSummary(enrichedRows = [], groupedRows = [], now = new Date()) {
  const base = computeSummaryMetrics(enrichedRows, groupedRows, now);
  let dailyStats = { avgDailyActiveUsers: 0, sampledDays: 0, lookbackDays: 7 };
  try {
    dailyStats = await computeAvgDailyActiveUsers(now, 7);
  } catch (_) {
    dailyStats = { avgDailyActiveUsers: 0, sampledDays: 0, lookbackDays: 7 };
  }

  return {
    ...base,
    ...dailyStats
  };
}

function mapActiveUserRow(groupRow, userMap) {
  const user = userMap.get(String(groupRow.userId || '').trim()) || null;
  const displayName = String(
    user?.displayName
      || user?.name
      || user?.username
      || groupRow.userId
      || ''
  ).trim();

  return {
    userId: groupRow.userId,
    username: String(user?.username || '').trim(),
    email: String(user?.email || '').trim(),
    displayName,
    lastLoginAt: user?.lastLoginAt || null,
    lastActivityAt: groupRow.lastActivityAt,
    currentOrgId: groupRow.currentOrgId || null,
    sessionCount: groupRow.sessionCount || 0,
    deviceFingerprint: groupRow.deviceFingerprint || null,
    trackActivityUrl: `/security/track-activity/?userId=${encodeURIComponent(groupRow.userId)}`
  };
}

async function listActiveUsers({ query = {} } = {}) {
  const now = new Date();
  const collection = getMongoCollection('sessions');
  const sessions = await collection.find({ status: 'active' }).toArray();

  const grouped = groupSessionsByUser(sessions, now);
  const userMap = await loadUsersByIds(grouped.map((row) => row.userId));

  const searchText = normalizeSearchText(query.q);
  const enriched = grouped
    .map((row) => mapActiveUserRow(row, userMap))
    .filter((row) => matchesSearch(row, searchText));

  const summary = await buildSummary(enriched, grouped, now);

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
  isSessionCurrentlyActive,
  groupSessionsByUser,
  computeSummaryMetrics,
  listActiveUsers
};
