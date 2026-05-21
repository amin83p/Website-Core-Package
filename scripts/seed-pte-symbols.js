/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ACTOR = 'SYS_ROOT_001';
const NOW = new Date().toISOString();
const ROOT_DIR = path.resolve(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'systemSettings.json');

const docs = [
  {
    id: 'SYM_PTE_PUBLIC_PAGE_930123',
    name: 'PTE_PUBLIC_PAGE',
    type: 'class',
    value: 'bi bi-window-sidebar',
    tags: ['PTE_PUBLIC_PAGE', '930123'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_PEOPLE_930100',
    name: 'PTE_PEOPLE',
    type: 'class',
    value: 'bi bi-people-fill',
    tags: ['PTE_PEOPLE', '930100'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_STUDENTS_930101',
    name: 'PTE_STUDENTS',
    type: 'class',
    value: 'bi bi-person-vcard-fill',
    tags: ['PTE_STUDENTS', '930101'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_PUBLIC_APPLICANTS_930122',
    name: 'PTE_PUBLIC_APPLICANTS',
    type: 'class',
    value: 'bi bi-person-plus-fill',
    tags: ['PTE_PUBLIC_APPLICANTS', '930122'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_TEACHERS_930113',
    name: 'PTE_TEACHERS',
    type: 'class',
    value: 'bi bi-person-workspace',
    tags: ['PTE_TEACHERS', '930113'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_QUESTIONS_BANK_930102',
    name: 'PTE_QUESTIONS_BANK',
    type: 'class',
    value: 'bi bi-journal-richtext',
    tags: ['PTE_QUESTIONS_BANK', '930102'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_TESTS_930103',
    name: 'PTE_TESTS',
    type: 'class',
    value: 'bi bi-ui-checks-grid',
    tags: ['PTE_TESTS', '930103'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_COURSES_930112',
    name: 'PTE_COURSES',
    type: 'class',
    value: 'bi bi-journal-bookmark-fill',
    tags: ['PTE_COURSES', '930112'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_AI_ASSISST_930114',
    name: 'PTE_AI_ASSISST',
    type: 'class',
    value: 'bi bi-robot',
    tags: ['PTE_AI_ASSISST', '930114'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_AI_PROVIDER_KEYS_930115',
    name: 'PTE_AI_PROVIDER_KEYS',
    type: 'class',
    value: 'bi bi-key-fill',
    tags: ['PTE_AI_PROVIDER_KEYS', '930115'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_AI_SCORING_SETTINGS_930119',
    name: 'PTE_AI_SCORING_SETTINGS',
    type: 'class',
    value: 'bi bi-sliders',
    tags: ['PTE_AI_SCORING_SETTINGS', '930119'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_AI_TOKEN_USAGE_930118',
    name: 'PTE_AI_TOKEN_USAGE',
    type: 'class',
    value: 'bi bi-cpu-fill',
    tags: ['PTE_AI_TOKEN_USAGE', '930118'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_SCORING_930116',
    name: 'PTE_SCORING',
    type: 'class',
    value: 'bi bi-graph-up',
    tags: ['PTE_SCORING', '930116'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_SCORING_DEFAULTS_930117',
    name: 'PTE_SCORING_DEFAULTS',
    type: 'class',
    value: 'bi bi-sliders',
    tags: ['PTE_SCORING_DEFAULTS', '930117'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_ATTEMPT_930104',
    name: 'PTE_ATTEMPT',
    type: 'class',
    value: 'bi bi-journal-check',
    tags: ['PTE_ATTEMPT', '930104'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_ATTEMPT_LEDGER_930105',
    name: 'PTE_ATTEMPT_LEDGER',
    type: 'class',
    value: 'bi bi-list-columns-reverse',
    tags: ['PTE_ATTEMPT_LEDGER', '930105'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_ATTEMPT_DETAILS_930106',
    name: 'PTE_ATTEMPT_DETAILS',
    type: 'class',
    value: 'bi bi-file-earmark-text',
    tags: ['PTE_ATTEMPT_DETAILS', '930106'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_ATTEMPT_OVERALL_PERFORMANCE_930107',
    name: 'PTE_ATTEMPT_OVERALL_PERFORMANCE',
    type: 'class',
    value: 'bi bi-graph-up-arrow',
    tags: ['PTE_ATTEMPT_OVERALL_PERFORMANCE', '930107'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_PRACTICE_930108',
    name: 'PTE_PRACTICE',
    type: 'class',
    value: 'bi bi-joystick',
    tags: ['PTE_PRACTICE', '930108'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_PRACTICE_BY_SKILLS_930109',
    name: 'PTE_PRACTICE_BY_SKILLS',
    type: 'class',
    value: 'bi bi-bullseye',
    tags: ['PTE_PRACTICE_BY_SKILLS', '930109'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_SMART_PRACTICE_930121',
    name: 'PTE_SMART_PRACTICE',
    type: 'class',
    value: 'bi bi-stars',
    tags: ['PTE_SMART_PRACTICE', '930121'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_MOCK_EXAMS_930120',
    name: 'PTE_MOCK_EXAMS',
    type: 'class',
    value: 'bi bi-pc-display-horizontal',
    tags: ['PTE_MOCK_EXAMS', '930120'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_FEEDBACK_930110',
    name: 'PTE_FEEDBACK',
    type: 'class',
    value: 'bi bi-chat-square-dots',
    tags: ['PTE_FEEDBACK', '930110'],
    orgId: 'SYSTEM'
  },
  {
    id: 'SYM_PTE_FEEDBACK_ON_PRACTICE_930111',
    name: 'PTE_FEEDBACK_ON_PRACTICE',
    type: 'class',
    value: 'bi bi-chat-left-text',
    tags: ['PTE_FEEDBACK_ON_PRACTICE', '930111'],
    orgId: 'SYSTEM'
  }
];

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

function normalizeTags(tags = []) {
  const seen = new Set();
  const out = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const clean = String(tag || '').trim();
    if (!clean) continue;
    const key = clean.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

async function upsertSymbolByName(collection, seedDoc) {
  const existing = await collection.findOne(buildGlobalNameFilter(seedDoc.name));
  if (!existing) {
    const next = {
      ...seedDoc,
      tags: normalizeTags(seedDoc.tags),
      audit: buildAudit(null)
    };
    await collection.insertOne(next);
    console.log(`Inserted symbol ${next.name} (${next.id}).`);
    return next;
  }

  const next = {
    ...seedDoc,
    id: String(existing.id || seedDoc.id),
    orgId: 'SYSTEM',
    tags: normalizeTags(seedDoc.tags),
    audit: buildAudit(existing.audit)
  };
  await collection.updateOne({ _id: existing._id }, { $set: next });
  console.log(`Updated symbol ${next.name} (${next.id}).`);
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
    const symbols = db.collection('symbols');
    for (const doc of docs) {
      // eslint-disable-next-line no-await-in-loop
      await upsertSymbolByName(symbols, doc);
    }
    console.log('PTE symbols seed complete.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`PTE symbols seed failed: ${error.message}`);
  process.exit(1);
});
