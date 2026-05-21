// MVC/controllers/systemSettingsController.js
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const systemSettingsRepository = require('../repositories/systemSettingsRepository');
const dataService = require('../services/dataService');
// const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
// ✅ Import the Setting Service to handle cache refreshing
const settingService = require('../services/settingService');
const appBrandingService = require('../services/appBrandingService');
const dataBackendRuntimeService = require('../services/dataBackendRuntimeService');
const { registerCoreEntityQueryExecutors } = require('../models/queryExecutorBootstrap');
const actionStateRetentionService = require('../services/actionStateRetentionService');
const jsonToMongoMigrationService = require('../services/migration/jsonToMongoMigrationService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const publicPageContentSettingsDataService = require('../services/publicPageContentSettingsDataService');
const pathResolver = require('../utils/pathResolver');
const uploadPathUtils = require('../utils/uploadPathUtils');
const { isRailwayProxyMode } = require('../utils/uploadModeUtils');
const { gatewayListDirectory, gatewayUploadFile } = require('../services/fileGatewayClientService');
const { checkAdminVerificationCode } = require('../utils/encyptors');

const PUBLIC_PAGE_MEDIA_FOLDER = 'misc/public-pages';

function normalizeScopeToken(value = '') {
  const token = cleanFormText(value, 120).toUpperCase();
  if (!token || token === 'SYSTEM' || token === 'GLOBAL') return 'GLOBAL';
  return token.replace(/^ORG_/, '') || 'GLOBAL';
}

function resolvePublicPageMediaScope(user = null) {
  const scopeKey = normalizeScopeToken(user?.activeOrgId);
  return {
    scopeKey,
    scopeFolder: scopeKey === 'GLOBAL' ? 'GLOBAL' : `ORG_${scopeKey}`
  };
}

/* =========================================================
   DASHBOARD
========================================================= */
exports.dashboard = async (req, res) => {
  try {
    res.render('systemSettings/dashboard', {
      title: 'System Settings',
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   NEWSLETTER CONFIGURATION
========================================================= */
exports.showNewsletterSettings = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const allGroups = await dataService.fetchData('subscriptionGroups', {}, req.user);

    res.render('systemSettings/newsletterSettings', {
      title: 'Newsletter Configuration',
      settings,
      groups: allGroups,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateNewsletterSettings = async (req, res) => {
  try {
    const formData = {
      newsletter: {
        defaultGroupId: req.body.defaultGroupId,
        requireDoubleOptIn: req.body.requireDoubleOptIn === 'true',
        sendWelcomeEmail: req.body.sendWelcomeEmail === 'true'
      }
    };
    
    // 1. Save to Disk
    await systemSettingsRepository.updateSettings(formData, req.user);
    
    // 2. ✅ Refresh Memory Cache
    await settingService.refresh();

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Newsletter settings saved.' });
    res.redirect('/systemSettings/newsletter');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   ORGANIZATION CONFIGURATION (Updated)
========================================================= */
exports.showOrganizationSettings = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    res.render('systemSettings/organizationSettings', {
      title: 'Organization Configuration',
      settings,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateOrganizationSettings = async (req, res) => {
  try {
    const pteJoinOrgIdRaw = String(req.body.pteJoinOrgId || '').trim();
    const parsedPteJoinOrgId = Number.parseInt(pteJoinOrgIdRaw, 10);
    const formData = {
      organization: {
        allowFreeRegistration: req.body.allowFreeRegistration === 'true',
        defaultTrialDays: parseInt(req.body.defaultTrialDays || '0', 10),
        freeOrgId: parseInt(req.body.freeOrgId, 10),
        freeOrgName: req.body.freeOrgName,
        pteJoinOrgId: Number.isFinite(parsedPteJoinOrgId) && parsedPteJoinOrgId > 0
          ? parsedPteJoinOrgId
          : ''
      }
    };
    
    // 1. Save to Disk
    await systemSettingsRepository.updateSettings(formData, req.user);
    
    // 2. ✅ Refresh Memory Cache
    await settingService.refresh();

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Organization settings saved.' });
    res.redirect('/systemSettings/organization');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   ACCESS & SECURITY (New)
========================================================= */
exports.showAccessSettings = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    // Convert array to newline-separated string for textarea
    const adminStr = (settings.access.immuneSuperAdmins || []).join('\n');
    
    res.render('systemSettings/accessSettings', {
      title: 'Access & Security',
      settings,
      adminStr,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateAccessSettings = async (req, res) => {
  try {
    // Parse textarea back to array
    const rawAdmins = req.body.immuneSuperAdmins || '';
    const immuneSuperAdmins = rawAdmins.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    const formData = {
      access: {
        highAccessMin: parseInt(req.body.highAccessMin, 10),
        highAccessMax: parseInt(req.body.highAccessMax, 10),
        selfAccessLevel: parseInt(req.body.selfAccessLevel, 10),
        immuneSuperAdmins
      }
    };

    // 1. Save to Disk
    await systemSettingsRepository.updateSettings(formData, req.user);
    
    // 2. ✅ Refresh Memory Cache
    await settingService.refresh();

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Access settings saved.' });
    res.redirect('/systemSettings/access');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   APPLICATION DEFAULTS (New)
========================================================= */
/* =========================================================
   APPLICATION DEFAULTS (Fixed for Relative Paths)
========================================================= */
exports.showAppSettings = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    
    // uploadsPath supports absolute and relative values (resolved from project root).
    
    res.render('systemSettings/appSettings', {
      title: 'App Defaults',
      settings,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId,
      publicMenuEndpointOptions: appBrandingService.getPublicMenuEndpointOptions()
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function cleanFormText(value, max = 500) {
  const token = String(value ?? '').replace(/\0/g, '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function normalizePublicPageRelativeFolder(value, max = 800) {
  const token = cleanFormText(value, max).replace(/\\/g, '/');
  if (!token || token === '/' || token === '.') return '';

  const parts = token
    .split('/')
    .map((part) => cleanFormText(part, 200))
    .filter(Boolean);

  if (parts.some((part) => part === '.' || part === '..' || part.includes('..'))) {
    throw new Error('Invalid media folder path.');
  }

  return parts.join('/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function getPublicPageMediaDefaultFolder() {
  try {
    const baseFolder = normalizePublicPageRelativeFolder(
      uploadFolderSettingsService.resolveUploadFolder('core.fileManager') || 'misc'
    ) || 'misc';
    return normalizePublicPageRelativeFolder(`${baseFolder}/public-pages`) || PUBLIC_PAGE_MEDIA_FOLDER;
  } catch (_) {
    return PUBLIC_PAGE_MEDIA_FOLDER;
  }
}

function getPublicPageParentFolder(currentFolder = '') {
  const current = normalizePublicPageRelativeFolder(currentFolder);
  if (!current) return '';
  const parent = current.split('/').slice(0, -1).join('/');
  return normalizePublicPageRelativeFolder(parent);
}

function resolvePublicPageMediaPageSize() {
  const raw = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw) || raw <= 0) return 30;
  return Math.max(5, Math.min(500, raw));
}

function encodePublicPageUploadUrl(uploadPath = '') {
  const normalized = String(uploadPath || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return '';
  return normalized
    .split('/')
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join('/');
}

function toPublicPageUploadReference(filePath = '', fileUrl = '') {
  const fromUrl = uploadPathUtils.extractRelativeUploadPath(fileUrl);
  if (fromUrl) return `/uploads/${fromUrl}`;
  const fromPathUrl = uploadPathUtils.extractRelativeUploadPath(filePath);
  if (fromPathUrl) return `/uploads/${fromPathUrl}`;
  return uploadPathUtils.fromDiskPathToUploadsUrl(filePath) || String(fileUrl || filePath || '').replace(/\\/g, '/').trim();
}

function buildPublicPageUploadPath(scopeFolder = 'GLOBAL', folder = '', fileName = '') {
  const cleanScopeFolder = cleanFormText(scopeFolder, 120) || 'GLOBAL';
  const normalizedFolder = normalizePublicPageRelativeFolder(folder);
  const cleanFileName = path.basename(cleanFormText(fileName, 260));
  return `/uploads/${cleanScopeFolder}/${[normalizedFolder, cleanFileName].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
}

function buildPublicPageGatewayMediaRow(entry = {}, currentFolder = '', scopeFolder = 'GLOBAL') {
  const fileName = cleanFormText(entry.name, 260);
  const uploadPath = buildPublicPageUploadPath(scopeFolder, currentFolder, fileName);
  const digest = crypto.createHash('md5').update(uploadPath).digest('hex');
  return {
    id: `LIB_${digest}`,
    name: fileName,
    originalName: fileName,
    filename: fileName,
    path: uploadPath,
    url: encodePublicPageUploadUrl(uploadPath),
    mimeType: '',
    size: Number(entry.size || 0) || 0,
    uploadDate: entry.modified ? new Date(entry.modified).toISOString() : '',
    source: 'public_page_library'
  };
}

function buildPublicPageMediaLibraryRow(filePath = '', stat = null) {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/').trim();
  const fileName = path.basename(normalizedPath);
  const canonicalUrl = toPublicPageUploadReference(normalizedPath, normalizedPath);
  const digest = crypto.createHash('md5').update(canonicalUrl || normalizedPath).digest('hex');
  return {
    id: `LIB_${digest}`,
    name: fileName,
    originalName: fileName,
    filename: fileName,
    path: canonicalUrl || normalizedPath,
    url: encodePublicPageUploadUrl(canonicalUrl) || canonicalUrl,
    mimeType: '',
    size: Number(stat?.size || 0) || 0,
    uploadDate: stat?.mtime ? new Date(stat.mtime).toISOString() : '',
    source: 'public_page_library'
  };
}

async function resolveAvailablePublicPageMediaPath(directory = '', desiredName = '') {
  const cleanName = path.basename(cleanFormText(desiredName, 260) || `file_${Date.now()}`);
  const ext = path.extname(cleanName);
  const base = path.basename(cleanName, ext) || 'file';
  let candidate = pathResolver.resolveSafePath(directory, cleanName);
  let index = 1;

  // eslint-disable-next-line no-await-in-loop
  while (await fs.stat(candidate).then(() => true).catch(() => false)) {
    candidate = pathResolver.resolveSafePath(directory, `${base}_${index}${ext}`);
    index += 1;
  }
  return candidate;
}

async function buildPublicPageUploadedMediaRows(reqFiles = [], targetFolder = '', options = {}) {
  const rows = Array.isArray(reqFiles) ? reqFiles : [];
  const folder = normalizePublicPageRelativeFolder(targetFolder) || getPublicPageMediaDefaultFolder();
  const scope = resolvePublicPageMediaScope(options?.user);
  const output = [];

  for (const file of rows) {
    const originalName = cleanFormText(file.originalname, 260) || cleanFormText(file.filename, 260);
    const stagedPath = String(file?.localPath || file?.path || '').trim();
    let finalName = originalName || cleanFormText(file.filename, 260);
    let reference = '';

    if (isRailwayProxyMode()) {
      const gatewayResult = await gatewayUploadFile({
        scopeKey: scope.scopeKey,
        relativeDir: folder,
        desiredName: originalName || finalName,
        localFilePath: stagedPath,
        mimeType: file.mimetype || 'application/octet-stream'
      });
      finalName = cleanFormText(gatewayResult?.fileName, 260) || finalName;
      reference = toPublicPageUploadReference(gatewayResult?.url, gatewayResult?.url)
        || buildPublicPageUploadPath(scope.scopeFolder, folder, finalName);
      if (stagedPath) await fs.unlink(stagedPath).catch(() => {});
    } else {
      const root = pathResolver.getRootPath(scope.scopeKey);
      const finalDir = pathResolver.resolveSafePath(root, folder);
      pathResolver.ensureDir(finalDir);
      const finalPath = await resolveAvailablePublicPageMediaPath(finalDir, finalName || originalName);
      finalName = path.basename(finalPath);
      if (stagedPath && path.resolve(stagedPath) !== path.resolve(finalPath)) {
        await fs.rename(stagedPath, finalPath);
      }
      reference = toPublicPageUploadReference(finalPath, finalPath);
    }

    output.push({
      id: crypto.randomBytes(8).toString('hex'),
      name: originalName || finalName,
      originalName,
      filename: finalName,
      path: reference,
      url: encodePublicPageUploadUrl(reference) || reference,
      mimeType: cleanFormText(file.mimetype, 120),
      size: Number(file.size || 0) || 0,
      uploadDate: new Date().toISOString(),
      source: 'public_page_upload'
    });
  }

  return output;
}

function toPublicPageRelativeFolder(baseRoot = '', absolutePath = '') {
  const root = String(baseRoot || '').trim();
  const target = String(absolutePath || '').trim();
  if (!root || !target) return '';
  const relative = path.relative(root, target);
  if (!relative || relative === '.') return '';
  return normalizePublicPageRelativeFolder(relative.split(path.sep).join('/'));
}

async function publicPageDirectoryExists(dirPath = '') {
  const stat = await fs.stat(String(dirPath || '')).catch(() => null);
  return Boolean(stat && stat.isDirectory && stat.isDirectory());
}

function buildContactRows(body, titleKey, valueKey, outputKey, fallbackTitle) {
  const titles = asArray(body[titleKey]);
  const values = asArray(body[valueKey]);
  const count = Math.max(titles.length, values.length);
  const rows = [];

  for (let index = 0; index < count && rows.length < 100; index += 1) {
    const value = cleanFormText(values[index], outputKey === 'address' ? 500 : 240);
    if (!value) continue;
    const title = cleanFormText(titles[index], 120) || fallbackTitle;
    rows.push({ title, [outputKey]: value });
  }

  return rows;
}

function buildContactPageHighlights(body) {
  const titles = asArray(body.contactPageHighlightTitle);
  const bodies = asArray(body.contactPageHighlightBody);
  const count = Math.max(titles.length, bodies.length);
  const rows = [];

  for (let index = 0; index < count && rows.length < 6; index += 1) {
    const title = cleanFormText(titles[index], 120);
    const body = cleanFormText(bodies[index], 280);
    if (!title && !body) continue;
    rows.push({ title, body });
  }

  return rows;
}

function buildContactPageProcessImages(body) {
  const urls = asArray(body.contactPageProcessImageUrl);
  const alts = asArray(body.contactPageProcessImageAlt);
  const captions = asArray(body.contactPageProcessImageCaption);
  const count = Math.max(urls.length, alts.length, captions.length);
  const rows = [];

  for (let index = 0; index < count && rows.length < 6; index += 1) {
    const imageUrl = cleanFormText(urls[index], 1200);
    const alt = cleanFormText(alts[index], 240);
    const caption = cleanFormText(captions[index], 400);
    if (!imageUrl) continue;
    rows.push({ imageUrl, alt, caption });
  }

  return rows;
}

function cleanPublicMenuText(value, max = 240) {
  const token = String(value ?? '').replace(/\0/g, '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function validatePublicMenuHref(value) {
  const token = cleanPublicMenuText(value, 1200);
  if (!token) return '';
  if (/[\s"'`<>\\]/.test(token)) return '';
  if (/^\/(?!\/)/.test(token)) return token;
  if (/^https:\/\//i.test(token)) return token;
  if (/^(mailto:|tel:)/i.test(token)) return token;
  return '';
}

function normalizePublicMenuIcon(value) {
  const token = cleanPublicMenuText(value, 80);
  if (!token || !/^[a-z0-9 _-]+$/i.test(token)) return '';
  const parts = token.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const iconPart = parts.find((part) => /^bi-[a-z0-9-]+$/i.test(part));
  if (iconPart) return iconPart;
  const first = parts.find((part) => part.toLowerCase() !== 'bi') || '';
  if (!first) return '';
  return first.startsWith('bi-') ? first : `bi-${first.replace(/^-+/, '')}`;
}

function normalizePublicMenuItems(items, depth = 0, state = { count: 0 }) {
  if (!Array.isArray(items)) throw new Error('Public menu data must be a list of menu items.');
  if (depth >= 3 && items.length) throw new Error('Public menu nesting can be at most 3 levels deep.');

  return items.map((item, index) => {
    state.count += 1;
    if (state.count > 100) throw new Error('Public menu cannot contain more than 100 items.');

    const source = item && typeof item === 'object' ? item : {};
    const label = cleanPublicMenuText(source.label, 120);
    const children = normalizePublicMenuItems(Array.isArray(source.children) ? source.children : [], depth + 1, state);
    const href = validatePublicMenuHref(source.href);
    if (!label) throw new Error(`Public menu item ${index + 1} is missing a label.`);
    if (cleanPublicMenuText(source.href, 1200) && !href) throw new Error(`Public menu item "${label}" has an invalid endpoint URL.`);
    if (!href && !children.length) throw new Error(`Public menu item "${label}" needs an endpoint URL unless it has child menu items.`);

    const visibilityRaw = cleanPublicMenuText(source.visibility, 32).toLowerCase();
    const visibility = ['all', 'guest', 'authenticated'].includes(visibilityRaw) ? visibilityRaw : 'all';
    const id = cleanPublicMenuText(source.id, 120) || `menu-${Date.now()}-${depth}-${index}`;

    return {
      id,
      label,
      href,
      icon: normalizePublicMenuIcon(source.icon),
      visibility,
      target: source.target === '_blank' ? '_blank' : '_self',
      active: source.active !== false,
      children
    };
  });
}

function parsePublicMenuFromRequest(body = {}) {
  if (typeof body.publicMenuJson !== 'string') {
    throw new Error('Public menu data is missing. Reload App Defaults and try again.');
  }

  let parsed;
  try {
    parsed = JSON.parse(body.publicMenuJson || '[]');
  } catch (error) {
    throw new Error('Public menu data is not valid JSON.');
  }

  return {
    items: normalizePublicMenuItems(parsed, 0)
  };
}

function parsePublicDefaultHomePath(body = {}) {
  const token = cleanPublicMenuText(body.publicHomePath, 1200);
  if (!token) return '/';
  if (!(token === '/' || /^\/(?!\/)/.test(token))) {
    throw new Error('Default Home page must be an internal route beginning with "/" (for example, "/", "/news", "/pte").');
  }
  if (/[\s"'`<>\\]/.test(token)) {
    throw new Error('Default Home page URL contains unsupported characters.');
  }
  return token;
}

exports.updateAppSettings = async (req, res) => {
  try {
    const contactEmails = buildContactRows(req.body, 'contactEmailTitle', 'contactEmailValue', 'email', 'Email');
    const contactPhones = buildContactRows(req.body, 'contactPhoneTitle', 'contactPhoneValue', 'number', 'Phone');
    const contactFaxes = buildContactRows(req.body, 'contactFaxTitle', 'contactFaxValue', 'number', 'Fax');
    const contactAddresses = buildContactRows(req.body, 'contactAddressTitle', 'contactAddressValue', 'address', 'Address');
    const contactPageHighlights = buildContactPageHighlights(req.body || {});
    const contactPageProcessImages = buildContactPageProcessImages(req.body || {});
    const publicMenu = parsePublicMenuFromRequest(req.body || {});
    const publicHomePath = parsePublicDefaultHomePath(req.body || {});
    publicMenu.defaultHomePath = publicHomePath;

    const formData = {
      app: {
        defaultPageSize: parseInt(req.body.defaultPageSize, 10),
        searchDefaultKeyword: req.body.searchDefaultKeyword,
        // Save raw string exactly as typed (e.g., "uploads" or "/app/uploads")
        uploadsPath: req.body.uploadsPath,
        brand: {
          appName: req.body.appName,
          appShortName: req.body.appShortName,
          tagline: req.body.tagline,
          logoUrl: req.body.logoUrl,
          iconSvgUrl: req.body.iconSvgUrl,
          appleTouchIconUrl: req.body.appleTouchIconUrl,
          themeColor: req.body.themeColor,
          ownerDisplayName: req.body.ownerDisplayName,
          footerAboutTitle: req.body.footerAboutTitle,
          footerAboutText: req.body.footerAboutText,
          footerLogoAlt: req.body.footerLogoAlt,
          footerShowNewsletter: req.body.footerShowNewsletter === 'true',
          instagramUrl: req.body.instagramUrl,
          facebookUrl: req.body.facebookUrl,
          linkedinUrl: req.body.linkedinUrl,
          youtubeUrl: req.body.youtubeUrl
        },
        contact: {
          emails: contactEmails,
          phones: contactPhones,
          faxes: contactFaxes,
          addresses: contactAddresses,
          email: contactEmails[0]?.email || '',
          collegeEmail: '',
          phone: contactPhones[0]?.number || '',
          fax: contactFaxes[0]?.number || '',
          address: contactAddresses[0]?.address || ''
        },
        contactPage: {
          heroEyebrow: req.body.contactPageHeroEyebrow,
          heroTitle: req.body.contactPageHeroTitle,
          heroSubtitle: req.body.contactPageHeroSubtitle,
          primaryCtaLabel: req.body.contactPagePrimaryCtaLabel,
          emailCtaLabel: req.body.contactPageEmailCtaLabel,
          followUpCtaLabel: req.body.contactPageFollowUpCtaLabel,
          highlights: contactPageHighlights,
          formEyebrow: req.body.contactPageFormEyebrow,
          formTitle: req.body.contactPageFormTitle,
          formSubtitle: req.body.contactPageFormSubtitle,
          formHint: req.body.contactPageFormHint,
          directContactKicker: req.body.contactPageDirectContactKicker,
          directContactTitle: req.body.contactPageDirectContactTitle,
          directContactLead: req.body.contactPageDirectContactLead,
          directContactMethodsTitle: req.body.contactPageDirectContactMethodsTitle,
          directContactMethodsSubtitle: req.body.contactPageDirectContactMethodsSubtitle,
          directContactEmailActionLabel: req.body.contactPageDirectContactEmailActionLabel,
          directContactPhoneActionLabel: req.body.contactPageDirectContactPhoneActionLabel,
          directContactFaxActionLabel: req.body.contactPageDirectContactFaxActionLabel,
          directContactDefaultActionLabel: req.body.contactPageDirectContactDefaultActionLabel,
          aboutCardTitle: req.body.contactPageAboutCardTitle,
          aboutCardBody: req.body.contactPageAboutCardBody,
          aboutCardButtonLabel: req.body.contactPageAboutCardButtonLabel,
          aboutCardHref: req.body.contactPageAboutCardHref,
          processEyebrow: req.body.contactPageProcessEyebrow,
          processTitle: req.body.contactPageProcessTitle,
          processImages: contactPageProcessImages
        },
        publicMenu
      }
    };

    // 1. Save to Disk
    await systemSettingsRepository.updateSettings(formData, req.user);
    
    // 2. Refresh Cache
    await settingService.refresh();

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Application defaults saved.' });
    res.redirect('/systemSettings/app');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   PUBLIC PAGE CONTENT
========================================================= */
exports.listPublicPageMediaLibrary = async (req, res) => {
  try {
    const defaultPageSize = resolvePublicPageMediaPageSize();
    const defaultFolder = getPublicPageMediaDefaultFolder();
    const scope = resolvePublicPageMediaScope(req.user);
    const hasRequestedFolder = Object.prototype.hasOwnProperty.call(req.query || {}, 'folder');
    const requestedFolder = hasRequestedFolder
      ? normalizePublicPageRelativeFolder(req.query?.folder)
      : '';
    const candidateFolders = hasRequestedFolder
      ? [requestedFolder, defaultFolder, '']
      : [defaultFolder, ''];

    if (isRailwayProxyMode()) {
      const currentFolder = hasRequestedFolder ? requestedFolder : defaultFolder;
      const gatewayResult = await gatewayListDirectory({
        scopeKey: scope.scopeKey,
        relativeDir: currentFolder
      });
      const entries = Array.isArray(gatewayResult?.files) ? gatewayResult.files : [];
      const folders = [];
      const fileRows = [];

      entries.forEach((entry) => {
        if (!entry) return;
        const name = cleanFormText(entry.name, 260);
        if (!name) return;
        if (entry.isDir) {
          folders.push({
            name,
            path: normalizePublicPageRelativeFolder([currentFolder, name].filter(Boolean).join('/'))
          });
          return;
        }
        fileRows.push(buildPublicPageGatewayMediaRow(entry, currentFolder, scope.scopeFolder));
      });

      folders.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      fileRows.sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));

      return res.json({
        status: 'success',
        message: fileRows.length ? `Loaded ${fileRows.length} file(s).` : 'No saved public page files found in this folder.',
        results: fileRows,
        scopeFolder: scope.scopeFolder,
        folders,
        currentFolder,
        parentFolder: getPublicPageParentFolder(currentFolder),
        defaultFolder,
        defaults: { pageSize: defaultPageSize }
      });
    }

    const root = pathResolver.getRootPath(scope.scopeKey);
    let currentFolder = '';
    for (const folderToken of candidateFolders) {
      const maybePath = folderToken
        ? pathResolver.resolveSafePath(root, folderToken)
        : root;
      // eslint-disable-next-line no-await-in-loop
      const exists = await publicPageDirectoryExists(maybePath);
      if (exists) {
        currentFolder = normalizePublicPageRelativeFolder(folderToken);
        break;
      }
    }

    const currentPath = currentFolder
      ? pathResolver.resolveSafePath(root, currentFolder)
      : root;
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    const folders = [];
    const fileRows = [];

    for (const entry of entries) {
      if (!entry) continue;
      const absolutePath = pathResolver.resolveSafePath(currentPath, entry.name);
      if (entry.isDirectory && entry.isDirectory()) {
        const relativePath = toPublicPageRelativeFolder(root, absolutePath);
        folders.push({
          name: cleanFormText(entry.name, 260) || relativePath || '/',
          path: normalizePublicPageRelativeFolder(relativePath)
        });
        continue;
      }
      if (!entry.isFile || !entry.isFile()) continue;
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat || !stat.isFile || !stat.isFile()) continue;
      fileRows.push(buildPublicPageMediaLibraryRow(absolutePath, stat));
    }

    folders.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    fileRows.sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));

    return res.json({
      status: 'success',
      message: fileRows.length ? `Loaded ${fileRows.length} file(s).` : 'No saved public page files found in this folder.',
      results: fileRows,
      scopeFolder: scope.scopeFolder,
      folders,
      currentFolder,
      parentFolder: getPublicPageParentFolder(currentFolder),
      defaultFolder,
      defaults: { pageSize: defaultPageSize }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load public page media library.' });
  }
};

exports.uploadPublicPageMedia = async (req, res) => {
  try {
    const requestedFolder = normalizePublicPageRelativeFolder(req.body?.folder || '') || getPublicPageMediaDefaultFolder();
    const rows = await buildPublicPageUploadedMediaRows(req.files || [], requestedFolder, { user: req.user });
    return res.json({
      status: 'success',
      message: rows.length ? 'Public page media uploaded successfully.' : 'No files were uploaded.',
      results: rows
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to upload public page media.' });
  }
};

exports.showPublicPageContentSettings = async (req, res) => {
  try {
    const data = await publicPageContentSettingsDataService.getSettingsForManagement();
    res.render('systemSettings/publicPageContentSettings', {
      title: 'Public Page Content',
      data,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updatePublicPageContentSettings = async (req, res) => {
  try {
    const saved = await publicPageContentSettingsDataService.saveSettings(req.body || {}, req.user);
    if (req.headers['x-ajax-request'] || req.xhr || String(req.headers.accept || '').includes('json')) {
      return res.json({
        status: 'success',
        message: 'Public page content saved.',
        data: saved
      });
    }
    return res.redirect('/systemSettings/public-pages');
  } catch (error) {
    if (req.headers['x-ajax-request'] || req.xhr || String(req.headers.accept || '').includes('json')) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to save public page content.' });
    }
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showUploadFolderSettings = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    res.render('systemSettings/uploadFolderSettings', {
      title: 'Upload Folder Settings',
      settings,
      definitions: uploadFolderSettingsService.getUploadFolderDefinitions(),
      groups: uploadFolderSettingsService.GROUPS,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateUploadFolderSettings = async (req, res) => {
  try {
    const sanitized = uploadFolderSettingsService.sanitizeUploadFolderSettings(req.body?.uploadFolders || {}, {
      required: false
    });

    await systemSettingsRepository.updateSettings({
      app: {
        uploadFolders: sanitized
      }
    }, req.user);
    await settingService.refresh();

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Upload folder settings saved.' });
    }
    return res.redirect('/systemSettings/upload-folders');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Upload Folder Settings Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   DATA BACKEND MODE (Restart-based)
========================================================= */
exports.showDataBackendSettings = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const productionLocked = Boolean(runtimeBackend?.production?.active);

    res.render('systemSettings/dataBackendSettings', {
      title: 'Data Backend Mode',
      settings,
      runtimeBackend,
      productionLocked,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateDataBackendSettings = async (req, res) => {
  try {
    const message = 'Runtime data backend is configured only through environment variables. Set DATA_BACKEND and MONGODB_URI in deployment variables, then restart the app. Legacy MONGO_URI is still supported temporarily.';

    if (req.headers['x-ajax-request']) {
      return res.status(400).json({
        status: 'error',
        message,
        runtimeBackend: dataBackendRuntimeService.getPublicBackendStatus()
      });
    }
    res.status(400).render('error', { title: 'Data Backend Locked', message, user: req.user });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.retryDataBackendConnection = async (req, res) => {
  try {
    const runtimeBackend = await dataBackendRuntimeService.retryMongoConnection(process.env);
    registerCoreEntityQueryExecutors({ backendMode: runtimeBackend.mode });
    await settingService.refresh();
    actionStateRetentionService.start({ enabled: runtimeBackend.mode === 'mongo' });
    if (req.app?.locals) {
      req.app.locals.dataBackend = dataBackendRuntimeService.getPublicBackendStatus();
    }

    if (req.headers['x-ajax-request']) {
      return res.json({
        status: 'success',
        message: 'Mongo connection retry succeeded. Active backend is now Mongo.',
        runtimeBackend: dataBackendRuntimeService.getPublicBackendStatus()
      });
    }
    return res.redirect('/systemSettings/data-backend');
  } catch (error) {
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    if (req.app?.locals) req.app.locals.dataBackend = runtimeBackend;
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({
        status: 'error',
        message: error.message || 'Mongo connection retry failed.',
        runtimeBackend
      });
    }
    return res.status(400).render('systemSettings/dataBackendSettings', {
      title: 'Data Backend Mode',
      settings: await systemSettingsRepository.getSettings(),
      runtimeBackend,
      productionLocked: Boolean(runtimeBackend?.production?.active),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId,
      retryError: error.message || 'Mongo connection retry failed.'
    });
  }
};

exports.restoreMongoBackup = async (req, res) => {
  try {
    if (!checkAdminVerificationCode(req)) {
      throw new Error('Security Violation: High Privilege Access requested without valid Admin Verification.');
    }
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      throw new Error('Select a Mongo backup file to restore.');
    }

    const report = await jsonToMongoMigrationService.restoreMongoBackupFromBuffer(req.file.buffer, {
      fileName: req.file.originalname || 'mongo-backup.jsonl.gz',
      userId: req.user?.id || ''
    });
    await settingService.refresh().catch(() => null);

    return res.json({
      status: 'success',
      message: `Database restore completed. Restored ${report.totalDocuments} document(s) across ${report.totalCollections} collection(s).`,
      report
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Database restore failed.'
    });
  }
};

/* =========================================================
   BIDIRECTIONAL DATA MIGRATION (UI-driven)
========================================================= */
exports.showDataMigrationPage = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();

    let migrationRows = [];
    let coverage = null;
    let loadWarning = '';
    try {
      if (runtimeBackend?.mode === 'mongo' && runtimeBackend?.mongo?.ready) {
        await jsonToMongoMigrationService.ensureMongoReady();
      }
      migrationRows = await jsonToMongoMigrationService.buildDashboardRows({
        includeTargetCounts: false,
        includeSourceCounts: false
      });
      coverage = await jsonToMongoMigrationService.buildCoverageAudit();
    } catch (error) {
      loadWarning = error.message;
      migrationRows = await jsonToMongoMigrationService.buildDashboardRows({
        includeTargetCounts: false,
        includeSourceCounts: false
      });
      coverage = await jsonToMongoMigrationService.buildCoverageAudit().catch(() => null);
    }

    res.render('systemSettings/dataMigrationSettings', {
      title: 'Data Migration (JSON <-> Mongo)',
      settings,
      runtimeBackend,
      migrationRows,
      coverage,
      loadWarning,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.listDataMigrationItems = async (req, res) => {
  try {
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const result = await jsonToMongoMigrationService.listMigrationItems({
      query: req.query || {},
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.limit
    });
    return res.json({
      status: 'success',
      runtimeBackend: {
        mode: runtimeBackend.mode,
        mongoReady: Boolean(runtimeBackend?.mongo?.ready),
        mongoSource: runtimeBackend?.mongo?.source || 'none'
      },
      ...result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.countDataMigrationItems = async (req, res) => {
  try {
    const keys = Array.isArray(req.body.keys)
      ? req.body.keys
      : String(req.body.keys || '').split(',').map((item) => item.trim()).filter(Boolean);
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    if (runtimeBackend?.mode === 'mongo' && runtimeBackend?.mongo?.ready) {
      await jsonToMongoMigrationService.ensureMongoReady();
    }
    const counts = await jsonToMongoMigrationService.getMigrationCounts(keys, {
      mongoReady: Boolean(runtimeBackend?.mode === 'mongo' && runtimeBackend?.mongo?.ready)
    });
    return res.json({
      status: 'success',
      counts
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.downloadMongoBackup = async (req, res) => {
  try {
    await jsonToMongoMigrationService.streamMongoBackup(res, {
      userId: req.user?.id || ''
    });
  } catch (error) {
    if (res.headersSent) {
      return res.end();
    }
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.dryRunDataMigrationItem = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Migration item key is required.');
    const report = await jsonToMongoMigrationService.dryRunMigrationItem(key);
    return res.json({
      status: 'success',
      message: `Dry run completed for ${key}.`,
      report
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.transferDataMigrationItem = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Migration item key is required.');
    const report = await jsonToMongoMigrationService.transferMigrationItem(key);
    return res.json({
      status: 'success',
      message: `Transfer completed for ${key}.`,
      report
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.transferAllDataMigrationItems = async (req, res) => {
  try {
    const includeOptional = String(req.body.includeOptional || '').trim().toLowerCase() === 'true';
    const reports = await jsonToMongoMigrationService.transferAllMigrationItems({ includeOptional });
    const inserted = reports.reduce((sum, item) => sum + Number(item.inserted || 0), 0);
    const updated = reports.reduce((sum, item) => sum + Number(item.updated || 0), 0);
    const skipped = reports.reduce(
      (sum, item) => sum + Number(item.skippedInvalid || 0) + Number(item.skippedMissingId || 0),
      0
    );
    return res.json({
      status: 'success',
      message: `Transfer all completed. Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped}.`,
      reports
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.dryRunClearDataMigrationTargetItem = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Migration item key is required.');
    const report = await jsonToMongoMigrationService.dryRunClearTargetCollectionItem(key);
    return res.json({
      status: 'success',
      message: `Clear-target dry run completed for ${key}.`,
      report
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.clearDataMigrationTargetItem = async (req, res) => {
  try {
    if (!checkAdminVerificationCode(req)) {
      throw new Error('Security Violation: High Privilege Access requested without valid Admin Verification.');
    }
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Migration item key is required.');
    const report = await jsonToMongoMigrationService.clearTargetCollectionItem(key);
    return res.json({
      status: 'success',
      message: `Target collection cleared for ${key}.`,
      report
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.replaceDataMigrationItem = async (req, res) => {
  try {
    if (!checkAdminVerificationCode(req)) {
      throw new Error('Security Violation: High Privilege Access requested without valid Admin Verification.');
    }
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Migration item key is required.');
    const report = await jsonToMongoMigrationService.replaceMigrationItem(key);
    return res.json({
      status: 'success',
      message: `Replace completed for ${key}. Target was cleared and then copied from source.`,
      report
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.dryRunDataMigrationItemReverse = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Migration item key is required.');
    const report = await jsonToMongoMigrationService.dryRunReverseMigrationItem(key);
    return res.json({
      status: 'success',
      message: `Reverse dry run completed for ${key}.`,
      report
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.transferDataMigrationItemReverse = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Migration item key is required.');
    const report = await jsonToMongoMigrationService.transferReverseMigrationItem(key);
    return res.json({
      status: 'success',
      message: `Reverse transfer completed for ${key}.`,
      report
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.transferAllDataMigrationItemsReverse = async (req, res) => {
  try {
    const includeOptional = String(req.body.includeOptional || '').trim().toLowerCase() === 'true';
    const reports = await jsonToMongoMigrationService.transferAllReverseMigrationItems({ includeOptional });
    const written = reports.reduce((sum, item) => sum + Number(item.written || 0), 0);
    const deletedFiles = reports.reduce((sum, item) => sum + Number(item.deletedFiles || 0), 0);
    const skipped = reports.reduce(
      (sum, item) => sum + Number(item.skippedInvalidMongo || 0) + Number(item.skippedMissingId || 0),
      0
    );
    return res.json({
      status: 'success',
      message: `Reverse transfer all completed. Written: ${written}, Deleted stale files: ${deletedFiles}, Skipped: ${skipped}.`,
      reports
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
