const fs = require('fs').promises;
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const REFERENCE_DIR = path.join(ROOT_DIR, 'data', 'benchpath', 'reference');
const SCRIPT_ID = 'scripts/benchpath/reference/generateReferenceScaffolds.js';
const REPORT_PATH = path.join(REFERENCE_DIR, 'benchpath-reference-scaffold-report.json');

const FILES = Object.freeze({
  skills: 'clb.skills.json',
  competencies: 'clb.competencies.json',
  sourceFragments: 'source-fragments.json',
  indicators: 'clb.indicators.json',
  features: 'clb.features-of-communication.json',
  sampleTaskLabels: 'clb.sample-task-labels.json'
});

function nowIso() {
  return new Date().toISOString();
}

function s(value) {
  return String(value == null ? '' : value).trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNum(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function slugify(value) {
  return s(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function benchmarkLevel(benchmarkId) {
  const match = s(benchmarkId).match(/:(\d+)$/);
  if (!match) return null;
  return toNum(match[1]);
}

function parseCompetencyAreaToken(areaId) {
  const raw = s(areaId);
  const parts = raw.split(':');
  if (parts.length < 3) return 'area';
  return slugify(parts.slice(2).join('-')) || 'area';
}

function parseSkillToken(skillId) {
  const parts = s(skillId).split(':');
  if (parts.length < 2) return slugify(skillId) || 'skill';
  return slugify(parts[1]) || 'skill';
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run')
  };
}

function isEligibleFragment(fragment) {
  return s(fragment?.status).toLowerCase() === 'approved'
    && s(fragment?.reviewStatus).toLowerCase() === 'reviewed'
    && Boolean(fragment?.isActive !== false);
}

function buildFragmentIndexes(fragmentDb) {
  const byMappedType = new Map();
  const byMappedEntityId = new Map();

  const push = (map, key, value) => {
    const normalized = s(key);
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push(value);
  };

  toArray(fragmentDb?.allIds).forEach((id) => {
    const fragment = fragmentDb.itemsById?.[id];
    if (!fragment || !isEligibleFragment(fragment)) return;

    const mappedType = s(fragment.mappedEntityType).toLowerCase();
    push(byMappedType, mappedType, fragment);
    toArray(fragment.mappedEntityIds).forEach((mappedId) => push(byMappedEntityId, mappedId, fragment));
  });

  return { byMappedType, byMappedEntityId };
}

function fragmentSkillMatch(fragment, skillToken) {
  const haystack = [
    fragment?.title,
    fragment?.summary,
    fragment?.text,
    ...(toArray(fragment?.sectionPath)),
    ...(toArray(fragment?.tags))
  ].map((entry) => s(entry).toLowerCase()).join(' ');
  if (!haystack) return false;
  return haystack.includes(skillToken.toLowerCase());
}

function findSupportingFragment(entityTypeKey, competency, fragmentIndex) {
  const benchmarkId = s(competency?.benchmarkId);
  const competencyId = s(competency?.id);
  const skillToken = parseSkillToken(competency?.skillId);

  const mappedType = entityTypeKey === 'features'
    ? 'featureofcommunication'
    : entityTypeKey === 'sampleTaskLabels'
      ? 'sampletasklabel'
      : 'indicator';

  const candidates = [
    ...toArray(fragmentIndex.byMappedEntityId.get(competencyId)),
    ...toArray(fragmentIndex.byMappedEntityId.get(benchmarkId)),
    ...toArray(fragmentIndex.byMappedType.get(mappedType))
  ];

  if (candidates.length === 0) return null;

  const unique = new Map();
  candidates.forEach((fragment) => unique.set(s(fragment.id), fragment));
  const normalizedCandidates = [...unique.values()];

  if (entityTypeKey === 'sampleTaskLabels') {
    const directSkill = normalizedCandidates.find((fragment) => fragmentSkillMatch(fragment, skillToken));
    if (directSkill) return directSkill;
    return null;
  }

  if (entityTypeKey === 'features') {
    return normalizedCandidates[0] || null;
  }

  return normalizedCandidates[0] || null;
}

function mergeSourceRefs(baseRefs, supportingFragment) {
  const refs = toArray(baseRefs).map((ref) => ({
    sourceId: s(ref?.sourceId),
    fragmentId: s(ref?.fragmentId) || null,
    pages: Array.isArray(ref?.pages) ? ref.pages : null,
    note: s(ref?.note) || null
  })).filter((ref) => ref.sourceId);

  if (!supportingFragment) return refs;

  const sourceId = s(supportingFragment.sourceId);
  const fragmentId = s(supportingFragment.id);
  if (!sourceId || !fragmentId) return refs;

  const exists = refs.some((ref) => ref.sourceId === sourceId && ref.fragmentId === fragmentId);
  if (exists) return refs;

  refs.push({
    sourceId,
    fragmentId,
    pages: (() => {
      const start = toNum(supportingFragment.pageStart);
      const end = toNum(supportingFragment.pageEnd);
      if (start == null || end == null) return null;
      return [start, end];
    })(),
    note: `Starter scaffold support from ${fragmentId}`
  });
  return refs;
}

function baseRecord({
  id,
  slug,
  code,
  title,
  shortTitle,
  frameworkId,
  skillId,
  stageId,
  benchmarkId,
  competencyAreaId,
  competencyId,
  description,
  domainNotes,
  relatedIds,
  tags,
  sourceRefs,
  orgId
}) {
  const timestamp = nowIso();
  return {
    id,
    slug,
    code,
    title,
    shortTitle,
    frameworkId,
    skillId,
    stageId,
    benchmarkId,
    competencyAreaId,
    competencyId,
    description,
    domainNotes,
    relatedIds,
    tags,
    sourceRefs,
    status: 'draft',
    reviewStatus: 'pending',
    isActive: true,
    isSystem: true,
    isLocked: false,
    notes: null,
    createdBy: 'system',
    updatedBy: 'system',
    approvedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    version: 1,
    extensions: {},
    orgId: orgId || 'SYSTEM'
  };
}

function buildIndicatorRecord(competency, skillMeta, fragmentIndex) {
  const skillToken = parseSkillToken(competency.skillId);
  const benchmark = benchmarkLevel(competency.benchmarkId);
  const areaToken = parseCompetencyAreaToken(competency.competencyAreaId);
  const skillCode = s(skillMeta?.code) || skillToken.slice(0, 1).toUpperCase();
  const benchmarkLabel = benchmark != null ? String(benchmark).padStart(2, '0') : '00';
  const id = `ind:${skillToken}:${benchmark || 'x'}:${areaToken}:001`;
  const supportingFragment = findSupportingFragment('indicators', competency, fragmentIndex);
  const refs = mergeSourceRefs(competency.sourceRefs, supportingFragment);

  const record = baseRecord({
    id,
    slug: slugify(`indicator-${skillToken}-${benchmark || 'x'}-${areaToken}-001`),
    code: `IND-${skillCode}-${benchmarkLabel}-01`,
    title: `Indicator Seed - ${s(skillMeta?.title) || skillToken} CLB ${benchmark || '?'} - ${s(competency.title) || areaToken}`,
    shortTitle: `IND ${skillCode}${benchmarkLabel}`,
    frameworkId: s(competency.frameworkId),
    skillId: s(competency.skillId),
    stageId: s(competency.stageId),
    benchmarkId: s(competency.benchmarkId),
    competencyAreaId: s(competency.competencyAreaId),
    competencyId: s(competency.id),
    description: 'Starter indicator scaffold placeholder. Replace with canonical indicator wording supported by authoritative source fragments.',
    domainNotes: 'Seed rule: create one starter indicator per competency seed until direct mapped indicator fragments are available.',
    relatedIds: [s(competency.id), s(competency.benchmarkId), s(competency.competencyAreaId)].filter(Boolean),
    tags: ['seed', 'clb', 'indicator', skillToken, `benchmark-${benchmark || 'x'}`],
    sourceRefs: refs,
    orgId: s(competency.orgId) || 'SYSTEM'
  });

  record.indicatorText = 'Starter indicator placeholder (non-canonical)';
  record.indicatorCategory = 'to_be_defined';
  record.indicatorDimension = 'to_be_defined';
  record.evidenceType = 'to_be_defined';
  record.extensions = {
    requiresCanonicalTextReview: true,
    scaffoldRule: 'seed_from_competency',
    scaffoldSource: SCRIPT_ID,
    canonicalState: supportingFragment ? 'seeded_with_fragment_support' : 'seeded',
    seededFromCompetencyId: s(competency.id),
    fragmentSupport: supportingFragment
      ? { fragmentId: s(supportingFragment.id), sourceId: s(supportingFragment.sourceId) }
      : null
  };
  return record;
}

function buildFeatureRecord(competency, skillMeta, fragmentIndex) {
  const skillToken = parseSkillToken(competency.skillId);
  const benchmark = benchmarkLevel(competency.benchmarkId);
  const areaToken = parseCompetencyAreaToken(competency.competencyAreaId);
  const skillCode = s(skillMeta?.code) || skillToken.slice(0, 1).toUpperCase();
  const benchmarkLabel = benchmark != null ? String(benchmark).padStart(2, '0') : '00';
  const id = `foc:${skillToken}:${benchmark || 'x'}:${areaToken}:001`;
  const supportingFragment = findSupportingFragment('features', competency, fragmentIndex);
  const refs = mergeSourceRefs(competency.sourceRefs, supportingFragment);

  const record = baseRecord({
    id,
    slug: slugify(`feature-${skillToken}-${benchmark || 'x'}-${areaToken}-001`),
    code: `FOC-${skillCode}-${benchmarkLabel}-01`,
    title: `Feature Seed - ${s(skillMeta?.title) || skillToken} CLB ${benchmark || '?'} - ${s(competency.title) || areaToken}`,
    shortTitle: `FOC ${skillCode}${benchmarkLabel}`,
    frameworkId: s(competency.frameworkId),
    skillId: s(competency.skillId),
    stageId: s(competency.stageId),
    benchmarkId: s(competency.benchmarkId),
    competencyAreaId: s(competency.competencyAreaId),
    competencyId: s(competency.id),
    description: 'Starter feature-of-communication scaffold placeholder. Replace with canonical descriptor text from mapped fragments.',
    domainNotes: 'Seed rule: create one starter feature record per competency seed to avoid empty feature layer.',
    relatedIds: [s(competency.id), s(competency.benchmarkId), s(competency.competencyAreaId)].filter(Boolean),
    tags: ['seed', 'clb', 'feature-of-communication', skillToken, `benchmark-${benchmark || 'x'}`],
    sourceRefs: refs,
    orgId: s(competency.orgId) || 'SYSTEM'
  });

  record.scopeType = 'competency';
  record.scopeSkillId = s(competency.skillId);
  record.scopeBenchmarkId = s(competency.benchmarkId);
  record.scopeCompetencyId = s(competency.id);
  record.featureDimension = 'to_be_defined';
  record.complexityLevel = 'to_be_defined';
  record.featureValue = 'Starter placeholder (non-canonical)';
  record.extensions = {
    requiresCanonicalTextReview: true,
    scaffoldRule: 'seed_from_competency',
    scaffoldSource: SCRIPT_ID,
    canonicalState: supportingFragment ? 'seeded_with_fragment_support' : 'seeded',
    seededFromCompetencyId: s(competency.id),
    fragmentSupport: supportingFragment
      ? { fragmentId: s(supportingFragment.id), sourceId: s(supportingFragment.sourceId) }
      : null
  };
  return record;
}

function buildSampleTaskLabelRecord(competency, skillMeta, fragmentIndex) {
  const skillToken = parseSkillToken(competency.skillId);
  const benchmark = benchmarkLevel(competency.benchmarkId);
  const areaToken = parseCompetencyAreaToken(competency.competencyAreaId);
  const skillCode = s(skillMeta?.code) || skillToken.slice(0, 1).toUpperCase();
  const benchmarkLabel = benchmark != null ? String(benchmark).padStart(2, '0') : '00';
  const id = `stl:${skillToken}:${benchmark || 'x'}:${areaToken}:001`;
  const supportingFragment = findSupportingFragment('sampleTaskLabels', competency, fragmentIndex);
  const refs = mergeSourceRefs(competency.sourceRefs, supportingFragment);

  const record = baseRecord({
    id,
    slug: slugify(`sample-task-${skillToken}-${benchmark || 'x'}-${areaToken}-001`),
    code: `STL-${skillCode}-${benchmarkLabel}-01`,
    title: `Sample Task Seed - ${s(skillMeta?.title) || skillToken} CLB ${benchmark || '?'} - ${s(competency.title) || areaToken}`,
    shortTitle: `STL ${skillCode}${benchmarkLabel}`,
    frameworkId: s(competency.frameworkId),
    skillId: s(competency.skillId),
    stageId: s(competency.stageId),
    benchmarkId: s(competency.benchmarkId),
    competencyAreaId: s(competency.competencyAreaId),
    competencyId: s(competency.id),
    description: 'Starter sample-task-label scaffold placeholder. Replace with canonical sample task labels from mapped fragments.',
    domainNotes: 'Seed rule: create one starter sample-task-label per competency seed until direct mapped sample-task fragments are available.',
    relatedIds: [s(competency.id), s(competency.benchmarkId), s(competency.competencyAreaId)].filter(Boolean),
    tags: ['seed', 'clb', 'sample-task-label', skillToken, `benchmark-${benchmark || 'x'}`],
    sourceRefs: refs,
    orgId: s(competency.orgId) || 'SYSTEM'
  });

  record.taskLabelText = supportingFragment
    ? (s(supportingFragment.summary) || s(supportingFragment.excerptLabel) || 'Starter sample task label placeholder (fragment-supported)')
    : 'Starter sample task label placeholder (non-canonical)';
  record.contextDomain = 'to_be_defined';
  record.taskType = 'to_be_defined';
  record.officialSample = false;
  record.linkedBenchmarkId = s(competency.benchmarkId);
  record.linkedCompetencyId = s(competency.id);
  record.extensions = {
    requiresCanonicalTextReview: true,
    scaffoldRule: 'seed_from_competency',
    scaffoldSource: SCRIPT_ID,
    canonicalState: supportingFragment ? 'seeded_with_fragment_support' : 'seeded',
    seededFromCompetencyId: s(competency.id),
    fragmentSupport: supportingFragment
      ? { fragmentId: s(supportingFragment.id), sourceId: s(supportingFragment.sourceId) }
      : null
  };
  return record;
}

function rebuildIndexes(db, includeCompetencyIndex = false) {
  const indexes = {
    byStatus: {},
    byReviewStatus: {},
    byFrameworkId: {},
    bySkillId: {},
    byBenchmarkId: {},
    byOrgId: {}
  };
  if (includeCompetencyIndex) indexes.byCompetencyId = {};

  const ids = toArray(db?.allIds);
  ids.forEach((id) => {
    const item = db?.itemsById?.[id];
    if (!item) return;

    const map = (bucket, value) => {
      const key = s(value);
      if (!key) return;
      if (!indexes[bucket][key]) indexes[bucket][key] = [];
      indexes[bucket][key].push(id);
    };

    map('byStatus', item.status);
    map('byReviewStatus', item.reviewStatus);
    map('byFrameworkId', item.frameworkId);
    map('bySkillId', item.skillId);
    map('byBenchmarkId', item.benchmarkId);
    map('byOrgId', item.orgId || 'SYSTEM');
    if (includeCompetencyIndex) map('byCompetencyId', item.competencyId || item.linkedCompetencyId || item.scopeCompetencyId);
  });

  Object.keys(indexes).forEach((bucket) => {
    Object.keys(indexes[bucket]).forEach((key) => indexes[bucket][key].sort());
  });

  db.indexes = indexes;
  return db;
}

function ensureDeterministicIds(db) {
  const idSet = new Set(Object.keys(db.itemsById || {}).map((id) => s(id)).filter(Boolean));
  db.allIds = [...idSet].sort();
  return db;
}

function upsertRecord(db, record) {
  if (!db.itemsById || typeof db.itemsById !== 'object') db.itemsById = {};
  const id = s(record.id);
  if (!id) return false;
  const exists = Boolean(db.itemsById[id]);
  if (!exists) {
    db.itemsById[id] = record;
    return true;
  }
  return false;
}

function buildSkillMap(skillDb) {
  const out = new Map();
  toArray(skillDb?.allIds).forEach((id) => {
    const item = skillDb.itemsById?.[id];
    if (!item) return;
    out.set(s(item.id), item);
  });
  return out;
}

function createEntityScaffolds(entityKey, targetDb, competencies, skillMap, fragmentIndex) {
  const createdIds = [];
  const withFragmentSupport = [];
  const withoutFragmentSupport = [];

  const builder = entityKey === 'indicators'
    ? buildIndicatorRecord
    : entityKey === 'features'
      ? buildFeatureRecord
      : buildSampleTaskLabelRecord;

  competencies.forEach((competency) => {
    const skillMeta = skillMap.get(s(competency.skillId));
    const record = builder(competency, skillMeta, fragmentIndex);
    const created = upsertRecord(targetDb, record);
    if (!created) return;
    createdIds.push(record.id);
    if (record.extensions?.fragmentSupport?.fragmentId) withFragmentSupport.push(record.id);
    else withoutFragmentSupport.push(record.id);
  });

  ensureDeterministicIds(targetDb);
  const includeComp = true;
  rebuildIndexes(targetDb, includeComp);
  if (targetDb?.meta && typeof targetDb.meta === 'object') {
    targetDb.meta.updatedAt = nowIso();
  }

  return {
    createdIds,
    withFragmentSupport,
    withoutFragmentSupport
  };
}

function summaryLine(entityLabel, info, beforeCount, afterCount) {
  return `- ${entityLabel}: before=${beforeCount}, after=${afterCount}, created=${info.createdIds.length}, withFragment=${info.withFragmentSupport.length}, seedRuleOnly=${info.withoutFragmentSupport.length}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [skillsDb, competenciesDb, fragmentsDb, indicatorsDb, featuresDb, sampleDb] = await Promise.all([
    readJson(path.join(REFERENCE_DIR, FILES.skills)),
    readJson(path.join(REFERENCE_DIR, FILES.competencies)),
    readJson(path.join(REFERENCE_DIR, FILES.sourceFragments)),
    readJson(path.join(REFERENCE_DIR, FILES.indicators)),
    readJson(path.join(REFERENCE_DIR, FILES.features)),
    readJson(path.join(REFERENCE_DIR, FILES.sampleTaskLabels))
  ]);

  const skillMap = buildSkillMap(skillsDb);
  const competencies = toArray(competenciesDb?.allIds).map((id) => competenciesDb.itemsById?.[id]).filter(Boolean);
  const fragmentIndex = buildFragmentIndexes(fragmentsDb);

  const indicatorsBefore = toArray(indicatorsDb?.allIds).length;
  const featuresBefore = toArray(featuresDb?.allIds).length;
  const sampleBefore = toArray(sampleDb?.allIds).length;

  const indicatorInfo = createEntityScaffolds('indicators', indicatorsDb, competencies, skillMap, fragmentIndex);
  const featureInfo = createEntityScaffolds('features', featuresDb, competencies, skillMap, fragmentIndex);
  const sampleInfo = createEntityScaffolds('sampleTaskLabels', sampleDb, competencies, skillMap, fragmentIndex);

  const indicatorsAfter = toArray(indicatorsDb?.allIds).length;
  const featuresAfter = toArray(featuresDb?.allIds).length;
  const sampleAfter = toArray(sampleDb?.allIds).length;

  const report = {
    meta: {
      generatedAt: nowIso(),
      script: SCRIPT_ID,
      dryRun: args.dryRun
    },
    inputs: {
      competencyCount: competencies.length,
      fragmentCount: toArray(fragmentsDb?.allIds).length
    },
    entities: {
      indicators: {
        beforeCount: indicatorsBefore,
        afterCount: indicatorsAfter,
        ...indicatorInfo
      },
      featuresOfCommunication: {
        beforeCount: featuresBefore,
        afterCount: featuresAfter,
        ...featureInfo
      },
      sampleTaskLabels: {
        beforeCount: sampleBefore,
        afterCount: sampleAfter,
        ...sampleInfo
      }
    },
    validationRuleHint: 'If mapped fragment coverage exists for indicators/features/sampleTaskLabels, corresponding entity files must not remain empty.'
  };

  if (!args.dryRun) {
    await Promise.all([
      writeJson(path.join(REFERENCE_DIR, FILES.indicators), indicatorsDb),
      writeJson(path.join(REFERENCE_DIR, FILES.features), featuresDb),
      writeJson(path.join(REFERENCE_DIR, FILES.sampleTaskLabels), sampleDb),
      writeJson(REPORT_PATH, report)
    ]);
  }

  console.log('BenchPath Reference Scaffold Generation');
  console.log('======================================');
  console.log(`Dry run: ${args.dryRun ? 'yes' : 'no'}`);
  console.log(summaryLine('Indicators', indicatorInfo, indicatorsBefore, indicatorsAfter));
  console.log(summaryLine('Features Of Communication', featureInfo, featuresBefore, featuresAfter));
  console.log(summaryLine('Sample Task Labels', sampleInfo, sampleBefore, sampleAfter));
  if (!args.dryRun) {
    console.log(`Scaffold report: ${REPORT_PATH}`);
  }
}

main().catch((error) => {
  console.error('BenchPath scaffold generation failed.');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
