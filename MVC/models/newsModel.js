// MVC/models/newsModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const newsVisibilityService = require('../services/newsVisibilityService');

const dataPath = path.join(__dirname, '../../data/news.json');

/* ---------------- HELPERS ---------------- */

function generateSlug(title) {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')    // Remove non-word chars
        .replace(/[\s_-]+/g, '-')    // Replace spaces/underscores with hyphen
        .replace(/^-+|-+$/g, '');    // Trim hyphens
}

/* ---------------- READERS ---------------- */

async function getAllNews() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return []; // File doesn't exist yet
    throw error;
  }
}

function applyNewsScope(rows, scope = {}) {
  return newsVisibilityService.filterVisibleNews(rows, scope);
}

function buildNewsQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'news',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      isAuthenticated: incomingScope?.isAuthenticated === true,
      activeOrgId: toPublicId(incomingScope?.activeOrgId) || null
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
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
      dateFields: ['publishDate', 'createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryNews(options = {}) {
  const plan = buildNewsQueryPlan(options);
  const executor = getEntityQueryExecutor('news');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allNews = await getAllNews();
  const scopedNews = applyNewsScope(allNews, plan.scope);
  return applyGenericFilter(scopedNews, plan.query, plan.fallback);
}

async function getNewsById(id) {
  const all = await getAllNews();
  return all.find((n) => idsEqual(n?.id, id));
}

async function getNewsBySlug(slug) {
  const all = await getAllNews();
  return all.find(n => n.meta && n.meta.slug === slug);
}

// ✅ IMPROVED: Log View (Atomic Read-Modify-Write)
async function logView(newsId, logData) {
    // We utilize queueWrite to ensure that concurrent view logs 
    // do not overwrite each other (Race Condition Prevention)
    return await queueWrite(async () => {
        try {
            // 1. Read latest data inside the lock
            const all = await getAllNews();
            const index = all.findIndex((i) => idsEqual(i?.id, newsId));
            
            if (index === -1) return false;

            const item = all[index];

            // 2. Initialize structure if missing
            if (!item.metrics) item.metrics = { views: 0 };
            if (!item.analytics) item.analytics = [];

            // 3. Increment Simple Counter
            item.metrics.views = (item.metrics.views || 0) + 1;

            // 4. Add Granular Log
            item.analytics.push(logData);
            
            // Limit log size to prevent infinite file growth (Keep last 2000)
            if (item.analytics.length > 2000) {
                item.analytics = item.analytics.slice(-2000); 
            }

            // 5. Save directly (Avoids double-read overhead of updateNews)
            all[index] = item;
            await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
            
            return true;

        } catch (error) {
            console.error("Error inside logView transaction:", error);
            return false;
        }
    });
}

/* ---------------- CRUD ---------------- */

async function addNews(newsItem) {
  await queueWrite(async () => {
    const all = await getAllNews();
    
    // Generate ID
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    newsItem.id = `NEWS_${datePart}_${randomPart}`;

    // Generate Slug if missing
    if (!newsItem.meta.slug) {
        let baseSlug = generateSlug(newsItem.meta.title || 'untitled');
        let uniqueSlug = baseSlug;
        let counter = 1;
        // Ensure uniqueness
        while (all.find(n => n.meta && n.meta.slug === uniqueSlug)) {
            uniqueSlug = `${baseSlug}-${counter}`;
            counter++;
        }
        newsItem.meta.slug = uniqueSlug;
    }

    all.push(newsItem);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });
  return newsItem;
}

async function updateNews(id, updates) {
  await queueWrite(async () => {
    const all = await getAllNews();
    const index = all.findIndex((n) => idsEqual(n?.id, id));
    if (index === -1) throw new Error('News item not found.');

    // Merge logic
    const current = all[index];
    const merged = { 
        ...current, 
        ...updates, 
        id: current.id, // ID cannot change
        meta: { ...current.meta, ...(updates.meta || {}) },
        content: { ...current.content, ...(updates.content || {}) },
        audit: { ...current.audit, ...(updates.audit || {}) } 
    };
    
    // Recalculate slug if title changed and slug wasn't manually provided
    if (updates.meta && updates.meta.title && updates.meta.title !== current.meta.title && !updates.meta.slug) {
         // Note: For robust slug updates, uniqueness checks should also be applied here similar to addNews
         merged.meta.slug = generateSlug(updates.meta.title);
    }

    all[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });
}

async function deleteNews(id) {
  await queueWrite(async () => {
    const all = await getAllNews();
    const filtered = all.filter((n) => !idsEqual(n?.id, id));
    if (filtered.length === all.length) throw new Error('News item not found.');
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllNews,
  queryNews,
  buildNewsQueryPlan,
  getNewsById,
  getNewsBySlug,
  addNews,
  updateNews,
  deleteNews,
  logView
};
