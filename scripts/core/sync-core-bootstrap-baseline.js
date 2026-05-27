#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const BASELINE_DIR = path.join(DATA_DIR, 'bootstrap', 'core');

const CORE_SECTION_CATEGORIES = new Set([
  'SYSTEM',
  'SECURITY',
  'LOGGING',
  'GENERAL',
  'DATA',
  'ORGANIZATION'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function cleanToken(value) {
  return String(value || '').trim();
}

function normalizeToken(value) {
  return cleanToken(value).toUpperCase();
}

function toId(ref) {
  if (ref && typeof ref === 'object') return cleanToken(ref.id);
  return cleanToken(ref);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bumpPatch(version = '1.0.0') {
  const token = cleanToken(version);
  const parts = token.split('.');
  if (parts.length !== 3) return token || '1.0.0';
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return token || '1.0.0';
  }
  return `${major}.${minor}.${patch + 1}`;
}

function ensureScopesUnderSystemSections(sectionRows = []) {
  const rows = Array.isArray(sectionRows) ? sectionRows : [];
  const out = clone(rows);
  const systemSectionsRow = out.find((row) => normalizeToken(row?.name) === 'SYSTEM_SECTIONS');
  const scopesRow = out.find((row) => normalizeToken(row?.name) === 'SCOPES');
  if (!systemSectionsRow || !scopesRow) return { rows: out, changed: false };

  const scopeId = cleanToken(scopesRow.id);
  if (!scopeId) return { rows: out, changed: false };

  const original = Array.isArray(systemSectionsRow.subsections) ? systemSectionsRow.subsections : [];
  const normalized = [];
  const seen = new Set();
  let hasScopes = false;

  for (const ref of original) {
    const id = toId(ref);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id });
    if (id === scopeId) hasScopes = true;
  }

  if (!hasScopes) normalized.push({ id: scopeId });
  const changed = JSON.stringify(original) !== JSON.stringify(normalized);
  systemSectionsRow.subsections = normalized;
  return { rows: out, changed };
}

function buildCoreSections(liveSections = []) {
  const rows = Array.isArray(liveSections) ? liveSections : [];
  const filtered = rows.filter((row) => CORE_SECTION_CATEGORIES.has(normalizeToken(row?.category)));
  const ensured = ensureScopesUnderSystemSections(filtered);
  return ensured.rows;
}

function collectOperationIdsFromSections(sectionRows = [], existingBaselineOperationRows = []) {
  const ids = new Set();
  for (const section of Array.isArray(sectionRows) ? sectionRows : []) {
    const ops = Array.isArray(section?.operations) ? section.operations : [];
    for (const op of ops) {
      const id = toId(op);
      if (id) ids.add(id);
    }
  }

  const baselineRows = Array.isArray(existingBaselineOperationRows) ? existingBaselineOperationRows : [];
  for (const row of baselineRows) {
    const name = normalizeToken(row?.name);
    if (name === 'START' || name === 'SAVE') {
      const id = cleanToken(row?.id);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function pickSymbolCandidateByName(liveSymbols = [], name = '') {
  const token = normalizeToken(name);
  if (!token) return null;
  const matches = liveSymbols.filter((row) => normalizeToken(row?.name) === token);
  if (!matches.length) return null;
  const systemMatch = matches.find((row) => normalizeToken(row?.orgId) === 'SYSTEM');
  return systemMatch || matches[0];
}

function buildCoreBaseline({
  liveSections = [],
  liveOperations = [],
  liveRoles = [],
  liveScopes = [],
  liveSymbols = [],
  liveAccesses = [],
  baselineOperationsCurrent = [],
  baselineSymbolsCurrent = []
}) {
  const baselineSections = buildCoreSections(liveSections);
  const coreSectionNames = new Set(baselineSections.map((row) => normalizeToken(row?.name)).filter(Boolean));

  const opIds = collectOperationIdsFromSections(baselineSections, baselineOperationsCurrent);
  const baselineOperations = liveOperations.filter((row) => opIds.has(cleanToken(row?.id)));

  const baselineRoles = liveRoles.filter((row) => normalizeToken(row?.packageName) === 'CORE');
  const baselineScopes = clone(liveScopes);

  const baselineAccesses = liveAccesses.filter((row) => {
    const name = normalizeToken(row?.name);
    const fullAdmin = Boolean(row?.fullAdmin);
    return name === 'ADMIN' && fullAdmin;
  });

  const targetSymbolIds = new Set(
    (Array.isArray(baselineSymbolsCurrent) ? baselineSymbolsCurrent : [])
      .map((row) => cleanToken(row?.id))
      .filter(Boolean)
  );
  for (const name of coreSectionNames) {
    const match = pickSymbolCandidateByName(liveSymbols, name);
    const id = cleanToken(match?.id);
    if (id) targetSymbolIds.add(id);
  }
  const baselineSymbols = liveSymbols.filter((row) => targetSymbolIds.has(cleanToken(row?.id)));

  return {
    sections: baselineSections,
    operations: baselineOperations,
    roles: baselineRoles,
    scopes: baselineScopes,
    symbols: baselineSymbols,
    accesses: baselineAccesses
  };
}

function parseArgs(argv = []) {
  const tokens = Array.isArray(argv) ? argv.map((row) => cleanToken(row).toLowerCase()) : [];
  return {
    apply: tokens.includes('--apply')
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const livePaths = {
    sections: path.join(DATA_DIR, 'sections.json'),
    operations: path.join(DATA_DIR, 'operations.json'),
    roles: path.join(DATA_DIR, 'roles.json'),
    scopes: path.join(DATA_DIR, 'scopes.json'),
    symbols: path.join(DATA_DIR, 'symbols.json'),
    accesses: path.join(DATA_DIR, 'accesses.json')
  };

  const baselinePaths = {
    manifest: path.join(BASELINE_DIR, 'manifest.json'),
    sections: path.join(BASELINE_DIR, 'sections.json'),
    operations: path.join(BASELINE_DIR, 'operations.json'),
    roles: path.join(BASELINE_DIR, 'roles.json'),
    scopes: path.join(BASELINE_DIR, 'scopes.json'),
    symbols: path.join(BASELINE_DIR, 'symbols.json'),
    accesses: path.join(BASELINE_DIR, 'accesses.json')
  };

  const liveSectionsRaw = readJson(livePaths.sections);
  const liveSectionsScoped = ensureScopesUnderSystemSections(liveSectionsRaw);

  const liveRows = {
    sections: liveSectionsScoped.rows,
    operations: readJson(livePaths.operations),
    roles: readJson(livePaths.roles),
    scopes: readJson(livePaths.scopes),
    symbols: readJson(livePaths.symbols),
    accesses: readJson(livePaths.accesses)
  };

  const baselineCurrent = {
    manifest: readJson(baselinePaths.manifest),
    sections: readJson(baselinePaths.sections),
    operations: readJson(baselinePaths.operations),
    roles: readJson(baselinePaths.roles),
    scopes: readJson(baselinePaths.scopes),
    symbols: readJson(baselinePaths.symbols),
    accesses: readJson(baselinePaths.accesses)
  };

  const baselineTarget = buildCoreBaseline({
    liveSections: liveRows.sections,
    liveOperations: liveRows.operations,
    liveRoles: liveRows.roles,
    liveScopes: liveRows.scopes,
    liveSymbols: liveRows.symbols,
    liveAccesses: liveRows.accesses,
    baselineOperationsCurrent: baselineCurrent.operations,
    baselineSymbolsCurrent: baselineCurrent.symbols
  });

  const drift = {
    liveSectionsScopeLink: liveSectionsScoped.changed,
    baselineSections: JSON.stringify(baselineCurrent.sections) !== JSON.stringify(baselineTarget.sections),
    baselineOperations: JSON.stringify(baselineCurrent.operations) !== JSON.stringify(baselineTarget.operations),
    baselineRoles: JSON.stringify(baselineCurrent.roles) !== JSON.stringify(baselineTarget.roles),
    baselineScopes: JSON.stringify(baselineCurrent.scopes) !== JSON.stringify(baselineTarget.scopes),
    baselineSymbols: JSON.stringify(baselineCurrent.symbols) !== JSON.stringify(baselineTarget.symbols),
    baselineAccesses: JSON.stringify(baselineCurrent.accesses) !== JSON.stringify(baselineTarget.accesses)
  };

  const hasBaselineDrift = Object.entries(drift)
    .filter(([key]) => key !== 'liveSectionsScopeLink')
    .some(([, value]) => Boolean(value));
  const hasDrift = hasBaselineDrift || drift.liveSectionsScopeLink;

  const summary = {
    mode: args.apply ? 'apply' : 'check',
    hasDrift,
    drift,
    counts: {
      sections: baselineTarget.sections.length,
      operations: baselineTarget.operations.length,
      roles: baselineTarget.roles.length,
      scopes: baselineTarget.scopes.length,
      symbols: baselineTarget.symbols.length,
      accesses: baselineTarget.accesses.length
    }
  };

  if (args.apply) {
    if (drift.liveSectionsScopeLink) {
      writeJson(livePaths.sections, liveRows.sections);
    }
    if (drift.baselineSections) writeJson(baselinePaths.sections, baselineTarget.sections);
    if (drift.baselineOperations) writeJson(baselinePaths.operations, baselineTarget.operations);
    if (drift.baselineRoles) writeJson(baselinePaths.roles, baselineTarget.roles);
    if (drift.baselineScopes) writeJson(baselinePaths.scopes, baselineTarget.scopes);
    if (drift.baselineSymbols) writeJson(baselinePaths.symbols, baselineTarget.symbols);
    if (drift.baselineAccesses) writeJson(baselinePaths.accesses, baselineTarget.accesses);

    if (hasBaselineDrift) {
      const nextManifest = clone(baselineCurrent.manifest);
      nextManifest.generatedAt = new Date().toISOString();
      nextManifest.version = bumpPatch(nextManifest.version || '1.0.0');
      writeJson(baselinePaths.manifest, nextManifest);
      summary.manifestVersion = nextManifest.version;
    } else {
      summary.manifestVersion = baselineCurrent.manifest.version;
    }
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!args.apply && hasDrift) process.exit(1);
}

main();
