/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const ROLE_DATA_PATH = path.join(ROOT_DIR, 'data', 'roles.json');

const PARENT_SECTION = {
  id: '833850',
  name: 'SYSTEM_SECTIONS'
};

const ROLE_SECTION = {
  id: '920300',
  name: 'ROLES',
  category: 'SYSTEM',
  description: 'Manage package-aware role registry used by person and domain modules.',
  homeURL: '/roles/',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: true,
  minimumAccessRequirement: 5,
  navigatorSection: false,
  subsections: [],
  related: []
};

const ROLE_SYMBOL = {
  id: 'SYM_SYSTEM_083',
  name: 'ROLES',
  type: 'class',
  value: 'bi bi-person-badge-fill',
  tags: ['ROLES', '920300'],
  orgId: 'SYSTEM'
};

const OP_BUNDLE = [
  { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1013', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1022', sessionAttempts: 5, sessionTime: 15, active: true }
];

function loadLocalEnvFile() {
  try {
    const envPath = path.join(ROOT_DIR, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      continue;
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
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function normalizeRoleToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function dedupe(values = []) {
  return Array.from(new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean)));
}

function normalizeTags(tags = []) {
  const seen = new Set();
  const output = [];
  for (const token of Array.isArray(tags) ? tags : []) {
    const clean = String(token || '').trim();
    if (!clean) continue;
    const key = clean.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function readSeedRoles() {
  try {
    const raw = fs.readFileSync(ROLE_DATA_PATH, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error(`Unable to read roles seed file: ${error.message}`);
  }
}

function buildAudit(existingAudit = null, seedAudit = null) {
  const existing = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  const seed = seedAudit && typeof seedAudit === 'object' ? seedAudit : {};
  return {
    createUser: String(existing.createUser || seed.createUser || ACTOR),
    createDateTime: String(existing.createDateTime || seed.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function mergeOperations(existingOps = []) {
  const byId = new Map();
  for (const op of Array.isArray(existingOps) ? existingOps : []) {
    const id = String(op?.id || '').trim();
    if (!id) continue;
    byId.set(id, { ...op, id });
  }
  for (const op of OP_BUNDLE) {
    const current = byId.get(op.id);
    byId.set(op.id, current ? { ...op, ...current, active: current.active !== false } : { ...op });
  }
  const order = OP_BUNDLE.map((op) => op.id);
  return Array.from(byId.values()).sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return String(a.id).localeCompare(String(b.id));
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

async function upsertRoleSection(sections) {
  const existingById = await sections.findOne({ id: ROLE_SECTION.id });
  const existingByName = existingById
    ? null
    : await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(ROLE_SECTION.name)}$`, 'i') } });
  const existing = existingById || existingByName;

  const next = {
    ...ROLE_SECTION,
    id: String(existing?.id || ROLE_SECTION.id),
    active: existing?.active !== false,
    audit: buildAudit(existing?.audit),
    operations: mergeOperations(existing?.operations),
    related: Array.isArray(existing?.related) ? existing.related : ROLE_SECTION.related,
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : ROLE_SECTION.subsections
  };

  if (!existing) {
    await sections.insertOne(next);
    console.log(`Inserted section ${ROLE_SECTION.name} (${next.id}).`);
    return next;
  }

  await sections.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated section ${ROLE_SECTION.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function linkUnderSystemSections(sections, childSection) {
  const parentById = await sections.findOne({ id: PARENT_SECTION.id });
  const parentByName = parentById
    ? null
    : await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(PARENT_SECTION.name)}$`, 'i') } });
  const parent = parentById || parentByName;

  if (!parent) {
    console.warn(
      `WARNING: ${PARENT_SECTION.name} was not found. Add subsection manually: { id: "${childSection.id}" }`
    );
    return;
  }

  const childId = String(childSection?.id || '').trim();
  const currentSubsections = Array.isArray(parent.subsections) ? parent.subsections : [];
  const normalized = currentSubsections
    .map((row) => ({ id: String(row?.id || row || '').trim() }))
    .filter((row) => row.id && row.id !== childId);
  normalized.push({ id: childId });

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

  console.log(`Linked ${ROLE_SECTION.name} (${childId}) under ${PARENT_SECTION.name}.`);
}

async function upsertRoleSymbol(symbols, sectionId) {
  const symbolDoc = {
    ...ROLE_SYMBOL,
    tags: normalizeTags([ROLE_SYMBOL.name, String(sectionId || ROLE_SECTION.id)])
  };

  const existingById = await symbols.findOne({ id: symbolDoc.id });
  const existingByName = existingById
    ? null
    : await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(symbolDoc.name)}$`, 'i') },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });
  const existing = existingById || existingByName;

  const next = {
    ...symbolDoc,
    id: String(existing?.id || symbolDoc.id),
    orgId: 'SYSTEM',
    tags: normalizeTags(symbolDoc.tags),
    audit: buildAudit(existing?.audit)
  };

  if (!existing) {
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${symbolDoc.name} (${next.id}).`);
    return next;
  }

  await symbols.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${symbolDoc.name} (${next.id}).`);
  return { ...existing, ...next };
}

function normalizeRoleSeedRow(raw = {}) {
  const key = normalizeRoleToken(raw.key || '');
  if (!key) return null;
  const packageName = String(raw.packageName || '').trim().toUpperCase();
  if (!packageName) return null;
  return {
    id: String(raw.id || '').trim(),
    key,
    label: String(raw.label || key).trim() || key,
    description: String(raw.description || '').trim(),
    domain: normalizeRoleToken(raw.domain || 'core') || 'core',
    packageName,
    aliases: dedupe((Array.isArray(raw.aliases) ? raw.aliases : []).map(normalizeRoleToken).filter(Boolean))
      .filter((alias) => alias !== key),
    active: raw.active !== false,
    system: raw.system === true,
    audit: buildAudit(null, raw.audit)
  };
}

async function seedRolesCollection(rolesCollection) {
  const seeds = readSeedRoles()
    .map((row) => normalizeRoleSeedRow(row))
    .filter(Boolean);

  if (!seeds.length) {
    console.warn('No role seeds found to apply.');
    return;
  }

  let inserted = 0;
  let updated = 0;
  for (const seed of seeds) {
    const existingById = seed.id ? await rolesCollection.findOne({ id: seed.id }) : null;
    const existingByKey = existingById
      ? null
      : await rolesCollection.findOne({ key: { $regex: new RegExp(`^${escapeRegex(seed.key)}$`, 'i') } });
    const existing = existingById || existingByKey;

    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await rolesCollection.insertOne(seed);
      inserted += 1;
      continue;
    }

    const next = {
      ...seed,
      id: String(existing.id || seed.id || '').trim() || seed.id,
      audit: buildAudit(existing.audit, seed.audit)
    };
    // eslint-disable-next-line no-await-in-loop
    await rolesCollection.updateOne({ _id: existing._id }, { $set: next });
    updated += 1;
  }

  console.log(`Roles seed applied. Inserted: ${inserted}, Updated: ${updated}, Total seed rows: ${seeds.length}.`);
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI).trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');

  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sectionRow = await upsertRoleSection(db.collection('sections'));
    await linkUnderSystemSections(db.collection('sections'), sectionRow);
    await upsertRoleSymbol(db.collection('symbols'), sectionRow.id);
    await seedRolesCollection(db.collection('roles'));
    console.log('Role section/symbol/registry seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Role section seed failed: ${error.message}`);
  process.exit(1);
});
