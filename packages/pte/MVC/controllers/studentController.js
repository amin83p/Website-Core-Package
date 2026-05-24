const {
  path,
  crypto,
  paginate,
  pteUploadPathUtils,
  coreFilesService,
  uploadMiddleware,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  settingService
} = require('./studentControllerDependencies');
const pteStudentDataService = require('../../services/pte/pteStudentDataService');


const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'applicantId',
    'personId',
    'userId',
    'orgId',
    'countryOfOrigin',
    'localId',
    'globalAcademicStatus',
    'status'
  ],
  allowedSearchFields: [
    'id',
    'applicantId',
    'personId',
    'userId',
    'countryOfOrigin',
    'localId',
    'globalAcademicStatus',
    'status',
    'admissionsNotes',
    'display.personName',
    'display.userName'
  ],
  defaultSearchFields: [
    'id',
    'applicantId',
    'personId',
    'userId',
    'countryOfOrigin',
    'localId',
    'globalAcademicStatus',
    'status',
    'admissionsNotes',
    'display.personName',
    'display.userName'
  ],
  allowMetaKeys: true
});
const APPLICANT_SEARCHABLE_FIELDS = Object.freeze([
  'id',
  'applicantId',
  'personId',
  'userId',
  'countryOfOrigin',
  'localId',
  'globalAcademicStatus',
  'status',
  'admissionsNotes',
  'display.personName',
  'display.userName'
]);

const PICKER_PERSON_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'status'],
  defaultSearchFields: ['id', 'displayName', 'name.first', 'name.last', 'name.preferred', 'contact.email', 'email'],
  allowMetaKeys: true
});

const PICKER_COURSE_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name'],
  defaultSearchFields: ['id', 'name'],
  allowMetaKeys: true
});

const PICKER_PACKAGE_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'orgId', 'visibility', 'active'],
  defaultSearchFields: ['id', 'name', 'description'],
  allowMetaKeys: true
});

const COUNTRY_OPTIONS = Object.freeze([
  'Canada',
  'United States',
  'United Kingdom',
  'Australia',
  'India',
  'China',
  'Brazil',
  'Mexico',
  'Nigeria',
  'Iran',
  'Other'
]);

const ACADEMIC_STATUS_OPTIONS = Object.freeze([
  'Active',
  'Pending',
  'On Hold',
  'Graduated',
  'Archived'
]);

function resolveApplicantAudience(value = '') {
  return String(value || '').trim().toLowerCase() === 'public' ? 'public' : 'regular';
}

function buildApplicantPageContext(audience = 'regular') {
  const mode = resolveApplicantAudience(audience);
  const isPublic = mode === 'public';
  const listBasePath = isPublic ? '/pte/public-applicants' : '/pte/students';
  const newUrl = listBasePath.replace(/^\/+/, '');
  return {
    audience: mode,
    isPublic,
    listBasePath,
    listArchivedPath: `${listBasePath}/archived`,
    recoverPathBase: `${listBasePath}/recover`,
    deletePathBase: `${listBasePath}/delete`,
    editPathBase: `${listBasePath}/edit`,
    promotePathBase: `${listBasePath}/promote`,
    newUrl,
    newLabel: isPublic ? null : 'New Applicant',
    tableName: isPublic ? 'PTE_Public_Applicants' : 'PTE_Students',
    titleActive: isPublic ? 'PTE Public Applicants' : 'PTE Applicants',
    titleArchived: isPublic ? 'PTE Public Applicants (Archived)' : 'PTE Applicants (Archived)',
    secondaryActiveLabel: isPublic ? 'Active Public Applicants' : 'Active Applicants',
    secondaryArchivedLabel: isPublic ? 'Archived Public Applicants' : 'Archived Applicants',
    showPromoteAction: isPublic
  };
}

function normalizeRoleToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isPublicApplicantRecord(applicant = null) {
  const token = normalizeRoleToken(applicant && applicant.personRoleToken);
  if (!token) return false;
  if (token === normalizeRoleToken(pteStudentDataService.PERSON_ROLE_PUBLIC_TOKEN)) return true;
  if (token === normalizeRoleToken(pteStudentDataService.PERSON_ORG_ROLE_PUBLIC_TOKEN)) return true;
  return token.includes('pte_student_public');
}

function assertApplicantAudience(applicant, audience = 'regular') {
  const mode = resolveApplicantAudience(audience);
  const isPublicApplicant = isPublicApplicantRecord(applicant);
  if (mode === 'public' && !isPublicApplicant) {
    throw new Error('This applicant is not a public PTE applicant.');
  }
  if (mode === 'regular' && isPublicApplicant) {
    throw new Error('This applicant is managed under Public Applicants.');
  }
}

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function cleanText(value, max = 300) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeStatus(value, fallback = 'active') {
  const token = cleanText(value, 30).toLowerCase();
  if (token === 'archived') return 'archived';
  if (token === 'active') return 'active';
  return fallback;
}

function normalizeCourses(value) {
  const rows = parseJsonSafe(value, []);
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  return list
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row : { id: row };
      const id = cleanText(item.id || item.courseId, 120);
      const name = cleanText(item.name || item.title, 180);
      const key = id || name || `course_${index + 1}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id,
        name: name || id || key
      };
    })
    .filter(Boolean);
}

function normalizePackages(value) {
  const rows = parseJsonSafe(value, []);
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  return list
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row : { id: row };
      const id = cleanText(item.id || item.packageId, 120);
      if (!id) return null;
      const key = id || `package_${index + 1}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id,
        name: cleanText(item.name, 220) || id
      };
    })
    .filter(Boolean);
}

function normalizeExistingAttachments(value) {
  const rows = parseJsonSafe(value, []);
  return Array.isArray(rows) ? rows : [];
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

function getStudentsAttachmentRoot(orgId = '') {
  const scopeId = resolveScopeIdToken(orgId);
  const scopedRoot = coreFilesService.getRootPath(scopeId);
  return normalizeAbsolutePath(coreFilesService.resolveSafePath(
    scopedRoot,
    pteUploadPathUtils.getStudentsRoot(false)
  ));
}

function getPublicApplicantsAttachmentRoot(orgId = '') {
  const scopeId = resolveScopeIdToken(orgId);
  const scopedRoot = coreFilesService.getRootPath(scopeId);
  return normalizeAbsolutePath(coreFilesService.resolveSafePath(
    scopedRoot,
    pteUploadPathUtils.getStudentsRoot(true)
  ));
}

function getLegacyStudentsAttachmentRoot(orgId = '') {
  const scopeId = resolveScopeIdToken(orgId);
  const scopedRoot = coreFilesService.getRootPath(scopeId);
  return normalizeAbsolutePath(coreFilesService.resolveSafePath(scopedRoot, 'pte-students'));
}

function getAllowedAttachmentRoots(orgId = '') {
  return [
    getStudentsAttachmentRoot(orgId),
    getPublicApplicantsAttachmentRoot(orgId),
    getLegacyStudentsAttachmentRoot(orgId)
  ].filter(Boolean);
}

function resolveDiskPathFromUploadsUrl(fileUrl = '') {
  const token = cleanText(fileUrl, 1600);
  if (!token) return '';
  return normalizeAbsolutePath(coreFilesService.fromUploadsUrlToDiskPath(token));
}

function normalizeSafeStudentAttachmentPath(filePath = '', fileUrl = '', orgId = '') {
  const attachmentRoots = getAllowedAttachmentRoots(orgId);
  if (!attachmentRoots.length) return '';

  const directPath = normalizeAbsolutePath(filePath);
  if (directPath && attachmentRoots.some((root) => isPathInsideBase(root, directPath))) {
    return directPath;
  }

  const fromUrl = resolveDiskPathFromUploadsUrl(fileUrl) || resolveDiskPathFromUploadsUrl(filePath);
  if (fromUrl && attachmentRoots.some((root) => isPathInsideBase(root, fromUrl))) {
    return fromUrl;
  }

  return '';
}

function toCanonicalUploadReference(filePath = '', fileUrl = '') {
  const fromUrl = coreFilesService.extractRelativeUploadPath(fileUrl);
  if (fromUrl) return `/uploads/${fromUrl}`;
  const fromPathUrl = coreFilesService.extractRelativeUploadPath(filePath);
  if (fromPathUrl) return `/uploads/${fromPathUrl}`;
  return coreFilesService.fromDiskPathToUploadsUrl(filePath) || String(filePath || '').replace(/\\/g, '/').trim();
}

function isPublicMediaLibraryRequest(req) {
  const joined = `${req?.baseUrl || ''}${req?.path || ''}`.toLowerCase();
  return joined.includes('/public-applicants');
}

function sanitizeExistingAttachmentsForSave(attachments = [], orgId = '') {
  const rows = Array.isArray(attachments) ? attachments : [];
  return rows.map((rawRow, index) => {
    const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
    const rawPath = cleanText(row.path, 1600);
    const rawUrl = cleanText(row.url, 1600);
    const hasFileReference = Boolean(rawPath || rawUrl);
    const safePath = normalizeSafeStudentAttachmentPath(rawPath, rawUrl, orgId);
    if (hasFileReference && !safePath) {
      throw new Error(`Invalid attachment path at row ${index + 1}.`);
    }

    const normalizedPath = safePath ? toCanonicalUploadReference(safePath, rawUrl || rawPath) : '';
    const normalizedUrl = normalizedPath ? toCanonicalUploadReference(normalizedPath, normalizedPath) : '';
    return {
      id: cleanText(row.id, 120) || `ATT-${Date.now()}-${index + 1}`,
      originalName: cleanText(row.originalName, 260) || cleanText(row.filename, 260),
      filename: cleanText(row.filename, 260) || (normalizedPath ? path.basename(normalizedPath) : ''),
      path: normalizedPath,
      url: normalizedUrl,
      size: Number(row.size || 0) || 0,
      uploadDate: cleanText(row.uploadDate, 80) || new Date().toISOString(),
      comment: cleanText(row.comment, 500)
    };
  });
}

function mergeAttachments(existingAttachments, reqFiles, newFileComments) {
  const list = Array.isArray(existingAttachments) ? existingAttachments.slice() : [];
  const files = Array.isArray(reqFiles) ? reqFiles : [];
  files.forEach((file, index) => {
    const storedPath = String(uploadMiddleware.getStoredFilePath(file) || '').replace(/\\/g, '/');
    const normalizedPath = toCanonicalUploadReference(storedPath, storedPath);
    const normalizedUrl = toCanonicalUploadReference(normalizedPath, normalizedPath);
    list.push({
      id: crypto.randomBytes(8).toString('hex'),
      originalName: cleanText(file.originalname, 260) || cleanText(file.filename, 260),
      filename: cleanText(file.filename, 260),
      path: normalizedPath,
      url: normalizedUrl,
      size: Number(file.size || 0) || 0,
      uploadDate: new Date().toISOString(),
      comment: cleanText(newFileComments[index], 500)
    });
  });
  return list;
}

function findAttachment(attachments, attId) {
  const list = Array.isArray(attachments) ? attachments : [];
  const target = String(attId || '').trim();
  if (!target) return { index: -1, attachment: null };
  if (/^\d+$/.test(target)) {
    const index = Number(target);
    if (index >= 0 && index < list.length) return { index, attachment: list[index] };
    return { index: -1, attachment: null };
  }
  const index = list.findIndex((row) => String(row?.id || '').trim() === target);
  if (index < 0) return { index: -1, attachment: null };
  return { index, attachment: list[index] };
}

function resolveAttachmentDiskPath(attachment, orgId = '') {
  return normalizeSafeStudentAttachmentPath(attachment?.path, attachment?.url, orgId);
}

function buildApplicantPayload(req, options = {}) {
  const body = req.body || {};
  const personMode = cleanText(body.personMode, 20).toLowerCase() === 'new' ? 'new' : 'existing';
  const targetOrgId = cleanText(options.orgId || req.user?.activeOrgId, 120);
  const existingAttachments = sanitizeExistingAttachmentsForSave(
    normalizeExistingAttachments(body.attachments),
    targetOrgId
  );
  const attachments = mergeAttachments(
    existingAttachments,
    req.files || [],
    asList(body.newFileComments).map((item) => cleanText(item, 500))
  );

  return {
    personMode,
    personId: cleanText(body.personId, 120),
    newPerson: {
      firstName: cleanText(body.newPersonFirstName, 120),
      middleName: cleanText(body.newPersonMiddleName, 120),
      lastName: cleanText(body.newPersonLastName, 120),
      preferredName: cleanText(body.newPersonPreferredName, 120),
      email: cleanText(body.newPersonEmail, 220),
      phone: cleanText(body.newPersonPhone, 80),
      gender: cleanText(body.newPersonGender, 40),
      dateOfBirth: cleanText(body.newPersonDateOfBirth, 40),
      notes: cleanText(body.newPersonNotes, 2000)
    },
    applicantId: cleanText(body.applicantId, 120),
    countryOfOrigin: cleanText(body.countryOfOrigin, 120),
    localId: cleanText(body.localId, 120),
    admissionsNotes: cleanText(body.admissionsNotes, 4000),
    globalAcademicStatus: cleanText(body.globalAcademicStatus, 80) || 'Active',
    courses: normalizeCourses(body.coursesJson),
    selectedPackages: normalizePackages(body.selectedPackagesJson),
    attachments,
    status: normalizeStatus(body.status || '', '')
  };
}

async function listApplicants(req, res, mode = 'active', audience = 'regular') {
  const pageContext = buildApplicantPageContext(audience);
  const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
  if (!query.status) query.status = mode === 'archived' ? 'archived' : 'active';
  const page = Number.parseInt(req.query?.page, 10) || 1;
  const limit = Number.parseInt(req.query?.limit, 10) || undefined;

  const result = await pteStudentDataService.listApplicants(
    {
      ...query,
      page,
      limit
    },
    req.user,
    { scopeId: req.accessScope },
    {
      paginated: true,
      pagination: { page, limit },
      roleFilterMode: pageContext.isPublic ? 'public' : 'regular'
    }
  );
  const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
  const inferredSearchableFields = await inferSearchableFields(rows, { exclude: ['audit', 'attachments'] });
  const searchableFields = Array.from(new Set([
    ...APPLICANT_SEARCHABLE_FIELDS,
    ...inferredSearchableFields
  ]));
  const data = rows;
  const pagination = result?.pagination || paginate(rows, req.query.page, req.query.limit).pagination;

  if (isAjax(req)) {
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  }

  return res.render('pte/students/studentList', {
    title: mode === 'archived' ? pageContext.titleArchived : pageContext.titleActive,
    tableName: pageContext.tableName,
    data,
    searchableFields,
    newUrl: pageContext.newUrl,
    newLabel: mode === 'archived' ? null : pageContext.newLabel,
    listBasePath: pageContext.listBasePath,
    listArchivedPath: pageContext.listArchivedPath,
    recoverPathBase: pageContext.recoverPathBase,
    deletePathBase: pageContext.deletePathBase,
    editPathBase: pageContext.editPathBase,
    promotePathBase: pageContext.promotePathBase,
    showPromoteAction: pageContext.showPromoteAction,
    audience: pageContext.audience,
    secondaryActiveLabel: pageContext.secondaryActiveLabel,
    secondaryArchivedLabel: pageContext.secondaryArchivedLabel,
    includeModal: true,
    includeModal_Table: true,
    includeModal_FileImport: false,
    print: true,
    btn_export: true,
    pagination,
    filters: req.query,
    archivedMode: mode === 'archived',
    user: req.user,
    actionStateId: req.actionStateId || ''
  });
}

async function listStudents(req, res) {
  try {
    return await listApplicants(req, res, 'active', 'regular');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function listArchivedStudents(req, res) {
  try {
    return await listApplicants(req, res, 'archived', 'regular');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function listPublicApplicants(req, res) {
  try {
    return await listApplicants(req, res, 'active', 'public');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function listArchivedPublicApplicants(req, res) {
  try {
    return await listApplicants(req, res, 'archived', 'public');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showForm(req, res, audience = 'regular') {
  try {
    const pageContext = buildApplicantPageContext(audience);
    const isEdit = Boolean(req.params.id);
    let applicant = null;

    if (isEdit) {
      applicant = await pteStudentDataService.getApplicantById(req.params.id, req.user, { scopeId: req.accessScope });
      if (!applicant) {
        return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
      }
      assertApplicantAudience(applicant, pageContext.audience);
    } else {
      if (pageContext.isPublic) {
        throw new Error('Public applicants are created from the PTE public join page.');
      }
      await pteStudentDataService.assertCreateContext(req.user);
    }

    const mediaItemId = isEdit
      ? cleanText(applicant?.id, 120)
      : `ITEM_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const mediaDefaultFolder = pageContext.isPublic
      ? pteUploadPathUtils.getStudentsRoot(true)
      : pteUploadPathUtils.getStudentsRoot(false);

    return res.render('pte/students/studentForm', {
      title: isEdit
        ? (pageContext.isPublic ? `Edit PTE Public Applicant: ${applicant.id}` : `Edit PTE Applicant: ${applicant.id}`)
        : 'Create PTE Applicant',
      applicant,
      mediaItemId,
      mediaDefaultFolder,
      countries: COUNTRY_OPTIONS,
      academicStatuses: ACADEMIC_STATUS_OPTIONS,
      listBasePath: pageContext.listBasePath,
      formBasePath: pageContext.listBasePath,
      audience: pageContext.audience,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function saveApplicant(req, res, audience = 'regular') {
  try {
    const pageContext = buildApplicantPageContext(audience);
    const id = cleanText(req.params.id, 120);
    let targetOrgId = cleanText(req.user?.activeOrgId, 120);
    if (id) {
      const existingApplicant = await pteStudentDataService.getApplicantById(id, req.user, { scopeId: req.accessScope });
      if (!existingApplicant) throw new Error('Applicant not found or inaccessible.');
      assertApplicantAudience(existingApplicant, pageContext.audience);
      targetOrgId = cleanText(existingApplicant.orgId, 120) || targetOrgId;
    } else if (pageContext.isPublic) {
      throw new Error('Public applicants are created from the PTE public join page.');
    }
    const payload = buildApplicantPayload(req, { orgId: targetOrgId });

    let result = null;
    if (id) {
      result = await pteStudentDataService.updateApplicant(id, payload, req.user, { scopeId: req.accessScope });
    } else {
      result = await pteStudentDataService.createApplicant(payload, req.user, { scopeId: req.accessScope });
    }

    const baseMessage = id
      ? 'Applicant updated successfully.'
      : 'Applicant created successfully.';
    const tempPassword = cleanText(result?.tempPassword, 200);
    const autoUserCreated = result?.autoUserCreated === true;
    const accountMessage = autoUserCreated
      ? (tempPassword
        ? ` User account was created with temporary password: ${tempPassword}`
        : ' User account was created successfully.')
      : '';

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: `${baseMessage}${accountMessage}`,
        results: result || null
      });
    }

    return res.redirect(pageContext.listBasePath);
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function archiveApplicant(req, res, audience = 'regular') {
  try {
    const pageContext = buildApplicantPageContext(audience);
    const existingApplicant = await pteStudentDataService.getApplicantById(req.params.id, req.user, { scopeId: req.accessScope });
    if (!existingApplicant) throw new Error('Applicant not found or inaccessible.');
    assertApplicantAudience(existingApplicant, pageContext.audience);
    await pteStudentDataService.archiveApplicant(req.params.id, req.user, { scopeId: req.accessScope });
    const message = 'Applicant archived successfully.';
    if (isAjax(req)) return res.json({ status: 'success', message, redirectTo: pageContext.listBasePath });
    return res.redirect(pageContext.listBasePath);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function recoverApplicant(req, res, audience = 'regular') {
  try {
    const pageContext = buildApplicantPageContext(audience);
    const existingApplicant = await pteStudentDataService.getApplicantById(req.params.id, req.user, { scopeId: req.accessScope });
    if (!existingApplicant) throw new Error('Applicant not found or inaccessible.');
    assertApplicantAudience(existingApplicant, pageContext.audience);
    await pteStudentDataService.recoverApplicant(req.params.id, req.user, { scopeId: req.accessScope });
    const message = 'Applicant recovered successfully.';
    if (isAjax(req)) return res.json({ status: 'success', message, redirectTo: pageContext.listArchivedPath });
    return res.redirect(pageContext.listArchivedPath);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showPublicApplicantForm(req, res) {
  return showForm(req, res, 'public');
}

async function savePublicApplicant(req, res) {
  return saveApplicant(req, res, 'public');
}

async function archivePublicApplicant(req, res) {
  return archiveApplicant(req, res, 'public');
}

async function recoverPublicApplicant(req, res) {
  return recoverApplicant(req, res, 'public');
}

async function promotePublicApplicant(req, res) {
  try {
    await pteStudentDataService.promotePublicApplicant(req.params.id, req.user, { scopeId: req.accessScope });
    const message = 'Public applicant promoted to regular PTE applicant.';
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message,
        redirectTo: '/pte/students'
      });
    }
    return res.redirect('/pte/students');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function downloadAttachment(req, res, audience = 'regular') {
  try {
    const pageContext = buildApplicantPageContext(audience);
    const applicant = await pteStudentDataService.getApplicantById(req.params.id, req.user, { scopeId: req.accessScope });
    if (!applicant) return res.status(404).send('Applicant not found.');
    assertApplicantAudience(applicant, pageContext.audience);

    const attachments = Array.isArray(applicant.attachments) ? applicant.attachments : [];
    const { attachment } = findAttachment(attachments, req.params.attId);
    if (!attachment) return res.status(404).send('Attachment not found.');

    const filePath = resolveAttachmentDiskPath(attachment, applicant.orgId);
    if (!filePath) return res.status(404).send('Attachment file path is missing.');

    const downloadName = cleanText(attachment.originalName, 260)
      || cleanText(attachment.filename, 260)
      || path.basename(filePath);
    return res.download(filePath, downloadName);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).send(error.message);
  }
}

async function deleteAttachment(req, res, audience = 'regular') {
  try {
    const pageContext = buildApplicantPageContext(audience);
    const applicant = await pteStudentDataService.getApplicantById(req.params.id, req.user, { scopeId: req.accessScope });
    if (!applicant) throw new Error('Applicant not found.');
    assertApplicantAudience(applicant, pageContext.audience);

    const attachments = Array.isArray(applicant.attachments) ? applicant.attachments.slice() : [];
    const { index, attachment } = findAttachment(attachments, req.params.attId);
    if (index < 0 || !attachment) throw new Error('Attachment not found.');

    attachments.splice(index, 1);
    await pteStudentDataService.updateApplicantAttachments(applicant.id, attachments, req.user, { scopeId: req.accessScope });

    const filePath = resolveAttachmentDiskPath(attachment, applicant.orgId);
    if (filePath) {
      await uploadMiddleware.deleteFilePaths(filePath);
    }

    return res.json({
      status: 'success',
      message: 'Attachment deleted successfully.',
      attachments
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerPersons(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_PERSON_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteStudentDataService.listPickerPersons(
      filtered,
      req.user,
      { scopeId: req.accessScope },
      { paginated: true, pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function downloadPublicAttachment(req, res) {
  return downloadAttachment(req, res, 'public');
}

async function deletePublicAttachment(req, res) {
  return deleteAttachment(req, res, 'public');
}

async function listOrgMediaLibrary(req, res) {
  try {
    const defaultPageSize = resolveDefaultPageSize();
    const defaultFolder = isPublicMediaLibraryRequest(req)
      ? pteUploadPathUtils.getStudentsRoot(true)
      : pteUploadPathUtils.getStudentsRoot(false);
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
    const rows = [];

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
      rows.push(buildGatewayMediaLibraryRow(entry, activeOrgId, currentFolder));
    }

    folders.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    rows.sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));
    const parentFolder = currentFolder.includes('/')
      ? currentFolder.split('/').slice(0, -1).join('/')
      : '';

    return res.json({
      status: 'success',
      message: rows.length ? `Loaded ${rows.length} file(s).` : 'No saved files found in this folder.',
      results: rows,
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

async function uploadMedia(req, res) {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) throw new Error('No files uploaded.');

    const rows = files.map((file) => {
      const storedPath = String(uploadMiddleware.getStoredFilePath(file) || '').replace(/\\/g, '/').trim();
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
        comment: '',
        source: 'saved_library'
      };
    });

    return res.json({
      status: 'success',
      message: `Uploaded ${rows.length} file(s).`,
      results: rows
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerCourses(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_COURSE_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteStudentDataService.listPickerCourses(
      filtered,
      req.user,
      { scopeId: req.accessScope },
      { paginated: true, pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerPackages(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_PACKAGE_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const result = await pteStudentDataService.listPickerPackages(
      filtered,
      req.user,
      { scopeId: req.accessScope },
      { paginated: true, pagination: { page, limit } }
    );
    const rows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const data = rows;
    const pagination = result?.pagination || paginate(rows, page, limit).pagination;
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listStudents,
  listArchivedStudents,
  listPublicApplicants,
  listArchivedPublicApplicants,
  showForm,
  showPublicApplicantForm,
  saveApplicant,
  savePublicApplicant,
  archiveApplicant,
  archivePublicApplicant,
  recoverApplicant,
  recoverPublicApplicant,
  promotePublicApplicant,
  downloadAttachment,
  downloadPublicAttachment,
  deleteAttachment,
  deletePublicAttachment,
  listOrgMediaLibrary,
  uploadMedia,
  pickerPersons,
  pickerCourses,
  pickerPackages
};



