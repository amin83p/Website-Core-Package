const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/helpArticles.json');

async function ensureFile() {
  try {
    await fs.access(dataPath);
  } catch {
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
  }
}

async function getAllArticles() {
  await ensureFile();
  const raw = await fs.readFile(dataPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function getArticleById(id) {
  const all = await getAllArticles();
  return all.find((a) => idsEqual(a?.id, id));
}

async function getArticleBySlug(slug) {
  const all = await getAllArticles();
  return all.find((a) => String(a.slug || '').toLowerCase() === String(slug || '').toLowerCase());
}

async function addArticle(article) {
  return queueWrite(async () => {
    const all = await getAllArticles();
    if (all.some((a) => idsEqual(a?.id, article?.id))) {
      throw new Error(`Help article id already exists: ${article.id}`);
    }
    if (article.slug && all.some((a) => String(a.slug || '').toLowerCase() === String(article.slug).toLowerCase())) {
      throw new Error(`Help article slug already exists: ${article.slug}`);
    }
    all.push(article);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return article;
  });
}

async function updateArticle(id, updates) {
  return queueWrite(async () => {
    const all = await getAllArticles();
    const idx = all.findIndex((a) => idsEqual(a?.id, id));
    if (idx === -1) throw new Error('Help article not found');

    const next = { ...all[idx], ...(updates || {}) };
    if (next.slug) {
      const slugClash = all.find((a, i) => i !== idx && String(a.slug || '').toLowerCase() === String(next.slug).toLowerCase());
      if (slugClash) throw new Error(`Help article slug already exists: ${next.slug}`);
    }

    all[idx] = next;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return next;
  });
}

async function deleteArticle(id) {
  return queueWrite(async () => {
    const all = await getAllArticles();
    const filtered = all.filter((a) => !idsEqual(a?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

function applyHelpArticleScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll === true) return list;
  if (scope?.isAuthenticated === true) return list.filter((item) => item?.active !== false);
  return list.filter((item) => item?.active !== false);
}

function buildHelpArticleQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'helpArticles',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll === true,
      isAuthenticated: incomingScope?.isAuthenticated === true
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: [
        'id',
        'slug',
        'title',
        'category',
        'sectionId',
        'operationId',
        'summary',
        'tags',
        'audience'
      ],
      dateFields: ['updatedAt']
    }
  };
}

async function queryHelpArticles(options = {}) {
  const plan = buildHelpArticleQueryPlan(options);
  const executor = getEntityQueryExecutor('helpArticles');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const all = await getAllArticles();
  const scoped = applyHelpArticleScope(all, plan.scope);
  return applyGenericFilter(scoped, plan.query, plan.fallback);
}

module.exports = {
  getAllArticles,
  queryHelpArticles,
  buildHelpArticleQueryPlan,
  getArticleById,
  getArticleBySlug,
  addArticle,
  updateArticle,
  deleteArticle
};

