const { execSync: childExecSync } = require('child_process');

const ENV_HASH_KEYS = [
  'APP_BUILD_VERSION',
  'RAILWAY_GIT_COMMIT_SHA',
  'RAILWAY_GIT_COMMIT',
  'SOURCE_VERSION',
  'GIT_COMMIT',
  'COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'RENDER_GIT_COMMIT'
];

const ENV_COMMIT_AT_KEYS = [
  'APP_BUILD_TIMESTAMP',
  'RAILWAY_GIT_COMMIT_DATE',
  'SOURCE_VERSION_DATE'
];

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function extractHexHashToken(value = '') {
  const token = cleanText(value, 4000);
  if (!token) return '';
  const matches = token.match(/[a-fA-F0-9]{6,64}/g);
  if (!Array.isArray(matches) || !matches.length) return '';
  const sorted = matches.slice().sort((a, b) => b.length - a.length);
  return cleanText(sorted[0], 64).toLowerCase();
}

function toShortHash(value = '') {
  const full = extractHexHashToken(value);
  if (!full || full.length < 6) return '';
  return full.slice(-6);
}

function normalizeCommitAt(value = '') {
  const token = cleanText(value, 4000);
  if (!token) return '';
  const parsed = Date.parse(token);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString();
}

function resolveCommitAt(options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const execSync = typeof options?.execSync === 'function' ? options.execSync : childExecSync;
  const repoCommitAt = normalizeCommitAt(options?.repoCommitAt);

  if (repoCommitAt) {
    return {
      commitAt: repoCommitAt,
      commitAtSource: 'repo:config/build-version.json'
    };
  }

  for (const key of ENV_COMMIT_AT_KEYS) {
    const commitAt = normalizeCommitAt(env?.[key]);
    if (commitAt) {
      return {
        commitAt,
        commitAtSource: `env:${key}`
      };
    }
  }

  try {
    const gitRaw = cleanText(execSync('git log -1 --format=%cI HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }), 4000);
    const commitAt = normalizeCommitAt(gitRaw);
    if (commitAt) {
      return {
        commitAt,
        commitAtSource: 'git'
      };
    }
  } catch (_) {
    // ignore git fallback failure and return empty output below
  }

  return {
    commitAt: '',
    commitAtSource: ''
  };
}

function resolveBuildVersion(options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const execSync = typeof options?.execSync === 'function' ? options.execSync : childExecSync;
  const buildVersionOverride = cleanText(options?.buildVersionOverride, 4000);
  const repoBuildVersion = cleanText(options?.repoBuildVersion, 4000);
  const commitAtResolution = resolveCommitAt({
    env,
    execSync,
    repoCommitAt: options?.repoCommitAt
  });

  const overrideShortHash = toShortHash(buildVersionOverride);
  if (overrideShortHash) {
    return {
      shortHash: overrideShortHash,
      source: 'settings:app.buildVersionOverride',
      commitAt: commitAtResolution.commitAt,
      commitAtSource: commitAtResolution.commitAtSource
    };
  }

  const repoShortHash = toShortHash(repoBuildVersion);
  if (repoShortHash) {
    return {
      shortHash: repoShortHash,
      source: 'repo:config/build-version.json',
      commitAt: commitAtResolution.commitAt,
      commitAtSource: commitAtResolution.commitAtSource
    };
  }

  for (const key of ENV_HASH_KEYS) {
    const raw = cleanText(env?.[key], 4000);
    const shortHash = toShortHash(raw);
    if (shortHash) {
      return {
        shortHash,
        source: `env:${key}`,
        commitAt: commitAtResolution.commitAt,
        commitAtSource: commitAtResolution.commitAtSource
      };
    }
  }

  try {
    const gitRaw = cleanText(execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }), 4000);
    const shortHash = toShortHash(gitRaw);
    if (shortHash) {
      return {
        shortHash,
        source: 'git',
        commitAt: commitAtResolution.commitAt,
        commitAtSource: commitAtResolution.commitAtSource
      };
    }
  } catch (_) {
    // ignore git fallback failure and return empty output below
  }

  return {
    shortHash: '',
    source: '',
    commitAt: commitAtResolution.commitAt,
    commitAtSource: commitAtResolution.commitAtSource
  };
}

module.exports = {
  resolveBuildVersion,
  resolveCommitAt,
  normalizeCommitAt,
  ENV_HASH_KEYS,
  ENV_COMMIT_AT_KEYS
};
