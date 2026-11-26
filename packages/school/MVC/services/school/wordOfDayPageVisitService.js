'use strict';

const wordOfDayPageVisitModel = require('../../models/school/wordOfDayPageVisitModel');
const wordOfDayReactionService = require('./wordOfDayReactionService');
const personDisplayNameService = require('./personDisplayNameService');

const GUEST_VISITOR_LABEL = 'Guest visitor';

async function resolveVisitorDisplayName(user) {
  if (user && typeof user === 'object' && wordOfDayReactionService.resolveVoterUserId(user)) {
    return personDisplayNameService.resolveUserDisplayName(user, { fallback: GUEST_VISITOR_LABEL });
  }
  return GUEST_VISITOR_LABEL;
}

async function recordQualifiedVisit({
  entryId,
  orgId,
  dateKey,
  viewSessionId,
  durationMs,
  user,
  ip,
  userAgent = ''
} = {}) {
  await wordOfDayReactionService.assertReactionTarget({ entryId, orgId, dateKey });

  const visitorUserId = wordOfDayReactionService.resolveVoterUserId(user);
  const ipAddress = String(ip || '').trim();
  if (!visitorUserId && !ipAddress) throw new Error('Could not identify visitor.');

  const visitorDisplayName = await resolveVisitorDisplayName(user);

  const row = await wordOfDayPageVisitModel.recordVisit({
    entryId: String(entryId).trim(),
    orgId: String(orgId || '').trim(),
    dateKey: String(dateKey || '').trim(),
    viewSessionId: String(viewSessionId || '').trim(),
    durationMs: Math.max(0, Number(durationMs) || 0),
    visitorUserId: visitorUserId || null,
    ipAddress,
    userAgent,
    visitorDisplayName
  });

  return row;
}

async function getVisitsForStaff(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return [];
  const entries = await wordOfDayPageVisitModel.readAllEntries();
  const scoped = wordOfDayPageVisitModel.listForEntry(id, entries);
  return scoped
    .map((row) => ({
      visitorName: wordOfDayPageVisitModel.sanitizeVoterDisplayName(row.visitorDisplayName) || GUEST_VISITOR_LABEL,
      visitorUserId: row.visitorUserId || null,
      durationMs: Number(row.durationMs) || 0,
      dateKey: row.dateKey || '',
      viewedAt: row.createdAt || null
    }))
    .sort((a, b) => String(b.viewedAt).localeCompare(String(a.viewedAt)));
}

async function getStaffEngagementReport(entryId) {
  const feedback = await wordOfDayReactionService.getStaffFeedbackForEntry(entryId);
  const pageVisits = await getVisitsForStaff(entryId);
  return {
    ...feedback,
    pageVisits
  };
}

module.exports = {
  GUEST_VISITOR_LABEL,
  recordQualifiedVisit,
  getVisitsForStaff,
  getStaffEngagementReport
};