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

const CLONE_ACCESS_FROM_SECTION_ID = '920210';
const PROVIDERS_SECTION_ID = '920214';

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

const TEMPLATE_SECTION_DOC = {
  id: '920210',
  name: 'EMAIL_TEMPLATES',
  category: 'SECURITY',
  description: 'Manage operation-linked email templates with strict placeholders and org scope.',
  homeURL: '/email-management/templates',
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
};

const LEDGER_SECTION_DOC = {
  id: '920212',
  name: 'EMAIL_LEDGER',
  category: 'SECURITY',
  description: 'View outbound email history and delivery responses logged by the system.',
  homeURL: '/email-management/ledger',
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
};

const PROVIDERS_SECTION_DOC = {
  id: '920214',
  name: 'EMAIL_PROVIDERS',
  category: 'SECURITY',
  description: 'Manage encrypted org-scoped email provider profiles and verified sender domains.',
  homeURL: '/email-management/providers',
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
};

const PARENT_SECTION_DOC = {
  id: '920200',
  name: 'EMAIL_MANAGEMENT',
  category: 'SECURITY',
  description: 'Navigator for Email Templates, Provider Profiles, and Email Ledger sections.',
  homeURL: '/dashboard/section-nav/EMAIL_MANAGEMENT',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: false,
  minimumAccessRequirement: 5,
  navigatorSection: true,
  subsections: [],
  related: [],
  operations: []
};

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

async function findSectionByName(collection, sectionName = '') {
  return collection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(sectionName)}$`, 'i') }
  });
}

async function upsertSection(collection, doc) {
  const existingById = await collection.findOne({ id: String(doc.id || '') });
  const existingByName = existingById ? null : await findSectionByName(collection, doc.name);
  const existing = existingById || existingByName;

  if (!existing) {
    const next = { ...doc, audit: buildAudit(null) };
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

async function attachParentUnderFramework(sections, parentRow, childRows) {
  const framework =
    await sections.findOne({ id: SYSTEM_FRAMEWORK.id, name: SYSTEM_FRAMEWORK.name })
    || await sections.findOne({ name: SYSTEM_FRAMEWORK.name, navigatorSection: true });

  if (!framework) {
    console.warn(
      `WARNING: ${SYSTEM_FRAMEWORK.name} was not found. Add subsection manually: { id: "${parentRow.id}" }`
    );
    return;
  }

  const parentId = String(parentRow?.id || '');
  const childIdSet = new Set(
    (Array.isArray(childRows) ? childRows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );

  const currentSubsections = Array.isArray(framework.subsections) ? framework.subsections : [];
  const normalizedSubsections = currentSubsections
    .map((row) => ({ id: String(row?.id || row || '').trim() }))
    .filter((row) => row.id)
    .filter((row) => !childIdSet.has(row.id) && row.id !== parentId);
  normalizedSubsections.push({ id: parentId });

  await sections.updateOne(
    { _id: framework._id },
    {
      $set: {
        subsections: normalizedSubsections,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );

  console.log(`Linked EMAIL_MANAGEMENT (${parentId}) under ${SYSTEM_FRAMEWORK.name} and removed direct child links.`);
}

async function grantProvidersAccessFromTemplates(accesses) {
  const profiles = await accesses.find({ 'sections.sectionId': CLONE_ACCESS_FROM_SECTION_ID }).toArray();
  let updated = 0;
  for (const profile of profiles) {
    const sampleGrant = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === CLONE_ACCESS_FROM_SECTION_ID);
    const operations = Array.isArray(sampleGrant?.operations) && sampleGrant.operations.length
      ? sampleGrant.operations
      : OP_BUNDLE.map((row) => row.id);
    const adminAccess = sampleGrant?.adminAccess === true;
    const existing = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === PROVIDERS_SECTION_ID);
    if (existing) {
      await accesses.updateOne(
        { _id: profile._id, 'sections.sectionId': PROVIDERS_SECTION_ID },
        {
          $set: {
            'sections.$.adminAccess': adminAccess,
            'sections.$.operations': operations,
            updatedAt: new Date(),
            updatedBy: 'system'
          }
        }
      );
    } else {
      await accesses.updateOne(
        { _id: profile._id },
        {
          $push: { sections: { sectionId: PROVIDERS_SECTION_ID, adminAccess, operations } },
          $set: { updatedAt: new Date(), updatedBy: 'system' }
        }
      );
    }
    updated += 1;
  }
  if (!updated) {
    console.warn(`WARNING: No access profiles with ${CLONE_ACCESS_FROM_SECTION_ID}; grant ${PROVIDERS_SECTION_ID} manually.`);
  } else {
    console.log(`Granted EMAIL_PROVIDERS access on ${updated} profile(s) cloned from EMAIL_TEMPLATES.`);
  }
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
    const accesses = db.collection('accesses');

    const templateRow = await upsertSection(sections, TEMPLATE_SECTION_DOC);
    const ledgerRow = await upsertSection(sections, LEDGER_SECTION_DOC);
    const providersRow = await upsertSection(sections, PROVIDERS_SECTION_DOC);

    const parentRow = await upsertSection(sections, {
      ...PARENT_SECTION_DOC,
      subsections: [
        { id: String(templateRow.id) },
        { id: String(ledgerRow.id) },
        { id: String(providersRow.id) }
      ]
    });

    await attachParentUnderFramework(sections, parentRow, [templateRow, ledgerRow, providersRow]);
    await grantProvidersAccessFromTemplates(accesses);
    console.log('Email Management section seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Email Management section seed failed: ${error.message}`);
  process.exit(1);
});
