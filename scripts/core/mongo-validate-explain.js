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

async function findSampleIds(db) {
  const sample = {
    orgId: '',
    userId: '',
    assigneeUserId: '',
    groupId: ''
  };

  const orgRows = await Promise.all([
    db.collection('organizations').find(
      { id: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { id: 1, _id: 0 } }
    ).limit(1).toArray(),
    db.collection('contracts').find(
      { orgId: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { orgId: 1, _id: 0 } }
    ).limit(1).toArray(),
    db.collection('orgPolicies').find(
      { orgId: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { orgId: 1, _id: 0 } }
    ).limit(1).toArray()
  ]);

  sample.orgId = String(
    orgRows?.[0]?.[0]?.id
      || orgRows?.[1]?.[0]?.orgId
      || orgRows?.[2]?.[0]?.orgId
      || ''
  ).trim();

  const userRows = await Promise.all([
    db.collection('users').find(
      { id: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { id: 1, _id: 0 } }
    ).limit(1).toArray(),
    db.collection('tasks').find(
      { 'assignees.userId': { $exists: true, $type: 'string', $gt: '' } },
      { projection: { assignees: 1, _id: 0 } }
    ).limit(1).toArray()
  ]);

  sample.userId = String(userRows?.[0]?.[0]?.id || '').trim();
  sample.assigneeUserId = String(userRows?.[1]?.[0]?.assignees?.[0]?.userId || sample.userId || '').trim();

  const groupRows = await Promise.all([
    db.collection('subscriptionGroups').find(
      { id: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { id: 1, _id: 0 } }
    ).limit(1).toArray(),
    db.collection('newsletterSubscriptions').find(
      { groupId: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { groupId: 1, _id: 0 } }
    ).limit(1).toArray()
  ]);

  sample.groupId = String(groupRows?.[0]?.[0]?.id || groupRows?.[1]?.[0]?.groupId || '').trim();

  return sample;
}

function buildExplainChecks(sample = {}) {
  const userFilter = sample.userId ? { userId: sample.userId } : {};
  const assigneeFilter = sample.assigneeUserId ? { 'assignees.userId': sample.assigneeUserId } : {};
  const orgFilter = sample.orgId ? { orgId: sample.orgId } : {};
  const groupFilter = sample.groupId ? { groupId: sample.groupId } : {};

  return [
    { key: 'users_default_list', collection: 'users', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'persons_default_list', collection: 'persons', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'organizations_default_list', collection: 'organizations', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'sections_default_list', collection: 'sections', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'symbols_default_list', collection: 'symbols', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'access_policies_list', collection: 'accessPolicies', filter: orgFilter, sort: { orgId: 1, status: 1, id: 1 }, limit: 50 },
    { key: 'table_settings_list', collection: 'tableSettings', filter: userFilter, sort: { 'audit.lastUpdateDateTime': -1 }, limit: 50 },
    { key: 'accesses_default_list', collection: 'accesses', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'operations_default_list', collection: 'operations', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'scopes_default_list', collection: 'scopes', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'sessions_by_user', collection: 'sessions', filter: userFilter, sort: { expiresAt: 1 }, limit: 50 },
    { key: 'logs_recent', collection: 'logs', filter: {}, sort: { timestamp: -1 }, limit: 100 },
    { key: 'contracts_org_list', collection: 'contracts', filter: orgFilter, sort: { orgId: 1, startDate: -1 }, limit: 50 },
    { key: 'org_policies_org_list', collection: 'orgPolicies', filter: orgFilter, sort: { 'audit.lastUpdateDateTime': -1 }, limit: 50 },
    { key: 'contacts_messages_list', collection: 'contacts', filter: { status: { $in: ['Unread', 'Under view', 'Done'] } }, sort: { 'audit.createDateTime': -1 }, limit: 100 },
    { key: 'news_feed_list', collection: 'news', filter: { status: { $in: ['draft', 'published', 'archived'] } }, sort: { 'meta.publishDate': -1 }, limit: 100 },
    { key: 'news_manage_list', collection: 'news', filter: {}, sort: { 'audit.lastUpdateDateTime': -1 }, limit: 100 },
    { key: 'newsletter_admin_list', collection: 'newsletterSubscriptions', filter: {}, sort: { subscribedAt: -1 }, limit: 100 },
    { key: 'newsletter_group_members', collection: 'newsletterSubscriptions', filter: groupFilter, sort: { subscribedAt: -1 }, limit: 100 },
    { key: 'subscription_groups_list', collection: 'subscriptionGroups', filter: {}, sort: { id: 1 }, limit: 50 },
    { key: 'tasks_assignee_list', collection: 'tasks', filter: assigneeFilter, sort: { 'audit.lastUpdateDateTime': -1 }, limit: 100 },
    { key: 'user_memberships_user_list', collection: 'userMemberships', filter: userFilter, sort: { 'audit.lastUpdateDateTime': -1 }, limit: 100 },
    { key: 'help_manage_list', collection: 'helpArticles', filter: {}, sort: { priority: -1, updatedAt: -1 }, limit: 100 }
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

  console.log(`[core:mongo-validate] db=${config.dbName}`);

  const client = new MongoClient(config.uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);

    const collections = [
      'users',
      'persons',
      'organizations',
      'sections',
      'symbols',
      'accessPolicies',
      'tableSettings',
      'accesses',
      'operations',
      'scopes',
      'sessions',
      'logs',
      'contracts',
      'orgPolicies',
      'contacts',
      'news',
      'newsletterSubscriptions',
      'subscriptionGroups',
      'tasks',
      'userMemberships',
      'helpArticles'
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

    const sample = await findSampleIds(db);
    const checks = buildExplainChecks(sample);
    const explainResults = await runExplainChecks(db, checks);

    console.log('\n[core:mongo-validate] collection counts');
    collections.forEach((name) => {
      console.log(`  - ${name}: ${counts[name]}`);
    });

    console.log('\n[core:mongo-validate] key indexes');
    collections.forEach((name) => {
      console.log(`  - ${name}: ${(indexSummary[name] || []).join(', ')}`);
    });

    console.log('\n[core:mongo-validate] sample ids');
    console.log(`  - orgId: ${sample.orgId || '-'}`);
    console.log(`  - userId: ${sample.userId || '-'}`);
    console.log(`  - assigneeUserId: ${sample.assigneeUserId || '-'}`);
    console.log(`  - groupId: ${sample.groupId || '-'}`);

    console.log('\n[core:mongo-validate] explain summary');
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
      if (s.docsPerReturned !== null && s.docsPerReturned > 30) return true;
      return false;
    });

    console.log('\n[core:mongo-validate] candidates-for-optimization');
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
  console.error(`[core:mongo-validate][error] ${error.message}`);
  process.exitCode = 1;
});

