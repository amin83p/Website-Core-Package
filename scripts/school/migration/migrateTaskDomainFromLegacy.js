/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const LEGACY_SECTION = 'SCHOOL_NOTIFICATIONS';
const NEXT_SECTION = 'SCHOOL_TASKS';
const LEGACY_TASKS_COLLECTION = 'schoolNotifications';
const NEXT_TASKS_COLLECTION = 'schoolTasks';
const LEGACY_RULES_COLLECTION = 'schoolNotificationRoutingRules';
const NEXT_RULES_COLLECTION = 'schoolTaskRoutingRules';
const NOW = new Date().toISOString();

function loadLocalEnvFile() {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const out = { apply: false, uri: '', db: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = String(argv[i + 1] || '').trim();
    if (token === '--apply') out.apply = true;
    if ((token === '--uri' || token === '-u') && next) { out.uri = next; i += 1; }
    if ((token === '--db' || token === '-d') && next) { out.db = next; i += 1; }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  try {
    const normalized = uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://') ? uri : `mongodb://${uri}`;
    const parsed = new URL(normalized);
    return String(parsed.pathname || '').replace(/^\//, '').split('/')[0].trim();
  } catch (_) {
    return '';
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceDeep(value) {
  if (Array.isArray(value)) return value.map(replaceDeep);
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      let nextKey = key;
      nextKey = nextKey.replace(/notificationRoutingRules/g, 'taskRoutingRules')
        .replace(/notifications/g, 'tasks')
        .replace(/notification/g, 'task');
      next[nextKey] = replaceDeep(child);
    }
    return next;
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/SCHOOL_NOTIFICATIONS/g, NEXT_SECTION)
    .replace(/schoolNotifications/g, NEXT_TASKS_COLLECTION)
    .replace(/schoolNotificationRoutingRules/g, NEXT_RULES_COLLECTION)
    .replace(/notificationRoutingRules/g, 'taskRoutingRules')
    .replace(/\/school\/notifications/g, '/school/tasks')
    .replace(/school-menu-notifications/g, 'school-menu-tasks')
    .replace(/school-dashboard-notifications/g, 'school-dashboard-tasks')
    .replace(/School Notifications/g, 'School Tasks')
    .replace(/School Notification/g, 'School Task')
    .replace(/Notification Routing/g, 'Task Routing')
    .replace(/notification routing/g, 'task routing')
    .replace(/notifications/g, 'tasks')
    .replace(/Notifications/g, 'Tasks')
    .replace(/notification/g, 'task')
    .replace(/Notification/g, 'Task');
}

function withoutMongoId(row) {
  const { _id, ...rest } = row || {};
  return rest;
}

async function copyCollectionById(db, sourceName, targetName, apply) {
  const source = db.collection(sourceName);
  const target = db.collection(targetName);
  const rows = await source.find({}).toArray();
  const targetCount = await target.countDocuments({});
  console.log(`${apply ? 'Migrating' : 'Would migrate'} ${rows.length} row(s): ${sourceName} -> ${targetName}. Existing target rows: ${targetCount}.`);
  if (!apply) return { sourceName, targetName, copied: rows.length };
  let copied = 0;
  for (const row of rows) {
    const next = replaceDeep(withoutMongoId(row));
    const id = String(next.id || '').trim();
    if (id) {
      await target.updateOne({ id }, { $set: next }, { upsert: true });
    } else {
      await target.insertOne(next);
    }
    copied += 1;
  }
  return { sourceName, targetName, copied };
}

async function updateSections(db, apply) {
  const sections = db.collection('sections');
  const legacyRegex = new RegExp(`^${escapeRegex(LEGACY_SECTION)}$`, 'i');
  const candidates = await sections.find({ $or: [{ name: legacyRegex }, { homeURL: '/school/notifications' }] }).toArray();
  console.log(`${apply ? 'Updating' : 'Would update'} ${candidates.length} section row(s) to ${NEXT_SECTION}.`);
  if (!apply) return;
  for (const row of candidates) {
    const next = replaceDeep(row);
    next.name = NEXT_SECTION;
    next.homeURL = '/school/tasks';
    next.description = 'Review school tasks and manage embedded follow-up assignments for package workflows.';
    next.audit = { ...(next.audit || {}), lastUpdateUser: 'system', lastUpdateDateTime: NOW };
    await sections.updateOne({ _id: row._id }, { $set: withoutMongoId(next) });
  }
}

async function updateSymbols(db, apply) {
  const symbols = db.collection('symbols');
  const rows = await symbols.find({ $or: [{ name: LEGACY_SECTION }, { tags: LEGACY_SECTION }] }).toArray();
  console.log(`${apply ? 'Updating' : 'Would update'} ${rows.length} symbol row(s) to ${NEXT_SECTION}.`);
  if (!apply) return;
  for (const row of rows) {
    const next = replaceDeep(row);
    next.name = NEXT_SECTION;
    next.tags = Array.from(new Set((Array.isArray(next.tags) ? next.tags : []).map((tag) => tag === LEGACY_SECTION ? NEXT_SECTION : tag)));
    await symbols.updateOne({ _id: row._id }, { $set: withoutMongoId(next) });
  }
}

async function updateAccesses(db, apply) {
  const accesses = db.collection('accesses');
  const rows = await accesses.find({ 'sections.sectionId': LEGACY_SECTION }).toArray();
  console.log(`${apply ? 'Updating' : 'Would update'} ${rows.length} access profile row(s) from ${LEGACY_SECTION} to ${NEXT_SECTION}.`);
  if (!apply) return;
  for (const row of rows) {
    const sections = (Array.isArray(row.sections) ? row.sections : []).map((section) => (
      String(section?.sectionId || '') === LEGACY_SECTION ? { ...section, sectionId: NEXT_SECTION } : section
    ));
    await accesses.updateOne({ _id: row._id }, { $set: { sections, updatedAt: NOW, updatedBy: 'system' } });
  }
}

async function updateMenuLikeCollection(db, collectionName, apply) {
  const collection = db.collection(collectionName);
  const rows = await collection.find({
    $or: [
      { id: /notifications/i },
      { href: '/school/notifications' },
      { label: /Notification/i },
      { description: /notification/i }
    ]
  }).toArray();
  console.log(`${apply ? 'Updating' : 'Would update'} ${rows.length} row(s) in ${collectionName}.`);
  if (!apply) return;
  for (const row of rows) {
    const next = replaceDeep(row);
    await collection.updateOne({ _id: row._id }, { $set: withoutMongoId(next) });
  }
}

async function main() {
  loadLocalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const uri = String(args.uri || process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI.');
  const dbName = String(args.db || process.env.MONGODB_DB || process.env.MONGO_DB || inferDbNameFromUri(uri) || 'app').trim();
  console.log(args.apply ? 'APPLY mode enabled.' : 'Dry-run mode. Pass --apply to write changes.');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    await copyCollectionById(db, LEGACY_TASKS_COLLECTION, NEXT_TASKS_COLLECTION, args.apply);
    await copyCollectionById(db, LEGACY_RULES_COLLECTION, NEXT_RULES_COLLECTION, args.apply);
    await updateSections(db, args.apply);
    await updateSymbols(db, args.apply);
    await updateAccesses(db, args.apply);
    await updateMenuLikeCollection(db, 'menuEntries', args.apply);
    await updateMenuLikeCollection(db, 'dashboardEntries', args.apply);
    await updateMenuLikeCollection(db, 'packageRegistry', args.apply);
    console.log('School Task domain migration complete. Old legacy collections are not used by current code; review before dropping them manually.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`School Task domain migration failed: ${error.message}`);
  process.exit(1);
});
