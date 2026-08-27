/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '..');
const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();

const LIBRARY_HUB = { id: '446110', name: 'SCHOOL_LIBRARY' };
const BOOKS_SECTION = { id: '445585', name: 'SCHOOL_BOOKS' };
const CHILD_SECTIONS = [
  { id: '446111', name: 'SCHOOL_LIBRARY_COPIES', homeURL: '/school/library/copies', symbolId: 'SYM_SCHOOL_LIBRARY_COPIES_001', icon: 'bi bi-upc-scan' },
  { id: '446112', name: 'SCHOOL_LIBRARY_PATRONS', homeURL: '/school/library/patrons', symbolId: 'SYM_SCHOOL_LIBRARY_PATRONS_001', icon: 'bi bi-person-vcard' },
  { id: '446113', name: 'SCHOOL_LIBRARY_CIRCULATION', homeURL: '/school/library/circulation', symbolId: 'SYM_SCHOOL_LIBRARY_CIRCULATION_001', icon: 'bi bi-arrow-left-right' },
  { id: '446114', name: 'SCHOOL_LIBRARY_POLICIES', homeURL: '/school/library/policies', symbolId: 'SYM_SCHOOL_LIBRARY_POLICIES_001', icon: 'bi bi-sliders' },
  { id: '446115', name: 'SCHOOL_LIBRARY_LOCATIONS', homeURL: '/school/library/locations', symbolId: 'SYM_SCHOOL_LIBRARY_LOCATIONS_001', icon: 'bi bi-geo-alt' },
  { id: '446116', name: 'SCHOOL_LIBRARY_BOOK_ASSIGNMENTS', homeURL: '/school/library/book-assignments', symbolId: 'SYM_SCHOOL_LIBRARY_BOOK_ASSIGNMENTS_001', icon: 'bi bi-journal-check' },
  { id: '446117', name: 'SCHOOL_LIBRARY_BOOK_COVERING', homeURL: '/school/library/book-covering', symbolId: 'SYM_SCHOOL_LIBRARY_BOOK_COVERING_001', icon: 'bi bi-journal-richtext' }
];
const BOOKS_HOME_URL = '/school/library/books';
const BOOKS_SYMBOL = 'SYM_SCHOOL_BOOKS_001';
const LIBRARY_SYMBOL = 'SYM_SCHOOL_LIBRARY_001';
const SCHOOL_ROOT = { id: '122740', name: 'SCHOOL' };
const CLONE_SECTION_ID = '446111';

const OWNER_OPERATIONS = ['OP1001', 'OP1002', 'OP1003', 'OP1004', 'OP1005'].map((operationId) => ({
  operationId,
  scopeId: 'SCP_OWNER',
  maxAttemptsPerSession: null,
  maxSessionDurationMinutes: null,
  maxFetchUploadVolumeKB: null
}));

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
    if ((token === '--uri' || token === '-u') && next) { out.uri = next; i += 1; continue; }
    if ((token === '--db' || token === '-d') && next) { out.db = next; i += 1; }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const safe = String(uri || '').trim();
  if (!safe) return '';
  try {
    const normalized = safe.startsWith('mongodb://') || safe.startsWith('mongodb+srv://') ? safe : `mongodb://${safe}`;
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

function buildLeafSection({ id, name, homeURL, description }) {
  return {
    id,
    name,
    category: 'SCHOOL',
    description,
    active: true,
    trackState: true,
    minimumAccessRequirement: 1,
    dashboardDisplay: true,
    mainDashboardDisplay: false,
    navigatorSection: false,
    homeURL,
    inactiveMessage: '',
    message: '',
    operations: OWNER_OPERATIONS.map((row) => row.operationId).map((opId) => ({
      id: opId,
      sessionAttempts: 10, sessionTime: 30,
      active: true
    })),
    subsections: [],
    related: [],
    adoptExisting: true
  };
}

async function upsertSection(sections, doc) {
  const existing = await sections.findOne({ id: doc.id }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(doc.name)}$`, 'i') } });
  const next = {
    ...doc,
    id: String(existing?.id || doc.id),
    active: existing?.active !== false,
    subsections: Array.isArray(existing?.subsections) ? existing.subsections : doc.subsections || [],
    related: Array.isArray(existing?.related) ? existing.related : [],
    audit: buildAudit(existing?.audit)
  };
  if (!existing) {
    await sections.insertOne(next);
    console.log(`Inserted section ${doc.name} (${next.id}).`);
  } else {
    await sections.updateOne({ _id: existing._id }, { $set: next });
    console.log(`Updated section ${doc.name} (${next.id}).`);
  }
  return next;
}

async function upsertSymbol(symbols, { id, name, value, tags }) {
  const existing = await symbols.findOne({ id }) ||
    await symbols.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') },
      $or: [{ orgId: 'SYSTEM' }, { orgId: { $exists: false } }, { orgId: null }, { orgId: '' }]
    });
  const next = {
    id,
    name,
    type: 'class',
    value,
    tags,
    orgId: 'SYSTEM',
    adoptExisting: true,
    audit: buildAudit(existing?.audit)
  };
  if (!existing) {
    await symbols.insertOne(next);
    console.log(`Inserted symbol ${name} (${id}).`);
  } else {
    await symbols.updateOne({ _id: existing._id }, { $set: next });
    console.log(`Updated symbol ${name} (${id}).`);
  }
}

async function appendChildUnderParent(sections, parentMeta, childId) {
  const parent = await sections.findOne({ id: parentMeta.id }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(parentMeta.name)}$`, 'i') } });
  if (!parent) {
    console.warn(`WARNING: ${parentMeta.name} not found; attach ${childId} manually.`);
    return;
  }
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  if (refs.some((row) => String(row?.id || row || '').trim() === childId)) {
    console.log(`${childId} already linked under ${parentMeta.name}.`);
    return;
  }
  await sections.updateOne(
    { _id: parent._id },
    {
      $set: {
        subsections: [...refs, { id: childId }],
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );
  console.log(`Linked ${childId} under ${parentMeta.name}.`);
}

async function removeChildFromParent(sections, parentMeta, childId) {
  const parent = await sections.findOne({ id: parentMeta.id }) ||
    await sections.findOne({ name: { $regex: new RegExp(`^${escapeRegex(parentMeta.name)}$`, 'i') } });
  if (!parent) return;
  const refs = Array.isArray(parent.subsections) ? parent.subsections : [];
  const next = refs.filter((row) => String(row?.id || row || '').trim() !== childId);
  if (next.length === refs.length) return;
  await sections.updateOne(
    { _id: parent._id },
    {
      $set: {
        subsections: next,
        'audit.lastUpdateUser': ACTOR,
        'audit.lastUpdateDateTime': NOW
      }
    }
  );
  console.log(`Removed ${childId} from ${parentMeta.name}.`);
}

async function grantAccessFromClone(accesses, sectionId) {
  const profiles = await accesses.find({ 'sections.sectionId': CLONE_SECTION_ID }).toArray();
  let updated = 0;
  for (const profile of profiles) {
    const sampleGrant = (Array.isArray(profile.sections) ? profile.sections : [])
      .find((row) => String(row?.sectionId || '') === CLONE_SECTION_ID);
    const operations = Array.isArray(sampleGrant?.operations) && sampleGrant.operations.length
      ? sampleGrant.operations
      : OWNER_OPERATIONS;
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
  if (!updated) {
    console.warn(`WARNING: No profiles with ${CLONE_SECTION_ID}; grant ${sectionId} manually.`);
  }
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const sections = db.collection('sections');
    const symbols = db.collection('symbols');
    const accesses = db.collection('accesses');

    const hubDoc = {
      id: LIBRARY_HUB.id,
      name: LIBRARY_HUB.name,
      category: 'SCHOOL',
      description: 'School library hub for catalog, copies, patrons, circulation, and lending policies.',
      active: true,
      trackState: false,
      minimumAccessRequirement: 1,
      dashboardDisplay: true,
      mainDashboardDisplay: false,
      navigatorSection: true,
      homeURL: '/dashboard/section-nav/SCHOOL_LIBRARY',
      inactiveMessage: '',
      message: '',
      operations: [],
      subsections: [
        { id: BOOKS_SECTION.id },
        ...CHILD_SECTIONS.map((row) => ({ id: row.id }))
      ],
      related: [],
      adoptExisting: true
    };
    await upsertSection(sections, hubDoc);
    await upsertSymbol(symbols, {
      id: LIBRARY_SYMBOL,
      name: LIBRARY_HUB.name,
      value: 'bi bi-book',
      tags: [LIBRARY_HUB.name, LIBRARY_HUB.id]
    });

    await upsertSection(sections, buildLeafSection({
      id: BOOKS_SECTION.id,
      name: BOOKS_SECTION.name,
      homeURL: BOOKS_HOME_URL,
      description: 'Manage school textbooks and materials, including bibliographic details and table of contents.'
    }));
    await upsertSymbol(symbols, {
      id: BOOKS_SYMBOL,
      name: BOOKS_SECTION.name,
      value: 'bi bi-journal-text',
      tags: [BOOKS_SECTION.name, BOOKS_SECTION.id]
    });

    for (const child of CHILD_SECTIONS) {
      await upsertSection(sections, buildLeafSection({
        id: child.id,
        name: child.name,
        homeURL: child.homeURL,
        description: child.name.replace(/_/g, ' ')
      }));
      await upsertSymbol(symbols, {
        id: child.symbolId,
        name: child.name,
        value: child.icon,
        tags: [child.name, child.id]
      });
      await grantAccessFromClone(accesses, child.id);
    }

    await grantAccessFromClone(accesses, LIBRARY_HUB.id);
    await appendChildUnderParent(sections, SCHOOL_ROOT, LIBRARY_HUB.id);
    await appendChildUnderParent(sections, LIBRARY_HUB, BOOKS_SECTION.id);
    for (const child of CHILD_SECTIONS) {
      await appendChildUnderParent(sections, LIBRARY_HUB, child.id);
    }
    await removeChildFromParent(sections, { id: '139382', name: 'SCHOOL_ACADEMIA' }, BOOKS_SECTION.id);

    console.log('School Library section seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`School Library section seed failed: ${error.message}`);
  process.exit(1);
});
