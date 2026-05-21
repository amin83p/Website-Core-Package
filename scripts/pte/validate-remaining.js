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
  const runs = Math.max(3, Math.min(20, Number.parseInt(String(args.runs || '7'), 10) || 7));
  return {
    repoRoot,
    uri,
    dbName,
    runs,
  };
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

function walkPlanStages(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const stage = String(node.stage || '').trim();
  if (stage) out.push({ stage, indexName: String(node.indexName || '').trim() });

  ['inputStage', 'outerStage', 'innerStage', 'leftChild', 'rightChild', 'queryPlan', 'winningPlan']
    .forEach((key) => {
      if (node[key] && typeof node[key] === 'object') walkPlanStages(node[key], out);
    });
  ['inputStages', 'children', 'shards'].forEach((key) => {
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
  return {
    indexNames,
    hasCollscan: stages.some((row) => row.stage === 'COLLSCAN'),
    hasSortStage: stages.some((row) => row.stage === 'SORT'),
    nReturned: Number(execution?.nReturned || 0),
    totalDocsExamined: Number(execution?.totalDocsExamined || 0),
    executionTimeMillis: Number(execution?.executionTimeMillis || 0)
  };
}

async function findSampleOrgId(db) {
  const collections = [
    'pteApplicants',
    'pteTeachers',
    'pteCourses',
    'pteQuestionVersions',
    'pteTestVersions',
    'pteAttemptSessions'
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
  return '';
}

async function measureFindTiming(db, check = {}, runs = 7) {
  const timings = [];
  let returnedRows = 0;
  const collection = db.collection(check.collection);

  const warmupCursor = collection.find(check.filter || {}, { projection: check.projection || undefined });
  if (check.sort && Object.keys(check.sort).length) warmupCursor.sort(check.sort);
  if (Number(check.limit || 0) > 0) warmupCursor.limit(Number(check.limit));
  await warmupCursor.toArray();

  for (let i = 0; i < runs; i += 1) {
    const start = nowMs();
    let cursor = collection.find(check.filter || {}, { projection: check.projection || undefined });
    if (check.sort && Object.keys(check.sort).length) cursor = cursor.sort(check.sort);
    if (Number(check.limit || 0) > 0) cursor = cursor.limit(Number(check.limit));
    // eslint-disable-next-line no-await-in-loop
    const rows = await cursor.toArray();
    const durationMs = nowMs() - start;
    timings.push(durationMs);
    returnedRows = rows.length;
  }

  const explainCursor = collection.find(check.filter || {}, { projection: check.projection || undefined });
  if (check.sort && Object.keys(check.sort).length) explainCursor.sort(check.sort);
  if (Number(check.limit || 0) > 0) explainCursor.limit(Number(check.limit));
  const explain = await explainCursor.explain('executionStats');

  return {
    stats: summarizeSamples(timings),
    returnedRows,
    explain: summarizeExplain(explain)
  };
}

async function measureCountTiming(db, check = {}, runs = 3) {
  const timings = [];
  const collection = db.collection(check.collection);
  let countValue = 0;
  for (let i = 0; i < runs; i += 1) {
    const start = nowMs();
    // eslint-disable-next-line no-await-in-loop
    countValue = await collection.countDocuments(check.filter || {});
    const durationMs = nowMs() - start;
    timings.push(durationMs);
  }
  return {
    countValue,
    stats: summarizeSamples(timings)
  };
}

async function runPerformanceChecks(db, orgId = '', runs = 7) {
  const orgFilter = orgId ? { orgId } : {};
  const checks = [
    {
      key: 'students_list',
      collection: 'pteApplicants',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50,
      projection: { id: 1, orgId: 1, status: 1, personId: 1, userId: 1, applicantId: 1, audit: 1, _id: 0 }
    },
    {
      key: 'teachers_list',
      collection: 'pteTeachers',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50,
      projection: { id: 1, orgId: 1, status: 1, personId: 1, userId: 1, teacherId: 1, audit: 1, _id: 0 }
    },
    {
      key: 'courses_list',
      collection: 'pteCourses',
      filter: orgFilter,
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50,
      projection: { id: 1, orgId: 1, status: 1, name: 1, courseType: 1, level: 1, audit: 1, _id: 0 }
    },
    {
      key: 'students_picker_default',
      collection: 'pteApplicants',
      filter: { ...orgFilter, status: 'active', personRoleToken: 'PTE_Student' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50,
      projection: { id: 1, orgId: 1, personId: 1, userId: 1, applicantId: 1, audit: 1, _id: 0 }
    },
    {
      key: 'teachers_picker_default',
      collection: 'pteTeachers',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50,
      projection: { id: 1, orgId: 1, personId: 1, userId: 1, teacherId: 1, audit: 1, _id: 0 }
    },
    {
      key: 'courses_picker_default',
      collection: 'pteCourses',
      filter: { ...orgFilter, status: 'active' },
      sort: { 'audit.createDateTime': -1, id: -1 },
      limit: 50,
      projection: { id: 1, orgId: 1, name: 1, status: 1, audit: 1, _id: 0 }
    }
  ];

  const output = [];
  for (const check of checks) {
    // eslint-disable-next-line no-await-in-loop
    const [findTiming, countTiming] = await Promise.all([
      measureFindTiming(db, check, runs),
      measureCountTiming(db, check, Math.max(3, Math.min(8, Math.ceil(runs / 2))))
    ]);
    output.push({
      ...check,
      findTiming,
      countTiming
    });
  }
  return output;
}

function extractRouteBlocks(content = '') {
  const blocks = [];
  const pattern = /router\.(get|post|put|patch|delete)\s*\([\s\S]*?\);\s*/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const blockText = String(match[0] || '');
    const method = String(match[1] || '').toLowerCase();
    const pathMatch = blockText.match(/router\.\w+\s*\(\s*(['"`])([^'"`]+)\1/);
    const routePath = String(pathMatch?.[2] || '').trim();
    blocks.push({
      method,
      routePath,
      blockText
    });
  }
  return blocks;
}

function relativePath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

function runRoutePermissionChecks(repoRoot) {
  const dir = path.join(repoRoot, 'MVC', 'routes', 'pte');
  const files = fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.js'))
    .sort((a, b) => a.localeCompare(b));

  const results = [];
  const findings = [];
  files.forEach((name) => {
    const abs = path.join(dir, name);
    const content = fs.readFileSync(abs, 'utf8');
    const isGatewayRouteFile = name === 'pteMainRoute.js';
    const hasRequireAuth = /router\.use\(\s*requireAuth\s*\)/.test(content);
    const routeBlocks = extractRouteBlocks(content);
    const routeRows = routeBlocks.map((row) => {
      const hasRequireAccess = isGatewayRouteFile ? true : /requireAccess\s*\(/.test(row.blockText);
      const hasTrackActionState = isGatewayRouteFile ? true : /trackActionState\s*\(/.test(row.blockText);
      if (!hasRequireAccess || !hasTrackActionState) {
        findings.push({
          file: relativePath(repoRoot, abs),
          method: row.method.toUpperCase(),
          routePath: row.routePath || '/',
          missing: [
            !hasRequireAccess ? 'requireAccess' : '',
            !hasTrackActionState ? 'trackActionState' : ''
          ].filter(Boolean)
        });
      }
      return {
        method: row.method.toUpperCase(),
        routePath: row.routePath || '/',
        hasRequireAccess,
        hasTrackActionState
      };
    });

    if (!hasRequireAuth && !isGatewayRouteFile) {
      findings.push({
        file: relativePath(repoRoot, abs),
        method: '-',
        routePath: '*',
        missing: ['router.use(requireAuth)']
      });
    }

    results.push({
      file: relativePath(repoRoot, abs),
      hasRequireAuth,
      routesCount: routeRows.length,
      routeRows
    });
  });

  return {
    files: results,
    findings
  };
}

async function findSectionByName(sectionsCollection, name = '') {
  const token = String(name || '').trim();
  if (!token) return null;
  return sectionsCollection.findOne({
    name: {
      $regex: new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    }
  });
}

function collectSubsectionIds(section = {}) {
  const rows = Array.isArray(section?.subsections) ? section.subsections : [];
  return new Set(
    rows
      .map((entry) => String(entry?.id || '').trim())
      .filter(Boolean)
  );
}

async function runDataSanityChecks(db) {
  const collectionNames = [
    'pteApplicants',
    'pteTeachers',
    'pteCourses',
    'pteQuestionVersions',
    'pteTestVersions',
    'sections'
  ];

  const counts = {};
  await Promise.all(collectionNames.map(async (name) => {
    counts[name] = await db.collection(name).estimatedDocumentCount();
  }));

  const duplicateTeachers = await db.collection('pteTeachers').aggregate([
    {
      $match: {
        orgId: { $exists: true, $type: 'string', $gt: '' },
        personId: { $exists: true, $type: 'string', $gt: '' }
      }
    },
    {
      $group: {
        _id: { orgId: '$orgId', personId: '$personId' },
        count: { $sum: 1 },
        ids: { $push: '$id' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 }
  ]).toArray();

  const coursesMissingCourseTypeBackfill = await db.collection('pteCourses').find({
    $and: [
      {
        $or: [
          { courseType: { $exists: false } },
          { courseType: null },
          { courseType: '' }
        ]
      },
      { level: { $in: ['CORE', 'ACADEMIC'] } }
    ]
  }, {
    projection: { _id: 0, id: 1, orgId: 1, level: 1, courseType: 1 }
  }).limit(20).toArray();

  const coursesInvalidType = await db.collection('pteCourses').find({
    $and: [
      {
        $or: [
          { courseType: { $exists: false } },
          { courseType: null },
          { courseType: { $nin: ['CORE', 'ACADEMIC'] } }
        ]
      },
      {
        $or: [
          { level: { $exists: false } },
          { level: null },
          { level: { $nin: ['CORE', 'ACADEMIC'] } }
        ]
      }
    ]
  }, {
    projection: { _id: 0, id: 1, orgId: 1, level: 1, courseType: 1 }
  }).limit(20).toArray();

  const applicantRoleOutliers = await db.collection('pteApplicants').find({
    personRoleToken: {
      $exists: true,
      $type: 'string',
      $nin: ['PTE_Student', '']
    }
  }, {
    projection: { _id: 0, id: 1, orgId: 1, personRoleToken: 1 }
  }).limit(20).toArray();

  const publishedTests = await db.collection('pteTestVersions').find({
    status: 'published'
  }, {
    projection: { _id: 0, id: 1, orgId: 1, code: 1, allocations: 1 }
  }).limit(300).toArray();

  const publishedTestsMissingSkills = (Array.isArray(publishedTests) ? publishedTests : [])
    .filter((row) => {
      const allocations = row?.allocations && typeof row.allocations === 'object' ? row.allocations : {};
      const speaking = Array.isArray(allocations.speaking) ? allocations.speaking.length : 0;
      const writing = Array.isArray(allocations.writing) ? allocations.writing.length : 0;
      const reading = Array.isArray(allocations.reading) ? allocations.reading.length : 0;
      const listening = Array.isArray(allocations.listening) ? allocations.listening.length : 0;
      return speaking < 1 || writing < 1 || reading < 1 || listening < 1;
    })
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      orgId: row.orgId,
      code: row.code
    }));

  const sectionsCollection = db.collection('sections');
  const sectionNames = [
    'PTE',
    'PTE_PEOPLE',
    'PTE_STUDENTS',
    'PTE_PUBLIC_APPLICANTS',
    'PTE_TEACHERS',
    'PTE_QUESTIONS_BANK',
    'PTE_TESTS',
    'PTE_COURSES',
    'PTE_PRACTICE',
    'PTE_PRACTICE_BY_SKILLS',
    'PTE_FEEDBACK',
    'PTE_FEEDBACK_ON_PRACTICE'
  ];

  const sectionRows = {};
  for (const name of sectionNames) {
    // eslint-disable-next-line no-await-in-loop
    sectionRows[name] = await findSectionByName(sectionsCollection, name);
  }

  const missingSections = sectionNames.filter((name) => !sectionRows[name]);
  const pteSubIds = collectSubsectionIds(sectionRows.PTE || {});
  const peopleSubIds = collectSubsectionIds(sectionRows.PTE_PEOPLE || {});
  const feedbackSubIds = collectSubsectionIds(sectionRows.PTE_FEEDBACK || {});

  const relationFindings = [];
  const idByName = Object.fromEntries(
    Object.entries(sectionRows).map(([name, row]) => [name, String(row?.id || '').trim()])
  );
  const expectPteChildren = [
    'PTE_PEOPLE',
    'PTE_QUESTIONS_BANK',
    'PTE_TESTS',
    'PTE_COURSES',
    'PTE_PRACTICE',
    'PTE_FEEDBACK'
  ];
  expectPteChildren.forEach((name) => {
    const id = idByName[name];
    if (id && !pteSubIds.has(id)) relationFindings.push(`PTE missing child link: ${name}`);
  });
  ['PTE_STUDENTS', 'PTE_PUBLIC_APPLICANTS', 'PTE_TEACHERS'].forEach((name) => {
    const id = idByName[name];
    if (id && !peopleSubIds.has(id)) relationFindings.push(`PTE_PEOPLE missing child link: ${name}`);
  });
  {
    const id = idByName.PTE_FEEDBACK_ON_PRACTICE;
    if (id && !feedbackSubIds.has(id)) relationFindings.push('PTE_FEEDBACK missing child link: PTE_FEEDBACK_ON_PRACTICE');
  }

  return {
    counts,
    duplicateTeachers,
    coursesMissingCourseTypeBackfill,
    coursesInvalidType,
    applicantRoleOutliers,
    publishedTestsMissingSkills,
    missingSections,
    relationFindings
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConnectionConfig(args);
  if (!config.uri) {
    throw new Error('Mongo URI is missing. Pass --uri or set MONGODB_URI (legacy MONGO_URI supported).');
  }

  console.log(`[pte:validate-remaining] db=${config.dbName} runs=${config.runs}`);
  const client = new MongoClient(config.uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000
  });

  try {
    await client.connect();
    const db = client.db(config.dbName);

    const sampleOrgId = await findSampleOrgId(db);
    const [performance, routeChecks, sanity] = await Promise.all([
      runPerformanceChecks(db, sampleOrgId, config.runs),
      Promise.resolve(runRoutePermissionChecks(config.repoRoot)),
      runDataSanityChecks(db)
    ]);

    console.log('\n[pte:validate-remaining] sample org');
    console.log(`  - orgId: ${sampleOrgId || '-'}`);

    console.log('\n[pte:validate-remaining] timing + explain');
    performance.forEach((row) => {
      const explain = row.findTiming.explain || {};
      const indexes = Array.isArray(explain.indexNames) && explain.indexNames.length
        ? explain.indexNames.join('|')
        : '-';
      console.log(`  - ${row.key}`);
      console.log(`    findMs[min/p50/p95/max/avg]=${row.findTiming.stats.min}/${row.findTiming.stats.p50}/${row.findTiming.stats.p95}/${row.findTiming.stats.max}/${row.findTiming.stats.avg} returned=${row.findTiming.returnedRows}`);
      console.log(`    countMs[min/p50/p95/max/avg]=${row.countTiming.stats.min}/${row.countTiming.stats.p50}/${row.countTiming.stats.p95}/${row.countTiming.stats.max}/${row.countTiming.stats.avg} count=${row.countTiming.countValue}`);
      console.log(`    explain index=${indexes} collscan=${explain.hasCollscan ? 'yes' : 'no'} sortStage=${explain.hasSortStage ? 'yes' : 'no'} docsExamined=${explain.totalDocsExamined} nReturned=${explain.nReturned}`);
    });

    console.log('\n[pte:validate-remaining] route permission coverage');
    routeChecks.files.forEach((fileRow) => {
      console.log(`  - ${fileRow.file}: routes=${fileRow.routesCount} requireAuth=${fileRow.hasRequireAuth ? 'yes' : 'no'}`);
    });
    if (!routeChecks.findings.length) {
      console.log('  - findings: none');
    } else {
      routeChecks.findings.forEach((finding) => {
        console.log(`  - finding: ${finding.file} ${finding.method} ${finding.routePath} missing=${finding.missing.join('|')}`);
      });
    }

    console.log('\n[pte:validate-remaining] data sanity');
    Object.entries(sanity.counts || {}).forEach(([name, count]) => {
      console.log(`  - ${name}: ${Number(count || 0)}`);
    });
    console.log(`  - duplicateTeachers: ${sanity.duplicateTeachers.length}`);
    console.log(`  - coursesMissingCourseTypeBackfill: ${sanity.coursesMissingCourseTypeBackfill.length}`);
    console.log(`  - coursesInvalidType: ${sanity.coursesInvalidType.length}`);
    console.log(`  - applicantRoleOutliers: ${sanity.applicantRoleOutliers.length}`);
    console.log(`  - publishedTestsMissingSkills: ${sanity.publishedTestsMissingSkills.length}`);
    console.log(`  - missingSections: ${sanity.missingSections.length}`);
    console.log(`  - relationFindings: ${sanity.relationFindings.length}`);

    if (sanity.duplicateTeachers.length) {
      console.log('  - duplicateTeachers sample:');
      sanity.duplicateTeachers.forEach((row) => {
        console.log(`    * org=${row?._id?.orgId || '-'} person=${row?._id?.personId || '-'} count=${row?.count || 0} ids=${Array.isArray(row?.ids) ? row.ids.join(',') : '-'}`);
      });
    }
    if (sanity.coursesMissingCourseTypeBackfill.length) {
      console.log('  - coursesMissingCourseTypeBackfill sample:');
      sanity.coursesMissingCourseTypeBackfill.forEach((row) => {
        console.log(`    * id=${row?.id || '-'} org=${row?.orgId || '-'} level=${row?.level || '-'} courseType=${row?.courseType || '-'}`);
      });
    }
    if (sanity.coursesInvalidType.length) {
      console.log('  - coursesInvalidType sample:');
      sanity.coursesInvalidType.forEach((row) => {
        console.log(`    * id=${row?.id || '-'} org=${row?.orgId || '-'} level=${row?.level || '-'} courseType=${row?.courseType || '-'}`);
      });
    }
    if (sanity.applicantRoleOutliers.length) {
      console.log('  - applicantRoleOutliers sample:');
      sanity.applicantRoleOutliers.forEach((row) => {
        console.log(`    * id=${row?.id || '-'} org=${row?.orgId || '-'} role=${row?.personRoleToken || '-'}`);
      });
    }
    if (sanity.publishedTestsMissingSkills.length) {
      console.log('  - publishedTestsMissingSkills sample:');
      sanity.publishedTestsMissingSkills.forEach((row) => {
        console.log(`    * id=${row?.id || '-'} org=${row?.orgId || '-'} code=${row?.code || '-'}`);
      });
    }
    if (sanity.missingSections.length) {
      console.log(`  - missing section names: ${sanity.missingSections.join(', ')}`);
    }
    if (sanity.relationFindings.length) {
      sanity.relationFindings.forEach((row) => console.log(`  - relation finding: ${row}`));
    }

    const optimizationCandidates = performance
      .filter((row) => {
        const hasCollscan = row.findTiming.explain?.hasCollscan === true;
        const p95 = Number(row.findTiming.stats.p95 || 0);
        const avg = Number(row.findTiming.stats.avg || 0);
        return hasCollscan || (p95 > 300 && avg > 120);
      })
      .map((row) => ({
        key: row.key,
        p95: row.findTiming.stats.p95,
        collscan: row.findTiming.explain?.hasCollscan === true
      }));

    console.log('\n[pte:validate-remaining] summary');
    if (!optimizationCandidates.length && !routeChecks.findings.length && !sanity.relationFindings.length && !sanity.missingSections.length) {
      console.log('  - status=pass');
    } else {
      console.log('  - status=needs-attention');
    }
    if (optimizationCandidates.length) {
      optimizationCandidates.forEach((row) => {
        console.log(`  - perf candidate: ${row.key} p95Ms=${row.p95} collscan=${row.collscan ? 'yes' : 'no'}`);
      });
    } else {
      console.log('  - perf candidates: none');
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[pte:validate-remaining][error] ${error.message}`);
  process.exitCode = 1;
});
