const path = require('path');
const crypto = require('crypto');
const {
  paginate,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  pteUploadPathUtils,
  coreFilesService,
  uploadMiddleware,
  settingService,
  pteQuestionBankDataService,
  questionBankAiAutofillService,
  pteQuestionScoringProfileService,
  adminChekersService
} = require('./questionBankControllerDependencies');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'orgId',
    'familyId',
    'revisionNumber',
    'isLatestRevision',
    'status',
    'practiceEnabled',
    'testType',
    'skill',
    'questionType',
    'difficulty',
    'creator.userId',
    'transcriptArtifactSearch'
  ],
  defaultSearchFields: [
    'id',
    'familyId',
    'code',
    'title',
    'testType',
    'skill',
    'questionType',
    'status',
    'practiceEnabled',
    'difficulty',
    'tags',
    'creator.displayName',
    'creator.userId'
  ],
  allowMetaKeys: true
});

const FAMILY_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'familyId', 'status', 'testType', 'skill', 'questionType'],
  defaultSearchFields: ['id', 'familyId', 'title', 'code', 'status', 'testType', 'skill', 'questionType'],
  allowMetaKeys: true
});

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeTestType(value, fallback = '') {
  const token = cleanText(value, 40).toLowerCase();
  if (token === 'core' || token === 'academic') return token;
  const fallbackToken = cleanText(fallback, 40).toLowerCase();
  return fallbackToken === 'core' || fallbackToken === 'academic' ? fallbackToken : '';
}

function parseMaybeJson(input, fallback = null) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid question payload.');
  }
}

function parseBulkIdList(rawInput) {
  let rawRows = [];
  if (Array.isArray(rawInput)) {
    rawRows = rawInput;
  } else if (typeof rawInput === 'string') {
    rawRows = rawInput.split(',');
  } else if (rawInput !== undefined && rawInput !== null) {
    rawRows = [rawInput];
  }
  return Array.from(new Set(
    rawRows
      .map((row) => cleanText(row, 120))
      .filter(Boolean)
  ));
}

function buildBulkActionSummary(actionLabel = 'Updated', successCount = 0, failedCount = 0) {
  const okLabel = `${Number(successCount)} question${Number(successCount) === 1 ? '' : 's'} ${actionLabel.toLowerCase()}.`;
  if (Number(failedCount) <= 0) return okLabel;
  return `${okLabel} ${Number(failedCount)} failed.`;
}

function buildAttachmentUrlFromPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim();
  if (!normalized) return '';
  if (/^\/uploads\//i.test(normalized)) return normalized;
  const dirPath = path.dirname(normalized);
  const dirUrl = coreFilesService.getWebUrlForUpload(dirPath);
  const filename = path.basename(normalized);
  if (!dirUrl || !filename) return '';
  return `${dirUrl}/${filename}`;
}

function normalizeAbsolutePath(inputPath = '') {
  const token = String(inputPath || '').trim();
  if (!token) return '';
  return path.resolve(token);
}

function normalizePathForCompare(inputPath = '') {
  const resolved = normalizeAbsolutePath(inputPath);
  if (!resolved) return '';
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideBase(basePath = '', targetPath = '') {
  const base = normalizePathForCompare(basePath);
  const target = normalizePathForCompare(targetPath);
  if (!base || !target) return false;
  if (base === target) return true;
  const relative = path.relative(base, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveScopeIdToken(orgId = '') {
  const token = cleanText(orgId, 120);
  if (!token || token.toUpperCase() === 'SYSTEM') return 'GLOBAL';
  if (token.toUpperCase().startsWith('ORG_')) return token.slice(4);
  return token;
}

function getQuestionBankMediaRoot(orgId = '') {
  const scopeId = resolveScopeIdToken(orgId);
  const scopedRoot = coreFilesService.getRootPath(scopeId);
  return normalizeAbsolutePath(coreFilesService.resolveSafePath(scopedRoot, pteUploadPathUtils.getQuestionBankRoot()));
}

function getLegacyQuestionBankMediaRoot(orgId = '') {
  const scopeId = resolveScopeIdToken(orgId);
  const scopedRoot = coreFilesService.getRootPath(scopeId);
  return normalizeAbsolutePath(coreFilesService.resolveSafePath(scopedRoot, 'pte-question-bank'));
}

function getAllowedQuestionBankRoots(orgId = '') {
  return [
    getQuestionBankMediaRoot(orgId),
    getLegacyQuestionBankMediaRoot(orgId)
  ].filter(Boolean);
}

function resolveDiskPathFromUploadsUrl(fileUrl = '') {
  const token = cleanText(fileUrl, 1600);
  if (!token) return '';
  return normalizeAbsolutePath(coreFilesService.fromUploadsUrlToDiskPath(token));
}

function normalizeSafeQuestionBankPath(filePath = '', fileUrl = '', orgId = '') {
  const mediaRoots = getAllowedQuestionBankRoots(orgId);
  if (!mediaRoots.length) return '';

  const directPath = normalizeAbsolutePath(filePath);
  if (directPath && mediaRoots.some((root) => isPathInsideBase(root, directPath))) return directPath;

  const fromUrl = resolveDiskPathFromUploadsUrl(fileUrl) || resolveDiskPathFromUploadsUrl(filePath);
  if (fromUrl && mediaRoots.some((root) => isPathInsideBase(root, fromUrl))) return fromUrl;

  return '';
}

function toCanonicalUploadReference(filePath = '', fileUrl = '') {
  const fromUrl = coreFilesService.extractRelativeUploadPath(fileUrl);
  if (fromUrl) return `/uploads/${fromUrl}`;
  const fromPathUrl = coreFilesService.extractRelativeUploadPath(filePath);
  if (fromPathUrl) return `/uploads/${fromPathUrl}`;
  return coreFilesService.fromDiskPathToUploadsUrl(filePath) || String(filePath || '').replace(/\\/g, '/').trim();
}

function sanitizeIncomingMediaRows(mediaRows = [], orgId = '') {
  const rows = Array.isArray(mediaRows) ? mediaRows : [];
  return rows.map((rawRow, index) => {
    const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
    const rawPath = cleanText(row.path, 1600);
    const rawUrl = cleanText(row.url, 1600);
    const hasFileReference = Boolean(rawPath || rawUrl);
    const safePath = normalizeSafeQuestionBankPath(rawPath, rawUrl, orgId);
    if (hasFileReference && !safePath) {
      throw new Error(`Invalid media path at row ${index + 1}.`);
    }

    const normalizedPath = safePath ? toCanonicalUploadReference(safePath, rawUrl || rawPath) : '';
    const normalizedUrl = normalizedPath ? toCanonicalUploadReference(normalizedPath, normalizedPath) : '';
    return {
      id: cleanText(row.id, 140) || `QMEDIA-${Date.now()}-${index + 1}`,
      name: cleanText(row.name, 260) || cleanText(row.originalName, 260) || cleanText(row.filename, 260),
      originalName: cleanText(row.originalName, 260) || cleanText(row.name, 260) || cleanText(row.filename, 260),
      filename: cleanText(row.filename, 260) || (normalizedPath ? path.basename(normalizedPath) : ''),
      path: normalizedPath,
      url: normalizedUrl,
      mimeType: cleanText(row.mimeType, 120),
      size: Number(row.size || 0) || 0,
      uploadDate: cleanText(row.uploadDate, 80) || new Date().toISOString(),
      comment: cleanText(row.comment, 1200)
    };
  });
}

function buildUploadedMediaRows(reqFiles = []) {
  const rows = Array.isArray(reqFiles) ? reqFiles : [];
  return rows.map((file) => {
    const storedPath = String(uploadMiddleware.getStoredFilePath(file) || '').replace(/\\/g, '/');
    const normalizedPath = toCanonicalUploadReference(storedPath, storedPath);
    const normalizedUrl = toCanonicalUploadReference(normalizedPath, normalizedPath);
    return {
      id: crypto.randomBytes(8).toString('hex'),
      name: cleanText(file.originalname, 260) || cleanText(file.filename, 260),
      originalName: cleanText(file.originalname, 260),
      filename: cleanText(file.filename, 260),
      path: normalizedPath,
      url: normalizedUrl,
      mimeType: cleanText(file.mimetype, 120),
      size: Number(file.size || 0) || 0,
      uploadDate: new Date().toISOString(),
      comment: ''
    };
  });
}

function mergeMediaRows(existingMedia, reqFiles) {
  const base = Array.isArray(existingMedia) ? existingMedia.slice() : [];
  const uploaded = buildUploadedMediaRows(reqFiles);
  return [...base, ...uploaded];
}

function resolveMediaDiskPath(media, orgId = '') {
  return normalizeSafeQuestionBankPath(media?.path, media?.url, orgId);
}

function findMediaById(mediaAssets = [], mediaId = '') {
  const list = Array.isArray(mediaAssets) ? mediaAssets : [];
  const token = String(mediaId || '').trim();
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    const index = Number(token);
    if (index >= 0 && index < list.length) return list[index];
    return null;
  }
  return list.find((row) => String(row?.id || '').trim() === token) || null;
}

function buildScopeUploadPrefix(orgId = '') {
  const token = cleanText(orgId, 120);
  if (!token || token.toUpperCase() === 'SYSTEM') return '/uploads/GLOBAL';
  return `/uploads/${token.toUpperCase().startsWith('ORG_') ? token : `ORG_${token}`}`;
}

function encodeUploadUrl(uploadPath = '') {
  const normalized = String(uploadPath || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return '';
  return normalized
    .split('/')
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join('/');
}

function buildGatewayMediaLibraryRow(item = {}, orgId = '', currentFolder = '') {
  const fileName = cleanText(item.name, 260);
  const folder = normalizeRelativeFolderToken(currentFolder);
  const uploadPath = `${buildScopeUploadPrefix(orgId)}/${[folder, fileName].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
  const digest = crypto.createHash('md5').update(uploadPath).digest('hex');
  return {
    id: `LIB_${digest}`,
    name: fileName,
    originalName: fileName,
    filename: fileName,
    path: uploadPath,
    url: encodeUploadUrl(uploadPath),
    mimeType: '',
    size: Number(item.size || 0) || 0,
    uploadDate: item.modified ? new Date(item.modified).toISOString() : '',
    comment: '',
    source: 'saved_library'
  };
}

function resolveDefaultPageSize() {
  const raw = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw) || raw <= 0) return 30;
  return Math.max(5, Math.min(500, raw));
}

function normalizeRelativeFolderToken(value, max = 800) {
  const token = cleanText(value, max).replace(/\\/g, '/');
  if (!token || token === '/' || token === '.') return '';
  const compact = token
    .split('/')
    .map((part) => cleanText(part, 200))
    .filter(Boolean)
    .join('/');
  if (!compact || compact === '.') return '';
  return compact.replace(/^\/+/, '').replace(/\/+$/, '');
}

async function listOrgMediaLibrary(req, res) {
  try {
    const defaultPageSize = resolveDefaultPageSize();
    const defaultFolder = pteUploadPathUtils.getQuestionBankRoot();
    const activeOrgId = String(req.user?.activeOrgId || '').trim();
    if (!activeOrgId || activeOrgId.toUpperCase() === 'SYSTEM') {
      return res.json({
        status: 'success',
        message: 'Media library is available for organization scope only.',
        results: [],
        folders: [],
        currentFolder: '',
        parentFolder: '',
        defaultFolder,
        defaults: { pageSize: defaultPageSize }
      });
    }

    const requestedFolder = normalizeRelativeFolderToken(req.query?.folder);
    const candidateFolders = requestedFolder
      ? [requestedFolder, defaultFolder, '']
      : [defaultFolder, ''];
    const scopeKey = resolveScopeIdToken(activeOrgId);
    let currentFolder = '';
    let entries = [];
    for (const folderToken of candidateFolders) {
      // eslint-disable-next-line no-await-in-loop
      const listed = await coreFilesService.listDirectoryByScope({
        scopeKey,
        relativeDir: normalizeRelativeFolderToken(folderToken)
      }).catch(() => null);
      if (Array.isArray(listed)) {
        currentFolder = normalizeRelativeFolderToken(folderToken);
        entries = listed;
        break;
      }
    }
    const folders = [];
    const fileRows = [];

    for (const entry of entries) {
      if (!entry) continue;
      const name = cleanText(entry.name, 260);
      if (!name) continue;
      if (entry.isDir) {
        folders.push({
          name,
          path: normalizeRelativeFolderToken([currentFolder, name].filter(Boolean).join('/'))
        });
        continue;
      }
      fileRows.push(buildGatewayMediaLibraryRow(entry, activeOrgId, currentFolder));
    }

    folders.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    fileRows.sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));
    const parentFolder = currentFolder.includes('/')
      ? currentFolder.split('/').slice(0, -1).join('/')
      : '';

    return res.json({
      status: 'success',
      results: fileRows,
      folders,
      currentFolder,
      parentFolder,
      defaultFolder,
      defaults: { pageSize: defaultPageSize }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

function normalizePreviewQuestion(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const safeFallback = fallback && typeof fallback === 'object' ? fallback : {};
  const output = {
    ...safeFallback,
    ...source
  };
  output.id = cleanText(output.id, 120);
  output.familyId = cleanText(output.familyId, 140);
  output.code = cleanText(output.code, 120);
  output.title = cleanText(output.title, 260);
  output.testType = cleanText(output.testType, 40).toLowerCase();
  output.skill = cleanText(output.skill, 40).toLowerCase();
  output.questionType = cleanText(output.questionType, 120).toLowerCase();
  output.difficulty = cleanText(output.difficulty, 40).toLowerCase();
  output.instructions = String(output.instructions || '');
  output.internalNotes = String(output.internalNotes || '');
  output.tags = Array.isArray(output.tags)
    ? output.tags.map((row) => cleanText(row, 120)).filter(Boolean)
    : [];
  output.payload = (output.payload && typeof output.payload === 'object' && !Array.isArray(output.payload))
    ? output.payload
    : {};
  output.scoringConfig = (output.scoringConfig && typeof output.scoringConfig === 'object' && !Array.isArray(output.scoringConfig))
    ? output.scoringConfig
    : {};
  output.responseContract = (output.responseContract && typeof output.responseContract === 'object' && !Array.isArray(output.responseContract))
    ? output.responseContract
    : {};
  if (Array.isArray(output.mediaAssets)) {
    output.mediaAssets = output.mediaAssets;
  } else if (output.mediaAssets && typeof output.mediaAssets === 'object') {
    output.mediaAssets = Object.values(output.mediaAssets)
      .filter((row) => row && typeof row === 'object');
  } else {
    output.mediaAssets = [];
  }
  return output;
}

async function listQuestions(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || undefined;
    const result = await pteQuestionBankDataService.listQuestions(
      {
        ...query,
        page,
        limit
      },
      req.user,
      {
        scopeId: req.accessScope
      },
      {
        paginated: true,
        pagination: { page, limit }
      }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const formOptions = pteQuestionBankDataService.getFormOptions();
    const searchableFields = await inferSearchableFields(rows, {
      exclude: ['audit', 'payload', 'scoringConfig', 'responseContract', 'mediaAssets', 'validation']
    });
    const data = rows;
    const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('pte/questionsBank/questionBankList', {
      title: 'PTE Questions Bank',
      tableName: 'PTE_Questions_Bank',
      data,
      searchableFields,
      newUrl: 'pte/questions-bank',
      newLabel: 'New Question',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters: req.query,
      testTypeOptions: Array.isArray(formOptions.testTypes) ? formOptions.testTypes : [],
      statusOptions: Array.isArray(formOptions.statuses) ? formOptions.statuses : [],
      difficultyOptions: Array.isArray(formOptions.difficulties) ? formOptions.difficulties : [],
      practiceStateOptions: Array.isArray(formOptions.practiceStates) ? formOptions.practiceStates : [],
      questionTypeOptions: Array.isArray(formOptions.questionTypes) ? formOptions.questionTypes : [],
      user: req.user,
      isSuperUser: adminChekersService.isSuperAdmin(req.user),
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showForm(req, res) {
  try {
    const isEdit = Boolean(req.params.id);
    let question = null;
    if (isEdit) {
      question = await pteQuestionBankDataService.getQuestionById(req.params.id, req.user, {
        scopeId: req.accessScope
      }, {
        resolveScoring: true
      });
      if (!question) return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    } else {
      await pteQuestionBankDataService.assertCreateContext(req.user);
    }

    return res.render('pte/questionsBank/questionBankForm', {
      title: isEdit ? `Edit Question: ${question.id}` : 'Create PTE Question',
      question,
      mediaDefaultFolder: pteUploadPathUtils.getQuestionBankRoot(),
      formOptions: pteQuestionBankDataService.getFormOptions(),
      typeMatrix: pteQuestionBankDataService.buildQuestionTypeMatrix(),
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || '',
      previewMode: String(req.query.preview || '').trim() === '1'
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

function deepClone(value, fallback) {
  try {
    if (value === undefined) return fallback;
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function buildReferenceMediaTemplateRows(mediaRows = [], sourceQuestionId = '') {
  const rows = Array.isArray(mediaRows) ? mediaRows : [];
  const sourceId = cleanText(sourceQuestionId, 120);
  return rows.map((rawRow, index) => {
    const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
    return {
      id: cleanText(row.id, 140) || `REF-MEDIA-${Date.now()}-${index + 1}`,
      name: cleanText(row.name, 260),
      originalName: cleanText(row.originalName, 260),
      filename: cleanText(row.filename, 260),
      path: cleanText(row.path, 1600),
      url: cleanText(row.url, 1600),
      mimeType: cleanText(row.mimeType, 120),
      size: Number(row.size || 0) || 0,
      uploadDate: cleanText(row.uploadDate, 80),
      comment: cleanText(row.comment, 1200),
      source: 'reference',
      reference: {
        sourceQuestionId: sourceId,
        sourceMediaId: cleanText(row.id, 140)
      }
    };
  });
}

async function getQuestionTemplate(req, res) {
  try {
    const sourceQuestionId = cleanText(req.params.id, 120);
    if (!sourceQuestionId) throw new Error('Question id is required.');

    const sourceQuestion = await pteQuestionBankDataService.getQuestionById(sourceQuestionId, req.user, {
      scopeId: req.accessScope
    }, {
      resolveScoring: true
    });
    if (!sourceQuestion) throw new Error('Question not found or inaccessible.');

    const sourceCode = cleanText(sourceQuestion.code, 120);
    const template = {
      sourceId: sourceQuestionId,
      code: sourceCode ? `${sourceCode}-COPY` : '',
      title: `${cleanText(sourceQuestion.title, 260) || 'Question'} (Copy)`,
      testType: cleanText(sourceQuestion.testType, 40).toLowerCase(),
      skill: cleanText(sourceQuestion.skill, 40).toLowerCase(),
      questionType: cleanText(sourceQuestion.questionType, 120).toLowerCase(),
      difficulty: cleanText(sourceQuestion.difficulty, 40).toLowerCase() || 'medium',
      practiceEnabled: sourceQuestion.practiceEnabled !== false,
      tags: Array.isArray(sourceQuestion.tags)
        ? sourceQuestion.tags.map((row) => cleanText(row, 120)).filter(Boolean)
        : [],
      instructions: String(sourceQuestion.instructions || ''),
      internalNotes: String(sourceQuestion.internalNotes || ''),
      payload: deepClone(sourceQuestion.payload, {}),
      scoringConfig: deepClone(sourceQuestion.scoringConfig, {}),
      mediaAssets: buildReferenceMediaTemplateRows(sourceQuestion.mediaAssets, sourceQuestionId)
    };

    return res.json({
      status: 'success',
      template
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function saveQuestion(req, res) {
  try {
    const id = cleanText(req.params.id, 120);
    const inputPlan = parseMaybeJson(req.body?.questionPlan, {}) || {};
    const inputPlanObject = (inputPlan && typeof inputPlan === 'object') ? inputPlan : {};
    let targetOrgId = cleanText(req.user?.activeOrgId, 120);
    let existingStatusToken = '';

    if (id) {
      const existingQuestion = await pteQuestionBankDataService.getQuestionById(id, req.user, {
        scopeId: req.accessScope
      });
      if (!existingQuestion) throw new Error('Question not found or inaccessible.');
      targetOrgId = cleanText(existingQuestion.orgId, 120) || targetOrgId;
      existingStatusToken = cleanText(existingQuestion.status, 40).toLowerCase();
    }

    const incomingMedia = parseMaybeJson(
      inputPlanObject.mediaAssets,
      Array.isArray(inputPlanObject.mediaAssets) ? inputPlanObject.mediaAssets : []
    ) || [];
    const safeExistingMedia = sanitizeIncomingMediaRows(incomingMedia, targetOrgId);
    const withMedia = {
      ...inputPlanObject,
      mediaAssets: mergeMediaRows(safeExistingMedia, req.files || [])
    };

    if (id) {
      await pteQuestionBankDataService.updateQuestion(id, withMedia, req.user, {
        scopeId: req.accessScope
      });
      const updateMessage = existingStatusToken === 'published'
        ? 'Published question scoring updated successfully.'
        : 'Question draft updated successfully.';
      if (isAjax(req)) return res.json({ status: 'success', message: updateMessage });
      return res.redirect('/pte/questions-bank');
    }

    await pteQuestionBankDataService.createQuestion(withMedia, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) return res.json({ status: 'success', message: 'Question draft created successfully.' });
    return res.redirect('/pte/questions-bank');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function validateDraft(req, res) {
  try {
    const payload = parseMaybeJson(req.body?.questionPlan, {}) || {};
    const result = await pteQuestionBankDataService.validateQuestionPayload(payload, req.user);
    return res.json({
      status: 'success',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function publishQuestion(req, res) {
  try {
    await pteQuestionBankDataService.publishQuestion(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Question published successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function issueMutationToken(req, res) {
  try {
    return res.json({
      status: 'success',
      results: {
        actionStateId: cleanText(req.actionStateId, 220)
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function aiAssistTypeFields(req, res) {
  try {
    const payload = parseMaybeJson(req.body?.questionPlan, {}) || {};
    const result = await questionBankAiAutofillService.suggestTypeFields(payload, req.user, {
      accessContext: { scopeId: req.accessScope }
    });
    return res.json({
      status: 'success',
      message: result.supported
        ? 'AI suggestions generated successfully.'
        : 'AI Assist is available for Read Aloud, Repeat Sentence, Answer Short Question, Writing Summarize Written Text, Write Email, Reading MCQ Single, Reading MCQ Multiple, Reading Fill in the Blanks, Reading Reorder Paragraphs, Listening MCQ Single, Listening Select Missing Word, Listening MCQ Multiple, Listening Fill in the Blanks, Listening Highlight Incorrect Words, Listening Dictation, Listening Summarize Spoken Text, Respond to Situation, and Describe Image in this phase.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getTypeScoringProfile(req, res) {
  try {
    const activeOrgId = cleanText(req.user?.activeOrgId, 120);
    if (!activeOrgId || activeOrgId.toUpperCase() === 'SYSTEM') {
      throw new Error('Active organization is required to resolve scoring defaults.');
    }
    const questionType = cleanText(req.query?.questionType, 120).toLowerCase();
    if (!questionType) throw new Error('Question type is required.');
    const fallbackTestType = pteQuestionBankDataService.getFormOptions()
      ?.questionTypes
      ?.find((row) => String(row?.key || '').toLowerCase() === questionType)
      ?.testTypes?.[0];
    const testType = normalizeTestType(req.query?.testType, fallbackTestType);
    if (!testType) throw new Error('Test type is required.');

    const result = await pteQuestionScoringProfileService.getOrCreateTypeProfile({
      orgId: activeOrgId,
      testType,
      questionType,
      payload: {}
    }, {
      requestingUser: req.user,
      backendMode: req.backendMode
    });

    return res.json({
      status: 'success',
      results: {
        testType,
        questionType,
        profileId: cleanText(result?.profile?.id, 120),
        profileVersion: Number(result?.profileVersion || 1),
        scoringConfig: result?.scoringConfig && typeof result.scoringConfig === 'object'
          ? result.scoringConfig
          : {}
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function unpublishQuestion(req, res) {
  try {
    await pteQuestionBankDataService.unpublishQuestion(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Question unpublished and moved back to draft successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function applyBulkQuestionAction(req, res, config = {}) {
  const methodName = cleanText(config.methodName, 80);
  const actionLabel = cleanText(config.actionLabel, 80) || 'Updated';
  const updatedStatus = cleanText(config.updatedStatus, 40).toLowerCase();
  if (!methodName || typeof pteQuestionBankDataService[methodName] !== 'function') {
    return res.status(500).json({ status: 'error', message: 'Bulk operation is not configured correctly.' });
  }

  try {
    const ids = parseBulkIdList(req?.body?.ids);
    if (!ids.length) {
      return res.status(400).json({
        status: 'error',
        message: 'Select at least one question.',
        results: {
          processedCount: 0,
          successCount: 0,
          failedCount: 0,
          updatedIds: [],
          failures: []
        }
      });
    }

    const updatedIds = [];
    const failures = [];
    for (const id of ids) {
      try {
        // Keep all existing per-item service rules intact.
        // eslint-disable-next-line no-await-in-loop
        await pteQuestionBankDataService[methodName](id, req.user, {
          scopeId: req.accessScope
        });
        updatedIds.push(id);
      } catch (error) {
        failures.push({
          id,
          message: error?.message || `${actionLabel} failed.`
        });
      }
    }

    const successCount = updatedIds.length;
    const failedCount = failures.length;
    const payload = {
      processedCount: ids.length,
      successCount,
      failedCount,
      updatedIds,
      failures,
      updatedStatus: updatedStatus || ''
    };

    if (successCount <= 0) {
      return res.status(400).json({
        status: 'error',
        message: failures[0]?.message || `No selected questions were ${actionLabel.toLowerCase()}.`,
        results: payload
      });
    }

    return res.json({
      status: 'success',
      message: buildBulkActionSummary(actionLabel, successCount, failedCount),
      results: payload
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function bulkPublishQuestions(req, res) {
  return applyBulkQuestionAction(req, res, {
    methodName: 'publishQuestion',
    actionLabel: 'Published',
    updatedStatus: 'published'
  });
}

async function bulkUnpublishQuestions(req, res) {
  return applyBulkQuestionAction(req, res, {
    methodName: 'unpublishQuestion',
    actionLabel: 'Unpublished',
    updatedStatus: 'draft'
  });
}

async function reviseQuestion(req, res) {
  try {
    const revision = await pteQuestionBankDataService.reviseQuestion(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({
      status: 'success',
      message: 'Revision draft created successfully.',
      results: { id: revision?.id || '' }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function retireQuestion(req, res) {
  try {
    await pteQuestionBankDataService.retireQuestion(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Question retired successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function archiveQuestion(req, res) {
  try {
    await pteQuestionBankDataService.archiveQuestion(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Question archived successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function duplicateFamily(req, res) {
  try {
    const duplicate = await pteQuestionBankDataService.duplicateFamily(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({
      status: 'success',
      message: 'Draft copy created from selected question.',
      results: { id: duplicate?.id || '' }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function deleteQuestion(req, res) {
  try {
    await pteQuestionBankDataService.deleteQuestion(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    return res.json({ status: 'success', message: 'Question deleted successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listQuestionTypes(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, FAMILY_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(query);
    const rows = await pteQuestionBankDataService.listQuestionTypes(filtered, req.user, {
      scopeId: req.accessScope
    });
    const { data, pagination } = paginate(rows, page, limit);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getFamilyRevisions(req, res) {
  try {
    const rows = await pteQuestionBankDataService.listFamilyRevisions(req.params.familyId, req.user, {
      scopeId: req.accessScope
    });
    return res.json({
      status: 'success',
      results: rows
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function getFormOptions(req, res) {
  try {
    await pteQuestionBankDataService.resolveReadVisibility(req.user, { scopeId: req.accessScope });
    return res.json({
      status: 'success',
      results: {
        formOptions: pteQuestionBankDataService.getFormOptions(),
        typeMatrix: pteQuestionBankDataService.buildQuestionTypeMatrix()
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function uploadMedia(req, res) {
  try {
    const rows = buildUploadedMediaRows(req.files || []);
    return res.json({
      status: 'success',
      message: rows.length ? 'Media uploaded successfully.' : 'No files were uploaded.',
      results: rows
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function downloadMedia(req, res) {
  try {
    const question = await pteQuestionBankDataService.getQuestionById(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    if (!question) return res.status(404).send('Question not found.');

    const media = findMediaById(question.mediaAssets || [], req.params.mediaId);
    if (!media) return res.status(404).send('Media not found.');

    const filePath = resolveMediaDiskPath(media, question.orgId);
    if (!filePath) return res.status(404).send('Media file path is missing.');
    const downloadName = cleanText(media.originalName || media.filename || media.name, 260) || path.basename(filePath);
    return res.download(filePath, downloadName);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).send(error.message);
  }
}

async function showExamPreview(req, res) {
  try {
    let question = null;
    const modeToken = String(req.params.id || '').trim();
    if (modeToken) {
      question = await pteQuestionBankDataService.getQuestionById(modeToken, req.user, {
        scopeId: req.accessScope
      }, {
        resolveScoring: true
      });
      if (!question) return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    } else {
      const inputPlan = parseMaybeJson(req.body?.questionPlan, {}) || {};
      question = normalizePreviewQuestion(inputPlan, {
        title: 'Untitled Question',
        testType: '',
        skill: '',
        questionType: ''
      });
    }

    return res.render('pte/questionsBank/questionBankExamPreview', {
      layout: false,
      title: 'PTE Exam Preview',
      question: normalizePreviewQuestion(question),
      typeRegistry: pteQuestionBankDataService.getFormOptions().questionTypes || [],
      user: req.user || null
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listQuestions,
  showForm,
  getQuestionTemplate,
  saveQuestion,
  validateDraft,
  aiAssistTypeFields,
  getTypeScoringProfile,
  publishQuestion,
  issueMutationToken,
  unpublishQuestion,
  bulkPublishQuestions,
  bulkUnpublishQuestions,
  reviseQuestion,
  retireQuestion,
  archiveQuestion,
  duplicateFamily,
  deleteQuestion,
  listQuestionTypes,
  getFamilyRevisions,
  getFormOptions,
  uploadMedia,
  downloadMedia,
  showExamPreview,
  listOrgMediaLibrary
};
