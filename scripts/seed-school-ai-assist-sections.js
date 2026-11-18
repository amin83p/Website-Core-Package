/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const PARENT = {
  id: '446200',
  name: 'SCHOOL_AI_ASSIST',
  description: 'Navigator for School AI provider keys, service routing, token usage, and per-user quotas.',
  homeURL: '/dashboard/section-nav/SCHOOL_AI_ASSIST',
  symbolId: 'SYM_SCHOOL_AI_ASSIST_001',
  icon: 'bi bi-robot',
  subsectionIds: ['446210', '446211', '446212', '446213']
};

const CHILDREN = [
  {
    id: '446210',
    name: 'SCHOOL_AI_PROVIDER_KEYS',
    description: 'Org-wide AI vendor API keys with models and banned users.',
    homeURL: '/school/ai-assist/providers',
    symbolId: 'SYM_SCHOOL_AI_PROVIDER_KEYS_001',
    icon: 'bi bi-key-fill',
    operations: ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005']
  },
  {
    id: '446211',
    name: 'SCHOOL_AI_SERVICE_ASSIGNMENTS',
    description: 'Map registered school AI services to provider keys and models.',
    homeURL: '/school/ai-assist/service-assignments',
    symbolId: 'SYM_SCHOOL_AI_SERVICE_ASSIGNMENTS_001',
    icon: 'bi bi-sliders',
    operations: ['OP1001', 'OP1003']
  },
  {
    id: '446212',
    name: 'SCHOOL_AI_TOKEN_USAGE',
    description: 'Audit log of school AI token consumption (Consumed Tokens).',
    homeURL: '/school/ai-assist/token-usage',
    symbolId: 'SYM_SCHOOL_AI_TOKEN_USAGE_001',
    icon: 'bi bi-cpu-fill',
    operations: ['OP1001', 'OP1003', 'OP1004', 'OP1005']
  },
  {
    id: '446213',
    name: 'SCHOOL_AI_USAGE_LIMITS',
    description: 'Per-user token and request caps for school AI services.',
    homeURL: '/school/ai-assist/token-usage/limits',
    symbolId: 'SYM_SCHOOL_AI_USAGE_LIMITS_001',
    icon: 'bi bi-shield-check',
    operations: ['OP1001', 'OP1003', 'OP1004', 'OP1005']
  }
];

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) continue;
    const key = text.slice(0, index).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = text.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function parseArgs(argv) {
  const result = { uri: '', db: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (['--uri', '-u'].includes(argv[index])) result.uri = argv[++index] || '';
    else if (['--db', '-d'].includes(argv[index])) result.db = argv[++index] || '';
  }
  return result;
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

function audit(existing = {}) {
  return {
    createUser: existing.createUser || ACTOR,
    createDateTime: existing.createDateTime || NOW,
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

function mergeOperations(existing = [], wanted = []) {
  const rows = new Map((Array.isArray(existing) ? existing : []).map((row) => [String(row?.id || ''), row]));
  wanted.forEach((id) => {
    rows.set(id, {
      id,
      sessionAttempts: 10,
      sessionTime: 30,
      active: rows.get(id)?.active !== false,
      ...(rows.get(id) || {})
    });
  });
  return [...rows.values()].filter((row) => row.id);
}

function buildSectionPayload(def, existing, { navigatorSection = false, trackState = true, subsections = [] }) {
  return {
    id: def.id,
    name: def.name,
    category: 'SCHOOL',
    description: def.description,
    active: existing?.active !== false,
    trackState,
    minimumAccessRequirement: navigatorSection ? 1 : 1,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection,
    homeURL: def.homeURL,
    inactiveMessage: '',
    message: '',
    operations: mergeOperations(existing?.operations, def.operations || []),
    subsections,
    related: [],
    adoptExisting: true,
    audit: audit(existing?.audit)
  };
}

async function upsertSectionById(db, payload) {
  const sections = db.collection('sections');
  const matches = await sections.find({
    $or: [{ id: payload.id }, { name: payload.name }]
  }).toArray();
  const existing = matches.find((row) => String(row?.id || '') === payload.id) || matches[0] || null;
  if (existing) await sections.updateOne({ _id: existing._id }, { $set: payload });
  else await sections.insertOne(payload);
  return payload;
}

const TOKEN_USAGE_SECTION_ID = '446212';
const USAGE_LIMITS_SECTION_ID = '446213';
const TOKEN_USAGE_SECTION_NAME = 'SCHOOL_AI_TOKEN_USAGE';
const USAGE_LIMITS_SECTION_NAME = 'SCHOOL_AI_USAGE_LIMITS';

function grantSectionKey(row = {}) {
  return String(row?.sectionId || row?.id || row?.sectionName || row?.name || '').trim();
}

function isTokenUsageGrant(row = {}) {
  const key = grantSectionKey(row).toUpperCase();
  return key === TOKEN_USAGE_SECTION_ID || key === TOKEN_USAGE_SECTION_NAME;
}

function isUsageLimitsGrant(row = {}) {
  const key = grantSectionKey(row).toUpperCase();
  return key === USAGE_LIMITS_SECTION_ID || key === USAGE_LIMITS_SECTION_NAME;
}

async function mirrorUsageLimitsAccessGrants(db) {
  const accesses = db.collection('accesses');
  const profiles = await accesses.find({}).toArray();
  let updatedProfiles = 0;

  for (const profile of profiles) {
    let changed = false;

    if (Array.isArray(profile.sectionGrants) && profile.sectionGrants.length) {
      const grants = [...profile.sectionGrants];
      const source = grants.find((row) => isTokenUsageGrant(row));
      const targetIndex = grants.findIndex((row) => isUsageLimitsGrant(row));
      if (source) {
        const cloned = {
          ...source,
          sectionId: USAGE_LIMITS_SECTION_ID,
          sectionName: USAGE_LIMITS_SECTION_NAME,
          name: USAGE_LIMITS_SECTION_NAME
        };
        if (targetIndex >= 0) grants[targetIndex] = cloned;
        else grants.push(cloned);
        profile.sectionGrants = grants;
        changed = true;
      }
    }

    if (Array.isArray(profile.sections) && profile.sections.length) {
      const sections = [...profile.sections];
      const source = sections.find((row) => isTokenUsageGrant(row));
      const targetIndex = sections.findIndex((row) => isUsageLimitsGrant(row));
      if (source) {
        const cloned = {
          ...source,
          sectionId: USAGE_LIMITS_SECTION_ID,
          id: USAGE_LIMITS_SECTION_ID,
          sectionName: USAGE_LIMITS_SECTION_NAME,
          name: USAGE_LIMITS_SECTION_NAME
        };
        if (targetIndex >= 0) sections[targetIndex] = cloned;
        else sections.push(cloned);
        profile.sections = sections;
        changed = true;
      }
    }

    if (!changed) continue;

    await accesses.updateOne({ _id: profile._id }, {
      $set: {
        ...(Array.isArray(profile.sectionGrants) ? { sectionGrants: profile.sectionGrants } : {}),
        ...(Array.isArray(profile.sections) ? { sections: profile.sections } : {}),
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    });
    updatedProfiles += 1;
  }

  return updatedProfiles;
}

async function upsertSymbol(db, def) {
  const symbols = db.collection('symbols');
  const matches = await symbols.find({
    $or: [{ id: def.symbolId }, { name: def.name }]
  }).toArray();
  const existing = matches.find((row) => String(row?.id || '') === def.symbolId) || matches[0] || null;
  const symbol = {
    id: def.symbolId,
    name: def.name,
    type: 'class',
    value: def.icon,
    tags: [def.name, def.id],
    orgId: 'SYSTEM',
    adoptExisting: true,
    audit: audit(existing?.audit)
  };
  if (existing) await symbols.updateOne({ _id: existing._id }, { $set: symbol });
  else await symbols.insertOne(symbol);
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbName(uri) || 'app').trim();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection('sections');

    const parentBefore = await sections.findOne({ $or: [{ id: PARENT.id }, { name: PARENT.name }] });
    const beforeRefs = (parentBefore?.subsections || []).map((s) => String(s?.id || s));

    for (const child of CHILDREN) {
      const existing = await sections.findOne({ id: child.id });
      const payload = buildSectionPayload(child, existing, { navigatorSection: false, trackState: true });
      await upsertSectionById(db, payload);
      await upsertSymbol(db, child);
    }

    const parentExisting = parentBefore;
    const parentPayload = buildSectionPayload(PARENT, parentExisting, {
      navigatorSection: true,
      trackState: false,
      subsections: PARENT.subsectionIds.map((id) => ({ id })),
      operations: []
    });
    parentPayload.operations = mergeOperations(parentExisting?.operations, []);
    await upsertSectionById(db, parentPayload);
    await upsertSymbol(db, PARENT);

    const parentAfter = await sections.findOne({ id: PARENT.id });
    const afterRefs = (parentAfter?.subsections || []).map((s) => String(s?.id || s));

    const accessProfilesUpdated = await mirrorUsageLimitsAccessGrants(db);

    console.log('School AI Assist sections seeded.');
    console.log(`Parent subsections: ${beforeRefs.join(', ') || '(none)'} -> ${afterRefs.join(', ')}`);
    console.log(`Access profiles mirrored for ${USAGE_LIMITS_SECTION_ID}: ${accessProfilesUpdated}`);

    try {
      const sectionsOperationsCatalogCacheService = require('../MVC/services/cache/sectionsOperationsCatalogCacheService');
      sectionsOperationsCatalogCacheService.clearSectionsOperationsCatalogCache();
      console.log('Sections catalog cache cleared (restart app if tiles still look stale).');
    } catch (error) {
      console.warn(`Sections catalog cache not cleared: ${error.message}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`School AI Assist seed failed: ${error.message}`);
  process.exit(1);
});