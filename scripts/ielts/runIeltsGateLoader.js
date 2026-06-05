const fs = require('fs');
const Module = require('module');
const path = require('path');

const ROOT_DIR = path.resolve(process.env.IELTS_GATE_ROOT || process.cwd());
const CANDIDATE_BASES = [
  path.join(ROOT_DIR, 'packages', 'ielts', 'MVC'),
  path.join(ROOT_DIR, 'MVC')
];

const FALLBACK_TARGETS = [
  { relative: 'services/ielts/scoringRules.js' },
  { relative: 'services/ielts/step3ScoringService.js' },
  { relative: 'services/ielts/step5FeedbackService.js' },
  { relative: 'services/ielts/aiService.js' },
  { relative: 'views/ielts/scoringV0326.ejs' },
  { relative: 'controllers/ielts/ieltsController.js' }
];

const ORIG_RESOLVE_FILENAME = Module._resolveFilename;
const ORIG_READFILE_SYNC = fs.readFileSync;
const ORIG_READFILE_PROMISE = fs.promises.readFile;

function looksLikeIeltsTarget(request) {
  const normalized = request.replace(/\\/g, '/').toLowerCase();
  const noExt = normalized.replace(/\.[a-z0-9]+$/i, '');

  for (const entry of FALLBACK_TARGETS) {
    const candidate = entry.relative;
    const candidateLower = candidate.toLowerCase();
    const candidateWithoutExt = candidate.replace(/\.[a-z0-9]+$/i, '');
    const candidateWithoutExtLower = candidateWithoutExt.toLowerCase();
    if (
      normalized === candidateLower ||
      normalized === candidateWithoutExtLower ||
      noExt === candidateLower ||
      noExt === candidateWithoutExtLower ||
      normalized.endsWith(`/${candidateLower}`) ||
      normalized.endsWith(`/${candidateWithoutExtLower}`) ||
      noExt.endsWith(`/${candidateLower}`) ||
      noExt.endsWith(`/${candidateWithoutExtLower}`)
    ) {
      return candidate;
    }
  }
  return null;
}

function resolveCandidate(target) {
  const targetExt = path.extname(target);
  const withoutExt = targetExt ? target.slice(0, -targetExt.length) : target;
  const candidates = [];

  for (const base of CANDIDATE_BASES) {
    const resolvedWithExt = path.join(base, target);
    const resolvedWithoutExt = path.join(base, withoutExt);
    candidates.push(resolvedWithExt);
    if (!targetExt) {
      candidates.push(`${resolvedWithExt}.js`, `${resolvedWithExt}.json`, `${resolvedWithExt}.ejs`);
    } else {
      candidates.push(resolvedWithoutExt);
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function remapIeltsLegacyPath(filePath) {
  if (typeof filePath !== 'string') {
    return null;
  }

  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const marker = '/mvc/views/ielts/';
  if (!normalized.includes(marker)) {
    return null;
  }

  const markerIndex = normalized.indexOf(marker);
  const suffix = filePath.replace(/\\/g, '/').slice(markerIndex + marker.length);
  const candidates = [
    path.join(path.join(ROOT_DIR, 'packages', 'ielts', 'MVC', 'views', 'ielts', suffix)),
    path.join(path.join(ROOT_DIR, 'MVC', 'views', 'ielts', suffix))
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
    return candidate;
  }
  }

  return null;
}

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  try {
    return ORIG_RESOLVE_FILENAME.call(this, request, parent, isMain, options);
  } catch (error) {
    const relativeTarget = looksLikeIeltsTarget(request);
    if (!relativeTarget) {
      throw error;
    }

    const fallbackPath = resolveCandidate(relativeTarget);
  if (fallbackPath) {
      return fallbackPath;
    }

    throw error;
  }
};

fs.readFileSync = function patchedReadFileSync(file, options) {
  const remapped = remapIeltsLegacyPath(file);
  if (remapped) {
    return ORIG_READFILE_SYNC.call(fs, remapped, options);
  }
  return ORIG_READFILE_SYNC.call(fs, file, options);
};

fs.promises.readFile = async function patchedReadFile(file, options) {
  const remapped = remapIeltsLegacyPath(file);
  if (remapped) {
    return ORIG_READFILE_PROMISE.call(fs.promises, remapped, options);
  }
  return ORIG_READFILE_PROMISE.call(fs.promises, file, options);
};
