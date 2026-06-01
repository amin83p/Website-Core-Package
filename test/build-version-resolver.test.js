const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBuildVersion } = require('../MVC/utils/buildVersionResolver');

test('resolveBuildVersion prefers app settings override and returns last six hex chars', () => {
  const result = resolveBuildVersion({
    buildVersionOverride: 'release-fedcba987654',
    repoBuildVersion: '1111111111111111111111111111111111111111',
    env: {
      APP_BUILD_VERSION: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    execSync: () => 'ffffffffffffffffffffffffffffffffffffffff'
  });

  assert.equal(result.shortHash, '987654');
  assert.equal(result.source, 'settings:app.buildVersionOverride');
});

test('resolveBuildVersion falls back to repo file when override is empty', () => {
  const result = resolveBuildVersion({
    buildVersionOverride: '',
    repoBuildVersion: 'v2026.06.01-3e4d47b324cf9976f5bcf2e58455fe8fcf3bbcdf',
    env: {},
    execSync: () => 'ffffffffffffffffffffffffffffffffffffffff'
  });

  assert.equal(result.shortHash, '3bbcdf');
  assert.equal(result.source, 'repo:config/build-version.json');
});

test('resolveBuildVersion uses env commit token and returns last six hex chars', () => {
  const result = resolveBuildVersion({
    env: {
      APP_BUILD_VERSION: 'release-abc123def456'
    },
    execSync: () => 'ffffffffffffffffffffffffffffffffffffffff'
  });

  assert.equal(result.shortHash, 'def456');
  assert.equal(result.source, 'env:APP_BUILD_VERSION');
});

test('resolveBuildVersion ignores invalid env token and falls back to git', () => {
  const result = resolveBuildVersion({
    buildVersionOverride: 'invalid-override',
    repoBuildVersion: 'invalid-repo-token',
    env: {
      APP_BUILD_VERSION: 'release-not-a-hash'
    },
    execSync: () => '3e4d47b324cf9976f5bcf2e58455fe8fcf3bbcdf'
  });

  assert.equal(result.shortHash, '3bbcdf');
  assert.equal(result.source, 'git');
});

test('resolveBuildVersion returns empty when env and git are unavailable', () => {
  const result = resolveBuildVersion({
    env: {},
    execSync: () => {
      throw new Error('git unavailable');
    }
  });

  assert.equal(result.shortHash, '');
  assert.equal(result.source, '');
});

test('resolveBuildVersion supports fallback env providers', () => {
  const result = resolveBuildVersion({
    env: {
      APP_BUILD_VERSION: '',
      RAILWAY_GIT_COMMIT_SHA: '74d1f2a6c9aa7e0bbef8840cf3d21a0956b31abc'
    },
    execSync: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });

  assert.equal(result.shortHash, 'b31abc');
  assert.equal(result.source, 'env:RAILWAY_GIT_COMMIT_SHA');
});
