// MVC/controllers/newsController.js
const crypto = require('crypto');
const dataService = require('../services/dataService');
const coreFilesService = require('../services/coreFilesService');
const fs = require('fs').promises;
const path = require('path');
const { buildDataServiceQuery } = require('../utils/generalTools');
const uploadMiddleware = require('../middleware/upload');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const settingService = require('../services/settingService');
const paginate = require('../utils/paginationHelper');

const MAX_ARTICLE_VISIT_PAGE_LIMIT = 100;

const NEWS_ADMIN_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'status',
    'visibility',
    'targetOrgId',
    'meta.slug',
    'meta.title',
    'meta.category',
    'content.summary',
    'meta.tags',
    'meta.author.displayName'
  ],
  allowedSearchFields: [
    'id',
    'meta.title',
    'meta.slug',
    'meta.category',
    'content.summary',
    'meta.tags',
    'meta.author.displayName',
    'status',
    'visibility',
    'targetOrgId'
  ],
  defaultSearchFields: [
    'id',
    'meta.title',
    'meta.slug',
    'meta.category',
    'content.summary',
    'meta.tags',
    'meta.author.displayName',
    'status',
    'visibility',
    'targetOrgId'
  ],
  allowMetaKeys: true
});

const NEWS_ADMIN_SEARCHABLE_FIELDS = Object.freeze([
  'id',
  'meta.title',
  'meta.slug',
  'meta.category',
  'content.summary',
  'meta.tags',
  'meta.author.displayName',
  'status',
  'visibility',
  'targetOrgId'
]);

/* ---------------- HELPERS ---------------- */

// ✅ NEW: Helper to generate Web URL from Disk Path (Same as Chat)
function getWebUrlFromFile(file) {
    if (file && typeof file === 'object') {
        return uploadMiddleware.getStoredFileUrl(file) || uploadMiddleware.getStoredFilePath(file) || '';
    }
    const token = String(file || '').trim();
    if (/^\/uploads\//i.test(token)) return token;
    return coreFilesService.getWebUrlForUpload(token);
}

// Helper: Calculate Read Time
function calculateReadTime(htmlContent) {
    const raw = typeof htmlContent === 'string' ? htmlContent : String(htmlContent || '');
    if (!raw.trim()) return "0m";
    const text = raw.replace(/<[^>]*>?/gm, '').trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    const minutes = Math.ceil(wordCount / 200);
    return minutes < 1 ? "< 1m" : `${minutes}m`;
}

function normalizeNewsItem(item = {}) {
    const source = item && typeof item === 'object' ? item : {};
    const meta = source.meta && typeof source.meta === 'object' ? source.meta : {};
    const content = source.content && typeof source.content === 'object' ? source.content : {};
    const audit = source.audit && typeof source.audit === 'object' ? source.audit : {};
    const author = meta.author && typeof meta.author === 'object' ? meta.author : {};
    const publishDate = meta.publishDate || audit.createDateTime || audit.createDate || source.createdAt || new Date().toISOString();
    const title = String(meta.title || source.title || source.name || 'Untitled News').trim() || 'Untitled News';
    const rawVisibility = String(source.visibility || '').trim().toLowerCase();
    const rawStatus = String(source.status || '').trim().toLowerCase();
    const id = source.id || (source._id && typeof source._id.toString === 'function' ? source._id.toString() : source._id) || '';

    return {
        ...source,
        id,
        visibility: ['public', 'users', 'org'].includes(rawVisibility) ? rawVisibility : 'public',
        status: ['published', 'draft', 'archived'].includes(rawStatus)
            ? rawStatus
            : (source.active === false ? 'archived' : 'draft'),
        meta: {
            ...meta,
            title,
            slug: meta.slug || source.slug || '',
            category: meta.category || source.category || 'General',
            tags: Array.isArray(meta.tags)
                ? meta.tags
                : String(source.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
            author: {
                ...author,
                displayName: author.displayName || source.authorName || 'System'
            },
            publishDate
        },
        content: {
            ...content,
            featuredImage: content.featuredImage || source.featuredImage || '',
            summary: content.summary || source.summary || '',
            body: content.body || source.body || source.htmlContent || ''
        }
    };
}

function cleanNewsString(value, max = 260) {
    return String(value ?? '').trim().slice(0, max);
}

function normalizeNewsRelativeFolder(value, max = 800) {
    const token = cleanNewsString(value, max).replace(/\\/g, '/');
    if (!token || token === '/' || token === '.') return '';
    const compact = token
        .split('/')
        .map((part) => cleanNewsString(part, 200))
        .filter(Boolean)
        .join('/');
    if (!compact || compact === '.') return '';
    return compact.replace(/^\/+/, '').replace(/\/+$/, '');
}

function getNewsMediaDefaultFolder() {
    return uploadFolderSettingsService.resolveUploadFolder('core.news') || 'news';
}

function resolveNewsScopeKey(user = null) {
    const activeOrgId = user?.activeOrgId;
    const token = String(activeOrgId || '').trim();
    if (token && token.toUpperCase() !== 'SYSTEM') return token;
    return 'GLOBAL';
}

function resolveNewsMediaPageSize() {
    const raw = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
    if (!Number.isFinite(raw) || Number.isNaN(raw) || raw <= 0) return 30;
    return Math.max(5, Math.min(500, raw));
}

function buildNewsScopeUploadPrefix(scopeKey = '') {
    const token = String(scopeKey || '').trim().toUpperCase();
    if (!token || token === 'GLOBAL') return '/uploads/GLOBAL';
    return `/uploads/ORG_${token.replace(/^ORG_/, '')}`;
}

function encodeNewsUploadUrl(uploadPath = '') {
    const normalized = String(uploadPath || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
    if (!normalized) return '';
    return normalized
        .split('/')
        .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
        .join('/');
}

function buildNewsMediaLibraryRow(entry = {}, scopeKey = '', currentFolder = '') {
    const fileName = cleanNewsString(entry.name);
    const folder = normalizeNewsRelativeFolder(currentFolder);
    const uploadPath = `${buildNewsScopeUploadPrefix(scopeKey)}/${[folder, fileName].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
    const digest = crypto.createHash('md5').update(uploadPath).digest('hex');
    const webUrl = cleanNewsString(entry.url) || encodeNewsUploadUrl(uploadPath);
    return {
        id: `LIB_${digest}`,
        name: fileName,
        originalName: cleanNewsString(entry.originalName) || fileName,
        filename: fileName,
        path: uploadPath,
        url: webUrl,
        mimeType: cleanNewsString(entry.mimeType),
        size: Number(entry.size || 0) || 0,
        uploadDate: entry.modified ? new Date(entry.modified).toISOString() : '',
        source: 'news_library'
    };
}

function buildNewsMediaLibraryRowFromUploadedFile(file = {}, scopeKey = '', targetFolder = '') {
    const storedName = path.basename(String(file?.path || file?.filename || file?.originalname || '').trim());
    const webUrl = getWebUrlFromFile(file);
    return buildNewsMediaLibraryRow({
        name: storedName,
        originalName: file?.originalname || storedName,
        url: webUrl,
        mimeType: file?.mimetype || '',
        size: file?.size || 0,
        modified: file?.mtime ? new Date(file.mtime).toISOString() : new Date().toISOString()
    }, scopeKey, targetFolder);
}

function resolveNewsMediaFolder(rawFolder = '') {
    const defaultFolder = getNewsMediaDefaultFolder();
    const normalized = normalizeNewsRelativeFolder(rawFolder);
    if (!normalized) return defaultFolder;
    if (normalized === defaultFolder || normalized.startsWith(`${defaultFolder}/`)) return normalized;
    return `${defaultFolder}/${normalized}`.replace(/\/+/g, '/');
}

function getNewsParentFolder(currentFolder = '') {
    const folder = normalizeNewsRelativeFolder(currentFolder);
    if (!folder || !folder.includes('/')) return '';
    return folder.split('/').slice(0, -1).join('/');
}

async function relocateUploadedFilesToFolder(req, targetRelativeFolder = '') {
    const scopeKey = resolveNewsScopeKey(req.user);
    const folder = resolveNewsMediaFolder(targetRelativeFolder);
    const defaultFolder = getNewsMediaDefaultFolder();
    if (folder === defaultFolder) return folder;

    const baseDir = coreFilesService.getRootPath(scopeKey);
    const targetPath = coreFilesService.resolveSafePath(baseDir, folder);
    coreFilesService.ensureDir(targetPath);

    const files = Array.isArray(req.files) ? req.files : [];
    for (const file of files) {
        const sourcePath = String(file?.path || '').trim();
        if (!sourcePath) continue;
        const fileName = path.basename(sourcePath);
        const destinationPath = coreFilesService.resolveSafePath(targetPath, fileName);
        if (sourcePath !== destinationPath) {
            await fs.rename(sourcePath, destinationPath);
            file.path = destinationPath;
        }
    }
    return folder;
}

async function listNewsMediaLibrary(req, res) {
    try {
        const defaultPageSize = resolveNewsMediaPageSize();
        const scopeKey = resolveNewsScopeKey(req.user);
        const defaultFolder = getNewsMediaDefaultFolder();
        const hasRequestedFolder = Object.prototype.hasOwnProperty.call(req.query || {}, 'folder');
        const requestedFolder = hasRequestedFolder
            ? resolveNewsMediaFolder(req.query?.folder)
            : '';
        const candidateFolders = hasRequestedFolder
            ? [requestedFolder, defaultFolder]
            : [defaultFolder];

        let currentFolder = '';
        let entries = [];
        for (const folderToken of candidateFolders) {
            // eslint-disable-next-line no-await-in-loop
            const listed = await coreFilesService.listDirectoryByScope({
                scopeKey,
                relativeDir: normalizeNewsRelativeFolder(folderToken)
            }).catch(() => null);
            if (Array.isArray(listed)) {
                currentFolder = normalizeNewsRelativeFolder(folderToken) || defaultFolder;
                entries = listed;
                break;
            }
        }

        const folders = [];
        const rows = [];
        for (const entry of entries) {
            if (!entry) continue;
            const name = cleanNewsString(entry.name);
            if (!name) continue;
            if (entry.isDir) {
                folders.push({
                    name,
                    path: normalizeNewsRelativeFolder([currentFolder, name].filter(Boolean).join('/'))
                });
                continue;
            }
            rows.push(buildNewsMediaLibraryRow(entry, scopeKey, currentFolder));
        }

        folders.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        rows.sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));

        return res.json({
            status: 'success',
            message: rows.length ? `Loaded ${rows.length} file(s).` : 'No news media files found in this folder.',
            results: rows,
            folders,
            currentFolder,
            parentFolder: getNewsParentFolder(currentFolder),
            defaultFolder,
            defaults: { pageSize: defaultPageSize }
        });
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message || 'Unable to load news media library.' });
    }
}

async function getCategories() {
    try {
        const p = path.join(__dirname, '../../data/newsCategories.json');
        const data = await fs.readFile(p, 'utf8');
        return JSON.parse(data);
    } catch {
        return [{ name: "General" }, { name: "Announcements" }];
    }
}

// Updated Builder
function buildNewsObject(body, files, user, existing = null) {
    const now = new Date().toISOString();
    
    let targetOrgIds = [];
    if (body.targetOrgIds) {
        try { targetOrgIds = JSON.parse(body.targetOrgIds); } catch {}
    }

    // ✅ FIX: Parse Attachment Registry from Client Side
    // The client manages the array of attachments (including old ones and new uploads)
    let finalAttachments = [];
    if (body.attachmentRegistry) {
        try {
            finalAttachments = JSON.parse(body.attachmentRegistry);
        } catch (e) {
            console.error("Failed to parse attachment registry", e);
            finalAttachments = existing ? (existing.attachments || []) : [];
        }
    } else {
        // Fallback if JS failed
        finalAttachments = existing ? (existing.attachments || []) : [];
    }

    const status = body.status || 'draft'; 

    return {
        active: status !== 'archived',
        status: status,
        visibility: body.visibility || 'public',
        targetOrgId: (body.visibility === 'org' && targetOrgIds.length > 0) ? targetOrgIds[0] : null, // Legacy field
        targetOrgIds: body.visibility === 'org' ? targetOrgIds : [],

        meta: {
            title: body.title,
            slug: body.slug || (existing?.meta?.slug), 
            category: body.category || 'General',
            tags: body.tags ? body.tags.split(',').map(t => t.trim()) : [],
            author: { userId: user.id, displayName: body.authorName || user.username || 'System' },
            publishDate: body.publishDate || now
        },

        content: {
            featuredImage: body.featuredImage || (finalAttachments.find(a=>a.type==='image')?.url) || null,
            summary: body.summary,
            body: body.htmlContent
        },

        attachments: finalAttachments,

        audit: {
            createUser: existing?.audit?.createUser || user.id,
            createDateTime: existing?.audit?.createDateTime || now,
            lastUpdateUser: user.id,
            lastUpdateDateTime: now
        }
    };
}
/* ---------------- PUBLIC / FEED ACTIONS ---------------- */

// Display the Main News Feed (Public + User Context)
async function feed(req, res) {
    try {
        const query = {
            q: req.query.q || '',
            page: req.query.page,
            limit: req.query.limit || 10,
            sort: 'meta.publishDate',
            order: 'desc',
            // ✅ FIX: Tell dataService exactly where to look for text matches
            searchFields: 'meta.title,meta.category,content.summary,meta.tags,meta.author.displayName' 
        };
        const pagedNews = await dataService.fetchDataPaged('news', query, req.user);
        const data = (Array.isArray(pagedNews?.rows) ? pagedNews.rows : []).map(normalizeNewsItem);
        const pagination = pagedNews?.pagination || null;

        res.render('news/feed', {
            title: 'News & Updates',
            newsList: data,
            pagination,
            user: req.user || null,
            filters: req.query,
            htmlClass: 'news-public-root',
            bodyClass: 'news-public-body public-zoom-centered-body',
            mainClass: 'container news-public-main',
            includeModal: true
        });

    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

// Display Single Article
async function viewArticle(req, res) {
    try {
        const slugOrId = req.params.idOrSlug;
        const user = req.user || null;
        
        // 1. Fetch All News
        const allNews = (await dataService.getAccessibleNews(user)).map(normalizeNewsItem);
        
        // 2. Find Current Article
        let item = allNews.find(n => n.id === slugOrId || n.meta.slug === slugOrId);
        
        if (!item) {
            return res.status(404).render('404', { title: 'News Not Found', user });
        }

        // 3. ✅ FIX: Increment View Count IMMEDIATELY (in memory object for render)
        if (!item.metrics) item.metrics = { views: 0 };
        item.metrics.views = (item.metrics.views || 0) + 1;

        // 4. ✅ FIX: Save to DB (Log View + Update Counter)
        // We use the service to handle the persistence asynchronously
        dataService.logNewsView(item.id, user).catch(err => console.error("Analytics Error:", err));

        // ... (rest of sidebars logic: latestNews, relatedNews) ...
        const latestNews = allNews
            .filter(n => n.id !== item.id)
            .sort((a, b) => new Date(b.meta.publishDate) - new Date(a.meta.publishDate))
            .slice(0, 5);
            
        const currentTags = new Set(item.meta.tags || []);
        const relatedNews = allNews
            .filter(n => n.id !== item.id)
            .map(n => {
                let score = 0;
                if (n.meta.tags) n.meta.tags.forEach(t => { if (currentTags.has(t)) score += 10; });
                const views = (n.metrics && n.metrics.views) ? n.metrics.views : 0;
                score += Math.floor(views / 10);
                return { doc: n, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(wrapper => wrapper.doc);

        res.render('news/article', {
            title: item.meta.title,
            article: item,
            latestNews,
            relatedNews,
            htmlClass: 'news-public-root',
            bodyClass: 'news-public-body public-zoom-centered-body',
            mainClass: 'container news-public-main',
            user
        });

    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}
/* ---------------- ADMIN ACTIONS ---------------- */

async function listAdmin(req, res) {
    try {
        const query = await buildDataServiceQuery(req.query, NEWS_ADMIN_QUERY_OPTIONS);
        query.sort = query.sort || 'audit.lastUpdateDateTime';
        query.order = query.order || 'desc';
        query.limit = Number.parseInt(query.limit, 10);
        query.page = Number.parseInt(query.page, 10) || 1;
        if (!Number.isFinite(query.limit) || query.limit <= 0) query.limit = 20;

        const pagedNews = await dataService.fetchDataPaged('news', query, req.user);
        const data = (Array.isArray(pagedNews?.rows) ? pagedNews.rows : []).map(normalizeNewsItem);
        const pagination = pagedNews?.pagination || null;

        res.render('news/adminList', {
            title: 'Manage News',
            data,
            tableName: 'News_Management',
            newUrl: 'news/manage',
            newLabel: 'Compose New',
            includeModal: true,
            includeModal_Table: true,
            includeModal_FileImport: true,
            print: true,
            pagination,
            filters: query,
            searchableFields: NEWS_ADMIN_SEARCHABLE_FIELDS,
            user: req.user || null
        });

    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function showForm(req, res) {
    try {
        const id = req.params.id;
        let item = null;
        if (id) {
            item = await dataService.getDataById('news', id, req.user);
            if (!item) throw new Error("Item not found");
        }
        
        const categories = await getCategories();

        res.render('news/form', {
            title: id ? 'Edit News' : 'Compose News',
            item,
            categories,
            user: req.user,
            actionStateId: req.actionStateId,
            newsMediaDefaultFolder: getNewsMediaDefaultFolder(),
            includeModal: true
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function saveNews(req, res) {
    try {
        const id = req.params.id;
        let existing = null;
        if (id) {
            existing = await dataService.getDataById('news', id, req.user);
        }

        const newsData = buildNewsObject(req.body, req.files, req.user, existing);

        let result;
        if (id) {
            result = await dataService.updateData('news', id, newsData, req.user);
        } else {
            result = await dataService.addData('news', newsData, req.user);
        }

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'News saved.', redirect: '/news/manage' });
        }
        res.redirect('/news/manage');

    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

async function deleteNews(req, res) {
    try {
        await dataService.deleteData('news', req.params.id, req.user);
        if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Deleted.' });
        res.redirect('/news/manage');
    } catch (error) {
        if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

// ✅ NEW: The Hub / Center View
async function showCenter(req, res) {
    try {
        const dashboardSections = [
            {
                priority: 10,
                title: 'Live News Feed',
                description: 'View the news feed exactly as users see it, including visibility and formatting.',
                href: '/news',
                buttonLabel: 'Open Feed',
                icon: 'bi-newspaper',
                subtleClass: 'bg-success-subtle text-success',
                buttonClass: 'btn btn-success'
            },
            {
                priority: 20,
                title: 'Manage Content',
                description: 'Access article list, update drafts, archive old posts, and remove content.',
                href: '/news/manage',
                buttonLabel: 'Manage Articles',
                icon: 'bi-table',
                subtleClass: 'bg-primary-subtle text-primary',
                buttonClass: 'btn btn-primary'
            },
            {
                priority: 30,
                title: 'Compose Article',
                description: 'Create rich media announcements and target public or organization audiences.',
                href: '/news/manage/new',
                buttonLabel: 'Write New Article',
                icon: 'bi-pen-fill',
                subtleClass: 'bg-warning-subtle text-warning',
                buttonClass: 'btn btn-warning text-dark'
            },
            {
                priority: 40,
                title: 'Engagement Stats',
                description: 'Article engagement analytics area (currently pending).',
                href: '/news/manage',
                buttonLabel: 'Feature Pending',
                icon: 'bi-bar-chart-line-fill',
                subtleClass: 'bg-info-subtle text-info',
                buttonClass: 'btn btn-light border text-muted'
            }
        ].sort((a, b) => (Number(a.priority || 0) - Number(b.priority || 0)));

        res.render('news/center', {
            title: 'News Command Center',
            dashboardSections,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

function resolveUserDisplayName(userRow) {
    if (!userRow || typeof userRow !== 'object') return '';
    const displayName = String(userRow.displayName || userRow.identity?.displayName || '').trim();
    if (displayName) return displayName;
    if (userRow.name && typeof userRow.name === 'object') {
        const fromName = [userRow.name.first, userRow.name.last].filter(Boolean).join(' ').trim();
        if (fromName) return fromName;
    }
    if (typeof userRow.name === 'string') {
        const asString = userRow.name.trim();
        if (asString) return asString;
    }
    return String(userRow.username || userRow.email || '').trim();
}

function formatVisitRoleLabel(role) {
    const raw = String(role || 'user').trim().toLowerCase();
    if (raw === 'guest') return 'Guest';
    return raw
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function buildArticleVisitLogPage(analytics, query = {}) {
    const logs = Array.isArray(analytics) ? analytics : [];
    let limit = Number.parseInt(query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
        limit = Number.parseInt(settingService.getValue('app', 'defaultPageSize'), 10) || 20;
    }
    limit = Math.min(Math.max(limit, 1), MAX_ARTICLE_VISIT_PAGE_LIMIT);
    const page = Number.parseInt(query.page, 10) || 1;

    const rows = logs.map((log, index) => {
        const entry = log && typeof log === 'object' ? log : {};
        const userIdRaw = entry.userId;
        const userId = userIdRaw != null && String(userIdRaw).trim() !== '' ? String(userIdRaw).trim() : null;
        const viewedAt = entry.timestamp || entry.viewedAt || '';
        const isGuest = !userId;
        return {
            userId: userId || '',
            userName: isGuest ? 'Guest' : String(entry.userName || entry.displayName || '').trim(),
            userRole: isGuest ? 'guest' : String(entry.userRole || 'user').trim(),
            userRoleLabel: isGuest ? 'Guest' : formatVisitRoleLabel(entry.userRole || 'user'),
            viewedAt,
            orgId: entry.orgId != null ? String(entry.orgId) : '',
            isGuest,
            _sortTime: viewedAt ? Date.parse(viewedAt) : 0,
            _index: index
        };
    });

    rows.sort((a, b) => {
        if (b._sortTime !== a._sortTime) return b._sortTime - a._sortTime;
        return b._index - a._index;
    });

    const cleaned = rows.map(({ _sortTime, _index, ...rest }) => rest);
    const paged = paginate(cleaned, { page, limit });
    return {
        rows: paged.data,
        pagination: paged.pagination,
        filters: { page: paged.pagination.currentPage, limit: paged.pagination.limit }
    };
}

async function enrichVisitLogNames(rows, actor) {
    const list = Array.isArray(rows) ? rows : [];
    const userCache = new Map();
    const enriched = [];

    for (const row of list) {
        if (row.isGuest || !row.userId) {
            enriched.push({
                ...row,
                userName: 'Guest',
                userRoleLabel: formatVisitRoleLabel('guest')
            });
            continue;
        }

        let userName = String(row.userName || '').trim();
        if (!userName) {
            if (!userCache.has(row.userId)) {
                try {
                    const userRow = await dataService.getDataById('users', row.userId, actor);
                    userCache.set(row.userId, resolveUserDisplayName(userRow) || row.userId);
                } catch (_) {
                    userCache.set(row.userId, row.userId);
                }
            }
            userName = userCache.get(row.userId);
        }

        enriched.push({
            ...row,
            userName: userName || row.userId,
            userRoleLabel: formatVisitRoleLabel(row.userRole)
        });
    }

    return enriched;
}

async function showStats(req, res) {
    try {
        const id = req.params.id;
        const rawItem = await dataService.getDataById('news', id, req.user);
        
        if (!rawItem) return res.status(404).render('error', { title: 'Not Found', message: 'Article not found.', user: req.user });
        const item = normalizeNewsItem({ ...rawItem, id: rawItem.id || id });

        // --- Data Logic ---
        const totalViews = Math.max(0, Number(item.metrics && item.metrics.views ? item.metrics.views : 0) || 0);
        const visibility = String(item.visibility || 'public').trim().toLowerCase();
        
        // 1. Calculate History (Last 7 Days)
        // Note: Ideally you use real dates from item.analytics. 
        // If analytics is empty (old articles), we simulate based on totalViews for visual consistency.
        const logs = Array.isArray(item.analytics) ? item.analytics : [];
        const dates = [];
        const viewHistory = [];
        let remaining = totalViews;

        // If we have real logs, use them
        if (logs.length > 0) {
             for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateKey = d.toISOString().split('T')[0]; 
                dates.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
                
                // Count logs for this day
                // (Assuming log.timestamp is ISO string)
                const count = logs.filter(l => l.timestamp && l.timestamp.startsWith(dateKey)).length;
                viewHistory.push(count);
             }
        } else {
            // Fallback Simulation (if no granular logs exist yet)
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                dates.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
                if (i === 0) viewHistory.push(remaining); 
                else {
                    const chunk = Math.floor(Math.random() * (remaining / i)); 
                    viewHistory.push(chunk);
                    remaining -= chunk;
                }
            }
        }

        // 2. ✅ FIX: Calculate Reading Time
        const articleBody = item.content && typeof item.content.body === 'string' ? item.content.body : '';
        const readTime = calculateReadTime(articleBody);
        const articleText = articleBody.replace(/<[^>]*>?/gm, '').trim();
        const wordCount = articleText ? articleText.split(/\s+/).length : 0;

        const chartData = {
            dates: dates,
            views: viewHistory
        };

        const stats = {
            totalViews: totalViews,
            uniqueUsers: Math.floor(totalViews * 0.85), // Estimate
            readTime: readTime,      // ✅ NEW: Real Value
            wordCount: wordCount     // ✅ NEW: Real Value
        };

        const visitLogPage = buildArticleVisitLogPage(logs, req.query);
        const recentViewers = await enrichVisitLogNames(visitLogPage.rows, req.user);

        res.render('news/stats', {
            title: 'News Analytics',
            article: item,
            stats,
            chartData,
            showRecentViewers: true,
            recentViewers,
            viewerPagination: visitLogPage.pagination,
            viewerFilters: visitLogPage.filters,
            articleVisibility: visibility,
            user: req.user,
            htmlClass: 'news-public-root',
            bodyClass: 'news-public-body public-zoom-centered-body',
            mainClass: 'container news-public-main'
        });

    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

// ✅ NEW: Handle AJAX Uploads for News Media Library
async function uploadMedia(req, res) {
    try {
        if (!req.files || req.files.length === 0) throw new Error('No files uploaded');

        const scopeKey = resolveNewsScopeKey(req.user);
        const targetFolder = await relocateUploadedFilesToFolder(req, req.body?.folder || '');

        const uploadedResults = req.files.map((file) => {
            const url = getWebUrlFromFile(file);
            const storedName = path.basename(String(file?.path || file?.filename || file?.originalname || '').trim());
            const ext = path.extname(storedName || String(file.originalname || '')).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)
                || String(file.mimetype || '').startsWith('image/');
            return {
                status: 'success',
                url,
                type: isImage ? 'image' : 'document',
                name: storedName,
                originalName: file.originalname || storedName
            };
        });

        const results = req.files.map((file) => buildNewsMediaLibraryRowFromUploadedFile(file, scopeKey, targetFolder));

        res.json({
            status: 'success',
            message: uploadedResults.length ? 'News media uploaded successfully.' : 'No files were uploaded.',
            files: uploadedResults,
            results,
            rows: results
        });

    } catch (err) {
        if (req.files) await uploadMiddleware.deleteUploadedFiles(req).catch(() => {});
        res.status(400).json({ status: 'error', message: err.message });
    }
}

module.exports = {
    showCenter,
    feed,
    viewArticle,
    listAdmin,
    showForm,
    saveNews,
    deleteNews,
    showStats,
    uploadMedia,
    listNewsMediaLibrary,
    buildArticleVisitLogPage,
    formatVisitRoleLabel,
    resolveUserDisplayName
};
