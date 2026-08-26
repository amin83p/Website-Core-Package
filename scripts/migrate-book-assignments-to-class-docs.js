/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT_DIR, 'data/school/bookAssignments.json');
const COVERING_PATH = path.join(ROOT_DIR, 'data/school/bookCoveringReports.json');
const ACTOR = 'SYS_ROOT_001';

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

function parseArgs(argv) {
  const out = { uri: '', db: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if (token === '--dry-run') { out.dryRun = true; continue; }
    if ((token === '--uri' || token === '-u') && next) { out.uri = next; i += 1; continue; }
    if ((token === '--db' || token === '-d') && next) { out.db = next; i += 1; }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const safe = String(uri || '').trim();
  if (!safe) return '';
  try {
    const normalized = safe.startsWith('mongodb://') || safe.startsWith('mongodb+srv://') ? safe : `mongodb://${safe}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function isLegacyRow(row = {}) {
  const bookId = String(row?.bookId || '').trim();
  const hasBooks = Array.isArray(row?.books) && row.books.length > 0;
  return Boolean(bookId) && !hasBooks;
}

function collapseRows(rows = []) {
  const groups = new Map();
  const idMap = new Map();

  for (const row of rows) {
    const orgId = String(row?.orgId || '').trim();
    const classId = String(row?.classId || '').trim();
    if (!orgId || !classId) continue;

    const key = `${orgId}::${classId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: String(row?.id || '').trim(),
        orgId,
        classId,
        status: String(row?.status || 'active').trim().toLowerCase(),
        notes: String(row?.notes || '').trim(),
        books: [],
        audit: row?.audit || {}
      });
    }
    const group = groups.get(key);

    if (isLegacyRow(row)) {
      const oldId = String(row.id || '').trim();
      const bookId = String(row.bookId || '').trim();
      if (!bookId) continue;
      const sortOrder = Number(row.sortOrder || 0) || 100;
      const existing = group.books.find((b) => String(b.bookId) === bookId);
      if (!existing) {
        group.books.push({
          bookId,
          sortOrder,
          notes: String(row.notes || '').trim(),
          status: ['active', 'inactive'].includes(String(row.status || '').toLowerCase())
            ? String(row.status).toLowerCase()
            : 'active'
        });
      } else if (sortOrder < existing.sortOrder) {
        existing.sortOrder = sortOrder;
      }
      if (oldId) {
        idMap.set(oldId, { parentId: group.id, bookId, classId, orgId });
      }
      if (!group.id && oldId) group.id = oldId;
    } else if (Array.isArray(row.books)) {
      group.id = String(row.id || group.id || '').trim();
      group.status = String(row.status || group.status || 'active').trim().toLowerCase();
      group.notes = String(row.notes || group.notes || '').trim();
      group.audit = row.audit || group.audit;
      for (const book of row.books) {
        const bookId = String(book?.bookId || '').trim();
        if (!bookId) continue;
        if (!group.books.some((b) => String(b.bookId) === bookId)) {
          group.books.push({
            bookId,
            sortOrder: Number(book.sortOrder || 0) || 100,
            notes: String(book?.notes || '').trim(),
            status: ['active', 'inactive'].includes(String(book?.status || '').toLowerCase())
              ? String(book.status).toLowerCase()
              : 'active'
          });
        }
      }
    }
  }

  const collapsed = [...groups.values()].map((group) => {
    group.books.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    if (!group.id) {
      const year = new Date().getFullYear();
      const random = Math.random().toString(36).slice(2, 8).toUpperCase();
      group.id = `BKASG-${year}-${random}`;
    }
    const now = new Date().toISOString();
    group.audit = {
      createUser: String(group.audit?.createUser || ACTOR),
      createDateTime: String(group.audit?.createDateTime || now),
      lastUpdateUser: ACTOR,
      lastUpdateDateTime: now
    };
    return group;
  });

  return { collapsed, idMap };
}

function remapCoveringReports(reports = [], idMap = new Map()) {
  if (!idMap.size) return reports;
  return reports.map((report) => {
    const entries = Array.isArray(report?.entries) ? report.entries : [];
    const nextEntries = entries.map((entry) => {
      const oldId = String(entry?.bookAssignmentId || '').trim();
      if (!oldId || !idMap.has(oldId)) return entry;
      const mapped = idMap.get(oldId);
      if (String(entry?.bookId || '') && String(entry.bookId) !== String(mapped.bookId)) return entry;
      return { ...entry, bookAssignmentId: mapped.parentId };
    });
    return { ...report, entries: nextEntries };
  });
}

async function migrateJson(dryRun) {
  if (!fs.existsSync(DATA_PATH)) {
    console.log('No bookAssignments.json file; skipping JSON migration.');
    return { collapsed: [], idMap: new Map() };
  }
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8').replace(/^\uFEFF/, '') || '[]');
  const rows = Array.isArray(raw) ? raw : [];
  const { collapsed, idMap } = collapseRows(rows);
  console.log(`JSON: ${rows.length} row(s) -> ${collapsed.length} class assignment(s).`);
  if (!dryRun) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(collapsed, null, 2));
    if (fs.existsSync(COVERING_PATH)) {
      const coveringRaw = JSON.parse(fs.readFileSync(COVERING_PATH, 'utf8').replace(/^\uFEFF/, '') || '[]');
      const reports = Array.isArray(coveringRaw) ? coveringRaw : [];
      const remapped = remapCoveringReports(reports, idMap);
      fs.writeFileSync(COVERING_PATH, JSON.stringify(remapped, null, 2));
      console.log(`Updated ${COVERING_PATH} bookAssignmentId references.`);
    }
  }
  return { collapsed, idMap };
}

async function migrateMongo(db, dryRun) {
  const col = db.collection('schoolBookAssignments');
  const rows = await col.find({}).toArray();
  const { collapsed, idMap } = collapseRows(rows);
  console.log(`Mongo: ${rows.length} row(s) -> ${collapsed.length} class assignment(s).`);
  if (dryRun) return { collapsed, idMap };

  await col.deleteMany({});
  if (collapsed.length) await col.insertMany(collapsed);

  const coveringCol = db.collection('schoolBookCoveringReports');
  const reports = await coveringCol.find({}).toArray();
  if (reports.length && idMap.size) {
    for (const report of reports) {
      const entries = remapCoveringReports([report], idMap)[0]?.entries;
      await coveringCol.updateOne({ _id: report._id }, { $set: { entries } });
    }
    console.log('Updated Mongo bookCoveringReports bookAssignmentId references.');
  }
  return { collapsed, idMap };
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  const dbName = String(args.db || process.env.MONGODB_DB || inferDbNameFromUri(uri) || 'app').trim();

  await migrateJson(args.dryRun);

  if (uri) {
    const client = new MongoClient(uri);
    await client.connect();
    try {
      await migrateMongo(client.db(dbName), args.dryRun);
    } finally {
      await client.close();
    }
  } else {
    console.log('Mongo URI not set; JSON migration only.');
  }

  if (args.dryRun) console.log('Dry run complete — no files or Mongo collections modified.');
  else console.log('Book assignment migration complete.');
}

module.exports = {
  collapseRows,
  isLegacyRow,
  remapCoveringReports
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  });
}
