'use strict';

const wordOfDayService = require('../../services/school/wordOfDayService');
const wordOfDayAccessService = require('../../services/school/wordOfDayAccessService');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const wordOfDayDisplayService = require('../../services/school/wordOfDayDisplayService');
const wordOfDayDisplayScheduleService = require('../../services/school/wordOfDayDisplayScheduleService');
const wordOfDayPageVisitService = require('../../services/school/wordOfDayPageVisitService');
const uploadLimitsPolicyService = require('../../services/school/uploadLimitsPolicyService');
const wordOfDayPolicyModel = require('../../models/school/wordOfDayPolicyModel');
const schoolFileService = require('../../services/school/schoolFileService');
const { requireCoreModule } = require('../../services/school/schoolCoreModuleResolver');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const settingService = requireCoreModule('MVC/services/settingService');
const { getTodayDateKeyInTimezone, resolveOrganizationTimezoneFromRow } = requireCoreModule('MVC/utils/timezoneUtils');
const schoolDataService = require('../../services/school/schoolDataService');

function wantsJson(req) {
  return isAjax(req) || String(req.headers.accept || '').includes('application/json');
}

function statusCode(error, fallback = 500) {
  return Number(error?.statusCode) || fallback;
}

function sendError(req, res, error, fallback = 500) {
  const code = statusCode(error, fallback);
  const message = error?.message || 'Unexpected error.';
  if (wantsJson(req)) {
    return res.status(code).json({
      status: 'error',
      message,
      code: error?.code || undefined
    });
  }
  return res.status(code).render('error', { title: 'Error', message, user: req.user || null });
}

function parseExamples(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return wordOfDayModel.sanitizeExamples(raw);
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    return wordOfDayModel.sanitizeExamples(JSON.parse(text));
  } catch (_) {
    return wordOfDayModel.sanitizeExamples([text]);
  }
}

function parseMediaRef(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch (_) {
    return undefined;
  }
}

function parseWordTypes(body = {}) {
  if (Array.isArray(body.wordTypes)) {
    return wordOfDayModel.sanitizeWordTypes(body.wordTypes);
  }
  const raw = body.wordTypes;
  if (typeof raw === 'string' && raw.trim()) {
    return wordOfDayModel.sanitizeWordTypes(raw);
  }
  if (body.wordType) {
    return wordOfDayModel.sanitizeWordTypes([], body.wordType);
  }
  return undefined;
}

function buildFormPayload(body = {}) {
  const payload = {
    word: body.word,
    wordTypes: parseWordTypes(body),
    pronunciation: body.pronunciation,
    difficulty: body.difficulty,
    meaning: body.meaning,
    examples: parseExamples(body.examples),
    photo: parseMediaRef(body.photo),
    audio: parseMediaRef(body.audio),
    videoUrl: body.videoUrl,
    authorUserId: body.authorUserId,
    authorName: body.authorName
  };
  const out = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) out[key] = value;
  });
  if (['1', 'true', true, 'on'].includes(body.clearWorkflowNote)) {
    out.clearWorkflowNote = true;
  }
  return out;
}

function resolveAccessOptions(body = {}) {
  return {
    confirmDisplayRisk: ['1', 'true', true].includes(body.confirmDisplayRisk),
    note: body.note || ''
  };
}

async function getAccess(req) {
  return req._wordOfDayAccess || wordOfDayAccessService.buildWordOfDayAccess(req.user, req.ip);
}

async function assertConfigureDisplay(req) {
  const access = await getAccess(req);
  if (!access.canConfigureDisplay) {
    const error = new Error('You do not have permission to configure Word of Day display.');
    error.statusCode = 403;
    throw error;
  }
  return access;
}

async function baseViewModel(req, res, extra = {}) {
  const access = await getAccess(req);
  const stats = await wordOfDayService.summarizeAuthorStats(req.user, access);
  const orgId = wordOfDayService.getActiveOrgId(req.user);
  const wordOfDayPolicy = orgId ? await wordOfDayPolicyModel.getPolicyForOrg(orgId) : null;
  const contributionYear = wordOfDayService.currentCalendarYear();
  const contributionLimit = Number(wordOfDayPolicy?.yearlyContributionLimitPerUser || 0);
  const authorUserId = String(req.user?.id || req.user?.userId || '').trim();
  const currentYearContributionCount = (orgId && authorUserId)
    ? await wordOfDayService.countAuthorContributionsForYear(orgId, authorUserId, contributionYear)
    : 0;
  const contributionQuotaExempt = wordOfDayService.isContributionQuotaExempt(access);
  return {
    user: req.user,
    schoolSectionDashboardHref: res.locals.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL',
    actionStateId: req.actionStateId || res.locals.actionStateId || '',
    includeModal: true,
    wordOfDayAccess: access,
    canManageAll: wordOfDayService.canManageAll(access),
    statuses: wordOfDayModel.WORD_OF_DAY_STATUSES,
    wordTypes: wordOfDayModel.WORD_TYPES,
    wordTypeLabels: wordOfDayModel.WORD_TYPE_LABELS,
    difficultyLevels: wordOfDayModel.DIFFICULTY_LEVELS,
    difficultyLabels: wordOfDayModel.DIFFICULTY_LABELS,
    authorStats: stats,
    wordOfDayContributionLimit: contributionLimit,
    wordOfDayContributionYear: contributionYear,
    wordOfDayCurrentYearContributionCount: currentYearContributionCount,
    wordOfDayContributionQuotaExempt: contributionQuotaExempt,
    ...extra
  };
}

async function resolveOrgDateKey(reqUser, orgIdOverride = '') {
  const orgId = String(orgIdOverride || '').trim() || wordOfDayService.getActiveOrgId(reqUser);
  let timezone = '';
  try {
    const org = orgId ? await schoolDataService.getDataById('organizations', orgId, reqUser) : null;
    timezone = resolveOrganizationTimezoneFromRow(org) || '';
  } catch (_) { /* optional */ }
  if (!timezone) timezone = 'UTC';
  return getTodayDateKeyInTimezone(timezone);
}

function resolveListViewMode(query = {}) {
  const view = String(query?.view || '').toLowerCase();
  if (view === 'archived') return 'archived';
  if (view === 'review') return 'review';
  return 'active';
}

function listTitleForView(listView) {
  if (listView === 'archived') return 'Word of the Day — Archived';
  if (listView === 'review') return 'Word of the Day — Review queue';
  return 'Word of the Day';
}

async function showList(req, res) {
  try {
    const access = await getAccess(req);
    const listView = resolveListViewMode(req.query || {});
    const query = await buildDataServiceQuery(req.query, {
      allowedExactKeys: ['view', 'status', 'openReview', 'openEntry']
    });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    let rows = await wordOfDayService.listEntries(req.user, {
      status: String(req.query?.status || '').trim() || undefined,
      view: listView
    }, access);
    const searchableFields = ['word', 'meaning', 'pronunciation', 'status', 'authorName', 'difficulty'];
    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });
    rows = rows.sort((a, b) => String(a?.word || '').localeCompare(String(b?.word || ''), undefined, { sensitivity: 'base' }));
    const { data, pagination } = paginate(rows, query.page, query.limit);

    const entries = data.map((row) => ({
      ...row,
      capabilities: wordOfDayService.buildEntryCapabilities(row, access, req.user)
    }));

    const openReview = ['1', 'true', true].includes(req.query?.openReview);
    const openEntryId = String(req.query?.openEntry || '').trim();
    const newLabel = access.canCreateWords && listView !== 'archived' ? 'New word' : null;

    if (isAjax(req)) {
      return res.json({ status: 'success', results: entries, pagination });
    }

    return res.render('school/wordOfDay/list', await baseViewModel(req, res, {
      title: listTitleForView(listView),
      data: entries,
      entries,
      listView,
      openReview,
      openReviewModal: openReview,
      openEntryId,
      newUrl: 'school/word-of-day',
      newLabel,
      searchableFields,
      includeModal_Table: true,
      print: false,
      btn_export: false,
      pagination,
      filters: req.query,
      actionStateId: req.actionStateId || res.locals.actionStateId || ''
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showReviewList(req, res) {
  try {
    const access = await getAccess(req);
    if (!access.canResolveWords) {
      return sendError(req, res, {
        message: 'You do not have permission to review words.',
        statusCode: 403
      }, 403);
    }
    return res.redirect('/school/word-of-day?openReview=1');
  } catch (error) {
    return sendError(req, res, error);
  }
}

function parseReviewSearchPayload(body = {}) {
  const authorUserIds = Array.isArray(body.authorUserIds)
    ? body.authorUserIds
    : (body.authorUserIds ? [body.authorUserIds] : []);
  const statuses = Array.isArray(body.statuses)
    ? body.statuses
    : (body.statuses ? String(body.statuses).split(',') : []);
  return {
    dateFrom: String(body.dateFrom || '').trim(),
    dateTo: String(body.dateTo || '').trim(),
    authorUserIds: authorUserIds.map((id) => String(id || '').trim()).filter(Boolean),
    statuses: statuses.map((s) => String(s || '').trim()).filter(Boolean),
    text: String(body.text || '').trim()
  };
}

async function postReviewSearch(req, res) {
  try {
    const access = await getAccess(req);
    const entries = await wordOfDayService.searchForReview(
      req.user,
      parseReviewSearchPayload(req.body),
      access
    );
    return res.json({
      status: 'success',
      entries
    });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function getReviewDetail(req, res) {
  try {
    const access = await getAccess(req);
    if (!access.canResolveWords) {
      return sendError(req, res, { message: 'Not authorized.', statusCode: 403 }, 403);
    }
    const entry = await wordOfDayService.getEntry(req.user, req.params.id, access);
    if (!entry) return sendError(req, res, { message: 'Entry not found.', statusCode: 404 }, 404);
    const base = await baseViewModel(req, res, {});
    return res.json({
      status: 'success',
      entry,
      capabilities: wordOfDayService.buildEntryCapabilities(entry, access, req.user),
      wordTypeLabels: base.wordTypeLabels,
      difficultyLabels: base.difficultyLabels
    });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function getEntryDetail(req, res) {
  try {
    const access = await getAccess(req);
    const entry = await wordOfDayService.getEntry(req.user, req.params.id, access);
    if (!entry) return sendError(req, res, { message: 'Entry not found.', statusCode: 404 }, 404);
    const base = await baseViewModel(req, res, {});
    return res.json({
      status: 'success',
      entry,
      capabilities: wordOfDayService.buildEntryCapabilities(entry, access, req.user),
      wordTypeLabels: base.wordTypeLabels,
      difficultyLabels: base.difficultyLabels
    });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function getEntryPublicFeedback(req, res) {
  try {
    const access = await getAccess(req);
    const entry = await wordOfDayService.getEntry(req.user, req.params.id, access);
    if (!entry) return sendError(req, res, { message: 'Entry not found.', statusCode: 404 }, 404);
    const report = await wordOfDayPageVisitService.getStaffEngagementReport(entry.id);
    return res.json({
      status: 'success',
      entryId: entry.id,
      word: entry.word,
      publicFeedback: report.publicFeedback,
      reactionVoters: report.reactionVoters,
      pageVisits: report.pageVisits
    });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function showNewForm(req, res) {
  try {
    const access = await getAccess(req);
    if (!access.canCreateWords) {
      return sendError(req, res, { message: 'You do not have permission to create words.', statusCode: 403 }, 403);
    }
    return res.render('school/wordOfDay/form', await baseViewModel(req, res, {
      title: 'New Word of the Day',
      mode: 'create',
      entry: null,
      entryId: '',
      formAction: '/school/word-of-day/new'
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showEditForm(req, res) {
  try {
    const access = await getAccess(req);
    const entry = await wordOfDayService.getEntry(req.user, req.params.id, access);
    if (!entry) return sendError(req, res, { message: 'Entry not found.', statusCode: 404 }, 404);
    const entryCapabilities = wordOfDayService.buildEntryCapabilities(entry, access, req.user);
    return res.render('school/wordOfDay/form', await baseViewModel(req, res, {
      title: 'Edit Word of the Day',
      mode: 'edit',
      entry,
      entryId: entry.id,
      entryCapabilities,
      formAction: `/school/word-of-day/edit/${encodeURIComponent(req.params.id)}`
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function createEntry(req, res) {
  try {
    const access = await getAccess(req);
    const saveAs = req.body?.saveAction === 'submit' ? 'submitted' : 'saved';
    const created = await wordOfDayService.createEntry(req.user, buildFormPayload(req.body), { saveAs, access });
    if (wantsJson(req)) return res.json({ status: 'success', entry: created });
    return res.redirect('/school/word-of-day');
  } catch (error) {
    if (error?.code === 'WORD_OF_DAY_DUPLICATE' && wantsJson(req)) {
      return res.status(409).json({
        status: 'error',
        code: error.code,
        message: error.message,
        duplicate: error.duplicate
      });
    }
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function checkDuplicateWord(req, res) {
  try {
    const access = await getAccess(req);
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const word = String(req.body?.word ?? req.query?.word ?? '').trim();
    const excludeId = String(req.body?.excludeId ?? req.query?.excludeId ?? '').trim();
    if (!word) {
      return res.json({ status: 'success', duplicate: null });
    }
    const duplicate = await wordOfDayService.findDuplicateWord(orgId, word, excludeId);
    const actorId = wordOfDayService.getActorId(req.user);
    return res.json({
      status: 'success',
      duplicate: wordOfDayService.formatDuplicateSummary(duplicate, {
        access,
        actorId,
        currentYear: wordOfDayService.currentCalendarYear()
      })
    });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function updateEntry(req, res) {
  try {
    const access = await getAccess(req);
    const saveAs = req.body?.saveAction === 'submit' ? 'submitted' : (req.body?.saveAction === 'saved' ? 'saved' : undefined);
    const updated = await wordOfDayService.updateEntry(req.user, req.params.id, buildFormPayload(req.body), { saveAs, access });
    if (wantsJson(req)) return res.json({ status: 'success', entry: updated });
    return res.redirect('/school/word-of-day');
  } catch (error) {
    if (error?.code === 'WORD_OF_DAY_DUPLICATE' && wantsJson(req)) {
      return res.status(409).json({
        status: 'error',
        code: error.code,
        message: error.message,
        duplicate: error.duplicate
      });
    }
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function submitEntry(req, res) {
  try {
    const access = await getAccess(req);
    const row = await wordOfDayService.submitEntry(req.user, req.params.id, access, resolveAccessOptions(req.body));
    return res.json({ status: 'success', message: 'Submitted for review.', entry: row });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function approveEntry(req, res) {
  try {
    const access = await getAccess(req);
    const row = await wordOfDayService.approveEntry(req.user, req.params.id, req.body?.note || '', access, resolveAccessOptions(req.body));
    return res.json({ status: 'success', message: 'Entry approved.', entry: row });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function rejectEntry(req, res) {
  try {
    const access = await getAccess(req);
    const row = await wordOfDayService.rejectEntry(req.user, req.params.id, req.body?.note || '', access, resolveAccessOptions(req.body));
    return res.json({ status: 'success', message: 'Entry rejected.', entry: row });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function reopenEntry(req, res) {
  try {
    const access = await getAccess(req);
    const row = await wordOfDayService.reopenEntry(req.user, req.params.id, req.body?.note || '', access, resolveAccessOptions(req.body));
    return res.json({ status: 'success', message: 'Entry reopened for editing.', entry: row });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function holdEntry(req, res) {
  try {
    const access = await getAccess(req);
    const row = await wordOfDayService.holdEntry(req.user, req.params.id, req.body?.note || '', access, resolveAccessOptions(req.body));
    return res.json({ status: 'success', message: 'Entry placed on hold.', entry: row });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function archiveEntry(req, res) {
  try {
    const access = await getAccess(req);
    const row = await wordOfDayService.archiveEntry(req.user, req.params.id, req.body?.note || '', access, resolveAccessOptions(req.body));
    return res.json({ status: 'success', message: 'Entry archived.', entry: row });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function deleteEntry(req, res) {
  try {
    const access = await getAccess(req);
    await wordOfDayService.deleteEntry(req.user, req.params.id, access, resolveAccessOptions(req.body));
    if (wantsJson(req)) return res.json({ status: 'success', message: 'Entry deleted.' });
    return res.redirect('/school/word-of-day');
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function uploadMedia(req, res) {
  try {
    const kind = String(req.body?.kind || req.query?.kind || 'photo').toLowerCase() === 'audio' ? 'audio' : 'photo';
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const sectionKey = kind === 'audio' ? 'wordOfDayAudio' : 'wordOfDayPhoto';
    const maxMb = await uploadLimitsPolicyService.resolveMaxFileSizeMb(orgId, sectionKey);
    wordOfDayService.validateUploadedFile(req.file, kind, maxMb * 1024 * 1024);
    const normalized = schoolFileService.normalizeUploadedFile(req.file, {
      kind: `word_of_day_${kind}`,
      uploadedBy: req.user?.id
    });
    const payload = {
      url: normalized.url || normalized.path,
      fileName: normalized.originalName || normalized.name,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.size || normalized.sizeBytes || 0
    };
    return res.json({ status: 'success', kind, media: payload });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function getDailyWidgetPayload(req, res) {
  try {
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const policy = await wordOfDayPolicyModel.getPolicyForOrg(orgId);
    if (policy.schoolDashboardEnabled === false) {
      return res.json({ status: 'success', enabled: false, entry: null });
    }
    const dateKey = await resolveOrgDateKey(req.user);
    const result = await wordOfDayDisplayService.resolveDailyDisplay({
      orgId,
      dateKey,
      recordAnalytics: req.query?.preview !== '1',
      policy
    });
    return res.json({ status: 'success', enabled: true, ...result });
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function getPublicDailyPayload(orgId, dateKey) {
  const policy = await wordOfDayPolicyModel.getGlobalPublicPolicy();
  if (!policy.publicHomeEnabled) return { enabled: false, entry: null, dateKey };
  const sourceOrg = String(policy.publicSourceOrgId || orgId || '').trim();
  if (!sourceOrg) return { enabled: false, entry: null, dateKey };
  const orgPolicy = await wordOfDayPolicyModel.getPolicyForOrg(sourceOrg);
  const result = await wordOfDayDisplayService.resolveDailyDisplay({
    orgId: sourceOrg,
    dateKey,
    recordAnalytics: true,
    policy: orgPolicy
  });
  return { enabled: true, ...result };
}

async function getDisplaySchedule(req, res) {
  try {
    await assertConfigureDisplay(req);
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    const payload = await wordOfDayDisplayScheduleService.listScheduleRange({ orgId, from, to });
    return res.json({ status: 'success', ...payload });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function putDisplaySchedule(req, res) {
  try {
    await assertConfigureDisplay(req);
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const dateKey = String(req.body?.dateKey || '').trim();
    const entryIdRaw = req.body?.entryId;
  const entryId = entryIdRaw === null || entryIdRaw === '' || entryIdRaw === undefined
      ? ''
      : String(entryIdRaw).trim();
    if (!entryId) {
      await wordOfDayDisplayScheduleService.clearScheduledDate({
        orgId,
        dateKey,
        auditUserId: req.user?.id
      });
      return res.json({ status: 'success', message: 'Schedule cleared for date.', dateKey });
    }
    await wordOfDayDisplayScheduleService.assignScheduledDate({
      orgId,
      dateKey,
      entryId,
      auditUserId: req.user?.id
    });
    return res.json({ status: 'success', message: 'Word scheduled for date.', dateKey, entryId });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

async function getDisplaySchedulePicker(req, res) {
  try {
    await assertConfigureDisplay(req);
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const q = String(req.query?.q || '').trim();
    const limit = Number(req.query?.limit) || 20;
    const items = await wordOfDayDisplayScheduleService.searchApprovedForPicker({ orgId, q, limit });
    return res.json({ status: 'success', items });
  } catch (error) {
    return sendError(req, res, error, statusCode(error, 400));
  }
}

module.exports = {
  showList,
  showReviewList,
  postReviewSearch,
  getReviewDetail,
  getEntryDetail,
  getEntryPublicFeedback,
  showNewForm,
  showEditForm,
  checkDuplicateWord,
  createEntry,
  updateEntry,
  submitEntry,
  approveEntry,
  rejectEntry,
  reopenEntry,
  holdEntry,
  archiveEntry,
  deleteEntry,
  uploadMedia,
  getDailyWidgetPayload,
  getPublicDailyPayload,
  getDisplaySchedule,
  putDisplaySchedule,
  getDisplaySchedulePicker,
  resolveOrgDateKey
};