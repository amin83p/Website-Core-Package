#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const settingService = require('../../MVC/services/settingService');
const benchpathDataService = require('../../MVC/services/benchpath/benchpathDataService');
const { applyGenericFilter } = require('../../MVC/utils/queryEngine');
const paginate = require('../../MVC/utils/paginationHelper');

const IN_MEMORY_DEFAULT_SORT_THRESHOLD = 500;

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
      out[token.slice(2, eq).trim()] = token.slice(eq + 1).trim();
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

  const runs = Math.max(5, Math.min(30, Number.parseInt(String(args.runs || '9'), 10) || 9));
  const page = Math.max(1, Number.parseInt(String(args.page || '1'), 10) || 1);
  const limit = Math.max(1, Number.parseInt(String(args.limit || '20'), 10) || 20);

  return { uri, dbName, runs, page, limit };
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function percentile(sorted = [], ratio = 0.5) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[idx] || 0);
}

function summarizeSamples(samples = []) {
  const rows = (Array.isArray(samples) ? samples : [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value));
  if (!rows.length) return { min: 0, p50: 0, p95: 0, max: 0, avg: 0, count: 0 };

  const sorted = rows.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    min: Number(sorted[0].toFixed(2)),
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number((sum / sorted.length).toFixed(2)),
    count: sorted.length
  };
}

function normalizeSortDirection(value) {
  return String(value || '').toLowerCase() === 'desc' ? -1 : 1;
}

function comparePrimitiveValues(a, b) {
  const left = a == null ? '' : a;
  const right = b == null ? '' : b;

  const leftNum = typeof left === 'number' ? left : Number.parseFloat(String(left));
  const rightNum = typeof right === 'number' ? right : Number.parseFloat(String(right));
  const bothNumeric = Number.isFinite(leftNum) && Number.isFinite(rightNum) && String(left).trim() !== '' && String(right).trim() !== '';
  if (bothNumeric) {
    if (leftNum < rightNum) return -1;
    if (leftNum > rightNum) return 1;
    return 0;
  }

  const leftText = String(left).toLowerCase();
  const rightText = String(right).toLowerCase();
  return leftText.localeCompare(rightText);
}

function sortByDefaultConfig(rows = [], sortSpec = []) {
  const rules = Array.isArray(sortSpec) ? sortSpec.filter((entry) => entry && entry.key) : [];
  if (!rules.length) return Array.isArray(rows) ? rows : [];

  const copy = [...rows];
  copy.sort((a, b) => {
    for (const rule of rules) {
      const direction = normalizeSortDirection(rule.dir);
      const result = comparePrimitiveValues(a?.[rule.key], b?.[rule.key]);
      if (result !== 0) return result * direction;
    }
    return comparePrimitiveValues(a?.id, b?.id);
  });
  return copy;
}

function buildSortExpressionFromConfig(sortSpec = []) {
  const rules = Array.isArray(sortSpec) ? sortSpec.filter((entry) => entry && entry.key) : [];
  if (!rules.length) return '';
  return rules
    .map((rule) => (String(rule.dir || '').toLowerCase() === 'desc' ? `-${rule.key}` : `${rule.key}`))
    .join(',');
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function buildRouteChecks({ page = 1, limit = 20 } = {}) {
  const listConfigSort = {
    clbCompetencyAreas: [
      { key: 'frameworkId', dir: 'asc' },
      { key: 'skillId', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    clbBenchmarks: [
      { key: 'skillId', dir: 'asc' },
      { key: 'benchmarkNumber', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    clbCompetencies: [
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'competencyAreaId', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    clbIndicators: [
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'competencyId', dir: 'asc' },
      { key: 'indicatorCategory', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    clbProfileOfAbility: [
      { key: 'skillId', dir: 'asc' },
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    clbFeaturesOfCommunication: [
      { key: 'scopeType', dir: 'asc' },
      { key: 'skillId', dir: 'asc' },
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'featureDimension', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    clbSampleTaskLabels: [
      { key: 'linkedBenchmarkId', dir: 'asc' },
      { key: 'linkedCompetencyId', dir: 'asc' },
      { key: 'contextDomain', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ]
  };

  const base = { page, limit };
  return [
    { routePath: '/benchpath/sources', entityType: 'sources', query: { ...base } },
    { routePath: '/benchpath/source-fragments', entityType: 'sourceFragments', query: { ...base } },
    { routePath: '/benchpath/clb-framework', entityType: 'clbFrameworks', query: { ...base } },
    { routePath: '/benchpath/clb-stages', entityType: 'clbStages', query: { ...base } },
    { routePath: '/benchpath/clb-skills', entityType: 'clbSkills', query: { ...base } },
    {
      routePath: '/benchpath/clb-competency-areas',
      entityType: 'clbCompetencyAreas',
      query: { ...base },
      defaultSort: listConfigSort.clbCompetencyAreas,
      adaptiveDefaultSort: true
    },
    {
      routePath: '/benchpath/clb-benchmarks',
      entityType: 'clbBenchmarks',
      query: { ...base },
      defaultSort: listConfigSort.clbBenchmarks,
      adaptiveDefaultSort: true
    },
    {
      routePath: '/benchpath/clb-competencies',
      entityType: 'clbCompetencies',
      query: { ...base },
      defaultSort: listConfigSort.clbCompetencies,
      adaptiveDefaultSort: true
    },
    {
      routePath: '/benchpath/clb-indicators',
      entityType: 'clbIndicators',
      query: { ...base },
      defaultSort: listConfigSort.clbIndicators,
      adaptiveDefaultSort: true
    },
    {
      routePath: '/benchpath/clb-profile-of-ability',
      entityType: 'clbProfileOfAbility',
      query: { ...base },
      defaultSort: listConfigSort.clbProfileOfAbility,
      adaptiveDefaultSort: true
    },
    {
      routePath: '/benchpath/clb-features-of-communication',
      entityType: 'clbFeaturesOfCommunication',
      query: { ...base },
      defaultSort: listConfigSort.clbFeaturesOfCommunication,
      adaptiveDefaultSort: true
    },
    {
      routePath: '/benchpath/clb-sample-task-labels',
      entityType: 'clbSampleTaskLabels',
      query: { ...base },
      defaultSort: listConfigSort.clbSampleTaskLabels,
      adaptiveDefaultSort: true
    },
    { routePath: '/benchpath/tasks', entityType: 'benchpathTasks', query: { ...base } }
  ];
}

async function findSampleOrgId(db) {
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
  for (const name of collections) {
    // eslint-disable-next-line no-await-in-loop
    const row = await db.collection(name).find(
      { orgId: { $exists: true, $type: 'string', $gt: '' } },
      { projection: { orgId: 1, _id: 0 } }
    ).limit(1).toArray();
    const orgId = String(row?.[0]?.orgId || '').trim();
    if (orgId) return orgId;
  }
  return 'SYSTEM';
}

async function measureLegacyRoute(routeCheck, requestingUser, runs = 9) {
  const timings = [];
  const query = routeCheck?.query && typeof routeCheck.query === 'object' ? { ...routeCheck.query } : {};
  const filterQuery = stripPaginationFromQuery(query);
  let rowCount = 0;
  let totalRows = 0;

  // Warmup
  await benchpathDataService.fetchData(routeCheck.entityType, {}, requestingUser);

  for (let i = 0; i < runs; i += 1) {
    const start = nowMs();
    // eslint-disable-next-line no-await-in-loop
    const all = await benchpathDataService.fetchData(routeCheck.entityType, {}, requestingUser);
    let filtered = applyGenericFilter(all, filterQuery, {});
    if (Array.isArray(routeCheck.defaultSort) && routeCheck.defaultSort.length) {
      filtered = sortByDefaultConfig(filtered, routeCheck.defaultSort);
    }
    const { data, pagination } = paginate(filtered, query.page, query.limit);
    const duration = nowMs() - start;
    timings.push(duration);
    rowCount = Array.isArray(data) ? data.length : 0;
    totalRows = Number(pagination?.totalItems || 0);
  }

  return {
    stats: summarizeSamples(timings),
    rowCount,
    totalRows
  };
}

async function measureCurrentRoute(routeCheck, requestingUser, runs = 9) {
  const timings = [];
  let rowCount = 0;
  let totalRows = 0;

  const query = routeCheck?.query && typeof routeCheck.query === 'object' ? { ...routeCheck.query } : {};
  const hasUserSort = Boolean(String(query.sort || '').trim() || String(query.order || '').trim());

  // Warmup
  if (routeCheck.adaptiveDefaultSort === true && !hasUserSort && Array.isArray(routeCheck.defaultSort) && routeCheck.defaultSort.length) {
    const fullQuery = stripPaginationFromQuery(query);
    const fullRows = await benchpathDataService.fetchData(routeCheck.entityType, fullQuery, requestingUser);
    if (fullRows.length > IN_MEMORY_DEFAULT_SORT_THRESHOLD) {
      const sortExpr = buildSortExpressionFromConfig(routeCheck.defaultSort);
      if (sortExpr) query.sort = sortExpr;
      await benchpathDataService.fetchDataPaged(routeCheck.entityType, query, requestingUser);
    }
  } else {
    if (!query.sort && Array.isArray(routeCheck.defaultSort) && routeCheck.defaultSort.length) {
      const sortExpr = buildSortExpressionFromConfig(routeCheck.defaultSort);
      if (sortExpr) query.sort = sortExpr;
    }
    await benchpathDataService.fetchDataPaged(routeCheck.entityType, query, requestingUser);
  }

  for (let i = 0; i < runs; i += 1) {
    const start = nowMs();
    let paged = null;
    if (routeCheck.adaptiveDefaultSort === true && !hasUserSort && Array.isArray(routeCheck.defaultSort) && routeCheck.defaultSort.length) {
      const fullQuery = stripPaginationFromQuery(query);
      // eslint-disable-next-line no-await-in-loop
      const fullRows = await benchpathDataService.fetchData(routeCheck.entityType, fullQuery, requestingUser);
      if (fullRows.length <= IN_MEMORY_DEFAULT_SORT_THRESHOLD) {
        const sortedRows = sortByDefaultConfig(fullRows, routeCheck.defaultSort);
        paged = paginate(sortedRows, query.page, query.limit);
        paged = { rows: paged.data, totalRows: paged.pagination.totalItems };
      } else {
        const sortedQuery = { ...query };
        const sortExpr = buildSortExpressionFromConfig(routeCheck.defaultSort);
        if (sortExpr) sortedQuery.sort = sortExpr;
        // eslint-disable-next-line no-await-in-loop
        paged = await benchpathDataService.fetchDataPaged(routeCheck.entityType, sortedQuery, requestingUser);
      }
    } else {
      const sortedQuery = { ...query };
      if (!sortedQuery.sort && Array.isArray(routeCheck.defaultSort) && routeCheck.defaultSort.length) {
        const sortExpr = buildSortExpressionFromConfig(routeCheck.defaultSort);
        if (sortExpr) sortedQuery.sort = sortExpr;
      }
      // eslint-disable-next-line no-await-in-loop
      paged = await benchpathDataService.fetchDataPaged(routeCheck.entityType, sortedQuery, requestingUser);
    }
    const duration = nowMs() - start;
    timings.push(duration);
    rowCount = Array.isArray(paged?.rows) ? paged.rows.length : 0;
    totalRows = Number(paged?.totalRows || 0);
  }

  return {
    stats: summarizeSamples(timings),
    rowCount,
    totalRows
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConnectionConfig(args);

  if (!config.uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

  // Keep setting reads stable to avoid warning noise in timing output.
  try {
    await settingService.init();
  } catch (_) {}

  const client = new MongoClient(config.uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);
    const orgId = await findSampleOrgId(db);
    const requestingUser = {
      id: 'BENCHPATH_BENCHMARK_AGENT',
      activeOrgId: orgId,
      isVirtualSuperAdmin: false
    };
    const checks = buildRouteChecks({ page: config.page, limit: config.limit });

    console.log(`[benchpath:route-timing] db=${config.dbName} orgId=${orgId} runs=${config.runs} page=${config.page} limit=${config.limit}`);

    const rows = [];
    for (const check of checks) {
      // eslint-disable-next-line no-await-in-loop
      const before = await measureLegacyRoute(check, requestingUser, config.runs);
      // eslint-disable-next-line no-await-in-loop
      const after = await measureCurrentRoute(check, requestingUser, config.runs);
      const p50Speedup = after.stats.p50 > 0 ? Number((before.stats.p50 / after.stats.p50).toFixed(2)) : 0;
      const p95Speedup = after.stats.p95 > 0 ? Number((before.stats.p95 / after.stats.p95).toFixed(2)) : 0;
      rows.push({
        routePath: check.routePath,
        entityType: check.entityType,
        rowsReturned: after.rowCount,
        totalRows: after.totalRows,
        before,
        after,
        p50Speedup,
        p95Speedup
      });
    }

    console.log('\n[benchpath:route-timing] results');
    rows.forEach((row) => {
      console.log(`  - ${row.routePath} (${row.entityType})`);
      console.log(`    beforeMs[min/p50/p95/max/avg]=${row.before.stats.min}/${row.before.stats.p50}/${row.before.stats.p95}/${row.before.stats.max}/${row.before.stats.avg}`);
      console.log(`    afterMs[min/p50/p95/max/avg]=${row.after.stats.min}/${row.after.stats.p50}/${row.after.stats.p95}/${row.after.stats.max}/${row.after.stats.avg}`);
      console.log(`    speedup[p50/p95]=${row.p50Speedup}x/${row.p95Speedup}x rows=${row.rowsReturned}/${row.totalRows}`);
    });

    const avgBeforeP50 = summarizeSamples(rows.map((row) => row.before.stats.p50));
    const avgAfterP50 = summarizeSamples(rows.map((row) => row.after.stats.p50));
    const avgBeforeP95 = summarizeSamples(rows.map((row) => row.before.stats.p95));
    const avgAfterP95 = summarizeSamples(rows.map((row) => row.after.stats.p95));
    const aggregateP50Speedup = avgAfterP50.avg > 0 ? Number((avgBeforeP50.avg / avgAfterP50.avg).toFixed(2)) : 0;
    const aggregateP95Speedup = avgAfterP95.avg > 0 ? Number((avgBeforeP95.avg / avgAfterP95.avg).toFixed(2)) : 0;

    console.log('\n[benchpath:route-timing] aggregate');
    console.log(`  - avgP50 before=${avgBeforeP50.avg}ms after=${avgAfterP50.avg}ms speedup=${aggregateP50Speedup}x`);
    console.log(`  - avgP95 before=${avgBeforeP95.avg}ms after=${avgAfterP95.avg}ms speedup=${aggregateP95Speedup}x`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[benchpath:route-timing][error] ${error.message}`);
  process.exitCode = 1;
});
