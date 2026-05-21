/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

const PTE_ROOT_REF = { id: '910001', name: 'PTE' };
const PTE_PEOPLE_REF = { name: 'PTE_PEOPLE' };

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

const PTE_TESTS_SEED = {
  id: '930103',
  name: 'PTE_TESTS',
  category: 'PTE',
  description: 'Define and version PTE tests, allocating published questions across all four skills.',
  homeURL: '/pte/tests',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: true,
  minimumAccessRequirement: 5,
  navigatorSection: false,
  related: [],
  subsections: [],
  operations: OP_BUNDLE
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

async function findSectionByRef(sectionsCollection, ref = {}) {
  const id = String(ref?.id || '').trim();
  if (id) {
    const byId = await sectionsCollection.findOne({ id });
    if (byId) return byId;
  }
  const name = String(ref?.name || '').trim();
  if (!name) return null;
  return sectionsCollection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
  });
}

async function upsertSectionByName(sectionsCollection, doc) {
  const existing = await sectionsCollection.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(doc.name)}$`, 'i') }
  });

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
    // eslint-disable-next-line no-await-in-loop
    const resolved = await findSectionByRef(sectionsCollection, ref || {});
    if (!resolved || !resolved.id) continue;
    const id = String(resolved.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({ id });
  }
  return output;
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

    const child = await upsertSectionByName(sections, PTE_TESTS_SEED);
    const childId = String(child.id || '').trim();
    if (!childId) throw new Error('Failed to resolve child id for PTE_TESTS.');

    const pteRoot = await findSectionByRef(sections, PTE_ROOT_REF);
    if (!pteRoot) {
      console.warn('WARNING: PTE parent section was not found. Add subsection manually:', { id: childId });
    } else {
      const repairedRefs = await repairSubsectionRefs(sections, pteRoot.subsections || []);
      if (!repairedRefs.some((ref) => String(ref.id || '') === childId)) {
        repairedRefs.push({ id: childId });
      }
      const pteRootDoc = { ...pteRoot };
      delete pteRootDoc._id;
      await sections.updateOne(
        { _id: pteRoot._id },
        {
          $set: {
            ...pteRootDoc,
            id: String(pteRoot.id || PTE_ROOT_REF.id),
            subsections: repairedRefs,
            audit: buildAudit(pteRoot.audit)
          }
        }
      );
      console.log(`Ensured ${PTE_TESTS_SEED.name} (${childId}) is linked under ${PTE_ROOT_REF.name}.`);
    }

    const ptePeople = await findSectionByRef(sections, PTE_PEOPLE_REF);
    if (ptePeople) {
      const repairedRefs = await repairSubsectionRefs(sections, ptePeople.subsections || []);
      const filteredRefs = repairedRefs.filter((ref) => String(ref.id || '') !== childId);
      const ptePeopleDoc = { ...ptePeople };
      delete ptePeopleDoc._id;
      await sections.updateOne(
        { _id: ptePeople._id },
        {
          $set: {
            ...ptePeopleDoc,
            subsections: filteredRefs,
            audit: buildAudit(ptePeople.audit)
          }
        }
      );
      if (filteredRefs.length !== repairedRefs.length) {
        console.log(`Removed ${PTE_TESTS_SEED.name} (${childId}) from ${PTE_PEOPLE_REF.name}.`);
      } else {
        console.log(`${PTE_PEOPLE_REF.name} does not reference ${PTE_TESTS_SEED.name}.`);
      }
    }

    console.log('PTE Tests section seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`PTE Tests section seed failed: ${error.message}`);
  process.exit(1);
});
