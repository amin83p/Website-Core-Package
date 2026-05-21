// MVC/controllers/dashboardController.js
const dataService = require('../services/dataService'); 
const accessService = require('../services/security/accessControl'); 
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const { isAdmin } = require('../services/adminChekersService');

const DASHBOARD_ALL_SECTIONS_CACHE_TTL_MS = 60 * 1000;
const dashboardAllSectionsCache = new Map();

function isNavigatorSection(section) {
  return section?.navigatorSection === true;
}

function getSubsectionRefs(section) {
  return (section?.subsections || [])
    .map((s) => ({ id: s?.id || s, name: s?.name }))
    .filter((r) => r.id || r.name);
}

function resolveSectionRef(allSections, ref) {
  const list = Array.isArray(allSections) ? allSections : [];
  if (!ref) return null;
  const byId = ref.id ? list.find((s) => String(s?.id || '') === String(ref.id)) : null;
  if (byId) return byId;
  const refName = String(ref.name || '').trim().toUpperCase();
  if (!refName) return null;
  return list.find((s) => String(s?.name || '').trim().toUpperCase() === refName) || null;
}

async function hasSectionAccess(user, section, allSections, visited = new Set()) {
  if (!section || section.active !== true) return false;

  const key = String(section?.id || section?.name || '').trim();
  if (key) {
    if (visited.has(key)) return false;
    visited.add(key);
  }

  // Navigator sections are folder-like containers: visible only if at least one child is accessible.
  if (isNavigatorSection(section)) {
    const refs = getSubsectionRefs(section);
    if (refs.length === 0) return false;
    for (const ref of refs) {
      const child = resolveSectionRef(allSections, ref);
      if (!child) continue;
      const childVisited = new Set(visited);
      if (await hasSectionAccess(user, child, allSections, childVisited)) return true;
    }
    return false;
  }

  const ops = section.operations || [];
  if (ops.length === 0) return false;
  for (const op of ops) {
    const opId = op.id || op;
    const result = await accessService.evaluateAccess({
      user,
      sectionId: section.id,
      operationId: opId
    });
    if (result.allowed) return true;
  }
  return false;
}
/* ============================================================
   HELPER: Filter Sections by Permission
============================================================ */
async function filterAccessibleSections(user, sections) {
    const allowed = [];
    for (const section of sections) {
        if (section.active !== true || section.dashboardDisplay !== true) continue;
        if (await hasSectionAccess(user, section, sections)) allowed.push(section);
    }
    return allowed;
}

/** All accessible operational sections (exclude navigator sections) */
async function filterAllAccessibleOperationalSections(user, sections) {
    const allowed = [];
    for (const section of sections) {
        if (section.active !== true) continue;
        if (isNavigatorSection(section)) continue;
        if (await hasSectionAccess(user, section, sections)) allowed.push(section);
    }
    return allowed;
}

/** Home dashboard tiles only: sections with mainDashboardDisplay === true */
async function filterMainDashboardSections(user, sections) {
    const allowed = [];
    for (const section of sections) {
        if (section.active !== true || section.mainDashboardDisplay !== true) continue;
        if (await hasSectionAccess(user, section, sections)) allowed.push(section);
    }
    return allowed;
}

/** Sub-dashboard tiles: active + Show in Dashboard (dashboardDisplay), plus access checks */
async function filterAccessibleSubsections(user, sections, allSectionsForResolution = sections) {
    const allowed = [];
    for (const section of sections) {
        if (section.active !== true || section.dashboardDisplay !== true) continue;
        if (await hasSectionAccess(user, section, allSectionsForResolution)) allowed.push(section);
    }
    return allowed;
}

/* ============================================================
   HELPER: Attach Symbols to Sections (Waterfall Match)
============================================================ */
function mapSymbolsToSections(sections, symbols, user) {
    if (!symbols || symbols.length === 0) return sections;

    const activeOrgId = user?.activeOrgId ? String(user.activeOrgId) : null;

    return sections.map(section => {
        // Standardize Name (e.g. "User Management" -> "USER_MANAGEMENT")
        const searchKey = (section.name || '').trim().toUpperCase().replace(/\s+/g, '_');
        const sectionId = String(section.id || '').trim();

        // Find candidates: match by name, tag (case-insensitive), or section id
        const candidates = symbols.filter(s => {
            const symName = (s.name || '').trim().toUpperCase();
            const tagMatch = Array.isArray(s.tags) && s.tags.some(
                t => String(t || '').trim().toUpperCase() === searchKey
            );
            const idMatch = sectionId && Array.isArray(s.tags) && s.tags.some(
                t => String(t || '').trim() === sectionId
            );
            return symName === searchKey || tagMatch || idMatch;
        });

        if (candidates.length === 0) return section;

        let bestMatch = candidates[0];

        // // 2. Priority A: Active Organization Match
        // if (activeOrgId && activeOrgId !== 'SYSTEM') {
        //     bestMatch = candidates.find(s => String(s.orgId) === activeOrgId);
        // }

        // // 3. Priority B: System/Global Match (Fallback)
        // if (!bestMatch) {
        //     bestMatch = candidates.find(s => !s.orgId);
        // }

        // 4. Attach
        if (bestMatch) {
            section.customIcon = {
                type: bestMatch.type,
                value: bestMatch.value
            };
        }
        return section;
    });
}

function normalizeDashboardSortToken(sortToken = '') {
  const token = String(sortToken || '').trim().toLowerCase();
  return ['name_asc', 'name_desc', 'access_asc', 'access_desc'].includes(token)
    ? token
    : 'name_asc';
}

function buildDashboardSearchText(section = {}) {
  const parts = [
    section?.name,
    section?.description,
    section?.message,
    section?.category
  ];
  return parts
    .map((row) => String(row || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function applyDashboardSectionSearchSort(rows = [], { q = '', sort = 'name_asc' } = {}) {
  const normalizedSort = normalizeDashboardSortToken(sort);
  const searchQuery = String(q || '').trim().toLowerCase();
  let list = Array.isArray(rows) ? rows.slice() : [];

  if (searchQuery) {
    list = list.filter((section) => buildDashboardSearchText(section).includes(searchQuery));
  }

  list.sort((a, b) => {
    const nameA = String(a?.name || '').toLowerCase();
    const nameB = String(b?.name || '').toLowerCase();
    const accessA = Number(a?.minimumAccessRequirement || 0);
    const accessB = Number(b?.minimumAccessRequirement || 0);
    switch (normalizedSort) {
      case 'name_desc':
        return nameB.localeCompare(nameA);
      case 'access_asc':
        return accessA - accessB || nameA.localeCompare(nameB);
      case 'access_desc':
        return accessB - accessA || nameA.localeCompare(nameB);
      case 'name_asc':
      default:
        return nameA.localeCompare(nameB);
    }
  });

  return list;
}

function buildDashboardAllSectionsCacheKey(user = null) {
  const safeUser = user && typeof user === 'object' ? user : {};
  const userId = String(safeUser.id || '').trim() || 'ANON';
  const activeOrgId = String(safeUser.activeOrgId || '').trim() || 'NO_ORG';
  const role = String(safeUser.role || '').trim() || 'NO_ROLE';
  const accessProfileId = String(safeUser.accessProfileId || '').trim() || 'NO_ACCESS_PROFILE';
  const orgAccessProfileId = String(safeUser.orgAccessProfileId || '').trim() || 'NO_ORG_ACCESS_PROFILE';
  const systemAccessProfileId = String(safeUser.systemAccessProfileId || '').trim() || 'NO_SYSTEM_ACCESS_PROFILE';
  const virtualFlag = safeUser.isVirtualSuperAdmin ? 'VSA1' : 'VSA0';
  return [userId, activeOrgId, role, accessProfileId, orgAccessProfileId, systemAccessProfileId, virtualFlag].join('|');
}

function readDashboardAllSectionsCache(cacheKey) {
  if (!cacheKey) return null;
  const cached = dashboardAllSectionsCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardAllSectionsCache.delete(cacheKey);
    return null;
  }
  return Array.isArray(cached.rows) ? cached.rows.slice() : [];
}

function writeDashboardAllSectionsCache(cacheKey, rows) {
  if (!cacheKey) return;
  dashboardAllSectionsCache.set(cacheKey, {
    rows: Array.isArray(rows) ? rows.slice() : [],
    expiresAt: Date.now() + DASHBOARD_ALL_SECTIONS_CACHE_TTL_MS
  });
}

async function getAllAccessibleOperationalSectionsMapped(user) {
  const cacheKey = buildDashboardAllSectionsCacheKey(user);
  const cachedRows = readDashboardAllSectionsCache(cacheKey);
  if (cachedRows) return cachedRows;

  const [allSections, contextSymbols] = await Promise.all([
    dataService.fetchData('sections', {}, user),
    dataService.getContextSymbols(user)
  ]);

  let accessibleSections = await filterAllAccessibleOperationalSections(user, allSections);
  accessibleSections = mapSymbolsToSections(accessibleSections, contextSymbols, user);

  writeDashboardAllSectionsCache(cacheKey, accessibleSections);
  return Array.isArray(accessibleSections) ? accessibleSections.slice() : [];
}

async function getAllAccessibleSections(req, res) {
  try {
    const sort = normalizeDashboardSortToken(req.query?.sort || 'name_asc');
    const q = String(req.query?.q || '').trim();
    const mappedSections = await getAllAccessibleOperationalSectionsMapped(req.user);
    const sections = applyDashboardSectionSearchSort(mappedSections, { q, sort });
    res.json({
      status: 'success',
      sections,
      total: sections.length,
      source: 'all_accessible_non_nav'
    });
  } catch (error) {
    console.error('Dashboard AllSections Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load all accessible sections.' });
  }
}

/* ============================================================
   VIEW: Show Main Dashboard
============================================================ */
async function showDashboard(req, res) {
  try {
    // 1. Fetch Data
    const [allSections, contextSymbols, sectionCategories] = await Promise.all([
        dataService.fetchData('sections', {}, req.user),
        // ✅ USE NEW DEDICATED FUNCTION
        dataService.getContextSymbols(req.user),
        dataService.getSectionCategories()
    ]);
    // 2. Filter Sections
    let accessibleSections = await filterMainDashboardSections(req.user, allSections);

    // 3. Map Symbols
    accessibleSections = mapSymbolsToSections(accessibleSections, contextSymbols, req.user);

    // 4. Sort
    const dashboardSections = accessibleSections.sort((a, b) => {
        const al = (a.minimumAccessRequirement ?? 0) - (b.minimumAccessRequirement ?? 0);
        if (al !== 0) return al;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });

    const canViewSystemStat = async (sectionId, operationId) => {
      if (isAdmin(req.user)) return true;
      try {
        const evaluation = await accessService.evaluateAccess({
          user: req.user,
          sectionId,
          operationId,
          ipAddress: req.ip
        });
        return !!evaluation.allowed;
      } catch (error) {
        return false;
      }
    };

    const [canViewLogStats, canViewActionStateStats] = await Promise.all([
      canViewSystemStat(SECTIONS.LOGS, OPERATIONS.DELETE_ALL),
      canViewSystemStat(SECTIONS.ACTION_STATES, OPERATIONS.DELETE_ALL)
    ]);

    const showDashboardSummary = Boolean(
      isAdmin(req.user)
      || String(req.user?.systemAccessProfileId || '').trim()
    );

    const [logStats, actionStateStats] = await Promise.all([
      canViewLogStats ? dataService.getSystemLogStats() : Promise.resolve(null),
      canViewActionStateStats ? dataService.getSystemActionStateStats() : Promise.resolve(null)
    ]);


    res.render('dashboard', {
      title: 'Dashboard',
      user: req.user || null,
      includeModal: true,
      includeModal_FileImport: true,
      newUrl: 'sections',
      dashboardSections,
      sectionCategories,
      websitePolicy: req.websitePolicy || {},
      showDashboardSummary,
      //
      stats: {
        sections: allSections.length, 
        dashboardSections: dashboardSections.length,
        logCount: logStats ? logStats.logCount : 0,
        logSize: logStats ? logStats.logSize : '0 B',
        logHealth: logStats ? logStats.logHealth : 'secondary',
        logMessage: logStats ? logStats.logMessage : '',
        actionStateCount: actionStateStats ? actionStateStats.actionStateCount : 0,
        actionStateHealth: actionStateStats ? actionStateStats.actionStateHealth : 'secondary',
        actionStateMessage: actionStateStats ? actionStateStats.actionStateMessage : ''
      },
      access: {
        showLogCard: canViewLogStats,
        showActionStateCard: canViewActionStateStats
      },                 
    });

  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).render('error', { title: 'Error', message: 'Error loading dashboard', user: req.user || null });
  }
}

/* ============================================================
   API: Get Quick Menu Data (AJAX)
============================================================ */
async function getQuickMenu(req, res) {
  try {
    const [allSections, contextSymbols] = await Promise.all([
        dataService.fetchData('sections', {}, req.user),
        // ✅ USE NEW DEDICATED FUNCTION
        dataService.getContextSymbols(req.user) 
    ]);

    let accessibleSections = await filterAccessibleSections(req.user, allSections);
    accessibleSections = mapSymbolsToSections(accessibleSections, contextSymbols, req.user);

    const dashboardSections = accessibleSections.sort((a, b) => {
        const al = (a.minimumAccessRequirement ?? 0) - (b.minimumAccessRequirement ?? 0);
        if (al !== 0) return al;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });

    res.json({ status: 'success', sections: dashboardSections });

  } catch (error) {
    console.error("QuickMenu Error:", error);
    res.status(500).json({ status: 'error', message: 'Failed to load quick menu.' });
  }
}

function buildSectionOpenUrl(section, hasChildren = false) {
  const homeUrl = String(section?.homeURL || '').trim();
  if (homeUrl) return homeUrl;
  if (hasChildren) {
    const navToken = encodeURIComponent(String(section?.name || section?.id || '').trim());
    if (navToken) return `/dashboard/section-nav/${navToken}`;
  }
  return '/sections';
}

function buildStartMenuTreeNodes(accessibleSections) {
  const list = Array.isArray(accessibleSections) ? accessibleSections : [];
  const byId = new Map();
  const byName = new Map();

  list.forEach((section) => {
    const idToken = String(section?.id || '').trim();
    if (idToken) byId.set(idToken, section);
    const nameToken = String(section?.name || '').trim().toUpperCase();
    if (nameToken) byName.set(nameToken, section);
  });

  const resolveChildSection = (ref) => {
    if (!ref) return null;
    const refId = String(ref?.id || ref || '').trim();
    if (refId && byId.has(refId)) return byId.get(refId);
    const refName = String(ref?.name || '').trim().toUpperCase();
    if (refName && byName.has(refName)) return byName.get(refName);
    return null;
  };

  const resolveChildren = (section) => {
    const refs = getSubsectionRefs(section);
    const children = [];
    refs.forEach((ref) => {
      const child = resolveChildSection(ref);
      if (child) children.push(child);
    });
    return children;
  };

  const sortSections = (sections) => sections.slice().sort((a, b) => {
    const accessDelta = (a?.minimumAccessRequirement ?? 0) - (b?.minimumAccessRequirement ?? 0);
    if (accessDelta !== 0) return accessDelta;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });

  const includedIds = new Set();

  const buildNode = (section, context) => {
    const sectionId = String(section?.id || '').trim();
    const sectionName = String(section?.name || '').trim();
    const nodeIdentity = sectionId || sectionName || 'UNKNOWN_SECTION';
    const cycleKey = `${sectionId}::${sectionName}`.trim();
    if (context.pathCycle.has(cycleKey)) return null;

    const nextCyclePath = new Set(context.pathCycle);
    nextCyclePath.add(cycleKey);

    const childSections = resolveChildren(section);
    const nextPathTitles = context.pathTitles.concat([formatDashboardLabel(sectionName || sectionId)]);
    const nextPathKeyParts = context.pathKeyParts.concat([nodeIdentity]);

    const childNodes = [];
    childSections.forEach((childSection) => {
      const childNode = buildNode(childSection, {
        pathTitles: nextPathTitles,
        pathCycle: nextCyclePath,
        pathKeyParts: nextPathKeyParts
      });
      if (childNode) childNodes.push(childNode);
    });

    includedIds.add(nodeIdentity);

    const hasChildren = childNodes.length > 0;
    const icon = section?.customIcon && section.customIcon.value
      ? section.customIcon
      : { type: 'class', value: 'bi bi-grid-fill' };
    const pathLabel = nextPathTitles.join(' / ');
    const nodeKey = nextPathKeyParts.join('>');

    return {
      key: nodeKey,
      id: sectionId,
      name: sectionName,
      title: formatDashboardLabel(sectionName || sectionId),
      description: String(section?.description || ''),
      url: buildSectionOpenUrl(section, hasChildren),
      icon,
      hasChildren,
      children: childNodes,
      pathLabel
    };
  };

  const rootSections = sortSections(list.filter((section) => section?.mainDashboardDisplay === true));
  const roots = [];
  rootSections.forEach((section) => {
    const node = buildNode(section, {
      pathTitles: [],
      pathCycle: new Set(),
      pathKeyParts: []
    });
    if (node) roots.push(node);
  });

  const remaining = sortSections(list.filter((section) => {
    const sectionId = String(section?.id || '').trim();
    const sectionName = String(section?.name || '').trim();
    const key = sectionId || sectionName || '';
    return key && !includedIds.has(key);
  }));

  if (remaining.length > 0) {
    const otherChildren = [];
    remaining.forEach((section) => {
      const node = buildNode(section, {
        pathTitles: ['Other Sections'],
        pathCycle: new Set(),
        pathKeyParts: ['OTHER_SECTIONS']
      });
      if (node) otherChildren.push(node);
    });

    if (otherChildren.length > 0) {
      roots.push({
        key: 'OTHER_SECTIONS',
        id: 'OTHER_SECTIONS',
        name: 'OTHER_SECTIONS',
        title: 'Other Sections',
        description: 'Accessible sections that are not linked under main dashboard categories.',
        url: '',
        icon: { type: 'class', value: 'bi bi-collection-fill' },
        hasChildren: true,
        children: otherChildren,
        pathLabel: 'Other Sections'
      });
    }
  }

  return roots;
}

async function getStartMenu(req, res) {
  try {
    const [allSections, contextSymbols] = await Promise.all([
      dataService.fetchData('sections', {}, req.user),
      dataService.getContextSymbols(req.user)
    ]);

    let accessibleSections = await filterAccessibleSections(req.user, allSections);
    accessibleSections = mapSymbolsToSections(accessibleSections, contextSymbols, req.user);
    const tree = buildStartMenuTreeNodes(accessibleSections);

    res.json({ status: 'success', sections: tree });
  } catch (error) {
    console.error('StartMenu Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load start menu.' });
  }
}

/* ============================================================
   SECTION NAV: resolve by id or name (sections.json)
============================================================ */
function findSectionByKey(allSections, rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  const list = allSections || [];
  const byId = list.find(s => String(s.id) === key);
  if (byId) return byId;
  const upper = key.toUpperCase();
  return list.find(s => String(s.name || '').toUpperCase() === upper) || null;
}

function normalizeSectionHomeRedirect(homeURL) {
  let u = String(homeURL || '').trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return null;
  if (!u.startsWith('/')) u = `/${u}`;
  return u;
}

function resolveSectionNavTargetFromHomeUrl(homeTarget = '') {
  const localPath = String(homeTarget || '').trim();
  if (!localPath || /^https?:\/\//i.test(localPath)) return '';
  const match = localPath.match(/^\/dashboard\/section-nav\/([^/?#]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(String(match[1] || '').trim());
  } catch (_) {
    return String(match[1] || '').trim();
  }
}

const DISPLAY_ACRONYMS = new Set([
  'PTE',
  'IELTS',
  'CLB',
  'AI',
  'API',
  'UI',
  'UX',
  'URL',
  'IP',
  'ID',
  'SQL',
  'JSON',
  'CSV',
  'PDF',
  'XML'
]);

function formatDashboardLabel(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Unknown';
  return raw
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map((token) => {
      const part = String(token || '').trim();
      if (!part) return '';
      if (/[a-z]/.test(part) && /[A-Z]/.test(part) && !/^[A-Z0-9]+$/.test(part)) return part;
      const upper = part.toUpperCase();
      if (DISPLAY_ACRONYMS.has(upper)) return upper;
      if (/^[A-Z0-9]+$/.test(part) && /[0-9]/.test(part)) return upper;
      return upper.charAt(0) + upper.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Renders subsection tiles for a parent section (shared by /dashboard/section/:id and /dashboard/section-nav/:key).
 * @param {{ noSubrefsFallback?: 'redirect' | 'unavailable' }} options
 */
async function renderSubDashboardForParent(req, res, parentSection, allSections, contextSymbols, options = {}) {
  const noSubrefsFallback = options.noSubrefsFallback || 'redirect';
  const sectionId = parentSection.id;

  const subRefs = (parentSection.subsections || []).map(s => ({
    id: s.id || s,
    name: s.name
  })).filter(r => r.id || r.name);

  if (subRefs.length === 0) {
    if (noSubrefsFallback === 'unavailable') {
      return res.status(200).render('dashboard/sectionUnavailable', {
        title: 'Section unavailable',
        user: req.user || null,
        sectionName: parentSection.name || sectionId,
        message: 'This section has no home URL and no sub-areas configured yet.'
      });
    }
    return res.redirect('/sections');
  }

  const subSectionMapById = new Map((allSections || []).map(s => [String(s.id || ''), s]));
  const subSectionMapByName = new Map(
    (allSections || [])
      .filter(s => (s.name || '').trim())
      .map(s => [String(s.name || '').trim().toUpperCase(), s])
  );
  let subsections = subRefs
    .map(ref => {
      const byId = (ref.id && subSectionMapById.get(String(ref.id))) || null;
      const byName = (ref.name && subSectionMapByName.get(String(ref.name || '').trim().toUpperCase())) || null;
      return byId || byName || null;
    })
    .filter(Boolean);
  // Use full section universe for access recursion so navigator children can resolve descendants.
  subsections = await filterAccessibleSubsections(req.user, subsections, allSections);
  subsections = mapSymbolsToSections(subsections, contextSymbols, req.user);

  const parentWithIcon = (mapSymbolsToSections([{ ...parentSection }], contextSymbols, req.user))[0];

  function sectionToModule(s, index) {
    const home = String(s.homeURL || '').trim();
    const hasSubs = Array.isArray(s.subsections) && s.subsections.length > 0;
    const navKey = encodeURIComponent(s.name || s.id);
    let href = home || (hasSubs ? `/dashboard/section-nav/${navKey}` : '/sections');
    const colors = ['primary', 'secondary', 'success', 'info', 'warning', 'danger'];
    const color = colors[index % colors.length];
    const displayName = s.name || s.code || s.id || 'Unknown';
    return {
      title: formatDashboardLabel(displayName),
      description: s.description || '',
      href,
      icon: 'bi-grid-fill',
      buttonLabel: 'Open',
      buttonClass: `btn btn-${color}`,
      subtleClass: `bg-${color}-subtle text-${color}`,
      customIcon: s.customIcon || null,
      priority: s.minimumAccessRequirement ?? index
    };
  }

  // Keep icon/tile order exactly as configured in parentSection.subsections.
  const dashboardSections = subsections.map((s, i) => sectionToModule(s, i));

  const displayName = formatDashboardLabel(parentSection.name);
  const title = `${displayName} - Subsections`;

  return res.render('dashboard/sectionSubDashboard', {
    title,
    user: req.user || null,
    includeModal: true,
    dashboardKey: `section-${sectionId}`,
    dashboardTitle: displayName,
    dashboardSubtitle: parentSection.description || `Browse ${dashboardSections.length} subsection(s)`,
    dashboardSections,
    dashboardSection: parentWithIcon,
    dashboardBackHref: '/dashboard',
    dashboardBackLabel: 'Back to Dashboard'
  });
}

/* ============================================================
   VIEW: Section Nav — resolve section by name or id from data
   (homeURL → redirect; subsections → sub-dashboard; else message)
============================================================ */
async function showSectionNav(req, res) {
  try {
    const rawParam = req.params.sectionKey;
    const rawKey = rawParam != null ? decodeURIComponent(String(rawParam)) : '';

    const [allSections, contextSymbols] = await Promise.all([
      dataService.fetchData('sections', {}, req.user),
      dataService.getContextSymbols(req.user)
    ]);

    const section = findSectionByKey(allSections, rawKey);
    if (!section) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'No section matches that name or id.',
        user: req.user || null
      });
    }

    const canAccessSection = await hasSectionAccess(req.user, section, allSections);
    if (!canAccessSection) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have access to this section.',
        user: req.user || null
      });
    }

    const homeTarget = normalizeSectionHomeRedirect(section.homeURL);
    if (homeTarget) {
      const navTargetKey = resolveSectionNavTargetFromHomeUrl(homeTarget);
      if (navTargetKey) {
        const navTargetSection = findSectionByKey(allSections, navTargetKey);
        const sameSection =
          navTargetSection &&
          String(navTargetSection.id || '') === String(section.id || '');
        if (!sameSection) {
          return res.redirect(302, homeTarget);
        }
      } else {
        return res.redirect(302, homeTarget);
      }
    }

    const hasSubsectionRefs = Array.isArray(section.subsections) && section.subsections.length > 0;
    if (hasSubsectionRefs) {
      return renderSubDashboardForParent(req, res, section, allSections, contextSymbols, {
        noSubrefsFallback: 'unavailable'
      });
    }

    return res.status(200).render('dashboard/sectionUnavailable', {
      title: 'Section unavailable',
      user: req.user || null,
      sectionName: section.name || section.id,
      message: 'This section has no home URL and no sub-areas to show.'
    });
  } catch (error) {
    console.error('SectionNav Error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Error loading section',
      user: req.user || null
    });
  }
}

/* ============================================================
   VIEW: Section Sub-Dashboard (Children) — by numeric/string id
============================================================ */
async function showSectionSubDashboard(req, res) {
  try {
    const sectionId = req.params.sectionId;
    if (!sectionId) {
      return res.redirect('/dashboard');
    }

    const [allSections, contextSymbols] = await Promise.all([
      dataService.fetchData('sections', {}, req.user),
      dataService.getContextSymbols(req.user)
    ]);

    const parentSection = (allSections || []).find(s => String(s.id) === String(sectionId));
    if (!parentSection) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Section not found',
        user: req.user || null
      });
    }

    const canAccessParent = await hasSectionAccess(req.user, parentSection, allSections);
    if (!canAccessParent) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have access to this section.',
        user: req.user || null
      });
    }

    return renderSubDashboardForParent(req, res, parentSection, allSections, contextSymbols, {
      noSubrefsFallback: 'redirect'
    });
  } catch (error) {
    console.error('SectionSubDashboard Error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Error loading subsections',
      user: req.user || null
    });
  }
}

/* ============================================================
   HELPER: Get Section for Sub-Dashboard (with Symbol Icon)
   Use when rendering school/credit/ielts/etc. dashboards to get
   the parent section's icon from symbols for the banner.
============================================================ */
async function getDashboardSection(homeURL, user) {
    if (!homeURL || typeof homeURL !== 'string') return null;
    const path = String(homeURL).trim().replace(/\/+$/, '') || '/';
    try {
        const [allSections, contextSymbols] = await Promise.all([
            dataService.fetchData('sections', {}, user),
            dataService.getContextSymbols(user)
        ]);
        const section = (allSections || []).find(s => {
            const url = String(s?.homeURL || '').trim().replace(/\/+$/, '') || '/';
            return url === path;
        });
        if (!section) return null;
        const [mapped] = mapSymbolsToSections([{ ...section }], contextSymbols, user);
        return mapped;
    } catch (err) {
        console.error('getDashboardSection:', err);
        return null;
    }
}

module.exports = {
  showDashboard,
  showSectionNav,
  showSectionSubDashboard,
  getQuickMenu,
  getAllAccessibleSections,
  getStartMenu,
  getDashboardSection,
  mapSymbolsToSections
};
