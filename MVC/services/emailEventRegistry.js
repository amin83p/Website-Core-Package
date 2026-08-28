'use strict';

const { freezeEvent, cloneEvent, includeEvent, toEventKey } = require('../../config/emailEventCatalogCore');

const PACKAGE_EVENTS = new Map();

function normalizePackageName(value = '') {
  return String(value || '').trim().toUpperCase();
}

function registerPackageEmailEvents(packageName = '', events = []) {
  const pkg = normalizePackageName(packageName);
  if (!pkg) throw new Error('packageName is required to register email events.');
  const rows = Array.isArray(events) ? events : [];
  const frozen = rows.map((event) => freezeEvent({
    ...event,
    packageName: normalizePackageName(event?.packageName || pkg)
  }));
  PACKAGE_EVENTS.set(pkg, Object.freeze(frozen));
  return frozen.length;
}

function listPackageEmailEvents(packageName = '', options = {}) {
  const pkg = normalizePackageName(packageName);
  if (!pkg) return [];
  return (PACKAGE_EVENTS.get(pkg) || [])
    .filter((event) => includeEvent(event, options))
    .map((event) => cloneEvent(event));
}

function listAllRegisteredPackageEvents(options = {}) {
  const rows = [];
  for (const pkg of PACKAGE_EVENTS.keys()) {
    rows.push(...listPackageEmailEvents(pkg, options));
  }
  return rows;
}

function getRegisteredPackageNames() {
  return Array.from(PACKAGE_EVENTS.keys()).sort();
}

function clearPackageEmailEventsForTests() {
  PACKAGE_EVENTS.clear();
}

module.exports = {
  registerPackageEmailEvents,
  listPackageEmailEvents,
  listAllRegisteredPackageEvents,
  getRegisteredPackageNames,
  clearPackageEmailEventsForTests
};
