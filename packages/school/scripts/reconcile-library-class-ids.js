/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const ASSIGNMENTS_PATH = path.join(ROOT_DIR, 'data/school/bookAssignments.json');
const COVERING_PATH = path.join(ROOT_DIR, 'data/school/bookCoveringReports.json');

function parseArgs(argv) {
  const out = { dryRun: true, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (token === '--apply') { out.apply = true; out.dryRun = false; continue; }
    if (token === '--dry-run') { out.dryRun = true; out.apply = false; }
  }
  return out;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(String(fs.readFileSync(filePath, 'utf8') || '[]').replace(/^\uFEFF/, '') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function pickCanonicalAssignment(rows) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const active = rows.filter((row) => String(row.status || '').toLowerCase() === 'active');
  const pool = active.length ? active : rows;
  return pool.slice().sort((a, b) => {
    const ta = String(a?.audit?.lastUpdateDateTime || a?.audit?.createDateTime || '');
    const tb = String(b?.audit?.lastUpdateDateTime || b?.audit?.createDateTime || '');
    return tb.localeCompare(ta);
  })[0];
}

function groupAssignments(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.orgId}::${row.classId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const assignments = readJson(ASSIGNMENTS_PATH);
  const covering = readJson(COVERING_PATH);
  const groups = groupAssignments(assignments);

  let duplicateGroups = 0;
  let staleEntryRows = 0;

  groups.forEach((rows, key) => {
    if (rows.length > 1) {
      duplicateGroups += 1;
      const canonical = pickCanonicalAssignment(rows);
      console.log(`[duplicate assignment] ${key} count=${rows.length} canonical=${canonical?.id}`);
    }
  });

  groups.forEach((rows) => {
    const canonical = pickCanonicalAssignment(rows);
    const canonicalId = String(canonical?.id || '');
    if (!canonicalId) return;
    covering.forEach((report) => {
      if (String(report.classId) !== String(canonical.classId)) return;
      if (String(report.orgId) !== String(canonical.orgId)) return;
      (Array.isArray(report.entries) ? report.entries : []).forEach((entry) => {
        if (String(entry.bookAssignmentId || '') !== canonicalId) staleEntryRows += 1;
      });
    });
  });

  console.log(`Duplicate class assignment groups: ${duplicateGroups}`);
  console.log(`Covering entries with non-canonical bookAssignmentId: ${staleEntryRows}`);
  if (args.dryRun) {
    console.log('Dry run only. Pass --apply to rewrite JSON (not implemented in dry-run scaffold).');
    return;
  }
  console.log('Use migrate-book-assignments-to-class-docs.js for apply workflows; this script reports only.');
}

main();
