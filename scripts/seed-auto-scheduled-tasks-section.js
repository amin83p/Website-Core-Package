/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');

const SYSTEM_FRAMEWORK = {
  id: '273755',
  name: 'SYSTEM_FRAMEWORK'
};

const CLONE_ACCESS_FROM_SECTION_ID = '920210';
const CLONE_ACCESS_FALLBACK_SECTION_IDS = ['920210', '920200', '920106', '273755', '442039'];
const PARENT_SECTION_ID = '920220';
const MANAGER_SECTION_ID = '920224';
const DEFINITIONS_SECTION_ID = '920221';
const RUNS_SECTION_ID = '920222';
const OUTBOX_SECTION_ID = '920223';

const SYMBOL_DOCS = [
  {
    id: 'SYM_SCHEDULED_TASK_MANAGEMENT_920220',
    name: 'SCHEDULED_TASK_MANAGEMENT',
    type: 'class',
    value: 'bi bi-calendar2-week-fill',
    tags: ['SCHEDULED_TASK_MANAGEMENT', '920220'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_AUTO_SCHEDULED_TASKS_920221',
    name: 'AUTO_SCHEDULED_TASKS',
    type: 'class',
    value: 'bi bi-list-task',
    tags: ['AUTO_SCHEDULED_TASKS', '920221'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_AUTO_SCHEDULED_TASK_RUNS_920222',
    name: 'AUTO_SCHEDULED_TASK_RUNS',
    type: 'class',
    value: 'bi bi-clock-history',
    tags: ['AUTO_SCHEDULED_TASK_RUNS', '920222'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_EMAIL_OUTBOX_920223',
    name: 'EMAIL_OUTBOX',
    type: 'class',
    value: 'bi bi-envelope-paper',
    tags: ['EMAIL_OUTBOX', '920223'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_SCHEDULED_TASK_MANAGER_920224',
    name: 'SCHEDULED_TASK_MANAGER',
    type: 'class',
    value: 'bi bi-calendar2-check',
    tags: ['SCHEDULED_TASK_MANAGER', '920224'],
    orgId: 'SYSTEM'
  }
];

const OP_BUNDLE = [
  { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1013', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1022', sessionAttempts: 5, sessionTime: 15, active: true },
  { id: 'OP1024', sessionAttempts: 5, sessionTime: 15, active: true }
];

const MANAGER_SECTION_DOC = {
  id: '920224',
  name: 'SCHEDULED_TASK_MANAGER',
  category: 'SECURITY',
  description: '24-hour upcoming and completed scheduled task overview.',
  homeURL: '/scheduled-tasks/manager',
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

const DEFINITIONS_SECTION_DOC = {
  id: '920221',
  name: 'AUTO_SCHEDULED_TASKS',
  category: 'SECURITY',
  description: 'Manage recurring scheduled task definitions across packages.',
  homeURL: '/scheduled-tasks',
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

const RUNS_SECTION_DOC = {
  id: '920222',
  name: 'AUTO_SCHEDULED_TASK_RUNS',
  category: 'SECURITY',
  description: 'View scheduled task execution history, logs, and outcomes.',
  homeURL: '/scheduled-tasks/runs',
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

const OUTBOX_SECTION_DOC = {
  id: '920223',
  name: 'EMAIL_OUTBOX',
  category: 'SECURITY',
  description: 'View queued, sent, and failed deferred emails awaiting dispatch.',
  homeURL: '/scheduled-tasks/outbox',
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
  id: '920220',
  name: 'SCHEDULED_TASK_MANAGEMENT',
  category: 'SECURITY',
  description: 'Navigator for scheduled task definitions, run history, and email outbox.',
  homeURL: '/dashboard/section-nav/SCHEDULED_TASK_MANAGEMENT',
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
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`[env] Unable to load .env file: ${error.message}`);
  }
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

  console.log(`Linked SCHEDULED_TASK_MANAGEMENT (${parentId}) under ${SYSTEM_FRAMEWORK.name}.`);
}

async function grantSectionAccessFromTemplate(accesses, sectionId, cloneSectionId = CLONE_ACCESS_FROM_SECTION_ID) {
  const profiles = await accesses.find({ 'sections.sectionId': cloneSectionId }).toArray();
  let updated = 0;
  for (const profile of profiles) {
    const sampleGrant = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === cloneSectionId);
    const operations = Array.isArray(sampleGrant?.operations) && sampleGrant.operations.length
      ? sampleGrant.operations
      : OP_BUNDLE.map((row) => row.id);
    const adminAccess = sampleGrant?.adminAccess === true;
    const existing = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === sectionId);
    if (existing) {
      await accesses.updateOne(
        { _id: profile._id, 'sections.sectionId': sectionId },
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
          $push: { sections: { sectionId, adminAccess, operations } },
          $set: { updatedAt: new Date(), updatedBy: 'system' }
        }
      );
    }
    updated += 1;
  }
  return updated;
}

async function grantSectionAccessWithFallbacks(accesses, sectionId) {
  for (const cloneSectionId of CLONE_ACCESS_FALLBACK_SECTION_IDS) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await grantSectionAccessFromTemplate(accesses, sectionId, cloneSectionId);
    if (updated > 0) {
      console.log(`Granted section ${sectionId} access on ${updated} profile(s) cloned from ${cloneSectionId}.`);
      return;
    }
  }

  const adminProfiles = await accesses.find({ fullAdmin: true }).toArray();
  let updated = 0;
  for (const profile of adminProfiles) {
    const operations = OP_BUNDLE.map((row) => row.id);
    const existing = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === sectionId);
    if (existing) {
      await accesses.updateOne(
        { _id: profile._id, 'sections.sectionId': sectionId },
        {
          $set: {
            'sections.$.adminAccess': true,
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
          $push: { sections: { sectionId, adminAccess: true, operations } },
          $set: { updatedAt: new Date(), updatedBy: 'system' }
        }
      );
    }
    updated += 1;
  }
  if (!updated) {
    console.warn(`WARNING: Could not grant section ${sectionId}; update access profiles manually.`);
  } else {
    console.log(`Granted section ${sectionId} access on ${updated} full-admin profile(s).`);
  }
}

function buildGlobalNameFilter(symbolName) {
  return {
    name: { $regex: new RegExp(`^${escapeRegex(symbolName)}$`, 'i') },
    $or: [
      { orgId: 'SYSTEM' },
      { orgId: { $exists: false } },
      { orgId: null },
      { orgId: '' }
    ]
  };
}

async function upsertSymbol(symbols, doc) {
  const existingById = await symbols.findOne({ id: String(doc.id || '') });
  const existingByName = existingById ? null : await symbols.findOne(buildGlobalNameFilter(doc.name));
  const existing = existingById || existingByName;

  if (!existing) {
    const next = { ...doc, audit: buildAudit(null) };
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${doc.name} (${doc.id}).`);
    return next;
  }

  const next = {
    ...doc,
    id: String(existing.id || doc.id),
    audit: buildAudit(existing.audit)
  };
  await symbols.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${doc.name} (${next.id}).`);
  return { ...existing, ...next };
}

async function main() {
  loadLocalEnvFile();
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
    const symbols = db.collection('symbols');

    const managerRow = await upsertSection(sections, MANAGER_SECTION_DOC);
    const definitionsRow = await upsertSection(sections, DEFINITIONS_SECTION_DOC);
    const runsRow = await upsertSection(sections, RUNS_SECTION_DOC);
    const outboxRow = await upsertSection(sections, OUTBOX_SECTION_DOC);

    const parentRow = await upsertSection(sections, {
      ...PARENT_SECTION_DOC,
      subsections: [
        { id: String(managerRow.id) },
        { id: String(definitionsRow.id) },
        { id: String(runsRow.id) },
        { id: String(outboxRow.id) }
      ]
    });

    await attachParentUnderFramework(sections, parentRow, [managerRow, definitionsRow, runsRow, outboxRow]);
    for (const sectionId of [
      PARENT_SECTION_ID,
      MANAGER_SECTION_ID,
      DEFINITIONS_SECTION_ID,
      RUNS_SECTION_ID,
      OUTBOX_SECTION_ID
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await grantSectionAccessWithFallbacks(accesses, sectionId);
    }
    for (const symbolDoc of SYMBOL_DOCS) {
      // eslint-disable-next-line no-await-in-loop
      await upsertSymbol(symbols, symbolDoc);
    }
    console.log('Auto Scheduled Tasks section seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`Auto Scheduled Tasks section seed failed: ${error.message}`);
  process.exit(1);
});
