/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const { resolveDataBackendConfig } = require('../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../MVC/infrastructure/runtime/dataBackendRuntime');

const ROOT_DIR = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'packages', 'school', 'package.manifest.json');
const JSON_DATA_DIR = path.join(ROOT_DIR, 'data');
const SCHOOL_ACCESS_NAME_PATTERN = /^SCHOOL_/i;

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function parseArgs(argv = []) {
  const args = new Set(argv);
  return {
    apply: args.has('--apply'),
    json: args.has('--json'),
    help: args.has('--help') || args.has('-h')
  };
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeName(value = '') {
  return cleanText(value, 220).toUpperCase();
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function normalizeMongoDocument(row = null) {
  if (!row || typeof row !== 'object') return null;
  const { _id, ...rest } = row;
  if (!rest.id && _id) rest.id = String(_id);
  return rest;
}

function inferDbNameFromUri(uri = '') {
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    return pathname.includes('/') ? pathname.split('/')[0] : pathname;
  } catch (_) {
    return '';
  }
}

function resolveMongoConfig(activeBackend = {}) {
  const uri = cleanText(activeBackend?.mongo?.uri || process.env.MONGODB_URI || process.env.MONGO_URI, 4000);
  const dbName = cleanText(process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app', 200);
  return { uri, dbName };
}

function loadMongoDriver() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require('mongodb');
  } catch (error) {
    throw new Error(`MongoDB driver is not available. Install dependencies first. Original: ${error.message}`);
  }
}

function stableSortByName(rows = []) {
  return [...rows].sort((left, right) => {
    const leftName = normalizeName(left?.name);
    const rightName = normalizeName(right?.name);
    if (leftName !== rightName) return leftName.localeCompare(rightName);
    return cleanText(left?.id, 120).localeCompare(cleanText(right?.id, 120));
  });
}

function stableSortAccesses(rows = []) {
  return [...rows].sort((left, right) => {
    const leftName = normalizeName(left?.name);
    const rightName = normalizeName(right?.name);
    if (leftName !== rightName) return leftName.localeCompare(rightName);
    return cleanText(left?.orgId, 120).localeCompare(cleanText(right?.orgId, 120))
      || cleanText(left?.id, 120).localeCompare(cleanText(right?.id, 120));
  });
}

function hasPackageOwnership(row = {}, packageId = 'school') {
  return normalizePackageId(row?.packageId || row?.package?.packageId || row?.package?.id || row?.metadata?.packageId) === packageId;
}

function isSchoolSection(row = {}) {
  return normalizeName(row?.name).startsWith('SCHOOL');
}

function isSchoolAccess(row = {}) {
  return SCHOOL_ACCESS_NAME_PATTERN.test(cleanText(row?.name, 220)) || hasPackageOwnership(row, 'school');
}

function sanitizeOperation(row = {}) {
  const id = cleanText(row?.id || row?.operationId, 120);
  if (!id) return null;
  return {
    id,
    sessionAttempts: Number.isInteger(row?.sessionAttempts) ? row.sessionAttempts : 5,
    sessionTime: Number.isInteger(row?.sessionTime) ? row.sessionTime : 15,
    active: row?.active !== false
  };
}

function sanitizeAccessOperation(row = {}) {
  const operationId = cleanText(row?.operationId || row?.id, 120);
  if (!operationId) return null;
  const out = {
    operationId,
    scopeId: cleanText(row?.scopeId, 120) || null
  };
  if (Object.prototype.hasOwnProperty.call(row, 'maxAttemptsPerSession')) {
    out.maxAttemptsPerSession = Number.isInteger(row.maxAttemptsPerSession) ? row.maxAttemptsPerSession : null;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'maxSessionDurationMinutes')) {
    out.maxSessionDurationMinutes = Number.isInteger(row.maxSessionDurationMinutes) ? row.maxSessionDurationMinutes : null;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'maxFetchUploadVolumeKB')) {
    out.maxFetchUploadVolumeKB = Number.isInteger(row.maxFetchUploadVolumeKB) ? row.maxFetchUploadVolumeKB : null;
  }
  return out;
}

function sanitizeAccessSection(row = {}) {
  const sectionId = cleanText(row?.sectionId || row?.id, 120);
  if (!sectionId) return null;
  return {
    sectionId,
    adminAccess: row?.adminAccess === true,
    operations: Array.isArray(row?.operations)
      ? row.operations.map(sanitizeAccessOperation).filter(Boolean)
      : []
  };
}

function sanitizeSectionRef(row = {}) {
  const id = cleanText(row?.id || row?.sectionId, 120);
  if (!id) return null;
  return { id };
}

function sanitizeSectionForManifest(row = {}) {
  const name = normalizeName(row?.name);
  if (!name) return null;
  return {
    id: cleanText(row?.id, 120) || undefined,
    name,
    category: normalizeName(row?.category) || 'SCHOOL',
    description: cleanText(row?.description, 1200) || `${name} section`,
    active: row?.active !== false,
    trackState: row?.trackState !== false,
    minimumAccessRequirement: Number.isInteger(row?.minimumAccessRequirement) ? row.minimumAccessRequirement : 5,
    dashboardDisplay: row?.dashboardDisplay === true,
    mainDashboardDisplay: row?.mainDashboardDisplay === true,
    navigatorSection: row?.navigatorSection === true,
    homeURL: cleanText(row?.homeURL, 600),
    inactiveMessage: cleanText(row?.inactiveMessage, 600),
    message: cleanText(row?.message, 600),
    operations: Array.isArray(row?.operations) ? row.operations.map(sanitizeOperation).filter(Boolean) : [],
    subsections: Array.isArray(row?.subsections) ? row.subsections.map(sanitizeSectionRef).filter(Boolean) : [],
    related: Array.isArray(row?.related) ? row.related : [],
    adoptExisting: true
  };
}

function sanitizeAccessForManifest(row = {}) {
  const name = normalizeName(row?.name);
  if (!name) return null;
  const out = {
    id: cleanText(row?.id, 120) || undefined,
    name,
    orgId: row?.orgId === undefined || row?.orgId === null || row?.orgId === ''
      ? null
      : cleanText(row.orgId, 120),
    description: cleanText(row?.description, 1200) || `${name} school access profile`,
    active: row?.active !== false,
    fullAdmin: row?.fullAdmin === true,
    adminCategories: Array.isArray(row?.adminCategories)
      ? row.adminCategories.map((item) => cleanText(item, 180)).filter(Boolean)
      : [],
    validity: {
      startDate: row?.validity?.startDate || null,
      endDate: row?.validity?.endDate || null
    },
    sections: Array.isArray(row?.sections) ? row.sections.map(sanitizeAccessSection).filter(Boolean) : [],
    adoptExisting: true
  };
  return out;
}

async function loadBackendRows(activeBackend) {
  if (activeBackend.mode === 'mongo') {
    const { uri, dbName } = resolveMongoConfig(activeBackend);
    if (!uri) throw new Error('Mongo backend is active but MONGODB_URI is not configured.');
    const { MongoClient } = loadMongoDriver();
    const client = new MongoClient(uri, {
      maxPoolSize: 2,
      minPoolSize: 0,
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000)
    });
    await client.connect();
    try {
      const db = client.db(dbName);
      const [sections, accesses, packageRegistry, transactions] = await Promise.all([
        db.collection('sections').find({ name: /^SCHOOL/i }).toArray(),
        db.collection('accesses').find({
          $or: [
            { name: /^SCHOOL_/i },
            { packageId: 'school' },
            { 'package.id': 'school' },
            { 'package.packageId': 'school' },
            { 'metadata.packageId': 'school' }
          ]
        }).toArray(),
        db.collection('packageRegistries').find({ packageId: 'school' }).sort({ updatedAt: -1 }).limit(1).toArray(),
        db.collection('packageLifecycleTransactions').find({ packageId: 'school' }).sort({ startedAt: -1, updatedAt: -1 }).limit(5).toArray()
      ]);
      return {
        source: 'mongo',
        sections: sections.map(normalizeMongoDocument).filter(Boolean),
        accesses: accesses.map(normalizeMongoDocument).filter(Boolean),
        packageRegistry: packageRegistry.map(normalizeMongoDocument).filter(Boolean),
        transactions: transactions.map(normalizeMongoDocument).filter(Boolean)
      };
    } finally {
      await client.close();
    }
  }

  return {
    source: 'json',
    sections: readJsonFile(path.join(JSON_DATA_DIR, 'sections.json'), []).filter(isSchoolSection),
    accesses: readJsonFile(path.join(JSON_DATA_DIR, 'accesses.json'), []).filter(isSchoolAccess),
    packageRegistry: readJsonFile(path.join(JSON_DATA_DIR, 'packageRegistry.json'), [])
      .filter((row) => normalizePackageId(row?.packageId) === 'school'),
    transactions: readJsonFile(path.join(JSON_DATA_DIR, 'packageLifecycleTransactions.json'), [])
      .filter((row) => normalizePackageId(row?.packageId) === 'school')
  };
}

function diffNames(liveRows = [], manifestRows = []) {
  const liveNames = new Set(liveRows.map((row) => normalizeName(row?.name)).filter(Boolean));
  const manifestNames = new Set(manifestRows.map((row) => normalizeName(row?.name)).filter(Boolean));
  return {
    missingInManifest: [...liveNames].filter((name) => !manifestNames.has(name)).sort(),
    missingInBackend: [...manifestNames].filter((name) => !liveNames.has(name)).sort()
  };
}

function buildAccessOrgMismatchRows(liveAccesses = [], manifestAccesses = []) {
  const manifestByName = new Map(manifestAccesses.map((row) => [normalizeName(row?.name), row]));
  return stableSortAccesses(liveAccesses).map((live) => {
    const manifest = manifestByName.get(normalizeName(live?.name));
    if (!manifest) return null;
    const liveOrg = live?.orgId === undefined || live?.orgId === null ? '' : cleanText(live.orgId, 120);
    const manifestOrg = manifest?.orgId === undefined || manifest?.orgId === null ? '' : cleanText(manifest.orgId, 120);
    if (liveOrg === manifestOrg) return null;
    return {
      name: normalizeName(live?.name),
      backendOrgId: liveOrg || 'GLOBAL',
      manifestOrgId: manifestOrg || 'GLOBAL'
    };
  }).filter(Boolean);
}

function summarizeTransaction(row = {}) {
  return {
    id: cleanText(row?.id || row?.transactionId, 160),
    action: cleanText(row?.action, 80),
    status: cleanText(row?.status, 80),
    phase: cleanText(row?.phase, 80),
    startedAt: cleanText(row?.startedAt || row?.createdAt || row?.audit?.createDateTime, 80),
    finishedAt: cleanText(row?.finishedAt || row?.updatedAt || row?.audit?.lastUpdateDateTime, 80),
    summaryByEntity: row?.summaryByEntity || null,
    warnings: Array.isArray(row?.warnings) ? row.warnings : []
  };
}

function buildUpdatedManifest(manifest = {}, liveRows = {}) {
  return {
    ...manifest,
    sections: stableSortByName(liveRows.sections)
      .map(sanitizeSectionForManifest)
      .filter(Boolean),
    accesses: stableSortAccesses(liveRows.accesses)
      .map(sanitizeAccessForManifest)
      .filter(Boolean)
  };
}

async function runAudit(argv = [], runtimeOptions = {}) {
  const options = parseArgs(argv);
  const emit = runtimeOptions.emit !== false;
  if (options.help) {
    if (emit) {
      console.log('Usage: node scripts/school/audit-school-package-manifest.js [--apply] [--json]');
      console.log('Default mode audits active backend and prints a report. Use --apply to rewrite packages/school/package.manifest.json from backend rows.');
    }
    return { help: true };
  }

  loadLocalEnvFile();
  const backend = options.json
    ? { ...resolveDataBackendConfig({ ...process.env, DATA_BACKEND: 'json' }), mode: 'json' }
    : resolveDataBackendConfig(process.env);
  setActiveDataBackendConfig(backend);

  const manifest = readJsonFile(MANIFEST_PATH, {});
  const manifestSections = Array.isArray(manifest.sections) ? manifest.sections : [];
  const manifestAccesses = Array.isArray(manifest.accesses) ? manifest.accesses : [];
  let liveRows = null;

  try {
    liveRows = await loadBackendRows(backend);
    const liveSections = stableSortByName(liveRows.sections.filter(isSchoolSection));
    const liveAccesses = stableSortAccesses(liveRows.accesses.filter(isSchoolAccess));
    const sectionDiff = diffNames(liveSections, manifestSections);
    const accessDiff = diffNames(liveAccesses, manifestAccesses);
    const accessOrgMismatches = buildAccessOrgMismatchRows(liveAccesses, manifestAccesses);
    const latestRegistry = liveRows.packageRegistry[0] || null;
    const latestTransactions = liveRows.transactions.map(summarizeTransaction);
    const nextManifest = buildUpdatedManifest(manifest, { sections: liveSections, accesses: liveAccesses });
    const changed = JSON.stringify(manifest.sections || []) !== JSON.stringify(nextManifest.sections)
      || JSON.stringify(manifest.accesses || []) !== JSON.stringify(nextManifest.accesses);

    if (options.apply) {
      if (!liveSections.length) throw new Error('No backend School sections were found; refusing to rewrite manifest.');
      writeManifest(nextManifest);
    }

    const report = {
      activeBackend: backend.mode,
      source: liveRows.source,
      applied: options.apply,
      manifestChanged: changed,
      counts: {
        backendSections: liveSections.length,
        manifestSections: manifestSections.length,
        backendAccesses: liveAccesses.length,
        manifestAccesses: manifestAccesses.length
      },
      sections: sectionDiff,
      accesses: accessDiff,
      accessOrgMismatches,
      packageRegistry: latestRegistry ? {
        packageId: latestRegistry.packageId,
        version: latestRegistry.version,
        enabled: latestRegistry.enabled,
        installStatus: latestRegistry.installStatus,
        updatedAt: latestRegistry.updatedAt || latestRegistry.audit?.lastUpdateDateTime || ''
      } : null,
      latestTransactions
    };

    if (emit) console.log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    throw error;
  }
}

if (require.main === module) {
  runAudit(process.argv.slice(2)).catch((error) => {
    console.error(`[SCHOOL_MANIFEST_AUDIT][ERROR] ${error?.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  runAudit,
  sanitizeSectionForManifest,
  sanitizeAccessForManifest,
  buildUpdatedManifest
};
