/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

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

const SECTION_SEEDS = Object.freeze({
  BENCHPATH: {
    id: '775100',
    name: 'BENCHPATH',
    category: 'BENCHPATH',
    description: 'BenchPath dashboard and reference data management root section.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: true,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    operations: [],
    related: [],
    subsections: []
  },
  BENCHPATH_REFERENCE: {
    id: '554656',
    name: 'BENCHPATH_REFERENCE',
    category: 'BENCHPATH',
    description: 'Navigator for BenchPath reference entities.',
    homeURL: '',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: false,
    minimumAccessRequirement: 5,
    navigatorSection: true,
    operations: [],
    related: [],
    subsections: []
  },
  BENCHPATH_SOURCES: {
    id: '775101',
    name: 'BENCHPATH_SOURCES',
    category: 'BENCHPATH',
    description: 'Manage BenchPath reference sources.',
    homeURL: '/benchpath/sources',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_SOURCE_FRAGMENTS: {
    id: '775102',
    name: 'BENCHPATH_SOURCE_FRAGMENTS',
    category: 'BENCHPATH',
    description: 'Manage BenchPath source fragments.',
    homeURL: '/benchpath/source-fragments',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_FRAMEWORK: {
    id: '775103',
    name: 'BENCHPATH_CLB_FRAMEWORK',
    category: 'BENCHPATH',
    description: 'Manage CLB framework definitions in BenchPath.',
    homeURL: '/benchpath/clb-framework',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_STAGES: {
    id: '775104',
    name: 'BENCHPATH_CLB_STAGES',
    category: 'BENCHPATH',
    description: 'Manage CLB stage definitions in BenchPath.',
    homeURL: '/benchpath/clb-stages',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_SKILLS: {
    id: '775105',
    name: 'BENCHPATH_CLB_SKILLS',
    category: 'BENCHPATH',
    description: 'Manage CLB skill definitions in BenchPath.',
    homeURL: '/benchpath/clb-skills',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_COMPETENCY_AREAS: {
    id: '775106',
    name: 'BENCHPATH_CLB_COMPETENCY_AREAS',
    category: 'BENCHPATH',
    description: 'Manage CLB competency areas in BenchPath.',
    homeURL: '/benchpath/clb-competency-areas',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_BENCHMARKS: {
    id: '775107',
    name: 'BENCHPATH_CLB_BENCHMARKS',
    category: 'BENCHPATH',
    description: 'Manage CLB benchmark records in BenchPath.',
    homeURL: '/benchpath/clb-benchmarks',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_COMPETENCIES: {
    id: '775108',
    name: 'BENCHPATH_CLB_COMPETENCIES',
    category: 'BENCHPATH',
    description: 'Manage CLB competency records in BenchPath.',
    homeURL: '/benchpath/clb-competencies',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_INDICATORS: {
    id: '775109',
    name: 'BENCHPATH_CLB_INDICATORS',
    category: 'BENCHPATH',
    description: 'Manage CLB indicator records in BenchPath.',
    homeURL: '/benchpath/clb-indicators',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_PROFILE_OF_ABILITY: {
    id: '775110',
    name: 'BENCHPATH_CLB_PROFILE_OF_ABILITY',
    category: 'BENCHPATH',
    description: 'Manage CLB profile-of-ability records in BenchPath.',
    homeURL: '/benchpath/clb-profile-of-ability',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_FEATURES_OF_COMMUNICATION: {
    id: '775111',
    name: 'BENCHPATH_CLB_FEATURES_OF_COMMUNICATION',
    category: 'BENCHPATH',
    description: 'Manage CLB features-of-communication records in BenchPath.',
    homeURL: '/benchpath/clb-features-of-communication',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_CLB_SAMPLE_TASK_LABELS: {
    id: '775112',
    name: 'BENCHPATH_CLB_SAMPLE_TASK_LABELS',
    category: 'BENCHPATH',
    description: 'Manage CLB sample task labels in BenchPath.',
    homeURL: '/benchpath/clb-sample-task-labels',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  },
  BENCHPATH_TASK_AUTHORING: {
    id: '775113',
    name: 'BENCHPATH_TASK_AUTHORING',
    category: 'BENCHPATH',
    description: 'Generate and manage CLB/PBLA-aligned teacher-authored tasks with the BenchPath wizard.',
    homeURL: '/benchpath/tasks',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    operations: OP_BUNDLE,
    related: [],
    subsections: []
  }
});

const ROOT_REQUIRED_NAMES = Object.freeze([
  'BENCHPATH_REFERENCE',
  'BENCHPATH_TASK_AUTHORING'
]);

const REFERENCE_REQUIRED_NAMES = Object.freeze([
  'BENCHPATH_SOURCES',
  'BENCHPATH_SOURCE_FRAGMENTS',
  'BENCHPATH_CLB_FRAMEWORK',
  'BENCHPATH_CLB_STAGES',
  'BENCHPATH_CLB_SKILLS',
  'BENCHPATH_CLB_COMPETENCY_AREAS',
  'BENCHPATH_CLB_BENCHMARKS',
  'BENCHPATH_CLB_COMPETENCIES',
  'BENCHPATH_CLB_INDICATORS',
  'BENCHPATH_CLB_PROFILE_OF_ABILITY',
  'BENCHPATH_CLB_FEATURES_OF_COMMUNICATION',
  'BENCHPATH_CLB_SAMPLE_TASK_LABELS'
]);

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

function buildAudit(existingAudit) {
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  return {
    createUser: String(current.createUser || ACTOR),
    createDateTime: String(current.createDateTime || NOW),
    lastUpdateUser: ACTOR,
    lastUpdateDateTime: NOW
  };
}

async function findSectionByName(sectionsCollection, name = '') {
  const token = String(name || '').trim();
  if (!token) return null;
  return sectionsCollection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(token)}$`, 'i') }
  });
}

async function upsertSectionByName(sectionsCollection, doc) {
  const existing = await findSectionByName(sectionsCollection, doc.name);

  if (!existing) {
    const next = { ...doc, audit: buildAudit(null) };
    await sectionsCollection.insertOne(next);
    console.log(`Inserted section ${next.name} (${next.id}).`);
    return next;
  }

  const next = {
    ...doc,
    id: String(existing.id || doc.id),
    audit: buildAudit(existing.audit)
  };
  await sectionsCollection.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated section ${next.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function repairSubsectionRefs(sectionsCollection, refs = []) {
  const output = [];
  const seen = new Set();
  for (const ref of Array.isArray(refs) ? refs : []) {
    const id = String(ref?.id || '').trim();
    if (!id || seen.has(id)) continue;
    // eslint-disable-next-line no-await-in-loop
    const resolved = await sectionsCollection.findOne({ id });
    if (!resolved || !resolved.id) continue;
    seen.add(id);
    output.push({ id });
  }
  return output;
}

async function resolveIdByNameMap(sectionsCollection, names = []) {
  const map = new Map();
  for (const name of Array.isArray(names) ? names : []) {
    // eslint-disable-next-line no-await-in-loop
    const section = await findSectionByName(sectionsCollection, name);
    const id = String(section?.id || '').trim();
    if (id) map.set(String(name), id);
  }
  return map;
}

function appendMissingRefs(baseRefs = [], ids = []) {
  const out = Array.isArray(baseRefs) ? baseRefs.slice() : [];
  const seen = new Set(out.map((row) => String(row?.id || '').trim()).filter(Boolean));
  for (const id of Array.isArray(ids) ? ids : []) {
    const token = String(id || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({ id: token });
  }
  return out;
}

async function updateSectionSubsectionsByName(sectionsCollection, sectionName, nextSubsections = []) {
  const section = await findSectionByName(sectionsCollection, sectionName);
  if (!section) return false;

  const sectionDoc = { ...section };
  delete sectionDoc._id;
  await sectionsCollection.updateOne(
    { _id: section._id },
    {
      $set: {
        ...sectionDoc,
        subsections: Array.isArray(nextSubsections) ? nextSubsections : [],
        audit: buildAudit(section.audit)
      }
    }
  );
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = String(
    args.uri
    || process.env.MONGODB_URI
    || process.env.MONGO_URI
  ).trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');

  const dbName = String(
    args.db
    || process.env.MONGODB_DB
    || process.env.MONGO_DB
    || inferDbNameFromUri(uri)
    || 'app'
  ).trim();

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection('sections');

    for (const seed of Object.values(SECTION_SEEDS)) {
      // eslint-disable-next-line no-await-in-loop
      await upsertSectionByName(sections, seed);
    }

    const idByName = await resolveIdByNameMap(sections, [
      ...ROOT_REQUIRED_NAMES,
      ...REFERENCE_REQUIRED_NAMES
    ]);

    const root = await findSectionByName(sections, 'BENCHPATH');
    if (root) {
      const repairedRefs = await repairSubsectionRefs(sections, root.subsections || []);
      const requiredIds = ROOT_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextRefs = appendMissingRefs(repairedRefs, requiredIds);
      const updated = await updateSectionSubsectionsByName(sections, 'BENCHPATH', nextRefs);
      if (updated) {
        console.log(`Repaired BENCHPATH subsections. total=${nextRefs.length}`);
      }
    }

    const reference = await findSectionByName(sections, 'BENCHPATH_REFERENCE');
    if (reference) {
      const repairedRefs = await repairSubsectionRefs(sections, reference.subsections || []);
      const requiredIds = REFERENCE_REQUIRED_NAMES
        .map((name) => idByName.get(name))
        .filter(Boolean);
      const nextRefs = appendMissingRefs(repairedRefs, requiredIds);
      const updated = await updateSectionSubsectionsByName(sections, 'BENCHPATH_REFERENCE', nextRefs);
      if (updated) {
        console.log(`Repaired BENCHPATH_REFERENCE subsections. total=${nextRefs.length}`);
      }
    }

    console.log('BenchPath sections upsert + relationship repair complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`BenchPath sections seed failed: ${error.message}`);
  process.exit(1);
});

