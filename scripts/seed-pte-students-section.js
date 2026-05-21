/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

const PTE_PEOPLE_SEED = {
  id: '930100',
  name: 'PTE_PEOPLE',
  category: 'PTE',
  description: 'Navigator for PTE people-related sections.',
  homeURL: '',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: false,
  minimumAccessRequirement: 5,
  navigatorSection: true,
  operations: []
};

const PTE_STUDENTS_SEED = {
  id: '930101',
  name: 'PTE_STUDENTS',
  category: 'PTE',
  description: 'Manage PTE applicants/students lifecycle, packages, and supporting documents.',
  homeURL: '/pte/students',
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
  operations: [
    { id: 'OP1001', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1002', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1003', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1004', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1005', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1012', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1013', sessionAttempts: 5, sessionTime: 15, active: true },
    { id: 'OP1022', sessionAttempts: 5, sessionTime: 15, active: true }
  ]
};
const PTE_NON_PEOPLE_SECTION_NAMES = ['PTE_QUESTIONS_BANK', 'PTE_TESTS'];

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

    const existingParent = await sections.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(PTE_PEOPLE_SEED.name)}$`, 'i') }
    });

    const parent = await upsertSectionByName(sections, {
      ...PTE_PEOPLE_SEED,
      subsections: Array.isArray(existingParent?.subsections) ? existingParent.subsections : []
    });

    const child = await upsertSectionByName(sections, PTE_STUDENTS_SEED);

    const currentSubsections = Array.isArray(parent.subsections) ? parent.subsections : [];
    const repaired = [];
    const seen = new Set();

    for (const ref of currentSubsections) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await findSectionByRef(sections, ref || {});
      if (!resolved || !resolved.id) continue;
      const id = String(resolved.id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      repaired.push({ id });
    }

    const excludedIds = new Set();
    for (const sectionName of PTE_NON_PEOPLE_SECTION_NAMES) {
      // eslint-disable-next-line no-await-in-loop
      const section = await sections.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(sectionName)}$`, 'i') }
      });
      const sectionId = String(section?.id || '').trim();
      if (sectionId) excludedIds.add(sectionId);
    }
    const repairedWithoutQuestionBank = excludedIds.size
      ? repaired.filter((ref) => !excludedIds.has(String(ref?.id || '').trim()))
      : repaired;

    const childId = String(child.id || '').trim();
    if (childId && !repairedWithoutQuestionBank.some((ref) => String(ref?.id || '').trim() === childId)) {
      repairedWithoutQuestionBank.push({ id: childId });
    }

    const updatedParent = {
      ...PTE_PEOPLE_SEED,
      id: String(parent.id || PTE_PEOPLE_SEED.id),
      subsections: repairedWithoutQuestionBank
    };

    await sections.updateOne(
      { _id: parent._id },
      { $set: { ...updatedParent, audit: buildAudit(parent.audit) } }
    );

    const removedCount = Math.max(0, currentSubsections.length - repairedWithoutQuestionBank.length);
    console.log(`Repaired PTE_PEOPLE subsections. kept=${repairedWithoutQuestionBank.length}, removedInvalid=${removedCount}`);
    console.log('PTE students seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`PTE students seed failed: ${error.message}`);
  process.exit(1);
});
