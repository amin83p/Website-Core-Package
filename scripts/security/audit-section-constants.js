'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadSectionsCatalog(repoRoot) {
  const jsonPath = path.join(repoRoot, 'data', 'sections.json');
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const byName = new Map();
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.name || '').trim();
    const id = String(row.id || '').trim();
    if (name) byName.set(name.toUpperCase(), row);
    if (id) byId.set(id, row);
  }
  return { byName, byId, rows };
}

function extractSectionConstantsFromSource(source, constName = 'SECTIONS') {
  const values = [];
  const blockMatch = source.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!blockMatch) return values;
  const body = blockMatch[1];
  const pairPattern = /[A-Za-z0-9_]+\s*:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pairPattern.exec(body)) !== null) {
    values.push(String(match[1] || '').trim());
  }
  return values;
}

function resolveSectionToken(token, catalog) {
  const raw = String(token || '').trim();
  if (!raw) return { resolved: false, reason: 'empty' };
  if (catalog.byId.has(raw)) return { resolved: true, via: 'id', row: catalog.byId.get(raw) };
  if (catalog.byName.has(raw.toUpperCase())) return { resolved: true, via: 'name', row: catalog.byName.get(raw.toUpperCase()) };
  return { resolved: false, reason: `no section id or name match for '${raw}'` };
}

function loadSectionConstantExceptions(repoRoot) {
  const filePath = path.join(repoRoot, 'scripts', 'security', 'section-constant-exceptions.json');
  if (!fs.existsSync(filePath)) return new Set();
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const list = Array.isArray(raw.allowedUnresolved) ? raw.allowedUnresolved : [];
  return new Set(list.map((t) => String(t || '').trim()));
}

function auditSectionConstants(repoRoot) {
  const catalog = loadSectionsCatalog(repoRoot);
  const exceptions = loadSectionConstantExceptions(repoRoot);
  const sources = [
    { label: 'core', file: path.join(repoRoot, 'config', 'accessConstants.js') }
  ];

  const packagesRoot = path.join(repoRoot, 'packages');
  if (fs.existsSync(packagesRoot)) {
    for (const pkg of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const candidate = path.join(packagesRoot, pkg.name, 'config', 'accessConstants.js');
      if (fs.existsSync(candidate)) {
        sources.push({ label: pkg.name, file: candidate });
      }
    }
  }

  const mismatches = [];
  const checked = [];

  for (const source of sources) {
    const content = fs.readFileSync(source.file, 'utf8');
    const tokens = extractSectionConstantsFromSource(content);
    const unique = [...new Set(tokens)];
    for (const token of unique) {
      const result = resolveSectionToken(token, catalog);
      checked.push({ source: source.label, token, ...result });
      if (!result.resolved && !exceptions.has(token)) {
        mismatches.push({ source: source.label, token, reason: result.reason });
      }
    }
  }

  return { checked, mismatches, ok: mismatches.length === 0 };
}

if (require.main === module) {
  const repoRoot = path.join(__dirname, '..', '..');
  const report = auditSectionConstants(repoRoot);
  console.log(`Checked ${report.checked.length} SECTIONS constant values.`);
  if (report.mismatches.length) {
    console.log('Unresolved SECTIONS values:');
    report.mismatches.forEach((row) => {
      console.log(`  [${row.source}] ${row.token} — ${row.reason}`);
    });
    process.exit(1);
  }
  console.log('All SECTIONS values resolve in sections catalog.');
  process.exit(0);
}

module.exports = { auditSectionConstants, resolveSectionToken, extractSectionConstantsFromSource };