'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const CATEGORY_OVERRIDES = Object.freeze({
  school: 'SCHOOL',
  pte: 'PTE',
  ielts: 'IELTS',
  benchpath: 'BENCHPATH',
  credit: 'CREDIT',
  activity: 'ACTIVITY'
});

function normalizePathToken(filePath = '') {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function listInstalledPackageFolderNames() {
  const packagesDir = path.join(PROJECT_ROOT, 'packages');
  try {
    return fs.readdirSync(packagesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name.toLowerCase());
  } catch (_) {
    return [];
  }
}

function mapPathToPackage(filePath = '', options = {}) {
  const token = normalizePathToken(filePath);
  if (!token) return '';
  const installed = new Set(
    (Array.isArray(options.installedPackages) ? options.installedPackages : listInstalledPackageFolderNames())
      .map((name) => String(name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const pkgMatch = token.match(/^packages\/([^/]+)\//i);
  if (pkgMatch) {
    const folder = String(pkgMatch[1] || '').trim().toLowerCase();
    const override = CATEGORY_OVERRIDES[folder];
    if (override) return override;
    if (installed.has(folder)) return folder.toUpperCase();
    return folder.toUpperCase();
  }

  if (/^data\/school\//i.test(token)) return 'SCHOOL';

  if (/^(MVC|config|public|scripts|test)\//i.test(token)) return 'CORE';
  if (/^data\//i.test(token) && !/^data\/school\//i.test(token)) return 'CORE';

  return '';
}

function groupFilePathsByPackage(filePaths = [], options = {}) {
  const paths = Array.isArray(filePaths) ? filePaths : [];
  const installed = listInstalledPackageFolderNames();
  const groups = new Map();
  for (const raw of paths) {
    const pkg = mapPathToPackage(raw, { ...options, installedPackages: installed });
    if (!pkg) continue;
    if (!groups.has(pkg)) groups.set(pkg, []);
    groups.get(pkg).push(normalizePathToken(raw));
  }
  for (const [, files] of groups) {
    files.sort((a, b) => a.localeCompare(b));
  }
  return groups;
}

function splitCommitFilesIntoPackageBuckets(filePaths = []) {
  const groups = groupFilePathsByPackage(filePaths);
  return [...groups.entries()].map(([packageName, files]) => ({
    packageName,
    files
  }));
}

function listKnownPackageNames() {
  const fromFolders = listInstalledPackageFolderNames().map((name) => {
    const override = CATEGORY_OVERRIDES[name];
    return override || name.toUpperCase();
  });
  const set = new Set(['CORE', ...fromFolders]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function suggestCollectionsFromFiles(filePaths = []) {
  const hints = new Set();
  const registry = require('./migration/jsonToMongoMigrationService');
  const sources = typeof registry?.buildCatalog === 'function' ? registry.buildCatalog() : [];
  const bySource = new Map();
  for (const def of sources) {
    const source = String(def?.source || '').trim();
    const collection = String(def?.collection || '').trim();
    if (!source || !collection) continue;
    bySource.set(source.toLowerCase(), collection);
  }
  for (const filePath of filePaths) {
    const token = normalizePathToken(filePath);
    const base = path.basename(token).toLowerCase();
    if (bySource.has(base)) {
      hints.add(bySource.get(base));
      continue;
    }
    const dataMatch = token.match(/data\/(?:school\/)?([^/]+\.json)$/i);
    if (dataMatch) {
      const jsonName = dataMatch[1].toLowerCase();
      if (bySource.has(jsonName)) hints.add(bySource.get(jsonName));
    }
  }
  return [...hints].sort();
}

module.exports = {
  normalizePathToken,
  mapPathToPackage,
  groupFilePathsByPackage,
  splitCommitFilesIntoPackageBuckets,
  listKnownPackageNames,
  listInstalledPackageFolderNames,
  suggestCollectionsFromFiles
};