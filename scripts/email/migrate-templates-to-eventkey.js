/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { getEmailEventBySectionOperation } = require(path.join(__dirname, '../../config/emailEventCatalog'));

const ROOT_DIR = path.resolve(__dirname, '../..');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'data', 'emailManagementTemplates.json');

function normalizeKey(value = '') {
  return String(value || '').trim().toUpperCase();
}

function loadTemplates() {
  const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

function saveTemplates(rows = []) {
  fs.writeFileSync(TEMPLATE_PATH, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
}

function resolveEventKey(row = {}) {
  const existing = normalizeKey(row.eventKey);
  if (existing) return existing;
  const event = getEmailEventBySectionOperation(row.sectionId, row.operationId, {
    includeInactive: true,
    packageName: row.packageName
  });
  if (!event?.eventKey) {
    throw new Error(`Unable to map template ${row.id || '(unknown)'} to eventKey (${row.sectionId}/${row.operationId}).`);
  }
  return normalizeKey(event.eventKey);
}

function migrateTemplates(rows = []) {
  const seen = new Set();
  const updated = [];
  let migratedCount = 0;

  rows.forEach((row) => {
    const next = { ...row };
    const eventKey = resolveEventKey(next);
    next.eventKey = eventKey;
    const uniqueKey = `${String(next.orgId || '').trim()}::${eventKey}`;
    if (seen.has(uniqueKey)) {
      throw new Error(`Duplicate template mapping detected for org/event: ${uniqueKey}`);
    }
    seen.add(uniqueKey);
    if (normalizeKey(row.eventKey) !== eventKey) migratedCount += 1;
    updated.push(next);
  });

  return { rows: updated, migratedCount };
}

function main() {
  const rows = loadTemplates();
  const { rows: updatedRows, migratedCount } = migrateTemplates(rows);
  saveTemplates(updatedRows);
  console.log(`Email template eventKey migration complete. Updated ${migratedCount} of ${rows.length} template(s).`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Email template migration failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  migrateTemplates,
  resolveEventKey
};
