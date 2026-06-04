const fs = require('fs').promises;
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const REFERENCE_DIR = path.join(ROOT_DIR, 'data', 'benchpath', 'reference');
const DEFAULT_AUDIT_REPORT_PATH = path.join(REFERENCE_DIR, 'benchpath-reference-audit.json');
const EXTRACTION_MAP_PATH = path.join(REFERENCE_DIR, 'benchpath-reference-extraction-map.json');

const ENTITY_FILES = Object.freeze([
  { key: 'sources', file: 'source.json' },
  { key: 'sourceFragments', file: 'source-fragments.json' },
  { key: 'clbFrameworks', file: 'clb.framework.json' },
  { key: 'clbSkills', file: 'clb.skills.json' },
  { key: 'clbStages', file: 'clb.stages.json' },
  { key: 'clbCompetencyAreas', file: 'clb.competency-areas.json' },
  { key: 'clbBenchmarks', file: 'clb.benchmarks.json' },
  { key: 'clbCompetencies', file: 'clb.competencies.json' },
  { key: 'clbProfileOfAbility', file: 'clb.profile-of-ability.json' },
  { key: 'clbIndicators', file: 'clb.indicators.json' },
  { key: 'clbFeaturesOfCommunication', file: 'clb.features-of-communication.json' },
  { key: 'clbSampleTaskLabels', file: 'clb.sample-task-labels.json' }
]);

function nowIso() {
  return new Date().toISOString();
}

function s(value) {
  return String(value == null ? '' : value).trim();
}

function n(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeIssue(issue) {
  return {
    severity: issue.severity || 'error',
    code: issue.code || 'unknown',
    message: issue.message || '',
    file: issue.file || null,
    entity: issue.entity || null,
    itemId: issue.itemId || null,
    detail: issue.detail || null,
    suggestion: issue.suggestion || null
  };
}

function compareIssues(a, b) {
  const left = `${a.severity}|${a.code}|${a.file || ''}|${a.entity || ''}|${a.itemId || ''}|${a.message || ''}`;
  const right = `${b.severity}|${b.code}|${b.file || ''}|${b.entity || ''}|${b.itemId || ''}|${b.message || ''}`;
  return left.localeCompare(right);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function loadDatasets(referenceDir) {
  const result = {};
  for (const spec of ENTITY_FILES) {
    const filePath = path.join(referenceDir, spec.file);
    const json = await readJson(filePath);
    const itemsById = json && typeof json.itemsById === 'object' ? json.itemsById : {};
    const allIds = Array.isArray(json?.allIds) ? json.allIds.map((id) => s(id)).filter(Boolean) : [];
    result[spec.key] = {
      key: spec.key,
      file: spec.file,
      filePath,
      json,
      itemsById,
      allIds,
      itemKeys: Object.keys(itemsById),
      idSet: new Set(allIds)
    };
  }
  return result;
}

function buildGlobalIdOwner(datasets, issues) {
  const owner = new Map();
  for (const spec of ENTITY_FILES) {
    const ds = datasets[spec.key];
    for (const id of ds.itemKeys) {
      if (!id) continue;
      if (owner.has(id)) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'duplicate_id_global',
          message: `ID '${id}' exists in multiple entities.`,
          file: ds.file,
          entity: ds.key,
          itemId: id,
          detail: { previousOwner: owner.get(id) }
        }));
      } else {
        owner.set(id, ds.key);
      }
    }
  }
  return owner;
}

function validateStructuralConsistency(datasets, issues) {
  const summary = {};

  for (const spec of ENTITY_FILES) {
    const ds = datasets[spec.key];
    const fileSummary = {
      allIdsCount: ds.allIds.length,
      itemsByIdCount: ds.itemKeys.length,
      missingItemsForAllIds: 0,
      itemKeysMissingFromAllIds: 0,
      duplicateIdsInAllIds: 0
    };

    const seen = new Set();
    for (const id of ds.allIds) {
      if (seen.has(id)) {
        fileSummary.duplicateIdsInAllIds += 1;
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'duplicate_id_in_allIds',
          message: `Duplicate allIds entry '${id}' in ${ds.file}.`,
          file: ds.file,
          entity: ds.key,
          itemId: id
        }));
      }
      seen.add(id);

      if (!Object.prototype.hasOwnProperty.call(ds.itemsById, id)) {
        fileSummary.missingItemsForAllIds += 1;
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'allIds_missing_item',
          message: `allIds references missing itemsById key '${id}'.`,
          file: ds.file,
          entity: ds.key,
          itemId: id
        }));
      }
    }

    for (const id of ds.itemKeys) {
      if (!ds.idSet.has(id)) {
        fileSummary.itemKeysMissingFromAllIds += 1;
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'item_missing_in_allIds',
          message: `itemsById key '${id}' is missing from allIds.`,
          file: ds.file,
          entity: ds.key,
          itemId: id
        }));
      }

      const item = ds.itemsById[id];
      const itemId = s(item?.id);
      if (itemId && itemId !== id) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'item_id_key_mismatch',
          message: `itemsById key '${id}' does not match item.id '${itemId}'.`,
          file: ds.file,
          entity: ds.key,
          itemId: id
        }));
      }
    }

    summary[ds.key] = fileSummary;
  }

  return summary;
}

function benchmarkLevel(record) {
  const direct = n(record?.benchmarkNumber);
  if (direct != null) return direct;
  const extLevel = n(record?.extensions?.level);
  if (extLevel != null) return extLevel;
  const fromBenchmarkId = s(record?.benchmarkId) || s(record?.id);
  const match = fromBenchmarkId.match(/:(\d+)$/);
  if (!match) return null;
  return n(match[1]);
}

function validateRelatedIds(datasets, globalIdOwner, issues) {
  for (const spec of ENTITY_FILES) {
    const ds = datasets[spec.key];
    for (const id of ds.itemKeys) {
      const item = ds.itemsById[id];
      const related = toArray(item?.relatedIds);
      related.forEach((relatedId) => {
        const normalized = s(relatedId);
        if (!normalized) return;
        if (!globalIdOwner.has(normalized)) {
          issues.push(normalizeIssue({
            severity: 'error',
            code: 'orphan_related_id',
            message: `relatedIds contains unknown id '${normalized}'.`,
            file: ds.file,
            entity: ds.key,
            itemId: id
          }));
        }
      });
    }
  }
}

function validateBenchmarkStageRange(datasets, issues) {
  const stages = datasets.clbStages.itemsById;
  const benchmarks = datasets.clbBenchmarks.itemsById;

  for (const id of Object.keys(benchmarks)) {
    const benchmark = benchmarks[id];
    const stageId = s(benchmark?.stageId);
    if (!stageId) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'benchmark_missing_stage',
        message: 'Benchmark is missing stageId.',
        file: datasets.clbBenchmarks.file,
        entity: 'clbBenchmarks',
        itemId: id
      }));
      continue;
    }

    const stage = stages[stageId];
    if (!stage) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'benchmark_stage_missing',
        message: `Benchmark stageId '${stageId}' does not exist.`,
        file: datasets.clbBenchmarks.file,
        entity: 'clbBenchmarks',
        itemId: id
      }));
      continue;
    }

    const level = benchmarkLevel(benchmark);
    const min = n(stage?.benchmarkRange?.minimum);
    const max = n(stage?.benchmarkRange?.maximum);
    if (level == null || min == null || max == null) {
      issues.push(normalizeIssue({
        severity: 'warning',
        code: 'benchmark_stage_range_unresolved',
        message: `Unable to evaluate stage range for benchmark '${id}'.`,
        file: datasets.clbBenchmarks.file,
        entity: 'clbBenchmarks',
        itemId: id,
        detail: { level, min, max, stageId }
      }));
      continue;
    }

    if (level < min || level > max) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'benchmark_stage_range_mismatch',
        message: `Benchmark level ${level} is outside stage '${stageId}' range ${min}-${max}.`,
        file: datasets.clbBenchmarks.file,
        entity: 'clbBenchmarks',
        itemId: id
      }));
    }
  }
}

function validateCompetencyAreaSkillFamily(datasets, issues) {
  const areas = datasets.clbCompetencyAreas.itemsById;
  const benchmarks = datasets.clbBenchmarks.itemsById;

  for (const id of Object.keys(areas)) {
    const area = areas[id];
    const areaSkillId = s(area?.skillId);
    const relatedBenchmarkIds = toArray(area?.relatedIds).filter((value) => s(value).startsWith('benchmark:'));

    relatedBenchmarkIds.forEach((benchmarkIdRaw) => {
      const benchmarkId = s(benchmarkIdRaw);
      const benchmark = benchmarks[benchmarkId];
      if (!benchmark) return;
      const benchmarkSkillId = s(benchmark.skillId);
      if (areaSkillId && benchmarkSkillId && areaSkillId !== benchmarkSkillId) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'competency_area_skill_family_mismatch',
          message: `Competency area skill '${areaSkillId}' conflicts with related benchmark skill '${benchmarkSkillId}'.`,
          file: datasets.clbCompetencyAreas.file,
          entity: 'clbCompetencyAreas',
          itemId: id,
          detail: { relatedBenchmarkId: benchmarkId }
        }));
      }
    });
  }
}

function validateCompetencyChain(datasets, issues) {
  const competencies = datasets.clbCompetencies.itemsById;
  const benchmarks = datasets.clbBenchmarks.itemsById;
  const areas = datasets.clbCompetencyAreas.itemsById;
  const stages = datasets.clbStages.itemsById;

  for (const id of Object.keys(competencies)) {
    const item = competencies[id];
    const benchmarkId = s(item?.benchmarkId);
    const areaId = s(item?.competencyAreaId);
    const skillId = s(item?.skillId);
    const stageId = s(item?.stageId);
    const frameworkId = s(item?.frameworkId);

    const benchmark = benchmarks[benchmarkId];
    const area = areas[areaId];

    if (!benchmark) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'competency_missing_benchmark',
        message: `competency.benchmarkId '${benchmarkId || '-'}' does not exist.`,
        file: datasets.clbCompetencies.file,
        entity: 'clbCompetencies',
        itemId: id
      }));
    }

    if (!area) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'competency_missing_competency_area',
        message: `competency.competencyAreaId '${areaId || '-'}' does not exist.`,
        file: datasets.clbCompetencies.file,
        entity: 'clbCompetencies',
        itemId: id
      }));
    }

    if (benchmark) {
      const bSkill = s(benchmark.skillId);
      const bStage = s(benchmark.stageId);
      const bFramework = s(benchmark.frameworkId);
      if (skillId && bSkill && skillId !== bSkill) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'competency_skill_benchmark_mismatch',
          message: `competency.skillId '${skillId}' does not match benchmark.skillId '${bSkill}'.`,
          file: datasets.clbCompetencies.file,
          entity: 'clbCompetencies',
          itemId: id
        }));
      }
      if (stageId && bStage && stageId !== bStage) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'competency_stage_benchmark_mismatch',
          message: `competency.stageId '${stageId}' does not match benchmark.stageId '${bStage}'.`,
          file: datasets.clbCompetencies.file,
          entity: 'clbCompetencies',
          itemId: id
        }));
      }
      if (frameworkId && bFramework && frameworkId !== bFramework) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'competency_framework_benchmark_mismatch',
          message: `competency.frameworkId '${frameworkId}' does not match benchmark.frameworkId '${bFramework}'.`,
          file: datasets.clbCompetencies.file,
          entity: 'clbCompetencies',
          itemId: id
        }));
      }
    }

    if (area) {
      const aSkill = s(area.skillId);
      const aFramework = s(area.frameworkId);
      if (skillId && aSkill && skillId !== aSkill) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'competency_skill_area_mismatch',
          message: `competency.skillId '${skillId}' does not match competencyArea.skillId '${aSkill}'.`,
          file: datasets.clbCompetencies.file,
          entity: 'clbCompetencies',
          itemId: id
        }));
      }
      if (frameworkId && aFramework && frameworkId !== aFramework) {
        issues.push(normalizeIssue({
          severity: 'error',
          code: 'competency_framework_area_mismatch',
          message: `competency.frameworkId '${frameworkId}' does not match competencyArea.frameworkId '${aFramework}'.`,
          file: datasets.clbCompetencies.file,
          entity: 'clbCompetencies',
          itemId: id
        }));
      }
    }

    if (stageId && !stages[stageId]) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'competency_missing_stage',
        message: `competency.stageId '${stageId}' does not exist.`,
        file: datasets.clbCompetencies.file,
        entity: 'clbCompetencies',
        itemId: id
      }));
    }
  }
}

function validateProfileChain(datasets, issues) {
  const profiles = datasets.clbProfileOfAbility.itemsById;
  const benchmarks = datasets.clbBenchmarks.itemsById;
  const stages = datasets.clbStages.itemsById;

  for (const id of Object.keys(profiles)) {
    const item = profiles[id];
    const benchmarkId = s(item?.benchmarkId);
    const skillId = s(item?.skillId);
    const stageId = s(item?.stageId);
    const frameworkId = s(item?.frameworkId);
    const benchmark = benchmarks[benchmarkId];

    if (!benchmark) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'profile_missing_benchmark',
        message: `profile.benchmarkId '${benchmarkId || '-'}' does not exist.`,
        file: datasets.clbProfileOfAbility.file,
        entity: 'clbProfileOfAbility',
        itemId: id
      }));
      continue;
    }

    const bSkill = s(benchmark.skillId);
    const bStage = s(benchmark.stageId);
    const bFramework = s(benchmark.frameworkId);
    if (skillId && bSkill && skillId !== bSkill) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'profile_skill_benchmark_mismatch',
        message: `profile.skillId '${skillId}' does not match benchmark.skillId '${bSkill}'.`,
        file: datasets.clbProfileOfAbility.file,
        entity: 'clbProfileOfAbility',
        itemId: id
      }));
    }
    if (stageId && bStage && stageId !== bStage) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'profile_stage_benchmark_mismatch',
        message: `profile.stageId '${stageId}' does not match benchmark.stageId '${bStage}'.`,
        file: datasets.clbProfileOfAbility.file,
        entity: 'clbProfileOfAbility',
        itemId: id
      }));
    }
    if (frameworkId && bFramework && frameworkId !== bFramework) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'profile_framework_benchmark_mismatch',
        message: `profile.frameworkId '${frameworkId}' does not match benchmark.frameworkId '${bFramework}'.`,
        file: datasets.clbProfileOfAbility.file,
        entity: 'clbProfileOfAbility',
        itemId: id
      }));
    }

    if (stageId && !stages[stageId]) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'profile_missing_stage',
        message: `profile.stageId '${stageId}' does not exist.`,
        file: datasets.clbProfileOfAbility.file,
        entity: 'clbProfileOfAbility',
        itemId: id
      }));
    }
  }
}

function validateSourceRefs(datasets, issues) {
  const sources = datasets.sources.itemsById;
  const fragments = datasets.sourceFragments.itemsById;

  for (const spec of ENTITY_FILES) {
    const ds = datasets[spec.key];
    for (const id of ds.itemKeys) {
      const item = ds.itemsById[id];
      const refs = toArray(item?.sourceRefs);
      refs.forEach((ref, index) => {
        const sourceId = s(ref?.sourceId);
        const fragmentId = s(ref?.fragmentId);
        if (!sourceId || !sources[sourceId]) {
          issues.push(normalizeIssue({
            severity: 'error',
            code: 'sourceref_missing_source',
            message: `sourceRefs[${index}].sourceId '${sourceId || '-'}' does not exist.`,
            file: ds.file,
            entity: ds.key,
            itemId: id
          }));
          return;
        }

        if (!fragmentId) return;
        const fragment = fragments[fragmentId];
        if (!fragment) {
          issues.push(normalizeIssue({
            severity: 'error',
            code: 'sourceref_missing_fragment',
            message: `sourceRefs[${index}].fragmentId '${fragmentId}' does not exist.`,
            file: ds.file,
            entity: ds.key,
            itemId: id
          }));
          return;
        }
        if (s(fragment.sourceId) !== sourceId) {
          issues.push(normalizeIssue({
            severity: 'error',
            code: 'sourceref_fragment_source_mismatch',
            message: `sourceRefs[${index}] fragment '${fragmentId}' belongs to source '${fragment.sourceId}', expected '${sourceId}'.`,
            file: ds.file,
            entity: ds.key,
            itemId: id
          }));
        }
      });
    }
  }
}

function validateNoSilentEmptyWithFragmentCoverage(datasets, issues) {
  const fragments = datasets.sourceFragments.itemsById;
  const counts = {
    indicator: 0,
    featureofcommunication: 0,
    sampletasklabel: 0
  };

  Object.keys(fragments).forEach((id) => {
    const fragment = fragments[id];
    if (s(fragment?.status).toLowerCase() !== 'approved') return;
    if (s(fragment?.reviewStatus).toLowerCase() !== 'reviewed') return;
    if (fragment?.isActive === false) return;

    const mappedType = s(fragment?.mappedEntityType).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, mappedType)) {
      counts[mappedType] += 1;
    }
  });

  const rules = [
    {
      mappedType: 'indicator',
      datasetKey: 'clbIndicators',
      file: datasets.clbIndicators.file
    },
    {
      mappedType: 'featureofcommunication',
      datasetKey: 'clbFeaturesOfCommunication',
      file: datasets.clbFeaturesOfCommunication.file
    },
    {
      mappedType: 'sampletasklabel',
      datasetKey: 'clbSampleTaskLabels',
      file: datasets.clbSampleTaskLabels.file
    }
  ];

  rules.forEach((rule) => {
    const coverage = counts[rule.mappedType] || 0;
    const targetCount = datasets[rule.datasetKey].allIds.length;
    if (coverage > 0 && targetCount === 0) {
      issues.push(normalizeIssue({
        severity: 'error',
        code: 'silent_empty_with_fragment_coverage',
        message: `${rule.file} is empty while ${coverage} approved/reviewed '${rule.mappedType}' fragments exist.`,
        file: rule.file,
        entity: rule.datasetKey,
        suggestion: 'Generate scaffold starter records or ingest mapped canonical records so the file is no longer silently empty.'
      }));
    }
  });
}

async function walkFiles(dirPath, extensions, out = []) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      await walkFiles(full, extensions, out);
      continue;
    }
    if (extensions.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

async function detectNamingDrift(referenceDir, issues) {
  const drift = [];
  const fileNames = new Set((await fs.readdir(referenceDir)).map((name) => s(name)));

  if (fileNames.has('source.json') && !fileNames.has('sources.json')) {
    drift.push({
      code: 'naming_drift_source_file',
      message: 'Reference uses source.json while design docs often refer to sources.json.',
      suggestion: 'Keep source.json as canonical runtime name or introduce a controlled alias layer; avoid mixed usage in docs and loaders.'
    });
  }

  if (fileNames.has('clb.profile-of-ability.json') && !fileNames.has('clb.profiles-of-ability.json')) {
    drift.push({
      code: 'naming_drift_profile_file',
      message: 'Reference uses clb.profile-of-ability.json (singular), while plural variants appear in notes/maps.',
      suggestion: 'Standardize on clb.profile-of-ability.json and profileOfAbility in all maps/loaders.'
    });
  }

  const scanRoots = [
    path.join(ROOT_DIR, 'MVC'),
    path.join(ROOT_DIR, 'scripts')
  ];
  const sourceFiles = [];
  for (const root of scanRoots) {
    await walkFiles(root, new Set(['.js', '.json']), sourceFiles);
  }

  const TOKENS = [
    'source.json',
    'sources.json',
    'profileOfAbility',
    'profilesOfAbility',
    'clb.profile-of-ability.json',
    'clb.profiles-of-ability.json'
  ];

  const matches = Object.fromEntries(TOKENS.map((token) => [token, []]));
  for (const filePath of sourceFiles) {
    const relativePath = path.relative(ROOT_DIR, filePath);
    const fileName = path.basename(filePath);
    if (filePath === __filename) continue;
    if (/^benchpath-reference-(extraction-map|audit)\.json$/i.test(fileName)) continue;

    const text = await fs.readFile(filePath, 'utf8');
    TOKENS.forEach((token) => {
      if (text.includes(token)) matches[token].push(relativePath);
    });
  }

  try {
    const existingMap = await readJson(EXTRACTION_MAP_PATH);
    const skillLinks = toArray(existingMap?.relationshipMap?.skill).map((entry) => s(entry));
    if (skillLinks.includes('profilesOfAbility')) {
      drift.push({
        code: 'naming_drift_map_profiles_key',
        message: 'Extraction map relationshipMap.skill uses profilesOfAbility (plural).',
        detail: { file: path.relative(ROOT_DIR, EXTRACTION_MAP_PATH), value: 'profilesOfAbility' },
        suggestion: 'Use profileOfAbility (singular) in extraction-map relationship keys.'
      });
    }

    const sourcesFileRef = s(existingMap?.derivedFrom?.sourcesFile);
    if (sourcesFileRef.includes('sources.json')) {
      drift.push({
        code: 'naming_drift_map_sources_file_ref',
        message: 'Extraction map derivedFrom.sourcesFile points to sources.json while runtime file is source.json.',
        detail: { file: path.relative(ROOT_DIR, EXTRACTION_MAP_PATH), sourcesFile: sourcesFileRef },
        suggestion: 'Update derivedFrom.sourcesFile to data/benchpath/reference/source.json.'
      });
    }
  } catch (_) {
    // Ignore extraction map parse errors here; structural checks handle file integrity separately.
  }

  if (matches['sources.json'].length > 0 && matches['source.json'].length > 0) {
    drift.push({
      code: 'naming_drift_source_token_mixed',
      message: 'Both source.json and sources.json are referenced across loaders/maps.',
      detail: { sourceJsonRefs: matches['source.json'], sourcesJsonRefs: matches['sources.json'] },
      suggestion: 'Use source.json consistently in code and maps, and treat sources.json as doc alias only.'
    });
  }

  if (matches.profilesOfAbility.length > 0 && matches.profileOfAbility.length > 0) {
    drift.push({
      code: 'naming_drift_profile_token_mixed',
      message: 'Both profileOfAbility and profilesOfAbility tokens are used.',
      detail: { profileOfAbilityRefs: matches.profileOfAbility, profilesOfAbilityRefs: matches.profilesOfAbility },
      suggestion: 'Normalize all runtime keys to profileOfAbility (singular).'
    });
  }

  if (matches['clb.profiles-of-ability.json'].length > 0) {
    drift.push({
      code: 'naming_drift_profile_filename_plural',
      message: 'Plural file-name token clb.profiles-of-ability.json is referenced.',
      detail: { references: matches['clb.profiles-of-ability.json'] },
      suggestion: 'Replace with clb.profile-of-ability.json to match actual file.'
    });
  }

  drift.forEach((entry) => {
    issues.push(normalizeIssue({
      severity: 'warning',
      code: entry.code,
      message: entry.message,
      file: 'naming',
      detail: entry.detail || null,
      suggestion: entry.suggestion || null
    }));
  });

  return {
    detected: drift.length > 0,
    issues: drift,
    tokenMatches: matches
  };
}

function classifyTargetStatus(entityKey, records) {
  const count = Array.isArray(records) ? records.length : 0;
  if (count === 0) return 'empty';

  const mixedStateTargets = new Set([
    'clbCompetencies',
    'clbProfileOfAbility',
    'clbIndicators',
    'clbFeaturesOfCommunication',
    'clbSampleTaskLabels'
  ]);
  if (!mixedStateTargets.has(entityKey)) return 'completed';

  const isSeedLike = (record) => {
    const text = `${s(record?.title)} ${s(record?.description)} ${s(record?.domainNotes)}`.toLowerCase();
    const tags = toArray(record?.tags).join(' ').toLowerCase();
    const ext = JSON.stringify(record?.extensions || {}).toLowerCase();
    if (text.includes('seed') || text.includes('placeholder') || text.includes('scaffold')) return true;
    if (tags.includes('seed') || tags.includes('placeholder') || tags.includes('scaffold')) return true;
    if (ext.includes('seed') || ext.includes('placeholder') || ext.includes('scaffold')) return true;
    return false;
  };

  const isCanonicalLike = (record) => {
    const canonicalState = s(record?.extensions?.canonicalState).toLowerCase();
    if (canonicalState.startsWith('canonical')) return true;
    const hasFragmentRef = toArray(record?.sourceRefs).some((ref) => s(ref?.fragmentId));
    return hasFragmentRef
      && ['reviewed', 'approved'].includes(s(record?.status).toLowerCase())
      && s(record?.reviewStatus).toLowerCase() === 'reviewed';
  };

  const seededCount = records.filter((record) => isSeedLike(record)).length;
  const canonicalCount = records.filter((record) => isCanonicalLike(record)).length;
  if (seededCount > 0) return 'mixed/canonical+seed';
  if (canonicalCount > 0) return 'completed';
  return 'mixed/canonical+seed';
}

function buildExtractionMap(datasets, namingDrift, pass, issues) {
  const getCount = (key) => datasets[key].allIds.length;
  const getRecords = (key) => datasets[key].allIds.map((id) => datasets[key].itemsById[id]).filter(Boolean);

  const targetEntries = [
    { key: 'clbCompetencyAreas', file: 'data/benchpath/reference/clb.competency-areas.json', note: 'Canonical competency areas by skill.' },
    { key: 'clbBenchmarks', file: 'data/benchpath/reference/clb.benchmarks.json', note: 'Canonical benchmark records by skill/level.' },
    { key: 'clbCompetencies', file: 'data/benchpath/reference/clb.competencies.json', note: 'Competency statements and benchmark links.' },
    { key: 'clbProfileOfAbility', file: 'data/benchpath/reference/clb.profile-of-ability.json', note: 'Profile descriptors per skill+benchmark.' },
    { key: 'clbIndicators', file: 'data/benchpath/reference/clb.indicators.json', note: 'Competency-linked indicators.' },
    { key: 'clbFeaturesOfCommunication', file: 'data/benchpath/reference/clb.features-of-communication.json', note: 'Feature descriptors for benchmark/competency context.' },
    { key: 'clbSampleTaskLabels', file: 'data/benchpath/reference/clb.sample-task-labels.json', note: 'Official sample task labels.' }
  ].map((entry) => {
    const records = getRecords(entry.key);
    return {
      entity: entry.key,
      file: entry.file,
      count: records.length,
      status: classifyTargetStatus(entry.key, records),
      note: entry.note
    };
  });

  return {
    meta: {
      schemaVersion: '1.1.0',
      entityType: 'benchpathReferenceExtractionMap',
      generatedAt: nowIso(),
      generatedBy: 'scripts/benchpath/reference/referenceIntegrityAudit.js',
      note: 'Auto-regenerated from current BenchPath reference JSON files.'
    },
    derivedFrom: {
      sourcesFile: 'data/benchpath/reference/source.json',
      sourceFragmentsFile: 'data/benchpath/reference/source-fragments.json',
      frameworkFile: 'data/benchpath/reference/clb.framework.json',
      skillsFile: 'data/benchpath/reference/clb.skills.json',
      stagesFile: 'data/benchpath/reference/clb.stages.json'
    },
    relationshipMap: {
      framework: ['skills', 'stages', 'benchmarks'],
      skill: ['competencyAreas', 'benchmarks', 'profileOfAbility', 'featuresOfCommunication'],
      benchmark: ['competencies', 'profileOfAbility', 'featuresOfCommunication', 'sampleTaskLabels'],
      competency: ['indicators', 'featuresOfCommunicationOptional', 'sampleTaskLabels'],
      allEntities: ['sourceFragments']
    },
    currentState: {
      sourceCount: getCount('sources'),
      sourceFragmentCount: getCount('sourceFragments'),
      frameworkCount: getCount('clbFrameworks'),
      skillCount: getCount('clbSkills'),
      stageCount: getCount('clbStages'),
      competencyAreaCount: getCount('clbCompetencyAreas'),
      benchmarkCount: getCount('clbBenchmarks'),
      competencyCount: getCount('clbCompetencies'),
      profileOfAbilityCount: getCount('clbProfileOfAbility'),
      indicatorCount: getCount('clbIndicators'),
      featureOfCommunicationCount: getCount('clbFeaturesOfCommunication'),
      sampleTaskLabelCount: getCount('clbSampleTaskLabels')
    },
    targetFiles: targetEntries,
    namingDrift: {
      detected: Boolean(namingDrift?.detected),
      issues: toArray(namingDrift?.issues).map((entry) => ({
        code: entry.code,
        message: entry.message,
        suggestion: entry.suggestion || null
      }))
    },
    auditSnapshot: {
      pass,
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length
    }
  };
}

function parseArgs(argv) {
  const args = {
    writeReport: true,
    updateExtractionMap: true,
    reportPath: DEFAULT_AUDIT_REPORT_PATH
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--no-write-report') args.writeReport = false;
    if (token === '--no-update-map') args.updateExtractionMap = false;
    if (token === '--report' && argv[i + 1]) {
      args.reportPath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function printReportToConsole(report) {
  const summary = report.summary;
  console.log('BenchPath Reference Integrity Audit');
  console.log('=================================');
  console.log(`Reference dir: ${report.meta.referenceDir}`);
  console.log(`Generated at : ${report.meta.generatedAt}`);
  console.log(`Result       : ${summary.pass ? 'PASS' : 'FAIL'}`);
  console.log(`Errors       : ${summary.errorCount}`);
  console.log(`Warnings     : ${summary.warningCount}`);
  console.log('');
  console.log('Extraction Status');
  console.log('-----------------');
  report.extractionMap.targetFiles.forEach((entry) => {
    console.log(`- ${entry.entity}: ${entry.status} (count=${entry.count})`);
  });

  if (summary.errorCount > 0) {
    console.log('');
    console.log('Errors');
    console.log('------');
    report.issues.errors.forEach((issue) => {
      console.log(`- [${issue.code}] ${issue.message}${issue.entity ? ` (${issue.entity}:${issue.itemId || '-'})` : ''}`);
    });
  }

  if (summary.warningCount > 0) {
    console.log('');
    console.log('Warnings');
    console.log('--------');
    report.issues.warnings.forEach((issue) => {
      console.log(`- [${issue.code}] ${issue.message}`);
      if (issue.suggestion) {
        console.log(`  suggestion: ${issue.suggestion}`);
      }
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const issues = [];
  const datasets = await loadDatasets(REFERENCE_DIR);

  const structuralSummary = validateStructuralConsistency(datasets, issues);
  const globalIdOwner = buildGlobalIdOwner(datasets, issues);
  validateRelatedIds(datasets, globalIdOwner, issues);
  validateBenchmarkStageRange(datasets, issues);
  validateCompetencyAreaSkillFamily(datasets, issues);
  validateCompetencyChain(datasets, issues);
  validateProfileChain(datasets, issues);
  validateSourceRefs(datasets, issues);
  validateNoSilentEmptyWithFragmentCoverage(datasets, issues);
  const namingDrift = await detectNamingDrift(REFERENCE_DIR, issues);

  const sortedIssues = issues.map(normalizeIssue).sort(compareIssues);
  const errors = sortedIssues.filter((issue) => issue.severity === 'error');
  const warnings = sortedIssues.filter((issue) => issue.severity === 'warning');
  const pass = errors.length === 0;

  const extractionMap = buildExtractionMap(datasets, namingDrift, pass, sortedIssues);
  if (args.updateExtractionMap) {
    await writeJson(EXTRACTION_MAP_PATH, extractionMap);
  }

  const report = {
    meta: {
      generatedAt: nowIso(),
      referenceDir: REFERENCE_DIR,
      script: 'scripts/benchpath/reference/referenceIntegrityAudit.js'
    },
    summary: {
      pass,
      errorCount: errors.length,
      warningCount: warnings.length
    },
    structuralSummary,
    issues: {
      errors,
      warnings
    },
    namingDrift,
    extractionMap: {
      path: EXTRACTION_MAP_PATH,
      updated: args.updateExtractionMap,
      targetFiles: extractionMap.targetFiles
    }
  };

  if (args.writeReport) {
    await writeJson(args.reportPath, report);
  }

  printReportToConsole(report);
  if (args.writeReport) {
    console.log('');
    console.log(`Audit JSON report: ${args.reportPath}`);
  }
  if (args.updateExtractionMap) {
    console.log(`Extraction map updated: ${EXTRACTION_MAP_PATH}`);
  }

  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error('BenchPath reference integrity audit failed.');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
