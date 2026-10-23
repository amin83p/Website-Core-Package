const SECTION_NAV_DASHBOARD_KEY_RE = /^section-[A-Za-z0-9_-]+$/;
const MAX_MODULE_ORDER_LENGTH = 200;
const PIN_KEY_PREFIX = 'pin:';

function parseParentSectionIdFromDashboardKey(dashboardKey) {
  const key = String(dashboardKey || '').trim();
  if (!isSectionNavDashboardKey(key)) return '';
  return key.slice('section-'.length);
}

function buildPinKey(sectionId) {
  const id = String(sectionId || '').trim();
  if (!id) return '';
  return `${PIN_KEY_PREFIX}${id}`;
}

function isPinModuleKey(moduleKey) {
  return String(moduleKey || '').trim().startsWith(PIN_KEY_PREFIX);
}

function parsePinSectionId(moduleKey) {
  const key = String(moduleKey || '').trim();
  if (!isPinModuleKey(key)) return '';
  return key.slice(PIN_KEY_PREFIX.length);
}

function normalizePinnedModuleRefs(pinnedModules) {
  if (!Array.isArray(pinnedModules)) return [];
  const normalized = [];
  const seenSectionIds = new Set();
  const seenPinKeys = new Set();
  for (const row of pinnedModules) {
    if (!row || typeof row !== 'object') continue;
    const sectionId = String(row.sectionId || '').trim();
    const pinKey = String(row.pinKey || buildPinKey(sectionId)).trim();
    if (!sectionId || !pinKey || pinKey !== buildPinKey(sectionId)) continue;
    if (seenSectionIds.has(sectionId) || seenPinKeys.has(pinKey)) continue;
    seenSectionIds.add(sectionId);
    seenPinKeys.add(pinKey);
    normalized.push({ pinKey, sectionId });
  }
  return normalized;
}

function validatePinnedModuleRefs(pinnedModules) {
  if (pinnedModules == null) {
    return { ok: true, pinnedModules: [] };
  }
  if (!Array.isArray(pinnedModules)) {
    return { ok: false, message: 'pinnedModules must be an array.' };
  }
  if (pinnedModules.length > MAX_MODULE_ORDER_LENGTH) {
    return { ok: false, message: `pinnedModules exceeds maximum length of ${MAX_MODULE_ORDER_LENGTH}.` };
  }
  const normalized = [];
  const seenSectionIds = new Set();
  for (const row of pinnedModules) {
    if (!row || typeof row !== 'object') {
      return { ok: false, message: 'pinnedModules items must be objects.' };
    }
    const sectionId = String(row.sectionId || '').trim();
    const pinKey = String(row.pinKey || '').trim();
    if (!sectionId) {
      return { ok: false, message: 'pinnedModules sectionId is required.' };
    }
    if (pinKey !== buildPinKey(sectionId)) {
      return { ok: false, message: 'pinnedModules pinKey must match pin:<sectionId>.' };
    }
    if (seenSectionIds.has(sectionId)) {
      return { ok: false, message: 'pinnedModules contains duplicate sectionId.' };
    }
    seenSectionIds.add(sectionId);
    normalized.push({ pinKey, sectionId });
  }
  return { ok: true, pinnedModules: normalized };
}

function validatePinnedModulesAgainstNative(pinnedModules, nativeSectionIds = []) {
  const pinCheck = validatePinnedModuleRefs(pinnedModules);
  if (!pinCheck.ok) return pinCheck;
  const native = new Set(
    (Array.isArray(nativeSectionIds) ? nativeSectionIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  for (const row of pinCheck.pinnedModules) {
    if (native.has(row.sectionId)) {
      return {
        ok: false,
        message: `Section ${row.sectionId} is already on this dashboard and cannot be pinned.`
      };
    }
  }
  return pinCheck;
}

function validateModuleOrderKeys(moduleOrder, allowedKeys) {
  if (moduleOrder == null) return { ok: true };
  const orderCheck = validateModuleOrder(moduleOrder);
  if (!orderCheck.ok) return orderCheck;
  const allowed = new Set(
    (Array.isArray(allowedKeys) ? allowedKeys : [])
      .map((key) => String(key || '').trim())
      .filter(Boolean)
  );
  for (const key of orderCheck.moduleOrder) {
    if (!allowed.has(key)) {
      return { ok: false, message: `moduleOrder contains unknown module key: ${key}` };
    }
  }
  return { ok: true, moduleOrder: orderCheck.moduleOrder };
}

function mergeNativeAndPinnedModules(nativeModules, pinnedModulesResolved) {
  const native = Array.isArray(nativeModules) ? nativeModules.slice() : [];
  const pins = Array.isArray(pinnedModulesResolved) ? pinnedModulesResolved.slice() : [];
  return native.concat(pins);
}

function getModuleKey(module) {
  if (!module || typeof module !== 'object') return '';
  return String(module.id || module.href || module.title || '').trim();
}

function applyModuleOrder(modules, savedOrder) {
  const list = Array.isArray(modules) ? modules.slice() : [];
  const order = Array.isArray(savedOrder) ? savedOrder.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!order.length) return list;

  const byKey = new Map();
  list.forEach((module) => {
    const key = getModuleKey(module);
    if (key && !byKey.has(key)) byKey.set(key, module);
  });

  const ordered = [];
  const used = new Set();

  order.forEach((key) => {
    const module = byKey.get(key);
    if (!module || used.has(key)) return;
    ordered.push(module);
    used.add(key);
  });

  list.forEach((module) => {
    const key = getModuleKey(module);
    if (!key || used.has(key)) return;
    ordered.push(module);
    used.add(key);
  });

  return ordered;
}

function isSectionNavDashboardKey(key) {
  return SECTION_NAV_DASHBOARD_KEY_RE.test(String(key || '').trim());
}

function buildDashboardOrderTableId(dashboardKey) {
  return `dashboard-order:${String(dashboardKey || '').trim()}`;
}

function validateDashboardKey(dashboardKey) {
  const key = String(dashboardKey || '').trim();
  if (!isSectionNavDashboardKey(key)) {
    return { ok: false, message: 'Invalid dashboard key.' };
  }
  return { ok: true, key };
}

function validateModuleOrder(moduleOrder) {
  if (!Array.isArray(moduleOrder)) {
    return { ok: false, message: 'moduleOrder must be an array.' };
  }
  if (moduleOrder.length === 0) {
    return { ok: false, message: 'moduleOrder must not be empty.' };
  }
  if (moduleOrder.length > MAX_MODULE_ORDER_LENGTH) {
    return { ok: false, message: `moduleOrder exceeds maximum length of ${MAX_MODULE_ORDER_LENGTH}.` };
  }
  const normalized = [];
  for (const item of moduleOrder) {
    if (typeof item !== 'string') {
      return { ok: false, message: 'moduleOrder items must be strings.' };
    }
    const trimmed = item.trim();
    if (!trimmed) {
      return { ok: false, message: 'moduleOrder items must not be empty.' };
    }
    normalized.push(trimmed);
  }
  return { ok: true, moduleOrder: normalized };
}

function extractModuleOrderFromSettings(settings) {
  const order = settings && Array.isArray(settings.moduleOrder) ? settings.moduleOrder : null;
  if (!order || !order.length) return null;
  return order.map((id) => String(id || '').trim()).filter(Boolean);
}

function normalizeModuleKeyList(values) {
  if (!Array.isArray(values)) return [];
  const normalized = [];
  const seen = new Set();
  for (const item of values) {
    const token = String(item || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }
  return normalized;
}

function validateHiddenModuleKeys(hiddenModuleKeys) {
  if (hiddenModuleKeys == null) {
    return { ok: true, hiddenModuleKeys: [] };
  }
  if (!Array.isArray(hiddenModuleKeys)) {
    return { ok: false, message: 'hiddenModuleKeys must be an array.' };
  }
  if (hiddenModuleKeys.length > MAX_MODULE_ORDER_LENGTH) {
    return { ok: false, message: `hiddenModuleKeys exceeds maximum length of ${MAX_MODULE_ORDER_LENGTH}.` };
  }
  const normalized = [];
  for (const item of hiddenModuleKeys) {
    if (typeof item !== 'string') {
      return { ok: false, message: 'hiddenModuleKeys items must be strings.' };
    }
    const trimmed = item.trim();
    if (!trimmed) {
      return { ok: false, message: 'hiddenModuleKeys items must not be empty.' };
    }
    normalized.push(trimmed);
  }
  return { ok: true, hiddenModuleKeys: normalized };
}

function validateNavigationPreferences(payload = {}) {
  const hasModuleOrder = Object.prototype.hasOwnProperty.call(payload, 'moduleOrder');
  const hasHiddenModuleKeys = Object.prototype.hasOwnProperty.call(payload, 'hiddenModuleKeys');
  const hasPinnedModules = Object.prototype.hasOwnProperty.call(payload, 'pinnedModules');
  if (!hasModuleOrder && !hasHiddenModuleKeys && !hasPinnedModules) {
    return { ok: false, message: 'moduleOrder, hiddenModuleKeys, or pinnedModules is required.' };
  }

  let moduleOrder = null;
  if (hasModuleOrder) {
    const orderCheck = validateModuleOrder(payload.moduleOrder);
    if (!orderCheck.ok) return orderCheck;
    moduleOrder = orderCheck.moduleOrder;
  }

  const hiddenCheck = validateHiddenModuleKeys(
    hasHiddenModuleKeys ? payload.hiddenModuleKeys : []
  );
  if (!hiddenCheck.ok) return hiddenCheck;

  const pinnedCheck = validatePinnedModuleRefs(
    hasPinnedModules ? payload.pinnedModules : []
  );
  if (!pinnedCheck.ok) return pinnedCheck;

  return {
    ok: true,
    moduleOrder,
    hiddenModuleKeys: hiddenCheck.hiddenModuleKeys,
    pinnedModules: pinnedCheck.pinnedModules
  };
}

function extractNavigationPreferences(settings = {}) {
  const moduleOrder = extractModuleOrderFromSettings(settings);
  const hiddenModuleKeys = normalizeModuleKeyList(settings?.hiddenModuleKeys);
  const pinnedModules = normalizePinnedModuleRefs(settings?.pinnedModules);
  return {
    moduleOrder,
    hiddenModuleKeys,
    pinnedModules
  };
}

function applyHiddenModules(modules, hiddenModuleKeys, options = {}) {
  const list = Array.isArray(modules) ? modules.slice() : [];
  const hidden = new Set(normalizeModuleKeyList(hiddenModuleKeys));
  if (!hidden.size) return list;
  if (options.includeHidden) return list;
  return list.filter((module) => !hidden.has(getModuleKey(module)));
}

module.exports = {
  SECTION_NAV_DASHBOARD_KEY_RE,
  PIN_KEY_PREFIX,
  MAX_MODULE_ORDER_LENGTH,
  getModuleKey,
  applyModuleOrder,
  applyHiddenModules,
  mergeNativeAndPinnedModules,
  isSectionNavDashboardKey,
  parseParentSectionIdFromDashboardKey,
  buildPinKey,
  isPinModuleKey,
  parsePinSectionId,
  normalizePinnedModuleRefs,
  validatePinnedModuleRefs,
  validatePinnedModulesAgainstNative,
  validateModuleOrderKeys,
  buildDashboardOrderTableId,
  validateDashboardKey,
  validateModuleOrder,
  validateHiddenModuleKeys,
  validateNavigationPreferences,
  extractModuleOrderFromSettings,
  extractNavigationPreferences,
  normalizeModuleKeyList
};
