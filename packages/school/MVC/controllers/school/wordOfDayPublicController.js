'use strict';

const { requireCoreModule } = require('../../services/school/schoolCoreModuleResolver');
const appBrandingService = requireCoreModule('MVC/services/appBrandingService');
const wordOfDayPolicyModel = require('../../models/school/wordOfDayPolicyModel');
const wordOfDayDisplayService = require('../../services/school/wordOfDayDisplayService');
const wordOfDayReactionService = require('../../services/school/wordOfDayReactionService');
const wordOfDayPageVisitService = require('../../services/school/wordOfDayPageVisitService');
const wordOfDayService = require('../../services/school/wordOfDayService');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const wordOfDayUiConstants = require('../../services/school/wordOfDayUiConstants');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function sendError(req, res, error, fallback = 500) {
  const status = Number(error?.statusCode || error?.status || fallback) || fallback;
  const message = String(error?.message || 'Request failed.');
  if (req.accepts('html') && !req.xhr && req.method === 'GET') {
    return res.status(status).render('wordOfTheDay', {
      title: `Word of the Day - ${appBrandingService.getBrand().appName}`,
      htmlClass: 'pte-public-root home-public-root',
      bodyClass: 'pte-public-body home-public-body public-zoom-centered-body',
      mainClass: 'container pte-public-main home-public-main',
      user: req.user || null,
      pageError: message,
      wordOfDayDetail: null,
      reactionSummary: { likes: 0, dislikes: 0, myVote: null },
      wordTypeLabels: wordOfDayModel.WORD_TYPE_LABELS,
      difficultyLabels: wordOfDayModel.DIFFICULTY_LABELS,
      wordOfDayUiConstants,
      includeModal: false,
      pageScript: 'wordOfDayPublicClient.js'
    });
  }
  return res.status(status).json({ status: 'error', message });
}

async function resolvePublicOrgId(req) {
  const queryOrg = toPublicId(String(req.query?.org || '').trim());
  const globalPolicy = await wordOfDayPolicyModel.getGlobalPublicPolicy();

  if (queryOrg) {
    const orgPolicy = await wordOfDayPolicyModel.getPolicyForOrg(queryOrg);
    const isPublicSource = globalPolicy.publicHomeEnabled && globalPolicy.publicSourceOrgId === queryOrg;
    const dashboardEnabled = orgPolicy.schoolDashboardEnabled !== false;
    if (isPublicSource || dashboardEnabled) return queryOrg;
    return '';
  }

  if (globalPolicy.publicHomeEnabled && globalPolicy.publicSourceOrgId) {
    return globalPolicy.publicSourceOrgId;
  }

  if (req.user) {
    const activeOrgId = wordOfDayService.getActiveOrgId(req.user);
    if (activeOrgId) {
      const policy = await wordOfDayPolicyModel.getPolicyForOrg(activeOrgId);
      if (policy.schoolDashboardEnabled !== false) return activeOrgId;
    }
  }
  return '';
}

function resolveDateKeyParam(req, fallback = '') {
  const fromParam = String(req.params?.dateKey || '').trim();
  if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) return fromParam;
  const fromQuery = String(req.query?.date || '').trim();
  if (fromQuery && /^\d{4}-\d{2}-\d{2}$/.test(fromQuery)) return fromQuery;
  return String(fallback || '').trim();
}

async function loadDailyDetail(req, dateKey) {
  const orgId = await resolvePublicOrgId(req);
  if (!orgId) {
    const error = new Error('Word of the Day is not available for this organization.');
    error.statusCode = 404;
    throw error;
  }
  const orgPolicy = await wordOfDayPolicyModel.getPolicyForOrg(orgId);
  const detail = await wordOfDayDisplayService.resolveDailyPublicDetail({
    orgId,
    dateKey,
    recordAnalytics: true,
    policy: orgPolicy
  });
  return detail;
}

function buildOrgQuery(orgId, globalPolicy) {
  const org = String(orgId || '').trim();
  const publicSource = String(globalPolicy?.publicSourceOrgId || '').trim();
  if (!org || (publicSource && org === publicSource)) return '';
  return `?org=${encodeURIComponent(org)}`;
}

async function showToday(req, res) {
  try {
    const dateKey = new Date().toISOString().slice(0, 10);
    const query = new URLSearchParams(req.query || {}).toString();
    const suffix = query ? `?${query}` : '';
    return res.redirect(301, `/word-of-the-day/${dateKey}${suffix}`);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showByDate(req, res) {
  try {
    const dateKey = resolveDateKeyParam(req);
    if (!dateKey) return sendError(req, res, { message: 'Invalid date.', statusCode: 400 }, 400);

    const detail = await loadDailyDetail(req, dateKey);
    const globalPolicy = await wordOfDayPolicyModel.getGlobalPublicPolicy();
    const reactionSummary = detail?.entry?.id
      ? await wordOfDayReactionService.getSummaryForEntry(detail.entry.id, { user: req.user, ip: req.ip })
      : { likes: 0, dislikes: 0, myVote: null };

  return res.render('wordOfTheDay', {
      title: detail?.entry?.word
        ? `${detail.entry.word} — Word of the Day`
        : `Word of the Day - ${appBrandingService.getBrand().appName}`,
      htmlClass: 'pte-public-root home-public-root',
      bodyClass: 'pte-public-body home-public-body public-zoom-centered-body',
      mainClass: 'container pte-public-main home-public-main',
      user: req.user || null,
      wordOfDayDetail: detail,
      reactionSummary,
      orgQuerySuffix: buildOrgQuery(detail.orgId, globalPolicy),
      wordTypeLabels: wordOfDayModel.WORD_TYPE_LABELS,
      difficultyLabels: wordOfDayModel.DIFFICULTY_LABELS,
      wordOfDayUiConstants,
      includeModal: Boolean(detail?.entry?.photo?.url),
      pageScript: 'wordOfDayPublicClient.js',
      pageError: null
    });
  } catch (error) {
    return sendError(req, res, error, error.statusCode || 500);
  }
}

async function getReactionSummary(req, res) {
  try {
    const entryId = String(req.params?.entryId || '').trim();
    if (!entryId) return res.status(400).json({ status: 'error', message: 'Entry id required.' });
    const row = await wordOfDayDisplayService.getApprovedEntryRowById(entryId);
    if (!row) return res.status(404).json({ status: 'error', message: 'Entry not found.' });
    const summary = await wordOfDayReactionService.getSummaryForEntry(entryId, { user: req.user, ip: req.ip });
    return res.json({ status: 'success', ...summary });
  } catch (error) {
    return sendError(req, res, error, error.statusCode || 500);
  }
}

async function postReaction(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const summary = await wordOfDayReactionService.setReaction({
      entryId: body.entryId || body.entry_id,
      orgId: body.orgId || body.org_id,
      dateKey: body.dateKey || body.date_key,
      vote: body.vote,
      dislikeComment: body.dislikeComment ?? body.dislike_comment,
      user: req.user,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] || '').trim()
    });
    return res.json({ status: 'success', ...summary });
  } catch (error) {
    const status = Number(error?.statusCode || 400);
    return res.status(status).json({ status: 'error', message: String(error?.message || 'Request failed.') });
  }
}

async function postPageVisit(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    await wordOfDayPageVisitService.recordQualifiedVisit({
      entryId: body.entryId || body.entry_id,
      orgId: body.orgId || body.org_id,
      dateKey: body.dateKey || body.date_key,
      viewSessionId: body.viewSessionId || body.view_session_id,
      durationMs: body.durationMs ?? body.duration_ms,
      user: req.user,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] || '').trim()
    });
    return res.json({ status: 'success', recorded: true });
  } catch (error) {
    const status = Number(error?.statusCode || 400);
    return res.status(status).json({ status: 'error', message: String(error?.message || 'Request failed.') });
  }
}

module.exports = {
  showToday,
  showByDate,
  getReactionSummary,
  postReaction,
  postPageVisit,
  resolvePublicOrgId
};