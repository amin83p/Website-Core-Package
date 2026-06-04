const fs = require('fs').promises;
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const REFERENCE_DIR = path.join(ROOT_DIR, 'data', 'benchpath', 'reference');
const SOURCE_PATH = path.join(REFERENCE_DIR, 'source.json');
const SOURCE_FRAGMENTS_PATH = path.join(REFERENCE_DIR, 'source-fragments.json');
const REPORT_PATH = path.join(REFERENCE_DIR, 'benchpath-clb14-fragment-extraction-report.json');
const TMP_RAW_PATH = path.join(REFERENCE_DIR, '_tmp_clb2012_raw_extract.txt');

const SCRIPT_NAME = 'extractClbBenchmarkFragments';
const SOURCE_ID = 'source:clb:2012';
const ORG_ID = 'SYSTEM';
const EXPECTED_SKILLS = ['listening', 'speaking', 'reading', 'writing'];
const EXPECTED_LEVELS = [1, 2, 3, 4];
const STAGE_ID_BY_LEVEL = Object.freeze({
  1: 'stage:1',
  2: 'stage:1',
  3: 'stage:1',
  4: 'stage:1'
});

const ROMAN_ORDER = ['I', 'II', 'III', 'IV'];
const AREA_MAP = Object.freeze({
  listening: Object.freeze({
    I: 'interacting_with_others',
    II: 'comprehending_instructions',
    III: 'getting_things_done',
    IV: 'comprehending_information'
  }),
  speaking: Object.freeze({
    I: 'interacting_with_others',
    II: 'giving_instructions',
    III: 'getting_things_done',
    IV: 'sharing_information'
  }),
  reading: Object.freeze({
    I: 'interacting_with_others',
    II: 'comprehending_instructions',
    III: 'getting_things_done',
    IV: 'comprehending_information'
  }),
  writing: Object.freeze({
    I: 'interacting_with_others',
    II: 'reproducing_information',
    III: 'getting_things_done',
    IV: 'sharing_information'
  })
});

function nowIso() {
  return new Date().toISOString();
}

function s(value) {
  return String(value == null ? '' : value).trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeWhitespace(value) {
  return s(value).replace(/\s+/g, ' ').trim();
}

function normalizeSlug(value) {
  return s(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeKey(value) {
  return s(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeTextBlob(lines) {
  return arr(lines)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join(' ');
}

function summaryFromText(text, maxLength = 180) {
  const clean = normalizeWhitespace(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).trimEnd()}...`;
}

function removeBulletPrefix(line) {
  return normalizeWhitespace(s(line).replace(/^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\uF0B7\uF0A7\u2024\uF0AD\u2013\u2014\-]+\s*/, ''));
}

function benchmarkLevelFromBenchmarkId(benchmarkId) {
  const match = s(benchmarkId).match(/:(\d{1,2})$/);
  return match ? asNumber(match[1]) : null;
}

function stripSampleTaskBleed(text) {
  const cleaned = normalizeWhitespace(text);
  return cleaned.split(/\bSample Tasks?\b/i)[0].trim();
}

function looksLikeSampleTaskLine(text) {
  return /^(listen|read|write|ask|complete|fill|tell|call|go|look|watch|use|take|give)\b/i.test(s(text));
}

function readJson(filePath) {
  return fs.readFile(filePath, 'utf8').then((raw) => JSON.parse(String(raw || '').replace(/^\uFEFF/, '')));
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    pdf: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    if (token === '--pdf') {
      args.pdf = argv[i + 1] ? String(argv[i + 1]) : null;
      i += 1;
    }
  }
  return args;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveCommandOnPath(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const candidates = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => s(line))
    .filter(Boolean);
  return candidates.length ? candidates[0] : null;
}

async function resolvePdftotextPath() {
  const envPath = s(process.env.PDFTOTEXT_PATH);
  if (envPath) {
    const hasPathLikeChars = /[\\/]/.test(envPath) || /^[a-zA-Z]:/.test(envPath) || envPath.startsWith('.');
    if (hasPathLikeChars) {
      const resolved = path.resolve(envPath);
      if (await fileExists(resolved)) {
        return { executablePath: resolved, source: 'env:PDFTOTEXT_PATH' };
      }
      throw new Error(
        `PDFTOTEXT_PATH is set but file does not exist: ${resolved}. ` +
        'Set PDFTOTEXT_PATH to a valid pdftotext executable path, or remove it to use PATH lookup.'
      );
    }

    const envCommand = resolveCommandOnPath(envPath);
    if (envCommand) {
      return { executablePath: envCommand, source: 'env:PDFTOTEXT_PATH' };
    }
    throw new Error(
      `PDFTOTEXT_PATH is set to "${envPath}" but command is not available on PATH. ` +
      'Set PDFTOTEXT_PATH to a valid executable path, or install pdftotext and ensure it is on PATH.'
    );
  }

  const pathCommand = resolveCommandOnPath('pdftotext');
  if (pathCommand) {
    return { executablePath: pathCommand, source: 'PATH' };
  }

  throw new Error(
    'pdftotext was not found. Install Poppler/Xpdf pdftotext and add it to PATH, ' +
    'or set PDFTOTEXT_PATH to the executable.'
  );
}

async function resolvePdfPath(explicitPath, sourceDb) {
  const source = sourceDb?.itemsById?.[SOURCE_ID];
  const storagePath = s(source?.storagePath);
  const fileName = s(source?.fileName);
  const originalFileName = s(source?.originalFileName);
  const sourceCandidates = [];

  if (storagePath) {
    if (storagePath.startsWith('/benchpath/data/reference/files/')) {
      sourceCandidates.push(
        path.join(ROOT_DIR, 'data', 'benchpath', 'reference', 'files', storagePath.replace('/benchpath/data/reference/files/', ''))
      );
    } else if (path.isAbsolute(storagePath)) {
      sourceCandidates.push(storagePath);
    } else {
      sourceCandidates.push(path.resolve(ROOT_DIR, storagePath));
    }
  }

  if (fileName) sourceCandidates.push(path.join(ROOT_DIR, 'data', 'benchpath', 'reference', 'files', fileName));
  if (originalFileName) sourceCandidates.push(path.join(ROOT_DIR, 'data', 'benchpath', 'reference', 'files', originalFileName));

  const triedSourceCandidates = [];
  for (const candidate of sourceCandidates) {
    const resolved = path.resolve(candidate);
    triedSourceCandidates.push(resolved);
    if (await fileExists(resolved)) {
      return { pdfPath: resolved, source: 'source.json' };
    }
  }

  if (explicitPath) {
    const resolvedExplicit = path.resolve(explicitPath);
    if (await fileExists(resolvedExplicit)) {
      return { pdfPath: resolvedExplicit, source: '--pdf' };
    }
    throw new Error(
      `--pdf path does not exist: ${resolvedExplicit}. ` +
      `source.json candidates checked first: ${triedSourceCandidates.length ? triedSourceCandidates.join(', ') : 'none'}`
    );
  }

  const candidates = [
    ...triedSourceCandidates
  ];
  throw new Error(
    `Unable to locate CLB 2012 PDF. Checked source.json paths: ${candidates.length ? candidates.join(', ') : 'none'}. ` +
    'Provide a valid file with --pdf "<absolute path>" or update source.json storagePath/fileName.'
  );
}

function printStartupValidation({ pdftotextPath, pdftotextSource, pdfPath, pdfSource, explicitPdfArg }) {
  console.log('Startup validation');
  console.log('------------------');
  console.log(`- pdftotext: ${pdftotextPath} (from ${pdftotextSource})`);
  console.log(`- PDF: ${pdfPath} (from ${pdfSource})`);
  if (explicitPdfArg && pdfSource === 'source.json') {
    console.log(`- note: --pdf was provided but source.json was preferred per extractor policy.`);
  }
  console.log('');
}

function runPdfToText(pdftotextPath, pdfPath, outPath) {
  const result = spawnSync(
    pdftotextPath,
    ['-raw', '-enc', 'UTF-8', pdfPath, outPath],
    { encoding: 'utf8' }
  );
  if (result.error) {
    if (s(result.error?.code) === 'ENOENT') {
      throw new Error(
        `pdftotext executable not found: ${pdftotextPath}. ` +
        'Install pdftotext and add it to PATH, or set PDFTOTEXT_PATH.'
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`pdftotext failed (${result.status}): ${s(result.stderr) || s(result.stdout) || 'unknown error'}`);
  }
}

function splitPages(rawText) {
  const pages = String(rawText || '').split('\f');
  return pages.map((pageText, index) => ({
    pageNumber: index + 1,
    lines: pageText.split(/\r?\n/)
  }));
}

function createBenchmarkBucket(skill, level) {
  return {
    key: `${skill}:${level}`,
    skill,
    level,
    stageId: STAGE_ID_BY_LEVEL[level] || null,
    benchmarkId: `benchmark:${skill}:${level}`,
    skillId: `skill:${skill}`,
    profile: {
      lines: [],
      pages: new Set()
    },
    areas: {}
  };
}

function ensureArea(bucket, areaKey, areaRoman, areaTitle) {
  if (!bucket.areas[areaKey]) {
    bucket.areas[areaKey] = {
      areaKey,
      areaRoman,
      areaTitle: normalizeWhitespace(areaTitle) || areaKey.replace(/_/g, ' '),
      pages: new Set(),
      competencyLines: [],
      indicatorLines: [],
      sampleTaskLines: [],
      featureLines: [],
      lastSubType: null
    };
  }
  return bucket.areas[areaKey];
}

function markPage(set, pageNumber) {
  if (set && Number.isFinite(pageNumber) && pageNumber >= 1) set.add(pageNumber);
}

function isNoiseLine(line) {
  const clean = normalizeWhitespace(line);
  if (!clean) return true;
  if (/^STAGE\s+[IVX]+$/i.test(clean)) return true;
  if (/^Canadian Language Benchmarks\s*-\s*\d+$/i.test(clean)) return true;
  if (/^\d+\s*-\s*Canadian Language Benchmarks$/i.test(clean)) return true;
  if (/^Knowledge and Strategies/i.test(clean)) return true;
  if (/^Profiles of Ability Across/i.test(clean)) return true;
  if (/^Some Features of Communication/i.test(clean)) return true;
  if (/^CLB\s+\d+$/i.test(clean)) return true;
  return false;
}

function extractBenchmarkData(pages) {
  const benchmarkMap = new Map();
  const coveredBenchmarks = new Set();
  const missingHeadingsByPage = [];

  let context = null;
  let mode = 'none';
  let currentArea = null;

  const benchmarkHeaderRegex = /^(Listening|Speaking|Reading|Writing)\s*[\u2013\u2014-]\s*Benchmark\s*(\d{1,2})$/i;
  const sectionRegex = /^(I|II|III|IV)\.\s+(.+)$/;

  const setContext = (skill, level) => {
    const normalizedSkill = normalizeSlug(skill);
    const normalizedLevel = asNumber(level);
    if (!EXPECTED_SKILLS.includes(normalizedSkill) || !EXPECTED_LEVELS.includes(normalizedLevel)) {
      context = null;
      mode = 'none';
      currentArea = null;
      return;
    }
    const key = `${normalizedSkill}:${normalizedLevel}`;
    if (!benchmarkMap.has(key)) benchmarkMap.set(key, createBenchmarkBucket(normalizedSkill, normalizedLevel));
    context = benchmarkMap.get(key);
    coveredBenchmarks.add(context.benchmarkId);
    mode = 'none';
    currentArea = null;
  };

  for (const page of pages) {
    const pageHasBenchmarkHeader = page.lines.some((rawLine) => {
      const clean = normalizeWhitespace(rawLine);
      return benchmarkHeaderRegex.test(clean);
    });
    if (!pageHasBenchmarkHeader && context && context.level <= 4 && mode !== 'none') {
      missingHeadingsByPage.push(page.pageNumber);
    }

    for (const rawLine of page.lines) {
      const clean = normalizeWhitespace(rawLine);
      if (!clean) continue;

      const headerMatch = clean.match(benchmarkHeaderRegex);
      if (headerMatch) {
        setContext(headerMatch[1], headerMatch[2]);
        continue;
      }

      if (!context) continue;

      if (/^(Stage|CLB)\s+/i.test(clean) && mode === 'sampleTasks') {
        mode = 'none';
        currentArea = null;
      }

      if (clean === 'Profile of Ability') {
        mode = 'profile';
        currentArea = null;
        markPage(context.profile.pages, page.pageNumber);
        continue;
      }

      const sectionMatch = clean.match(sectionRegex);
      if (sectionMatch) {
        const roman = sectionMatch[1];
        const areaTitle = sectionMatch[2];
        const areaKey = AREA_MAP[context.skill]?.[roman] || normalizeKey(areaTitle);
        const area = ensureArea(context, areaKey, roman, areaTitle);
        markPage(area.pages, page.pageNumber);
        mode = 'competency';
        currentArea = area;
        continue;
      }

      if (/^Sample Tasks?$/i.test(clean) && currentArea) {
        mode = 'sampleTasks';
        markPage(currentArea.pages, page.pageNumber);
        continue;
      }

      if (mode === 'profile') {
        if (isNoiseLine(clean)) continue;
        context.profile.lines.push(clean);
        markPage(context.profile.pages, page.pageNumber);
        continue;
      }

      if (!currentArea) continue;

      if (mode === 'competency') {
        if (isNoiseLine(clean)) continue;
        const isBracketLine = /^\[.*\]$/.test(clean);
        const startsIndicator = /^[]/.test(clean);
        const startsBullet = /^[]/.test(clean);
        const normalized = removeBulletPrefix(clean);
        if (!normalized) continue;

        if (isBracketLine) {
          currentArea.featureLines.push(normalized);
          currentArea.lastSubType = 'feature';
          markPage(currentArea.pages, page.pageNumber);
          continue;
        }

        if (startsIndicator) {
          const indicatorText = stripSampleTaskBleed(normalized);
          if (!indicatorText || looksLikeSampleTaskLine(indicatorText)) {
            currentArea.lastSubType = 'indicator';
            continue;
          }
          currentArea.indicatorLines.push(indicatorText);
          currentArea.lastSubType = 'indicator';
          markPage(currentArea.pages, page.pageNumber);
          continue;
        }

        if (startsBullet) {
          currentArea.competencyLines.push(normalized);
          currentArea.lastSubType = 'competency';
          markPage(currentArea.pages, page.pageNumber);
          continue;
        }

        if (currentArea.lastSubType === 'indicator' && currentArea.indicatorLines.length > 0) {
          if (/^Sample Tasks?$/i.test(normalized)) continue;
          const last = currentArea.indicatorLines.length - 1;
          const mergedIndicator = stripSampleTaskBleed(`${currentArea.indicatorLines[last]} ${normalized}`);
          currentArea.indicatorLines[last] = mergedIndicator;
        } else if (currentArea.lastSubType === 'feature' && currentArea.featureLines.length > 0) {
          const last = currentArea.featureLines.length - 1;
          currentArea.featureLines[last] = normalizeWhitespace(`${currentArea.featureLines[last]} ${normalized}`);
        } else if (currentArea.lastSubType === 'competency' && currentArea.competencyLines.length > 0) {
          const last = currentArea.competencyLines.length - 1;
          currentArea.competencyLines[last] = normalizeWhitespace(`${currentArea.competencyLines[last]} ${normalized}`);
        } else {
          currentArea.competencyLines.push(normalized);
          currentArea.lastSubType = 'competency';
        }
        markPage(currentArea.pages, page.pageNumber);
        continue;
      }

      if (mode === 'sampleTasks') {
        if (isNoiseLine(clean)) continue;
        if (/^(Profile of Ability|Sample Indicators? of Ability)$/i.test(clean)) {
          mode = 'none';
          currentArea = null;
          continue;
        }
        if (sectionRegex.test(clean) || benchmarkHeaderRegex.test(clean)) {
          mode = 'none';
          currentArea = null;
          continue;
        }
        if (/^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\uF0B7\uF0A7\uF0AD]/.test(clean)) {
          mode = 'none';
          continue;
        }
        currentArea.sampleTaskLines.push(clean);
        markPage(currentArea.pages, page.pageNumber);
      }
    }
  }

  return {
    benchmarkMap,
    coveredBenchmarks: Array.from(coveredBenchmarks),
    missingHeadingsByPage: Array.from(new Set(missingHeadingsByPage)).sort((a, b) => a - b)
  };
}

function pageRangeFromSet(pageSet) {
  const pages = Array.from(pageSet || []).filter((p) => Number.isFinite(p)).sort((a, b) => a - b);
  if (!pages.length) return { pageStart: null, pageEnd: null };
  return {
    pageStart: pages[0],
    pageEnd: pages[pages.length - 1]
  };
}

function buildFragmentBase({
  id,
  slug,
  code,
  title,
  shortTitle = null,
  fragmentType,
  sectionPath,
  text,
  summary,
  excerptLabel,
  mappedEntityType,
  mappedEntityIds,
  semanticRole,
  pageStart,
  pageEnd,
  sourceType,
  authorityLevel,
  framework
}) {
  const timestamp = nowIso();
  return {
    id,
    slug,
    code,
    sourceId: SOURCE_ID,
    sourceType: s(sourceType) || 'official_standard',
    authorityLevel: s(authorityLevel) || 'official',
    framework: s(framework) || 'CLB',
    title,
    shortTitle,
    fragmentType,
    sectionPath: arr(sectionPath),
    pageStart,
    pageEnd,
    paragraphStart: null,
    paragraphEnd: null,
    lineStart: null,
    lineEnd: null,
    text,
    normalizedText: normalizeWhitespace(text).toLowerCase(),
    summary: summary || summaryFromText(text),
    excerptLabel: excerptLabel || null,
    language: 'en',
    contextTags: ['clb', 'benchmark-page'],
    usageTags: ['reference_extraction', 'citation', 'audit', 'validation_rules', 'wizard_support'],
    mappedEntityType,
    mappedEntityIds: arr(mappedEntityIds),
    semanticRole,
    isDirectQuote: true,
    quoteConfidence: 0.86,
    extractionMethod: 'parser',
    reviewStatus: 'reviewed',
    status: 'approved',
    isActive: true,
    isSystem: true,
    isLocked: false,
    validationNotes: 'Auto-extracted from CLB 2012 benchmark pages (CLB 1-4).',
    notes: null,
    tags: ['official', 'clb', 'benchmark', 'stage-1', 'auto-extracted'],
    createdBy: 'system',
    updatedBy: 'system',
    approvedBy: 'system',
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: timestamp,
    version: 1,
    extensions: {
      generatedBy: SCRIPT_NAME,
      extractionScope: 'clb_1_4_benchmark_pages',
      benchmarkCoverage: 'stage_i'
    },
    orgId: ORG_ID
  };
}

function buildFragmentsFromBenchmarks(benchmarkMap, sourceItem) {
  const generated = {};
  const counters = {
    profile: 0,
    competency: 0,
    indicator: 0,
    sampleTask: 0,
    feature: 0
  };
  const benchmarkCoverage = new Set();

  const skillOrder = new Map(EXPECTED_SKILLS.map((skill, index) => [skill, index]));
  const buckets = Array.from(benchmarkMap.values()).sort((a, b) => {
    const skillDelta = (skillOrder.get(a.skill) || 0) - (skillOrder.get(b.skill) || 0);
    if (skillDelta !== 0) return skillDelta;
    return a.level - b.level;
  });

  for (const bucket of buckets) {
    benchmarkCoverage.add(bucket.benchmarkId);
    const skill = bucket.skill;
    const level = bucket.level;
    const skillTitle = skill.charAt(0).toUpperCase() + skill.slice(1);
    const benchmarkId = bucket.benchmarkId;
    const skillId = bucket.skillId;
    const poaId = `poa:${skill}:${level}`;
    const stageId = bucket.stageId;

    const profileText = normalizeTextBlob(bucket.profile.lines);
    if (profileText) {
      const id = `fragment:clb:2012:${skill}:${level}:profile:001`;
      generated[id] = buildFragmentBase({
        id,
        slug: normalizeSlug(`clb-2012-${skill}-${level}-profile-001`),
        code: `FRAG-CLB-${skill.charAt(0).toUpperCase()}${level}-POA-001`,
        title: `${skillTitle} Benchmark ${level} Profile of Ability`,
        shortTitle: `CLB ${level} Profile`,
        fragmentType: 'profile_excerpt',
        sectionPath: ['Stage I', `${skillTitle} Benchmark ${level}`, 'Profile of Ability'],
        text: profileText,
        summary: summaryFromText(profileText),
        excerptLabel: `${skillTitle} CLB ${level} profile excerpt`,
        mappedEntityType: 'profileOfAbility',
        mappedEntityIds: [poaId, benchmarkId, skillId, stageId].filter(Boolean),
        semanticRole: 'descriptor',
        ...pageRangeFromSet(bucket.profile.pages),
        sourceType: sourceItem.sourceType,
        authorityLevel: sourceItem.authorityLevel,
        framework: sourceItem.framework
      });
      counters.profile += 1;
    }

    for (const roman of ROMAN_ORDER) {
      const areaKey = AREA_MAP[skill]?.[roman];
      if (!areaKey) continue;
      const area = bucket.areas[areaKey];
      if (!area) continue;

      const areaHyphen = areaKey.replace(/_/g, '-');
      const areaTitle = normalizeWhitespace(area.areaTitle || areaKey.replace(/_/g, ' '));
      const competencyId = `comp:${skill}:${level}:${areaKey}:001`;
      const indicatorId = `ind:${skill}:${level}:${areaHyphen}:001`;
      const sampleTaskId = `stl:${skill}:${level}:${areaHyphen}:001`;
      const featureId = `foc:${skill}:${level}:${areaHyphen}:001`;
      const competencyAreaId = `ca:${skill}:${areaKey}`;
      const pageRange = pageRangeFromSet(area.pages);

      const competencyText = normalizeTextBlob(area.competencyLines);
      if (competencyText) {
        const id = `fragment:clb:2012:${skill}:${level}:competency:${areaKey}:001`;
        generated[id] = buildFragmentBase({
          id,
          slug: normalizeSlug(`clb-2012-${skill}-${level}-competency-${areaKey}-001`),
          code: `FRAG-CLB-${skill.charAt(0).toUpperCase()}${level}-COMP-${areaHyphen.toUpperCase()}-001`,
          title: `${skillTitle} Benchmark ${level} ${areaTitle} Competency`,
          shortTitle: `${roman}. ${areaTitle}`,
          fragmentType: 'competency_excerpt',
          sectionPath: ['Stage I', `${skillTitle} Benchmark ${level}`, `${roman}. ${areaTitle}`, 'Competency Statement'],
          text: competencyText,
          summary: summaryFromText(competencyText),
          excerptLabel: `${skillTitle} CLB ${level} competency statement`,
          mappedEntityType: 'competency',
          mappedEntityIds: [competencyId, benchmarkId, skillId, competencyAreaId, stageId].filter(Boolean),
          semanticRole: 'definition',
          pageStart: pageRange.pageStart,
          pageEnd: pageRange.pageEnd,
          sourceType: sourceItem.sourceType,
          authorityLevel: sourceItem.authorityLevel,
          framework: sourceItem.framework
        });
        counters.competency += 1;
      }

      const indicatorText = normalizeTextBlob(area.indicatorLines);
      if (indicatorText) {
        const id = `fragment:clb:2012:${skill}:${level}:indicator:${areaKey}:001`;
        generated[id] = buildFragmentBase({
          id,
          slug: normalizeSlug(`clb-2012-${skill}-${level}-indicator-${areaKey}-001`),
          code: `FRAG-CLB-${skill.charAt(0).toUpperCase()}${level}-IND-${areaHyphen.toUpperCase()}-001`,
          title: `${skillTitle} Benchmark ${level} ${areaTitle} Sample Indicators`,
          shortTitle: `${roman}. ${areaTitle} Indicators`,
          fragmentType: 'indicator_excerpt',
          sectionPath: ['Stage I', `${skillTitle} Benchmark ${level}`, `${roman}. ${areaTitle}`, 'Sample Indicators of Ability'],
          text: indicatorText,
          summary: summaryFromText(indicatorText),
          excerptLabel: `${skillTitle} CLB ${level} sample indicators excerpt`,
          mappedEntityType: 'indicator',
          mappedEntityIds: [indicatorId, competencyId, benchmarkId, skillId, competencyAreaId, stageId].filter(Boolean),
          semanticRole: 'indicator',
          pageStart: pageRange.pageStart,
          pageEnd: pageRange.pageEnd,
          sourceType: sourceItem.sourceType,
          authorityLevel: sourceItem.authorityLevel,
          framework: sourceItem.framework
        });
        counters.indicator += 1;
      }

      const sampleTaskText = normalizeTextBlob(area.sampleTaskLines);
      if (sampleTaskText) {
        const id = `fragment:clb:2012:${skill}:${level}:sample-task:${areaKey}:001`;
        generated[id] = buildFragmentBase({
          id,
          slug: normalizeSlug(`clb-2012-${skill}-${level}-sample-task-${areaKey}-001`),
          code: `FRAG-CLB-${skill.charAt(0).toUpperCase()}${level}-TASK-${areaHyphen.toUpperCase()}-001`,
          title: `${skillTitle} Benchmark ${level} ${areaTitle} Sample Tasks`,
          shortTitle: `${roman}. ${areaTitle} Tasks`,
          fragmentType: 'sample_task_excerpt',
          sectionPath: ['Stage I', `${skillTitle} Benchmark ${level}`, `${roman}. ${areaTitle}`, 'Sample Tasks'],
          text: sampleTaskText,
          summary: summaryFromText(sampleTaskText),
          excerptLabel: `${skillTitle} CLB ${level} sample task excerpt`,
          mappedEntityType: 'sampleTaskLabel',
          mappedEntityIds: [sampleTaskId, benchmarkId, skillId, competencyAreaId, stageId].filter(Boolean),
          semanticRole: 'sample_task',
          pageStart: pageRange.pageStart,
          pageEnd: pageRange.pageEnd,
          sourceType: sourceItem.sourceType,
          authorityLevel: sourceItem.authorityLevel,
          framework: sourceItem.framework
        });
        counters.sampleTask += 1;
      }

      const featureText = normalizeTextBlob(area.featureLines);
      if (featureText) {
        const id = `fragment:clb:2012:${skill}:${level}:feature:${areaKey}:001`;
        generated[id] = buildFragmentBase({
          id,
          slug: normalizeSlug(`clb-2012-${skill}-${level}-feature-${areaKey}-001`),
          code: `FRAG-CLB-${skill.charAt(0).toUpperCase()}${level}-FOC-${areaHyphen.toUpperCase()}-001`,
          title: `${skillTitle} Benchmark ${level} ${areaTitle} Features of Communication`,
          shortTitle: `${roman}. ${areaTitle} Features`,
          fragmentType: 'feature_excerpt',
          sectionPath: ['Stage I', `${skillTitle} Benchmark ${level}`, `${roman}. ${areaTitle}`, 'Features of Communication'],
          text: featureText,
          summary: summaryFromText(featureText),
          excerptLabel: `${skillTitle} CLB ${level} feature-condition excerpt`,
          mappedEntityType: 'featureOfCommunication',
          mappedEntityIds: [featureId, benchmarkId, skillId, competencyId, competencyAreaId, stageId].filter(Boolean),
          semanticRole: 'feature_seed',
          pageStart: pageRange.pageStart,
          pageEnd: pageRange.pageEnd,
          sourceType: sourceItem.sourceType,
          authorityLevel: sourceItem.authorityLevel,
          framework: sourceItem.framework
        });
        counters.feature += 1;
      }
    }
  }

  return {
    generated,
    counters,
    benchmarkCoverage: Array.from(benchmarkCoverage).sort()
  };
}

function shouldReplaceExistingFragment(item, id) {
  const generatedByScript = s(item?.extensions?.generatedBy) === SCRIPT_NAME;
  const generatedIdPattern = /^fragment:clb:2012:(listening|speaking|reading|writing):[1-4]:/i.test(s(id));
  return generatedByScript || generatedIdPattern;
}

function rebuildFragmentIndexes(db) {
  const indexes = {
    bySourceId: {},
    byFragmentType: {},
    byMappedEntityType: {},
    bySemanticRole: {},
    byStatus: {},
    byReviewStatus: {},
    byLanguage: {},
    byOrgId: {},
    byBenchmarkId: {},
    bySkillId: {}
  };

  const add = (bucket, key, id) => {
    const normalized = s(key);
    if (!normalized) return;
    if (!indexes[bucket][normalized]) indexes[bucket][normalized] = [];
    indexes[bucket][normalized].push(id);
  };

  for (const id of arr(db.allIds)) {
    const item = db.itemsById?.[id];
    if (!item) continue;
    add('bySourceId', item.sourceId, id);
    add('byFragmentType', item.fragmentType, id);
    add('byMappedEntityType', item.mappedEntityType, id);
    add('bySemanticRole', item.semanticRole, id);
    add('byStatus', item.status, id);
    add('byReviewStatus', item.reviewStatus, id);
    add('byLanguage', item.language, id);
    add('byOrgId', item.orgId || ORG_ID, id);

    for (const mappedId of arr(item.mappedEntityIds)) {
      const key = s(mappedId);
      if (key.startsWith('benchmark:')) add('byBenchmarkId', key, id);
      if (key.startsWith('skill:')) add('bySkillId', key, id);
    }
  }

  Object.keys(indexes).forEach((bucket) => {
    Object.keys(indexes[bucket]).forEach((key) => {
      indexes[bucket][key] = Array.from(new Set(indexes[bucket][key])).sort();
    });
  });

  db.indexes = indexes;
  return db;
}

function expectedBenchmarkIds() {
  const ids = [];
  for (const skill of EXPECTED_SKILLS) {
    for (const level of EXPECTED_LEVELS) {
      ids.push(`benchmark:${skill}:${level}`);
    }
  }
  return ids.sort();
}

function benchmarkIdFromMappedEntityIds(mappedEntityIds) {
  return arr(mappedEntityIds).find((id) => s(id).startsWith('benchmark:')) || null;
}

function buildExtractionWarnings(generatedFragments) {
  const warnings = {
    indicatorContainingSampleTask: [],
    indicatorBenchmarkLevelMismatch: []
  };

  Object.keys(generatedFragments || {}).forEach((id) => {
    const fragment = generatedFragments[id];
    if (!fragment || s(fragment.mappedEntityType).toLowerCase() !== 'indicator') return;

    const text = s(fragment.text);
    if (!text) return;
    const benchmarkId = benchmarkIdFromMappedEntityIds(fragment.mappedEntityIds);
    const benchmarkLevel = benchmarkLevelFromBenchmarkId(benchmarkId);

    if (/\bSample Tasks?\b/i.test(text)) {
      warnings.indicatorContainingSampleTask.push({
        fragmentId: s(fragment.id) || id,
        benchmarkId: benchmarkId || null,
        message: 'Indicator fragment contains "Sample Task" text; verify section boundary parsing.'
      });
    }

    const mismatchRegex = /typical of\s+(?:clb\s+)?benchmark\s*(\d{1,2})/ig;
    let match = mismatchRegex.exec(text);
    while (match) {
      const mentionedLevel = asNumber(match[1]);
      if (benchmarkLevel != null && mentionedLevel != null && mentionedLevel !== benchmarkLevel) {
        warnings.indicatorBenchmarkLevelMismatch.push({
          fragmentId: s(fragment.id) || id,
          benchmarkId: benchmarkId || null,
          benchmarkLevel,
          mentionedLevel,
          message: `Indicator text references "typical of Benchmark ${mentionedLevel}" while mapped benchmark is ${benchmarkLevel}.`
        });
      }
      match = mismatchRegex.exec(text);
    }
  });

  return warnings;
}

function buildCoverageReport({
  pdfPath,
  benchmarkCoverage,
  counters,
  beforeCount,
  afterCount,
  coveredBenchmarks,
  missingHeadingsByPage,
  extractionWarnings
}) {
  const expected = expectedBenchmarkIds();
  const coveredSet = new Set(benchmarkCoverage);
  const missing = expected.filter((id) => !coveredSet.has(id));

  return {
    meta: {
      generatedAt: nowIso(),
      script: `scripts/benchpath/reference/${SCRIPT_NAME}.js`,
      sourceId: SOURCE_ID,
      pdfPath,
      scope: 'CLB 1-4 benchmark pages'
    },
    counts: {
      sourceFragmentsBefore: beforeCount,
      sourceFragmentsAfter: afterCount,
      fragmentsAddedOrReplaced: afterCount - beforeCount,
      profileFragmentsCreated: counters.profile,
      competencyFragmentsCreated: counters.competency,
      indicatorFragmentsCreated: counters.indicator,
      sampleTaskFragmentsCreated: counters.sampleTask,
      featureFragmentsCreated: counters.feature
    },
    coverage: {
      expectedBenchmarkCount: expected.length,
      coveredBenchmarkCount: coveredSet.size,
      coveredBenchmarks: Array.from(new Set(coveredBenchmarks.concat(benchmarkCoverage))).sort(),
      missingBenchmarkPages: missing,
      pagesWithoutBenchmarkHeadingWhileInScope: missingHeadingsByPage
    },
    warnings: {
      indicatorContainingSampleTask: arr(extractionWarnings?.indicatorContainingSampleTask),
      indicatorBenchmarkLevelMismatch: arr(extractionWarnings?.indicatorBenchmarkLevelMismatch)
    }
  };
}

function printCoverage(report) {
  console.log('CLB 1-4 Benchmark Fragment Extraction');
  console.log('=====================================');
  console.log(`Source: ${report.meta.sourceId}`);
  console.log(`PDF: ${report.meta.pdfPath}`);
  console.log('');
  console.log('Created');
  console.log('-------');
  console.log(`- Profile fragments: ${report.counts.profileFragmentsCreated}`);
  console.log(`- Competency fragments: ${report.counts.competencyFragmentsCreated}`);
  console.log(`- Indicator fragments: ${report.counts.indicatorFragmentsCreated}`);
  console.log(`- Sample-task fragments: ${report.counts.sampleTaskFragmentsCreated}`);
  console.log(`- Feature fragments: ${report.counts.featureFragmentsCreated}`);
  console.log('');
  console.log('Coverage');
  console.log('--------');
  console.log(`- Benchmarks covered (CLB 1-4 x 4 skills): ${report.coverage.coveredBenchmarkCount}/${report.coverage.expectedBenchmarkCount}`);
  console.log(`- Missing benchmark pages: ${report.coverage.missingBenchmarkPages.length ? report.coverage.missingBenchmarkPages.join(', ') : 'none'}`);
  console.log('');
  console.log('Warnings');
  console.log('--------');
  console.log(`- Indicator fragments containing "Sample Task": ${arr(report.warnings?.indicatorContainingSampleTask).length}`);
  console.log(`- Indicator benchmark-reference mismatches: ${arr(report.warnings?.indicatorBenchmarkLevelMismatch).length}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const [sourceDb, fragmentDb] = await Promise.all([
      readJson(SOURCE_PATH),
      readJson(SOURCE_FRAGMENTS_PATH)
    ]);

    const sourceItem = sourceDb?.itemsById?.[SOURCE_ID];
    if (!sourceItem) throw new Error(`Missing source record: ${SOURCE_ID}`);

    const { executablePath: pdftotextPath, source: pdftotextSource } = await resolvePdftotextPath();
    const { pdfPath, source: pdfSource } = await resolvePdfPath(args.pdf, sourceDb);
    printStartupValidation({
      pdftotextPath,
      pdftotextSource,
      pdfPath,
      pdfSource,
      explicitPdfArg: args.pdf
    });

    runPdfToText(pdftotextPath, pdfPath, TMP_RAW_PATH);
    const rawText = await fs.readFile(TMP_RAW_PATH, 'utf8');
    const pages = splitPages(rawText);
    const extraction = extractBenchmarkData(pages);

    const generatedResult = buildFragmentsFromBenchmarks(extraction.benchmarkMap, sourceItem);
    const generatedEntries = Object.entries(generatedResult.generated);
    if (!generatedEntries.length) {
      throw new Error('No CLB 1-4 benchmark fragments were generated from the PDF extraction.');
    }

    const nextDb = JSON.parse(JSON.stringify(fragmentDb));
    const beforeCount = arr(nextDb.allIds).length;
    const idsToDelete = arr(nextDb.allIds).filter((id) => shouldReplaceExistingFragment(nextDb.itemsById[id], id));
    for (const id of idsToDelete) {
      delete nextDb.itemsById[id];
    }

    const retainedIds = arr(nextDb.allIds).filter((id) => nextDb.itemsById[id]);
    for (const [id, fragment] of generatedEntries) {
      nextDb.itemsById[id] = fragment;
    }
    const generatedIds = generatedEntries.map(([id]) => id).sort();
    nextDb.allIds = retainedIds.concat(generatedIds);
    nextDb.meta = {
      ...(nextDb.meta || {}),
      updatedAt: nowIso()
    };
    rebuildFragmentIndexes(nextDb);

    const extractionWarnings = buildExtractionWarnings(generatedResult.generated);

    const coverageReport = buildCoverageReport({
      pdfPath,
      benchmarkCoverage: generatedResult.benchmarkCoverage,
      counters: generatedResult.counters,
      beforeCount,
      afterCount: nextDb.allIds.length,
      coveredBenchmarks: extraction.coveredBenchmarks,
      missingHeadingsByPage: extraction.missingHeadingsByPage,
      extractionWarnings
    });

    const updatedSourceDb = JSON.parse(JSON.stringify(sourceDb));
    const sourceRow = updatedSourceDb.itemsById[SOURCE_ID];
    sourceRow.extractionStatus = 'partially_completed';
    sourceRow.updatedAt = nowIso();
    sourceRow.updatedBy = 'system';
    sourceRow.version = Number.isFinite(Number(sourceRow.version)) ? Number(sourceRow.version) + 1 : 1;
    sourceRow.extensions = sourceRow.extensions && typeof sourceRow.extensions === 'object' ? sourceRow.extensions : {};
    sourceRow.extensions.lastExtractionRun = {
      script: SCRIPT_NAME,
      scope: 'CLB 1-4 benchmark pages',
      runAt: nowIso(),
      reportPath: path.relative(ROOT_DIR, REPORT_PATH).replace(/\\/g, '/')
    };
    updatedSourceDb.meta = {
      ...(updatedSourceDb.meta || {}),
      updatedAt: nowIso()
    };

    if (!args.dryRun) {
      await Promise.all([
        writeJson(SOURCE_FRAGMENTS_PATH, nextDb),
        writeJson(SOURCE_PATH, updatedSourceDb),
        writeJson(REPORT_PATH, coverageReport)
      ]);
    }

    printCoverage(coverageReport);
    if (!args.dryRun) {
      console.log('');
      console.log(`Report: ${REPORT_PATH}`);
    } else {
      console.log('');
      console.log('Dry run mode: no files written.');
    }
  } finally {
    try {
      await fs.unlink(TMP_RAW_PATH);
    } catch (_) {
      // ignore cleanup errors
    }
  }
}

main().catch((error) => {
  console.error('CLB benchmark extraction failed.');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
