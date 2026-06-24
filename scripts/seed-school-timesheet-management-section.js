/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '..');
const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const PARENT_SECTION = { id: '225382', name: 'SCHOOL_ACCOUNTING' };

const SECTION_DEFINITIONS = Object.freeze([
  {
    id: '445568',
    name: 'SCHOOL_TIMESHEETS',
    homeURL: '/school/timesheets/my-timesheets',
    description: 'Review and submit teacher and staff timesheets, including controlled edits and approvals.',
    symbol: {
      id: 'SYM_SYSTEM_047',
      value: 'bi bi-clock-history'
    },
    insertAfterSectionId: '445567',
    operations: ['OP1002', 'OP1003', 'OP1005', 'OP1001', 'OP1004']
  },
  {
    id: '445579',
    name: 'SCHOOL_TIMESHEET_MANAGEMENT',
    homeURL: '/school/timesheets/manage',
    description: 'Manage period-level timesheet rosters and review department hour summaries for teacher and staff timesheets.',
    symbol: {
      id: 'SYM_SYSTEM_123',
      value: 'bi bi-table'
    },
    insertAfterSectionId: '445568',
    operations: ['OP1002', 'OP1003']
  }
]);

function buildOperations(operationIds = []) {
  return operationIds.map((id) => ({ id, sessionAttempts: 5, sessionTime: 15, active: true }));
}

function buildSectionDoc(definition) {
  return {
    id: definition.id,
    name: definition.name,
    category: 'SCHOOL',
    description: definition.description,
    active: true,
    trackState: true,
    minimumAccessRequirement: 1,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection: false,
    homeURL: definition.homeURL,
    inactiveMessage: '',
    message: '',
    operations: buildOperations(definition.operations),
    subsections: [],
    related: [],
    adoptExisting: true
  };
}

function buildSymbolDoc(definition, sectionId = definition.id) {
  return {
    id: definition.symbol.id,
    name: definition.name,
    type: 'class',
    value: definition.symbol.value,
    tags: [definition.name, String(sectionId || definition.id)],
    orgId: 'SYSTEM',
    adoptExisting: true
  };
}

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function parseArgs(argv) {
  const out = { uri: '', db: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if ((token === '--uri' || token === '-u') && next) {
      out.uri = next;
      i += 1;
      continue;
    }
    if ((token === '--db' || token === '-d') && next) {
      out.db = next;
      i += 1;
    }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const safe = String(uri || '').trim();
  if (!safe) return '';
  try {
    const normalized = safe.startsWith('mongodb://') || safe.startsWith('mongodb+srv://')
      ? safe
      : `mongodb://${safe}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAudit(existingAudit) {
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  return {
    createUser: String(current.createUser || ACTOR),
    createDateTime: String(current.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function mergeOperations(existingOps = [], requiredIds = []) {
  const byId = new Map();
  (Array.isArray(existingOps) ? existingOps : []).forEach((op) => {
    const id = String(op?.id || '').trim();
    if (id) byId.set(id, { ...op, id });
  });
  buildOperations(requiredIds).forEach((op) => {
    const current = byId.get(op.id);
    byId.set(op.id, current ? { ...op, ...current, active: current.active !== false } : { ...op });
  });
  return [...byId.values()];
}

async function upsertSection(sections, definition) {
  const sectionDoc = buildSectionDoc(definition);
  const existing =
    await sections.findOne({ id: definition.id }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(definition.name)}$`, 'i') } });
  const next = {
    ...sectionDoc,
    id: String(existing?.id || sectionDoc.id),
    active: existing?.active !== false,
    operations: mergeOperations(existing?.operations, definition.operations),
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : [],
    related: Array.isArray(existing?.related) ? existing.related : [],
    audit: buildAudit(existing?.audit)
  };
  if (!existing) {
    await sections.insertOne(next);
    console.log(`Inserted section ${definition.name} (${next.id}).`);
    return next;
  }
  await sections.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated section ${definition.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function upsertSymbol(symbols, definition, sectionId) {
  const symbolDoc = buildSymbolDoc(definition, sectionId);
  const existing = await symbols.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(definition.name)}$`, 'i') },
    $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
  });
  const next = {
    ...symbolDoc,
    id: symbolDoc.id,
    audit: buildAudit(existing?.audit)
  };
  if (!existing) {
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${definition.name} (${next.id}).`);
    return next;
  }
  await symbols.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${definition.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function linkUnderSchoolAccounting(sections, childSections) {
  const parent =
    await sections.findOne({ id: PARENT_SECTION.id }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(PARENT_SECTION.name)}$`, 'i') } });
  if (!parent) {
    console.warn(`WARNING: ${PARENT_SECTION.name} was not found. Add timesheet subsections manually.`);
    return;
  }

  const childIds = new Set(childSections.map((row) => String(row?.id || '').trim()).filter(Boolean));
  const normalized = [];
  (Array.isArray(parent.subsections) ? parent.subsections : []).forEach((row) => {
    const id = String(row?.id || row || '').trim();
    if (!id || childIds.has(id)) return;
    normalized.push({ id });
    SECTION_DEFINITIONS.forEach((definition) => {
      const child = childSections.find((item) => String(item?.id || '') === definition.id);
      if (child && id === definition.insertAfterSectionId && !normalized.some((item) => String(item.id) === String(child.id))) {
        normalized.push({ id: String(child.id) });
      }
    });
  });
  childSections.forEach((child) => {
    const childId = String(child?.id || '').trim();
    if (childId && !normalized.some((item) => String(item.id) === childId)) normalized.push({ id: childId });
  });

  await sections.updateOne(
    { _id: parent._id },
    {
      $set: {
        subsections: normalized,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );
  console.log(`Linked timesheet sections under ${PARENT_SECTION.name}.`);
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection('sections');
    const symbols = db.collection('symbols');
    const sectionRows = [];
    for (const definition of SECTION_DEFINITIONS) {
      // eslint-disable-next-line no-await-in-loop
      const section = await upsertSection(sections, definition);
      sectionRows.push(section);
      // eslint-disable-next-line no-await-in-loop
      await upsertSymbol(symbols, definition, section.id);
    }
    await linkUnderSchoolAccounting(sections, sectionRows);
    console.log('School timesheet access section/symbol seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`School timesheet access section/symbol seed failed: ${error.message}`);
  process.exit(1);
});