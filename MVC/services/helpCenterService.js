const helpArticleRepository = require('../repositories/helpArticleRepository');

const CACHE_TTL_MS = 30 * 1000;

const cache = {
  loadedAt: 0,
  articles: [],
  byId: new Map(),
  bySlug: new Map(),
  byCategory: new Map(),
  exactBySectionOp: new Map(),
  bySectionOnly: new Map(),
  byOperationOnly: new Map(),
  globalDefaults: []
};

const AUDIENCE_ALIAS_TO_CANONICAL = Object.freeze({
  all: 'all',
  user: 'user',
  users: 'user',
  member: 'user',
  members: 'user',
  admin: 'admin',
  admins: 'admin',
  developer: 'developer',
  developers: 'developer',
  dev: 'developer',
  support: 'support',
  supports: 'support',
  school_student: 'school_student',
  school_students: 'school_student',
  'school-student': 'school_student',
  'school-students': 'school_student',
  schoolstudent: 'school_student',
  schoolstudents: 'school_student',
  school_teacher: 'school_teacher',
  school_teachers: 'school_teacher',
  'school-teacher': 'school_teacher',
  'school-teachers': 'school_teacher',
  schoolteacher: 'school_teacher',
  schoolteachers: 'school_teacher',
  school_staff: 'school_staff',
  school_staffs: 'school_staff',
  'school-staff': 'school_staff',
  'school-staffs': 'school_staff',
  schoolstaff: 'school_staff',
  schoolstaffs: 'school_staff'
});

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCategory(value) {
  return String(value || 'Uncategorized').trim() || 'Uncategorized';
}

function normalizePriority(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAudienceToken(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return AUDIENCE_ALIAS_TO_CANONICAL[normalized] || normalized;
}

function normalizeAudienceList(values) {
  const raw = Array.isArray(values) ? values : [values];
  const list = Array.from(new Set(raw.map((v) => normalizeAudienceToken(v)).filter(Boolean)));
  return list.length ? list : ['all'];
}

function buildViewerAudienceSet(viewerAudiences) {
  const list = normalizeAudienceList(viewerAudiences || []);
  list.push('all');
  list.push('user');
  return new Set(normalizeAudienceList(list));
}

function articleMatchesAudience(article, viewerAudienceSet) {
  const articleAudience = normalizeAudienceList(article?.audience || ['all']);
  if (articleAudience.includes('all')) return true;
  const audienceSet = viewerAudienceSet instanceof Set ? viewerAudienceSet : buildViewerAudienceSet([]);
  return articleAudience.some((token) => audienceSet.has(token));
}

function normalizeUpdatedAt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '1970-01-01T00:00:00.000Z';
  return d.toISOString();
}

function normalizeArticle(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const id = String(src.id || `HELP_${index + 1}`).trim();
  const slug = String(src.slug || id.toLowerCase()).trim().toLowerCase();
  const title = String(src.title || id).trim();
  const category = normalizeCategory(src.category);
  const sectionId = normalizeToken(src.sectionId);
  const operationId = normalizeToken(src.operationId);
  const priority = normalizePriority(src.priority);
  const active = src.active !== false;
  const tags = Array.isArray(src.tags) ? src.tags.map((t) => String(t || '').trim()).filter(Boolean) : [];
  const summary = String(src.summary || '').trim();
  const contentHtml = String(src.contentHtml || '').trim();
  const contentMode = String(src.contentMode || 'richtext').trim().toLowerCase() === 'html_page' ? 'html_page' : 'richtext';
  const contentPagePath = String(src.contentPagePath || '').trim();
  const audience = normalizeAudienceList(src.audience || ['all']);
  const updatedAt = normalizeUpdatedAt(src.updatedAt || new Date().toISOString());

  return {
    id,
    slug,
    title,
    category,
    sectionId,
    operationId,
    priority,
    active,
    tags,
    summary,
    contentMode,
    contentPagePath,
    contentHtml,
    audience,
    updatedAt
  };
}

function compareArticles(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

function pushIndexList(map, key, article) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(article);
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function rebuildCache() {
  const all = await helpArticleRepository.list({
    query: {},
    scope: { canViewAll: true, isAuthenticated: true }
  });
  const normalized = all.map((a, i) => normalizeArticle(a, i)).filter((a) => a.active);
  normalized.sort(compareArticles);

  cache.loadedAt = Date.now();
  cache.articles = normalized;
  cache.byId = new Map();
  cache.bySlug = new Map();
  cache.byCategory = new Map();
  cache.exactBySectionOp = new Map();
  cache.bySectionOnly = new Map();
  cache.byOperationOnly = new Map();
  cache.globalDefaults = [];

  for (const article of normalized) {
    cache.byId.set(article.id, article);
    cache.bySlug.set(article.slug, article);
    pushIndexList(cache.byCategory, article.category, article);

    if (article.sectionId && article.operationId) {
      pushIndexList(cache.exactBySectionOp, `${article.sectionId}::${article.operationId}`, article);
      continue;
    }

    if (article.sectionId && !article.operationId) {
      pushIndexList(cache.bySectionOnly, article.sectionId, article);
      continue;
    }

    if (!article.sectionId && article.operationId) {
      pushIndexList(cache.byOperationOnly, article.operationId, article);
      continue;
    }

    cache.globalDefaults.push(article);
  }
}

async function ensureCache(force = false) {
  const expired = (Date.now() - cache.loadedAt) > CACHE_TTL_MS;
  if (force || cache.loadedAt === 0 || expired) {
    await rebuildCache();
  }
}

function pickTopForAudience(list, viewerAudienceSet) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((item) => articleMatchesAudience(item, viewerAudienceSet)) || null;
}

async function resolveArticle(sectionId, operationId, viewerAudiences = []) {
  await ensureCache();
  const sid = normalizeToken(sectionId);
  const oid = normalizeToken(operationId);
  const viewerAudienceSet = buildViewerAudienceSet(viewerAudiences);

  if (sid && oid) {
    const exact = pickTopForAudience(cache.exactBySectionOp.get(`${sid}::${oid}`), viewerAudienceSet);
    if (exact) return exact;
  }

  if (sid) {
    const bySection = pickTopForAudience(cache.bySectionOnly.get(sid), viewerAudienceSet);
    if (bySection) return bySection;
  }

  if (oid) {
    const byOp = pickTopForAudience(cache.byOperationOnly.get(oid), viewerAudienceSet);
    if (byOp) return byOp;
  }

  return pickTopForAudience(cache.globalDefaults, viewerAudienceSet);
}

async function searchArticles(query, options = {}, viewerAudiences = []) {
  await ensureCache();
  const q = String(query || '').trim().toLowerCase();
  const categoryFilter = String(options.category || '').trim().toLowerCase();
  const sectionFilter = normalizeToken(options.sectionId);
  const operationFilter = normalizeToken(options.operationId);
  const viewerAudienceSet = buildViewerAudienceSet(viewerAudiences);

  let list = [...cache.articles].filter((a) => articleMatchesAudience(a, viewerAudienceSet));

  if (categoryFilter) {
    list = list.filter((a) => String(a.category || '').toLowerCase() === categoryFilter);
  }
  if (sectionFilter) {
    list = list.filter((a) => a.sectionId === sectionFilter || !a.sectionId);
  }
  if (operationFilter) {
    list = list.filter((a) => a.operationId === operationFilter || !a.operationId);
  }

  if (!q) return list;

  return list.filter((a) => {
    const hay = [
      a.title,
      a.summary,
      a.category,
      a.sectionId,
      a.operationId,
      a.tags.join(' '),
      a.contentMode,
      a.contentPagePath,
      a.audience.join(' '),
      stripHtml(a.contentHtml)
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

async function getCategories(viewerAudiences = []) {
  await ensureCache();
  const viewerAudienceSet = buildViewerAudienceSet(viewerAudiences);
  const categories = Array.from(cache.byCategory.entries()).map(([name, articles]) => ({
    name,
    count: (articles || []).filter((a) => articleMatchesAudience(a, viewerAudienceSet)).length
  })).filter((x) => x.count > 0);
  categories.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
  return categories;
}

async function getArticleBySlug(slug, viewerAudiences = []) {
  await ensureCache();
  const found = cache.bySlug.get(String(slug || '').trim().toLowerCase()) || null;
  if (!found) return null;
  const viewerAudienceSet = buildViewerAudienceSet(viewerAudiences);
  return articleMatchesAudience(found, viewerAudienceSet) ? found : null;
}

async function getRelatedArticles(article, limit = 5, viewerAudiences = []) {
  await ensureCache();
  if (!article) return [];

  const srcTags = new Set((article.tags || []).map((t) => String(t || '').toLowerCase()));
  const viewerAudienceSet = buildViewerAudienceSet(viewerAudiences);
  const candidates = cache.articles.filter((a) => a.id !== article.id && articleMatchesAudience(a, viewerAudienceSet));
  const ranked = candidates.map((c) => {
    let score = 0;
    if (c.category === article.category) score += 30;
    if (c.sectionId && c.sectionId === article.sectionId) score += 40;
    if (c.operationId && c.operationId === article.operationId) score += 35;
    for (const t of c.tags || []) {
      if (srcTags.has(String(t || '').toLowerCase())) score += 5;
    }
    score += normalizePriority(c.priority);
    return { score, article: c };
  });
  ranked.sort((a, b) => b.score - a.score || compareArticles(a.article, b.article));
  return ranked.slice(0, Math.max(1, limit)).map((r) => r.article);
}

module.exports = {
  ensureCache,
  rebuildCache,
  resolveArticle,
  searchArticles,
  getCategories,
  getArticleBySlug,
  getRelatedArticles
};
