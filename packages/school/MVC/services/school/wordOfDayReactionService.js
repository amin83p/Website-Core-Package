'use strict';

const wordOfDayReactionModel = require('../../models/school/wordOfDayReactionModel');
const wordOfDayDisplayService = require('./wordOfDayDisplayService');
const schoolRepositories = require('../../repositories/school');
const personDisplayNameService = require('./personDisplayNameService');
const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const GUEST_VOTER_LABEL = 'Guest voter';

function resolveVoterUserId(user) {
  if (!user || typeof user !== 'object') return '';
  const candidates = [user.id, user._id, user.userId, user.publicId];
  for (const value of candidates) {
    const token = String(value || '').trim();
    if (token) return toPublicId(token);
  }
  return '';
}

function resolveMyVote(entryId, entries, { user, ip } = {}) {
  const id = String(entryId || '').trim();
  if (!id) return null;
  const userId = resolveVoterUserId(user);
  if (userId) {
    const userKey = wordOfDayReactionModel.buildDedupeKey({ entryId: id, voterUserId: userId });
    const hit = entries.find((row) => String(row?.dedupeKey || '') === userKey);
    if (hit) return wordOfDayReactionModel.normalizeVote(hit.vote);
  }
  const ipToken = String(ip || '').trim();
  if (ipToken) {
    const ipKey = wordOfDayReactionModel.buildDedupeKey({ entryId: id, ipAddress: ipToken });
    const hit = entries.find((row) => String(row?.dedupeKey || '') === ipKey);
    if (hit) return wordOfDayReactionModel.normalizeVote(hit.vote);
  }
  return null;
}

function voterLabelFromRow(row) {
  const stored = wordOfDayReactionModel.sanitizeVoterDisplayName(row?.voterDisplayName);
  if (stored) return stored;
  if (row?.voterUserId) return String(row.voterUserId);
  return GUEST_VOTER_LABEL;
}

function buildPublicFeedbackFromReactions(scoped) {
  const now = new Date().toISOString();
  let likes = 0;
  let dislikes = 0;
  const dislikeComments = [];

  for (const row of scoped) {
    const vote = wordOfDayReactionModel.normalizeVote(row.vote);
    if (vote === 'like') likes += 1;
    else if (vote === 'dislike') {
      dislikes += 1;
      const text = wordOfDayReactionModel.sanitizeDislikeComment(row.dislikeComment, { vote: 'dislike' });
      if (text) {
        dislikeComments.push({
          reactionId: String(row.id || ''),
          text,
          voterName: voterLabelFromRow(row),
          voterUserId: row.voterUserId || null,
          createdAt: row.createdAt || row.updatedAt || now,
          updatedAt: row.updatedAt || row.createdAt || now
        });
      }
    }
  }

  dislikeComments.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));

  return {
    stats: { likes, dislikes, updatedAt: now },
    dislikeComments
  };
}

async function getSummaryForEntry(entryId, { user, ip } = {}) {
  const entries = await wordOfDayReactionModel.readAllEntries();
  const scoped = wordOfDayReactionModel.listForEntry(entryId, entries);
  let likes = 0;
  let dislikes = 0;
  for (const row of scoped) {
    const vote = wordOfDayReactionModel.normalizeVote(row.vote);
    if (vote === 'like') likes += 1;
    else if (vote === 'dislike') dislikes += 1;
  }
  return {
    likes,
    dislikes,
    myVote: resolveMyVote(entryId, scoped, { user, ip })
  };
}

async function syncPublicFeedbackToEntry(entryId) {
  const id = String(entryId || '').trim();
  if (!id) return null;

  const entries = await wordOfDayReactionModel.readAllEntries();
  const scoped = wordOfDayReactionModel.listForEntry(id, entries);
  const publicFeedback = buildPublicFeedbackFromReactions(scoped);

  const row = await schoolRepositories.wordOfDay.getById(id);
  if (!row) return publicFeedback;

  const orgId = String(row.orgId || '').trim();
  await schoolRepositories.wordOfDay.update(id, { publicFeedback }, { orgId });
  return publicFeedback;
}

async function getStaffFeedbackForEntry(entryId) {
  const id = String(entryId || '').trim();
  if (!id) {
    return {
      publicFeedback: { stats: { likes: 0, dislikes: 0, updatedAt: null }, dislikeComments: [] },
      reactionVoters: { likes: [], dislikes: [] }
    };
  }

  const entries = await wordOfDayReactionModel.readAllEntries();
  const scoped = wordOfDayReactionModel.listForEntry(id, entries);
  const publicFeedback = buildPublicFeedbackFromReactions(scoped);

  const likes = [];
  const dislikes = [];
  for (const row of scoped) {
    const vote = wordOfDayReactionModel.normalizeVote(row.vote);
    const voter = {
      voterName: voterLabelFromRow(row),
      voterUserId: row.voterUserId || null,
      votedAt: row.updatedAt || row.createdAt || null
    };
    if (vote === 'like') likes.push(voter);
    else if (vote === 'dislike') dislikes.push(voter);
  }

  const nameBuckets = new Map();
  for (const row of scoped) {
    const uid = row.voterUserId ? String(row.voterUserId) : '';
    if (uid && !wordOfDayReactionModel.sanitizeVoterDisplayName(row.voterDisplayName)) {
      nameBuckets.set(uid, row);
    }
  }
  for (const [uid, row] of nameBuckets) {
    const name = await personDisplayNameService.resolveUserIdDisplayName(uid, { fallback: uid });
    if (!name) continue;
    const stored = wordOfDayReactionModel.sanitizeVoterDisplayName(name);
    for (const list of [likes, dislikes]) {
      for (const item of list) {
        if (item.voterUserId === uid && (item.voterName === uid || !item.voterName)) {
          item.voterName = stored;
        }
      }
    }
    for (const comment of publicFeedback.dislikeComments) {
      if (comment.voterUserId === uid && (comment.voterName === uid || comment.voterName === GUEST_VOTER_LABEL)) {
        comment.voterName = stored;
      }
    }
  }

  return { publicFeedback, reactionVoters: { likes, dislikes } };
}

async function assertReactionTarget({ entryId, orgId, dateKey }) {
  const id = String(entryId || '').trim();
  const targetOrg = String(orgId || '').trim();
  const targetDate = String(dateKey || '').trim();
  if (!id || !targetOrg || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('Invalid reaction target.');
  }

  const entry = await wordOfDayDisplayService.getApprovedEntryRowById(id);
  if (!entry) throw new Error('Word of the Day entry not found or not approved.');

  const daily = await wordOfDayDisplayService.resolveDailyPublicDetail({
    orgId: targetOrg,
    dateKey: targetDate,
    recordAnalytics: false
  });
  if (!daily?.entry?.id || String(daily.entry.id) !== String(id)) {
    throw new Error('Entry does not match the word shown for that date and organization.');
  }
  return { entry, daily };
}

async function resolveVoterDisplayName(user) {
  if (user && typeof user === 'object' && resolveVoterUserId(user)) {
    return personDisplayNameService.resolveUserDisplayName(user, { fallback: GUEST_VOTER_LABEL });
  }
  return GUEST_VOTER_LABEL;
}

async function setReaction({
  entryId,
  orgId,
  dateKey,
  vote,
  dislikeComment,
  user,
  ip,
  userAgent = ''
} = {}) {
  const normalizedVote = wordOfDayReactionModel.normalizeVote(vote);
  if (!normalizedVote) throw new Error('Vote must be like or dislike.');

  await assertReactionTarget({ entryId, orgId, dateKey });

  const voterUserId = resolveVoterUserId(user);
  const ipAddress = String(ip || '').trim();
  if (!voterUserId && !ipAddress) throw new Error('Could not identify voter.');

  const voterDisplayName = await resolveVoterDisplayName(user);
  const commentPayload = normalizedVote === 'dislike' && dislikeComment !== undefined
    ? dislikeComment
    : undefined;

  await wordOfDayReactionModel.upsertReaction({
    entryId: String(entryId).trim(),
    orgId: String(orgId || '').trim(),
    dateKey: String(dateKey || '').trim(),
    vote: normalizedVote,
    voterUserId: voterUserId || null,
    ipAddress,
    userAgent,
    voterDisplayName,
    dislikeComment: commentPayload
  });

  await syncPublicFeedbackToEntry(entryId);

  return getSummaryForEntry(entryId, { user, ip });
}

module.exports = {
  GUEST_VOTER_LABEL,
  resolveVoterUserId,
  getSummaryForEntry,
  getStaffFeedbackForEntry,
  syncPublicFeedbackToEntry,
  buildPublicFeedbackFromReactions,
  setReaction,
  assertReactionTarget
};