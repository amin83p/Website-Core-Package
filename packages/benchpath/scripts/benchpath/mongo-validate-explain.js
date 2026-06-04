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
  const repoRoot = path.resolve(__dirname, '..', '..');
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

async function findSampleOrgId(db, collections = []) {
  for (const name of collections) {
    const row = await db.collection(name).find(
      { orgId: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { orgId: 1, _id: 0 } }
    ).limit(1).toArray();
    const orgId = String(row?.[0]?.orgId || '').trim();
    if (orgId) return orgId;
  }
  return '';
}

function buildExplainChecks(sample = {}) {
  const orgFilter = sample.orgId ? { orgId: sample.orgId } : {};
  const activeOrApproved = sample.orgId
    ? { orgId: sample.orgId, status: { $in: ['active', 'approved', 'reviewed', 'draft'] } }
    : { status: { $in: ['active', 'approved', 'reviewed', 'draft'] } };

  return [
    {
      key: 'benchpath_sources_list',
      collection: 'benchpathSources',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_source_fragments_list',
      collection: 'benchpathSourceFragments',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_frameworks_list',
      collection: 'benchpathClbFrameworks',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_stages_list',
      collection: 'benchpathClbStages',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_skills_list',
      collection: 'benchpathClbSkills',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_competency_areas_list',
      collection: 'benchpathClbCompetencyAreas',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_benchmarks_list',
      collection: 'benchpathClbBenchmarks',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_competencies_list',
      collection: 'benchpathClbCompetencies',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_indicators_list',
      collection: 'benchpathClbIndicators',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_profile_of_ability_list',
      collection: 'benchpathClbProfileOfAbility',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_features_of_communication_list',
      collection: 'benchpathClbFeaturesOfCommunication',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_sample_task_labels_list',
      collection: 'benchpathClbSampleTaskLabels',
      filter: activeOrApproved,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_tasks_list',
      collection: 'benchpathTasks',
      filter: orgFilter,
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_framework_picker_default',
      collection: 'benchpathClbFrameworks',
      filter: {
        ...orgFilter,
        status: { $in: ['active', 'approved', 'reviewed'] }
      },
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_skill_picker_default',
      collection: 'benchpathClbSkills',
      filter: {
        ...orgFilter,
        status: { $in: ['active', 'approved', 'reviewed'] }
      },
      sort: { updatedAt: -1, id: -1 },
      limit: 50
    },
    {
      key: 'benchpath_benchmark_picker_default',
      collection: 'benchpathClbBenchmarks',
      filter: {
        ...orgFilter,
        status: { $in: ['active', 'approved', 'reviewed'] }
      },
      sort: { updatedAt: -1, id: -1 },
      limit: 50
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

  console.log(`[benchpath:mongo-validate] db=${config.dbName}`);

  const client = new MongoClient(config.uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);

    const collections = [
      'benchpathSources',
      'benchpathSourceFragments',
      'benchpathClbFrameworks',
      'benchpathClbStages',
      'benchpathClbSkills',
      'benchpathClbCompetencyAreas',
      'benchpathClbBenchmarks',
      'benchpathClbCompetencies',
      'benchpathClbIndicators',
      'benchpathClbProfileOfAbility',
      'benchpathClbFeaturesOfCommunication',
      'benchpathClbSampleTaskLabels',
      'benchpathTasks'
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

    const sample = {
      orgId: await findSampleOrgId(db, collections)
    };

    const checks = buildExplainChecks(sample);
    const explainResults = await runExplainChecks(db, checks);

    console.log('\n[benchpath:mongo-validate] collection counts');
    collections.forEach((name) => {
      console.log(`  - ${name}: ${counts[name]}`);
    });

    console.log('\n[benchpath:mongo-validate] key indexes');
    collections.forEach((name) => {
      console.log(`  - ${name}: ${(indexSummary[name] || []).join(', ')}`);
    });

    console.log('\n[benchpath:mongo-validate] sample ids');
    console.log(`  - orgId: ${sample.orgId || '-'}`);

    console.log('\n[benchpath:mongo-validate] explain summary');
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
      if (s.hasCollscan) return true;
      if (s.hasSortStage && !s.indexNames.length) return true;
      if (s.docsPerReturned !== null && s.docsPerReturned > 20) return true;
      return false;
    });

    console.log('\n[benchpath:mongo-validate] candidates-for-optimization');
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
  console.error(`[benchpath:mongo-validate][error] ${error.message}`);
  process.exitCode = 1;
});

