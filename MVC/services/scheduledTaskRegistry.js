'use strict';

const CORE_PACKAGE = 'CORE';

const CORE_HANDLERS = new Map();
const PACKAGE_HANDLERS = new Map();

function normalizePackageName(value = '') {
  return String(value || '').trim().toUpperCase();
}

function normalizeTaskKey(value = '') {
  return String(value || '').trim();
}

function freezeHandler(handler = {}) {
  const taskKey = normalizeTaskKey(handler.taskKey);
  if (!taskKey) throw new Error('Scheduled task handler requires taskKey.');
  if (typeof handler.handler !== 'function') {
    throw new Error(`Scheduled task handler '${taskKey}' requires a handler function.`);
  }
  return Object.freeze({
    taskKey,
    label: String(handler.label || taskKey).trim(),
    description: String(handler.description || '').trim(),
    scope: handler.scope === 'org' ? 'org' : 'system',
    packageName: normalizePackageName(handler.packageName || CORE_PACKAGE),
    handler: handler.handler
  });
}

function registerCoreScheduledTaskHandler(handler = {}) {
  const frozen = freezeHandler({ ...handler, packageName: CORE_PACKAGE });
  if (CORE_HANDLERS.has(frozen.taskKey)) {
    throw new Error(`Core scheduled task handler '${frozen.taskKey}' is already registered.`);
  }
  CORE_HANDLERS.set(frozen.taskKey, frozen);
  return frozen.taskKey;
}

function registerPackageScheduledTaskHandler(packageName = '', handler = {}) {
  const pkg = normalizePackageName(packageName);
  if (!pkg) throw new Error('packageName is required to register scheduled task handlers.');
  const frozen = freezeHandler({ ...handler, packageName: pkg });
  if (frozen.taskKey.startsWith('core.')) {
    throw new Error(`Package '${pkg}' cannot register reserved core task key '${frozen.taskKey}'.`);
  }
  if (!PACKAGE_HANDLERS.has(pkg)) PACKAGE_HANDLERS.set(pkg, new Map());
  const pkgMap = PACKAGE_HANDLERS.get(pkg);
  if (pkgMap.has(frozen.taskKey)) {
    throw new Error(`Package '${pkg}' task handler '${frozen.taskKey}' is already registered.`);
  }
  pkgMap.set(frozen.taskKey, frozen);
  return frozen.taskKey;
}

function getScheduledTaskHandler(taskKey = '') {
  const key = normalizeTaskKey(taskKey);
  if (!key) return null;
  if (CORE_HANDLERS.has(key)) return CORE_HANDLERS.get(key);
  for (const pkgMap of PACKAGE_HANDLERS.values()) {
    if (pkgMap.has(key)) return pkgMap.get(key);
  }
  return null;
}

function listRegisteredScheduledTaskHandlers() {
  const rows = [];
  for (const handler of CORE_HANDLERS.values()) rows.push({ ...handler, handler: undefined });
  for (const pkgMap of PACKAGE_HANDLERS.values()) {
    for (const handler of pkgMap.values()) rows.push({ ...handler, handler: undefined });
  }
  return rows.sort((left, right) => String(left.taskKey).localeCompare(String(right.taskKey)));
}

function clearScheduledTaskHandlersForTests() {
  CORE_HANDLERS.clear();
  PACKAGE_HANDLERS.clear();
}

module.exports = {
  CORE_PACKAGE,
  registerCoreScheduledTaskHandler,
  registerPackageScheduledTaskHandler,
  getScheduledTaskHandler,
  listRegisteredScheduledTaskHandlers,
  clearScheduledTaskHandlersForTests
};
