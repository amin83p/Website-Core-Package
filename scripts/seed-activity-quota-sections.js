/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

const SYSTEM_FRAMEWORK = {
  id: '273755',
  name: 'SYSTEM_FRAMEWORK'
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

const docs = [
  {
    id: '920101',
    name: 'ACTIVITY_QUOTA_OVERVIEW',
    category: 'SECURITY',
    description: 'Overview dashboard for activity quota balances, trends, and availability.',
    homeURL: '/activity-quota/overview',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920106',
    name: 'ACTIVITY_QUOTA_CREDIT_CHECK',
    category: 'SECURITY',
    description: 'User-facing credit check view for remaining balances and consumption history.',
    homeURL: '/activity-quota/credit-check',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920102',
    name: 'ACTIVITY_QUOTA_LEDGER',
    category: 'SECURITY',
    description: 'Ledger list for activity quota credit and consumption records.',
    homeURL: '/activity-quota/ledger',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920103',
    name: 'ACTIVITY_QUOTA_RULES',
    category: 'SECURITY',
    description: 'Activity quota consumption definition and resolution rules.',
    homeURL: '/activity-quota/rules',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920104',
    name: 'ACTIVITY_QUOTA_ADD_CREDIT',
    category: 'SECURITY',
    description: 'Add or adjust user credit allocations in the activity quota ledger.',
    homeURL: '/activity-quota/add-credit',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920105',
    name: 'ACTIVITY_QUOTA_PACKAGE',
    category: 'SECURITY',
    description: 'Package catalog for reusable activity quota configurations.',
    homeURL: '/activity-quota/packages',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  },
  {
    id: '920107',
    name: 'ACTIVITY_QUOTA_PACKAGE_MANAGER',
    category: 'SECURITY',
    description: 'Generic role-gated package assignment manager for user-level quota package lifecycle.',
    homeURL: '/activity-quota/package-manager',
    message: '',
    inactiveMessage: '',
    active: true,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    trackState: true,
    minimumAccessRequirement: 5,
    navigatorSection: false,
    subsections: [],
    related: [],
    operations: OP_BUNDLE
  }
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const out = {
    uri: '',
    db: ''
  };
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

async function upsertSectionByName(collection, doc) {
  const existing = await collection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(doc.name)}$`, 'i') }
  });

  if (!existing) {
    const next = {
      ...doc,
      audit: buildAudit(null)
    };
    await collection.insertOne(next);
    console.log(`Inserted section ${doc.name} (${doc.id}).`);
    return next;
  }

  const next = {
    ...doc,
    id: String(existing.id || doc.id),
    audit: buildAudit(existing.audit)
  };

  await collection.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated section ${doc.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = String(
    args.uri
    || process.env.MONGODB_URI
    || process.env.MONGO_URI
  ).trim();

  if (!uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

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

    const upsertedChildren = [];
    for (const doc of docs) {
      // eslint-disable-next-line no-await-in-loop
      const row = await upsertSectionByName(sections, doc);
      upsertedChildren.push(row);
    }

    const parentSeed = {
      id: '920100',
      name: 'ACTIVITY_QUOTA',
      category: 'SECURITY',
      description: 'Navigator for Activity Quota management, ledger visibility, and quota rules.',
      homeURL: '',
      message: '',
      inactiveMessage: '',
      active: true,
      dashboardDisplay: true,
      mainDashboardDisplay: false,
      trackState: false,
      minimumAccessRequirement: 5,
      navigatorSection: true,
      subsections: upsertedChildren.map((row) => ({ id: String(row.id) })),
      related: [],
      operations: []
    };

    const parent = await upsertSectionByName(sections, parentSeed);

    const framework =
      await sections.findOne({ id: SYSTEM_FRAMEWORK.id, name: SYSTEM_FRAMEWORK.name })
      || await sections.findOne({ name: SYSTEM_FRAMEWORK.name, navigatorSection: true });

    if (!framework) {
      console.warn(
        `WARNING: ${SYSTEM_FRAMEWORK.name} was not found. Add subsection manually: { id: "${parent.id}" }`
      );
    } else {
      const subs = Array.isArray(framework.subsections) ? framework.subsections : [];
      const hasParent = subs.some((row) => row && String(row.id || '') === String(parent.id));
      if (hasParent) {
        console.log(`${SYSTEM_FRAMEWORK.name} already references ACTIVITY_QUOTA (${parent.id}).`);
      } else {
        const updateResult = await sections.updateOne(
          { _id: framework._id },
          { $push: { subsections: { id: String(parent.id) } } }
        );
        console.log(
          `Linked ACTIVITY_QUOTA (${parent.id}) under ${SYSTEM_FRAMEWORK.name}. matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`
        );
      }
    }

    console.log('Activity Quota seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Activity Quota seed failed: ${error.message}`);
  process.exit(1);
});
