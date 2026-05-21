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

const PTE_FEEDBACK_SEED = {
  id: '930110',
  name: 'PTE_FEEDBACK',
  category: 'PTE',
  description: 'Navigator for PTE feedback sections.',
  homeURL: '',
  message: '',
  inactiveMessage: '',
  active: true,
  dashboardDisplay: true,
  mainDashboardDisplay: false,
  trackState: false,
  minimumAccessRequirement: 5,
  navigatorSection: true,
  related: [],
  subsections: [],
  operations: []
};

const PTE_FEEDBACK_ON_PRACTICE_SEED = {
  id: '930111',
  name: 'PTE_FEEDBACK_ON_PRACTICE',
  category: 'PTE',
  description: 'Review started practice sessions and provide per-question feedback for learners.',
  homeURL: '/pte/feedback/practice',
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

async function updateSectionSubsections(sectionsCollection, section, nextSubsections = []) {
  if (!section?._id) return false;
  const doc = { ...section };
  delete doc._id;
  await sectionsCollection.updateOne(
    { _id: section._id },
    {
      $set: {
        ...doc,
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

    const feedbackParent = await upsertSectionByName(sections, PTE_FEEDBACK_SEED);
    const feedbackChild = await upsertSectionByName(sections, PTE_FEEDBACK_ON_PRACTICE_SEED);
    const parentId = String(feedbackParent.id || '').trim();
    const childId = String(feedbackChild.id || '').trim();
    if (!parentId || !childId) {
      throw new Error('Failed to resolve seeded section ids for PTE feedback.');
    }

    const pteRoot = await findSectionByRef(sections, PTE_ROOT_REF);
    if (!pteRoot) {
      console.warn('WARNING: PTE parent section was not found. Add subsection manually:', { id: parentId });
    } else {
      const repairedRootRefs = await repairSubsectionRefs(sections, pteRoot.subsections || []);
      const nextRootRefs = appendMissingRefs(
        repairedRootRefs.filter((ref) => String(ref?.id || '').trim() !== childId),
        [parentId]
      );
      await updateSectionSubsections(sections, pteRoot, nextRootRefs);
      console.log(`Ensured ${PTE_FEEDBACK_SEED.name} (${parentId}) is linked under ${PTE_ROOT_REF.name}.`);
    }

    const freshParent = await findSectionByName(sections, PTE_FEEDBACK_SEED.name);
    if (freshParent) {
      const repairedFeedbackRefs = await repairSubsectionRefs(sections, freshParent.subsections || []);
      const nextFeedbackRefs = appendMissingRefs(repairedFeedbackRefs, [childId]);
      await updateSectionSubsections(sections, freshParent, nextFeedbackRefs);
      console.log(`Ensured ${PTE_FEEDBACK_ON_PRACTICE_SEED.name} (${childId}) is linked under ${PTE_FEEDBACK_SEED.name}.`);
    }

    const ptePeople = await findSectionByRef(sections, PTE_PEOPLE_REF);
    if (ptePeople) {
      const repairedPeopleRefs = await repairSubsectionRefs(sections, ptePeople.subsections || []);
      const filteredRefs = repairedPeopleRefs.filter((ref) => {
        const id = String(ref?.id || '').trim();
        return id !== parentId && id !== childId;
      });
      await updateSectionSubsections(sections, ptePeople, filteredRefs);
      console.log(`Ensured ${PTE_FEEDBACK_SEED.name} and ${PTE_FEEDBACK_ON_PRACTICE_SEED.name} are not under ${PTE_PEOPLE_REF.name}.`);
    }

    console.log('PTE Feedback sections seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`PTE Feedback sections seed failed: ${error.message}`);
  process.exit(1);
});
