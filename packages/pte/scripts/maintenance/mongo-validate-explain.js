#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > -1) {
      const key = token.slice(2, eq).trim();
      const value = token.slice(eq + 1).trim();
      out[key] = value;
      continue;
    }
    const key = token.slice(2).trim();
    const next = String(argv[i + 1] || '').trim();
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function inferDbNameFromUri(uri = '') {
  const safeUri = String(uri || '').trim();
  if (!safeUri) return '';
  try {
    const normalized = safeUri.startsWith('mongodb://') || safeUri.startsWith('mongodb+srv://')
      ? safeUri
      : `mongodb://${safeUri}`;
    const parsed = new URL(normalized);
    const pathname = String(parsed.pathname || '').replace(/^\//, '').trim();
    if (!pathname) return '';
    if (pathname.includes('/')) return pathname.split('/')[0];
    return pathname;
  } catch (_) {
    return '';
  }
}

function resolveConnectionConfig(args = {}) {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const settingsPath = path.join(repoRoot, 'data', 'systemSettings.json');
  const settings = readJsonFileSafe(settingsPath) || {};

  const uri = String(
    args.uri
      || process.env.MONGODB_URI
      || process.env.MONGO_URI
      || ''
  ).trim();

  const dbName = String(
    args.db
      || process.env.MONGODB_DB
      || process.env.MONGO_DB
      || inferDbNameFromUri(uri)
      || 'app'
  ).trim();

  return {
    uri,
    dbName,
    settingsPath,
  };
}

function getCollectionIndexNames(indexes = []) {
  return (Array.isArray(indexes) ? indexes : [])
    .map((row) => String(row?.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function walkPlanStages(node, out = []) {
  if (!node || typeof node !== 'object') return out;

  const stage = String(node.stage || '').trim();
  if (stage) {
    out.push({
      stage,
      indexName: String(node.indexName || '').trim(),
      keyPattern: node.keyPattern || null
    });
  }

  const objectChildren = [
    'inputStage',
    'outerStage',
    'innerStage',
    'leftChild',
    'rightChild',
    'queryPlan',
    'winningPlan'
  ];
  objectChildren.forEach((key) => {
    if (node[key] && typeof node[key] === 'object') {
      walkPlanStages(node[key], out);
    }
  });

  const arrayChildren = ['inputStages', 'children', 'shards'];
  arrayChildren.forEach((key) => {
    const rows = Array.isArray(node[key]) ? node[key] : [];
    rows.forEach((child) => {
      if (child && typeof child === 'object') walkPlanStages(child, out);
    });
  });

  return out;
}

function summarizeExplain(explainResult = {}) {
  const qp = explainResult?.queryPlanner || {};
  const winningPlan = qp.winningPlan || qp.winningQueryPlan || {};
  const execution = explainResult?.executionStats || {};
  const stages = walkPlanStages(winningPlan, []);
  const indexNames = Array.from(new Set(
    stages
      .filter((row) => row.stage === 'IXSCAN')
      .map((row) => row.indexName)
      .filter(Boolean)
  ));
  const hasCollscan = stages.some((row) => row.stage === 'COLLSCAN');
  const hasSortStage = stages.some((row) => row.stage === 'SORT');
  const nReturned = Number(execution?.nReturned || 0);
  const totalDocsExamined = Number(execution?.totalDocsExamined || 0);
  const totalKeysExamined = Number(execution?.totalKeysExamined || 0);
  const docsPerReturned = nReturned > 0 ? Number((totalDocsExamined / nReturned).toFixed(2)) : null;

  return {
    indexNames,
    hasCollscan,
    hasSortStage,
    nReturned,
    totalDocsExamined,
    totalKeysExamined,
    docsPerReturned,
    executionTimeMillis: Number(execution?.executionTimeMillis || 0),
    stages
  };
}

async function findSampleIds(db, collections = []) {
  const sample = {
    orgId: '',
    userId: '',
    sessionIds: []
  };

  for (const name of collections) {
    if (sample.orgId) break;
    const row = await db.collection(name).find(
      { orgId: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { orgId: 1, _id: 0 } }
    ).limit(1).toArray();
    const orgId = String(row?.[0]?.orgId || '').trim();
    if (orgId) sample.orgId = orgId;
  }

  if (sample.orgId) {
    const sessionRow = await db.collection('pteAttemptSessions').find(
      { orgId: sample.orgId, userId: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { userId: 1, _id: 0 } }
    ).limit(1).toArray();
    sample.userId = String(sessionRow?.[0]?.userId || '').trim();

    if (!sample.userId) {
      const userRow = await db.collection('pteAttemptLedgerEvents').find(
        { orgId: sample.orgId, userId: { $exists: true, $type: 'string', $gt: '' } },
        { projection: { userId: 1, _id: 0 } }
      ).limit(1).toArray();
      sample.userId = String(userRow?.[0]?.userId || '').trim();
    }

    const sessionRows = await db.collection('pteAttemptSessions').find(
      {
        orgId: sample.orgId,
        ...(sample.userId ? { userId: sample.userId } : {})
      },
      { projection: { id: 1, _id: 0 } }
    ).sort({ startedAt: -1, id: -1 }).limit(5).toArray();
    sample.sessionIds = (Array.isArray(sessionRows) ? sessionRows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean);
  }

  return sample;
}

function buildExplainChecks(sample = {}) {
  const orgFilter = sample.orgId ? { orgId: sample.orgId } : {};
  const orgUserFilter = (sample.orgId && sample.userId)
    ? { orgId: sample.orgId, userId: sample.userId }
    : orgFilter;
  const sessionInFilter = sample.sessionIds.length
    ? { attemptSessionId: { $in: sample.sessionIds } }
    : {};

  return [
    {
      key: 'pteApplicants_active_list',
      collection: 'pteApplicants',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteApplicants_archived_list',
      collection: 'pteApplicants',
      filter: { ...orgFilter, status: 'archived' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteTeachers_active_list',
      collection: 'pteTeachers',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteTeachers_archived_list',
      collection: 'pteTeachers',
      filter: { ...orgFilter, status: 'archived' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteCourses_default_list',
      collection: 'pteCourses',
      filter: orgFilter,
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteCourses_status_active_list',
      collection: 'pteCourses',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteTeachers_picker_default',
      collection: 'pteTeachers',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteCourses_picker_default',
      collection: 'pteCourses',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteApplicants_picker_students_default',
      collection: 'pteApplicants',
      filter: { ...orgFilter, status: 'active', personRoleToken: 'PTE_Student' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteQuestions_published_practice_list',
      collection: 'pteQuestionVersions',
      filter: { ...orgFilter, status: 'published', practiceEnabled: true },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteTests_default_list',
      collection: 'pteTestVersions',
      filter: orgFilter,
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50
    },
    {
      key: 'pteAttemptSessions_practice_feedback',
      collection: 'pteAttemptSessions',
      filter: { ...orgFilter, attemptType: 'skill_practice_run' },
      sort: { startedAt: -1, id: -1 },
      limit: 100
    },
    {
      key: 'pteAttemptItems_my_attempts',
      collection: 'pteAttemptItems',
      filter: {
        ...orgUserFilter,
        ...sessionInFilter
      },
      sort: { questionOrder: 1, id: 1 },
      limit: 500
    },
    {
      key: 'pteAttemptLedgerEvents_runtime_list',
      collection: 'pteAttemptLedgerEvents',
      filter: {
        ...orgFilter,
        attemptType: 'skill_practice_run'
      },
      sort: { eventAt: -1, id: -1 },
      limit: 200
    }
  ];
}

async function runExplainChecks(db, checks = []) {
  const results = [];
  for (const check of checks) {
    const collection = db.collection(check.collection);
    let cursor = collection.find(check.filter || {});
    if (check.sort && Object.keys(check.sort).length) cursor = cursor.sort(check.sort);
    if (Number(check.limit || 0) > 0) cursor = cursor.limit(Number(check.limit));
    const explain = await cursor.explain('executionStats');
    const summary = summarizeExplain(explain);
    results.push({
      ...check,
      summary
    });
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConnectionConfig(args);

  if (!config.uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

  console.log(`[pte:mongo-validate] db=${config.dbName}`);

  const client = new MongoClient(config.uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);

    const collections = [
      'pteApplicants',
      'pteTeachers',
      'pteCourses',
      'pteQuestionVersions',
      'pteTestVersions',
      'pteAttemptSessions',
      'pteAttemptItems',
      'pteAttemptLedgerEvents',
      'pteAttemptArtifacts'
    ];

    const indexSummary = {};
    const counts = {};
    for (const name of collections) {
      const [indexes, count] = await Promise.all([
        db.collection(name).indexes(),
        db.collection(name).estimatedDocumentCount()
      ]);
      indexSummary[name] = getCollectionIndexNames(indexes);
      counts[name] = Number(count || 0);
    }

    const sample = await findSampleIds(db, collections);
    const checks = buildExplainChecks(sample);
    const explainResults = await runExplainChecks(db, checks);

    console.log('\n[pte:mongo-validate] collection counts');
    collections.forEach((name) => {
      console.log(`  - ${name}: ${counts[name]}`);
    });

    console.log('\n[pte:mongo-validate] key indexes');
    collections.forEach((name) => {
      console.log(`  - ${name}: ${(indexSummary[name] || []).join(', ')}`);
    });

    console.log('\n[pte:mongo-validate] sample ids');
    console.log(`  - orgId: ${sample.orgId || '-'}`);
    console.log(`  - userId: ${sample.userId || '-'}`);
    console.log(`  - sessionIds: ${sample.sessionIds.length ? sample.sessionIds.join(', ') : '-'}`);

    console.log('\n[pte:mongo-validate] explain summary');
    explainResults.forEach((row) => {
      const s = row.summary || {};
      const indexText = s.indexNames.length ? s.indexNames.join('|') : '-';
      console.log(`  - ${row.key}`);
      console.log(`    collection=${row.collection}`);
      console.log(`    index=${indexText}`);
      console.log(`    collscan=${s.hasCollscan ? 'yes' : 'no'} sortStage=${s.hasSortStage ? 'yes' : 'no'}`);
      console.log(`    nReturned=${s.nReturned} docsExamined=${s.totalDocsExamined} keysExamined=${s.totalKeysExamined} docsPerReturned=${s.docsPerReturned === null ? '-' : s.docsPerReturned} execMs=${s.executionTimeMillis}`);
    });

    const weakChecks = explainResults.filter((row) => {
      const s = row.summary || {};
      const isListCheck = /^pte(Applicants|Teachers|Courses)_/.test(String(row.key || ''));
      if (s.hasCollscan) return true;
      if (isListCheck && s.hasSortStage) return true;
      if (s.hasSortStage && !s.indexNames.length) return true;
      if (s.docsPerReturned !== null && s.docsPerReturned > 20) return true;
      return false;
    });

    console.log('\n[pte:mongo-validate] candidates-for-optimization');
    if (!weakChecks.length) {
      console.log('  - none (all checked queries are index-backed and efficient in this sample)');
    } else {
      weakChecks.forEach((row) => {
        const s = row.summary || {};
        console.log(`  - ${row.key} | collscan=${s.hasCollscan ? 'yes' : 'no'} | docsPerReturned=${s.docsPerReturned === null ? '-' : s.docsPerReturned} | sortStage=${s.hasSortStage ? 'yes' : 'no'}`);
      });
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[pte:mongo-validate][error] ${error.message}`);
  process.exitCode = 1;
});
