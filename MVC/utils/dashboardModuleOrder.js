const SECTION_NAV_DASHBOARD_KEY_RE = /^section-[A-Za-z0-9_-]+$/;
const MAX_MODULE_ORDER_LENGTH = 200;

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
  if (!hasModuleOrder && !hasHiddenModuleKeys) {
    return { ok: false, message: 'moduleOrder or hiddenModuleKeys is required.' };
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

  return {
    ok: true,
    moduleOrder,
    hiddenModuleKeys: hiddenCheck.hiddenModuleKeys
  };
}

function extractNavigationPreferences(settings = {}) {
  const moduleOrder = extractModuleOrderFromSettings(settings);
  const hiddenModuleKeys = normalizeModuleKeyList(settings?.hiddenModuleKeys);
  return {
    moduleOrder,
    hiddenModuleKeys
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
  MAX_MODULE_ORDER_LENGTH,
  getModuleKey,
  applyModuleOrder,
  applyHiddenModules,
  isSectionNavDashboardKey,
  buildDashboardOrderTableId,
  validateDashboardKey,
  validateModuleOrder,
  validateHiddenModuleKeys,
  validateNavigationPreferences,
  extractModuleOrderFromSettings,
  extractNavigationPreferences,
  normalizeModuleKeyList
};
