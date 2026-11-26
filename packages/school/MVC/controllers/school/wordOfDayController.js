'use strict';

const wordOfDayService = require('../../services/school/wordOfDayService');
const wordOfDayAccessService = require('../../services/school/wordOfDayAccessService');
const wordOfDayModel = require('../../models/school/wordOfDayModel');
const wordOfDayDisplayService = require('../../services/school/wordOfDayDisplayService');
const wordOfDayPolicyModel = require('../../models/school/wordOfDayPolicyModel');
const schoolFileService = require('../../services/school/schoolFileService');
const { requireCoreModule } = require('../../services/school/schoolCoreModuleResolver');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
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
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch (_) {
    return {};
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
  return wordOfDayModel.sanitizeWordTypes([]);
}

function buildFormPayload(body = {}) {
  return {
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

async function baseViewModel(req, res, extra = {}) {
  const access = await getAccess(req);
  const stats = await wordOfDayService.summarizeAuthorStats(req.user, access);
  return {
    user: req.user,
    schoolSectionDashboardHref: res.locals.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL',
    actionStateId: res.locals.actionStateId || '',
    wordOfDayAccess: access,
    canManageAll: wordOfDayService.canManageAll(access),
    statuses: wordOfDayModel.WORD_OF_DAY_STATUSES,
    wordTypes: wordOfDayModel.WORD_TYPES,
    wordTypeLabels: wordOfDayModel.WORD_TYPE_LABELS,
    difficultyLevels: wordOfDayModel.DIFFICULTY_LEVELS,
    difficultyLabels: wordOfDayModel.DIFFICULTY_LABELS,
    authorStats: stats,
    ...extra
  };
}

async function resolveOrgDateKey(reqUser) {
  const orgId = wordOfDayService.getActiveOrgId(reqUser);
  let timezone = '';
  try {
    const org = orgId ? await schoolDataService.getDataById('organizations', orgId, reqUser) : null;
    timezone = resolveOrganizationTimezoneFromRow(org) || '';
  } catch (_) { /* optional */ }
  if (!timezone) timezone = 'UTC';
  return getTodayDateKeyInTimezone(timezone);
}

async function showList(req, res) {
  try {
    const access = await getAccess(req);
    const rows = await wordOfDayService.listEntries(req.user, {
      status: String(req.query?.status || '').trim() || undefined,
      view: String(req.query?.view || '').trim() || 'active'
    }, access);
    return res.render('school/wordOfDay/list', await baseViewModel(req, res, {
      title: 'Word of Day',
      entries: rows,
      listView: String(req.query?.view || '').toLowerCase() === 'archived' ? 'archived' : 'active'
    }));
  } catch (error) {
    return sendError(req, res, error);
  }
}

async function showNewForm(req, res) {
  try {
    const access = await getAccess(req);
    if (!access.canCreateWords) {
      return sendError(req, res, { message: 'You do not have permission to create words.', statusCode: 403 }, 403);
    }
    return res.render('school/wordOfDay/form', await baseViewModel(req, res, {
      title: 'New Word of Day',
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
      title: 'Edit Word of Day',
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

async function showDetail(req, res) {
  try {
    const access = await getAccess(req);
    const entry = await wordOfDayService.getEntry(req.user, req.params.id, access);
    if (!entry) return sendError(req, res, { message: 'Entry not found.', statusCode: 404 }, 404);
    const entryCapabilities = wordOfDayService.buildEntryCapabilities(entry, access, req.user);
    return res.render('school/wordOfDay/detail', await baseViewModel(req, res, {
      title: 'Word of Day Detail',
      entry,
      entryCapabilities
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
    return res.redirect(`/school/word-of-day/detail/${encodeURIComponent(created.id)}`);
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
    const orgId = wordOfDayService.getActiveOrgId(req.user);
    const word = String(req.body?.word ?? req.query?.word ?? '').trim();
    const excludeId = String(req.body?.excludeId ?? req.query?.excludeId ?? '').trim();
    if (!word) {
      return res.json({ status: 'success', duplicate: null });
    }
    const duplicate = await wordOfDayService.findDuplicateWord(orgId, word, excludeId);
    return res.json({
      status: 'success',
      duplicate: wordOfDayService.formatDuplicateSummary(duplicate)
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
    return res.redirect(`/school/word-of-day/detail/${encodeURIComponent(updated.id)}`);
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
    wordOfDayService.validateUploadedFile(req.file, kind);
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
      recordAnalytics: req.query?.preview !== '1'
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
  const result = await wordOfDayDisplayService.resolveDailyDisplay({
    orgId: sourceOrg,
    dateKey,
    recordAnalytics: true
  });
  return { enabled: true, ...result };
}

module.exports = {
  showList,
  showNewForm,
  showEditForm,
  showDetail,
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
  resolveOrgDateKey
};