'use strict';

const dataService = require('./dataService');
const sectionsOperationsCatalogCacheService = require('./cache/sectionsOperationsCatalogCacheService');
const { resolveSectionDisplayTitle } = require('../utils/sectionDisplay');
const {
  buildPinKey,
  parseParentSectionIdFromDashboardKey
} = require('../utils/dashboardModuleOrder');
function getDashboardController() {
  return require('../controllers/dashboardController');
}

function getSubsectionRefs(section) {
  return (section?.subsections || [])
    .map((s) => ({ id: s?.id || s, name: s?.name }))
    .filter((r) => r.id || r.name);
}

async function loadSectionsContext(user) {
  const [allSections, contextSymbols] = await Promise.all([
    sectionsOperationsCatalogCacheService.getSectionsForUser(user),
    dataService.getContextSymbols(user)
  ]);
  return { allSections, contextSymbols };
}

async function getNativeSubDashboardModules(user, dashboardKey) {
  const parentKey = parseParentSectionIdFromDashboardKey(dashboardKey);
  if (!parentKey) return { nativeSectionIds: [], nativeModules: [] };

  const { allSections, contextSymbols } = await loadSectionsContext(user);
  const {
    findSectionByKey,
    filterAccessibleSubsections,
    mapSymbolsToSections,
    buildSectionDashboardModule
  } = getDashboardController();
  const parentSection = findSectionByKey(allSections, parentKey);
  if (!parentSection) return { nativeSectionIds: [], nativeModules: [] };

  const subRefs = getSubsectionRefs(parentSection);
  const subSectionMapById = new Map((allSections || []).map((s) => [String(s.id || ''), s]));
  const subSectionMapByName = new Map(
    (allSections || [])
      .filter((s) => (s.name || '').trim())
      .map((s) => [String(s.name || '').trim().toUpperCase(), s])
  );
  let subsections = subRefs
    .map((ref) => {
      const byId = (ref.id && subSectionMapById.get(String(ref.id))) || null;
      const byName = (ref.name && subSectionMapByName.get(String(ref.name || '').trim().toUpperCase())) || null;
      return byId || byName || null;
    })
    .filter(Boolean);
  subsections = await filterAccessibleSubsections(user, subsections, allSections);
  subsections = mapSymbolsToSections(subsections, contextSymbols, user);

  const nativeModules = subsections.map((s, i) => buildSectionDashboardModule(s, i));
  const nativeSectionIds = nativeModules
    .map((m) => String(m.sectionId || m.id || '').trim())
    .filter(Boolean);

  return { nativeSectionIds, nativeModules, allSections, contextSymbols };
}

async function resolvePinnedModuleDtos(user, pinnedRefs = [], options = {}) {
  const refs = Array.isArray(pinnedRefs) ? pinnedRefs : [];
  if (!refs.length) return [];

  const { hasSectionAccess, mapSymbolsToSections, buildSectionDashboardModule } = getDashboardController();
  const { allSections, contextSymbols } = options.allSections
    ? { allSections: options.allSections, contextSymbols: options.contextSymbols || [] }
    : await loadSectionsContext(user);

  const sectionById = new Map(
    (allSections || [])
      .map((s) => [String(s.id || '').trim(), s])
      .filter(([id]) => Boolean(id))
  );

  const resolved = [];
  let colorIndex = Number(options.colorIndexStart) || 0;
  for (const ref of refs) {
    const sectionId = String(ref?.sectionId || '').trim();
    if (!sectionId) continue;
    const section = sectionById.get(sectionId);
    if (!section) continue;
    if (!(await hasSectionAccess(user, section, allSections))) continue;

    const [mapped] = mapSymbolsToSections([{ ...section }], contextSymbols, user);
    const base = buildSectionDashboardModule(mapped || section, colorIndex);
    colorIndex += 1;
    const pinKey = String(ref.pinKey || buildPinKey(sectionId)).trim();
    resolved.push({
      ...base,
      id: pinKey,
      sectionId,
      isPinned: true
    });
  }
  return resolved;
}

module.exports = {
  getNativeSubDashboardModules,
  resolvePinnedModuleDtos
};
