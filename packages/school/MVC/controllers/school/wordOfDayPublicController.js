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
const wordOfDayController = require('./wordOfDayController');
const wordOfDayAccessService = require('../../services/school/wordOfDayAccessService');
const uploadStorageService = requireCoreModule('MVC/services/uploadStorageService');

const WORD_OF_DAY_PUBLIC_PAGE_CSS = 'wordOfDayPublicPage.css';
const FUTURE_DATE_MESSAGE = 'Future words are not published yet. You can browse today and previous days.';
const WORD_OF_DAY_TODAY_PATH = '/word-of-the-day/today';

function isTodayDateAlias(value) {
  return String(value || '').trim().toLowerCase() === 'today';
}

function shiftDateKey(dateKey, deltaDays) {
  const key = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateKey) {
  const key = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function defaultTodayKeyUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function resolvePublicTodayKey(req) {
  const orgId = await resolvePublicOrgId(req);
  if (orgId) {
    return wordOfDayController.resolveOrgDateKey(req.user || {}, orgId);
  }
  return defaultTodayKeyUtc();
}

function buildDateNavigation(dateKey, orgQuerySuffix = '', todayKey = '') {
  const suffix = String(orgQuerySuffix || '');
  const key = String(dateKey || '').trim();
  const today = String(todayKey || '').trim() || defaultTodayKeyUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return {
      formattedDateLabel: '',
      prevDateHref: `${WORD_OF_DAY_TODAY_PATH}${suffix}`,
      nextDateHref: '',
      todayHref: `${WORD_OF_DAY_TODAY_PATH}${suffix}`,
      isViewingToday: false,
      canGoNext: false,
      showTodayNav: true
    };
  }
  const mk = (dk) => `/word-of-the-day/${encodeURIComponent(dk)}${suffix}`;
  const isViewingToday = key === today;
  const canGoNext = key < today;
  return {
    formattedDateLabel: formatDateLabel(key),
    prevDateHref: mk(shiftDateKey(key, -1)),
    nextDateHref: canGoNext ? mk(shiftDateKey(key, 1)) : '',
    todayHref: `${WORD_OF_DAY_TODAY_PATH}${suffix}`,
    isViewingToday,
    canGoNext,
    showTodayNav: !isViewingToday
  };
}

function baseHtmlRenderLocals(req, extra = {}) {
  return {
    htmlClass: 'pte-public-root home-public-root',
    bodyClass: 'pte-public-body home-public-body public-zoom-centered-body',
    mainClass: 'container pte-public-main home-public-main',
    user: req.user || null,
    wordTypeLabels: wordOfDayModel.WORD_TYPE_LABELS,
    difficultyLabels: wordOfDayModel.DIFFICULTY_LABELS,
    wordOfDayUiConstants,
    pageCss: WORD_OF_DAY_PUBLIC_PAGE_CSS,
    pageScript: 'wordOfDayPublicClient.js',
    ...extra
  };
}

function sendError(req, res, error, fallback = 500) {
  const status = Number(error?.statusCode || error?.status || fallback) || fallback;
  const message = String(error?.message || 'Request failed.');
  if (req.accepts('html') && !req.xhr && req.method === 'GET') {
    let dateKey = resolveDateKeyParam(req);
    if (!dateKey && isTodayDateAlias(req.params?.dateKey)) {
      dateKey = defaultTodayKeyUtc();
    }
    const orgSuffix = String(req.query?.org || '').trim()
      ? `?org=${encodeURIComponent(toPublicId(String(req.query.org).trim()))}`
      : '';
    const dateNav = buildDateNavigation(dateKey, orgSuffix);
    return res.status(status).render('wordOfTheDay', baseHtmlRenderLocals(req, {
      title: `Word of the Day - ${appBrandingService.getBrand().appName}`,
      pageError: message,
      wordOfDayDetail: dateKey ? { dateKey, orgId: '', entry: null } : null,
      reactionSummary: { likes: 0, dislikes: 0, myVote: null },
      includeModal: false,
      ...dateNav,
      orgQuerySuffix: orgSuffix
    }));
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
  if (fromParam && !isTodayDateAlias(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) return fromParam;
  const fromQuery = String(req.query?.date || '').trim();
  if (fromQuery && !isTodayDateAlias(fromQuery) && /^\d{4}-\d{2}-\d{2}$/.test(fromQuery)) return fromQuery;
  return String(fallback || '').trim();
}

async function resolveRequestedDateKey(req) {
  const fromParam = String(req.params?.dateKey || '').trim();
  if (isTodayDateAlias(fromParam)) {
    return resolvePublicTodayKey(req);
  }
  const fromQuery = String(req.query?.date || '').trim();
  if (isTodayDateAlias(fromQuery)) {
    return resolvePublicTodayKey(req);
  }
  const resolved = resolveDateKeyParam(req);
  return resolved;
}

async function resolveCanExportWordOfDaySocialImage(req, { entry, dateKey, todayKey }) {
  if (!req.user || !entry || String(dateKey || '') !== String(todayKey || '')) {
    return false;
  }
  const access = await wordOfDayAccessService.buildWordOfDayAccess(req.user, req.ip);
  return wordOfDayAccessService.canExportWordOfDaySocialImage(access);
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
    const query = new URLSearchParams(req.query || {}).toString();
    const suffix = query ? `?${query}` : '';
    return res.redirect(301, `${WORD_OF_DAY_TODAY_PATH}${suffix}`);
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showByDate(req, res) {
  try {
    const dateKey = await resolveRequestedDateKey(req);
    if (!dateKey) return sendError(req, res, { message: 'Invalid date.', statusCode: 400 }, 400);

    const todayKey = await resolvePublicTodayKey(req);
    const orgId = await resolvePublicOrgId(req);
    const globalPolicy = await wordOfDayPolicyModel.getGlobalPublicPolicy();
    const orgQuerySuffix = buildOrgQuery(orgId, globalPolicy);
    const dateNav = buildDateNavigation(dateKey, orgQuerySuffix, todayKey);

    if (dateKey > todayKey) {
      return res.status(200).render('wordOfTheDay', baseHtmlRenderLocals(req, {
        title: `Word of the Day - ${appBrandingService.getBrand().appName}`,
        wordOfDayDetail: { orgId, dateKey, entry: null },
        reactionSummary: { likes: 0, dislikes: 0, myVote: null },
        orgQuerySuffix,
        includeModal: false,
        pageError: FUTURE_DATE_MESSAGE,
        ...dateNav
      }));
    }

    const detail = await loadDailyDetail(req, dateKey);
    const reactionSummary = detail?.entry?.id
      ? await wordOfDayReactionService.getSummaryForEntry(detail.entry.id, { user: req.user, ip: req.ip })
      : { likes: 0, dislikes: 0, myVote: null };

    const detailOrgQuerySuffix = buildOrgQuery(detail.orgId, globalPolicy);
    const detailDateNav = buildDateNavigation(dateKey, detailOrgQuerySuffix, todayKey);
    const canExportWordOfDaySocialImage = await resolveCanExportWordOfDaySocialImage(req, {
      entry: detail?.entry,
      dateKey,
      todayKey
    });

    return res.render('wordOfTheDay', baseHtmlRenderLocals(req, {
      title: detail?.entry?.word
        ? `${detail.entry.word} — Word of the Day`
        : `Word of the Day - ${appBrandingService.getBrand().appName}`,
      wordOfDayDetail: detail,
      reactionSummary,
      orgQuerySuffix: detailOrgQuerySuffix,
      includeModal: Boolean(detail?.entry?.photo?.url),
      pageError: null,
      canExportWordOfDaySocialImage,
      wordOfDayBrandName: appBrandingService.getBrand().appName || '',
      wordOfDaySocialExportPhotoSrc: (canExportWordOfDaySocialImage && detail?.entry?.photo?.url)
        ? buildSocialExportImageProxyPath(detail.entry.photo.url)
        : '',
      ...detailDateNav
    }));
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

function uploadsRefFromPublicUrl(url = '') {
  const token = String(url || '').trim();
  if (!token) return '';
  if (/^\/uploads\//i.test(token)) return token.split(/[?#]/)[0];
  const match = token.match(/(\/uploads\/[^\s?#]+)/i);
  return match ? match[1] : '';
}

function buildSocialExportImageProxyPath(uploadRef = '') {
  const ref = uploadsRefFromPublicUrl(uploadRef);
  if (!ref) return '';
  return `/word-of-the-day/api/social-export-image?ref=${encodeURIComponent(ref)}`;
}

async function getSocialExportImage(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Sign in required.' });
    }
    const access = await wordOfDayAccessService.buildWordOfDayAccess(req.user, req.ip);
    if (!wordOfDayAccessService.canExportWordOfDaySocialImage(access)) {
      return res.status(403).json({ status: 'error', message: 'Not allowed.' });
    }
    const ref = uploadsRefFromPublicUrl(req.query?.ref || req.query?.url || '');
    if (!ref || !/^\/uploads\//i.test(ref)) {
      return res.status(400).json({ status: 'error', message: 'Invalid image reference.' });
    }
    const normalized = uploadStorageService.normalizeReference(ref);
    const payload = await uploadStorageService.readBuffer(normalized);
    const mimeType = String(payload?.mimeType || '').trim() || 'image/jpeg';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=120');
    return res.send(payload.buffer);
  } catch (error) {
    return res.status(404).json({ status: 'error', message: 'Image not found.' });
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
  getSocialExportImage,
  buildSocialExportImageProxyPath,
  resolvePublicOrgId,
  buildDateNavigation,
  shiftDateKey,
  formatDateLabel,
  resolvePublicTodayKey,
  resolveRequestedDateKey,
  isTodayDateAlias,
  WORD_OF_DAY_TODAY_PATH,
  FUTURE_DATE_MESSAGE
};