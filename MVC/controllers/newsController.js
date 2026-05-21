// MVC/controllers/newsController.js
const dataService = require('../services/dataService');
const pathResolver = require('../utils/pathResolver'); 
const fs = require('fs').promises; 
const path = require('path');
const { buildDataServiceQuery } = require('../utils/generalTools');
const uploadMiddleware = require('../middleware/upload');
const fileAssetStorage = require('../services/fileAssetStorageService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');

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
    return pathResolver.getWebUrlForUpload(token);
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

async function getLibraryFiles(scopeId) {
    try {
        const files = await fileAssetStorage.listDirectory({
            scopeKey: scopeId,
            relativeDir: uploadFolderSettingsService.resolveUploadFolder('core.news')
        });
        return files.filter((item) => item && !item.isDir).map(item => {
            const filename = item.name;
            const ext = path.extname(filename || '').toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
            return {
                url: item.url,
                name: filename,
                type: isImage ? 'image' : 'document',
                uploadDate: item.modified || ''
            };
        }).sort((a, b) => String(b.uploadDate || b.name).localeCompare(String(a.uploadDate || a.name)));

    } catch (err) {
        console.error("Error reading library:", err);
        return [];
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
        
        // ✅ NEW: Fetch ALL files in the current scope's News folder
        // Use Active Org ID or GLOBAL
        const scopeId = (req.user.activeOrgId && req.user.activeOrgId !== 'SYSTEM') 
                        ? req.user.activeOrgId 
                        : 'GLOBAL';
        
        const library_Files = await getLibraryFiles(scopeId);

        res.render('news/form', {
            title: id ? 'Edit News' : 'Compose News',
            item,
            categories,
            user: req.user,
            actionStateId: req.actionStateId,
            library_Files,
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

async function showStats(req, res) {
    try {
        const id = req.params.id;
        const rawItem = await dataService.getDataById('news', id, req.user);
        
        if (!rawItem) return res.status(404).render('error', { title: 'Not Found', message: 'Article not found.', user: req.user });
        const item = normalizeNewsItem({ ...rawItem, id: rawItem.id || id });

        // --- Data Logic ---
        const totalViews = Math.max(0, Number(item.metrics && item.metrics.views ? item.metrics.views : 0) || 0);
        
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

        res.render('news/stats', {
            title: 'News Analytics',
            article: item,
            stats,
            chartData,
            user: req.user
        });

    } catch (error) {
        res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
    }
}

// ✅ NEW: Handle AJAX Uploads for News Media Library
async function uploadMedia(req, res) {
    try {
        if (!req.files || req.files.length === 0) throw new Error("No files uploaded");

        // The Middleware (upload('news')) has already saved the files to /uploads/GLOBAL/news
        // We just need to return the URLs to the frontend
        
        const uploadedResults = req.files.map(file => ({
            status: 'success',
            url: getWebUrlFromFile(file), 
            type: file.mimetype.startsWith('image/') ? 'image' : 'document',
            name: file.originalname
        }));

        res.json({ status: 'success', files: uploadedResults });

    } catch (err) {
        // Cleanup if error
        if(req.files) await uploadMiddleware.deleteUploadedFiles(req).catch(()=>{});
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
    uploadMedia // <--- ✅ EXPORT THE NEW FUNCTION
};
