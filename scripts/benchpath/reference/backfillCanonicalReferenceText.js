const fs = require('fs').promises;
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const REFERENCE_DIR = path.join(ROOT_DIR, 'data', 'benchpath', 'reference');
const REPORT_PATH = path.join(REFERENCE_DIR, 'benchpath-canonical-backfill-report.json');
const SCRIPT_PATH = 'scripts/benchpath/reference/backfillCanonicalReferenceText.js';

const FILES = Object.freeze({
  sourceFragments: 'source-fragments.json',
  benchmarks: 'clb.benchmarks.json',
  competencyAreas: 'clb.competency-areas.json',
  competencies: 'clb.competencies.json',
  profileOfAbility: 'clb.profile-of-ability.json',
  indicators: 'clb.indicators.json',
  sampleTaskLabels: 'clb.sample-task-labels.json',
  featuresOfCommunication: 'clb.features-of-communication.json'
});

const SOURCE_ID = 'source:clb:2012';
const ORG_ID = 'SYSTEM';
const EXPECTED_SKILLS = new Set(['listening', 'speaking', 'reading', 'writing']);
const EXPECTED_LEVELS = new Set([1, 2, 3, 4]);

function nowIso() {
  return new Date().toISOString();
}

function s(value) {
  return String(value == null ? '' : value).trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function toNum(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return s(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function titleCase(value) {
  const normalized = s(value).replace(/[_-]+/g, ' ');
  if (!normalized) return '';
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function benchmarkInfoFromId(benchmarkId) {
  const match = s(benchmarkId).match(/^benchmark:([a-z]+):(\d{1,2})$/i);
  if (!match) return null;
  const skill = match[1].toLowerCase();
  const level = toNum(match[2]);
  return { skill, level };
}

function isClb14BenchmarkId(benchmarkId) {
  const info = benchmarkInfoFromId(benchmarkId);
  if (!info) return false;
  return EXPECTED_SKILLS.has(info.skill) && EXPECTED_LEVELS.has(info.level);
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run')
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function isApprovedAuthorityFragment(fragment) {
  return s(fragment?.status).toLowerCase() === 'approved'
    && s(fragment?.reviewStatus).toLowerCase() === 'reviewed'
    && s(fragment?.authorityLevel).toLowerCase() === 'official';
}

function fragmentBenchmarkIds(fragment) {
  return arr(fragment?.mappedEntityIds).filter((id) => s(id).startsWith('benchmark:'));
}

function fragmentInClb14Scope(fragment) {
  if (s(fragment?.sourceId) !== SOURCE_ID) return false;
  return fragmentBenchmarkIds(fragment).some((benchmarkId) => isClb14BenchmarkId(benchmarkId));
}

function fragmentPages(fragment) {
  const start = toNum(fragment?.pageStart);
  const end = toNum(fragment?.pageEnd);
  if (start == null || end == null) return null;
  return [start, end];
}

function mergeSourceRefs(existingRefs, fragment, notePrefix = 'Canonical backfill') {
  const refs = arr(existingRefs).map((ref) => ({
    sourceId: s(ref?.sourceId),
    fragmentId: s(ref?.fragmentId) || null,
    pages: Array.isArray(ref?.pages) ? ref.pages : null,
    note: s(ref?.note) || null
  })).filter((ref) => ref.sourceId);

  const sourceId = s(fragment?.sourceId);
  const fragmentId = s(fragment?.id);
  if (!sourceId || !fragmentId) return refs;

  const nextRef = {
    sourceId,
    fragmentId,
    pages: fragmentPages(fragment),
    note: `${notePrefix}: ${fragmentId}`
  };

  const idx = refs.findIndex((ref) => ref.sourceId === sourceId && ref.fragmentId === fragmentId);
  if (idx >= 0) {
    refs[idx] = {
      ...refs[idx],
      pages: refs[idx].pages || nextRef.pages,
      note: refs[idx].note || nextRef.note
    };
  } else {
    refs.push(nextRef);
  }

  return refs;
}

function setCanonicalState(record, state, fragment) {
  const next = { ...record };
  const extensions = next.extensions && typeof next.extensions === 'object' ? { ...next.extensions } : {};
  extensions.canonicalState = state;
  if (fragment) {
    extensions.requiresCanonicalTextReview = false;
    extensions.canonicalProvenance = {
      source: 'sourceFragments',
      fragmentId: s(fragment.id),
      sourceId: s(fragment.sourceId),
      pageStart: toNum(fragment.pageStart),
      pageEnd: toNum(fragment.pageEnd)
    };
  }
  next.extensions = extensions;
  return next;
}

function updateAuditFields(record, actor = 'system') {
  const next = { ...record };
  next.updatedAt = nowIso();
  next.updatedBy = actor || next.updatedBy || 'system';
  next.version = Number.isFinite(Number(next.version)) ? Number(next.version) + 1 : 1;
  return next;
}

function finalizeDb(db, options = {}) {
  const includeCompetency = Boolean(options.includeCompetency);
  const ids = Object.keys(db?.itemsById || {}).map((id) => s(id)).filter(Boolean).sort();
  db.allIds = ids;

  const indexes = {
    byStatus: {},
    byReviewStatus: {},
    byFrameworkId: {},
    bySkillId: {},
    byBenchmarkId: {},
    byOrgId: {}
  };
  if (includeCompetency) indexes.byCompetencyId = {};

  const map = (bucket, key, id) => {
    const normalized = s(key);
    if (!normalized) return;
    if (!indexes[bucket][normalized]) indexes[bucket][normalized] = [];
    indexes[bucket][normalized].push(id);
  };

  ids.forEach((id) => {
    const item = db.itemsById[id];
    if (!item) return;
    map('byStatus', item.status, id);
    map('byReviewStatus', item.reviewStatus, id);
    map('byFrameworkId', item.frameworkId, id);
    map('bySkillId', item.skillId, id);
    map('byBenchmarkId', item.benchmarkId, id);
    map('byOrgId', item.orgId || ORG_ID, id);
    if (includeCompetency) {
      map('byCompetencyId', item.competencyId || item.linkedCompetencyId || item.scopeCompetencyId, id);
    }
  });

  Object.keys(indexes).forEach((bucket) => {
    Object.keys(indexes[bucket]).forEach((key) => {
      indexes[bucket][key] = Array.from(new Set(indexes[bucket][key])).sort();
    });
  });

  db.indexes = indexes;
  if (db?.meta && typeof db.meta === 'object') db.meta.updatedAt = nowIso();
  return db;
}

function buildFragmentIndexes(fragmentDb) {
  const approvedAuthority = [];
  const clb14 = [];
  const byMappedId = new Map();
  const byType = new Map();

  const push = (map, key, value) => {
    const normalized = s(key);
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push(value);
  };

  arr(fragmentDb?.allIds).forEach((id) => {
    const fragment = fragmentDb?.itemsById?.[id];
    if (!fragment || !isApprovedAuthorityFragment(fragment)) return;
    approvedAuthority.push(fragment);

    if (!fragmentInClb14Scope(fragment)) return;
    clb14.push(fragment);

    const typeKey = s(fragment.mappedEntityType).toLowerCase();
    push(byType, typeKey, fragment);
    arr(fragment.mappedEntityIds).forEach((mappedId) => push(byMappedId, mappedId, fragment));
  });

  return { approvedAuthority, clb14, byMappedId, byType };
}

function bestFragmentForMappedId(mappedId, expectedType, fragmentIndex) {
  const candidates = arr(fragmentIndex.byMappedId.get(s(mappedId)))
    .filter((fragment) => s(fragment.mappedEntityType).toLowerCase() === s(expectedType).toLowerCase());
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const scoreA = (toNum(a.pageStart) || 9999);
    const scoreB = (toNum(b.pageStart) || 9999);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return s(a.id).localeCompare(s(b.id));
  });
  return candidates[0];
}

function bestFragmentByBenchmark(benchmarkId, expectedType, fragmentIndex) {
  const candidates = arr(fragmentIndex.byMappedId.get(s(benchmarkId)))
    .filter((fragment) => s(fragment.mappedEntityType).toLowerCase() === s(expectedType).toLowerCase());
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const scoreA = (toNum(a.pageStart) || 9999);
    const scoreB = (toNum(b.pageStart) || 9999);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return s(a.id).localeCompare(s(b.id));
  });
  return candidates[0];
}

function clb14BenchmarkIds(benchmarkDb) {
  return arr(benchmarkDb?.allIds).filter((id) => isClb14BenchmarkId(id));
}

function buildLookupMap(db) {
  const out = new Map();
  arr(db?.allIds).forEach((id) => {
    const item = db.itemsById?.[id];
    if (!item) return;
    out.set(s(id), item);
  });
  return out;
}

function canonicalText(fragment) {
  const text = s(fragment?.text);
  if (text) return text;
  const summary = s(fragment?.summary);
  return summary;
}

function normalizeCanonicalTags(tags) {
  const drop = new Set(['seed', 'seeded', 'placeholder']);
  const normalized = arr(tags)
    .map((tag) => s(tag).toLowerCase())
    .filter(Boolean)
    .filter((tag) => !drop.has(tag));

  if (!normalized.includes('canonical')) normalized.push('canonical');
  return Array.from(new Set(normalized)).sort();
}

function updatePoaRecords(profileDb, benchmarkDb, fragmentIndex, actor = 'system') {
  const updated = clone(profileDb);
  const report = {
    totalClb14Records: 0,
    canonicalizedIds: [],
    unresolvedIds: [],
    changedCount: 0
  };

  const benchmarkMap = buildLookupMap(benchmarkDb);
  const targetIds = arr(updated.allIds).filter((id) => {
    const item = updated.itemsById[id];
    return item && isClb14BenchmarkId(item.benchmarkId);
  });

  report.totalClb14Records = targetIds.length;

  for (const id of targetIds) {
    const original = updated.itemsById[id];
    const poaId = s(original.id);
    const benchmarkId = s(original.benchmarkId);
    const fragment = bestFragmentForMappedId(poaId, 'profileOfAbility', fragmentIndex)
      || bestFragmentByBenchmark(benchmarkId, 'profileOfAbility', fragmentIndex);
    if (!fragment) {
      report.unresolvedIds.push(id);
      continue;
    }

    const next = { ...original };
    const text = canonicalText(fragment);
    if (!text) {
      report.unresolvedIds.push(id);
      continue;
    }

    next.description = text;
    next.domainNotes = 'Canonical profile-of-ability text backfilled from CLB 2012 benchmark-page fragment.';
    next.sourceRefs = mergeSourceRefs(original.sourceRefs, fragment, 'Canonical POA source');
    next.relatedIds = Array.from(new Set(arr(original.relatedIds).concat([benchmarkId]).filter(Boolean))).sort();
    next.tags = normalizeCanonicalTags(original.tags);
    next.status = 'reviewed';
    next.reviewStatus = 'reviewed';
    next.approvedBy = 'system';
    const benchmark = benchmarkMap.get(benchmarkId);
    if (benchmark) {
      next.frameworkId = s(benchmark.frameworkId) || next.frameworkId;
      next.skillId = s(benchmark.skillId) || next.skillId;
      next.stageId = s(benchmark.stageId) || next.stageId;
    }
    const canonical = setCanonicalState(next, 'canonical_fragment_backed', fragment);
    const audited = updateAuditFields(canonical, actor);
    audited.approvedAt = audited.updatedAt;
    updated.itemsById[id] = audited;
    report.canonicalizedIds.push(id);
    if (JSON.stringify(audited) !== JSON.stringify(original)) report.changedCount += 1;
  }

  finalizeDb(updated, { includeCompetency: false });
  return { updatedDb: updated, report };
}

function parseCompId(compId) {
  const match = s(compId).match(/^comp:([a-z]+):(\d{1,2}):([a-z_]+):(\d{3})$/i);
  if (!match) return null;
  return {
    skill: match[1].toLowerCase(),
    level: toNum(match[2]),
    areaKey: match[3].toLowerCase(),
    seq: match[4]
  };
}

function skillCodeFromSkill(skill) {
  const map = {
    listening: 'L',
    speaking: 'S',
    reading: 'R',
    writing: 'W'
  };
  return map[s(skill).toLowerCase()] || s(skill).slice(0, 1).toUpperCase() || 'X';
}

function createCanonicalCompetencyRecord({
  id,
  fragment,
  benchmark,
  competencyAreaId
}) {
  const parsed = parseCompId(id);
  const skill = parsed?.skill || benchmarkInfoFromId(benchmark.id)?.skill || s(benchmark.skillId).replace(/^skill:/, '');
  const level = parsed?.level || benchmarkInfoFromId(benchmark.id)?.level || 0;
  const areaKey = parsed?.areaKey || s(competencyAreaId).split(':').slice(2).join('_') || 'area';
  const skillCode = skillCodeFromSkill(skill);
  const levelLabel = String(level || 0).padStart(2, '0');
  const areaTitle = titleCase(areaKey);
  const timestamp = nowIso();
  const description = canonicalText(fragment);

  const base = {
    id,
    slug: slugify(`${skill}-${level}-${areaKey}-001`),
    code: `COMP-${skillCode}-${levelLabel}-${slugify(areaKey).slice(0, 4).toUpperCase() || 'AREA'}`,
    title: `${titleCase(skill)} CLB ${level} - ${areaTitle}`,
    shortTitle: `${skillCode}${levelLabel} ${areaTitle.slice(0, 14)}`.trim(),
    frameworkId: s(benchmark.frameworkId) || 'framework:clb',
    skillId: s(benchmark.skillId) || `skill:${skill}`,
    stageId: s(benchmark.stageId) || null,
    benchmarkId: s(benchmark.id) || `benchmark:${skill}:${level}`,
    competencyAreaId: s(competencyAreaId) || null,
    competencyId: id,
    description,
    domainNotes: 'Canonical competency text extracted from CLB 2012 benchmark-page fragment.',
    relatedIds: [
      s(benchmark.id),
      s(competencyAreaId),
      `poa:${skill}:${level}`
    ].filter(Boolean),
    tags: ['official', 'clb', 'competency', skill, 'stage-1', 'canonical'],
    sourceRefs: mergeSourceRefs([], fragment, 'Canonical competency source'),
    status: 'reviewed',
    reviewStatus: 'reviewed',
    isActive: true,
    isSystem: true,
    isLocked: false,
    notes: null,
    createdBy: 'system',
    updatedBy: 'system',
    approvedBy: 'system',
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: timestamp,
    version: 1,
    extensions: {
      canonicalState: 'canonical_fragment_backed',
      requiresCanonicalTextReview: false,
      canonicalProvenance: {
        source: 'sourceFragments',
        fragmentId: s(fragment.id),
        sourceId: s(fragment.sourceId),
        pageStart: toNum(fragment.pageStart),
        pageEnd: toNum(fragment.pageEnd)
      }
    },
    orgId: ORG_ID
  };

  return base;
}

function updateOrCreateCompetencies(competencyDb, benchmarkDb, fragmentIndex, actor = 'system') {
  const updated = clone(competencyDb);
  const report = {
    totalClb14Fragments: 0,
    createdIds: [],
    updatedIds: [],
    unresolvedFragmentIds: [],
    changedCount: 0
  };

  const benchmarkMap = buildLookupMap(benchmarkDb);
  const competencyFragments = arr(fragmentIndex.byType.get('competency'));
  report.totalClb14Fragments = competencyFragments.length;

  competencyFragments.forEach((fragment) => {
    const compId = arr(fragment.mappedEntityIds).find((id) => s(id).startsWith('comp:'));
    const benchmarkId = arr(fragment.mappedEntityIds).find((id) => s(id).startsWith('benchmark:'));
    const competencyAreaId = arr(fragment.mappedEntityIds).find((id) => s(id).startsWith('ca:'));
    const benchmark = benchmarkMap.get(s(benchmarkId));
    const text = canonicalText(fragment);
    if (!compId || !benchmark || !text) {
      report.unresolvedFragmentIds.push(s(fragment.id));
      return;
    }

    const existing = updated.itemsById[s(compId)];
    if (existing) {
      const next = { ...existing };
      next.description = text;
      next.domainNotes = 'Canonical competency text backfilled from CLB 2012 benchmark-page fragment.';
      next.frameworkId = s(benchmark.frameworkId) || next.frameworkId;
      next.skillId = s(benchmark.skillId) || next.skillId;
      next.stageId = s(benchmark.stageId) || next.stageId;
      next.benchmarkId = s(benchmark.id) || next.benchmarkId;
      next.competencyAreaId = s(competencyAreaId) || next.competencyAreaId;
      next.competencyId = s(compId);
      next.sourceRefs = mergeSourceRefs(existing.sourceRefs, fragment, 'Canonical competency source');
      next.relatedIds = Array.from(new Set(arr(existing.relatedIds).concat([
        s(benchmark.id),
        s(competencyAreaId)
      ]).filter(Boolean))).sort();
      const canonical = setCanonicalState(next, 'canonical_fragment_backed', fragment);
      const audited = updateAuditFields(canonical, actor);
      updated.itemsById[s(compId)] = audited;
      report.updatedIds.push(s(compId));
      if (JSON.stringify(audited) !== JSON.stringify(existing)) report.changedCount += 1;
      return;
    }

    const created = createCanonicalCompetencyRecord({
      id: s(compId),
      fragment,
      benchmark,
      competencyAreaId: s(competencyAreaId)
    });
    updated.itemsById[s(compId)] = created;
    report.createdIds.push(s(compId));
    report.changedCount += 1;
  });

  finalizeDb(updated, { includeCompetency: false });
  return { updatedDb: updated, report };
}

function parseMappedEntityIds(fragment) {
  const mapped = arr(fragment.mappedEntityIds).map((id) => s(id));
  const find = (prefix) => mapped.find((id) => id.startsWith(prefix));
  return {
    benchmarkId: find('benchmark:'),
    skillId: find('skill:'),
    competencyAreaId: find('ca:'),
    competencyId: find('comp:'),
    stageId: find('stage:')
  };
}

function createCanonicalEntityRecord(entityType, fragment, benchmark, mapped) {
  const mappedIdPrefix = entityType === 'indicator'
    ? 'ind:'
    : entityType === 'sampleTaskLabel'
      ? 'stl:'
      : 'foc:';
  const entityId = arr(fragment.mappedEntityIds).find((id) => s(id).startsWith(mappedIdPrefix));
  if (!entityId) return null;

  const benchmarkInfo = benchmarkInfoFromId(mapped.benchmarkId);
  const skill = benchmarkInfo?.skill || s(mapped.skillId).replace(/^skill:/, '') || '';
  const level = benchmarkInfo?.level || 0;
  const skillCode = skillCodeFromSkill(skill);
  const levelLabel = String(level).padStart(2, '0');
  const areaToken = s(mapped.competencyAreaId).split(':').slice(2).join('_') || 'area';
  const areaTitle = titleCase(areaToken);
  const text = canonicalText(fragment);
  if (!text) return null;
  const timestamp = nowIso();

  const common = {
    id: s(entityId),
    slug: slugify(`${entityType}-${skill}-${level}-${areaToken}`),
    code: `${entityType === 'indicator' ? 'IND' : entityType === 'sampleTaskLabel' ? 'STL' : 'FOC'}-${skillCode}-${levelLabel}-${slugify(areaToken).slice(0, 4).toUpperCase() || 'AREA'}`,
    title: `${titleCase(entityType === 'sampleTaskLabel' ? 'sample task' : entityType)} - ${titleCase(skill)} CLB ${level} - ${areaTitle}`,
    shortTitle: `${entityType === 'indicator' ? 'IND' : entityType === 'sampleTaskLabel' ? 'STL' : 'FOC'} ${skillCode}${levelLabel}`,
    frameworkId: s(benchmark.frameworkId) || 'framework:clb',
    skillId: s(benchmark.skillId) || s(mapped.skillId),
    stageId: s(benchmark.stageId) || s(mapped.stageId) || null,
    benchmarkId: s(benchmark.id) || s(mapped.benchmarkId),
    competencyAreaId: s(mapped.competencyAreaId) || null,
    competencyId: s(mapped.competencyId) || null,
    description: text,
    domainNotes: `Canonical ${entityType} text extracted from CLB 2012 benchmark-page fragment.`,
    relatedIds: [s(mapped.competencyId), s(mapped.benchmarkId), s(mapped.competencyAreaId)].filter(Boolean),
    tags: ['official', 'clb', entityType === 'sampleTaskLabel' ? 'sample-task-label' : entityType, skill, 'stage-1', 'canonical'],
    sourceRefs: mergeSourceRefs([], fragment, `Canonical ${entityType} source`),
    status: 'reviewed',
    reviewStatus: 'reviewed',
    isActive: true,
    isSystem: true,
    isLocked: false,
    notes: null,
    createdBy: 'system',
    updatedBy: 'system',
    approvedBy: 'system',
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: timestamp,
    version: 1,
    extensions: {
      canonicalState: 'canonical_fragment_backed',
      requiresCanonicalTextReview: false,
      canonicalProvenance: {
        source: 'sourceFragments',
        fragmentId: s(fragment.id),
        sourceId: s(fragment.sourceId),
        pageStart: toNum(fragment.pageStart),
        pageEnd: toNum(fragment.pageEnd)
      }
    },
    orgId: ORG_ID
  };

  if (entityType === 'indicator') {
    return {
      ...common,
      indicatorText: text,
      indicatorCategory: areaTitle,
      indicatorDimension: 'sample_indicator',
      evidenceType: 'benchmark_fragment'
    };
  }

  if (entityType === 'sampleTaskLabel') {
    return {
      ...common,
      taskLabelText: text,
      contextDomain: 'official_benchmark_sample_task',
      taskType: 'sample_task_label',
      officialSample: true,
      linkedBenchmarkId: s(mapped.benchmarkId) || null,
      linkedCompetencyId: s(mapped.competencyId) || null
    };
  }

  return {
    ...common,
    scopeType: s(mapped.competencyId) ? 'competency' : 'benchmark',
    scopeSkillId: s(mapped.skillId) || null,
    scopeBenchmarkId: s(mapped.benchmarkId) || null,
    scopeCompetencyId: s(mapped.competencyId) || null,
    featureDimension: areaTitle || 'benchmark_condition',
    complexityLevel: 'stage_i',
    featureValue: text
  };
}

function upsertCanonicalEntityFromFragments(entityDb, benchmarkDb, fragmentIndex, entityType, actor = 'system') {
  const updated = clone(entityDb);
  const report = {
    totalClb14Fragments: 0,
    createdIds: [],
    updatedIds: [],
    unresolvedFragmentIds: [],
    changedCount: 0
  };

  const typeKey = entityType === 'sampleTaskLabel' ? 'sampletasklabel' : entityType.toLowerCase();
  const fragments = arr(fragmentIndex.byType.get(typeKey));
  report.totalClb14Fragments = fragments.length;
  const benchmarkMap = buildLookupMap(benchmarkDb);

  fragments.forEach((fragment) => {
    const mapped = parseMappedEntityIds(fragment);
    const benchmark = benchmarkMap.get(s(mapped.benchmarkId));
    if (!benchmark || !isClb14BenchmarkId(mapped.benchmarkId)) {
      report.unresolvedFragmentIds.push(s(fragment.id));
      return;
    }

    const createdTemplate = createCanonicalEntityRecord(entityType, fragment, benchmark, mapped);
    if (!createdTemplate) {
      report.unresolvedFragmentIds.push(s(fragment.id));
      return;
    }

    const id = s(createdTemplate.id);
    const existing = updated.itemsById[id];
    if (!existing) {
      updated.itemsById[id] = createdTemplate;
      report.createdIds.push(id);
      report.changedCount += 1;
      return;
    }

    const next = { ...existing, ...createdTemplate, id: existing.id, createdAt: existing.createdAt || createdTemplate.createdAt, createdBy: existing.createdBy || createdTemplate.createdBy };
    next.sourceRefs = mergeSourceRefs(existing.sourceRefs, fragment, `Canonical ${entityType} source`);
    next.relatedIds = Array.from(new Set(arr(existing.relatedIds).concat(arr(createdTemplate.relatedIds)).filter(Boolean))).sort();
    const canonical = setCanonicalState(next, 'canonical_fragment_backed', fragment);
    const audited = updateAuditFields(canonical, actor);
    updated.itemsById[id] = audited;
    report.updatedIds.push(id);
    if (JSON.stringify(audited) !== JSON.stringify(existing)) report.changedCount += 1;
  });

  finalizeDb(updated, { includeCompetency: true });
  return { updatedDb: updated, report };
}

function countCanonicalStateForClb14(db, state) {
  return arr(db?.allIds).filter((id) => {
    const row = db.itemsById?.[id];
    if (!row || !isClb14BenchmarkId(row.benchmarkId)) return false;
    return s(row.extensions?.canonicalState) === state;
  }).length;
}

function buildCoverageReport({
  fragmentIndex,
  profileResult,
  competencyResult,
  indicatorResult,
  sampleTaskResult,
  featureResult,
  writes,
  dryRun,
  postState
}) {
  const mappedCounts = {
    profileOfAbility: arr(fragmentIndex.byType.get('profileofability')).length,
    competency: arr(fragmentIndex.byType.get('competency')).length,
    indicator: arr(fragmentIndex.byType.get('indicator')).length,
    sampleTaskLabel: arr(fragmentIndex.byType.get('sampletasklabel')).length,
    featureOfCommunication: arr(fragmentIndex.byType.get('featureofcommunication')).length
  };

  return {
    meta: {
      generatedAt: nowIso(),
      script: SCRIPT_PATH,
      dryRun,
      scope: 'CLB 1-4 only'
    },
    fragments: {
      totalApprovedAuthorityFragmentsIndexed: fragmentIndex.approvedAuthority.length,
      clb14ApprovedAuthorityFragmentsIndexed: fragmentIndex.clb14.length,
      mappedEntityTypeCoverage: mappedCounts
    },
    coverage: {
      profileOfAbility: profileResult.report,
      competencies: competencyResult.report,
      indicators: indicatorResult.report,
      sampleTaskLabels: sampleTaskResult.report,
      featuresOfCommunication: featureResult.report
    },
    postState,
    writes
  };
}

function printSummary(report) {
  console.log('BenchPath Canonical Text Backfill');
  console.log('================================');
  console.log(`Dry run: ${report.meta.dryRun ? 'yes' : 'no'}`);
  console.log(`Generated: ${report.meta.generatedAt}`);
  console.log('');
  console.log('Fragment Coverage (CLB 1-4)');
  console.log('---------------------------');
  console.log(`- profileOfAbility fragments: ${report.fragments.mappedEntityTypeCoverage.profileOfAbility}`);
  console.log(`- competency fragments: ${report.fragments.mappedEntityTypeCoverage.competency}`);
  console.log(`- indicator fragments: ${report.fragments.mappedEntityTypeCoverage.indicator}`);
  console.log(`- sampleTaskLabel fragments: ${report.fragments.mappedEntityTypeCoverage.sampleTaskLabel}`);
  console.log(`- featureOfCommunication fragments: ${report.fragments.mappedEntityTypeCoverage.featureOfCommunication}`);
  console.log('');
  console.log('Writes');
  console.log('------');
  console.log(`- competencies file written: ${report.writes.competenciesWritten ? 'yes' : 'no'}`);
  console.log(`- profile-of-ability file written: ${report.writes.profileOfAbilityWritten ? 'yes' : 'no'}`);
  console.log(`- indicators file written: ${report.writes.indicatorsWritten ? 'yes' : 'no'}`);
  console.log(`- sample-task-labels file written: ${report.writes.sampleTaskLabelsWritten ? 'yes' : 'no'}`);
  console.log(`- features file written: ${report.writes.featuresWritten ? 'yes' : 'no'}`);
  console.log(`- report written: ${report.writes.reportWritten ? 'yes' : 'no'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [
    fragmentDb,
    benchmarkDb,
    competencyAreaDb,
    competencyDb,
    profileDb,
    indicatorDb,
    sampleTaskDb,
    featureDb
  ] = await Promise.all([
    readJson(path.join(REFERENCE_DIR, FILES.sourceFragments)),
    readJson(path.join(REFERENCE_DIR, FILES.benchmarks)),
    readJson(path.join(REFERENCE_DIR, FILES.competencyAreas)),
    readJson(path.join(REFERENCE_DIR, FILES.competencies)),
    readJson(path.join(REFERENCE_DIR, FILES.profileOfAbility)),
    readJson(path.join(REFERENCE_DIR, FILES.indicators)),
    readJson(path.join(REFERENCE_DIR, FILES.sampleTaskLabels)),
    readJson(path.join(REFERENCE_DIR, FILES.featuresOfCommunication))
  ]);

  void competencyAreaDb; // kept loaded for future strict validation; relationship ids are used from fragments.

  const fragmentIndex = buildFragmentIndexes(fragmentDb);

  const profileResult = updatePoaRecords(profileDb, benchmarkDb, fragmentIndex, 'system');
  const competencyResult = updateOrCreateCompetencies(competencyDb, benchmarkDb, fragmentIndex, 'system');
  const indicatorResult = upsertCanonicalEntityFromFragments(indicatorDb, benchmarkDb, fragmentIndex, 'indicator', 'system');
  const sampleTaskResult = upsertCanonicalEntityFromFragments(sampleTaskDb, benchmarkDb, fragmentIndex, 'sampleTaskLabel', 'system');
  const featureResult = upsertCanonicalEntityFromFragments(featureDb, benchmarkDb, fragmentIndex, 'featureOfCommunication', 'system');

  const writes = {
    competenciesWritten: false,
    profileOfAbilityWritten: false,
    indicatorsWritten: false,
    sampleTaskLabelsWritten: false,
    featuresWritten: false,
    reportWritten: false
  };

  const postState = {
    competenciesCanonicalFragmentBackedClb14: countCanonicalStateForClb14(competencyResult.updatedDb, 'canonical_fragment_backed'),
    profileOfAbilityCanonicalFragmentBackedClb14: countCanonicalStateForClb14(profileResult.updatedDb, 'canonical_fragment_backed'),
    indicatorsCanonicalFragmentBackedClb14: countCanonicalStateForClb14(indicatorResult.updatedDb, 'canonical_fragment_backed'),
    sampleTaskLabelsCanonicalFragmentBackedClb14: countCanonicalStateForClb14(sampleTaskResult.updatedDb, 'canonical_fragment_backed'),
    featuresCanonicalFragmentBackedClb14: countCanonicalStateForClb14(featureResult.updatedDb, 'canonical_fragment_backed'),
    clb14BenchmarkCount: clb14BenchmarkIds(benchmarkDb).length
  };

  const report = buildCoverageReport({
    fragmentIndex,
    profileResult,
    competencyResult,
    indicatorResult,
    sampleTaskResult,
    featureResult,
    writes,
    dryRun: args.dryRun,
    postState
  });

  if (!args.dryRun) {
    if (profileResult.report.changedCount > 0) {
      await writeJson(path.join(REFERENCE_DIR, FILES.profileOfAbility), profileResult.updatedDb);
      writes.profileOfAbilityWritten = true;
    }
    if (competencyResult.report.changedCount > 0) {
      await writeJson(path.join(REFERENCE_DIR, FILES.competencies), competencyResult.updatedDb);
      writes.competenciesWritten = true;
    }
    if (indicatorResult.report.changedCount > 0) {
      await writeJson(path.join(REFERENCE_DIR, FILES.indicators), indicatorResult.updatedDb);
      writes.indicatorsWritten = true;
    }
    if (sampleTaskResult.report.changedCount > 0) {
      await writeJson(path.join(REFERENCE_DIR, FILES.sampleTaskLabels), sampleTaskResult.updatedDb);
      writes.sampleTaskLabelsWritten = true;
    }
    if (featureResult.report.changedCount > 0) {
      await writeJson(path.join(REFERENCE_DIR, FILES.featuresOfCommunication), featureResult.updatedDb);
      writes.featuresWritten = true;
    }
    writes.reportWritten = true;
    await writeJson(REPORT_PATH, {
      ...report,
      writes
    });
  }

  printSummary({ ...report, writes });
  if (!args.dryRun) {
    console.log('');
    console.log(`Coverage report: ${REPORT_PATH}`);
  }
}

main().catch((error) => {
  console.error('BenchPath canonical backfill failed.');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
