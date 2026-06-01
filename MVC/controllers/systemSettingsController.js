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
const packageQueryExecutorService = require('../services/packageQueryExecutorService');
const systemSettingsPackageManagerService = require('../services/systemSettingsPackageManagerService');
const systemSettingsPackageBuilderService = require('../services/systemSettingsPackageBuilderService');
const coreBootstrapBaselineService = require('../services/coreBootstrapBaselineService');
const coreResetRebootstrapService = require('../services/coreResetRebootstrapService');
const actionStateRetentionService = require('../services/actionStateRetentionService');
const jsonToMongoMigrationService = require('../services/migration/jsonToMongoMigrationService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const publicPageContentSettingsDataService = require('../services/publicPageContentSettingsDataService');
const coreFilesService = require('../services/coreFilesService');
const localPackageSyncService = require('../services/localPackageSyncService');
const { checkAdminVerificationCode } = require('../utils/encyptors');
const { getPackageStorageRootAbsolute, getPackageStorageRootResolution } = require('../utils/packageStoragePathUtils');

const PUBLIC_PAGE_MEDIA_FOLDER = 'misc/public-pages';
const MONGO_RESTORE_MAX_UPLOAD_MB = Number.parseInt(process.env.MONGO_BACKUP_RESTORE_MAX_MB || '100', 10) || 100;

function parsePositiveMb(...values) {
  for (const raw of values) {
    const parsed = Number.parseInt(String(raw || '').trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function getPackageZipUploadLimitMb() {
  return parsePositiveMb(
    process.env.PACKAGE_ZIP_INSTALL_MAX_UPLOAD_MB,
    process.env.APP_UPLOAD_MAX_FILE_MB,
    process.env.FILE_UPLOAD_MAX_MB,
    process.env.FILE_GATEWAY_MAX_FILE_MB,
    50
  ) || 50;
}

function buildOperationError(code, message, details = null) {
  const error = new Error(message || 'Operation failed.');
  error.code = cleanFormText(code, 120) || 'OPERATION_FAILED';
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

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
    const formData = {
      organization: {
        allowFreeRegistration: req.body.allowFreeRegistration === 'true',
        defaultTrialDays: parseInt(req.body.defaultTrialDays || '0', 10),
        freeOrgId: parseInt(req.body.freeOrgId, 10),
        freeOrgName: req.body.freeOrgName
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

function parseFileFieldSelectionInput(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = cleanFormText(value, 200000);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
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
  const fromUrl = coreFilesService.extractRelativeUploadPath(fileUrl);
  if (fromUrl) return `/uploads/${fromUrl}`;
  const fromPathUrl = coreFilesService.extractRelativeUploadPath(filePath);
  if (fromPathUrl) return `/uploads/${fromPathUrl}`;
  return coreFilesService.fromDiskPathToUploadsUrl(filePath) || String(fileUrl || filePath || '').replace(/\\/g, '/').trim();
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

async function buildPublicPageUploadedMediaRows(reqFiles = [], targetFolder = '', options = {}) {
  const rows = Array.isArray(reqFiles) ? reqFiles : [];
  const folder = normalizePublicPageRelativeFolder(targetFolder) || getPublicPageMediaDefaultFolder();
  const scope = resolvePublicPageMediaScope(options?.user);
  const baseDir = coreFilesService.getRootPath(scope.scopeKey);
  const targetPath = folder
    ? coreFilesService.resolveSafePath(baseDir, folder)
    : baseDir;
  coreFilesService.ensureDir(targetPath);
  const context = {
    scopeKey: scope.scopeKey,
    relativeSub: folder,
    currentPath: [scope.scopeFolder, folder].filter(Boolean).join('/'),
    baseDir,
    targetPath
  };
  const relativePaths = rows.map((file, index) =>
    cleanFormText(file?.originalname, 260)
      || cleanFormText(file?.filename, 260)
      || `public-page-file-${Date.now()}-${index + 1}`
  );
  const uploadResult = await coreFilesService.uploadFilesToContext({
    context,
    files: rows,
    relativePaths
  });
  const uploadedRows = Array.isArray(uploadResult?.files) ? uploadResult.files : [];

  return uploadedRows.map((uploaded, index) => {
    const uploadedName = cleanFormText(uploaded?.name, 260)
      || cleanFormText(rows[index]?.originalname, 260)
      || cleanFormText(rows[index]?.filename, 260);
    const reference = toPublicPageUploadReference(uploaded?.url, uploaded?.url)
      || buildPublicPageUploadPath(scope.scopeFolder, folder, uploadedName);
    return {
      id: crypto.randomBytes(8).toString('hex'),
      name: uploadedName,
      originalName: uploadedName,
      filename: uploadedName,
      path: reference,
      url: encodePublicPageUploadUrl(reference) || reference,
      mimeType: cleanFormText(rows[index]?.mimetype, 120),
      size: Number(uploaded?.size || rows[index]?.size || 0) || 0,
      uploadDate: new Date().toISOString(),
      source: 'public_page_upload'
    };
  });
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
    throw new Error('Default Home page must be an internal route beginning with "/" (for example, "/", "/news", "/about").');
  }
  if (/[\s"'`<>\\]/.test(token)) {
    throw new Error('Default Home page URL contains unsupported characters.');
  }
  return token;
}

exports.updateAppSettings = async (req, res) => {
  try {
    const existingSettings = await systemSettingsRepository.getSettings();
    const existingApp = (existingSettings && existingSettings.app && typeof existingSettings.app === 'object')
      ? existingSettings.app
      : {};
    const existingBrand = (existingApp.brand && typeof existingApp.brand === 'object') ? existingApp.brand : {};
    const existingContactPage = (existingApp.contactPage && typeof existingApp.contactPage === 'object') ? existingApp.contactPage : {};
    const existingPublicMenu = (existingApp.publicMenu && typeof existingApp.publicMenu === 'object') ? existingApp.publicMenu : {};
    const body = req.body || {};

    const contactEmails = buildContactRows(req.body, 'contactEmailTitle', 'contactEmailValue', 'email', 'Email');
    const contactPhones = buildContactRows(req.body, 'contactPhoneTitle', 'contactPhoneValue', 'number', 'Phone');
    const contactFaxes = buildContactRows(req.body, 'contactFaxTitle', 'contactFaxValue', 'number', 'Fax');
    const contactAddresses = buildContactRows(req.body, 'contactAddressTitle', 'contactAddressValue', 'address', 'Address');

    const hasContactPagePayload = Object.prototype.hasOwnProperty.call(body, 'contactPageHeroEyebrow')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageHeroTitle')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageHeroSubtitle');
    const hasPublicMenuPayload = Object.prototype.hasOwnProperty.call(body, 'publicMenuJson')
      || Object.prototype.hasOwnProperty.call(body, 'publicHomePath');

    const hasHeaderBuyCoffeePresence = Object.prototype.hasOwnProperty.call(body, 'headerShowBuyMeACoffee_present');
    const hasHeaderBuyCoffeeToggle = hasHeaderBuyCoffeePresence
      || Object.prototype.hasOwnProperty.call(body, 'headerShowBuyMeACoffee');
    const hasHeaderBuyCoffeePayload = hasHeaderBuyCoffeeToggle
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeUrl')
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeLabel')
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeText')
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeTitle');

    const contactPageHighlights = hasContactPagePayload ? buildContactPageHighlights(body) : (existingContactPage.highlights || []);
    const contactPageProcessImages = hasContactPagePayload ? buildContactPageProcessImages(body) : (existingContactPage.processImages || []);

    const publicMenu = hasPublicMenuPayload ? parsePublicMenuFromRequest(body) : { ...existingPublicMenu };
    if (hasPublicMenuPayload) {
      const publicHomePath = parsePublicDefaultHomePath(body);
      publicMenu.defaultHomePath = publicHomePath;
    }

    const formData = {
      app: {
        defaultPageSize: parseInt(req.body.defaultPageSize, 10),
        searchDefaultKeyword: req.body.searchDefaultKeyword,
        buildVersionOverride: cleanFormText(req.body.buildVersionOverride, 120),
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
          youtubeUrl: req.body.youtubeUrl,
          headerShowBuyMeACoffee: hasHeaderBuyCoffeeToggle
            ? req.body.headerShowBuyMeACoffee === 'true'
            : (existingBrand.headerShowBuyMeACoffee !== false),
          headerBuyMeACoffeeUrl: hasHeaderBuyCoffeePayload
            ? req.body.headerBuyMeACoffeeUrl
            : existingBrand.headerBuyMeACoffeeUrl,
          headerBuyMeACoffeeLabel: hasHeaderBuyCoffeePayload
            ? req.body.headerBuyMeACoffeeLabel
            : existingBrand.headerBuyMeACoffeeLabel,
          headerBuyMeACoffeeText: hasHeaderBuyCoffeePayload
            ? req.body.headerBuyMeACoffeeText
            : existingBrand.headerBuyMeACoffeeText,
          headerBuyMeACoffeeTitle: hasHeaderBuyCoffeePayload
            ? req.body.headerBuyMeACoffeeTitle
            : existingBrand.headerBuyMeACoffeeTitle
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
          heroEyebrow: hasContactPagePayload ? req.body.contactPageHeroEyebrow : existingContactPage.heroEyebrow,
          heroTitle: hasContactPagePayload ? req.body.contactPageHeroTitle : existingContactPage.heroTitle,
          heroSubtitle: hasContactPagePayload ? req.body.contactPageHeroSubtitle : existingContactPage.heroSubtitle,
          primaryCtaLabel: hasContactPagePayload ? req.body.contactPagePrimaryCtaLabel : existingContactPage.primaryCtaLabel,
          emailCtaLabel: hasContactPagePayload ? req.body.contactPageEmailCtaLabel : existingContactPage.emailCtaLabel,
          followUpCtaLabel: hasContactPagePayload ? req.body.contactPageFollowUpCtaLabel : existingContactPage.followUpCtaLabel,
          highlights: contactPageHighlights,
          formEyebrow: hasContactPagePayload ? req.body.contactPageFormEyebrow : existingContactPage.formEyebrow,
          formTitle: hasContactPagePayload ? req.body.contactPageFormTitle : existingContactPage.formTitle,
          formSubtitle: hasContactPagePayload ? req.body.contactPageFormSubtitle : existingContactPage.formSubtitle,
          formHint: hasContactPagePayload ? req.body.contactPageFormHint : existingContactPage.formHint,
          directContactKicker: hasContactPagePayload ? req.body.contactPageDirectContactKicker : existingContactPage.directContactKicker,
          directContactTitle: hasContactPagePayload ? req.body.contactPageDirectContactTitle : existingContactPage.directContactTitle,
          directContactLead: hasContactPagePayload ? req.body.contactPageDirectContactLead : existingContactPage.directContactLead,
          directContactMethodsTitle: hasContactPagePayload ? req.body.contactPageDirectContactMethodsTitle : existingContactPage.directContactMethodsTitle,
          directContactMethodsSubtitle: hasContactPagePayload ? req.body.contactPageDirectContactMethodsSubtitle : existingContactPage.directContactMethodsSubtitle,
          directContactEmailActionLabel: hasContactPagePayload ? req.body.contactPageDirectContactEmailActionLabel : existingContactPage.directContactEmailActionLabel,
          directContactPhoneActionLabel: hasContactPagePayload ? req.body.contactPageDirectContactPhoneActionLabel : existingContactPage.directContactPhoneActionLabel,
          directContactFaxActionLabel: hasContactPagePayload ? req.body.contactPageDirectContactFaxActionLabel : existingContactPage.directContactFaxActionLabel,
          directContactDefaultActionLabel: hasContactPagePayload ? req.body.contactPageDirectContactDefaultActionLabel : existingContactPage.directContactDefaultActionLabel,
          aboutCardTitle: hasContactPagePayload ? req.body.contactPageAboutCardTitle : existingContactPage.aboutCardTitle,
          aboutCardBody: hasContactPagePayload ? req.body.contactPageAboutCardBody : existingContactPage.aboutCardBody,
          aboutCardButtonLabel: hasContactPagePayload ? req.body.contactPageAboutCardButtonLabel : existingContactPage.aboutCardButtonLabel,
          aboutCardHref: hasContactPagePayload ? req.body.contactPageAboutCardHref : existingContactPage.aboutCardHref,
          processEyebrow: hasContactPagePayload ? req.body.contactPageProcessEyebrow : existingContactPage.processEyebrow,
          processTitle: hasContactPagePayload ? req.body.contactPageProcessTitle : existingContactPage.processTitle,
          processImages: contactPageProcessImages
        },
        publicMenu
      }
    };

    // 1. Save to Disk
    await systemSettingsRepository.updateSettings(formData, req.user);
    
    // 2. Refresh Cache
    await settingService.refresh();
    if (req.app?.locals && typeof req.app.locals.refreshBuildVersion === 'function') {
      req.app.locals.refreshBuildVersion();
    }

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Application defaults saved.' });
    const returnTo = cleanFormText(req.body?.returnTo, 240);
    if (returnTo && /^\/systemSettings\/[a-z0-9\-_/]+$/i.test(returnTo)) {
      return res.redirect(returnTo);
    }
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

    let currentFolder = '';
    let entries = [];
    for (const folderToken of candidateFolders) {
      // eslint-disable-next-line no-await-in-loop
      const listed = await coreFilesService.listDirectoryByScope({
        scopeKey: scope.scopeKey,
        relativeDir: normalizePublicPageRelativeFolder(folderToken)
      }).catch(() => null);
      if (Array.isArray(listed)) {
        currentFolder = normalizePublicPageRelativeFolder(folderToken);
        entries = listed;
        break;
      }
    }
    const folders = [];
    const fileRows = [];

    for (const entry of entries) {
      if (!entry) continue;
      const name = cleanFormText(entry.name, 260);
      if (!name) continue;
      if (entry.isDir) {
        folders.push({
          name,
          path: normalizePublicPageRelativeFolder([currentFolder, name].filter(Boolean).join('/'))
        });
        continue;
      }
      fileRows.push(buildPublicPageGatewayMediaRow(entry, currentFolder, scope.scopeFolder));
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
    const settings = await systemSettingsRepository.getSettings();
    res.render('systemSettings/publicPageContentSettings', {
      title: 'Public Page Content',
      data,
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

exports.updatePublicPageContentSettings = async (req, res) => {
  try {
    const body = req.body || {};
    const saved = await publicPageContentSettingsDataService.saveSettings(body, req.user);

    const existingSettings = await systemSettingsRepository.getSettings();
    const existingApp = (existingSettings && existingSettings.app && typeof existingSettings.app === 'object')
      ? existingSettings.app
      : {};
    const existingBrand = (existingApp.brand && typeof existingApp.brand === 'object') ? existingApp.brand : {};
    const existingContactPage = (existingApp.contactPage && typeof existingApp.contactPage === 'object') ? existingApp.contactPage : {};
    const existingPublicMenu = (existingApp.publicMenu && typeof existingApp.publicMenu === 'object') ? existingApp.publicMenu : {};

    const hasContactPagePayload = Object.prototype.hasOwnProperty.call(body, 'contactPageHeroEyebrow')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageHeroTitle')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageHeroSubtitle')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageHighlightTitle')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageHighlightBody')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageProcessImageUrl')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageProcessImageAlt')
      || Object.prototype.hasOwnProperty.call(body, 'contactPageProcessImageCaption');
    const hasPublicMenuPayload = Object.prototype.hasOwnProperty.call(body, 'publicMenuJson')
      || Object.prototype.hasOwnProperty.call(body, 'publicHomePath');
    const hasHeaderBuyCoffeePresence = Object.prototype.hasOwnProperty.call(body, 'headerShowBuyMeACoffee_present');
    const hasHeaderBuyCoffeeToggle = hasHeaderBuyCoffeePresence
      || Object.prototype.hasOwnProperty.call(body, 'headerShowBuyMeACoffee');
    const hasHeaderBuyCoffeePayload = hasHeaderBuyCoffeeToggle
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeUrl')
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeLabel')
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeText')
      || Object.prototype.hasOwnProperty.call(body, 'headerBuyMeACoffeeTitle');

    if (hasContactPagePayload || hasPublicMenuPayload || hasHeaderBuyCoffeePayload) {
      const hasContactPageHighlightsPayload = Object.prototype.hasOwnProperty.call(body, 'contactPageHighlightTitle')
        || Object.prototype.hasOwnProperty.call(body, 'contactPageHighlightBody');
      const hasContactPageProcessImagesPayload = Object.prototype.hasOwnProperty.call(body, 'contactPageProcessImageUrl')
        || Object.prototype.hasOwnProperty.call(body, 'contactPageProcessImageAlt')
        || Object.prototype.hasOwnProperty.call(body, 'contactPageProcessImageCaption');
      const contactPageHighlights = hasContactPageHighlightsPayload
        ? buildContactPageHighlights(body)
        : (existingContactPage.highlights || []);
      const contactPageProcessImages = hasContactPageProcessImagesPayload
        ? buildContactPageProcessImages(body)
        : (existingContactPage.processImages || []);
      const readBodyOrExisting = (fieldKey, existingValue = '') => (
        Object.prototype.hasOwnProperty.call(body, fieldKey) ? body[fieldKey] : existingValue
      );

      const publicMenu = hasPublicMenuPayload ? parsePublicMenuFromRequest(body) : { ...existingPublicMenu };
      if (hasPublicMenuPayload) {
        publicMenu.defaultHomePath = parsePublicDefaultHomePath(body);
      }

      await systemSettingsRepository.updateSettings({
        app: {
          brand: {
            headerShowBuyMeACoffee: hasHeaderBuyCoffeeToggle
              ? body.headerShowBuyMeACoffee === 'true'
              : (existingBrand.headerShowBuyMeACoffee !== false),
            headerBuyMeACoffeeUrl: hasHeaderBuyCoffeePayload
              ? body.headerBuyMeACoffeeUrl
              : existingBrand.headerBuyMeACoffeeUrl,
            headerBuyMeACoffeeLabel: hasHeaderBuyCoffeePayload
              ? body.headerBuyMeACoffeeLabel
              : existingBrand.headerBuyMeACoffeeLabel,
            headerBuyMeACoffeeText: hasHeaderBuyCoffeePayload
              ? body.headerBuyMeACoffeeText
              : existingBrand.headerBuyMeACoffeeText,
            headerBuyMeACoffeeTitle: hasHeaderBuyCoffeePayload
              ? body.headerBuyMeACoffeeTitle
              : existingBrand.headerBuyMeACoffeeTitle
          },
          contactPage: {
            heroEyebrow: hasContactPagePayload ? readBodyOrExisting('contactPageHeroEyebrow', existingContactPage.heroEyebrow) : existingContactPage.heroEyebrow,
            heroTitle: hasContactPagePayload ? readBodyOrExisting('contactPageHeroTitle', existingContactPage.heroTitle) : existingContactPage.heroTitle,
            heroSubtitle: hasContactPagePayload ? readBodyOrExisting('contactPageHeroSubtitle', existingContactPage.heroSubtitle) : existingContactPage.heroSubtitle,
            primaryCtaLabel: hasContactPagePayload ? readBodyOrExisting('contactPagePrimaryCtaLabel', existingContactPage.primaryCtaLabel) : existingContactPage.primaryCtaLabel,
            emailCtaLabel: hasContactPagePayload ? readBodyOrExisting('contactPageEmailCtaLabel', existingContactPage.emailCtaLabel) : existingContactPage.emailCtaLabel,
            followUpCtaLabel: hasContactPagePayload ? readBodyOrExisting('contactPageFollowUpCtaLabel', existingContactPage.followUpCtaLabel) : existingContactPage.followUpCtaLabel,
            highlights: contactPageHighlights,
            formEyebrow: hasContactPagePayload ? readBodyOrExisting('contactPageFormEyebrow', existingContactPage.formEyebrow) : existingContactPage.formEyebrow,
            formTitle: hasContactPagePayload ? readBodyOrExisting('contactPageFormTitle', existingContactPage.formTitle) : existingContactPage.formTitle,
            formSubtitle: hasContactPagePayload ? readBodyOrExisting('contactPageFormSubtitle', existingContactPage.formSubtitle) : existingContactPage.formSubtitle,
            formHint: hasContactPagePayload ? readBodyOrExisting('contactPageFormHint', existingContactPage.formHint) : existingContactPage.formHint,
            directContactKicker: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactKicker', existingContactPage.directContactKicker) : existingContactPage.directContactKicker,
            directContactTitle: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactTitle', existingContactPage.directContactTitle) : existingContactPage.directContactTitle,
            directContactLead: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactLead', existingContactPage.directContactLead) : existingContactPage.directContactLead,
            directContactMethodsTitle: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactMethodsTitle', existingContactPage.directContactMethodsTitle) : existingContactPage.directContactMethodsTitle,
            directContactMethodsSubtitle: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactMethodsSubtitle', existingContactPage.directContactMethodsSubtitle) : existingContactPage.directContactMethodsSubtitle,
            directContactEmailActionLabel: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactEmailActionLabel', existingContactPage.directContactEmailActionLabel) : existingContactPage.directContactEmailActionLabel,
            directContactPhoneActionLabel: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactPhoneActionLabel', existingContactPage.directContactPhoneActionLabel) : existingContactPage.directContactPhoneActionLabel,
            directContactFaxActionLabel: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactFaxActionLabel', existingContactPage.directContactFaxActionLabel) : existingContactPage.directContactFaxActionLabel,
            directContactDefaultActionLabel: hasContactPagePayload ? readBodyOrExisting('contactPageDirectContactDefaultActionLabel', existingContactPage.directContactDefaultActionLabel) : existingContactPage.directContactDefaultActionLabel,
            aboutCardTitle: hasContactPagePayload ? readBodyOrExisting('contactPageAboutCardTitle', existingContactPage.aboutCardTitle) : existingContactPage.aboutCardTitle,
            aboutCardBody: hasContactPagePayload ? readBodyOrExisting('contactPageAboutCardBody', existingContactPage.aboutCardBody) : existingContactPage.aboutCardBody,
            aboutCardButtonLabel: hasContactPagePayload ? readBodyOrExisting('contactPageAboutCardButtonLabel', existingContactPage.aboutCardButtonLabel) : existingContactPage.aboutCardButtonLabel,
            aboutCardHref: hasContactPagePayload ? readBodyOrExisting('contactPageAboutCardHref', existingContactPage.aboutCardHref) : existingContactPage.aboutCardHref,
            processEyebrow: hasContactPagePayload ? readBodyOrExisting('contactPageProcessEyebrow', existingContactPage.processEyebrow) : existingContactPage.processEyebrow,
            processTitle: hasContactPagePayload ? readBodyOrExisting('contactPageProcessTitle', existingContactPage.processTitle) : existingContactPage.processTitle,
            processImages: contactPageProcessImages
          },
          publicMenu
        }
      }, req.user);

      await settingService.refresh();
    }

    if (req.headers['x-ajax-request'] || req.xhr || String(req.headers.accept || '').includes('json')) {
      return res.json({
        status: 'success',
        message: 'Public page settings saved.',
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

function resolveDefaultFilePathsSelectedPackage(req = {}) {
  const fromQuery = uploadFolderSettingsService.normalizePackageName(req?.query?.package, '');
  if (fromQuery) return fromQuery;
  return uploadFolderSettingsService.normalizePackageName(req?.body?.packageFilter, '');
}

function buildDefaultFilePathsRedirectUrl(packageFilter = '') {
  const selectedPackage = uploadFolderSettingsService.normalizePackageName(packageFilter, '');
  return selectedPackage
    ? `/systemSettings/default-file-paths?package=${encodeURIComponent(selectedPackage)}`
    : '/systemSettings/default-file-paths';
}

exports.showDefaultFilePathSettings = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const selectedPackage = resolveDefaultFilePathsSelectedPackage(req);
    res.render('systemSettings/defaultFilePathSettings', {
      title: 'Default File Paths',
      settings,
      definitions: uploadFolderSettingsService.getUploadFolderDefinitions({ packageName: selectedPackage }),
      groups: uploadFolderSettingsService.GROUPS,
      packageOptions: uploadFolderSettingsService.getUploadFolderPackageOptions(),
      selectedPackage,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.updateDefaultFilePathSettings = async (req, res) => {
  try {
    const selectedPackage = resolveDefaultFilePathsSelectedPackage(req);
    const sanitizedPatch = uploadFolderSettingsService.sanitizeUploadFolderSettingsPatch(req.body?.uploadFolders || {}, {
      required: false
    });
    const settings = await systemSettingsRepository.getSettings();
    const nextUploadFolders = uploadFolderSettingsService.mergeUploadFolderSettings(
      settings?.app?.uploadFolders || {},
      sanitizedPatch
    );

    await systemSettingsRepository.updateSettings({
      app: {
        uploadFolders: nextUploadFolders
      }
    }, req.user);
    await settingService.refresh();

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Default file paths saved.' });
    }
    return res.redirect(buildDefaultFilePathsRedirectUrl(selectedPackage));
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Default File Paths Error', message: error.message, user: req.user });
  }
};

exports.redirectUploadFolderSettingsGet = async (req, res) => {
  const query = new URLSearchParams(req.query || {}).toString();
  const target = `/systemSettings/default-file-paths${query ? `?${query}` : ''}`;
  return res.redirect(target);
};

exports.redirectUploadFolderSettingsPost = async (req, res) => {
  return res.redirect(307, '/systemSettings/default-file-paths');
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
      mongoRestoreMaxUploadMb: MONGO_RESTORE_MAX_UPLOAD_MB,
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
    await packageQueryExecutorService.refreshEnabledPackageQueryExecutors({
      backendMode: runtimeBackend.mode
    });
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
      mongoRestoreMaxUploadMb: MONGO_RESTORE_MAX_UPLOAD_MB,
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

exports.showDataMigrationCopyCollectionPage = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    let sourceDbName = '';
    let collections = [];
    let loadWarning = '';

    try {
      const snapshot = await jsonToMongoMigrationService.listCopyEligibleCollections();
      sourceDbName = snapshot.sourceDbName;
      collections = snapshot.collections;
    } catch (error) {
      loadWarning = error.message || 'Unable to load source collections.';
    }

    return res.render('systemSettings/dataMigrationCopyCollection', {
      title: 'Copy Single Collection',
      settings,
      runtimeBackend,
      sourceDbName,
      collections,
      loadWarning,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

/* =========================================================
   PACKAGE MANAGER (System Settings)
========================================================= */
exports.showPackageManagerPage = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const keyContext = buildPackageTrustedKeyContext(settings);
    const localPackageModeState = localPackageSyncService.resolveLocalPackageMode();
    const localPackageDevModeEnabled = localPackageModeState.enabled === true;
    const storageResolution = getPackageStorageRootResolution({ ensureExists: false });
    const packageStorageRoot = storageResolution.effectiveRoot;
    const snapshot = await systemSettingsPackageManagerService.listPackageSnapshot({
      backendMode: runtimeBackend?.mode || '',
      packageRootDir: packageStorageRoot
    });
    const startupLoadSummary = req?.app?.locals?.packageLoadSummary || null;
    const startupPackageWarnings = Array.isArray(startupLoadSummary?.failed)
      ? startupLoadSummary.failed
        .map((row) => {
          const message = String(row?.message || '').trim();
          if (!message) return '';
          const packageId = cleanFormText(row?.packageId, 120).toLowerCase();
          if (!packageId) return message;
          return `[${packageId}] ${message}`;
        })
        .filter(Boolean)
      : [];
    const localManifestOptions = (snapshot?.localManifests || []).filter((row) => row.valid === true);
    const localManifestWarnings = (snapshot?.localManifests || []).filter((row) => row.valid !== true);
    const organizations = await dataService.fetchData('organizations', {}, req.user, {
      backendMode: runtimeBackend?.mode || ''
    }).catch(() => []);
    const activeOrgId = cleanFormText(req.user?.activeOrgId || req.user?.primaryOrgId || '', 120);

    return res.render('systemSettings/packageManagerSettings', {
      title: 'Package Manager',
      settings,
      runtimeBackend,
      installedPackages: snapshot?.installedPackages || [],
      localManifestOptions,
      localManifestWarnings,
      zipTrustedKeysConfigured: keyContext.trustedPublicKeys.length > 0,
      zipTrustedKeysCount: keyContext.trustedPublicKeys.length,
      zipUploadLimitMb: getPackageZipUploadLimitMb(),
      packageStorageRoot,
      packageStorageRootSource: storageResolution.source,
      packageStorageRootWarnings: Array.isArray(storageResolution.warnings) ? storageResolution.warnings : [],
      startupPackageWarnings,
      localPackageDevModeEnabled,
      localPackageModeState,
      organizations: Array.isArray(organizations) ? organizations : [],
      activeOrgId,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

function buildPackageTrustedKeyContext(settingsInput = null) {
  const settings = settingsInput || settingService.get();
  const appKeys = String(settings?.app?.packageInstallEd25519PublicKeys || '').trim();
  const envKeys = [
    String(process.env.PACKAGE_INSTALL_ED25519_PUBLIC_KEYS || '').trim(),
    String(process.env.PACKAGE_INSTALL_ED25519_PUBLIC_KEY || '').trim()
  ].filter(Boolean);
  const trustedPublicKeys = [
    ...envKeys.join('\n').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
    ...appKeys.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
  ];
  return { trustedPublicKeys };
}

function buildStartupFailureByPackageMap(appRef = null) {
  const summary = appRef && appRef.locals && typeof appRef.locals === 'object'
    ? appRef.locals.packageLoadSummary
    : null;
  const rows = Array.isArray(summary?.failed) ? summary.failed : [];
  const out = {};
  rows.forEach((row) => {
    const packageId = cleanFormText(row?.packageId, 120).toLowerCase();
    if (!packageId) return;
    out[packageId] = {
      code: cleanFormText(row?.code, 120).toUpperCase(),
      message: cleanFormText(row?.message, 1200),
      missingManifest: row?.missingManifest === true,
      autoDisabled: row?.autoDisabled === true
    };
  });
  return out;
}

function buildPackageManagerOptions(req = {}) {
  const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
  const keyContext = buildPackageTrustedKeyContext();
  return {
    backendMode: runtimeBackend?.mode || '',
    trustedPublicKeys: keyContext.trustedPublicKeys,
    targetOrgId: cleanFormText(req.body?.targetOrgId || req.query?.targetOrgId || '', 120),
    actor: req.user || null,
    app: req.app || null,
    packageRuntimeRouter: req.app?.locals?.packageRuntimeRouter || null,
    startupFailureByPackage: buildStartupFailureByPackageMap(req.app || null)
  };
}

function assertPackageBuilderSigningKeyReady() {
  if (
    !systemSettingsPackageBuilderService
    || typeof systemSettingsPackageBuilderService.assertSigningPrivateKeyReady !== 'function'
  ) {
    throw buildOperationError(
      'PACKAGE_BUILDER_SIGNING_KEY_REQUIRED',
      'Package Builder signing-key readiness check is unavailable in this runtime.'
    );
  }
  return systemSettingsPackageBuilderService.assertSigningPrivateKeyReady({
    projectRoot: process.cwd()
  });
}

function sendPackageManagerError(res, error, fallbackMessage = 'Package operation failed.') {
  const code = String(error?.code || '').trim().toUpperCase();
  const adminRequired = code === 'ADMIN_REQUIRED';
  const statusCode = (adminRequired || code === 'PACKAGE_BUILDER_SIGNING_KEY_REQUIRED') ? 403 : 400;
  const blocked = code === 'UNINSTALL_BLOCKED_MODIFIED';
  let message = error?.message || fallbackMessage;
  if (code === 'ZIP_SIGNATURE_NOT_CONFIGURED') {
    message = 'ZIP signature verification is not configured. Set PACKAGE_INSTALL_ED25519_PUBLIC_KEYS in the core .env, restart the app, and try again.';
  } else if (code === 'ZIP_SIGNATURE_INVALID') {
    message = 'Package signature verification failed. Rebuild the ZIP using the configured signing key, then upload the matching ZIP and SIG files.';
  } else if (code === 'PACKAGE_RUNTIME_ROUTE_MOUNT_FAILED') {
    message = 'Package runtime route mount failed. The package was not left enabled. Review runtime route details and package root configuration, then retry.';
  } else if (code === 'TARGET_ORG_REQUIRED') {
    message = 'This package includes org-bound exported data/files. Select a target organization and retry install.';
  } else if (code === 'BUILDER_PAYLOAD_IMPORT_FAILED') {
    message = 'Package install stopped because payload data import failed. Review details and retry after fixing the record conflict.';
  } else if (code === 'PACKAGE_UPGRADE_PREVIEW_REQUIRED') {
    message = 'Upgrade compatibility preview must be reviewed and confirmed before applying this package upgrade.';
  } else if (code === 'PACKAGE_UPGRADE_PREVIEW_ACK_INVALID' || code === 'PACKAGE_UPGRADE_PREVIEW_ACK_MISMATCH') {
    message = 'Upgrade confirmation token is invalid or stale. Re-run install preview and confirm again.';
  } else if (code === 'PACKAGE_BUILDER_SIGNING_KEY_REQUIRED') {
    message = 'Package Builder is disabled until PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE or PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64 is configured with a valid private key and the app is restarted.';
  }
  return res.status(statusCode).json({
    status: adminRequired ? 'admin_required' : (blocked ? 'blocked' : 'error'),
    message,
    code,
    details: error?.details || null,
    blockedReasons: blocked ? (error?.blockedReasons || []) : [],
    modifiedRecords: blocked ? (error?.modifiedRecords || []) : [],
    previewTransactionId: blocked ? (error?.previewTransactionId || '') : ''
  });
}

function parseDeleteSelectionInput(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const raw = cleanFormText(value, 400000);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function assertLocalPackageDevModeEnabled() {
  const modeState = localPackageSyncService.resolveLocalPackageMode();
  if (modeState.productionLocked) {
    throw buildOperationError(
      'LOCAL_PACKAGE_SYNC_PRODUCTION_DISABLED',
      'Local package sync is disabled in production environments.'
    );
  }
  if (modeState.enabled) return;
  throw buildOperationError(
    'LOCAL_PACKAGE_DEV_MODE_DISABLED',
    'Local package sync mode is disabled. Set PACKAGE_LOCAL_DEV_MODE=true and restart the app.'
  );
}

function removeStartupFailureForPackage(app = null, packageIdInput = '', row = null) {
  const appRef = app && typeof app === 'object' ? app : null;
  if (!appRef || !appRef.locals || typeof appRef.locals !== 'object') return;
  const packageId = cleanFormText(packageIdInput, 120).toLowerCase();
  if (!packageId) return;
  const summary = appRef.locals.packageLoadSummary;
  if (!summary || typeof summary !== 'object') return;

  const currentFailed = Array.isArray(summary.failed) ? summary.failed : [];
  const nextFailed = currentFailed.filter((item) => cleanFormText(item?.packageId, 120).toLowerCase() !== packageId);
  const currentLoaded = Array.isArray(summary.loaded) ? summary.loaded : [];
  const alreadyLoaded = currentLoaded.some((item) => cleanFormText(item?.packageId, 120).toLowerCase() === packageId);
  const nextLoaded = alreadyLoaded
    ? currentLoaded
    : [
        ...currentLoaded,
        {
          packageId,
          name: cleanFormText(row?.name, 200),
          version: cleanFormText(row?.version, 120),
          mountPath: cleanFormText(row?.mountPath, 400),
          manifestPath: cleanFormText(row?.manifestPath, 1600)
        }
      ];

  appRef.locals.packageLoadSummary = {
    ...summary,
    failed: nextFailed,
    loaded: nextLoaded,
    failedCount: nextFailed.length,
    loadedCount: nextLoaded.length,
    finishedAt: new Date().toISOString()
  };
}

function clearStartupFailureForPackage(app = null, packageIdInput = '') {
  const appRef = app && typeof app === 'object' ? app : null;
  if (!appRef || !appRef.locals || typeof appRef.locals !== 'object') return;
  const packageId = cleanFormText(packageIdInput, 120).toLowerCase();
  if (!packageId) return;
  const summary = appRef.locals.packageLoadSummary;
  if (!summary || typeof summary !== 'object') return;

  const currentFailed = Array.isArray(summary.failed) ? summary.failed : [];
  const nextFailed = currentFailed.filter((item) => cleanFormText(item?.packageId, 120).toLowerCase() !== packageId);
  if (nextFailed.length === currentFailed.length) return;

  appRef.locals.packageLoadSummary = {
    ...summary,
    failed: nextFailed,
    failedCount: nextFailed.length,
    finishedAt: new Date().toISOString()
  };
}

exports.installPackageFromManager = async (req, res) => {
  try {
    const report = await systemSettingsPackageManagerService.installPackage({
      installMethod: cleanFormText(req.body?.installMethod, 40),
      localManifestPath: cleanFormText(req.body?.localManifestPath, 1600),
      manifestPath: cleanFormText(req.body?.manifestPath, 1600),
      manifestJson: String(req.body?.manifestJson || ''),
      upgradeAckToken: cleanFormText(req.body?.upgradeAckToken, 240)
    }, buildPackageManagerOptions(req));
    removeStartupFailureForPackage(req.app, report?.packageId, report);

    return res.json({
      status: 'success',
      message: `Package "${report.packageId}" installed and enabled.`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package install failed.');
  }
};

exports.previewInstallPackageFromManager = async (req, res) => {
  try {
    const report = await systemSettingsPackageManagerService.previewPackageInstall({
      installMethod: cleanFormText(req.body?.installMethod, 40),
      localManifestPath: cleanFormText(req.body?.localManifestPath, 1600),
      manifestPath: cleanFormText(req.body?.manifestPath, 1600),
      manifestJson: String(req.body?.manifestJson || '')
    }, buildPackageManagerOptions(req));
    return res.json({
      status: 'success',
      message: report.isUpgrade
        ? `Upgrade preview completed for "${report.packageId}" (${report.currentVersion || 'none'} -> ${report.nextVersion || ''}).`
        : `Install preview completed for "${report.packageId}".`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package install preview failed.');
  }
};

exports.installPackageZipFromManager = async (req, res) => {
  try {
    const packageZip = Array.isArray(req.files?.packageZip) ? req.files.packageZip[0] : null;
    const packageSig = Array.isArray(req.files?.packageSig) ? req.files.packageSig[0] : null;
    const report = await systemSettingsPackageManagerService.installPackageZip({
      zipBuffer: packageZip?.buffer,
      signatureBuffer: packageSig?.buffer,
      upgradeAckToken: cleanFormText(req.body?.upgradeAckToken, 240)
    }, buildPackageManagerOptions(req));
    removeStartupFailureForPackage(req.app, report?.packageId, report);

    return res.json({
      status: 'success',
      message: `Package "${report.packageId}" installed from ZIP and enabled.`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'ZIP package install failed.');
  }
};

exports.previewInstallPackageZipFromManager = async (req, res) => {
  try {
    const packageZip = Array.isArray(req.files?.packageZip) ? req.files.packageZip[0] : null;
    const packageSig = Array.isArray(req.files?.packageSig) ? req.files.packageSig[0] : null;
    const report = await systemSettingsPackageManagerService.previewPackageInstallZip({
      zipBuffer: packageZip?.buffer,
      signatureBuffer: packageSig?.buffer
    }, buildPackageManagerOptions(req));
    return res.json({
      status: 'success',
      message: report.isUpgrade
        ? `ZIP upgrade preview completed for "${report.packageId}" (${report.currentVersion || 'none'} -> ${report.nextVersion || ''}).`
        : `ZIP install preview completed for "${report.packageId}".`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'ZIP package install preview failed.');
  }
};

exports.enablePackageFromManager = async (req, res) => {
  try {
    const packageId = cleanFormText(req.params?.packageId, 120).toLowerCase();
    const report = await systemSettingsPackageManagerService.enablePackage(packageId, buildPackageManagerOptions(req));
    removeStartupFailureForPackage(req.app, report?.packageId || packageId, report);
    return res.json({
      status: 'success',
      message: `Package "${report.packageId}" is enabled.`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package enable failed.');
  }
};

exports.pausePackageFromManager = async (req, res) => {
  try {
    const packageId = cleanFormText(req.params?.packageId, 120).toLowerCase();
    const report = await systemSettingsPackageManagerService.pausePackage(packageId, buildPackageManagerOptions(req));
    return res.json({
      status: 'success',
      message: `Package "${report.packageId}" is paused (disabled + declaration sync).`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package pause failed.');
  }
};

exports.removePackageFromManager = async (req, res) => {
  try {
    const packageId = cleanFormText(req.params?.packageId, 120).toLowerCase();
    const force = String(req.query?.force || req.body?.force || '').trim().toLowerCase() === 'true';
    const cleanupModeRaw = cleanFormText(req.body?.cleanupMode || req.query?.cleanupMode, 40).toLowerCase();
    const cleanupMode = cleanupModeRaw === 'keep-data' ? 'keep-data' : 'full';
    const deleteSelection = parseDeleteSelectionInput(req.body?.deleteSelection);
    const report = await systemSettingsPackageManagerService.removePackage(packageId, {
      ...buildPackageManagerOptions(req),
      force,
      cleanupMode,
      previewTransactionId: cleanFormText(req.body?.previewTransactionId, 160),
      deleteSelection
    });
    return res.json({
      status: 'success',
      message: `Package "${report.packageId}" remove operation completed.`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package remove failed.');
  }
};

exports.syncPackageFromManager = async (req, res) => {
  try {
    const packageId = cleanFormText(req.params?.packageId, 120).toLowerCase();
    const report = await systemSettingsPackageManagerService.syncPackage(packageId, buildPackageManagerOptions(req));
    return res.json({
      status: 'success',
      message: `Package "${report.packageId}" declaration sync completed.`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package sync failed.');
  }
};

exports.cleanupFailedPackageAttemptsFromManager = async (req, res) => {
  try {
    const report = await systemSettingsPackageManagerService.cleanupFailedInstallAttempts(buildPackageManagerOptions(req));
    const cleanedRows = Array.isArray(report?.results)
      ? report.results.filter((row) => String(row?.result || '').startsWith('cleaned'))
      : [];
    cleanedRows.forEach((row) => clearStartupFailureForPackage(req.app, row?.packageId));
    const status = Number(report?.failedCount || 0) > 0 ? 'warning' : 'success';
    const message = Number(report?.candidateCount || 0) > 0
      ? `Processed ${report.candidateCount} failed install attempt(s). Cleaned: ${report.cleanedCount}, failed: ${report.failedCount}.`
      : 'No failed package install attempts were detected.';
    return res.json({
      status,
      message,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Failed package attempt cleanup failed.');
  }
};

exports.showPackageLocalSyncPage = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const localPackageModeState = localPackageSyncService.resolveLocalPackageMode();
    const localPackageDevModeEnabled = localPackageModeState.enabled === true;
    const defaults = localPackageSyncService.resolveLocalSyncPaths({});
    const cache = await localPackageSyncService.readLocalPackageRegistryCache();

    return res.render('systemSettings/packageLocalSyncSettings', {
      title: 'Package Sync Locally',
      settings,
      runtimeBackend,
      localPackageDevModeEnabled,
      localPackageModeState,
      targetRootDefault: defaults.targetRoot || '',
      localRegistryFilePath: cache?.filePath || '',
      localRegistryGeneratedAt: cleanFormText(cache?.generatedAt, 120),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.scanLocalPackagesFromManager = async (req, res) => {
  try {
    assertLocalPackageDevModeEnabled();
    const report = await localPackageSyncService.scanMountedPackageSource({
      targetRoot: cleanFormText(req.body?.targetRoot, 2000)
    });
    return res.json({
      status: 'success',
      message: `Scan completed. Found ${report.validCount} valid package(s).`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Local package scan failed.');
  }
};

exports.syncLocalPackagesFromManager = async (req, res) => {
  try {
    assertLocalPackageDevModeEnabled();
    const selectedPackageIds = Array.from(new Set(
      asArray(req.body?.selectedPackageIds)
        .map((item) => cleanFormText(item, 160).toLowerCase())
        .filter(Boolean)
    ));
    const report = await localPackageSyncService.syncMountedPackages({
      targetRoot: cleanFormText(req.body?.targetRoot, 2000),
      selectedPackageIds,
      syncAll: String(req.body?.syncAll || '').trim().toLowerCase() === 'true'
    });
    return res.json({
      status: report.failedCount > 0 ? 'warning' : 'success',
      message: `Synced ${report.syncedCount} package(s) locally. Restart the app to activate updated local packages.`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Local package sync failed.');
  }
};

/* =========================================================
   PACKAGE BUILDER (System Settings)
========================================================= */
exports.showPackageBuilderPage = async (req, res) => {
  try {
    const signingKeyState = assertPackageBuilderSigningKeyReady();
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const packageStorageRoot = getPackageStorageRootAbsolute();
    const discovered = await systemSettingsPackageBuilderService.discoverLocalPackages({
      backendMode: runtimeBackend?.mode || '',
      packageRootDir: packageStorageRoot
    });
    const organizations = await dataService.fetchData('organizations', {}, req.user, {
      backendMode: runtimeBackend?.mode || ''
    }).catch(() => []);

    return res.render('systemSettings/packageBuilderSettings', {
      title: 'Package Builder',
      settings,
      runtimeBackend,
      packageStorageRoot,
      packages: discovered,
      packageWarnings: discovered.filter((row) => row.valid !== true || row.manifestResolved !== true),
      organizations: Array.isArray(organizations) ? organizations : [],
      packageBuilderSigningKeySource: cleanFormText(signingKeyState?.source, 300),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (String(error?.code || '').trim().toUpperCase() === 'PACKAGE_BUILDER_SIGNING_KEY_REQUIRED') {
      return res.status(403).render('error', {
        title: 'Package Builder Disabled',
        message: error.message || 'Package Builder is disabled until signing private key is configured.',
        user: req.user
      });
    }
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.preflightPackageBuilder = async (req, res) => {
  try {
    assertPackageBuilderSigningKeyReady();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const report = await systemSettingsPackageBuilderService.preflightBuild({
      packageId: cleanFormText(req.body?.packageId, 120),
      originOrgId: cleanFormText(req.body?.originOrgId, 160),
      selectedDataEntities: Array.isArray(req.body?.selectedDataEntities)
        ? req.body.selectedDataEntities
        : (req.body?.selectedDataEntities ? [req.body.selectedDataEntities] : []),
      selectedFileRefs: Array.isArray(req.body?.selectedFileRefs)
        ? req.body.selectedFileRefs
        : (req.body?.selectedFileRefs ? [req.body.selectedFileRefs] : []),
      fileFieldSelection: parseFileFieldSelectionInput(req.body?.fileFieldSelection)
    }, {
      backendMode: runtimeBackend?.mode || '',
      packageRootDir: getPackageStorageRootAbsolute(),
      actor: req.user || null
    });

    return res.json({
      status: 'success',
      message: `Preflight completed for package "${report?.package?.packageId || ''}".`,
      report
    });
  } catch (error) {
    if (String(error?.code || '').trim().toUpperCase() === 'PACKAGE_BUILDER_SIGNING_KEY_REQUIRED') {
      return sendPackageManagerError(res, error, 'Package build preflight failed.');
    }
    return res.status(400).json({
      status: 'error',
      message: error?.message || 'Package build preflight failed.',
      code: cleanFormText(error?.code || '', 120),
      details: error?.details || null
    });
  }
};

exports.buildPackageFromBuilder = async (req, res) => {
  try {
    assertPackageBuilderSigningKeyReady();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const report = await systemSettingsPackageBuilderService.buildPackage({
      packageId: cleanFormText(req.body?.packageId, 120),
      version: cleanFormText(req.body?.version, 120),
      originOrgId: cleanFormText(req.body?.originOrgId, 160),
      selectedDataEntities: Array.isArray(req.body?.selectedDataEntities)
        ? req.body.selectedDataEntities
        : (req.body?.selectedDataEntities ? [req.body.selectedDataEntities] : []),
      selectedFileRefs: Array.isArray(req.body?.selectedFileRefs)
        ? req.body.selectedFileRefs
        : (req.body?.selectedFileRefs ? [req.body.selectedFileRefs] : []),
      fileFieldSelection: parseFileFieldSelectionInput(req.body?.fileFieldSelection)
    }, {
      backendMode: runtimeBackend?.mode || '',
      packageRootDir: getPackageStorageRootAbsolute(),
      actor: req.user || null
    });

    return res.json({
      status: 'success',
      message: `Package "${report.packageId}" build completed.`,
      report
    });
  } catch (error) {
    if (String(error?.code || '').trim().toUpperCase() === 'PACKAGE_BUILDER_SIGNING_KEY_REQUIRED') {
      return sendPackageManagerError(res, error, 'Package build failed.');
    }
    return res.status(400).json({
      status: 'error',
      message: error?.message || 'Package build failed.',
      code: cleanFormText(error?.code || '', 120),
      details: error?.details || null
    });
  }
};

/* =========================================================
   CORE BOOTSTRAP BASELINE (First-run)
========================================================= */
exports.showCoreBootstrapPage = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const preflight = await coreBootstrapBaselineService.preflight({
      actor: req.user,
      backendMode: runtimeBackend?.mode || 'json'
    });

    return res.render('systemSettings/coreBootstrapSettings', {
      title: 'Core Bootstrap Baseline',
      settings,
      runtimeBackend,
      preflight,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.preflightCoreBootstrapBaseline = async (req, res) => {
  try {
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const report = await coreBootstrapBaselineService.preflight({
      actor: req.user,
      backendMode: runtimeBackend?.mode || 'json'
    });
    return res.json({
      status: 'success',
      message: 'Core bootstrap preflight completed.',
      report
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Core bootstrap preflight failed.'
    });
  }
};

exports.applyCoreBootstrapBaseline = async (req, res) => {
  try {
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const report = await coreBootstrapBaselineService.apply({
      actor: req.user,
      backendMode: runtimeBackend?.mode || 'json',
      dryRun: String(req.body?.dryRun || '').trim().toLowerCase() === 'true'
    });
    return res.json({
      status: 'success',
      message: 'Core bootstrap baseline apply completed.',
      report
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Core bootstrap baseline apply failed.'
    });
  }
};

exports.showCoreResetPage = async (req, res) => {
  try {
    const settings = await systemSettingsRepository.getSettings();
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const preflight = await coreResetRebootstrapService.preflightReset({
      actor: req.user,
      backendMode: runtimeBackend?.mode || 'json'
    });

    return res.render('systemSettings/coreResetSettings', {
      title: 'Core Reset',
      settings,
      runtimeBackend,
      preflight,
      includeModal: true,
      confirmTokenHint: coreResetRebootstrapService.CONFIRM_TOKEN,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.preflightCoreReset = async (req, res) => {
  try {
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const report = await coreResetRebootstrapService.preflightReset({
      actor: req.user,
      backendMode: runtimeBackend?.mode || 'json'
    });
    return res.json({
      status: 'success',
      message: 'Core reset preflight completed.',
      report
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Core reset preflight failed.'
    });
  }
};

exports.applyCoreReset = async (req, res) => {
  try {
    const runtimeBackend = dataBackendRuntimeService.getPublicBackendStatus();
    const confirmToken = cleanFormText(req.body?.confirmToken, 120);
    const report = await coreResetRebootstrapService.applyCoreReset({
      actor: req.user,
      backendMode: runtimeBackend?.mode || 'json',
      confirmToken
    });
    return res.json({
      status: 'success',
      message: 'Core reset completed.',
      report
    });
  } catch (error) {
    const statusCode = error?.code === 'confirm_token_invalid' ? 400 : 400;
    return res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Core reset failed.'
    });
  }
};

exports.uninstallPreviewPackageFromManager = async (req, res) => {
  try {
    const packageId = cleanFormText(req.params?.packageId, 120).toLowerCase();
    const report = await systemSettingsPackageManagerService.previewPackageUninstallImpact(
      packageId,
      buildPackageManagerOptions(req)
    );
    return res.json({
      status: 'success',
      message: report.blocked
        ? `Impact preview found modified records for "${report.packageId}".`
        : `Impact preview completed for "${report.packageId}".`,
      report
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package uninstall preview failed.');
  }
};

exports.listPackageTransactionsFromManager = async (req, res) => {
  try {
    const packageId = cleanFormText(req.params?.packageId, 120).toLowerCase();
    const rows = await systemSettingsPackageManagerService.listPackageTransactions(packageId, {
      ...buildPackageManagerOptions(req),
      limit: Number.parseInt(String(req.query?.limit || '50'), 10) || 50
    });
    return res.json({
      status: 'success',
      packageId,
      rows
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package transaction list failed.');
  }
};

exports.getPackageTransactionDetailFromManager = async (req, res) => {
  try {
    const transactionId = cleanFormText(req.params?.transactionId, 160);
    const row = await systemSettingsPackageManagerService.getPackageTransactionById(transactionId, buildPackageManagerOptions(req));
    if (!row) {
      return res.status(404).json({
        status: 'error',
        message: 'Transaction not found.'
      });
    }
    return res.json({
      status: 'success',
      row
    });
  } catch (error) {
    return sendPackageManagerError(res, error, 'Package transaction detail failed.');
  }
};

exports.overwriteDataMigrationCollection = async (req, res) => {
  const collectionName = cleanFormText(req.body?.collection, 180);
  const destinationUri = cleanFormText(req.body?.destinationUri, 4000);
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'destinationUri')) {
    req.body.destinationUri = destinationUri ? '[REDACTED]' : '';
  }

  try {
    if (!checkAdminVerificationCode(req)) {
      return res.status(403).json({
        status: 'admin_required',
        message: 'Admin approval required or session expired.'
      });
    }
    if (!collectionName) throw new Error('Collection is required.');
    if (!destinationUri) throw new Error('Destination Mongo URI is required.');

    const report = await jsonToMongoMigrationService.overwriteCollectionToDestination({
      collectionName,
      destinationUri,
      userId: req.user?.id || ''
    });

    return res.json({
      status: 'success',
      message: `Collection "${collectionName}" was copied successfully to destination Mongo.`,
      report
    });
  } catch (error) {
    const code = String(error?.code || '').trim().toUpperCase();
    const statusCode = code === 'ADMIN_REQUIRED' ? 403 : 400;
    return res.status(statusCode).json({
      status: statusCode === 403 ? 'admin_required' : 'error',
      message: error.message || 'Collection copy failed.'
    });
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
